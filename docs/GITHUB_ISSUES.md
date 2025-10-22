# GitHub Issues to Create

## Issue 1: Fix HTML Parsing for Thread Assignment Status

**Title**: [Bug]: HTML parsing incorrectly identifies all threads as unassigned (canAssign: true)

**Labels**: `Type: Bug`, `Priority: High +`, `Component: REST API`, `Component: Inbox`

**Description**:
```markdown
## Problem
The REST API client is incorrectly parsing all inbox threads as `canAssign: true`, when the website shows most are already assigned. This causes:
- `assign-videoteam-inbox.tsx` shows 50 threads instead of ~2 unassigned
- `read-videoteam-inbox.tsx` shows 0 threads instead of ~50 assigned

## Current Behavior
All 50 threads from page 1 return `canAssign: true` in the logs:
```
03:20:10 🔍 READ INBOX: Thread canAssign values: [
  true, true, true, true, true, true, ...
]
03:20:10 🔍 READ INBOX: Filtered assigned messages: 0
```

## Expected Behavior
- Assigned threads should have `canAssign: false` 
- Unassigned threads (with ➕ icon) should have `canAssign: true`
- Proper filtering between the two Raycast commands

## Root Cause
In `mcp-servers/npid-native/npid_api_client.py` line 200:
```python
is_assigned = bool(elem.select_one('.msg-badge-owner'))
```

The CSS selector `.msg-badge-owner` may be incorrect. Need to identify the right selector for:
- ✅ Assigned threads (owner name badge, checkmark, etc.)
- ➕ Unassigned threads (plus icon, assign button, etc.)

## Files to Fix
- `mcp-servers/npid-native/npid_api_client.py` in `_parse_thread_element()` method

## Testing
1. Run: `python3 npid_api_client.py get_inbox_threads '{"limit": 10}'`
2. Verify mix of `canAssign: true/false` values
3. Test both Raycast commands show correct thread counts
```

---

## Issue 2: Add Pagination Support for Multi-Page Inbox Fetching

**Title**: [Feature]: Add pagination to fetch unassigned threads from page 2+

**Labels**: `Type: Feature`, `Priority: High +`, `Component: REST API`, `Component: Inbox`

**Description**:
```markdown
## Problem
Currently only fetches page 1 (50 threads), but unassigned threads needing assignment are on page 2. This means the `assign-videoteam-inbox.tsx` command misses threads that need attention.

## Current Behavior
- Fetches only page 1 with `page_start_number: '1'`
- Misses 2 unassigned threads on page 2
- Hard-coded limit of 50 threads

## Requested Feature
Dynamic pagination that:
1. Fetches pages 1, 2, 3... until limit reached or no more threads
2. Default limit of 100 (covers 2 pages for typical use case)
3. Safety limit of 3 pages max (150 threads) to prevent infinite loops

## Implementation Plan
In `mcp-servers/npid-native/npid_api_client.py`:

```python
def get_inbox_threads(self, limit: int = 100) -> List[Dict[str, Any]]:
    """Get inbox threads with dynamic pagination"""
    all_threads = []
    page = 1
    max_pages = 3  # Safety limit
    
    while len(all_threads) < limit and page <= max_pages:
        params = {
            # ... existing params ...
            'page_start_number': str(page),  # Dynamic page number
        }
        
        page_threads = self._fetch_page_threads(params)
        if not page_threads:  # No more threads
            break
            
        all_threads.extend(page_threads)
        page += 1
    
    return all_threads[:limit]
```

## Success Criteria
- ✅ Fetches threads from multiple pages
- ✅ `assign-videoteam-inbox.tsx` shows all unassigned threads (including page 2)
- ✅ Respects limit parameter
- ✅ Has safety limits to prevent infinite loops

## Dependencies
- Depends on Issue #1 (HTML parsing fix) for proper filtering
```

---

## Issue 3: Restore video-updates.tsx Functionality with REST API

**Title**: [Bug]: video-updates.tsx crashes due to missing npid_automator_complete module

**Labels**: `Type: Bug`, `Priority: Medium`, `Component: Video Updates`, `Component: REST API`

