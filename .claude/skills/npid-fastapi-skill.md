---
name: npid-fastapi-skill
description: Enforce strict legacy-Laravel rules when editing npid-api-layer FastAPI code - prevents modernization and ensures translator pattern compliance
---

# NPID FastAPI Layer - Legacy-Laravel Enforcement Skill

## MANDATORY PRE-IMPLEMENTATION CHECKLIST

Before writing ANY code in `npid-api-layer/`, you MUST:

- [ ] Verify working directory is `npid-api-layer/`
- [ ] Check Python reference implementation first (`src/python/npid_api_client.py`)
- [ ] Review existing translator methods in `app/translators/legacy.py`
- [ ] Confirm you understand the translator pattern
- [ ] NEVER bypass the translator pattern

**If ANY checkbox is unchecked, STOP and complete it before proceeding.**

---

## 1. CRITICAL INVARIANTS

### All Laravel Write Calls MUST Use:

✅ **Form Encoding:** `application/x-www-form-urlencoded` (NEVER `application/json`)
✅ **AJAX Header:** `X-Requested-With: XMLHttpRequest` (ALWAYS required)
✅ **CSRF Token:** Fresh `_token` scraped from form/page per request
✅ **Session Cookies:** Active session from `~/.npid_session.pkl`
✅ **Parameter Names:** Exact names Laravel expects (snake_case, NOT camelCase)
✅ **Session Wrapper:** Use `session.post()` method (auto-injects CSRF token)

### Response Handling Rules:

**Laravel responses are unpredictable:**
- May return HTML, JSON, or nested JSON strings
- May return different formats for same endpoint based on headers
- Parse HTML with BeautifulSoup/regex (see `legacy.py:144-184`)
- Handle nested response garbage (see `legacy.py:97-141`)
- NEVER assume JSON format without checking

### Parameter Naming Convention:

**ALWAYS use Laravel's exact parameter names:**
- `athlete_id` (NOT `athleteId`)
- `sport_alias` (NOT `sportAlias`)
- `video_type` (NOT `videoType`)
- `athlete_main_id` (NOT `athleteMainId`)
- `video_msg_id` (NOT `videoMsgId`)

**Documented exceptions (quirky Laravel fields):**
- `newVideoLink` (CamelCase)
- `newVideoSeason` (CamelCase, always empty)
- `schoolinfo[add_video_season]` (Array notation for actual season)

### TypeScript ↔ FastAPI ↔ Laravel Value Conversion

**CRITICAL: Pydantic does NOT auto-convert enum values**

**Pattern (VERIFIED 2025-12-07):**
```
TypeScript (snake_case) → FastAPI Enum (snake_case) → Translator (converts) → Laravel (Title Case)
```

**Example - Video Stage:**
1. **TypeScript sends:** `{ stage: "on_hold" }`
2. **Pydantic Enum accepts:** `VideoStage.ON_HOLD = "on_hold"`
3. **Translator converts:** `"on_hold" → "On Hold"`
4. **Laravel receives:** `video_progress_stage: "On Hold"`

**If enum values don't match TypeScript:**
- Result: `422 Unprocessable Entity`
- Cause: Pydantic validates `"on_hold"` against enum values, finds no match
- Fix: Enum must use snake_case values, translator converts to Title Case

**Before implementing ANY enum field:**
- [ ] Check TypeScript code: What format does it send?
- [ ] Check Python client: What format does Laravel expect?
- [ ] Enum values match TypeScript format (NOT Laravel)
- [ ] Translator converts enum.value to Laravel format

**Verification:**
```bash
# Check TypeScript normalization
grep -A 10 "normalizeStage\|normalizeStatus" src/video-progress.tsx

# Check Python normalization
grep -A 10 "_normalize.*for_api" src/python/npid_api_client.py

# Check translator conversion
grep -A 10 "stage_map\|status_map" npid-api-layer/app/translators/legacy.py
```

### Video Progress Caching Strategy

**Problem:** Laravel `/videoteammsg/videoprogress` returns 1699+ tasks (slow query)

