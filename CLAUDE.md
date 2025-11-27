# Prospect Pipeline - Claude Instructions

## 🚨 CRITICAL: NPID API Implementation

**BEFORE implementing ANY NPID API call, use the `npid-api-calls` skill:**
- Skill file: `.claude/skills/npid-api-calls.md`
- Enforces checking Python reference code first
- Prevents HTML/JSON response confusion
- Ensures correct headers (`X-Requested-With: XMLHttpRequest`)

## 🚨 CRITICAL API INVARIANTS

### athlete_main_id Rule (VERIFIED 2025-11-15)

`athlete_main_id` is **NOT AVAILABLE** from standard API endpoints.

**Verified Facts:**
- `/videoteammsg/videoprogress` (search) - does NOT return athlete_main_id
- `/videoteammsg/videomailprogress/{id}` - does NOT contain athlete_main_id input
- Assignment modal - contains empty athlete_main_id field
- `/template/videotemplate/videoseasons` - **ACCEPTS athlete_id as athlete_main_id parameter**

**Working Solution:**
- Use `athlete_id` as fallback for `athlete_main_id` parameter
- Seasons endpoint returns **HTML `<option>` elements**, NOT JSON
- Parse response with BeautifulSoup/Cheerio, not JSON.parse()

**Full docs:**
- Python implementation: `src/python/npid_api_client.py:606`
- API Contract: `NPID-API-specs/ATHLETE_MAIN_ID_INVARIANT.md`

---

## 🚨 CRITICAL: Video Submission (VERIFIED 2025-11-27)

**Skill:** `.claude/skills/npid-video-submission.md`

**Flow for 100s of Athletes:**
1. **Endpoint 2 (GET form):** Fetches form with CSRF token
   - URL: `/template/template/addvideoform?athleteid={id}&sport_alias={sport}&athlete_main_id={mainId}`
   - Returns: HTML form with hidden `_token`

2. **Endpoint 3 (POST seasons):** Fetches season options for selected video type
   - URL: `/API/scout-api/video-seasons-by-video-type`
   - Body: `athlete_id`, `sport_alias`, `video_type`, `athlete_main_id`, `_token`
   - **CRITICAL:** Returns HTML `<option>` elements, NOT JSON
   - Parse with BeautifulSoup/regex to extract season value (e.g., `highschool:18249`)

3. **Endpoint 4 (POST submit):** Submits video
   - URL: `/athlete/update/careervideos/{athleteId}`
   - Body: All form fields + `athlete_main_id`
   - Response: JSON `{"success":"true"}`

**Nothing is Hardcoded:**
- Sport aliases (football, basketball, etc.) - from athlete record
- Video types (Full Season, Partial, Single Game, Skills) - user selects from dropdown
- Seasons - fetched dynamically via Endpoint 3
- Athlete IDs - parameterized input
- CSRF tokens - extracted per request from form
- URL validation - parse for youtube/hudl format, user provides

**Button/Form Selectors (2026 Re-selenium Implementation):**
```
Add/Manage Modal Trigger:
#profile_main_section > div:nth-child(3) > div > div > div:nth-child(1) > div > div.col-md-4.col-xs-6.col-sm-6.text-right > button

Form Elements:
#newVideoLink - URL input (remove readonly before set)
#videoType - Video type dropdown (user selects)
#videoType > option:nth-child(N) - Option elements
#newVideoSeason - Season dropdown (remove disabled, populate from Endpoint 3)
#addnewvideo > div:nth-child(13) > label > input[type=checkbox] - Approve video
#addnewvideo > div:nth-child(15) > div > button.btn.btn-primary - Submit form
```

**Verified Behavior:**
- Endpoint 3 returns HTML not JSON (parse response text, not JSON.parse)
- Season values are colon-separated (`highschool:18249`)
- Form uses `application/x-www-form-urlencoded`, not JSON
- Both POST endpoints require `X-Requested-With: XMLHttpRequest` header
- `athlete_main_id` is required in both endpoints

---

## Recent Updates
- MCP Server add updates the recent changes based on checklist
- prospectID 502
- codex consolidation ^
- Video submission endpoints verified and documented (2025-11-27)
- Pending: JSON API endpoint for video uploads (currently form-based legacy)
