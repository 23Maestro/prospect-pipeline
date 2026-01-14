#!/bin/bash
# Unified development server startup script
# Starts both FastAPI backend and Raycast extension

set -e

PROJECT_ROOT="/Users/singleton23/Raycast/prospect-pipeline"
VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"
VENV_UVICORN="$PROJECT_ROOT/.venv/bin/uvicorn"

echo "🚀 Starting Prospect Pipeline Development Environment"
echo ""

# Kill existing processes
echo "🧹 Cleaning up existing processes..."
pkill -f "uvicorn main:app" || true
pkill -f "ray develop" || true
sleep 1

# Start FastAPI server in background
echo "📡 Starting FastAPI server (http://localhost:8000)..."
cd "$PROJECT_ROOT/npid-api-layer"
$VENV_UVICORN main:app --reload --port 8000 > /tmp/fastapi-dev.log 2>&1 &
FASTAPI_PID=$!
echo "   ✅ FastAPI PID: $FASTAPI_PID"

# Wait for FastAPI to be ready
echo "   ⏳ Waiting for FastAPI to start..."
for i in {1..10}; do
    if curl -s http://localhost:8000/docs > /dev/null 2>&1; then
        echo "   ✅ FastAPI ready!"
        break
    fi
    sleep 1
done

# Start Raycast extension dev mode
echo ""
echo "🎯 Starting Raycast extension..."
cd "$PROJECT_ROOT"
npm run dev

# Cleanup on exit
trap "echo ''; echo '🛑 Shutting down...'; kill $FASTAPI_PID 2>/dev/null || true" EXIT
