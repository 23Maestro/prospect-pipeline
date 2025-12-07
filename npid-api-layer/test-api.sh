#!/bin/bash
# httpie test script for FastAPI → Laravel pipeline
# Tests endpoints concurrently for efficiency

API_BASE="http://127.0.0.1:8000/api/v1"

# Test health endpoint
echo "Testing health endpoint..."
http GET "${API_BASE}/../health"

# Test video progress (concurrent search)
echo -e "\nTesting video progress..."
http POST "${API_BASE}/video/progress" \
  first_name="" \
  last_name="" \
  sport="0" \
  grad_year="" \
  video_progress_stage="" \
  video_progress_status=""

# Test due date update (example video_msg_id)
echo -e "\nTesting due date update..."
read -p "Enter video_msg_id to test: " VIDEO_ID
read -p "Enter due date (MM/DD/YYYY): " DUE_DATE

http POST "${API_BASE}/video/${VIDEO_ID}/duedate" \
  video_msg_id="${VIDEO_ID}" \
  due_date="${DUE_DATE}"

echo -e "\nTests complete."
