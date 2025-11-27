# NPID Video Submission Workflow

## Overview
Video submission workflow for prospect-pipeline that handles 100s of athletes across multiple sports, seasons, and video types. **CRITICAL: Nothing is hardcoded—all parameters are dynamic.**

## Entry Point: Modal Trigger

**CSS Selector (Add/Manage button):**
```css
#profile_main_section > div:nth-child(3) > div > div > div:nth-child(1) > div > div.col-md-4.col-xs-6.col-sm-6.text-right > button
```

Location: Athlete media page (`/athlete/media/{athleteId}/{athleteMainId}`)

---

## Endpoints

### Endpoint 2: Video Sortable (GET Form)
```
GET https://dashboard.nationalpid.com/template/template/addvideoform
```

**Query Parameters (DYNAMIC - no hardcoding):**
- `athleteid` - From URL or input parameter
- `sport_alias` - From athlete's current sport (NOT hardcoded "football")
- `athlete_main_id` - From URL or input parameter

**Response:** HTML form with hidden CSRF token and season dropdown

**Headers Required:**
- `X-Requested-With: XMLHttpRequest`

---

### Endpoint 3: Video Seasons API (Dynamic Options)
```
POST https://dashboard.nationalpid.com/API/scout-api/video-seasons-by-video-type
```

**Request Body (form-encoded, DYNAMIC):**
```
_token={csrf_token_from_form}
return_type=html
athlete_id={athleteId}
sport_alias={sport_from_athlete}
video_type={user_selected_type}
athlete_main_id={athleteMainId}
```

**Response Format:** HTML `<option>` elements (NOT JSON—parse with BeautifulSoup/regex)
```html
<option value="highschool:18249" season="junior" school_added="Yes">'25-'26 - Junior Year, VARSITY - School Name</option>
```

**Critical:** This endpoint returns HTML, not JSON. Must parse `value` attribute for submission.

**Headers Required:**
- `X-Requested-With: XMLHttpRequest`
- `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`

---

### Endpoint 4: Video Submission (POST)
```
POST https://dashboard.nationalpid.com/athlete/update/careervideos/{athleteId}
```

**Request Body (form-encoded, ALL DYNAMIC):**
```
_token={csrf_token}
athleteviewtoken=
schoolinfo[add_video_season]={parsed_season_from_response}
sport_alias={sport_from_athlete}
url_source={user_choice: youtube|hudl}
newVideoLink={user_url}
videoType={user_selected_type}
newVideoSeason=
approve_video={1_if_checked_else_empty}
athlete_main_id={athleteMainId}
```

**Response:** JSON
```json
{"success":"true","message":"Videos Updated Successfully."}
```

**Headers Required:**
- `X-Requested-With: XMLHttpRequest`
- `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`
- `Accept: application/json, text/javascript, */*; q=0.01`

---

## Form Elements (Selectors)

| Field | Selector | Type | Notes |
|-------|----------|------|-------|
| URL Input | `#newVideoLink` | text | Remove `readonly` before setting value |
| Video Type Dropdown | `#videoType` | select | User selects: Full Season Highlight, Partial Season, Single Game, Skills/Training |
| Season Dropdown | `#newVideoSeason` | select | Remove `disabled` before setting; dynamically populated from Endpoint 3 |
| Approve Checkbox | `#addnewvideo > div:nth-child(13) > label > input[type=checkbox]` | checkbox | Optional; user choice |
| Submit Button | `#addnewvideo > div:nth-child(15) > div > button.btn.btn-primary` | button | Click to submit |

---

## URL Validation Rules (From Response)

- **YouTube:** `https://youtu.be/*****` or `https://www.youtube.com/watch?v=****` or `https://www.youtube.com/shorts/****`
- **Hudl:** `https://www.hudl.com/embed/video/*****`

---

## Implementation Rules (100s of Athletes)

### ❌ NEVER Hardcode
- Sport aliases (football, basketball, baseball, soccer, etc.)
- Video types (Full Season Highlight, Partial Season, etc.)
- Season names/years
- Athlete IDs or athlete_main_id values
- CSRF tokens (extract from form per request)

### ✅ ALWAYS Parameterize
1. **Sport** - From athlete record or form context
2. **Video Type** - From dropdown options (user selected)
3. **Season** - Fetch via Endpoint 3 based on video type, parse HTML response
4. **Athlete IDs** - From input parameters
5. **CSRF Token** - Extract from form hidden field before each submission
6. **URL Source** - User selection (YouTube vs Hudl)
7. **Approval** - Optional checkbox (include if checked)

---

## Flow Summary

```
1. Navigate to athlete media page (/athlete/media/{id}/{mainId})
2. Click Add/Manage button → Opens modal with form
3. Extract CSRF token from form hidden field
4. User selects video type
5. On video type change:
   - Call Endpoint 3 (POST) with athlete_id, sport_alias, selected video_type
   - Parse HTML response to extract season options
   - Populate season dropdown
6. User fills:
   - URL (YouTube or Hudl)
   - URL Source (radio button)
   - Video Type (already selected)
   - Season (from populated dropdown)
   - Approve checkbox (optional)
7. Submit form to Endpoint 4 (POST)
8. Verify JSON response: {"success":"true"}
```

---

## Key Technical Details

- **Response Types:** Endpoint 3 returns HTML (parse, don't JSON.parse); Endpoint 4 returns JSON
- **Form Encoding:** Both endpoints use `application/x-www-form-urlencoded`, not JSON
- **CSRF Protection:** `_token` must be extracted from form and included in all POST requests
- **Season Format:** Colon-separated (e.g., `highschool:18249`), extracted from HTML `value` attribute
- **Disabled Fields:** `newVideoSeason` is initially disabled; enable before setting value
- **Readonly Fields:** `newVideoLink` is initially readonly; remove attribute before filling

---

## Session Management

All requests require active session with NPID dashboard. Use existing session loader:
- `loadSession()` from `src/session.ts`
- Extract auth headers with `getAuthHeaders()`
- Cookie handling: Include in all requests for 100+ athlete iterations

---

## Error Handling

- **Endpoint 3 fails:** Log HTML response (may contain error message)
- **Endpoint 4 fails:** Check JSON response for "success": false
- **Invalid URL format:** Form validation on client-side (reference validation rules above)
- **Season not found:** Handle empty season dropdown gracefully

---

## Memory Notes

### Button/Form Selectors for Re-selenium Implementation
```
Add/Manage Button:
#profile_main_section > div:nth-child(3) > div > div > div:nth-child(1) > div > div.col-md-4.col-xs-6.col-sm-6.text-right > button

Form Elements:
#newVideoLink - URL input (remove readonly)
#videoType - Video type dropdown
#videoType > option:nth-child(1), 2, 3, 5 - Option elements
#newVideoSeason - Season dropdown (remove disabled)
#addnewvideo > div:nth-child(13) > label > input[type=checkbox] - Approve checkbox
#addnewvideo > div:nth-child(15) > div > button.btn.btn-primary - Submit button
```

### 2026 Status
- Pending: JSON API endpoint for video uploads (currently HTML form-based)
- Track: Scout API evolution for video operations
- Note: Current implementation uses legacy form submission; JSON endpoint may replace this in future
