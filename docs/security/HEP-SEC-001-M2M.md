# HEP-SEC-001 — machine-to-machine authentication (controlled change)

**Decision:** Machine-only authentication in the first operational phase. The existing React app is a **loopback-bound, synthetic-only fixture demo** and is **not** a client of the protected live API. No healthcare production data is approved.

## Business request / expected state

A simulated EHR integration engine needs to submit normalized ADT A01/A02/A03/A04/A08 messages to the Encounter API and retrieve canonical encounter identities. Currently, `/api` routes are unauthenticated. We need to verify **which service** is calling the API and **whether it may read or write** before allowing any business operation.

Acceptance requirements:

| ID | Condition | Evidence |
|---|---|---|
| SEC-01 | All `/api/*` endpoints deny missing bearer credentials | HTTP 401; no route executed |
| SEC-02 | Token verifier checks Cognito signature, issuer, expiration, client ID and `token_use=access` | Real signed-token negative and positive checks, not mocks alone |
| SEC-03 | Only allowlisted Cognito **machine** app clients are accepted | Unapproved client returns 401 |
| SEC-04 | `encounters/read` only authorizes GET/HEAD, not POST/PATCH/DELETE | Read response 200, denied mutation 403 |
| SEC-05 | `encounters/write` authorizes write verbs and GET `/api/id` | Authorized request reaches route handler |
| SEC-06 | Authentication fails before database writes; never log token/secret | Rejected-write DB row count unchanged; sanitized logs |
| SEC-07 | Missing auth configuration stops startup; no unauthenticated bypass | Startup failure output |
| SEC-08 | `/health` allowed as unauthenticated ALB probe, not as proof of DB persistence | HTTP 200/503 as appropriate; separate functional check |
| SEC-09 | Dashboard demo runs with synthetic in-memory data on loopback, without API/token/DB | Network tab: no API requests; localhost binding |
| SEC-10 | Legacy ADT create/resolve/idempotent retry works for authorized service | PostgreSQL integration evidence with signed token |

## Trust model

```text
Synthetic integration engine (server-side client ID + secret)
  -> Cognito OAuth /oauth2/token (client_credentials; TLS)
  -> short-lived access token signed by Cognito
  -> Authorization: Bearer <token> (HTTPS)
  -> ALB HTTPS -> Express /api middleware
  -> verify signature, issuer, expiry, token use and allowlisted app client
  -> verify *exact* required scope
  -> existing ADT services/repositories -> PostgreSQL

Local browser -> 127.0.0.1:3000 -> stand-alone React DEMO fixture adapter
  [no backend, no database, no real token, no actual hospital data]
```

**Identity assurance:** `X-Source-System`, `source_system`, and `facility_id` originate with the HTTP caller. They are NOT authenticated/authorized source identities. `req.auth.clientId` is the trusted M2M principal. Scopes are **not** facility or tenant isolation. Multiple independent health facilities, user access, and real PHI require a separate authorization design and verification. Do not infer facility access from a self-asserted request field.

**Health and CORS:** The existing `/health` endpoint remains an unauthenticated probe, but currently exposes metadata and uses a separate PG pool. CORS wildcard and DB TLS verification are independent open security findings. This patch does not fix them; do not publicly expose the deployment.

## Cognito setup (infrastructure work intentionally NOT automated by this patch)

1. Configure a Cognito user pool and resource server identifier `encounters` with custom scopes `read` and `write`. Actual returned scope values are `encounters/read` and `encounters/write`.
2. Create one **confidential app client dedicated exclusively to the Client Credentials grant**, with a client secret and only the required custom scopes. **Do not enable user-login grants on this same app client**.
3. Store client credentials in AWS Secrets Manager or equivalent *server-side* secret storage. Never commit them, send them to browsers, or include them in React build arguments.
4. Give each separate integration service its own app client for revocation/audit. Configure only approved app client IDs via `AUTH_M2M_CLIENT_IDS`.
5. Set the four required backend **nonsecret** variables: `AUTH_COGNITO_USER_POOL_ID`, `AUTH_M2M_CLIENT_IDS`, `AUTH_READ_SCOPE`, `AUTH_WRITE_SCOPE`. Provide the appropriate IAM and network access for Cognito JWKS retrieval; no Cognito client secret is required by the verifying API.
6. Use HTTPS for API requests and token acquisition. JWKS fetching and cache refresh must be tested in target networking (private ECS subnets require outbound connectivity to Cognito JWKS endpoint).
7. The IAM role that operates the integration engine, **not the browser**, obtains the token using its client secret.

