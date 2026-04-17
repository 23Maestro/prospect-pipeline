#!/usr/bin/env bash
# @raycast.schemaVersion 1
# @raycast.title Restart NPID API
# @raycast.mode silent
# @raycast.packageName NPID Tools
# @raycast.description Kill any process on port 8000 and restart the FastAPI server.
# @raycast.icon 🔁

set -euo pipefail

PROJECT_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
exec "${PROJECT_ROOT}/scripts/dev-processes.sh" restart api
