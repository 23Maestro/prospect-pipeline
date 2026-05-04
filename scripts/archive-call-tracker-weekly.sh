#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
LOG_DIR="${RAYCAST_LOG_DIR:-/Users/singleton23/raycast_logs}/call-tracker-weekly-archive"
LOCK_DIR="/tmp/prospect-pipeline-call-tracker-weekly-archive.lock"

export PATH="/Users/singleton23/.nvm/versions/node/v22.16.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ="${TZ:-America/New_York}"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/archive-$(date +%Y-%m-%d).log"
exec >>"${LOG_FILE}" 2>&1

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "[$(timestamp)] weekly archive already running; skipping"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

cd "${PROJECT_ROOT}"

echo "[$(timestamp)] weekly archive start"
npm run materialize:call-tracker-contract
npm run archive:call-tracker-week
echo "[$(timestamp)] weekly archive complete"