**Solution:** Local SQLite cache with optimistic updates

**Cache Location:** `~/.prospect-pipeline/video-progress-cache.sqlite`

**Pattern (src/lib/video-progress-cache.ts):**
```typescript
// On initial load: Fetch from API → Update cache
await upsertTasks(tasks);

// On status/stage/due date change:
// 1. Update cache immediately (optimistic)
await updateCachedTaskStatusStage(task.id, { stage: newStage });

// 2. Update UI from cache (instant feedback)
const updated = await getCachedTasks();
setTasks(updated);

// 3. Send update to API (background)
await apiFetch(`/video/${task.id}/stage`, {...});

// 4. NO need to reload all 1699 tasks
```

**Current Issue (2025-12-07):**
- `video-progress.tsx` calls `loadTasks()` after every change
- Reloads ALL 1699 tasks from Laravel (slow)
- Cache exists but isn't used for updates

**Fix:**
```typescript
// Instead of:
onStatusUpdate();  // → loadTasks() → fetch all 1699 tasks

// Do:
// 1. Update cache
await updateCachedTaskStatusStage(task.id, { stage: newStage });

// 2. Update local state
setTasks(tasks.map(t =>
  t.id === task.id ? { ...t, stage: newStage } : t
));

// 3. Optional: Background sync
// (only if you need to validate Laravel accepted it)
```

**Benefits:**
- Instant UI updates (no 5-second Laravel query)
- Works offline
- Reduces Laravel load
- Cache invalidation: 30-minute TTL or manual refresh

---

## 2. THE TRANSLATOR PATTERN

### Core Architecture

The npid-api-layer project is a **translation layer**:
```
Raycast Extension (clean JSON) → FastAPI Layer → Legacy Laravel (form-encoded, HTML/JSON hybrid)
```

**Single Source of Truth:**
- `app/translators/legacy.py` - ALL Laravel interaction logic
- `app/session.py` - Session management, CSRF, auth headers
- `app/routers/*.py` - Clean FastAPI endpoints (MUST use translator)

### The Pattern - MUST Follow Exactly:

```python
from app.translators.legacy import LegacyTranslator

translator = LegacyTranslator()

# Step 1: Request translation (clean → legacy)
endpoint, form_data = translator.{method}_to_legacy(clean_request)

# Step 2: Execute via session (handles CSRF, headers, cookies)
response = await session.post(endpoint, data=form_data)

# Step 3: Response parsing (legacy → clean)
result = translator.parse_{method}_response(response.text)
```

### What This Pattern Achieves:

1. **Isolation:** All Laravel quirks in ONE file (`legacy.py`)
2. **Maintainability:** Laravel changes = update ONE method
3. **Testability:** Mock translator, not scattered logic
4. **Documentation:** Parameter names documented in translator
5. **Type Safety:** Pydantic models at API boundary

---

## 3. FORBIDDEN ACTIONS

### ❌ NEVER Do These:

**DO NOT bypass translator:**
```python
# ❌ WRONG - Inline form construction
form_data = {
    "_token": session.csrf_token,
    "athlete_id": payload.athlete_id
}
response = await client.post(url, data=form_data)
```

**DO NOT use JSON bodies:**
```python
# ❌ WRONG - Laravel won't accept JSON
response = await client.post(url, json=payload.dict())
```

**DO NOT inline HTML parsing:**
```python
# ❌ WRONG - Parsing in router
from bs4 import BeautifulSoup
soup = BeautifulSoup(response.text, 'html.parser')
```

**DO NOT bypass session wrapper:**
```python
# ❌ WRONG - Direct client usage
response = await client.post(url, data=form_data)
```

**DO NOT rename parameters "for consistency":**
```python
# ❌ WRONG - Laravel expects snake_case
form_data = {"athleteId": id}  # Laravel won't recognize this
```

**DO NOT assume JSON responses:**
```python
# ❌ WRONG - May return HTML
result = response.json()  # Will fail if HTML returned
```

