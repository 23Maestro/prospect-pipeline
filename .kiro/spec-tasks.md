# MIGRATE TO REST API - REMOVE ALL SELENIUM/PLAYWRIGHT

## CRITICAL DISCOVERY (October 9, 2025)
**Prospect ID HAS A FULL REST API** - All Selenium/Playwright scraping is unnecessary.
ChatGPT extracted 6 confirmed JSON endpoints from HAR files that handle ALL operations.

**Reference**: See `ProspectID_JSON_Endpoints.pdf` for all confirmed endpoints with HTTPie commands.

---

## PHASE 1: HTTPie Session Setup (5 minutes)

### 1.1 Extract Current Browser Cookies
- [ ] Open Chrome DevTools on https://dashboard.nationalpid.com
- [ ] Application tab → Cookies → dashboard.nationalpid.com
- [ ] Copy these cookies:
  - `remember_82e5d2c56bdd0811318f0cf078b78bfc` (1-year token)
  - `XSRF-TOKEN` (CSRF protection)
  - `myapp_session` (current session)

### 1.2 Create HTTPie Session
```bash
http --session=prospect-id --print=HhBb https://dashboard.nationalpid.com/admin/videomailbox \
  'Cookie:remember_82e5d2c56bdd0811318f0cf078b78bfc=<VALUE>; XSRF-TOKEN=<VALUE>; myapp_session=<VALUE>'
```
- [ ] Verify session saved to: `~/.config/httpie/sessions/dashboard.nationalpid.com/prospect-id.json`

### 1.3 Test All 6 JSON Endpoints
Run these commands and verify they return JSON (not HTML):

```bash
# 1. Get inbox threads (returns all threads with assignment status)
http --session=prospect-id --form POST https://dashboard.nationalpid.com/videoteammsg/getvideomailthreads \
  _token='<XSRF_TOKEN>' limit=50 type='inbox'

# 2. Get student details (before assignment)
http --session=prospect-id --form POST https://dashboard.nationalpid.com/videoteammsg/getstudentdetails \
  _token='<XSRF_TOKEN>' contactid=1458435

# 3. Assign thread
http --session=prospect-id --form POST https://dashboard.nationalpid.com/videoteammsg/assignthread \
  _token='<XSRF_TOKEN>' messageid=12489 videoscoutassignedto=1408164 \
  videoprogressstage='In Queue' videoprogressstatus='HUDL'

# 4. Get thread messages
http --session=prospect-id GET https://dashboard.nationalpid.com/videoteammsg/getthreadmessages \
  messageid==12489 _token==<XSRF_TOKEN>

# 5. Get video progress list
http --session=prospect-id --form POST https://dashboard.nationalpid.com/videoteammsg/videoprogress \
  _token='<XSRF_TOKEN>' limit=50

# 6. Update video deliverable
http --session=prospect-id --form POST https://dashboard.nationalpid.com/videoteammsg/videoupdate \
  _token='<XSRF_TOKEN>' taskid=12345 stage='Done' status='HUDL'
```

- [ ] All 6 endpoints return valid JSON
- [ ] Session cookies work for authentication
- [ ] No 401/403 errors

---

## PHASE 2: Replace Python Backend (30 minutes)

### 2.1 Delete All Selenium/Playwright Code
File: `/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/npid_automator_complete.py`

- [ ] Remove all `from selenium` imports
- [ ] Remove all Selenium WebDriver initialization code
- [ ] Remove all `find_element`, `click()`, `wait` logic
- [ ] Remove ChromeDriver/webdriver-manager dependencies
- [ ] Keep only the Flask/HTTP server wrapper code

### 2.2 Implement HTTPie Subprocess Wrapper
Add to `npid_automator_complete.py`:

```python
import subprocess
import json
import os

class HTTPieClient:
    def __init__(self, session_name='prospect-id'):
        self.session = session_name
        self.base_url = 'https://dashboard.nationalpid.com'
    
    def _get_csrf_token(self):
        """Extract XSRF-TOKEN from HTTPie session file"""
        session_path = os.path.expanduser(
            f'~/.config/httpie/sessions/dashboard.nationalpid.com/{self.session}.json'
        )
        with open(session_path) as f:
            data = json.load(f)
            cookies = data.get('cookies', {})
            return cookies.get('XSRF-TOKEN', '')
    
    def post(self, endpoint, **form_data):
        """Make POST request with form data"""
        token = self._get_csrf_token()
        form_data['_token'] = token
        
        cmd = ['http', '--session=' + self.session, '--form', 'POST',
               self.base_url + endpoint]
        
        for key, value in form_data.items():
            cmd.append(f'{key}={value}')
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        return json.loads(result.stdout)
    
    def get(self, endpoint, **params):
        """Make GET request with query params"""
        token = self._get_csrf_token()
        params['_token'] = token
        
        cmd = ['http', '--session=' + self.session, 'GET',
               self.base_url + endpoint]
        
        for key, value in params.items():
            cmd.append(f'{key}=={value}')
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        return json.loads(result.stdout)
```

