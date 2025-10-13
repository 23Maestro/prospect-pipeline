# Full Thread Message Fetch Implementation - Status & Next Steps

**Created:** 2025-10-12
**Status:** INCOMPLETE - API response parsing issue

## Problem Statement

When viewing a message in the NPID website inbox views (Read Videoteam Inbox / Assign Videoteam Inbox), only a preview/snippet is shown. Need to fetch and display the FULL message content by calling the backend API.

## What Was Implemented

### 1. Frontend Changes (TypeScript/React)

#### File: `src/read-videoteam-inbox.tsx`
- **Lines 14**: Added `fetchMessageDetail` import from `npid-mcp-adapter`
- **Lines 24-53**: Enhanced `EmailContentDetail` component with:
  - State for `fullContent`, `isLoading`, `error`
  - `useEffect` hook that calls `fetchMessageDetail(message.id, message.itemCode)` when component mounts
  - Loading indicator: "Loading full message..."
  - Error handling with fallback to preview
  - Error message display in markdown

#### File: `src/assign-videoteam-inbox.tsx`
- **Lines 21**: Added `fetchMessageDetail` import
- **Lines 199-228**: Same enhancements as above to `EmailContentDetail` component
- **Line 271**: Added `isLoading` prop to Detail component

### 2. Backend Changes (Python)

#### File: `mcp-servers/npid-native/npid_api_client.py`
- **Lines 278-331**: Rewrote `get_message_detail()` method
  - Endpoint: `GET /rulestemplates/template/videoteammessage_subject`
  - Parameters: `message_id`, `itemcode`, `type`, `user_timezone`, `filter_self`
  - Parses JSON response (with whitespace handling via `.strip()`)
  - Extracts `message_plain` field (or falls back to `message`)
  - **Lines 316-329**: Strips reply chains using regex patterns:
    - `\n\s*On\s+.+?\s+wrote:\s*\n`
    - `\n\s*On\s+.+?\s+at\s+.+?wrote:\s*\n`
    - `\n\s*-{2,}\s*On\s+.+?wrote:\s*-{2,}\s*\n`

## Current Issue: API Returns Empty Response

### Problem
The API endpoint returns a 200 status but the response body is empty or contains only whitespace/newlines before the JSON.

### Evidence
From test runs:
```
Response text:



(empty or whitespace)
```

### HAR File Analysis
Located at: `/Users/singleton23/Documents/ProspectID/2025-10-11_video.inbox.har.txt`

**Key Finding (Line 1100):**
The endpoint DOES return JSON successfully in browser:
```json
{
  "message_id": 12531,
  "subject": "Re: Hudl Login Request",
  "message": "<div>HTML content...</div>",
  "message_plain": "Plain text version...",
  "from_email": "gdcasey27@gmail.com",
  ...
}
```

**Request that works (from HAR):**
```
URL: https://dashboard.nationalpid.com/rulestemplates/template/videoteammessage_subject
Params:
  - message_id: 12531
  - itemcode: f3070f9ae5cb5b2f04a7a93d108b273f
  - type: inbox
  - user_timezone: America/New_York
  - filter_self: Me/Un
Headers:
  - Accept: application/json, text/javascript, */*; q=0.01
  - X-Requested-With: XMLHttpRequest
```

### Root Cause Hypothesis
The message ID being passed from the inbox list includes a "message_id" prefix (e.g., `message_id12545` instead of `12545`). This causes the API to return an empty response.

## Next Steps to Fix

### STEP 1: Fix Message ID Parsing
**File:** `mcp-servers/npid-native/npid_api_client.py` (Line 269)

In `_parse_thread_element()`, the message ID is extracted as:
```python
message_id = elem.get('id')  # Returns "message_id12545"
```

**Fix Option A - Strip prefix in get_message_detail:**
```python
def get_message_detail(self, message_id: str, item_code: str) -> Dict[str, Any]:
    """Get detailed message content"""
    self.ensure_authenticated()

    # Strip "message_id" prefix if present
    clean_id = message_id.replace('message_id', '') if message_id.startswith('message_id') else message_id

    params = {
        'message_id': clean_id,  # Use cleaned ID
        'itemcode': item_code,
        'type': 'inbox',
        'user_timezone': 'America/New_York',
        'filter_self': 'Me/Un'
    }
    # ... rest of code
```

**Fix Option B - Store clean ID in _parse_thread_element:**
```python
# Line 262 in _parse_thread_element
message_id = elem.get('id')
# Add this line:
if message_id and message_id.startswith('message_id'):
    message_id = message_id.replace('message_id', '')
```