**Description**:
```markdown
## Problem
The `video-updates.tsx` command crashes when trying to search for players or update profiles:

```
ModuleNotFoundError: No module named 'npid_automator_complete'
```

This is because `npid_simple_server.py` imports the deleted Selenium automation module.

## Root Cause
During the REST API migration, we deleted `npid_automator_complete.py` but `npid_simple_server.py` still imports it:

```python
from npid_automator_complete import get_automator  # ❌ File deleted
```

## Solution
1. **Add video methods to REST API client** (`npid_api_client.py`):
   - `search_player(query)` - Search NPID for players
   - `get_athlete_details(player_id)` - Get player profile details  
   - `update_video_profile(player_id, youtube_link, season, video_type)` - Add video to profile

2. **Update npid_simple_server.py** to proxy these methods from the REST client instead of Selenium

3. **Test end-to-end** video updates workflow in Raycast

## Files to Modify
- `mcp-servers/npid-native/npid_api_client.py` - Add video methods
- `mcp-servers/npid-native/npid_simple_server.py` - Fix imports, use REST client

## Success Criteria
- ✅ Player search works in video-updates command
- ✅ Player details load correctly
- ✅ Video profile updates succeed
- ✅ No more import errors
```

---

## Issue 4: Add Video Progress Sync with Notion Database

**Title**: [Feature]: Sync video progress from NPID dashboard to Notion database

**Labels**: `Type: Feature`, `Priority: Low -`, `Component: Video Updates`, `Component: Notion Sync`

**Description**:
```markdown
## Feature Request
Sync video progress data between NPID dashboard and Notion database to keep both systems in sync.

## Endpoints
- **NPID**: `https://dashboard.nationalpid.com/videoteammsg/videomailprogress`
- **Notion**: Database `19f4c8bd6c26805b9929dfa8eb290a86`

## Implementation Plan
Add to `npid_api_client.py`:

```python
def get_video_progress(self) -> List[Dict[str, Any]]:
    """Get video progress from NPID dashboard"""
    resp = self.session.get(f"{self.base_url}/videoteammsg/videomailprogress")
    # Parse HTML table for: Player name, Status, Stage, Video links
    return parsed_data

def sync_video_progress_to_notion(self):
    """Sync video progress to Notion database"""
    # Get progress from NPID
    # Update Notion database
    # Match records by PlayerID URL
```

## Success Criteria
- ✅ Can fetch video progress from NPID dashboard
- ✅ Can update corresponding Notion database records
- ✅ Handles mismatched or missing records gracefully
- ✅ Provides sync status/summary

## Priority
Low priority - can be implemented after core inbox functionality is stable.
```

---

## Issue 5: Set up GitHub Repository Settings and Automation

**Title**: [Enhancement]: Configure repository settings, labels, and branch protection

**Labels**: `Type: Enhancement`, `Documentation`, `Priority: Medium`

**Description**:
```markdown
## Repository Setup Tasks

### 1. Apply Repository Settings
The `.github/settings.yml` file contains repository configuration. Apply via:
- **Option A**: Install [Probot Settings App](https://github.com/apps/settings) 
- **Option B**: Manual configuration in GitHub Settings

### 2. Configure Labels
Apply the label set defined in `.github/settings.yml`:
- Type labels (Bug, Feature, Enhancement, etc.)
- Status labels (Awaiting Review, WIP, etc.) 
- Priority labels (High +, Low -)
- Component labels (REST API, TypeScript, Inbox, etc.)

### 3. Set up Branch Protection
Configure `main` branch protection:
- Require status checks: `lint`, `build`, `python-lint`
- Require 1 approving review
- Dismiss stale reviews
- No admin enforcement (for solo development)

### 4. Test CI/CD Pipeline
Verify the GitHub Actions workflow:
- ✅ TypeScript linting passes
- ✅ Build succeeds  
- ✅ Python linting passes
- ✅ All checks required for merge

### 5. Issue Templates
The following templates are configured:
- Bug Report (`.github/ISSUE_TEMPLATE/bug_report.yml`)
- Feature Request (`.github/ISSUE_TEMPLATE/feature_request.yml`)
- Auto-labeling (`.github/issue_label_bot.yaml`)

## Success Criteria
- ✅ Repository settings applied
- ✅ Labels configured and working
- ✅ Branch protection active
- ✅ CI/CD pipeline passing
- ✅ Issue templates functional
```
