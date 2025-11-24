# athlete_main_id API Contract - VERIFIED 2025-11-21

**UPDATED:** Correct method for extracting athlete_main_id identified.

---

## Executive Summary

### How to Get athlete_main_id

**VERIFIED METHOD:**
1. Search returns `athlete_id` and `sport_alias`
2. Visit `/athlete/profile/{athlete_id}`
3. Extract `athlete_main_id` from media tab link: `/athlete/media/{athlete_id}/{athlete_main_id}`
4. The `athlete_main_id` is **DIFFERENT** from `athlete_id`

**Example:**
- Gavin Casey: `athlete_id=1460964`, `athlete_main_id=939986`

**Key Facts:**
- `athlete_main_id` exists on athlete profile page in media tab link
- Required for `/template/template/addvideoform` and video seasons API
- Assignment modal and addvideoform also contain `athlete_main_id`

---

## API Endpoints - Verified Behavior

### 1. Video Progress Search

**Endpoint:** `POST /videoteammsg/videoprogress`

**Request:**
```http
POST /videoteammsg/videoprogress HTTP/1.1
Content-Type: application/x-www-form-urlencoded

_token=CSRF_TOKEN&first_name=Zuri&last_name=Martinez
```

**Response:** `application/json`
```json
[
  {
    "athlete_id": 1462444,
    "athletename": "Zuri Martinez",
    "sport_alias": "softball",
    "sport_name": "Softball",
    "grad_year": 2026,
    "high_school": "Slaton High School",
    "high_school_city": "Slaton",
    "high_school_state": "TX",
    "primaryposition": "CF",
    "secondaryposition": "RF",
    "video_progress": "In Progress",
    "video_progress_status": "Dropbox",
    "stage": "In Queue"
  }
]
```

**Note:** Response does **NOT** include `athlete_main_id` field.

---

### 2. Video Seasons (CRITICAL)

**Endpoint:** `GET /template/videotemplate/videoseasons`

**Request:**
```http
GET /template/videotemplate/videoseasons?athlete_id=1462444&sport_alias=softball&video_type=Partial+Season+Highlight&athlete_main_id=1462444 HTTP/1.1
```

**Parameters:**
| Parameter | Type | Source | Required |
|-----------|------|--------|----------|
| `athlete_id` | string | Search result | ✅ Yes |
| `sport_alias` | string | Search result | ✅ Yes |
| `video_type` | string | User selection | ✅ Yes |
| `athlete_main_id` | string | **Use `athlete_id` value** | ✅ Yes |

**Response Type:** `text/html; charset=UTF-8`

**Response Body:**
```html
<option value="">-- Season/Team --</option>
<option season="senior" value="highschool:15537" school_added="Yes">
  '25-'26 - Senior Year, VARSITY - Slaton High School
</option>
<option season="junior" value="highschool:15538" school_added="Yes">
  '24-'25 - Junior Year, VARSITY - Slaton High School
</option>
<option season="sophomore" value="highschool:15539" school_added="Yes">
  '23-'24 - Sophomore Year, VARSITY - Slaton High School
</option>
<option season="freshman" value="highschool:15540" school_added="Yes">
  '22-'23 - Freshman Year, VARSITY - Slaton High School
</option>
```

**⚠️ CRITICAL:** This endpoint returns **HTML**, not JSON. Attempting `JSON.parse()` or `resp.json()` will fail.

**Missing Parameters Behavior:**
- Missing ANY required parameter → returns single empty `<option value="">-- Season/Team --</option>`
- All parameters present → returns populated season list

---

## Where athlete_main_id Does NOT Exist

Exhaustive testing revealed `athlete_main_id` is **NOT AVAILABLE** from:

