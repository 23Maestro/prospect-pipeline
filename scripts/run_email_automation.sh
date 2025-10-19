#!/bin/bash

# This script activates the virtual environment and runs the email_automation.py script.

source /Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/venv/bin/activate

python3 /Users/singleton23/Raycast/prospect-pipeline/scripts/email_automation.py "$@"
