# Healthcare Encounter ID Source-of-Truth Platform

A React, Node.js/Express and PostgreSQL prototype for generating, resolving and tracking canonical encounter identifiers across simulated hospital systems. Examples use synthetic patient and visit data.

**Status checked September 14, 2026.** The September application changes are synced to GitHub at `4e6ec0b286a0770f64bdf108ec1183cf480dfe1d`. The backend has 53 locally passing tests. The frontend has one test whose execution is blocked by a lockfile mismatch. Current AWS deployment status is unverified.

## Implemented

An upstream integration engine submits normalized JSON ADT events. The API persists a scoped encounter identity and returns an identifier for downstream billing, lab and documentation workflows. Native HL7 v2 parsing and real EHR connectivity are not implemented.

- ADT A01 admission, A04 registration, A02 transfer, A03 discharge and A08 metadata updates.
- Database-enforced visit and message identity scoped by source system and facility; patient identity includes assigning authority.
- Transactional inbox, encounter and history writes; exact retries return the stored response.
- Rejection of changed duplicate messages, stale events, ambiguous resolution and invalid lifecycle transitions.
- Calendar-valid timestamps normalized to UTC; migrations preserve legacy identifiers and convert naive timestamps under an explicit legacy-UTC assumption.
- Direct encounter creation, list/filter, detail, status, metadata, void and dashboard APIs.

| API | Purpose |
| --- | --- |
| `POST /api/encounters/from-adt` | Process a normalized ADT envelope |
| `GET /api/encounters/resolve?source_system=ehr-demo&facility_id=north&csn=visit-456` | Resolve a scoped visit |
| `POST /api/encounters` | Create directly |
| `GET /api/encounters` | List/filter |
| `GET /api/encounters/:id` | Retrieve encounter details |
| `PATCH /api/encounters/:id/status` | Advance lifecycle |
| `PATCH /api/encounters/:id` | Update metadata |
| `DELETE /api/encounters/:id` | Void an encounter |
| `GET /api/encounters/stats` | Dashboard metrics |

See the [normalized ADT contract](docs/normalized-adt.md) for required fields, lifecycle rules, response semantics and migration procedures. Source identity is caller asserted; authentication is still remaining work.

Infrastructure code defines VPC/subnets/NAT, security groups, ECR, ALB, ECS Fargate, RDS PostgreSQL, IAM, Secrets Manager/KMS, CloudWatch Logs and CPU/memory autoscaling. Route 53/ACM and EC2/CodeDeploy are optional implementations.

The root `Jenkinsfile` implements the ECS delivery path. `Jenkinsfile.infra` implements a Terraform approval/apply flow. `Jenkinsfile.codedeploy` implements a separate S3-to-EC2 release path. Their current gaps are recorded in the [dated audit](docs/current-state-audit-2026-09-14.md); the older `cicd/jenkins/Jenkinsfile` is stale.

## Tested

These are **local results for the synced GitHub application revision**, not GitHub CI results. GitHub reported zero Actions runs, zero check runs and zero commit statuses at inspection.

| Scope | Cases | September 14 result |
| --- | ---: | --- |
| Backend unit/validation | 35 | Passed |
| Backend PostgreSQL integration | 18 | Passed against disposable PostgreSQL 15 |
| Frontend dashboard | 1 | Unverified: suite cannot load; clean install fails on lockfile mismatch |
| Total in source | 54 | 53 passed locally; one unverified |

The backend suite also passed with application and database timezones set to `America/New_York`. Repeated runs do not increase the unique test count. Coverage includes concurrent delivery, retry identity, lifecycle rules, rollback, HTTP responses, migration and timestamp behavior.

Backend `npm test -- --runInBand` without `TEST_DATABASE_URL` passes 35 tests and **skips 18**. To require database coverage, configure a disposable PostgreSQL database and run:

```powershell
cd apps/backend
npm ci
$env:TEST_DATABASE_URL='postgresql://postgres:password@127.0.0.1:5432/encounter_test'
$env:TZ='UTC'
$env:TEST_DB_TIMEZONE='UTC'
npm run test:integration
```

The harness creates and removes uniquely named schemas. See the [contract](docs/normalized-adt.md) for the second timezone run and database requirements.

Terraform initialization with `-backend=false`, `terraform validate`, and `terraform fmt -check -recursive` passed using AWS provider 5.100.0. This validates configuration; no AWS plan or apply was run. Jenkins pipelines were reviewed as source, not executed.

## Deployed

**No current AWS deployment is verified by this audit.** GitHub has the September application changes, but publishing source does not establish that ECS or EC2 runs that revision. GitHub's deployments API returned no records; this does not rule out externally managed deployments.

All AWS components are classified as **implemented but not recently validated in AWS**. No current ALB endpoint, healthy ECS task, Jenkins release, CodeDeploy deployment or rollback result is claimed.

The intended default path is Jenkins → ECR → ECS Fargate behind an ALB → RDS. The optional path packages the backend for S3 → CodeDeploy → an existing EC2 host. DNS/HTTPS is optional in the architecture, but its current input wiring needs correction before use.

The [ECS runbook](docs/runbooks/deployment.md) and [EC2/CodeDeploy guide](docs/runbooks/production-ec2-codedeploy.md) describe intended procedures. Use the [dated audit](docs/current-state-audit-2026-09-14.md) for their current validation limits.

## Remaining

1. Repair the frontend package lock: `react-router-dom` is declared but missing from the lockfile. Verify a clean install, frontend test and production build.
2. Add a required PostgreSQL integration gate and publish test results tied to the tested commit. Current Jenkins definitions do not configure `TEST_DATABASE_URL`; the root pipeline also skips testing when `DEPLOY=false`.
3. Make infrastructure execution reproducible: supply environment-specific state keys and variables. Local `infra/environments/*.tfvars` files are ignored and absent from GitHub. Correct the HTTPS/DNS dependency and retire the stale nested Jenkinsfile.
4. Add deployment migration orchestration. Reconcile legacy data, back up the database, and coordinate writer cutover as documented in the ADT contract.
5. Verify release identity and promotion: immutable image/artifact references, images present in the target environment, clear Terraform/Jenkins ownership, and an actual post-deployment ADT create/resolve/retry check. `/health` alone can return 200 when the database is not configured.
6. Capture current AWS evidence before promoting any infrastructure claim: commit, Jenkins build, task definition or deployment ID, image digest or S3 version, endpoint results and rollback evidence.
7. Add authentication/RBAC, operational alarms and dashboards, recovery/restore verification and OpenAPI documentation. Blue/green deployment remains unimplemented.

For local development, the Compose definition exposes frontend port 3000, backend port 8080 and PostgreSQL port 5432:

```bash
docker compose up --build
```

Database migrations are a separate explicit step; Compose does not run them automatically. Configure `DATABASE_URL` and `DB_SSL=false` for the local database, then run `npm run migrate` from `apps/backend`. The frontend clean-install issue above remains unresolved in this audited revision.

Built by **Malcolm Sesay** · [LinkedIn](https://www.linkedin.com/in/malcolmsesay/)
