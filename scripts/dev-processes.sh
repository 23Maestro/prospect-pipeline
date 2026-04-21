#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
PROCFILE_PATH="${PROJECT_ROOT}/Procfile.dev"
API_PORT="${API_PORT:-8000}"
WAIT_SCRIPT="${PROJECT_ROOT}/scripts/wait-for-api.sh"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

has_active_overmind_session() {
  has_command overmind && overmind status >/dev/null 2>&1
}

ensure_overmind_session() {
  clear_stale_overmind_socket

  if has_active_overmind_session; then
    return 0
  fi

  cd "${PROJECT_ROOT}"
  overmind start -D -f "${PROCFILE_PATH}" >/dev/null

  local attempts=0
  until has_active_overmind_session; do
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 10 ]]; then
      echo "Failed to start Overmind session"
      exit 1
    fi
    sleep 1
  done
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

wait_for_api() {
  if [[ -x "${WAIT_SCRIPT}" ]]; then
    "${WAIT_SCRIPT}"
  fi
}

clear_stale_overmind_socket() {
  local socket_path="${PROJECT_ROOT}/.overmind.sock"

  if [[ -S "${socket_path}" ]] && ! has_active_overmind_session; then
    rm -f "${socket_path}"
  fi
}

print_usage() {
  cat <<'EOF'
Usage:
  scripts/dev-processes.sh install
  scripts/dev-processes.sh start
  scripts/dev-processes.sh restart [process]
  scripts/dev-processes.sh stop [process]
  scripts/dev-processes.sh kill
  scripts/dev-processes.sh connect [process]
  scripts/dev-processes.sh run <command...>
  scripts/dev-processes.sh status

Defaults:
  process defaults to "api" for restart/stop/connect

Behavior:
  - Uses Overmind when available
  - Falls back to local repo commands when Overmind is unavailable
EOF
}

restart_api_without_overmind() {
  local pids
  pids="$(lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN -t || true)"
  if [[ -n "${pids}" ]]; then
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] && kill_process_tree "${pid}"
    done <<< "${pids}"
  fi

  cd "${PROJECT_ROOT}/npid-api-layer"
  if [[ ! -x "venv/bin/python" ]]; then
    echo "Missing FastAPI venv at ${PROJECT_ROOT}/npid-api-layer/venv/bin/python"
    exit 1
  fi

  exec env API_RELOAD=0 "${PROJECT_ROOT}/scripts/run-api-dev.sh"
}

stop_api_without_overmind() {
  local pids
  pids="$(lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN -t || true)"
  if [[ -z "${pids}" ]]; then
    echo "No process listening on port ${API_PORT}"
    return 0
  fi

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill_process_tree "${pid}"
  done <<< "${pids}"
}

kill_without_overmind() {
  pkill -f "ray develop" || true

  local pids
  pids="$(lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN -t || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill_process_tree "${pid}"
  done <<< "${pids}"
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

install_overmind() {
  if ! has_command brew; then
    echo "Homebrew is required to install tmux and overmind"
    exit 1
  fi

  brew install tmux overmind
}

start_stack() {
  cd "${PROJECT_ROOT}"
  if has_command overmind; then
    clear_stale_overmind_socket
    clear_api_port
    exec overmind start -f "${PROCFILE_PATH}"
  fi

  echo "overmind not installed; falling back to npm run dev:all"
  exec npm run dev:all
}

restart_process() {
  local process="${1:-api}"
  if has_command overmind; then
    ensure_overmind_session
    overmind restart "${process}"
    if [[ "${process}" == "api" ]]; then
      wait_for_api
    fi
    return 0
  fi

  if [[ "${process}" != "api" ]]; then
    echo "Without overmind, only 'api' restart is supported"
    exit 1
  fi

  restart_api_without_overmind
}

stop_process() {
  local process="${1:-api}"
  if has_command overmind; then
    if ! has_active_overmind_session; then
      echo "No active Overmind session"
      return 0
    fi
    exec overmind stop "${process}"
  fi

  if [[ "${process}" != "api" ]]; then
    echo "Without overmind, only 'api' stop is supported"
    exit 1
  fi

  stop_api_without_overmind
}

kill_processes() {
  if has_command overmind && has_active_overmind_session; then
    exec overmind kill
  fi

  kill_without_overmind
}

connect_process() {
  local process="${1:-api}"
  if ! has_active_overmind_session; then
    echo "overmind is required for process connect"
    exit 1
  fi

  exec overmind connect "${process}"
}

run_in_env() {
  if has_command overmind; then
    exec overmind run "$@"
  fi

  exec "$@"
}

show_status() {
  if has_command overmind; then
    if overmind status; then
      return 0
    fi

    echo "overmind installed, but no active Procfile session is running in this repo"
    return 0
  fi

  echo "overmind not installed"
  if lsof -nP -iTCP:${API_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "api: listening on port ${API_PORT}"
  else
    echo "api: not listening on port ${API_PORT}"
  fi
}

command_name="${1:-}"
if [[ -z "${command_name}" ]]; then
  print_usage
  exit 1
fi
shift || true

case "${command_name}" in
  install)
    install_overmind
    ;;
  start)
    start_stack
    ;;
  restart)
    restart_process "${1:-api}"
    ;;
  stop)
    stop_process "${1:-api}"
    ;;
  kill)
    kill_processes
    ;;
  connect)
    connect_process "${1:-api}"
    ;;
  run)
    if [[ $# -eq 0 ]]; then
      echo "run requires a command"
      exit 1
    fi
    run_in_env "$@"
    ;;
  status)
    show_status
    ;;
  *)
    print_usage
    exit 1
    ;;
esac
