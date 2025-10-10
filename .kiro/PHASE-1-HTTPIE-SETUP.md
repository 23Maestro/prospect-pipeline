# REST API Migration - Phase 1 Complete

## ✅ Phase 1: HTTPie Session Setup

**Created**: `/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/setup-httpie-session.sh`

### Run the Setup Script

```bash
cd /Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native
./setup-httpie-session.sh
```

**What it does:**
1. Guides you through extracting cookies from Chrome DevTools
2. Creates HTTPie session at `~/.config/httpie/sessions/dashboard.nationalpid.com/prospect-id.json`
3. Tests the session against the inbox endpoint
4. Verifies authentication works

### Manual Cookie Extraction Steps

1. **Open Chrome** → `https://dashboard.nationalpid.com`
2. **Open DevTools** (Cmd+Option+I)
3. **Application tab** → Cookies → dashboard.nationalpid.com
4. **Copy these 3 cookies**:
   - `remember_82e5d2c56bdd0811318f0cf078b78bfc` (1-year token)
   - `XSRF-TOKEN` (CSRF protection)
   - `myapp_session` (current session)

### Test Commands After Setup

Once session is created, test all 6 endpoints:

```bash
# 1. Get inbox threads
http --session=prospect-id --form POST \
  https://dashboard.nationalpid.com/videoteammsg/getvideomailthreads \
  _token='YOUR_XSRF_TOKEN' thread_status=all assigned_to= search_keyword=

# 2. Get student details
http --session=prospect-id --form POST \
  https://dashboard.nationalpid.com/videoteammsg/getstudentdetails \
  _token='YOUR_XSRF_TOKEN' thread_id=12489

# 3. Assign thread  
http --session=prospect-id --form POST \
  https://dashboard.nationalpid.com/videoteammsg/assignthread \
  _token='YOUR_XSRF_TOKEN' thread_id=12489 editor_id=1408164 \
  stage='In Queue' status='HUDL'

# 4. Get thread messages
http --session=prospect-id GET \
  'https://dashboard.nationalpid.com/videoteammsg/getthreadmessages?thread_id=12489'

# 5. Get video progress
http --session=prospect-id --form POST \
  https://dashboard.nationalpid.com/videoteammsg/videoprogress \
  _token='YOUR_XSRF_TOKEN'

# 6. Update video deliverable
http --session=prospect-id --form POST \
  https://dashboard.nationalpid.com/videoteammsg/videoupdate \
  _token='YOUR_XSRF_TOKEN' athlete_id=123 video_id=456 \
  deliverable_type=YOUTUBE deliverable_link='https://youtu.be/xyz' status=Delivered
```

### Success Criteria

✅ Session file exists at `~/.config/httpie/sessions/dashboard.nationalpid.com/prospect-id.json`  
✅ Test command returns JSON (not HTML)  
✅ No 401 Unauthorized errors  
✅ No 403 Forbidden errors  

### Next: Phase 2

Once Phase 1 is complete and tested, proceed to Phase 2:
- Replace Python Selenium code with HTTPie subprocess calls
- Create `npid_rest_client.py` module
- Update all automation functions

---

**Status**: Ready to execute Phase 1  
**Action Required**: Run `./setup-httpie-session.sh` to create session
