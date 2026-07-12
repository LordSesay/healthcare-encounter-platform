#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/health}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-12}"
WAIT_SECONDS="${WAIT_SECONDS:-5}"

for attempt in $(seq 1 "${MAX_ATTEMPTS}"); do
  echo "Health-check attempt ${attempt}/${MAX_ATTEMPTS}: ${HEALTH_URL}"
  if curl --fail --silent --show-error --max-time 5 "${HEALTH_URL}" >/dev/null; then
    echo "Application health check passed."
    exit 0
  fi
  sleep "${WAIT_SECONDS}"
done

echo "Application failed health validation." >&2
systemctl status healthcare-encounter-api.service --no-pager || true
journalctl -u healthcare-encounter-api.service --no-pager -n 100 || true
exit 1