**DO NOT remove HTML scrapers:**
```python
# ❌ WRONG - "Modernizing" by removing parsing
# Comment: "Removed HTML parsing, endpoint now returns JSON"
# Reality: Endpoint still returns HTML, code broken
```

**DO NOT add REST abstractions:**
```python
# ❌ WRONG - Laravel is NOT RESTful
# Don't create generic REST clients, bearer auth, JWT tokens, etc.
```

### Complete Forbidden List:

❌ NEVER generate code that allows Raycast to contact Laravel directly
❌ NEVER use `application/json` content type for Laravel POSTs
❌ NEVER remove HTML scrapers ("modernize" to JSON assumptions)
❌ NEVER bypass session wrapper for direct `client.post()`
❌ NEVER add REST-style abstractions or "clean" parameter names
❌ NEVER use bearer auth, JWT, or modern auth patterns
❌ NEVER assume HTML response means "session expired"
❌ NEVER inline form data construction in routers
❌ NEVER inline HTML parsing in routers
❌ NEVER use `json=` parameter in POST requests

---

## 4. SKILL ABILITIES

### fix-seasons-endpoint

**Problem:**
- File: `npid-api-layer/app/routers/video.py:41-122`
- The `/seasons` proxy endpoint bypasses `LegacyTranslator`
- Duplicates HTML parsing logic inline

**Solution:**
- Refactor endpoint to use `translator.seasons_request_to_legacy()`
- Use `translator.parse_seasons_response()` for parsing
- Remove inline BeautifulSoup usage

**Verification:**
```bash
# Should find NO inline form construction in /seasons endpoint
grep -A 20 "@router.api_route\(\"/seasons\"" npid-api-layer/app/routers/video.py | grep "form_data = {"

# Should find translator usage
grep -A 20 "@router.api_route\(\"/seasons\"" npid-api-layer/app/routers/video.py | grep "LegacyTranslator"
```

### fix-duplicate-logic

**Problem:**
- HTML parsing logic duplicated across router files
- BeautifulSoup imported in routers (should only be in translator)

**Solution:**
- Move all parsing logic to `LegacyTranslator` class
- Remove BeautifulSoup imports from routers
- Add translator methods for any new parsing needs

**Verification:**
```bash
# Should find NO BeautifulSoup imports in routers
grep -n "from bs4 import BeautifulSoup" npid-api-layer/app/routers/*.py
grep -n "import BeautifulSoup" npid-api-layer/app/routers/*.py
```

### verify-session-stack

**Checks to perform:**

1. **Session loading:**
   - File: `npid-api-layer/app/session.py:59-78`
   - Loads from `~/.npid_session.pkl`
   - Fallback to credential login if session missing

2. **CSRF token refresh:**
   - File: `npid-api-layer/app/session.py:191-202`
   - Fetches from `/auth/login` page
   - Regex: `r'name="_token"\\s+value="([^"]+)"'`

3. **AJAX header:**
   - File: `npid-api-layer/app/session.py:46-49`
   - Global headers include `X-Requested-With: XMLHttpRequest`

4. **Auto-injection:**
   - File: `npid-api-layer/app/session.py:168-189`
   - `post()` method auto-injects `_token` (line 178)
   - `post()` method auto-injects `api_key` if available (line 182)

### enforce-legacy-rules

**Static checks to block violations:**

```bash
# Block: JSON bodies
grep -n "json=" npid-api-layer/app/routers/*.py

# Block: Direct client.post (should use session.post)
grep -n "client\.post" npid-api-layer/app/routers/*.py | grep -v "session"

# Block: Inline form construction
grep -n "form_data = {" npid-api-layer/app/routers/*.py

# Require: Translator usage
grep -n "LegacyTranslator()" npid-api-layer/app/routers/*.py
```

### verify-endpoint-correctness

**Verify endpoints match Python reference:**

| Endpoint Purpose | Expected URL | Python Reference |
|-----------------|--------------|------------------|
| Video submit | `/athlete/update/careervideos/{athlete_id}` | `src/python/npid_api_client.py:859` |
| Stage update | `/API/scout-api/video-stage` | `src/python/npid_api_client.py:803` |
| Seasons fetch | `/API/scout-api/video-seasons-by-video-type` | `src/python/npid_api_client.py:692` |

