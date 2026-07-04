#!/usr/bin/env bash
# @raycast.schemaVersion 1
# @raycast.title Restart NPID API
# @raycast.mode silent
# @raycast.packageName NPID Tools
# @raycast.description Kill any process on port 8000 and restart the FastAPI server.
# @raycast.icon 🔁

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
exec "${PROJECT_ROOT}/scripts/dev-processes.sh" restart api
