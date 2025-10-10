#!/bin/bash
# Stop the NPID SSE Server

echo "🛑 Stopping NPID SSE Server..."
echo ""

launchctl unload ~/Library/LaunchAgents/com.user.npid-sse-server.plist

if [ $? -eq 0 ]; then
    echo "✅ Server stopped successfully"
else
    echo "❌ Failed to stop server"
    exit 1
fi
