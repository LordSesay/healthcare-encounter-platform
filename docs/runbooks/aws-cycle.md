# AWS deploy → verify → evidence → teardown cycle

`scripts/aws-cycle.sh` proves, in one run, that the current commit deploys to a disposable environment and works end to end. It then removes everything and proves the removal. Use it for dev or staging, never prod; the script refuses prod.

```bash
scripts/aws-cycle.sh --env dev
```

## What a run does

| Phase | Action | Evidence (`docs/evidence/aws-<env>-<stamp>-cycle/`) |
| --- | --- | --- |
| preflight | Caller identity, S3 state bucket + DynamoDB lock table, tool versions; refuses an environment that already has resources unless `--allow-existing` | `preflight-identity.json`, `preflight-versions.txt`, `tf-init.log` |
| provision-ecr | `terraform apply -target=module.ecr` | `tf-apply-ecr.log` |
| build-push | Build both images for `linux/amd64` and push the immutable tag `<sha12>-<stamp>[-dirty]` | `image-backend.json`, `image-frontend.json` (digests) |
| provision-stack | Saved plan, then apply of everything else with that tag | `tf-plan.txt`, `tf-apply.log`, `tf-outputs.json` |
| migrate | One-off Fargate task runs `node models/migrate.js` inside the VPC (RDS stays private); fails on a non-zero exit | `migration-task.json` |
| deploy | `update-service` + `wait services-stable`; every ALB target must be healthy | `ecs-service.json`, `target-health.json` |
| smoke | `cicd/smoke/smoke.sh`: `/health` with DB connected; no-token and forged-token → 401; Cognito client-credentials token; ADT A01 → 201; identical retry → 200, same ID; scoped resolve; detail read; frontend `/` | `smoke/*.json`, `smoke/smoke-summary.json` |
| capture-logs | Last hour of ECS CloudWatch logs | `ecs-logs.txt` |
| teardown | `terraform destroy` | `tf-destroy.log` |
| verify-teardown | Empty Terraform state; direct lookups (ECS, RDS, ALB, ECR, both secrets, Cognito); tagging-API sweep, where only KMS keys in `PendingDeletion` may remain | `teardown-verification.txt` |
| — | Run summary and checksums | `summary.json`, `SHA256SUMS`, `cycle.log` |

If any phase fails after provisioning starts, the script tears the stack down before exiting, unless you passed `--keep`. `summary.json` then records `status: fail` and the failed phase. If teardown itself fails, the script prints the recovery command:

```bash
scripts/aws-cycle.sh --env dev --teardown-only
```

## Prerequisites

- **AWS CLI credentials** that `aws sts get-caller-identity` accepts, with permission to create and delete the resources above plus `iam:PassRole` on the ECS execution role.
- **Remote state:** the S3 state bucket and DynamoDB lock table named in `infra/provider.tf`.
- **Tools:** Docker (BuildKit), Terraform ≥ 1.5, jq, openssl, curl and Git Bash on Windows. The script disables MSYS path conversion itself.
- **Database password (optional):** set `TF_VAR_db_password` to choose it. Otherwise each run generates a random hex password that is kept only in the process and in Terraform state.

## Cost and timing

A full run takes about 25–40 minutes; RDS creation and deletion dominate. While it runs, the NAT gateway, ALB, a `db.t3.micro`, one Fargate task and the Cognito M2M client cost roughly $0.15–0.25 per hour, plus a prorated $1/month for the KMS key, which stays in its 7-day pending-deletion window afterwards. Teardown is the default.

## Notes

- **Account ID in evidence:** ECR URLs, ARNs and `preflight-identity.json` include your AWS account ID. Review the folder before committing it to a public repository.
- **Plain HTTP in dev:** dev serves HTTP on the ALB DNS name, so the smoke test's bearer token crosses HTTP. Data is synthetic, but enable HTTPS (`enable_dns` + `enable_https`) before any non-synthetic use.
- **Ownership split:** Terraform creates the ECS service with the release tag but ignores later task-definition and desired-count changes. Rollouts belong to this script and `Jenkinsfile`; scaling belongs to autoscaling.
- **Jenkins needs the same steps:** `Jenkinsfile` uses the same migration and smoke scripts. Its `aws-credentials` identity additionally needs `ecs:RunTask`, `iam:PassRole` and `secretsmanager:GetSecretValue` on `encounter-platform/<env>/m2m-client`.
