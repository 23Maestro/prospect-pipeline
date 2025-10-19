# Prospect Pipeline Unified - Session Persistence Architecture

## 🎯 Problem Statement

**Original Issue:**
- `scout-n8n-singleton`: Uses ephemeral Playwright `storageState` → loses session after token expiry
- `playerid-updates-v2`: Uses persistent Selenium ChromeDriver profiles → maintains live authentication

**Critical Finding:** Playwright's snapshot-based authentication vs. Selenium's live profile directory created session continuity failures.

---

## 🏗️ Solution: Hybrid Persistent Session Architecture

### Unified Session Cache Directory

```
~/.cache/playwright/npid/
├── selenium-profile/     # Selenium ChromeDriver persistent profile
│   ├── Default/
│   │   ├── Cookies
│   │   ├── Local Storage/
│   │   └── Preferences
│   └── SingletonLock
├── shared-state/         # Cross-engine session state
│   ├── cookies.json      # Exported cookies for sharing
│   └── session_state.json # Last login metadata
└── chromium/             # Reserved for future Playwright integration
    └── (unused)
```

### Architecture Components

#### 1. **Session Manager** (`session_manager.py`)
Centralized session orchestrator with:
- Persistent Selenium ChromeDriver setup using `--user-data-dir`
- Shared cache for cookies and session state
- Context manager for clean resource management
- Future-ready for Playwright integration

#### 2. **Automation Engine Selection**
```python
class AutomationEngine(Enum):
    SELENIUM = "selenium"      # Current: Robust DOM automation
    PLAYWRIGHT = "playwright"  # Future: Faster automation with persistent context
```

#### 3. **Session Lifecycle**
```
┌─────────────────────────────────────────────────┐
│ Initialize SessionManager                       │
│   ↓                                             │
│ Create/Load Persistent Profile                 │
│   ↓                                             │
│ Launch Chrome with --user-data-dir             │
│   ↓                                             │
│ Perform Automation Tasks                       │
│   ↓                                             │
│ Save Cookies to Shared Cache                   │
│   ↓                                             │
│ Cleanup & Persist Session                      │
└─────────────────────────────────────────────────┘
```

---

## 🚀 Usage Examples

### Basic Session Management
```python
from session_manager import SessionManager

# Create session manager
manager = SessionManager(headless=False, debug=True)

# Use context manager for automatic cleanup
with manager.session() as driver:
    driver.get('https://dashboard.nationalpid.com')
    # Perform automation...
    # Cookies automatically saved on exit
```

### Quick Selenium Driver
```python
from session_manager import get_selenium_driver

driver = get_selenium_driver(headless=False)
driver.get('https://example.com')
# Remember to call driver.quit() when done
```

### Test Session Persistence
```bash
# Run test with debug logging
python session_manager.py --debug --url https://dashboard.nationalpid.com

# Test headless mode
python session_manager.py --headless
```

---

## 🔧 Migration from Legacy Extensions

### From `playerid-updates-v2`
```python
# OLD: Manual ChromeDriver setup
options = Options()
options.add_argument(f"--user-data-dir=~/selenium_chrome_profile")
driver = webdriver.Chrome(service=service, options=options)

# NEW: Unified session manager
from session_manager import SessionManager
with SessionManager().session() as driver:
    # Same automation code
```

### From `scout-n8n-singleton`
```python
# OLD: Playwright storageState (ephemeral)
context = await browser.new_context(storage_state="state.json")

# NEW: Will use persistent context (future implementation)
# For now, use Selenium with persistent profile
from session_manager import get_selenium_driver
driver = get_selenium_driver()
```

---

## 📊 Session Persistence Benefits

| Feature | Legacy (Ephemeral) | Unified (Persistent) |
|---------|-------------------|---------------------|
| Token Refresh | ❌ Fails after expiry | ✅ Automatic via live profile |
| Cookie Management | Manual save/load | ✅ Automatic persistence |
| Browser State | Lost between runs | ✅ Maintained across runs |
| Setup Time | ~10s per run | ~2s (profile cached) |
| Authentication | Re-login required | ✅ Session continuity |

---

## 🧪 Validation Tests

### 1. Session Continuity Test
```python
# Run 1: Initial authentication
with SessionManager().session() as driver:
    driver.get('https://dashboard.nationalpid.com/login')
    # Manually login...
    input("Login complete. Press Enter to save session...")

# Run 2: Verify session persisted (run immediately after)
with SessionManager().session() as driver:
    driver.get('https://dashboard.nationalpid.com/dashboard')
    # Should NOT redirect to login page
    assert '/login' not in driver.current_url
```

### 2. Cookie Persistence Test
```python
manager = SessionManager()
with manager.session() as driver:
    driver.get('https://example.com')
    driver.add_cookie({'name': 'test', 'value': 'persist'})
    manager.save_cookies()

# Verify cookie saved
assert manager.COOKIES_FILE.exists()
```

---

## 🛡️ Error Handling & Recovery

### Chrome Process Cleanup
```bash
# If browser processes leak
pkill -f "Google Chrome.*user-data-dir.*npid"

# Check for orphaned processes
ps aux | grep "user-data-dir.*npid"
```

### Profile Lock Issues
If you see "Chrome is already running" errors:
```bash
# Remove profile lock file
rm ~/.cache/playwright/npid/selenium-profile/SingletonLock
```

### Reset Session Cache
```bash
# Nuclear option: clear all session data
rm -rf ~/.cache/playwright/npid/*
```

---

## 🎯 Next Steps

### Phase 1: Complete ✅
- [x] Fork both extensions
- [x] Create unified session manager
- [x] Implement Selenium persistent profile
- [x] Build shared cache directory structure

### Phase 2: Integration (Next)
- [ ] Migrate `playerid-updates-v2` automation scripts to use `SessionManager`
- [ ] Refactor `scout-n8n-singleton` inbox scraper with unified sessions
- [ ] Add comprehensive error handling and logging
- [ ] Create validation test suite

### Phase 3: Playwright Integration (Future)
- [ ] Implement `launchPersistentContext` for Playwright
- [ ] Build hybrid fallback mechanism (Playwright → Selenium)
- [ ] Benchmark performance comparison
- [ ] Document when to use each engine

---

## 📚 References

- **Original Extensions:**
  - Scout: `/Users/singleton23/Raycast/scout-n8n-singleton/`
  - PlayerID: `/Users/singleton23/Raycast/playerid-updates-v2/`
- **Unified Workspace:** `/Users/singleton23/Raycast/prospect-pipeline-unified/`
- **Session Cache:** `~/.cache/playwright/npid/`

---

## 🐛 Known Issues & Workarounds

1. **ChromeDriver Version Mismatch**
   - **Issue:** ChromeDriver auto-update may lag behind Chrome updates
   - **Workaround:** `webdriver-manager` automatically handles this
   
2. **Headless Authentication**
   - **Issue:** Some sites detect headless mode
   - **Workaround:** Use `--headless=new` flag (included in SessionManager)

3. **Profile Size Growth**
   - **Issue:** Persistent profiles can grow large over time
   - **Workaround:** Periodic cleanup of cache (manual for now)

---

**Status:** ✅ Session Manager Core Implemented | 🟡 Testing In Progress
