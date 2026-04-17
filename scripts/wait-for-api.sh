#!/usr/bin/env bash

set -euo pipefail

API_PORT="${API_PORT:-8000}"
API_HOST="${API_HOST:-127.0.0.1}"
API_TIMEOUT_SECONDS="${API_TIMEOUT_SECONDS:-20}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

for ((i=1; i<=API_TIMEOUT_SECONDS; i++)); do
  if curl --silent --show-error --fail "${HEALTH_URL}" >/dev/null 2>&1; then
    echo "api healthy at ${HEALTH_URL}"
    exit 0
  fi
  sleep 1
done

echo "api did not become healthy within ${API_TIMEOUT_SECONDS}s: ${HEALTH_URL}"
exit 1
