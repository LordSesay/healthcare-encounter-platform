"# Healthcare Encounter ID Source-of-Truth Platform

A React, Node.js/Express and PostgreSQL prototype for generating, resolving and tracking canonical encounter identifiers across simulated hospital systems. Examples use synthetic patient and visit data.

**Status checked October 28, 2026** (branch `audit/2026-10-28-deploy-readiness`, uncommitted). Backend: 85/85 tests pass locally against PostgreSQL 15. Frontend: 2/2 pass, and clean install and build work. Deploy blockers from the [October audit](docs/current-state-audit-2026-10-28.md) are fixed in source. Current AWS deployment status is **unverified**: no AWS cycle has run yet. See the [cycle runbook](docs/runbooks/aws-cycle.md).

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

See the [normalized ADT contract](docs/normalized-adt.md) for required fields, lifecycle rules, response semantics and migration procedures. All `/api` routes require a verified Cognito machine-to-machine token ([HEP-SEC-001](docs/security/HEP-SEC-001-M2M.md)). Terraform provisions the user pool and the integration-engine client. `source_system` and `facility_id` remain caller asserted.

Infrastructure code defines VPC/subnets/NAT, security groups, ECR, ALB, ECS Fargate, RDS PostgreSQL, IAM, Secrets Manager/KMS, CloudWatch Logs and CPU/memory autoscaling. Route 53/ACM and EC2/CodeDeploy are optional implementations.

The root `Jenkinsfile` implements the ECS delivery path: tests, immutable SHA-tagged images, an in-VPC migration task, rollout and an authenticated ADT smoke test. `Jenkinsfile.infra` implements Terraform plan, approval, then apply or destroy. `scripts/aws-cycle.sh` runs a complete deploy → verify → evidence → teardown cycle for a disposable environment ([runbook](docs/runbooks/aws-cycle.md)).

## Tested

These are **local results on the October 28 working tree** (not GitHub CI). Raw output is in [`docs/evidence/local-2026-10-28/`](docs/evidence/local-2026-10-28/).

| Scope | Cases | October 28 result |
| --- | ---: | --- |
| Backend unit (validation, repository, M2M auth, DB TLS config) | 67 | Passed |
| Backend PostgreSQL integration | 18 | Passed against disposable PostgreSQL 15 |
| Frontend (dashboard, demo adapter) | 2 | Passed after clean `npm ci` |
| Total in source | 87 | 87 passed locally |

The backend suite also passed with application and database timezones set to `America/New_York`. Repeated runs do not increase the unique test count. Coverage includes concurrent delivery, retry identity, lifecycle rules, rollback, HTTP responses, migration and timestamp behavior.

Backend `npm test -- --runInBand` without `TEST_DATABASE_URL` passes 67 tests and **skips 18**. To require database coverage, configure a disposable PostgreSQL database and run:

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

The intended default path is Jenkins → ECR → ECS Fargate behind an ALB → RDS. The EC2/CodeDeploy pipeline and scripts were removed. Its opt-in Terraform module (`enable_ec2_codedeploy`) remains but has no release pipeline. DNS/HTTPS is optional in the architecture, but its current input wiring needs correction before use.

The [ECS runbook](docs/runbooks/deployment.md) and [AWS cycle runbook](docs/runbooks/aws-cycle.md) describe the procedures. Use the [October audit](docs/current-state-audit-2026-10-28.md) for their current validation limits.

## Remaining

1. **Run the AWS cycle** (`scripts/aws-cycle.sh --env dev`) and commit its evidence folder. Until then, no AWS component is verified, including the Cognito token path, RDS TLS and the in-VPC migration task.
2. Run `Jenkinsfile` and `Jenkinsfile.infra` on a real Jenkins. They are parse-checked only. Grant the Jenkins identity `ecs:RunTask`, `iam:PassRole` and read access to the M2M secret.
3. Staging/prod tfvars set `enable_https = true` without `enable_dns`; supply a real domain before using them.
4. Promotion across environments: `PROMOTE_TAG` only redeploys a tag that already exists in the target environment's repositories. There is no cross-repository copy.
5. Production migrations still need backup, legacy-data reconciliation and writer cutover, as documented in the ADT contract.
6. Add operational alarms and dashboards, restore verification and OpenAPI documentation. Blue/green deployment remains unimplemented.

For local development, Compose binds the demo frontend (3000), the backend (8080) and PostgreSQL (5432) to `127.0.0.1`:

```bash
docker compose up --build
docker exec encounter-backend node models/migrate.js
```

The frontend is the synthetic in-memory demo (HEP-SEC-001). The backend starts with placeholder Cognito settings, so `/health` works but every `/api` call returns 401. To call `/api` locally, put real `AUTH_COGNITO_USER_POOL_ID`, `AUTH_M2M_CLIENT_IDS`, `AUTH_READ_SCOPE` and `AUTH_WRITE_SCOPE` values in `.env`.

Built by **Malcolm Sesay** · [LinkedIn](https://www.linkedin.com/in/malcolmsesay/)
