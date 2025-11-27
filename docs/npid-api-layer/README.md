# NPID API Translation Layer

A FastAPI service that sits between your Raycast extension and the legacy Laravel/AngularJS NPID backend. Translates clean JSON requests to legacy form posts, normalizes responses, and manages session state.

## Why This Exists

The NPID backend returns HTML where JSON should be, uses inconsistent parameter names (`youtubeLink` vs `newVideoLink`), and requires CSRF tokens that expire unpredictably. Instead of hardcoding workarounds in every script, this layer handles all the translation in one place.

When Laravel changes, you fix it here. Your Raycast extension stays clean.

## Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure credentials
cp .env.template .env
# Edit .env with your NPID credentials
```

## Running

### Manual Start

```bash
# Development
uvicorn main:app --reload --port 8000

# Production
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Auto-Start on macOS (Recommended)

FastAPI doesn't auto-start like session files. Use launchd to run the server automatically:

```bash
# 1. Copy plist to LaunchAgents
cp com.npid.fastapi.plist ~/Library/LaunchAgents/

# 2. Load and start service
launchctl load -w ~/Library/LaunchAgents/com.npid.fastapi.plist

# 3. Verify it's running
curl http://localhost:8000/health
```

**Managing the service:**
```bash
# Stop service
launchctl unload ~/Library/LaunchAgents/com.npid.fastapi.plist

# Restart service
launchctl unload ~/Library/LaunchAgents/com.npid.fastapi.plist
launchctl load -w ~/Library/LaunchAgents/com.npid.fastapi.plist

# View logs
tail -f /tmp/npid-fastapi.out
tail -f /tmp/npid-fastapi.err
```

The service will:
- ✅ Auto-start on login
- ✅ Auto-restart if it crashes
- ✅ Run in background (no terminal needed)

## Endpoints

### Health Check
```
GET /health
```

### Video Operations

**Submit Video**
```
POST /api/v1/video/submit
{
    "athlete_id": "1462822",
    "athlete_main_id": "941787",
    "video_url": "https://youtu.be/Z0sLZz_Dlfs",
    "video_type": "Full Season Highlight",
    "season": "highschool:16137",
    "source": "youtube",
    "auto_approve": true,
    "sport": "football"
}
```

**Update Stage**
```
POST /api/v1/video/{video_msg_id}/stage
{
    "video_msg_id": "11875",
    "stage": "Done"
}
```

**Get Seasons**
```
GET /api/v1/video/seasons/{athlete_id}?sport=football&video_type=Full+Season+Highlight
```

### Athlete Operations

**Resolve IDs**
```
GET /api/v1/athlete/{any_id}/resolve
```
Given any ID (athlete_id, athlete_main_id, video_msg_id), returns all known IDs for that athlete.

**Get Details**
```
GET /api/v1/athlete/{athlete_id}/details
```

### Assignments

**List All**
```
GET /api/v1/assignments?status=Pending&sport=football&limit=50
```

**Pending Only**
```
GET /api/v1/assignments/pending
```

**In Progress Only**
```
GET /api/v1/assignments/in-progress
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│  Raycast Ext    │────▶│  FastAPI Layer   │────▶│  Laravel/NPID   │
│  (clean JSON)   │     │  (translation)   │     │  (legacy forms) │
│                 │◀────│                  │◀────│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Key files:**
- `app/translators/legacy.py` - All Laravel quirk handling lives here
- `app/session.py` - Authentication, CSRF management
- `app/routers/*.py` - Clean endpoint definitions
- `app/models/schemas.py` - Pydantic models (the contract your extension relies on)

## When Laravel Changes

1. Identify which endpoint broke
2. Update the translation in `app/translators/legacy.py`
3. Your Raycast extension keeps working

## Video Types

- `Full Season Highlight`
- `Partial Season Highlight`
- `Single Game Highlight`
- `Skills/Training Video`

## Stage Values

- `Pending`
- `In Progress`
- `Done`
- `On Hold`

## Caching

Athlete ID lookups are cached in memory for 30 minutes. The `athlete_main_id` resolution that was hitting the API multiple times per operation now happens once.

## Logging

Set `LOG_LEVEL=DEBUG` in `.env` for verbose output including all request/response data.

## Integration with Raycast

Update your Raycast extension to call `http://localhost:8000/api/v1/...` instead of the Python scripts that hit Laravel directly. The response format is guaranteed stable even when Laravel changes underneath.
