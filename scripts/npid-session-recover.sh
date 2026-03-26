#!/usr/bin/env bash

set -euo pipefail

WORKSPACE_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
API_BASE="${API_BASE:-http://127.0.0.1:8000}"
PYTHON_BIN="$WORKSPACE_ROOT/npid-api-layer/venv/bin/python"
CLIENT_SCRIPT="$WORKSPACE_ROOT/src/python/npid_api_client.py"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing Python interpreter: $PYTHON_BIN" >&2
  exit 1
fi

echo "Refreshing Prospect ID saved session..."
"$PYTHON_BIN" "$CLIENT_SCRIPT" login "{}"

echo "Reloading FastAPI session managers..."
curl -fsS -X POST "${API_BASE}/auth/reload" >/dev/null

echo ""
"$WORKSPACE_ROOT/scripts/npid-auth-status.sh"
