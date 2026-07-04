#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="${RAYCAST_LOG_DIR:-${HOME}/raycast_logs}/ended-meeting-outcome-watch"
LOCK_DIR="/tmp/prospect-pipeline-ended-meeting-outcome-watch-wrapper.lock"

if [[ -n "${NODE_BIN_DIR:-}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi
export TZ="${TZ:-America/New_York}"
export API_BASE="${API_BASE:-http://127.0.0.1:8000/api/v1}"
export WINDOW_DAYS="${WINDOW_DAYS:-7}"
export LIMIT="${LIMIT:-50}"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/watch-$(date +%Y-%m-%d).log"
exec >>"${LOG_FILE}" 2>&1

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "[$(timestamp)] ended meeting watcher already running; skipping"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

cd "${PROJECT_ROOT}"

echo "[$(timestamp)] ended meeting outcome watch start"

if ! API_TIMEOUT_SECONDS=10 "${PROJECT_ROOT}/scripts/wait-for-api.sh"; then
  echo "[$(timestamp)] local API unavailable; skipping ended meeting outcome watch"
  exit 0
fi

npm run watch:ended-meeting-outcomes -- --write

echo "[$(timestamp)] ended meeting outcome watch complete"