### STEP 2: Add Missing Request Headers
The HAR file shows the browser sends specific headers. Add to `get_message_detail`:

```python
resp = self.session.get(
    f"{self.base_url}/rulestemplates/template/videoteammessage_subject",
    params=params,
    headers={
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
    }
)
```

### STEP 3: Debug Script
**File:** `mcp-servers/npid-native/debug_api_response.py`

Run this to see actual API responses:
```bash
cd /Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native
venv/bin/python3 debug_api_response.py
```

This will show:
- Actual request URL and params
- Response status and headers
- First 1000 chars of response
- Parsed JSON keys and values

### STEP 4: Test in Raycast
After fixes:
```bash
cd /Users/singleton23/Raycast/prospect-pipeline
npm run dev  # Dev server should auto-reload
```

Then in Raycast:
1. Open "Read Videoteam Inbox" or "Assign Videoteam Inbox"
2. Select a message
3. View details - should show full content without reply chains

## File Structure

```
/Users/singleton23/Raycast/prospect-pipeline/
├── src/
│   ├── read-videoteam-inbox.tsx          # Updated with fetchMessageDetail
│   ├── assign-videoteam-inbox.tsx        # Updated with fetchMessageDetail
│   └── lib/
│       └── npid-mcp-adapter.ts           # Exports fetchMessageDetail (line 26-31)
└── mcp-servers/npid-native/
    ├── npid_api_client.py                # Main fix needed here (line 278-331)
    ├── test_message_fetch.py             # Test script
    └── debug_api_response.py             # Debug script (NEW)
```

## API Endpoint Details

**Base URL:** `https://dashboard.nationalpid.com`

**Endpoint:** `/rulestemplates/template/videoteammessage_subject`

**Method:** GET

**Query Parameters:**
- `message_id` (string) - MUST be numeric only (e.g., "12531", NOT "message_id12531")
- `itemcode` (string) - Item code from inbox list
- `type` (string) - Always "inbox"
- `user_timezone` (string) - e.g., "America/New_York"
- `filter_self` (string) - "Me/Un" for all messages

**Response:**
```json
{
  "message_id": 12531,
  "subject": "Re: Subject",
  "message": "<div>HTML content with full thread...</div>",
  "message_plain": "Plain text content with full thread...",
  "from_email": "sender@example.com",
  "from_name": "Sender Name",
  "time_stamp": "Oct 12, 2025 | 4:50 PM",
  "attachments": []
}
```

## Success Criteria

When working correctly, the user should see:
1. Message detail view opens with "Loading full message..."
2. Full message content appears (not just snippet)
3. Reply chains are stripped (content stops at "On [date]... wrote:")
4. No errors in console

Example of expected output:
```
Re: Spencer, we need your video footage.


Spencer Chappell
Oct 12, 2025 | 4:50 PM
Hello,

I have uploaded mid season highlights to my player ID page so do not need any further video edits.

Please begin the email campaign and let me know if you need any further information from me.

Appreciate your help!

Kind regards,

Spencer
555-555-5555
```

(Reply chain after "On Sun, Oct 12..." should be cut off)

## Dependencies

- Python 3.x
- requests library
- BeautifulSoup4
- TypeScript/React (Raycast extension)
- Active NPID session (authentication via cookies)

## Authentication

Session cookies are stored in: `~/.npid_session.pkl`

If login issues occur, delete this file to force re-authentication.

## Additional Resources

- HAR file: `/Users/singleton23/Documents/ProspectID/2025-10-11_video.inbox.har.txt`
- Working AJAX call reference: Line 3778 in HAR file
- Full message JSON example: Line 1100 in HAR file

## Estimated Work Remaining

1. **Fix message ID (5 minutes)** - Add prefix stripping
2. **Add headers (2 minutes)** - Add Accept and X-Requested-With
3. **Test (10 minutes)** - Run debug script, verify in Raycast
4. **Polish (5 minutes)** - Adjust reply chain regex if needed

**Total: ~20-30 minutes**

---

## Quick Start for Next Developer

```bash
# 1. Navigate to project
cd /Users/singleton23/Raycast/prospect-pipeline

# 2. Apply the message ID fix (see STEP 1 above)
# Edit: mcp-servers/npid-native/npid_api_client.py line 278

# 3. Test the API directly
cd mcp-servers/npid-native
venv/bin/python3 debug_api_response.py

# 4. If API works, test in Raycast
cd ../..
npm run dev

# 5. Open Raycast and test "Read Videoteam Inbox"
```

Good luck! The implementation is 95% complete - just needs the message ID prefix fix.
