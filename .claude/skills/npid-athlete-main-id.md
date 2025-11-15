# NPID athlete_main_id Invariant Skill

**VERIFIED 2025-11-15 - Previous documentation was INCORRECT**

## The Actual Truth (Tested & Verified)

After testing actual production endpoints, the previous assumptions were **completely wrong**.

### ❌ What We Thought (WRONG)
- `athlete_main_id` exists in `/videoteammsg/videomailprogress/{id}` HTML
- Must extract from `<input name="athlete_main_id">`
- This is the "ONLY source"

### ✅ What Actually Works (VERIFIED)
- `athlete_main_id` is **NOT AVAILABLE** from standard API endpoints
- `/videoseasons` **ACCEPTS `athlete_id` as the `athlete_main_id` parameter**
- The endpoint returns **HTML `<option>` elements**, NOT JSON
- Using `athlete_id` as fallback for `athlete_main_id` works perfectly

## Verified Endpoint Behavior

### Search Endpoint
```
POST /videoteammsg/videoprogress
```
**Returns:** JSON array with fields:
- `athlete_id` ✅ (use this as athlete_main_id)
- `athletename`, `sport_alias`, `grad_year`, etc.
- `athlete_main_id` ❌ NOT PRESENT

### Seasons Endpoint (CRITICAL)
```
GET /template/videotemplate/videoseasons
```

**Parameters Required:**
- `athlete_id` - from search results
- `sport_alias` - from search results
- `video_type` - user selection
- `athlete_main_id` - **USE athlete_id VALUE HERE**

**Returns:** HTML `<option>` elements (NOT JSON!)
```html
<option value="">-- Season/Team --</option>
<option season="senior" value="highschool:15537" school_added="Yes">
  '25-'26 - Senior Year, VARSITY - Slaton High School
</option>
```

## ✅ CORRECT Implementation

### Python
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
        'athlete_main_id': athlete_main_id  # Use athlete_id value here
    }
    resp = self.session.get(
        f"{self.base_url}/template/videotemplate/videoseasons", params=params
    )
    resp.raise_for_status()

    # Parse HTML response (endpoint returns <option> elements, not JSON)
    soup = BeautifulSoup(resp.text, 'html.parser')
    seasons = []
    for option in soup.find_all('option'):
        value = option.get('value', '')
        text = option.text.strip()
        if value and value != '':
            seasons.append({
                'value': value,
                'title': text,
                'season': option.get('season', ''),
                'school_added': option.get('school_added', '')
            })
    return seasons
```

### TypeScript
```typescript
// From search results
const player = searchResults[0];

// Call seasons endpoint with athlete_id as fallback
const seasons = await callPythonServer('get_video_seasons', {
  athlete_id: player.athlete_id,
  sport_alias: player.sport_alias,
  video_type: videoType,
  athlete_main_id: player.athlete_id  // ← Same value as athlete_id
});

// Map response (note: field is 'title' not 'label')
setSeasons(seasons.data.map(s => ({ value: s.value, title: s.title })));
```

### Raycast UI Flow
```typescript
// 1. Search for athlete
const results = await searchVideoProgressPlayer('Zuri Martinez');

// 2. Map results with athlete_id as athlete_main_id fallback
const mappedResults = results.map(player => ({
  ...player,
  athlete_main_id: player.athlete_main_id || player.athlete_id  // Fallback works!
}));

// 3. Fetch seasons when player + video type selected
if (selectedPlayer && videoType) {
  const result = await callPythonServer('get_video_seasons', {
    athlete_id: selectedPlayer.athlete_id,
    sport_alias: selectedPlayer.sport_alias,
    video_type: videoType,
    athlete_main_id: selectedPlayer.athlete_id  // ← Use athlete_id
  });

  // Parse response
  if (result.status === 'ok' && result.data) {
    setSeasons(result.data.map(s => ({ value: s.value, title: s.title })));
  }
}
```

## Where athlete_main_id Was Checked (All Failed)

| Location | Contains athlete_main_id? | Evidence |
|----------|---------------------------|----------|
| `/videoteammsg/videoprogress` JSON | ❌ NO | Tested: returns `athlete_id` only |
| `/videoteammsg/videomailprogress/{id}` HTML | ❌ NO | Tested: no `<input name="athlete_main_id">` |
| Assignment modal HTML | ❌ NO | Contains field but always empty |
| `/athlete/{id}` profile page | ❌ NO | No inputs on page |
| Inbox threads HTML attribute | ❌ NO | `athletemainid=""` (empty) |

## Critical JSON vs HTML Bug

### The Error You'll See
```
JSONDecodeError: Expecting value: line 3 column 1 (char 4)
```

### The Cause
```python
# ❌ WRONG - trying to parse HTML as JSON
resp = self.session.get(f"{base_url}/template/videotemplate/videoseasons", params=params)
return resp.json()  # FAILS - response is HTML!
```

### The Fix
```python
# ✅ CORRECT - parse HTML
soup = BeautifulSoup(resp.text, 'html.parser')
seasons = []
for option in soup.find_all('option'):
    if option.get('value'):
        seasons.append({
            'value': option.get('value'),
            'title': option.text.strip()
        })
return seasons
```

## API Contract (Verified)

`/template/videotemplate/videoseasons` endpoint:

**Request:**
```
GET /template/videotemplate/videoseasons?athlete_id=1462444&sport_alias=softball&video_type=Partial+Season+Highlight&athlete_main_id=1462444
```

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
```

## Implementation Rules (Updated)

1. **Use athlete_id as athlete_main_id** - verified to work
2. **Parse HTML response** - endpoint returns `<option>` elements, not JSON
3. **All 4 parameters required** - missing any returns empty `<option>` list
4. **Field is 'title' not 'label'** - Python returns `title`, not `label`
5. **No need for separate fetch** - athlete_id from search is sufficient

## Testing

Verified with real production data (Zuri Martinez, athlete_id: 1462444):

```bash
$ python3 src/python/npid_api_client.py get_video_seasons \
  '{"athlete_id":"1462444","sport_alias":"softball","video_type":"Partial Season Highlight","athlete_main_id":"1462444"}'

✅ Got 4 seasons:
- '25-'26 - Senior Year, VARSITY - Slaton High School
- '24-'25 - Junior Year, VARSITY - Slaton High School
- '23-'24 - Sophomore Year, VARSITY - Slaton High School
- '22-'23 - Freshman Year, VARSITY - Slaton High School
```

## Summary

**OLD (WRONG):**
- athlete_main_id ONLY in `/videomailprogress` HTML
- Must extract from hidden input
- Cannot use athlete_id as fallback
- Endpoint returns JSON

**NEW (VERIFIED):**
- athlete_main_id NOT AVAILABLE from any endpoint
- Use `athlete_id` value as `athlete_main_id` parameter
- Endpoint returns HTML `<option>` elements
- Parse with BeautifulSoup/Cheerio, not JSON

**Files Updated:**
- `src/python/npid_api_client.py:606` - HTML parsing fix
- `src/python/npid_api_client.py:493` - athlete_id fallback
- `src/video-updates.tsx:385` - field mapping fix
- `CLAUDE.md` - updated invariant docs
