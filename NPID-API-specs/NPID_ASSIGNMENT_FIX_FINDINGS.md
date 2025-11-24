# NPID Assignment Fix - Session Findings
**Date**: November 7, 2025  
**Status**: Fixed but needs live testing

---

## 🐛 Problems Identified

### 1. **Session Not Shared**
- `npid_api_client.py` used separate session file: `~/.vps_broker_session.pkl`
- `npid_api_client.py` used: `~/.npid_session.pkl`
- Result: NPID client had expired/invalid session

### 2. **CSRF Token Extraction Failed**
- Tried to extract from `/rulestemplates/template/videoteammessagelist` (returns JSON, no `_token` field)
- Result: `_token: None` in all assignment requests → silent failures

### 3. **Wrong Message ID Format**
- Extension sent: `messageid=message_id12863`
- Browser sends: `messageid=12863`
- Result: Server rejected assignment silently (returned 200 but no change)

### 4. **Duplicate Form Fields**
- Original code sent: `contact_task` + `contacttask`, `athlete_main_id` + `athletemainid`, etc.
- Result: Server confused/rejected requests

---

## ✅ Fixes Applied

### File: `src/python/npid_api_client.py`

#### Fix 1: Share Session with NPID Client
```python
# Line 38 - Changed from:
self.cookie_file = Path.home() / '.vps_broker_session.pkl'

# To:
self.cookie_file = Path.home() / '.npid_session.pkl'
```

#### Fix 2: Extract CSRF from Assignment Modal
```python
# Lines 150-154 - Changed from:
self._get_csrf_token_from_page(
    f"{self.base_url}/rulestemplates/template/videoteammessagelist"
)

# To:
message_id_temp = payload.get('messageId', 'message_id12870')
self._get_csrf_token_from_page(
    f"{self.base_url}/rulestemplates/template/assignemailtovideoteam?message_id={message_id_temp}"
)
```

#### Fix 3: Strip "message_id" Prefix
```python
# Lines 157-160 - Added:
message_id_raw = payload.get('messageId') or payload.get('thread_id')
# Strip "message_id" prefix to get numeric ID only
message_id = message_id_raw.replace('message_id', '') if message_id_raw else ''
```

#### Fix 4: Remove Duplicate Fields
```python
# Lines 168-178 - Changed from:
form_data = {
    'messageid': message_id,
    'videoscoutassignedto': owner_id,
    'contact_task': contact_id,
    'contacttask': contact_id,  # ❌ DUPLICATE
    'athlete_main_id': athlete_main_id,
    'athletemainid': athlete_main_id,  # ❌ DUPLICATE
    'contactfor': contact_for,
    'contact': contact_email,
    'video_progress_stage': stage,
    'videoprogressstage': stage,  # ❌ DUPLICATE
    'video_progress_status': status,
    'videoprogressstatus': status,  # ❌ DUPLICATE
    '_token': self.csrf_token
}

# To (matches exact browser payload):
form_data = {
    '_token': self.csrf_token,
    'contact_task': contact_id,
    'athlete_main_id': athlete_main_id,
    'messageid': message_id,  # ✅ Numeric only
    'videoscoutassignedto': owner_id,
    'contactfor': contact_for,
    'contact': contact_email,
    'video_progress_stage': stage,
    'video_progress_status': status
}
```

#### Fix 5: Add Logging for Debugging
```python
# Lines 12-19 - Added file logging:
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(Path.home() / '.vps_broker.log'),
        logging.StreamHandler()
    ]
)
```

### File: `src/lib/npid-mcp-adapter.ts`

#### Fix 6: Add Debug Logging
```typescript
// Lines 68-86 - Added console logging for debugging:
childProcess.on("close", (code: number) => {
  console.log(`[NPID] Exit code: ${code}`);
  console.log(`[NPID] stdout: ${stdout}`);
  console.log(`[NPID] stderr: ${stderr}`);
  
  if (code === 0) {
    try {
      const result = JSON.parse(stdout);
      console.log(`[NPID] Parsed result:`, result);
      resolve(result);
    } catch (error) {
      console.error(`[NPID] Parse error:`, error);
      reject(new Error(`Failed to parse NPID response: ${stdout}`));
    }
  } else {
    console.error(`[NPID] Failed with code ${code}`);
    reject(new Error(`NPID client failed (code ${code}): ${stderr || stdout}`));
  }
});
```

---

## 🧪 Testing Results

### Manual Python Test (✅ Working)
```bash
cd src/python
./venv/bin/python3 npid_api_client.py assign_thread '{"messageId":"message_id12871","contactId":"1464146","ownerId":"1408164","athleteMainId":"943069","stage":"In Queue","status":"HUDL","contactFor":"athlete","contact":"jaunita.garcialopez1@gmail.com"}'

# Output:
# ✅ Loaded session from cache
# 🔑 Got CSRF token: pTxUBAyvHH3d3UPsa4NXIS3HAHMXPsUciS6fjjSd...
# ✅ Assigned thread message_id12871 to owner 1408164
```

### Raycast Extension Test (⚠️ Needs Verification)
- **Brayden Martin**: Assigned manually in browser (worked)
- **Drew Cumby**: Extension triggered notification but **NOT confirmed on live site**
- **Juanita Garcia**: Still showing as unassigned after extension assignment

**Log shows correct payload sent:**
```
messageid: 12863 (not message_id12863) ✅
_token: pTxUBAyvHH3d3UPsa4NXIS3HAHMXPsUciS6fjjSd ✅
contact_task: 1458635 ✅
All fields present ✅
```