- [ ] HTTPieClient class added
- [ ] CSRF token extraction working
- [ ] POST and GET methods implemented

### 2.3 Replace All Automation Functions

```python
client = HTTPieClient()

def get_inbox_threads(limit=50):
    """Replace Selenium scraping with REST API"""
    return client.post('/videoteammsg/getvideomailthreads', 
                       limit=limit, type='inbox')

def get_assignment_modal_data(contact_id):
    """Replace Selenium modal scraping with REST API"""
    return client.post('/videoteammsg/getstudentdetails',
                       contactid=contact_id)

def assign_thread(message_id, contact_id, stage, status):
    """Replace Selenium form submission with REST API"""
    return client.post('/videoteammsg/assignthread',
                       messageid=message_id,
                       videoscoutassignedto=1408164,  # Your user ID
                       videoprogressstage=stage,
                       videoprogressstatus=status)

def get_thread_messages(message_id):
    """Get email thread content"""
    return client.get('/videoteammsg/getthreadmessages',
                      messageid=message_id)

def get_video_progress(limit=50):
    """Get video progress page data"""
    return client.post('/videoteammsg/videoprogress',
                       limit=limit)

def update_video_deliverable(task_id, stage, status):
    """Update video task stage/status"""
    return client.post('/videoteammsg/videoupdate',
                       taskid=task_id,
                       stage=stage,
                       status=status)
```

- [ ] All 6 functions replaced with HTTPie calls
- [ ] No Selenium code remains in functions
- [ ] Return values are JSON objects

### 2.4 Test Python Backend Directly

```bash
cd /Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native
python3 -c "
from npid_automator_complete import get_inbox_threads
threads = get_inbox_threads(10)
print(f'Found {len(threads)} threads')
print(threads[0] if threads else 'No threads')
"
```

- [ ] Python functions return data without errors
- [ ] No Selenium/Chrome processes spawned
- [ ] JSON responses match expected structure

---

## PHASE 3: Update Raycast Commands (20 minutes)

### 3.1 Verify HTTP Server Still Works
File: `/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/session_stream_server.py`

- [ ] HTTP server routes to new HTTPie-based functions
- [ ] SSE streaming still works for inbox threads
- [ ] Error handling updated for HTTP response format

### 3.2 Test Each Raycast Command

```bash
# Rebuild extension
cd /Users/singleton23/Raycast/prospect-pipeline
npm run build
```

Test in Raycast:
- [ ] `assign-videoteam-inbox` - Shows assignable threads (<2 seconds)
- [ ] `read-videoteam-inbox` - Shows assigned threads
- [ ] `active-tasks` - Shows video progress tasks
- [ ] `video-updates` - Updates task stage/status

### 3.3 Remove Selenium Fallback Logic
- [ ] Search codebase for any remaining Selenium imports
- [ ] Remove any "try Selenium if HTTP fails" fallback code
- [ ] Update error messages to reflect HTTP-only approach

---

## PHASE 4: Cleanup (10 minutes)

### 4.1 Delete Unused Files
- [ ] Remove `playwright_state.json` (no longer needed)
- [ ] Remove any Selenium helper scripts
- [ ] Remove webdriver-manager from requirements.txt
- [ ] Remove selenium from requirements.txt

### 4.2 Update Documentation
- [ ] Update README.md with HTTPie setup instructions
- [ ] Document the 6 REST API endpoints
- [ ] Remove Selenium/Playwright setup steps
- [ ] Add HTTPie session refresh instructions (once per year)

### 4.3 Document Changes in Kiro
Add to `.kiro/specs/FIXES-APPLIED.md`:
```markdown
## October 9, 2025 - Complete Migration to REST API

**Problem**: Using Selenium to scrape HTML and click buttons (slow, unreliable, aria-hidden issues)

**Discovery**: Prospect ID has full REST API with cookie authentication

**Solution**: 
- Replaced all Selenium automation with HTTPie HTTP requests
- 6 JSON endpoints handle all operations (inbox, assignment, video progress)
- HTTPie session stores 1-year remember token for persistent auth
- No browser needed, 10-100x faster

**Results**:
- Inbox loads: 15 seconds → <2 seconds
- Assignment: Works reliably, no aria-hidden issues
- Zero Chrome processes running
- Simple HTTP calls, easy to debug

**Files Changed**:
- npid_automator_complete.py: Replaced Selenium with HTTPieClient
- All Raycast commands: Now use REST API via HTTP wrapper
- requirements.txt: Removed selenium, webdriver-manager

**Breaking Changes**: None - same Raycast command interface, different backend
```

- [ ] Documentation updated
- [ ] Git commit with clear message
- [ ] Archive old Selenium code for reference (git tag)

---

## SUCCESS CRITERIA

