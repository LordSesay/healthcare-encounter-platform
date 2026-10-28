# Code audit and functionality verification — 2026-10-28

## Scope

Working tree of `main` at `b70febb` **plus uncommitted changes** (M2M auth, frontend demo mode, ECR/ECS/secrets edits, Jenkins bootstrap, CodeDeploy removal). Nothing in this audit is a GitHub or AWS result. Raw evidence is in [`docs/evidence/local-2026-10-28/`](evidence/local-2026-10-28/).

Toolchain: Windows 10, Node 24.14.0, Docker 29.8.2 / Compose 5.6.0, Terraform 1.13.3, jq 1.8.2. The local AWS CLI credentials were rejected (`InvalidClientTokenId`), so **no AWS call, plan, apply or deployment was made**.

## Verified results

| Check | Result |
| --- | --- |
| Backend `npm ci` + unit tests (no DB) | 63 passed, 18 skipped |
| Backend `npm run test:integration` (disposable PostgreSQL 15, `TZ=UTC`) | **81/81 passed** |
| Same, `TZ`/`TEST_DB_TIMEZONE=America/New_York` | 81/81 passed |
| Frontend `npm ci` (clean) | **Passed** — September lockfile blocker is resolved |
| Frontend tests | 1 passed, **1 failed** (`App.test.js`: `toBeInTheDocument is not a function`; no `src/setupTests.js`) |
| Frontend `npm run build` (`CI=true`) | Passed |
| `terraform init -backend=false` + `validate` | Passed |
| `terraform fmt -check -recursive` | **Failed** — `modules/ecs/main.tf` (alignment only) |
| Groovy parse of `Jenkinsfile.infra` | Passed |
| Groovy parse of `Jenkinsfile` | **Failed** — compile error, line 269 |
| `docker compose up --build` as documented | **Backend exits 1** — `AUTH_COGNITO_USER_POOL_ID is required` |
| Compose + placeholder `AUTH_*` values | Backend up; 3 migrations applied; `/health` 200 |
| SEC-01 no token → `/api/encounters` | 401 `Service access token required` |
| SEC-02 forged JWT | 401 `invalid_token` |
| SEC-06 unauthenticated write | 401; `encounters` row count stayed 0 |
| SEC-07 missing auth config | Startup failure (above) |
| Frontend container `/`, `/encounters` | 200 (SPA fallback works) |
| Local teardown | 0 containers / volumes / networks left |

Not verified: the positive authenticated path against a real Cognito token (SEC-02 positive, SEC-10). Unit tests cover it with an injected verifier only.

## Findings — blockers for an AWS deploy

| # | Finding | Evidence |
| --- | --- | --- |
| B1 | `Jenkinsfile` does not compile. The smoke-test `sh """…"""` contains `$(date …)`, which is an illegal GString dollar expression. Jenkins rejects the whole pipeline before any stage runs. | `jenkinsfile-parse.log` |
| B2 | Backend crashes on startup in ECS. `app.js` builds M2M auth at module load and requires four `AUTH_*` variables. The ECS task definition sets none, and Terraform creates no Cognito user pool, resource server or app client. `docker-compose.yml` has the same gap. | `backend-startup-noauth.log` |
| B3 | Even with B1/B2 fixed, the smoke test posts `/api/encounters/from-adt` without a bearer token, so it gets 401. Jenkins has no client-credentials secret or token-acquisition step. | Source + SEC-01 result |
| B4 | RDS TLS will most likely fail. `models/db.js` defaults to `ssl: { rejectUnauthorized: true }` with no CA, and Node's trust store doesn't include the Amazon RDS CAs. `/health` would then return 503, the ALB would mark targets unhealthy, and the circuit breaker would roll back. Integration tests use their own `ssl:false` pools, so they never exercise this. | Static analysis — confirm on first deploy |
| B5 | Nothing runs migrations. No pipeline, ECS or Terraform step calls `npm run migrate`. `/health` returns 200 on an empty schema (verified), so a deploy can look healthy while every ADT call fails. RDS is private, and the `rds_from_jenkins` rule allows a `172.31.x` address from a different VPC with no peering, so checklist Phase 3 can't run from Jenkins as written. | `local-http-verification.log` |
| B6 | ECR repositories are now `IMMUTABLE`, but every build pushes `:latest`. The second build fails at `docker push`. Terraform's task definition also references `:latest`. | Source |
| B7 | `Jenkinsfile.infra` passes `-var-file=environments/<env>.tfvars`, but `*.tfvars` is gitignored and not committed, so a Jenkins checkout has no file and `plan` fails. Captured outputs are also never archived. | `git check-ignore` |

