#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
LOG_DIR="${RAYCAST_LOG_DIR:-/Users/singleton23/raycast_logs}/supabase-sync"
LOCK_DIR="/tmp/prospect-pipeline-supabase-sync.lock"
API_BASE="${API_BASE:-http://127.0.0.1:8000/api/v1}"
API_OWNER_LABEL="com.npid.fastapi"

export PATH="/Users/singleton23/.nvm/versions/node/v22.16.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ="${TZ:-America/New_York}"
export API_BASE
export CALL_TRACKER_OWNER="${CALL_TRACKER_OWNER:-Jerami Singleton}"

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/sync-$(date +%Y-%m-%d).log"
exec >>"${LOG_FILE}" 2>&1

timestamp() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "[$(timestamp)] sync already running; skipping"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

cd "${PROJECT_ROOT}"

echo "[$(timestamp)] sync start"

if ! API_TIMEOUT_SECONDS=10 "${PROJECT_ROOT}/scripts/wait-for-api.sh"; then
  echo "[$(timestamp)] local API unavailable; asking ${API_OWNER_LABEL} to restore Overmind-owned API"
  launchctl kickstart -k "gui/$(id -u)/${API_OWNER_LABEL}"
  API_TIMEOUT_SECONDS=45 "${PROJECT_ROOT}/scripts/wait-for-api.sh"
fi

npm run sync:current-pipeline-supabase
npm run sync:booked-meetings-supabase
npm run reconcile:current-sales-stages-supabase
node scripts/backsync-lifecycle-call-activity-events.mjs
npm run sync:commissions-supabase
npm run materialize:call-tracker-contract

echo "[$(timestamp)] sync complete"