✅ **Performance**: Inbox loads in <2 seconds (vs 15+ with Selenium)  
✅ **Reliability**: No aria-hidden button issues, no DOM selector failures  
✅ **Simplicity**: 100 lines of HTTPie code vs 500+ lines of Selenium  
✅ **Maintainability**: REST API endpoints don't change like HTML selectors  
✅ **Resources**: Zero Chrome processes, minimal memory usage  
✅ **Authentication**: HTTPie session persists for 1 year (remember token)  

---

## ROLLBACK PLAN

If REST API migration fails:
1. `git checkout main` (before migration)
2. Selenium code is still in git history
3. `playwright_state.json` backup in `/tmp/` if needed

---

# DEPRECATED: Supabase Caching Implementation for NPID Inbox

## Context
- **Current State**: Direct Python Playwright scraping on every load (15 seconds)
- **Problem**: Too slow for good UX, users want instant inbox loading
- **Root Cause**: Removed Supabase previously because scraper wasn't working (selectors were wrong)
- **Now**: Scraper works correctly (fixed `.tit_line1` subject extraction, plus icon selector, etc.)
- **Solution**: Restore Supabase as cache layer with 90-minute background sync

## Architecture (Hybrid - Option 3)
```
┌─────────────────┐     90 min cron      ┌──────────────┐
│ Python Scraper  │ ──────────────────→ │   Supabase   │
│ (Playwright)    │   fills inbox table  │   (Cache)    │
└─────────────────┘                      └──────────────┘
                                                ↓
                                         instant read (<1s)
                                                ↓
                                         ┌──────────────┐
                                         │   Raycast    │
                                         │  Extension   │
                                         └──────────────┘
                                                ↓
                                         assignment action
                                                ↓
                                         ┌──────────────┐
                                         │ Python Live  │
                                         │ (Modal/Form) │
                                         └──────────────┘
```

## Implementation Tasks

- [ ] 1. Create Supabase schema for inbox threads
  - Design `npid_inbox_threads` table with proper columns
  - Add indexes for fast queries (email, timestamp, status)
  - Include `can_assign`, `status`, `subject`, `preview`, etc
  - Set up RLS policies if needed
  - _Requirements: Fast read access, proper data types_

- [ ] 2. Update Python scraper to write to Supabase
- [ ] 2.1 Add Supabase client to Python scraper
  - Install supabase-py package in venv
  - Configure Supabase URL and anon key from env
  - Create upsert logic for inbox threads
  - Handle connection errors gracefully
  - _Requirements: Reliable data sync_

- [ ] 2.2 Implement batch upsert logic
  - Scrape threads as currently working
  - Batch upsert to Supabase (not one-by-one)
  - Handle duplicates (upsert by thread_id)
  - Log sync status and errors
  - _Requirements: Efficient bulk operations_

- [ ] 3. Set up 90-minute cron job
  - Create standalone Python script for cron execution
  - Add error handling and retry logic
  - Set up cron schedule (*/90 * * * *)
  - Add logging to track sync runs
  - Handle timezone considerations
  - _Requirements: Reliable background sync_

- [ ] 4. Update Raycast extension to read from Supabase
- [ ] 4.1 Restore Supabase queries in inbox commands
  - Update `loadInboxMessages()` to query Supabase
  - Filter by `can_assign = true` for assign command
  - Filter by `status = 'assigned'` for read command
  - Remove direct Python calls for inbox loading
  - _Requirements: Fast UI load times_

- [ ] 4.2 Add fallback and refresh logic
  - Show cached data immediately
  - Add manual "Refresh from NPID" action
  - Handle empty cache gracefully
  - Display last sync timestamp
  - _Requirements: User awareness of data freshness_

- [ ] 5. Keep Python direct calls for assignments
  - Verify `fetchAssignmentModal()` still calls Python
  - Verify `assignVideoTeamMessage()` still calls Python
  - Ensure modal data is fetched fresh for each assignment
  - No changes needed here (keep as-is)
  - _Requirements: Real-time assignment actions_

- [ ] 6. Test and validate complete flow
  - Test inbox load speed (<2 seconds)
  - Verify assignment modal still works
  - Confirm 90-minute sync updates data
  - Test with stale cache vs fresh sync
  - Validate data consistency
  - _Requirements: All functionality working correctly_

## Success Criteria
- ✅ Inbox loads in <2 seconds (vs current 15 seconds)
- ✅ Assignment modal opens with live data
- ✅ Cron job runs reliably every 90 minutes
- ✅ Data stays fresh enough for workflow
- ✅ Users can force refresh if needed

## Technical Notes
- **Supabase Table**: Use UUID for primary key, index on `thread_id` (NPID message ID)
- **Cron Location**: Run on user's local machine or server (not Raycast)
- **Error Handling**: Log failures but don't break UI if Supabase unreachable
- **Data Retention**: Keep threads for 7-30 days, auto-cleanup old data

## References
- Web search confirms Supabase as cache layer is standard pattern
- React Query/SWR can add client-side caching on top if needed later
- 90-minute intervals are reasonable for this use case

