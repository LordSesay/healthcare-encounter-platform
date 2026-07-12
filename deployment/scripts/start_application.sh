#!/usr/bin/env bash
set -euo pipefail

systemctl daemon-reload
systemctl enable healthcare-encounter-api.service
systemctl restart healthcare-encounter-api.service
