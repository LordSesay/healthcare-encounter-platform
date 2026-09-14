# Current application and infrastructure evidence — 2026-09-14

## GitHub application truth

The clean local `main` was two commits ahead of GitHub. Pushed, in order:

- `2f569f2`: transactional ADT processing, validation, migrations and tests.
- `4e6ec0b`: Phase 1 contract and encoding documentation.

GitHub's commits API confirmed `main` at `4e6ec0b286a0770f64bdf108ec1183cf480dfe1d` after the push. This is the application revision audited below. Subsequent documentation commits do not change the application tested here.

GitHub's recursive tree confirms the three backend test files and `apps/frontend/src/App.test.js`. There is no committed `.github/` workflow or `infra/environments/` directory. The environment tfvars files on this workstation are ignored local files, not part of the GitHub application truth.

GitHub API evidence at inspection: Actions runs = 0; check runs for the application revision = 0; commit statuses = 0; deployments = 0. The combined status API returned `pending` with no statuses; this is not evidence of an executing CI job. External Jenkins runs and AWS deployments may exist, but no build URL, release identifier or current AWS health evidence was established in this audit.

## Test inventory and execution

| Scope | Cases in synced source | Local result |
| --- | ---: | --- |
| Backend validation | 31 | Passed |
| Backend repository normalization and transitions | 4 | Passed |
| Backend PostgreSQL integration | 18 | Passed |
| Frontend dashboard | 1 | Blocked before test execution |
| Total | 54 | 53 passed; one frontend case unverified |

Counts include expanded `test.each` cases, not just test declarations. No GitHub-hosted passing count is available.

Executed on Windows with Node.js 24.18.0 against the unchanged synced source:

- Backend `npm test -- --runInBand`: 35 passed, 18 skipped, 53 total.
- Backend `npm run test:integration` with `TEST_DATABASE_URL` pointed at an isolated PostgreSQL 15 Alpine container: 53 passed, 3 suites, no skips. The suite creates and removes unique test schemas.
- Repeated the full backend suite with both `TZ` and `TEST_DB_TIMEZONE` set to `America/New_York`: 53 passed. This is a second execution of the same cases, not 106 distinct tests.
- Frontend `CI=true npm test -- --watchAll=false --runInBand`: suite failed to load because `react-router-dom` was unavailable; zero tests executed.
- Frontend clean-install verification: `npm ci --no-audit --no-fund` failed because the committed package lock omits `react-router-dom@5.3.4` and its dependencies. No frontend build or passing frontend test is claimed.

The backend used installed local dependencies; a fresh backend dependency installation was not part of this audit. No coverage percentage was measured.

## Infrastructure validation and module audit

`terraform init -backend=false -input=false` succeeded with locked AWS provider 5.100.0. `terraform validate` and `terraform fmt -check -recursive` passed. Initialization did not connect to the S3 state backend. No AWS plan, apply, refresh, health check or deployment was executed. Local state files were not used as proof of live resources.

| Module | Implemented in source | Validation boundary / remaining work |
| --- | --- | --- |
| `vpc` | Two AZs, public/app/database subnets, IGW, NAT and routes | Single NAT is shared by both AZs; no live connectivity or failover evidence |
| `security` | ALB ingress, ALB-to-ECS rules, ECS/Jenkins-to-RDS rules | Jenkins IP defaults to a workstation-specific value; verify routing and actual source before use |
| `ecr` | Separate environment-named frontend/backend repositories | No explicit tag immutability; `force_delete=true`; pipeline pushes `latest` |
| `alb` | Frontend/API target groups, `/health`, optional HTTPS redirect | No current healthy-target or TLS evidence; verify listener/service creation ordering |
| `ecs` | Fargate task/service, two containers, CloudWatch Logs, CPU/memory scaling | Hardcoded 80/8080 despite root port inputs; Terraform uses `latest`; no migration stage; no live rollout/scaling evidence |
| `rds` | Private encrypted PostgreSQL, configurable backups, Multi-AZ and deletion protection | Engine pinned to 15.10; live availability, restore and migration not checked; connection URL interpolates credentials without escaping |
| `secrets` | Secrets Manager database URL, rotating KMS key and policy | Immediate secret deletion configured; database secret is represented in Terraform state; state access must be controlled |
| `iam` | ECS execution role with secret/KMS access | Live role behavior not verified |
| `dns` | Optional Route 53 zone, ACM certificate/validation and alias | HTTPS references `module.dns[0]`; no input guard for HTTPS enabled with DNS disabled |
| `codedeploy` | Opt-in versioned private S3 artifacts, IAM/profile, Server deployment group, failure rollback | Requires existing EC2 target, attached profile, agent and runtime configuration; no deployment/rollback evidence; not blue/green |