**Verification command:**
```bash
# Check all endpoint URLs in translator
grep -n '"/' npid-api-layer/app/translators/legacy.py | grep endpoint
```

---

## 5. REFERENCE FILES

### MUST CHECK Before Implementing:

**Python Reference (PRIMARY SOURCE):**
- `src/python/npid_api_client.py` (lines 690-960)
  - Video submission: lines 859-873
  - Stage update: lines 803-840
  - Seasons fetch: lines 692-714

**Skills Documentation:**
- `.claude/skills/npid-api-calls.md` - HTTP header requirements
- `.claude/skills/npid-video-submission.md` - Video workflow
- `.claude/skills/npid-athlete-main-id.md` - athlete_main_id extraction

**API Specs:**
- `NPID-API-specs/ATHLETE_MAIN_ID_INVARIANT.md` - athlete_main_id rules
- `docs/plans/2025-11-14-npid-athlete-search-design.md` - Design docs

### MUST FOLLOW Patterns From:

**Core Implementation:**
- `npid-api-layer/app/translators/legacy.py` - All translation logic
- `npid-api-layer/app/session.py` - Session/CSRF/headers
- `npid-api-layer/app/models/schemas.py` - Clean API contracts

**Current Routers:**
- `npid-api-layer/app/routers/video.py` - Video operations
- `npid-api-layer/app/routers/athlete.py` - Athlete resolution
- `npid-api-layer/app/routers/assignments.py` - Assignment fetching

**Documentation:**
- `npid-api-layer/README.md` - Project architecture

---

## 6. CORRECT WORKFLOW

When user asks to add/modify NPID API functionality:

### Step 1: Research Phase

