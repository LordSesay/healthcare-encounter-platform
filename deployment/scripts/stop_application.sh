#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="healthcare-encounter-api"

if systemctl list-unit-files "${SERVICE_NAME}.service" --no-legend | grep -q "${SERVICE_NAME}.service"; then
  systemctl stop "${SERVICE_NAME}" || true
fi
