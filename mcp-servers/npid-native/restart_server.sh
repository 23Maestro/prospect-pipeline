#!/bin/bash
# Restart the NPID SSE Server

echo "🔄 Restarting NPID SSE Server..."
echo ""

# Stop
echo "Stopping..."
launchctl unload ~/Library/LaunchAgents/com.user.npid-sse-server.plist 2>/dev/null

# Wait a moment
sleep 2

# Start
echo "Starting..."
launchctl load ~/Library/LaunchAgents/com.user.npid-sse-server.plist

if [ $? -eq 0 ]; then
    sleep 2
    echo ""
    echo "✅ Server restarted successfully"
    echo ""
    # Show status
    ./check_server_status.sh
else
    echo "❌ Failed to restart server"
    exit 1
fi
