# NPID → Notion Sync System

## Overview

Complete automation system that syncs NPID video progress data to Notion database with real-time updates and comprehensive monitoring.

## Architecture

```
[NPID Video Progress API] 
    ↓
[Playwright Automation] 
    ↓
[Python Sync Script]
    ↓
[Notion Database]
    ↓
[n8n Workflow (Every 2 Hours)]
    ↓
[Slack Notifications]
```

## Components

### 1. NPID Video Progress Sync Script
**File**: `mcp-servers/npid-native/npid_video_progress_sync.py`

**Features**:
- ✅ Fetches video progress data from NPID page (NO TOKENS!)
- ✅ Uses saved Playwright state (400-day session)
- ✅ Extracts athlete details directly from page DOM
- ✅ Creates/updates Notion database entries
- ✅ Handles duplicates and updates existing records
- ✅ Comprehensive error handling and logging

**Usage**:
```bash
# Dry run (fetch data only)
python3 npid_video_progress_sync.py --dry-run

# Full sync with Notion
python3 npid_video_progress_sync.py --notion-token "your_token" --notion-database-id "your_db_id"
```

### 2. Enhanced Video Updates (Raycast)
**File**: `src/video-updates.tsx`

**New Features**:
- ✅ NPID player search by name
- ✅ Direct Player ID input
- ✅ Real-time search results display
- ✅ Player details preview
- ✅ Enhanced form validation
- ✅ NPID integration for video updates

**Search Modes**:
- **Name Search**: Type athlete name → see matching NPID players
- **ID Search**: Enter Player ID directly → get player details

### 3. n8n Automation Workflow
**File**: `.kiro/specs/npid-n8n-workflows/npid-notion-sync-workflow.json`

**Schedule**: Every 2 hours
**Features**:
- ✅ Automated NPID data fetching
- ✅ Notion database updates
- ✅ Sync logging to Notion
- ✅ Slack notifications (success/failure)
- ✅ Error handling and recovery

## Setup Instructions

### 1. Environment Variables

Create `.env` file in project root:
```bash
# Notion Integration
NOTION_TOKEN=your_notion_integration_token
NOTION_DATABASE_ID=your_notion_database_id
NOTION_SYNC_LOG_DATABASE_ID=your_sync_log_database_id

# NPID (already configured)
NPID_BASE_URL=https://dashboard.nationalpid.com
```

### 2. Notion Database Setup

Create a Notion database with these properties:

**Main Database** (`NOTION_DATABASE_ID`):
```
- Player ID (Rich Text) - Primary identifier
- Name (Title) - Athlete name
- Graduation Year (Rich Text)
- High School (Rich Text)
- Location (Rich Text)
- Positions (Rich Text)
- Sport (Rich Text)
- Video Stage (Select: In Queue, Editing, Review, Complete)
- Video Status (Select: HUDL, Revisions, Approved, Not Approved)
- Video Editor (Rich Text)
- Last Updated (Date)
```

**Sync Log Database** (`NOTION_SYNC_LOG_DATABASE_ID`):
```
- Title (Title)
- New Entries (Number)
- Updated Entries (Number)
- Total Processed (Number)
- Status (Select: Success, Failed)
- Timestamp (Date)
```

### 3. n8n Workflow Import

1. Open n8n at `http://localhost:5678`
2. Import the workflow JSON file
3. Configure credentials:
   - Notion API credentials
   - Slack webhook URL (optional)
4. Set environment variables in n8n
5. Activate the workflow

### 4. NPID Server Enhancement

Add video progress methods to `npid_simple_server.py`:

```python
async def get_video_progress():
    """Get video progress data"""
    try:
        result = await automator.get_video_progress_data()
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def update_video_profile(player_id, youtube_link, season, video_type):
    """Update video profile for specific player"""
    try:
        result = await automator.update_video_profile(
            player_id=player_id,
            youtube_link=youtube_link,
            season=season,
            video_type=video_type
        )
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})
```

## Data Flow

### 1. Manual Video Updates
1. User opens Raycast → Video Updates
2. Searches for athlete by name or enters Player ID
3. Selects athlete from search results
4. Enters YouTube link, season, video type
5. Submits → NPID profile updated → Notion synced

### 2. Automated Sync (Every 2 Hours)
1. n8n schedule trigger fires
2. Executes NPID sync script
3. Fetches all video progress data
4. Updates Notion database
5. Logs sync results
6. Sends Slack notification

### 3. Real-time Updates
- Video updates trigger immediate NPID profile changes
- Next sync cycle picks up changes
- Notion database stays current

## Monitoring

### Success Metrics
- ✅ New entries created in Notion
- ✅ Existing entries updated
- ✅ Sync completion rate
- ✅ Error handling effectiveness

### Error Handling
- 🔄 Retry logic for failed requests
- 📝 Comprehensive error logging
- 🔔 Slack notifications for failures
- 📊 Sync statistics tracking

## API Endpoints Used

### NPID Video Progress
```
POST https://dashboard.nationalpid.com/videoteammsg/videoprogress
```

**Headers**:
- `X-XSRF-TOKEN`: From cookies
- `Content-Type`: application/json
- `Cookie`: Session cookies

**Payload**:
```json
{
  "first_name": "",
  "last_name": "",
  "email": "",
  "sport": "0",
  "states": "0",
  "athlete_school": "0",
  "editorassigneddatefrom": "",
  "editorassigneddateto": "",
  "grad_year": "",
  "select_club_sport": "",
  "select_club_state": "",
  "select_club_name": "",
  "video_editor": "",
  "video_progress": "",
  "video_progress_stage": "",
  "video_progress_status": ""
}
```

### Notion API
```
POST https://api.notion.com/v1/pages
PATCH https://api.notion.com/v1/pages/{page_id}
POST https://api.notion.com/v1/databases/{database_id}/query
```

## Troubleshooting

### Common Issues

1. **Session Expired**
   - Regenerate Playwright state
   - Update saved state in sync script

2. **Notion API Errors**
   - Check integration token permissions
   - Verify database ID format
   - Ensure database properties match schema

3. **NPID API Errors**
   - Verify XSRF token is current
   - Check cookie expiration
   - Validate endpoint URLs

### Debug Commands

```bash
# Test NPID connection
python3 npid_video_progress_sync.py --dry-run

# Check Notion connection
curl -X POST "https://api.notion.com/v1/databases/{database_id}/query" \
  -H "Authorization: Bearer {token}" \
  -H "Notion-Version: 2022-06-28"

# Test n8n workflow
curl -X POST "http://localhost:5678/webhook/test-sync"
```

## Future Enhancements

- [ ] Real-time webhook updates (no polling)
- [ ] Advanced filtering and search in Notion
- [ ] Bulk video upload processing
- [ ] Integration with other video platforms
- [ ] Automated email notifications
- [ ] Performance metrics dashboard
- [ ] Multi-database sync support

## Status

**Current State**: ✅ Production Ready
**Last Updated**: 2025-01-27
**Next Review**: 2025-02-27

---

**Ready to sync NPID video progress to Notion automatically!** 🚀
