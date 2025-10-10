#!/bin/bash
# Quick Start Script for NPID SSE Streaming Server

echo "🚀 Starting NPID SSE Streaming Server..."
echo ""

# Navigate to the correct directory
cd ~/Raycast/prospect-pipeline/mcp-servers/npid-native

# Check if Flask is installed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Installing dependencies..."
    python3 -m pip install flask flask-sse gunicorn
    echo ""
fi

# Start the server
echo "▶️  Launching server on http://127.0.0.1:5050"
echo ""
python3 session_stream_server.py
