#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/healthcare-encounter-platform"
BACKEND_DIR="${APP_DIR}/apps/backend"

if [[ ! -d "${BACKEND_DIR}" ]]; then
  echo "Backend directory not found: ${BACKEND_DIR}"
  exit 1
fi

chown -R encounter-app:encounter-app "${APP_DIR}"

cd "${BACKEND_DIR}"

sudo -u encounter-app npm ci --omit=dev