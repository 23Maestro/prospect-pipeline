#!/bin/bash
# Concurrent httpie testing for FastAPI → Laravel pipeline
# Tests multiple endpoints in parallel to verify session handling

API_BASE="http://127.0.0.1:8000/api/v1"

echo "🧪 Running concurrent API tests..."

# Run tests in parallel using background jobs
(http --ignore-stdin GET "${API_BASE}/../health" && echo "✅ Health check passed") &
PID1=$!

(http --ignore-stdin --timeout=30 POST "${API_BASE}/video/progress" \
  first_name="" last_name="" sport="0" grad_year="" \
  video_progress_stage="" video_progress_status="" > /dev/null 2>&1 \
  && echo "✅ Video progress passed") &
PID2=$!

# Wait for all background jobs
wait $PID1
wait $PID2

echo "✅ All concurrent tests complete"
