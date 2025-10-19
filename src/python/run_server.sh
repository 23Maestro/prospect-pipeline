#!/bin/bash
# Python environment wrapper for Raycast commands
# Activates the virtual environment before running the server.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Activate virtual environment if it exists
if [ -f "$VENV_DIR/bin/activate" ]; then
  source "$VENV_DIR/bin/activate"
fi

# Execute the python script
exec python3 "$SCRIPT_DIR/npid_simple_server.py"
