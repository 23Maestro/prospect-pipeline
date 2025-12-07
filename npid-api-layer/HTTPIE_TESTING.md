# httpie Testing for FastAPI → Laravel Pipeline

## Overview
httpie is a CLI HTTP client for testing API endpoints. Use it to debug the FastAPI → Laravel translation layer.

## Installation
```bash
brew install httpie  # Already installed
```

## Basic Usage

### Health Check
```bash
http GET http://127.0.0.1:8000/health
```

Expected: `{"status":"ok","session_authenticated":true}`

### Video Progress Search
```bash
http --ignore-stdin POST http://127.0.0.1:8000/api/v1/video/progress \
  first_name="" \
  last_name="" \
  sport="0" \
  grad_year="" \
  video_progress_stage="" \
  video_progress_status=""
```

Expected: HTTP 200 with JSON array of video tasks

### Due Date Update
```bash
http --ignore-stdin POST http://127.0.0.1:8000/api/v1/video/VIDEO_ID/duedate \
  video_msg_id="VIDEO_ID" \
  due_date="12/31/2025"
```

Expected: `{"success":true,"video_msg_id":"...","due_date":"12/31/2025"}`

## Debugging with httpie

### Show Request + Response Headers
```bash
http --print=HhBb POST http://127.0.0.1:8000/api/v1/video/progress \
  first_name="" last_name="" sport="0" ...
```

**Flags:**
- `H` = Request headers
- `h` = Response headers
- `B` = Request body
- `b` = Response body

### CSRF Token Issues
If you see HTTP 302 or 419:
1. Check server logs: `tail -f npid-api-layer/logs/api.log`
2. Verify session file: `ls -lh ~/.npid_session.pkl`
3. Restart server: `pkill -f uvicorn && cd npid-api-layer && venv/bin/python -m uvicorn main:app --port 8000`

### Session Cookie Issues
If Laravel rejects requests:
- Session cookies MUST include domain, path, secure flags
- Check `app/session.py:_load_session_sync()` - uses `cookie.set()` to preserve metadata
- Verify with: `http --print=HhBb GET http://127.0.0.1:8000/health` (check request headers for cookies)

## Concurrent Testing

Run multiple tests in parallel:
```bash
./npid-api-layer/test-concurrent.sh
```

## Scripts

1. **test-api.sh** - Interactive testing script (prompts for video_msg_id)
2. **test-concurrent.sh** - Parallel endpoint testing

## Common Issues

### HTTP 400 "Invalid JSON"
- Missing `--ignore-stdin` flag when running in scripts
- Solution: Add `--ignore-stdin` to all httpie commands in automated contexts

### HTTP 302 Redirect to /auth/login
- Session cookies not properly loaded from pickle file
- CSRF token missing or expired
- Solution: Fixed in `app/session.py` - cookies now preserve domain/path metadata

### HTTP 419 CSRF Token Mismatch
- Laravel received stale token
- Solution: FastAPI automatically retries with fresh token (see `app/session.py:post()`)

## Integration with FastAPI

httpie tests the **same endpoints** Raycast calls:
- Raycast → `apiFetch('/video/progress')` → FastAPI → Laravel
- httpie → `http POST :8000/api/v1/video/progress` → FastAPI → Laravel

Both use identical FastAPI layer, allowing CLI debugging of Raycast issues.
