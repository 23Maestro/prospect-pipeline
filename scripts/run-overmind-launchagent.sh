#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PROCFILE_PATH="${PROJECT_ROOT}/Procfile.dev"
SOCKET_PATH="${PROJECT_ROOT}/.overmind.sock"
API_PORT="${API_PORT:-8000}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

kill_process_tree() {
  local pid="$1"
  local child_pids
  child_pids="$(pgrep -P "${pid}" 2>/dev/null || true)"

  if [[ -n "${child_pids}" ]]; then
    while IFS= read -r child_pid; do
      [[ -n "${child_pid}" ]] && kill_process_tree "${child_pid}"
    done <<< "${child_pids}"
  fi

  kill -9 "${pid}" 2>/dev/null || true
}

clear_api_port() {
  local pids
  pids="$(lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN -t || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill_process_tree "${pid}"
  done <<< "${pids}"
}

if ! has_command overmind; then
  echo "overmind not found in PATH=${PATH}" >&2
  exit 1
fi

cd "${PROJECT_ROOT}"

if [[ -S "${SOCKET_PATH}" ]] && ! overmind status >/dev/null 2>&1; then
  rm -f "${SOCKET_PATH}"
fi

overmind kill >/dev/null 2>&1 || true
clear_api_port

exec overmind start -f "${PROCFILE_PATH}" -d "${PROJECT_ROOT}" -l api -r api
