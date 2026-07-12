#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/healthcare-encounter-platform"
BACKEND_DIR="${APP_DIR}/apps/backend"
UNIT_SOURCE="${APP_DIR}/deployment/systemd/healthcare-encounter-api.service"
UNIT_TARGET="/etc/systemd/system/healthcare-encounter-api.service"

id encounter-app >/dev/null 2>&1 || useradd --system --home-dir "${APP_DIR}" --shell /sbin/nologin encounter-app
command -v node >/dev/null || { echo "Node.js is not installed" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is not installed" >&2; exit 1; }
[[ -f "${BACKEND_DIR}/package-lock.json" ]] || { echo "Backend lockfile not found" >&2; exit 1; }
[[ -f "${UNIT_SOURCE}" ]] || { echo "systemd unit not found" >&2; exit 1; }

install -o root -g root -m 0644 "${UNIT_SOURCE}" "${UNIT_TARGET}"
install -d -o root -g encounter-app -m 0750 /etc/healthcare-encounter-platform
touch /etc/healthcare-encounter-platform/runtime.env
chown root:encounter-app /etc/healthcare-encounter-platform/runtime.env
chmod 0640 /etc/healthcare-encounter-platform/runtime.env

chown -R encounter-app:encounter-app "${APP_DIR}"
sudo -u encounter-app npm --prefix "${BACKEND_DIR}" ci --omit=dev --ignore-scripts
systemctl daemon-reload
