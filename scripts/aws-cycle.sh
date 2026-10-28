#!/bin/bash
# Deploy -> migrate -> verify -> capture evidence -> tear down -> prove teardown,
# for a disposable (non-prod) environment. One command, one evidence folder.
#
#   scripts/aws-cycle.sh [--env dev] [--yes] [--keep] [--allow-existing]
#   scripts/aws-cycle.sh --env dev --teardown-only
#
# --keep            leave the stack running after verification (teardown later
#                   with --teardown-only); default is to always tear down
# --allow-existing  proceed even if the environment's state already has resources
# --yes             skip the interactive confirmation
#
# Evidence: docs/evidence/aws-<env>-<UTC stamp>/ with SHA256SUMS. If any phase
# fails after provisioning starts, the stack is torn down unless --keep.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' # Git Bash: keep /health, /ecs/... literal
export AWS_PAGER=""

ENVIRONMENT=dev KEEP=0 YES=0 ALLOW_EXISTING=0 TEARDOWN_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENVIRONMENT="$2"; shift ;;
    --keep) KEEP=1 ;;
    --yes) YES=1 ;;
    --allow-existing) ALLOW_EXISTING=1 ;;
    --teardown-only) TEARDOWN_ONLY=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
[ "$ENVIRONMENT" != prod ] || { echo "Refusing to run a disposable cycle against prod" >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
AWS_REGION="${AWS_REGION:-us-east-1}"
APP=encounter-platform
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SHA=$(git rev-parse --short=12 HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
IMAGE_TAG="$SHA-$(echo "$STAMP" | tr 'TZ' 'tz')$([ "$DIRTY" = 0 ] || echo -dirty)"
MODE=$([ "$TEARDOWN_ONLY" = 1 ] && echo teardown || echo cycle)
EVIDENCE="docs/evidence/aws-$ENVIRONMENT-$STAMP-$MODE"
mkdir -p "$EVIDENCE"
exec > >(tee -a "$EVIDENCE/cycle.log") 2>&1

TF=(terraform -chdir=infra)
TF_VARS=(-input=false -var-file="environments/$ENVIRONMENT.tfvars" -var="environment=$ENVIRONMENT" -var="image_tag=$IMAGE_TAG")
# Any value satisfies destroy; a fresh environment gets a random hex password
# (safe in the connection URL). It lives only in this process and TF state.
export TF_VAR_db_password="${TF_VAR_db_password:-$(openssl rand -hex 24)}"

PROVISIONED=0 TORN_DOWN=0 CURRENT_PHASE=preflight
declare -a PHASES=()
phase() {
  CURRENT_PHASE="$1"
  PHASES+=("$(jq -cn --arg p "$1" --arg t "$(date -u +%FT%TZ)" '{phase:$p, started_at:$t}')")
  echo; echo "=== [$(date -u +%T)] $1"
}

write_manifest() {
  local status=$1
  local joined; joined=$(IFS=,; echo "${PHASES[*]:-}")
  jq -n --arg status "$status" --arg failed "$( [ "$status" = pass ] && echo "" || echo "$CURRENT_PHASE")" \
    --arg env "$ENVIRONMENT" --arg region "$AWS_REGION" --arg commit "$(git rev-parse HEAD)" \
    --arg tag "$IMAGE_TAG" --arg dirty "$DIRTY" --arg mode "$MODE" \
    --arg kept "$KEEP" --arg torn "$TORN_DOWN" --argjson phases "[$joined]" \
    '{status:$status, failed_phase:(if $failed == "" then null else $failed end), mode:$mode, environment:$env, region:$region,
      commit:$commit, uncommitted_files:($dirty|tonumber), image_tag:$tag,
      stack_kept:($kept=="1"), torn_down:($torn=="1"), phases:$phases, finished_at:(now|todate)}' \
    > "$EVIDENCE/summary.json"
  (cd "$EVIDENCE" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS)
  echo "Evidence: $EVIDENCE ($(wc -l < "$EVIDENCE/SHA256SUMS") files, status=$status)"
}

teardown() {
  phase teardown
  "${TF[@]}" destroy -auto-approve "${TF_VARS[@]}" -no-color > "$EVIDENCE/tf-destroy.log"
  tail -3 "$EVIDENCE/tf-destroy.log"
  TORN_DOWN=1
  verify_teardown
}

# Proves nothing billable is left: Terraform state, direct service lookups,
# and the tagging API (KMS keys legitimately remain in PendingDeletion).
verify_teardown() {
  phase verify-teardown
  local out="$EVIDENCE/teardown-verification.txt" problems=0
  set -f # queries contain [?...] and must not glob
  {
    echo "terraform state resources: $("${TF[@]}" state list | wc -l | tr -d ' ')"
    for check in \
      "ecs cluster|aws ecs describe-clusters --clusters $APP-$ENVIRONMENT-cluster --region $AWS_REGION --query clusters[?status=='ACTIVE'].clusterName --output text" \
      "rds instance|aws rds describe-db-instances --db-instance-identifier $APP-$ENVIRONMENT-db --region $AWS_REGION --query DBInstances[].DBInstanceStatus --output text" \
      "alb|aws elbv2 describe-load-balancers --names $APP-$ENVIRONMENT-alb --region $AWS_REGION --query LoadBalancers[].State.Code --output text" \
      "ecr repositories|aws ecr describe-repositories --repository-names $APP-$ENVIRONMENT-backend $APP-$ENVIRONMENT-frontend --region $AWS_REGION --query repositories[].repositoryName --output text" \
      "secret database-url|aws secretsmanager describe-secret --secret-id $APP/$ENVIRONMENT/database-url --region $AWS_REGION --query Name --output text" \
      "secret m2m-client|aws secretsmanager describe-secret --secret-id $APP/$ENVIRONMENT/m2m-client --region $AWS_REGION --query Name --output text" \
      "cognito pools|aws cognito-idp list-user-pools --max-results 60 --region $AWS_REGION --query UserPools[?Name=='$APP-$ENVIRONMENT-m2m'].Id --output text"
    do
      label=${check%%|*}; cmd=${check#*|}
      found=$($cmd 2>/dev/null || true)
      echo "$label: ${found:-none}"
    done
  } | tee "$out"
  set +f
  grep -vE ': (none|0)$' "$out" | grep -q . && problems=1

  # Tagging API is eventually consistent; allow it to settle.
  local remaining=""
  for _ in $(seq 1 12); do
    remaining=$(aws resourcegroupstaggingapi get-resources --region "$AWS_REGION" \
      --tag-filters "Key=Project,Values=$APP" "Key=Environment,Values=$ENVIRONMENT" \
      --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n' | grep -v '^$' || true)
    local unexpected=""
    for arn in $remaining; do
      if [[ "$arn" == arn:aws:kms:* ]] && [ "$(aws kms describe-key --key-id "$arn" --region "$AWS_REGION" --query KeyMetadata.KeyState --output text 2>/dev/null)" = PendingDeletion ]; then
        continue
      fi
      unexpected+="$arn"$'\n'
    done
    [ -z "$unexpected" ] && break
    sleep 10
  done
  {
    echo "tagged resources still present (Project=$APP, Environment=$ENVIRONMENT):"
    echo "${remaining:-none}"
    echo "unexpected (not KMS PendingDeletion): ${unexpected:-none}"
  } | tee -a "$out"
  [ -z "$unexpected" ] || problems=1
  [ "$problems" = 0 ] || { echo "Teardown verification found leftovers; see $out" >&2; return 1; }
  echo "Teardown verified: no billable resources remain"
}

on_exit() {
  local code=$?
  set +e
  if [ "$code" != 0 ]; then
    echo; echo "!!! Phase '$CURRENT_PHASE' failed (exit $code)"
    if [ "$PROVISIONED" = 1 ] && [ "$TORN_DOWN" = 0 ] && [ "$KEEP" = 0 ]; then
      echo "Tearing down to avoid orphaned resources..."
      local failed_phase=$CURRENT_PHASE
      teardown || echo "!!! Teardown failed — run: scripts/aws-cycle.sh --env $ENVIRONMENT --teardown-only"
      CURRENT_PHASE=$failed_phase
    fi
    write_manifest fail
  else
    write_manifest pass
  fi
  exit "$code"
}
trap on_exit EXIT

# ── preflight ────────────────────────────────────────────────────────────────
phase preflight
for tool in aws terraform docker jq git openssl curl sha256sum; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
aws sts get-caller-identity --query '{account:Account,arn:Arn}' --output json > "$EVIDENCE/preflight-identity.json"
ACCOUNT=$(jq -r .account "$EVIDENCE/preflight-identity.json")
STATE_BUCKET=$(sed -n 's/^ *bucket *= *"\(.*\)"/\1/p' infra/provider.tf)
LOCK_TABLE=$(sed -n 's/^ *dynamodb_table *= *"\(.*\)"/\1/p' infra/provider.tf)
aws s3api head-bucket --bucket "$STATE_BUCKET" --region "$AWS_REGION"
aws dynamodb describe-table --table-name "$LOCK_TABLE" --region "$AWS_REGION" --query Table.TableStatus --output text
{
  echo "commit: $(git rev-parse HEAD) (uncommitted files: $DIRTY)"
  echo "image tag: $IMAGE_TAG"
  terraform version | head -1; aws --version; docker version --format 'docker {{.Server.Version}}'; jq --version
} | tee "$EVIDENCE/preflight-versions.txt"

"${TF[@]}" init -input=false -reconfigure -no-color -backend-config="key=env/$ENVIRONMENT/terraform.tfstate" > "$EVIDENCE/tf-init.log"
EXISTING=$("${TF[@]}" state list | wc -l | tr -d ' ')
echo "existing resources in env/$ENVIRONMENT state: $EXISTING"

if [ "$TEARDOWN_ONLY" = 1 ]; then
  if [ "$YES" != 1 ]; then
    read -r -p "Destroy $EXISTING resources of '$ENVIRONMENT' in account $ACCOUNT? Type the environment name: " answer
    [ "$answer" = "$ENVIRONMENT" ] || { echo "Aborted"; exit 1; }
  fi
  PROVISIONED=1
  teardown
  exit 0
fi

if [ "$EXISTING" != 0 ] && [ "$ALLOW_EXISTING" != 1 ]; then
  echo "Environment '$ENVIRONMENT' already has $EXISTING resources. This cycle would modify and then destroy them." >&2
  echo "Re-run with --allow-existing to proceed, or --teardown-only to remove them." >&2
  exit 1
fi

if [ "$YES" != 1 ]; then
  echo
  echo "About to create '$ENVIRONMENT' in account $ACCOUNT ($AWS_REGION): VPC+NAT, ALB, ECS Fargate, RDS, Cognito, Secrets/KMS."
  echo "Billable while running (~\$0.15/hour plus data); teardown at the end: $([ "$KEEP" = 1 ] && echo NO \(--keep\) || echo yes)."
  read -r -p "Type the environment name to continue: " answer
  [ "$answer" = "$ENVIRONMENT" ] || { echo "Aborted"; exit 1; }
fi

# ── provision registries, then build and push immutable images ──────────────
phase provision-ecr
PROVISIONED=1
"${TF[@]}" apply -auto-approve -no-color "${TF_VARS[@]}" -target=module.ecr > "$EVIDENCE/tf-apply-ecr.log"

phase build-push
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
for svc in backend frontend; do
  ref="$REGISTRY/$APP-$ENVIRONMENT-$svc:$IMAGE_TAG"
  docker build --pull --platform linux/amd64 -t "$ref" "apps/$svc"
  docker push "$ref"
  aws ecr describe-images --region "$AWS_REGION" --repository-name "$APP-$ENVIRONMENT-$svc" --image-ids imageTag="$IMAGE_TAG" \
    --query 'imageDetails[0].{repository:repositoryName,digest:imageDigest,tags:imageTags,pushedAt:imagePushedAt,sizeBytes:imageSizeInBytes}' \
    > "$EVIDENCE/image-$svc.json"
  docker image rm "$ref" >/dev/null
done

# ── provision everything else with the release tag ──────────────────────────
phase provision-stack
"${TF[@]}" plan -no-color "${TF_VARS[@]}" -out=cycle.tfplan > /dev/null
"${TF[@]}" show -no-color cycle.tfplan > "$EVIDENCE/tf-plan.txt"
grep -E '^Plan:' "$EVIDENCE/tf-plan.txt" || true
"${TF[@]}" apply -auto-approve -no-color cycle.tfplan > "$EVIDENCE/tf-apply.log"
rm -f infra/cycle.tfplan
"${TF[@]}" output -json > "$EVIDENCE/tf-outputs.json"
out() { jq -r "$1" "$EVIDENCE/tf-outputs.json"; }
CLUSTER=$(out .ecs_cluster_name.value)
SERVICE=$(out .ecs_service_name.value)
TASK_DEF=$(out .ecs_task_definition_arn.value)
ALB_URL="http://$(out .alb_dns_name.value)"

# ── schema migrations inside the VPC ─────────────────────────────────────────
phase migrate
./cicd/jenkins/ecs/run-migration.sh "$CLUSTER" "$TASK_DEF" \
  "$(out '.ecs_network.value.subnets | join(",")')" \
  "$(out '.ecs_network.value.security_groups | join(",")')" \
  "$AWS_REGION" "$EVIDENCE"

# ── roll out and wait for steady state ──────────────────────────────────────
phase deploy
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$TASK_DEF" \
  --force-new-deployment --region "$AWS_REGION" > /dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$AWS_REGION"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$AWS_REGION" \
  --query 'services[0].{status:status,desired:desiredCount,running:runningCount,taskDefinition:taskDefinition,deployments:deployments[].{status:status,rolloutState:rolloutState,taskDefinition:taskDefinition,running:runningCount}}' \
  > "$EVIDENCE/ecs-service.json"
for tg in $(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --region "$AWS_REGION" \
  --query 'services[0].loadBalancers[].targetGroupArn' --output text); do
  aws elbv2 describe-target-health --target-group-arn "$tg" --region "$AWS_REGION" \
    --query 'TargetHealthDescriptions[].{target:Target.Id,port:Target.Port,state:TargetHealth.State}' --output json
done | jq -s 'add' > "$EVIDENCE/target-health.json"
jq -e 'length > 0 and all(.state == "healthy")' "$EVIDENCE/target-health.json" > /dev/null

# ── functional verification ─────────────────────────────────────────────────
phase smoke
BASE_URL="$ALB_URL" AWS_REGION="$AWS_REGION" M2M_SECRET_ID="$(out .m2m_secret_id.value)" \
  RUN_ID="cycle-$STAMP" EVIDENCE_DIR="$EVIDENCE/smoke" ./cicd/smoke/smoke.sh
curl -sS -o /dev/null -w 'frontend GET / -> HTTP %{http_code}\n' "$ALB_URL/" | tee "$EVIDENCE/smoke/frontend.txt"

phase capture-logs
aws logs filter-log-events --log-group-name "$(out .ecs_log_group_name.value)" --region "$AWS_REGION" \
  --start-time $(( ($(date +%s) - 3600) * 1000 )) --max-items 2000 --query 'events[].[logStreamName,message]' --output text \
  > "$EVIDENCE/ecs-logs.txt" || true

# ── teardown (default) ───────────────────────────────────────────────────────
if [ "$KEEP" = 1 ]; then
  phase kept
  echo "Stack left running at $ALB_URL — remove it with: scripts/aws-cycle.sh --env $ENVIRONMENT --teardown-only"
else
  teardown
fi
CURRENT_PHASE=complete
