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
- API Contract: `VPS-API-specs/ATHLETE_MAIN_ID_INVARIANT.md`

---

## Recent Updates
- MCP Server add updates the recent changes based on checklist