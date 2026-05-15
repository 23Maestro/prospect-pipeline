#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Users/singleton23/Raycast/prospect-pipeline"
PLIST_PATH="$HOME/Library/LaunchAgents/com.singleton23.prospect-pipeline.confirmation-task-watcher.plist"
LOG_DIR="/Users/singleton23/raycast_logs"

mkdir -p "$LOG_DIR" "$(dirname "$PLIST_PATH")"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.singleton23.prospect-pipeline.confirmation-task-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "$REPO_DIR" && npm run watch:confirmation-tasks</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/confirmation-task-watcher.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/confirmation-task-watcher.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/com.singleton23.prospect-pipeline.confirmation-task-watcher"
launchctl kickstart -k "gui/$(id -u)/com.singleton23.prospect-pipeline.confirmation-task-watcher"

echo "Installed confirmation task watcher: $PLIST_PATH"
