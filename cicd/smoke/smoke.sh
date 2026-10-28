#!/bin/bash
# Post-deploy functional verification shared by Jenkins and scripts/aws-cycle.sh.
# Proves more than /health: auth boundary, M2M token, ADT create, idempotent
# retry and scoped resolve against the live stack. Writes evidence JSON only;
# client secrets and access tokens are never echoed or written to disk.
#
# Required: BASE_URL, AWS_REGION, M2M_SECRET_ID (unless SMOKE_UNAUTH_ONLY=1)
# Optional: EVIDENCE_DIR (default ./smoke-evidence), RUN_ID
set -euo pipefail

: "${BASE_URL:?BASE_URL is required, e.g. http://my-alb.us-east-1.elb.amazonaws.com}"
EVIDENCE_DIR="${EVIDENCE_DIR:-smoke-evidence}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
UNAUTH_ONLY="${SMOKE_UNAUTH_ONLY:-0}"
mkdir -p "$EVIDENCE_DIR"

declare -a RESULTS=()
record() { RESULTS+=("$(jq -cn --arg c "$1" --arg r "$2" --arg d "$3" '{check:$c,result:$r,detail:$d}')"); }
pass() { record "$1" pass "$2"; echo "PASS  $1 — $2"; }
fail() {
  record "$1" fail "$2"
  echo "FAIL  $1 — $2" >&2
  write_summary fail
  exit 1
}
write_summary() {
  local joined
  joined=$(IFS=,; echo "${RESULTS[*]:-}")
  jq -n --arg status "$1" --arg run "$RUN_ID" --arg url "$BASE_URL" --arg unauth "$UNAUTH_ONLY" \
    --argjson checks "[$joined]" \
    '{status:$status, run_id:$run, base_url:$url, unauthenticated_checks_only:($unauth=="1"), checks:$checks, finished_at:(now|todate)}' \
    > "$EVIDENCE_DIR/smoke-summary.json"
}

# request METHOD PATH OUTFILE [curl args...]; prints the HTTP status.
request() {
  local method=$1 path=$2 out=$3; shift 3
  curl -sS --max-time 15 -o "$EVIDENCE_DIR/$out" -w '%{http_code}' -X "$method" "$BASE_URL$path" "$@" || true
}
# Same, with the bearer token passed through curl's stdin config, not argv.
authed() {
  local method=$1 path=$2 out=$3; shift 3
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" |
    curl -sS --max-time 15 -K - -o "$EVIDENCE_DIR/$out" -w '%{http_code}' -X "$method" "$BASE_URL$path" "$@" || true
}

# 1. Health with a live database (targets may still be registering).
code=000
for _ in $(seq 1 24); do
  code=$(request GET /health health.json)
  [ "$code" = 200 ] && break
  sleep 5
done
[ "$code" = 200 ] || fail health "/health returned HTTP $code"
jq -e '.database == "connected"' "$EVIDENCE_DIR/health.json" >/dev/null || fail health "database not connected"
pass health "HTTP 200, database connected, version $(jq -r .version "$EVIDENCE_DIR/health.json")"

# 2. Auth boundary (HEP-SEC-001 SEC-01/SEC-02).
code=$(request GET /api/encounters unauth-list.json)
[ "$code" = 401 ] || fail auth_required "no token returned HTTP $code, expected 401"
pass auth_required "no token -> 401"
code=$(request GET /api/encounters forged-token.json -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzbW9rZSJ9.c2ln')
[ "$code" = 401 ] || fail forged_token "forged token returned HTTP $code, expected 401"
pass forged_token "forged token -> 401"

if [ "$UNAUTH_ONLY" = 1 ]; then
  echo "SMOKE_UNAUTH_ONLY=1: authenticated ADT checks not run"
  write_summary pass-unauthenticated-only
  exit 0
fi

# 3. Machine token via client_credentials. Credentials go through stdin config.
: "${M2M_SECRET_ID:?M2M_SECRET_ID is required}" "${AWS_REGION:?AWS_REGION is required}"
secret=$(aws secretsmanager get-secret-value --secret-id "$M2M_SECRET_ID" --region "$AWS_REGION" --query SecretString --output text)
token_url=$(jq -r .token_url <<<"$secret")
TOKEN=$(jq -r '"user = \"\(.client_id):\(.client_secret)\""' <<<"$secret" |
  curl -sS --max-time 15 -K - -X POST "$token_url" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode grant_type=client_credentials \
    --data-urlencode "scope=$(jq -r .scope <<<"$secret")" | jq -r '.access_token // empty')
unset secret
[ -n "$TOKEN" ] || fail m2m_token "could not obtain access token from Cognito"
pass m2m_token "client_credentials token issued"

# 4. ADT A01 create -> identical retry -> scoped resolve -> read.
visit="SMOKE-VISIT-$RUN_ID"
jq -n --arg e "smoke-$RUN_ID-a01" --arg v "$visit" --arg m "SMOKE-MRN-$RUN_ID" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{event_type:"ADT_A01", event_id:$e, source_system:"smoke-test", occurred_at:$t,
    patient:{mrn:$m, assigning_authority:"smoke-test"},
    visit:{visit_id:$v, facility_id:"smoke-facility", visit_type:"routine_checkup"}}' \
  > "$EVIDENCE_DIR/adt-a01-request.json"

code=$(authed POST /api/encounters/from-adt adt-a01-create.json -H 'Content-Type: application/json' --data-binary "@$EVIDENCE_DIR/adt-a01-request.json")
[ "$code" = 201 ] || fail adt_create "A01 returned HTTP $code, expected 201: $(head -c 300 "$EVIDENCE_DIR/adt-a01-create.json")"
encounter_id=$(jq -r '.encounter_id // empty' "$EVIDENCE_DIR/adt-a01-create.json")
[ -n "$encounter_id" ] || fail adt_create "no encounter_id in response"
pass adt_create "A01 -> 201 $encounter_id"

code=$(authed POST /api/encounters/from-adt adt-a01-retry.json -H 'Content-Type: application/json' --data-binary "@$EVIDENCE_DIR/adt-a01-request.json")
[ "$code" = 200 ] || fail adt_retry "identical retry returned HTTP $code, expected 200"
[ "$(jq -r .encounter_id "$EVIDENCE_DIR/adt-a01-retry.json")" = "$encounter_id" ] || fail adt_retry "retry returned a different encounter_id"
pass adt_retry "identical retry -> 200 same $encounter_id"

code=$(authed GET "/api/encounters/resolve?source_system=smoke-test&facility_id=smoke-facility&csn=$visit" adt-resolve.json)
[ "$code" = 200 ] || fail adt_resolve "resolve returned HTTP $code"
[ "$(jq -r .encounter_id "$EVIDENCE_DIR/adt-resolve.json")" = "$encounter_id" ] || fail adt_resolve "resolve returned a different encounter_id"
pass adt_resolve "scoped resolve -> $encounter_id"

code=$(authed GET "/api/encounters/$encounter_id" encounter-detail.json)
[ "$code" = 200 ] || fail encounter_read "detail returned HTTP $code"
pass encounter_read "detail -> status $(jq -r .status "$EVIDENCE_DIR/encounter-detail.json")"

unset TOKEN
write_summary pass
echo "Smoke test passed: $encounter_id"
