# Integrating Session Manager into NPID Automators

## ✅ Session Manager Installed

Location: `/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/session_manager.py`

---

## 🎯 Quick Integration

### Option 1: Replace Playwright in `npid_automator_complete.py`

**Before (lines ~250-290):**
```python
from playwright.async_api import async_playwright

browser = await playwright.chromium.launch(headless=False)
context = await browser.new_context(storage_state=state_file)
```

**After:**
```python
from session_manager import SessionManager, get_selenium_driver

# For synchronous scripts
driver = get_selenium_driver(headless=False, debug=True)

# Or use SessionManager with context manager
manager = SessionManager(headless=False)
with manager.session() as driver:
    driver.get('https://dashboard.nationalpid.com/admin/videomailbox')
    # Your automation code here
```

---

## 🔧 Update Existing Scripts

### 1. Update `npid_automator_complete.py`

Replace Playwright async context with Selenium SessionManager:

```bash
# Backup current file
cp npid_automator_complete.py npid_automator_complete.py.backup

# Edit with your favorite editor
# Replace async Playwright calls with sync Selenium + SessionManager
```

### 2. Update `npid_video_progress_sync.py`

Same approach - swap Playwright for SessionManager.

### 3. Keep Playwright state for reference

Your `playwright_state.json` can stay - the SessionManager stores sessions in `~/.cache/playwright/npid/` instead.

---

## 🧪 Test

```bash
cd /Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native

# Test session manager works
python3 session_manager.py --url https://dashboard.nationalpid.com
```

---

## 📋 Benefits

| Before | After |
|--------|-------|
| Playwright loses session after token expiry | ✅ Selenium persistent profile maintains auth |
| Manual storageState save/load | ✅ Automatic cookie persistence |
| Separate profile per script | ✅ Shared profile across all scripts |
| Complex async/await setup | ✅ Simple synchronous API |

---

## 🚨 Next Steps

1. **Backup your working scripts**
2. **Test SessionManager standalone** (see test command above)
3. **Integrate into one script first** (try `npid_automator_complete.py`)
4. **Validate session persistence** works
5. **Migrate remaining scripts**

---

**Documentation:** See `SESSION-PERSISTENCE.md` for full architecture details.
