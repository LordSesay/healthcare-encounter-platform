# ECS Deployment Verification Checklist

Each item below maps to a concrete step in the deployment process.
Check it off only when you have the output or screenshot to prove it.

---

## Phase 1 — Prerequisites

- [ ] AWS CLI configured and `aws sts get-caller-identity` returns your account ID
- [ ] Jenkins running and reachable
- [ ] Jenkins credentials configured:
  - `aws-credentials` (AWS IAM key with ECR/ECS/RDS/Secrets permissions)
  - `db-password` (the RDS master password you will set)
  - `test-database-url` (connection string for the disposable test database)
- [ ] Docker running on the Jenkins agent
- [ ] Terraform >= 1.5.0 installed on the Jenkins agent
- [ ] `jq` installed on the Jenkins agent (required by render-taskdef.sh)

---

## Phase 2 — Infrastructure (Jenkinsfile.infra, ENVIRONMENT=dev)

- [ ] `terraform init` succeeds with correct S3 backend key `env/dev/terraform.tfstate`
- [ ] `terraform validate` passes
- [ ] `terraform plan` output reviewed — confirm these resources will be created:
  - VPC + subnets + NAT gateway
  - ECR repositories (backend + frontend)
  - RDS PostgreSQL instance
  - Secrets Manager secret (DATABASE_URL)
  - ECS cluster + task definition + service
  - ALB + target groups + listener rules
  - IAM execution role
- [ ] `terraform apply` completes with no errors
- [ ] Evidence file committed: `docs/evidence/tf-outputs-dev.json`

**Capture after apply:**
```bash
# Run from infra/ directory
terraform output -json > ../docs/evidence/tf-outputs-dev.json
```

---

## Phase 3 — Database Migration

RDS stays private. Migrations run as a one-off Fargate task in the app subnets (`cicd/jenkins/ecs/run-migration.sh`, the Jenkins "Run Migrations" stage).

- [ ] Migration task exits 0 — `migration-task.json` shows backend `exitCode: 0`
- [ ] Post-deploy smoke test's ADT create/resolve succeeds (proves the schema exists)

---

## Phase 4 — Application Pipeline (Jenkinsfile, ENVIRONMENT=dev, DEPLOY=true)

- [ ] Backend unit tests pass (35 tests)
- [ ] Backend integration tests pass (18 tests) — confirms TEST_DATABASE_URL is wired
- [ ] Frontend `npm ci` succeeds — confirms lockfile mismatch is resolved
- [ ] Frontend build succeeds
- [ ] Docker images built successfully
- [ ] ECR login succeeds
- [ ] Images pushed to ECR with build number tag (not just :latest)
- [ ] ECS task definition registered — new ARN written to `new-taskdef-arn.txt`
- [ ] ECS service updated with new task definition
- [ ] ECS service reaches stable state (all tasks running)
- [ ] Post-deploy smoke test passes:
  - `/health` returns `{"status":"healthy","database":"connected"}`
  - ADT A01 round-trip returns `{"encounter_id":"ENC-..."}`

---

## Phase 5 — Evidence Committed to Repository

- [ ] `docs/evidence/tf-outputs-dev.json` — Terraform outputs (ALB DNS, ECR URLs, cluster name)
- [ ] `docs/evidence/ecs-service-dev-build-NNN.json` — ECS service state post-deploy
- [ ] `docs/evidence/taskdef-arn-dev-build-NNN.txt` — exact task definition ARN deployed
- [ ] Screenshot of Jenkins pipeline with all stages green
- [ ] Screenshot of ALB DNS returning healthy response in browser

---

## What Each Piece of Evidence Proves

| Evidence | What it proves |
|---|---|
| `tf-outputs-dev.json` | Infrastructure was provisioned by Terraform, not manually |
| `ecs-service-dev-build-NNN.json` | The specific build number is running in ECS |
| `taskdef-arn-dev-build-NNN.txt` | The exact image tag deployed is traceable |
| Integration test pass | The database layer works, not just unit logic |
| Smoke test ADT round-trip | The full stack (ALB → ECS → RDS) is functional end-to-end |
| Jenkins screenshot | The pipeline is automated, not a manual deploy |