| Endpoint | Method | Contains athlete_main_id? | Tested |
|----------|--------|---------------------------|--------|
| `/videoteammsg/videoprogress` | POST | ❌ NO | ✅ Yes (JSON response) |
| `/videoteammsg/videomailprogress/{id}` | GET | ❌ NO | ✅ Yes (no `<input name="athlete_main_id">`) |
| `/rulestemplates/template/assignemailtovideoteam` | GET | ⚠️ Empty | ✅ Yes (field exists but empty) |
| `/athlete/{id}` | GET | ❌ NO | ✅ Yes (no form inputs) |
| `/template/calendaraccess/contactslist` | GET | ❌ NO | ✅ Yes |
| Inbox thread HTML attributes | GET | ⚠️ Empty | ✅ Yes (`athletemainid=""`) |

**Conclusion:** No standard endpoint provides a usable `athlete_main_id` value.

---

## Working Solution

### Data Flow

```
1. User searches → POST /videoteammsg/videoprogress
   ↓
2. Returns: athlete_id, athletename, sport_alias, etc.
   (NO athlete_main_id in response)
   ↓
3. User selects player + video type
   ↓
4. Call GET /template/videotemplate/videoseasons
   Parameters:
     - athlete_id: 1462444
     - sport_alias: "softball"
     - video_type: "Partial Season Highlight"
     - athlete_main_id: 1462444  ← SAME AS athlete_id
   ↓
5. Parse HTML response (not JSON!)
   Extract <option value="..."> elements
   ↓
6. Display seasons in dropdown
```

### Python Implementation

```python
def get_video_seasons(
    self, athlete_id: str, sport_alias: str, video_type: str, athlete_main_id: str
) -> List[Dict[str, Any]]:
    """Get available video seasons for a player."""
    self.ensure_authenticated()
    params = {
        'athlete_id': athlete_id,
        'sport_alias': sport_alias,
        'video_type': video_type,
        'athlete_main_id': athlete_main_id  # ← Use athlete_id value here
    }
    resp = self.session.get(
        f"{self.base_url}/template/videotemplate/videoseasons",
        params=params
    )
    resp.raise_for_status()

    # ⚠️ CRITICAL: Parse HTML, not JSON
    soup = BeautifulSoup(resp.text, 'html.parser')
    seasons = []
    for option in soup.find_all('option'):
        value = option.get('value', '')
        text = option.text.strip()
        if value and value != '':  # Skip empty placeholder option
            seasons.append({
                'value': value,
                'title': text,
                'season': option.get('season', ''),
                'school_added': option.get('school_added', '')
            })
    return seasons
```

### TypeScript Implementation

```typescript
async function fetchSeasons(athleteId: string, sportAlias: string, videoType: string) {
  const result = await callPythonServer('get_video_seasons', {
    athlete_id: athleteId,
    sport_alias: sportAlias,
    video_type: videoType,
    athlete_main_id: athleteId  // ← Use same value
  });

  if (result.status === 'ok' && result.data) {
    // Note: field is 'title' not 'label'
    return result.data.map((s: any) => ({
      value: s.value,
      title: s.title
    }));
  }
  return [];
}
```

---

## Common Errors & Solutions

### Error 1: JSONDecodeError

**Symptom:**
```
JSONDecodeError: Expecting value: line 3 column 1 (char 4)
```

**Cause:**
```python
# ❌ WRONG - trying to parse HTML as JSON
resp = self.session.get(...)
return resp.json()  # FAILS - response is HTML!
```

**Fix:**
```python
soup = BeautifulSoup(resp.text, 'html.parser')
# Parse <option> elements
```

---

### Error 2: Empty Seasons Dropdown

**Symptom:** Dropdown shows only "-- Season/Team --" placeholder

**Cause:** Missing or incorrect `athlete_main_id` parameter

**Debug:**
```python
print(f"athlete_id: {athlete_id}")
print(f"athlete_main_id: {athlete_main_id}")
# Should be same value!
```

**Fix:**
```python
athlete_main_id = athlete_id  # Use same value
```

---

### Error 3: Field Mapping Error

**Symptom:** Seasons dropdown shows `undefined`