## Findings — teardown blockers

| # | Finding |
| --- | --- |
| T1 | `force_delete = false` on ECR means `terraform destroy` fails while images exist. |
| T2 | The Secrets Manager `recovery_window_in_days = 7` means re-applying the same environment within 7 days of a destroy fails, because the secret name is still pending deletion. This breaks a repeatable deploy/teardown cycle. |
| T3 | There's no teardown pipeline or procedure for the application infrastructure. The only teardown doc covers the Jenkins container. |

## Other findings

- **Terraform/Jenkins ownership:** `aws_ecs_service` has no `lifecycle { ignore_changes = [task_definition, desired_count] }`, so a later `terraform apply` reverts the Jenkins-deployed image and the autoscaled count.
- **HTTPS wiring (unchanged since September):** the staging/prod tfvars set `enable_https = true` without `enable_dns`, so `module.dns[0]` is invalid. Dev isn't affected.
- **Frontend vs. M2M:** a non-demo build has no token, so every `/api` call from the deployed UI returns 401. This is consistent with HEP-SEC-001 (UI is demo-only), but the ECS module still deploys the UI as if it were a client. Its runtime `REACT_APP_API_URL` has no effect on a static bundle.
- **Frontend image is not reproducible:** `.dockerignore` excludes `package-lock.json` and the Dockerfile runs `npm install`.
- **End-of-life runtime:** backend, frontend and Jenkins images use Node 20, which reached end of life on 2026-04-30.
- **Dependencies:** backend has `body-parser` <1.20.9 (high, DoS; `npm audit fix`) and `uuid` (moderate). The Jenkins audit gate is `--audit-level=critical || true`, which never fails the build.
- **Config:** the `config.js` production guard checks `NODE_ENV === 'production'`, but ECS sets `NODE_ENV` to `dev`/`staging`/`prod`, so the guard never fires.
- **Jenkins:** `post { always { docker system prune -af } }` prunes the whole agent. `PROMOTE_TAG` assumes the image already exists in the target environment's repository. The Jenkins image pins Terraform 1.10.5, while local state was written by 1.13.3.
- **Docs drift:** the README still reports 53 tests, a blocked lockfile and `Jenkinsfile.codedeploy`, which is deleted in the working tree.
- **Local state:** `infra/terraform.tfstate` is empty (serial 144). The `.backup` is a pre-module April layout. Neither is evidence of live resources.

## What a verifiable deploy → evidence → teardown cycle needs

Fix B1–B7 and T1–T3. Then each run should do, in order:

1. **Preflight:** `sts get-caller-identity`, clean tree, record the commit SHA.
2. **Provision:** `terraform apply` with committed, non-secret dev inputs; save the outputs.
3. **Build and push:** tag images by git SHA (no `latest`) and record the digests.
4. **Migrate:** run a one-off ECS task (`npm run migrate`) inside the VPC and record `schema_migrations`.
5. **Deploy:** `update-service` + `wait services-stable`; record the task definition ARN.
6. **Smoke test:** `/health`, Cognito client-credentials token, ADT A01 create → resolve → identical retry (200, same ID) → no-token 401.
7. **Evidence:** write a manifest (SHA-256 of every artifact) tied to the commit.
8. **Teardown:** empty ECR, `terraform destroy`, then a post-teardown query by `Project`/`Environment` tags that returns zero resources.

