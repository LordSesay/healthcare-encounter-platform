#!/bin/bash
# Run schema migrations as a one-off Fargate task inside the VPC, using the
# exact task definition about to be deployed. RDS stays private; nothing
# outside the VPC needs database access.
#
# Usage: run-migration.sh CLUSTER TASK_DEF_ARN SUBNETS_CSV SECURITY_GROUPS_CSV REGION [EVIDENCE_DIR]
set -euo pipefail

CLUSTER="$1"
TASK_DEF_ARN="$2"
SUBNETS="$3"
SECURITY_GROUPS="$4"
AWS_REGION="$5"
EVIDENCE_DIR="${6:-.}"
mkdir -p "$EVIDENCE_DIR"

TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF_ARN" \
  --launch-type FARGATE \
  --count 1 \
  --started-by migration \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"backend","command":["node","models/migrate.js"]}]}' \
  --region "$AWS_REGION" \
  --query 'tasks[0].taskArn' --output text)

[ -n "$TASK_ARN" ] && [ "$TASK_ARN" != "None" ] || { echo "Migration task did not start" >&2; exit 1; }
echo "Migration task: $TASK_ARN"

# The backend container is essential, so the task stops when migrate exits.
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$AWS_REGION"

aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$AWS_REGION" \
  --query 'tasks[0].{taskArn:taskArn,taskDefinitionArn:taskDefinitionArn,stoppedReason:stoppedReason,containers:containers[].{name:name,exitCode:exitCode,reason:reason}}' \
  > "$EVIDENCE_DIR/migration-task.json"

EXIT_CODE=$(jq -r '.containers[] | select(.name=="backend") | .exitCode' "$EVIDENCE_DIR/migration-task.json")
if [ "$EXIT_CODE" != "0" ]; then
  echo "Migration failed (backend exit code: $EXIT_CODE)" >&2
  jq . "$EVIDENCE_DIR/migration-task.json" >&2
  exit 1
fi
echo "Migrations applied (task $TASK_ARN exit 0)"