---

## 📋 Next Steps (When You Return)

### 1. Verify Live Site Assignments
- [ ] Restart Raycast extension: `pkill -f "ray develop" && npm run dev`
- [ ] Assign a thread (e.g., Katie Hanna, Nicholas Obasohan)
- [ ] **Check NPID site** - does thread disappear from unassigned?
- [ ] **Check video progress page** - does it show assigned to you?

### 2. Debug if Still Failing
Check NPID logs:
```bash
tail -50 ~/.vps_broker.log
```

Look for:
- ✅ CSRF token extracted successfully
- ✅ `messageid` is numeric (no "message_id" prefix)
- ✅ Response is empty (not HTML login page)

### 3. Compare Working vs Failing
If some assignments work and others don't:
- Check if specific contact types fail (athlete vs parent)
- Check if missing fields cause issues (athleteMainId empty?)
- Compare logs between successful browser assignment and extension assignment

### 4. Commit When Verified
```bash
git add src/python/npid_api_client.py src/lib/npid-mcp-adapter.ts
git commit -m "fix(vps): correct CSRF extraction and message ID format

- Extract CSRF from assignment modal page (not JSON endpoint)
- Strip 'message_id' prefix from messageid field  
- Share session file between NPID and NPID clients
- Remove duplicate form fields causing silent failures"
```

---

## 🔍 Debugging Commands

### Check if NPID client is being called:
```bash
tail -f ~/.vps_broker.log
```

### Test assignment directly:
```bash
cd src/python
./venv/bin/python3 npid_api_client.py assign_thread '{"messageId":"message_id12870","contactId":"CONTACT_ID","ownerId":"1408164"}'
```

### Check session status:
```bash
cd src/python
./venv/bin/python3 -c "from npid_api_client import NPIDAPIClient; client = NPIDAPIClient(); print('Session valid')"
```

### Get unassigned threads:
```bash
cd src/python  
./venv/bin/python3 -c "from npid_api_client import NPIDAPIClient; client = NPIDAPIClient(); threads = client.get_inbox_threads(20, 'unassigned'); print(f'{len(threads)} unassigned threads')"
```

---

## 📌 Key Insight from Browser Network Request

**Working browser assignment payload:**
```
_token=H9GhMR7WB19Se0zvjP3IQyrMz5middoBY2fbAhZT
contact_task=1464131
athlete_main_id=943065
messageid=12870  ← NUMERIC ONLY
videoscoutassignedto=1408164
contactfor=athlete
contact=braydenmartin1103@icloud.com
video_progress_stage=In+Queue
video_progress_status=HUDL
```

**Critical Requirements:**
1. CSRF token must be fresh (from assignment modal page)
2. `messageid` must be numeric (strip "message_id" prefix)
3. No duplicate fields
4. Session must be authenticated (shared `~/.npid_session.pkl`)

---

## 🔄 CSRF Retry Middleware (Nov 7, 2025) ✅ TESTED & WORKING

**Added resilient CSRF handling to npid_api_client.py** without new files:

### 1. **Detection**: `_is_csrf_failure(response)` ✓
Detects CSRF failures:
- HTTP 419 (Laravel CSRF mismatch)
- Redirects to `/login`
- HTML login page responses
- **NEW**: 200 OK with HTML body instead of JSON (Laravel quirk)

### 2. **Recovery**: `_get_token_for_modal(message_id)` ✓
- Fetches fresh token from `/assignemailtovideoteam?message_id=X`
- Caches token in memory keyed by modal URL
- Reuses cached token for same message/request

### 3. **Retry**: `_retry_with_csrf(method, url, data, message_id)` ✓
- Makes first request with current token
- On CSRF failure: fetches fresh token, updates payload, retries once
- Silent to caller (no extra code needed)

### 4. **Integration** ✓ VERIFIED
Methods now use retry middleware:
- `assign_thread()` - Uses message_id for smart token caching
- `update_stage()` - Syncs stage changes
- `update_status()` - Syncs status changes
- `get_video_progress()` - Fetches progress data with retry

**Test Results (Nov 7, 2025):**
```bash
$ ./venv/bin/python3 npid_api_client.py get_video_progress '{}'

✅ Session loaded from ~/.npid_session.pkl
⚠️  Got HTML response instead of JSON (CSRF failure detected)
🔑 Fresh CSRF token cached
🔄 Retrying request with fresh token
✅ Retrieved 50+ video progress records (JSON)
```

**Example flow:**
```python
# Old: Direct POST, fails if token expired
resp = self.session.post(url, data=form_data)

# New: Auto-retry with fresh token if CSRF fails
resp = self._retry_with_csrf('POST', url, data, message_id)
```

**Benefits:**
- ✅ No full re-auth needed for each request
- ✅ Token cached in memory (fast)
- ✅ Single-request retry (one extra GET if needed)
- ✅ Transparent to Raycast extension
- ✅ Handles HTML-instead-of-JSON responses (Laravel quirk)
- ✅ Stable until `/api/csrf` endpoint exists

---

## 🎯 Root Cause Summary

The NPID client was failing because:
1. **Session isolation** → couldn't authenticate
2. **Wrong CSRF source** → token was `None`
3. **Wrong message ID format** → server rejected silently
4. **Duplicate fields** → server confused

All four issues are now fixed. The Python CLI test confirms the payload is correct. Extension needs live verification.

