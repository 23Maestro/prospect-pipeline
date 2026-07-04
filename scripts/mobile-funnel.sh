#!/usr/bin/env bash

set -euo pipefail

ACTION="${1:-start}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_PORT="${API_PORT:-8000}"
FUNNEL_PORT="${FUNNEL_PORT:-443}"
TAILSCALE_BIN="${TAILSCALE_BIN:-tailscale}"

usage() {
  cat <<EOF
Usage: scripts/mobile-funnel.sh [start|status|reset|url]

Environment:
  API_PORT=${API_PORT}
  FUNNEL_PORT=${FUNNEL_PORT}
  TAILSCALE_BIN=${TAILSCALE_BIN}

Notes:
  - start exposes http://127.0.0.1:${API_PORT} through Tailscale Funnel.
  - Funnel public HTTPS ports are 443, 8443, or 10000.
  - The FastAPI server must already be healthy.
EOF
}

require_tailscale() {
  if ! command -v "${TAILSCALE_BIN}" >/dev/null 2>&1; then
    echo "tailscale command not found. Add Tailscale CLI to PATH first."
    exit 1
  fi
}

ensure_api_healthy() {
  if ! API_PORT="${API_PORT}" API_TIMEOUT_SECONDS=3 "${PROJECT_ROOT}/scripts/wait-for-api.sh" >/dev/null 2>&1; then
    echo "FastAPI is not healthy at http://127.0.0.1:${API_PORT}/health"
    echo "Start it with Overmind/Raycast dev first, then rerun this command."
    exit 1
  fi
}

ensure_tailscale_running() {
  if "${TAILSCALE_BIN}" status >/dev/null 2>&1; then
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    open -a Tailscale >/dev/null 2>&1 || true
    sleep 2
  fi

  if ! "${TAILSCALE_BIN}" status >/dev/null 2>&1; then
    echo "Tailscale is not running or not authenticated."
    echo "Open Tailscale, sign in if needed, then rerun this command."
    exit 1
  fi
}

case "${ACTION}" in
  start)
    require_tailscale
    ensure_api_healthy
    ensure_tailscale_running
    "${TAILSCALE_BIN}" funnel --bg --https="${FUNNEL_PORT}" "localhost:${API_PORT}"
    "${TAILSCALE_BIN}" funnel status
    ;;
  status)
    require_tailscale
    "${TAILSCALE_BIN}" funnel status
    ;;
  reset|stop)
    require_tailscale
    "${TAILSCALE_BIN}" funnel reset
    ;;
  url)
    require_tailscale
    "${TAILSCALE_BIN}" funnel status --json
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
