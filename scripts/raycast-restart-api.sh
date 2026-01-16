#!/usr/bin/env bash
# @raycast.schemaVersion 1
# @raycast.title Restart NPID API
# @raycast.mode terminal
# @raycast.packageName NPID Tools
# @raycast.description Kill any process on port 8000 and restart the FastAPI server.
# @raycast.icon 🔁

set -euo pipefail

PORT=8000
PROJECT_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
API_DIR="${PROJECT_ROOT}/npid-api-layer"
PYTHON_BIN="${PROJECT_ROOT}/.venv/bin/python"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Python not found at ${PYTHON_BIN}"
  exit 1
fi

PID="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t || true)"
if [[ -n "${PID}" ]]; then
  kill -9 "${PID}"
fi

cd "${API_DIR}"
exec "${PYTHON_BIN}" -m uvicorn main:app --reload --port "${PORT}"