**Cause:**
```typescript
setSeasons(result.data.map(s => ({ value: s.value, title: s.label })))
                                                              ^^^^^^ Wrong field!
```

**Fix:**
```typescript
setSeasons(result.data.map(s => ({ value: s.value, title: s.title })))
                                                              ^^^^^^ Correct!
```

---

## Testing Evidence

### Test Case: Zuri Martinez (athlete_id: 1462444)

**Command:**
```bash
python3 src/python/npid_api_client.py get_video_seasons '{
  "athlete_id":"1462444",
  "sport_alias":"softball",
  "video_type":"Partial Season Highlight",
  "athlete_main_id":"1462444"
}'
```

**Result:**
```json
{
  "status": "ok",
  "data": [
    {
      "value": "highschool:15537",
      "title": "'25-'26 - Senior Year, VARSITY - Slaton High School",
      "season": "senior",
      "school_added": "Yes"
    },
    {
      "value": "highschool:15538",
      "title": "'24-'25 - Junior Year, VARSITY - Slaton High School",
      "season": "junior",
      "school_added": "Yes"
    },
    {
      "value": "highschool:15539",
      "title": "'23-'24 - Sophomore Year, VARSITY - Slaton High School",
      "season": "sophomore",
      "school_added": "Yes"
    },
    {
      "value": "highschool:15540",
      "title": "'22-'23 - Freshman Year, VARSITY - Slaton High School",
      "season": "freshman",
      "school_added": "Yes"
    }
  ]
}
```

**Status:** ✅ Working perfectly

---

## Migration Guide

### Before (Broken)

```typescript
// ❌ Tried to fetch athlete_main_id separately
const details = await getAthleteDetails(player.athlete_id);
const athleteMainId = details.athlete_main_id;  // Always undefined!

// ❌ Tried to parse JSON response
const seasons = await fetch(`/videoseasons?...`);
return seasons.json();  // Fails - response is HTML
```

### After (Working)

```typescript
// ✅ Use athlete_id for both parameters
const seasons = await callPythonServer('get_video_seasons', {
  athlete_id: player.athlete_id,
  sport_alias: player.sport_alias,
  video_type: videoType,
  athlete_main_id: player.athlete_id  // ← Same value
});

// ✅ Python already parses HTML
if (seasons.status === 'ok') {
  setSeasons(seasons.data.map(s => ({ value: s.value, title: s.title })));
}
```

---

## Contract Summary

### ✅ Working Contract

1. Search returns `athlete_id` (NO `athlete_main_id`)
2. Pass `athlete_id` value to **both** `athlete_id` AND `athlete_main_id` parameters
3. Seasons endpoint returns **HTML** (parse with BeautifulSoup/Cheerio)
4. Response field is `title` (not `label`)
5. All 4 parameters required or endpoint returns empty list

### ❌ Broken Assumptions

1. ~~athlete_main_id exists in `/videomailprogress` HTML~~ **FALSE**
2. ~~Must extract from `<input name="athlete_main_id">`~~ **DOES NOT EXIST**
3. ~~Cannot use athlete_id as fallback~~ **FALLBACK WORKS**
4. ~~Endpoint returns JSON~~ **RETURNS HTML**

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `src/python/npid_api_client.py` | 606-634 | Parse HTML instead of JSON |
| `src/python/npid_api_client.py` | 493 | Use athlete_id as athlete_main_id |
| `src/video-updates.tsx` | 385 | Fix field mapping (label→title) |
| `CLAUDE.md` | 3-22 | Update critical invariants |
| `.claude/skills/npid-athlete-main-id.md` | All | Complete rewrite with verified facts |
| `NPID-API-specs/ATHLETE_MAIN_ID_INVARIANT.md` | All | This document |

---

**Verified:** 2025-11-15
**Environment:** Production (dashboard.nationalpid.com)
**Test Data:** Real athletes (Zuri Martinez, athlete_id: 1462444)
**Status:** ✅ All fixes working in production
