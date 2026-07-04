#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_DIR="${PROJECT_ROOT}/npid-api-layer"
API_PORT="${API_PORT:-8000}"
API_HOST="${API_HOST:-127.0.0.1}"

load_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    eval "$("${API_DIR}/venv/bin/python" - <<'PY' "${env_file}"
from dotenv import dotenv_values
import shlex
import sys

for key, value in dotenv_values(sys.argv[1]).items():
    if value is not None:
        print(f"export {key}={shlex.quote(value)}")
PY
)"
  fi
}

cd "${API_DIR}"

if [[ ! -x "venv/bin/python" ]]; then
  echo "Missing FastAPI venv at ${API_DIR}/venv/bin/python"
  exit 1
fi

load_env_file "${PROJECT_ROOT}/.env"
load_env_file "${API_DIR}/.env"

source venv/bin/activate

uvicorn_args=(main:app --host "${API_HOST}" --port "${API_PORT}")
if [[ "${API_RELOAD:-1}" != "0" ]]; then
  uvicorn_args+=(--reload)
fi

exec python -m uvicorn "${uvicorn_args[@]}"
