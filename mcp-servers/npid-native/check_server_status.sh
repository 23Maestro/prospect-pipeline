#!/bin/bash
# Check the status of the NPID SSE Server

echo "🔍 NPID SSE Server Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if LaunchAgent is loaded
if launchctl list | grep -q "com.user.npid-sse-server"; then
    status=$(launchctl list | grep "com.user.npid-sse-server")
    pid=$(echo "$status" | awk '{print $1}')
    exit_code=$(echo "$status" | awk '{print $2}')
    
    if [ "$exit_code" = "0" ]; then
        echo "✅ LaunchAgent: RUNNING (PID: $pid)"
    else
        echo "❌ LaunchAgent: LOADED but FAILED (Exit code: $exit_code)"
        echo ""
        echo "Check error log:"
        echo "  tail ~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/sse-server.error.log"
        exit 1
    fi
else
    echo "❌ LaunchAgent: NOT LOADED"
    echo ""
    echo "To start: launchctl load ~/Library/LaunchAgents/com.user.npid-sse-server.plist"
    exit 1
fi

echo ""

# Check if server responds
if curl -s -f http://127.0.0.1:5050/health > /dev/null 2>&1; then
    echo "✅ HTTP Server: RESPONDING on http://127.0.0.1:5050"
    echo ""
    echo "Server details:"
    curl -s http://127.0.0.1:5050/health | python3 -m json.tool
else
    echo "❌ HTTP Server: NOT RESPONDING on port 5050"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Management Commands:"
echo "  View logs:    tail -f ~/Raycast/prospect-pipeline/mcp-servers/npid-native/logs/sse-server.log"
echo "  Stop server:  launchctl unload ~/Library/LaunchAgents/com.user.npid-sse-server.plist"
echo "  Start server: launchctl load ~/Library/LaunchAgents/com.user.npid-sse-server.plist"
echo "  Restart:      launchctl unload ... && launchctl load ..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
