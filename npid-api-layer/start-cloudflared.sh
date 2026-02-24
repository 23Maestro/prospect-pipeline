#!/bin/bash
# Auto-start script for cloudflared tunnel
# Requires Cloudflare tunnel credentials and config file.

set -euo pipefail

CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-}"
if [ -z "${CLOUDFLARED_BIN}" ]; then
  if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED_BIN="$(command -v cloudflared)"
  elif [ -x "/opt/homebrew/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/opt/homebrew/bin/cloudflared"
  elif [ -x "/usr/local/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/usr/local/bin/cloudflared"
  else
    echo "cloudflared binary not found in PATH, /opt/homebrew/bin, or /usr/local/bin"
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${CLOUDFLARED_CONFIG:-${SCRIPT_DIR}/cloudflared/config.yml}"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "cloudflared config not found at: $CONFIG_FILE"
  echo "Copy ${SCRIPT_DIR}/cloudflared/config.yml.template to ${SCRIPT_DIR}/cloudflared/config.yml and set tunnel values."
  exit 1
fi

exec "$CLOUDFLARED_BIN" tunnel --config "$CONFIG_FILE" run
