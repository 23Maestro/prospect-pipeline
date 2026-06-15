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

echo "[$(timestamp)] drift wrapper start"

RUN_CURRENT_PIPELINE_REPAIR="${RUN_CURRENT_PIPELINE_REPAIR:-0}"
RUN_COMMISSION_SYNC="${RUN_COMMISSION_SYNC:-0}"

if [[ "${RUN_CURRENT_PIPELINE_REPAIR}" != "1" && "${RUN_COMMISSION_SYNC}" != "1" ]]; then
  echo "[$(timestamp)] no scheduled Supabase writers enabled"
  echo "[$(timestamp)] action-time Scout Prep writes own lifecycle, meeting, and pending-client movement"
  echo "[$(timestamp)] drift wrapper complete"
  exit 0
fi

if ! API_TIMEOUT_SECONDS=10 "${PROJECT_ROOT}/scripts/wait-for-api.sh"; then
  echo "[$(timestamp)] local API unavailable; asking ${API_OWNER_LABEL} to restore Overmind-owned API"
  launchctl kickstart -k "gui/$(id -u)/${API_OWNER_LABEL}"
  API_TIMEOUT_SECONDS=45 "${PROJECT_ROOT}/scripts/wait-for-api.sh"
fi

# Front-facing Scout Prep movement is written at the moment of the user action.
# This repair path is explicit only so a scheduler cannot become lifecycle truth again.
if [[ "${RUN_CURRENT_PIPELINE_REPAIR}" == "1" ]]; then
  echo "[$(timestamp)] explicit current-pipeline repair enabled"
  npm run sync:current-pipeline-supabase
else
  echo "[$(timestamp)] current-pipeline repair skipped"
fi

if [[ "${RUN_COMMISSION_SYNC}" == "1" ]]; then
  echo "[$(timestamp)] explicit commission sync enabled"
  npm run sync:commissions-supabase
else
  echo "[$(timestamp)] commission sync skipped"
fi

echo "[$(timestamp)] drift wrapper complete"
