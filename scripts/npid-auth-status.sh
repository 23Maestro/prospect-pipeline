#!/usr/bin/env bash

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
PYTHON_BIN="/Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/venv/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing Python interpreter: $PYTHON_BIN" >&2
  exit 1
fi

RAW_JSON="$(curl -fsS "${API_BASE}/auth-status")"
export RAW_JSON

"$PYTHON_BIN" <<'PY'
import json
import os
from datetime import timedelta

data = json.loads(os.environ["RAW_JSON"])
session_file = data.get("session_file", {})
shared = data.get("shared_session", {})
video = data.get("video_progress_session", {})
summary = data.get("summary", {})

def format_age(seconds):
    if seconds is None:
        return "unknown"
    try:
        return str(timedelta(seconds=int(seconds)))
    except Exception:
        return str(seconds)

print("NPID Auth Status")
print(f"API status: {data.get('status', 'unknown')}")
print(f"Likely disconnected: {summary.get('likely_disconnected')}")
print(f"Shared session valid: {summary.get('shared_session_valid')}")
print(f"Video progress valid: {summary.get('video_progress_session_valid')}")
print("")
print("Session file")
print(f"Path: {session_file.get('path')}")
print(f"Exists: {session_file.get('exists')}")
print(f"Modified: {session_file.get('modified_at', 'n/a')}")
print(f"Age: {format_age(session_file.get('age_seconds'))}")
print(f"Size: {session_file.get('size_bytes', 'n/a')}")
print("")
print("Shared session probe")
print(f"Cookies loaded: {shared.get('cookies_loaded')}")
print(f"Cookie names: {', '.join(shared.get('cookie_names', [])) or 'none'}")
print(f"Status: {shared.get('probe', {}).get('status_code')}")
print(f"Content-Type: {shared.get('probe', {}).get('content_type')}")
print(f"Redirect: {shared.get('probe', {}).get('location')}")
print("")
print("Video progress probe")
print(f"Cookies loaded: {video.get('cookies_loaded')}")
print(f"Cookie names: {', '.join(video.get('cookie_names', [])) or 'none'}")
print(f"Status: {video.get('probe', {}).get('status_code')}")
print(f"Content-Type: {video.get('probe', {}).get('content_type')}")
print(f"Redirect: {video.get('probe', {}).get('location')}")
PY