Additional wiring findings:

- Local staging/prod tfvars set HTTPS true but omit `enable_dns`, whose default is false. With those inputs, `module.dns[0]` is invalid. These files are not committed and root validation does not prove their plan succeeds.
- ECS receives `kms_key_arn`, but its log group does not set `kms_key_id`; do not claim customer-managed KMS encryption for those logs.
- ECS frontend runtime `REACT_APP_API_URL` does not replace the build-time value in the static React bundle. Backend CORS origin is hardcoded to the HTTP ALB URL, including for optional domain/HTTPS configurations.
- Terraform owns service task definition and desired count while Jenkins and autoscaling also change them; establish ownership before subsequent applies.
- Neither ECS startup nor CodeDeploy hooks run schema migrations. The September contract explicitly leaves deployment migration orchestration outstanding.

## Jenkins pipeline audit

| Pipeline | Implemented behavior | Gaps affecting claims |
| --- | --- | --- |
| Root `Jenkinsfile` | Backend test, frontend build, ECR push, task-definition registration, ECS update/stability wait and production approval | No integration DB configured; no frontend test; `DEPLOY=false` skips tests; any nonempty promotion tag skips builds/tests even outside prod; promotion assumes images already exist in the target environment's repositories; no migration or post-rollout ADT smoke test |
| `Jenkinsfile.infra` | Init, validate, saved plan, approval, apply | Init omits required S3 backend key; plan omits required environment/tfvars; deletes local state before initialization; no noninteractive input flag on plan; cannot claim a reproducible environment pipeline |
| `Jenkinsfile.codedeploy` | Backend tests/audit, SHA-named ZIP, S3 upload, CodeDeploy wait, artifact archiving | No integration DB configured; no migration; deployment references S3 key without object version/ETag; shell blocks use `pipefail` without selecting Bash; no recent executed release evidence |
| `cicd/jenkins/Jenkinsfile` | Older combined build/infra/ECS pipeline | Stale `backend`/`frontend` paths; missing `DEPLOY` parameter despite conditions; no closing `stages` brace before `post`; not a usable current pipeline |

Both ECS pipeline variants perform agent-wide Docker pruning, which needs isolation from other jobs. No Jenkins parser or live Jenkins execution was available; pipeline findings are source review, not a successful Jenkins validation.

The current health endpoint returns HTTP 200 when the database URL is absent (`database: not configured`), and uses a separate pool from the main application's SSL configuration. Therefore a health-hook success alone cannot prove a configured, working encounter persistence path. Verify an actual create/resolve/retry flow after deployment.

## Promotion decision

Promote transactional ADT behavior to **implemented and locally tested**, with the exact revision and 53-case result above. Promote Terraform only to **implemented and locally configuration-validated**.

All AWS components remain **implemented but not recently validated in AWS**. Optional Route 53/ACM and EC2/CodeDeploy remain opt-in implementations. No component is promoted to currently deployed, production-ready, blue/green, or rollback-proven on this evidence.

Before changing that classification, repair the frontend lockfile and CI gates, resolve environment/backend and HTTPS inputs, orchestrate migrations, then capture a Jenkins build tied to a commit, image digest or artifact version, deployment ID/task definition, endpoint health and ADT smoke results. AWS execution is separate from this source audit.