## Remediation (same day, uncommitted on `audit/2026-10-28-deploy-readiness`)

Status key: **local** = verified on this workstation; **static** = parse, lint or validate only; **AWS** = needs `scripts/aws-cycle.sh`.

| # | Fix | Verified |
| --- | --- | --- |
| B1 | `Jenkinsfile` rewritten with single-quoted shell blocks; smoke logic moved to `cicd/smoke/smoke.sh`. Also fixed: derived variables were declared in `environment {}`, so `env.X =` overrides were silently ignored and the account auto-detect never applied. | static (Groovy parse OK) |
| B2 | New `infra/modules/cognito`: user pool, `encounters/read`/`encounters/write` resource server, client-credentials-only app client, hosted domain, client secret in Secrets Manager. ECS gets the four `AUTH_*` values; Compose gets fail-closed placeholders. | local (Compose backend starts; 401s) + static (`terraform validate`) |
| B3 | Smoke test fetches a client-credentials token from the M2M secret. Credentials and token go through curl's stdin config, never argv or disk. | local (unauthenticated checks) · AWS (token path) |
| B4 | `db.js` reads `DB_SSL_CA_FILE`, keeping `rejectUnauthorized: true`. The backend image bakes in the checksum-pinned RDS global bundle and runs as `node`. | local (114 CAs readable; TLS enforced) · AWS (RDS handshake) |
| B5 | `cicd/jenkins/ecs/run-migration.sh` runs migrations as a one-off Fargate task, used by both Jenkins and the cycle script. The smoke test's ADT create/resolve proves the schema exists. | static · AWS |
| B6 | Tags are `<sha12>-b<build>` (Jenkins) or `<sha12>-<stamp>` (cycle); `latest` is never pushed. Terraform takes `image_tag`, with validation that rejects `latest`. The ECS service ignores later task-definition and desired-count changes. | local (validation rejects `latest`) |
| B7 | Non-secret `infra/environments/*.tfvars` are un-ignored. `Jenkinsfile.infra` gains `ACTION=apply/destroy` (prod destroy refused), `-input=false`, a saved-plan transcript and archived outputs. | static |
| T1 | ECR `force_delete` is true for non-prod. | static · AWS |
| T2 | For non-prod, secrets use `recovery_window_in_days = 0` and KMS uses a 7-day deletion window. Prod keeps 7 and 30 days. | static · AWS |
| T3 | `scripts/aws-cycle.sh` adds automatic teardown on failure, a `--teardown-only` mode and post-teardown verification. See the [runbook](runbooks/aws-cycle.md). | local (prod guard) · AWS |

Also fixed: frontend `setupTests.js` (2/2 tests pass), frontend image installs with `npm ci` from the lockfile, Node 24 in all images, `body-parser` 1.20.9 (high-severity audit gate now passes), Jenkins image adds `docker-buildx-plugin`, agent-wide `docker system prune` replaced with removal of this build's images, `NODE_ENV=production` in ECS, credentials URL-encoded in `DATABASE_URL`, `terraform fmt` clean, CRLF pinned out of scripts via `.gitattributes`, and stale CodeDeploy references removed from docs.

Re-verification after fixes: backend 85/85 (UTC and America/New_York), frontend 2/2, `terraform validate`/`fmt` clean, both Jenkinsfiles parse, shellcheck clean on all five scripts. The Compose stack was built, migrated and smoke-tested (unauthenticated checks), then torn down. Evidence is in [`evidence/local-2026-10-28/post-fix/`](evidence/local-2026-10-28/post-fix/). That local run also caught one regression in the fix itself: `ADD --chmod` left `/app/certs` untraversable. It was fixed and re-verified.

Still unverified: everything marked **AWS**. The cycle script was not run because the local AWS credentials are invalid.