1. **Read this skill** (you're here now)
2. **Check Python reference:**
   ```bash
   # Find the endpoint implementation
   grep -n "endpoint_keyword" src/python/npid_api_client.py
   ```
3. **Check existing translator:**
   ```bash
   # See if method already exists
   grep -n "def.*to_legacy" npid-api-layer/app/translators/legacy.py
   ```

### Step 2: Implementation Phase

**If new endpoint needed:**

1. Add translation method to `LegacyTranslator`:
   ```python
   @staticmethod
   def new_endpoint_to_legacy(request: NewRequest) -> Tuple[str, Dict[str, Any]]:
       """Convert clean request to legacy format."""
       endpoint = "/path/from/python/client"
       form_data = {
           # Extract exact field names from Python client
           "field_name": request.field
       }
       return endpoint, form_data
   ```

2. Add response parser to `LegacyTranslator`:
   ```python
   @staticmethod
   def parse_new_endpoint_response(raw_response: str) -> Dict[str, Any]:
       """Parse response (HTML, JSON, or nested)."""
       # Copy parsing logic from Python client
       pass
   ```

3. Router calls translator methods only:
   ```python
   @router.post("/new-endpoint")
   async def new_endpoint(request: Request, payload: NewRequest):
       session = get_session(request)
       translator = LegacyTranslator()

       endpoint, form_data = translator.new_endpoint_to_legacy(payload)
       response = await session.post(endpoint, data=form_data)
       result = translator.parse_new_endpoint_response(response.text)

       return NewResponse(**result)
   ```

**If modifying existing:**

1. Change translator method, NOT router
2. Verify all routers using that method still work
3. Update response parser if format changed

### Step 3: Verification Phase

```bash
# Run all verification commands (see section 8)
# Ensure no violations introduced
```

---

## 7. EXAMPLES

### ✅ GOOD - Follows Pattern Correctly

**File: `app/routers/video.py`**
```python
@router.post("/submit", response_model=VideoSubmitResponse)
async def submit_video(request: Request, payload: VideoSubmitRequest):
    """
    Submit video to athlete profile.
    Clean endpoint → Translator → Legacy Laravel.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    # Step 1: Translator converts clean request to legacy format
    endpoint, form_data = translator.video_submit_to_legacy(payload)

    logger.info(f"📤 Submitting video for athlete {payload.athlete_id}")

    # Step 2: Session handles CSRF, headers, cookies
    response = await session.post(endpoint, data=form_data)

    # Step 3: Translator parses response (handles nested JSON strings)
    result = translator.parse_video_submit_response(response.text)

    if result["success"]:
        return VideoSubmitResponse(
            success=True,
            message=result.get("message", "Video uploaded successfully"),
            athlete_id=payload.athlete_id,
            video_url=payload.video_url
        )
    else:
        raise HTTPException(status_code=400, detail=result.get("message"))
```

**Why this is correct:**
- ✅ Uses `LegacyTranslator` for request/response translation
- ✅ Uses `session.post()` (auto-handles CSRF, headers)
- ✅ No inline form construction
- ✅ No inline parsing logic
- ✅ Clean Pydantic models at API boundary
- ✅ All Laravel quirks isolated in translator

### ❌ BAD - Bypasses Pattern (NEVER DO THIS)

**File: `app/routers/video.py` - WRONG IMPLEMENTATION**
```python
@router.post("/submit")
async def submit_video(request: Request, payload: VideoSubmitRequest):
    """WRONG: Bypasses translator pattern."""
    session = get_session(request)

    # ❌ WRONG: Inline form construction
    form_data = {
        "_token": session.csrf_token,  # Might forget this
        "athlete_id": payload.athlete_id,  # Is this the right param name?
        "video_url": payload.video_url,  # Laravel expects "newVideoLink"
        "season": payload.season  # Laravel expects "schoolinfo[add_video_season]"
    }

    # ❌ WRONG: Direct client usage (bypasses session wrapper)
    response = await client.post(
        "/athlete/update/careervideos",  # Missing athlete_id in path
        data=form_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"}
        # ❌ Missing: X-Requested-With header
        # ❌ Missing: api_key injection
    )

    # ❌ WRONG: Inline parsing (assumes JSON, may be HTML)
    result = json.loads(response.text)  # Will crash if HTML returned

    # ❌ WRONG: May return nested JSON string, not parsed
    return result  # Might return {"data": {"response": "{\"success\":\"true\"}"}}
```

**Why this is wrong:**
- ❌ Inline form construction (duplicates logic)
- ❌ Parameter names may be incorrect (no reference to Python client)
- ❌ Missing endpoint path parameters
- ❌ Bypasses session wrapper (manual header management)
- ❌ Missing AJAX header
- ❌ Doesn't inject api_key
- ❌ Assumes JSON response (Laravel may return HTML)
- ❌ Doesn't handle nested JSON strings
- ❌ Changes require editing router, not translator

### ✅ GOOD - Handles HTML Response

**File: `app/translators/legacy.py`**
```python
@staticmethod
def parse_seasons_response(raw_response: str) -> Dict[str, Any]:
    """
    Parse seasons response.
    Laravel returns HTML <option> tags, NOT JSON.
    """
    try:
        # Try JSON first
        data = json.loads(raw_response)
        if data.get("status") == "ok" and "data" in data:
            return {"success": True, "seasons": data["data"]}
    except json.JSONDecodeError:
        pass

    # Fallback: Parse HTML
    seasons = []
    option_pattern = r'<option[^>]*value="([^"]*)"[^>]*>([^<]+)</option>'

    for match in re.finditer(option_pattern, raw_response):
        value, label = match.groups()
        if value:  # Skip empty placeholder
            seasons.append({
                "value": value,  # e.g., "highschool:18249"
                "label": label.strip()
            })

    return {
        "success": len(seasons) > 0,
        "seasons": seasons,
        "was_html": True
    }
```

**Why this is correct:**
- ✅ Tries JSON first, falls back to HTML
- ✅ Uses regex to parse HTML options
- ✅ Returns normalized structure regardless of format
- ✅ Isolated in translator (routers don't need to know about HTML)

### ❌ BAD - Assumes JSON (NEVER DO THIS)

**File: `app/routers/video.py` - WRONG**
```python
@router.get("/seasons/{athlete_id}")
async def get_seasons(athlete_id: str):
    """WRONG: Assumes JSON response."""
    response = await session.post("/API/scout-api/video-seasons-by-video-type", data={...})

    # ❌ WRONG: Assumes JSON, but endpoint returns HTML
    seasons = response.json()  # Crashes with JSONDecodeError

    return {"seasons": seasons}
```

---

## 8. VERIFICATION COMMANDS

After ANY changes to npid-api-layer code, run these commands:

### Check for Translator Pattern Violations

```bash
# Should return NO results (all POST calls should be session.post)
grep -n "\.post(" npid-api-layer/app/routers/*.py | grep -v "session.post"
```

### Check for Inline Form Construction

```bash
# Should return NO results (form construction should be in translator)
grep -n "form_data = {" npid-api-layer/app/routers/*.py
```

### Check for JSON Bodies (Forbidden)

```bash
# Should return NO results (Laravel requires form-encoding)
grep -n "json=" npid-api-layer/app/routers/*.py
```

### Check for Inline HTML Parsing

```bash
# Should return NO results (parsing should be in translator)
grep -n "BeautifulSoup" npid-api-layer/app/routers/*.py
```

### Verify Translator Methods Exist

```bash
# Should list all translation methods
grep -n "def.*to_legacy" npid-api-layer/app/translators/legacy.py

# Should list all parsing methods
grep -n "def parse_" npid-api-layer/app/translators/legacy.py
```

### Verify Session Configuration

```bash
# Check AJAX header in global config
grep -n "X-Requested-With" npid-api-layer/app/session.py

# Check CSRF auto-injection
grep -n "_token" npid-api-layer/app/session.py

# Check api_key auto-injection
grep -n "api_key" npid-api-layer/app/session.py
```

### Verify Endpoint URLs Match Python Client

```bash
# Extract endpoint URLs from translator
grep -n 'endpoint = "' npid-api-layer/app/translators/legacy.py

# Compare with Python client
grep -n 'endpoint.*=' src/python/npid_api_client.py | grep -E "(video|athlete|season)"
```

---

## 9. WHY THIS MATTERS

### User's Pain Points (From CLAUDE.md)

> The user has debugged this pattern 100+ times. Every time I:
> 1. Don't check Python code first
> 2. Make assumptions about HTML = expired session
> 3. Add wrong error handling
> 4. Break working code
>
> This skill exists to stop that cycle.

### Laravel's Quirks

Laravel's API is **NOT RESTful**. It's a legacy form-based system with:

**Inconsistent Response Formats:**
- `/videoteammsg/videoprogress` returns HTML by default
- Same endpoint returns JSON with `X-Requested-With: XMLHttpRequest` header
- Video submit returns nested JSON strings: `{"data": {"response": "{\"success\":\"true\"}"}}`

**Quirky Parameter Naming:**
- `schoolinfo[add_video_season]` - Array notation for season field
- `newVideoLink` - CamelCase exception
- `newVideoSeason` - Always empty (data goes to `schoolinfo` instead)
- `athleteviewtoken` - Always empty string

**CSRF Token Requirements:**
- Must be extracted from HTML page
- Must be included in every POST as `_token`
- Expires and needs refresh

**AJAX Header Requirements:**
- `X-Requested-With: XMLHttpRequest` changes response format
- Missing this header = HTML response instead of JSON
- NOT a session expiration issue

**Session Cookie Management:**
- 400-day persistent cookies from login
- Loaded from `~/.npid_session.pkl`
- Must be included in all requests

### Why Translator Pattern Exists

**Problem without translator:**
- Laravel quirks scattered across 10+ router files
- Parameter name changes require 10+ file edits
- New engineer doesn't know quirks, breaks things
- Testing requires mocking scattered logic

**Solution with translator:**
- Laravel quirks in ONE file (`legacy.py`)
- Parameter changes = ONE method edit
- Clear documentation of exact field names
- Easy to mock translator for testing
- Routers stay clean and RESTful-looking

**When Laravel changes, you fix ONE file, not ten.**

---

## 10. COMMON VIOLATION SCENARIOS

### Scenario 1: New Engineer Adds Endpoint

**WRONG Approach:**
```python
# Thinks: "I'll just POST the data directly"
@router.post("/new-feature")
async def new_feature(data: dict):
    response = await client.post("/some/endpoint", json=data)
    return response.json()
```

**CORRECT Approach:**
1. Check Python client for exact endpoint
2. Add translator method for request/response
3. Router calls translator only

### Scenario 2: "Modernization" Attempt

**WRONG Thinking:**
- "This HTML parsing is messy, endpoint probably returns JSON now"
- "Let me remove this old BeautifulSoup code"
- **Result:** Code breaks, endpoint still returns HTML

**CORRECT Thinking:**
- "Endpoint returns HTML, this is documented"
- "Keep parsing logic, move to translator if not there"
- "Never assume Laravel changed without verification"

### Scenario 3: Parameter Renaming

**WRONG Thinking:**
- "JavaScript uses camelCase, let's be consistent"
- Changes `athlete_id` → `athleteId` in router
- **Result:** Laravel doesn't recognize parameter, silent failure

**CORRECT Thinking:**
- "Laravel expects exact parameter names"
- "Python client documents correct names"
- "Keep snake_case for Laravel parameters"

### Scenario 4: Session Expiration Assumption

**WRONG Thinking:**
- Sees HTML response instead of JSON
- "Session must be expired, add login retry"
- **Result:** Infinite login loop, actual issue is missing AJAX header

**CORRECT Thinking:**
- "HTML response usually means missing X-Requested-With header"
- "Check session.py for header configuration"
- "Verify endpoint uses session.post() not client.post()"

### Scenario 5: Bypass for "Quick Fix"

**WRONG Thinking:**
- "Just need to change one field, translator is overkill"
- Adds inline form construction in router
- **Result:** Duplication, maintenance burden increases

**CORRECT Thinking:**
- "Even small changes go through translator"
- "Modify translator method, keep pattern consistent"
- "Pattern overhead is tiny vs. maintenance cost"

---

## QUICK REFERENCE CARD

### Before ANY Code Change:

1. ✅ Read Python reference (`src/python/npid_api_client.py`)
2. ✅ Check existing translator methods
3. ✅ Verify you understand the pattern
4. ✅ Never bypass translator

### The Pattern (Always):

```python
translator = LegacyTranslator()
endpoint, form_data = translator.method_to_legacy(request)
response = await session.post(endpoint, data=form_data)
result = translator.parse_response(response.text)
```

### Never Do:

- ❌ Inline form construction in routers
- ❌ `json=` parameter for Laravel POSTs
- ❌ Bypass session wrapper
- ❌ Assume JSON responses
- ❌ Remove HTML parsing
- ❌ Change parameter names

### After Changes:

```bash
# Check violations
grep "\.post(" npid-api-layer/app/routers/*.py | grep -v "session.post"
grep "form_data = {" npid-api-layer/app/routers/*.py
grep "json=" npid-api-layer/app/routers/*.py
grep "BeautifulSoup" npid-api-layer/app/routers/*.py
```

### Reference Files:

- `src/python/npid_api_client.py` - Python reference
- `npid-api-layer/app/translators/legacy.py` - Pattern reference
- `.claude/skills/npid-api-calls.md` - Header requirements
- `.claude/skills/npid-video-submission.md` - Video workflow

---

## ENFORCEMENT CHECKLIST

Before submitting ANY code change to npid-api-layer:

- [ ] All POST requests use `session.post()`, not `client.post()`
- [ ] No inline form construction in routers
- [ ] No `json=` parameters in POST requests
- [ ] No BeautifulSoup imports in routers
- [ ] All Laravel interactions go through `LegacyTranslator`
- [ ] Parameter names match Python client exactly
- [ ] Response parsing handles both HTML and JSON
- [ ] Ran verification commands (section 8)
- [ ] No translator pattern violations detected

**If ANY checkbox is unchecked, code is NOT ready for submission.**
