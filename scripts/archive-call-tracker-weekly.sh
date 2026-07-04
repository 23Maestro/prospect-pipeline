#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="${RAYCAST_LOG_DIR:-${HOME}/raycast_logs}/call-tracker-weekly-archive"
LOCK_DIR="/tmp/prospect-pipeline-call-tracker-weekly-archive.lock"

if [[ -n "${NODE_BIN_DIR:-}" ]]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
fi
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
npm run archive:call-tracker-week
echo "[$(timestamp)] weekly archive complete"
