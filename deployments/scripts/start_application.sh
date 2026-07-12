#!/usr/bin/env bash
set -euo pipefail

systemctl daemon-reload
systemctl enable healthcare-encounter-api
systemctl restart healthcare-encounter-api