Example environment variable names (identifiers below are fake):

```env
AUTH_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXX
AUTH_M2M_CLIENT_IDS=example-client-id
AUTH_READ_SCOPE=encounters/read
AUTH_WRITE_SCOPE=encounters/write
```

**Important:** The verification library enforces validated signatures and standard token metadata; our policy additionally checks machine client allowlist, absence of human identity claims and exact scopes. The injected mock verifier exists *only in tests* and is not available as a startup bypass.

## Controlled deployment boundaries

- Keep `main` unchanged until the branch has been reviewed; source diff must be tied to commit SHA.
- Existing `docker-compose.yml` backend will now correctly fail without authentication configuration. Use the separate `docker-compose.demo.yml` for a stand-alone loopback frontend without backend or PostgreSQL.
- Do not send protected API credentials to the browser. Real API calls require authenticated service clients and cannot be made by the demo frontend.
- The demo supports in-memory create/update/void only; it never persists beyond reload. It displays a synthetic-data banner and `demo` health state.
- Existing CI and Terraform state hazards, DB TLS verification, secret-deletion settings, and frontend dependency lockfile still need dedicated remediation. No live AWS deployment claimed.

## Test evidence sequence (REQUEST -> EXPECTED -> CURRENT -> GAP -> CHANGE -> VERIFY -> PERSIST/SECURITY -> CLOSEOUT)

**Local source validation:**

```powershell
node --check apps/backend/app.js
node --check apps/backend/security/m2m.js
node apps/backend/security/m2m.smoke.js
npm install --package-lock-only --prefix apps/backend
npm ci --prefix apps/backend
npm test --prefix apps/backend -- --runInBand
```

`m2m.smoke.js` uses a mock verifier and is not evidence of cryptographic token verification. Do not increase historical unique test counts by adding a second execution of the same tests.

**Live signed-token and real persistence verification (later checkpoint):** Create a temporary *synthetic* Cognito pool + dedicated client with secrets stored server-side; configure the API against a **disposable** PostgreSQL database. Obtain a client-credentials token from the trusted authorization server; test:

1. No token -> `GET /api/encounters` **401**.
2. Wrong issuer, expired token, unknown app client, wrong token_use or corrupted signature -> **401** (revocation of issued JWTs may need short TTL or separate revocation strategy; Cognito JWT validation alone does not provide immediate revocation).
3. Real valid read-only token -> `GET /api/encounters` **200**, `POST /api/encounters/from-adt` **403**.
4. Valid write-scoped token -> synthetic `POST /api/encounters/from-adt` **201**; retry same event **200**, same encounter ID and unchanged history count.
5. Valid read-scoped token -> `GET /api/encounters/resolve` **200** and resolves the same ID.
6. Denied write -> database rows unchanged. Confirm identifier, event inbox, encounter and status history counts.
7. Repeat after process restart, then with an invalid secret/config; record API startup failure.
8. Demonstrate frontend at `http://127.0.0.1:3000` uses only synthetic records, has no access token in DevTools, and is served only on loopback.

**Release block:** This package does **not** establish facility-level or row-level authorization, production HTTPS enforcement, release pipeline integrity, schema migration gating, or post-deployment smoke testing. M2M auth must not be represented as overall production readiness.

## Evidence record template

```text
Ticket: HEP-SEC-001
Repository commit: ______
Environment: local / synthetic Cognito / disposable PostgreSQL
Expected: ______
Observed command and sanitized output: ______
Interpretation (what this proves): ______
Known gap / risk: ______
Decision: PASS / FAIL / BLOCKED
Next action: ______
```
