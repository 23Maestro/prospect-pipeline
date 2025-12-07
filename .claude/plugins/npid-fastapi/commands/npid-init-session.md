---
name: npid:init-session
description: Initialize Claude Code session with all NPID skills and constraints
---

# NPID Session Initialization

## Session Initialization Protocol

Load all NPID project context into session memory before planning, coding, or reviewing.

### Step 1: Read Skills Index

Read `.claude/skills/README.md` to identify all skill files:
- `npid-fastapi-skill.md` (787 lines - FastAPI translation layer)
- `npid-existing-code/SKILL.md` (Reuse existing patterns)
- `npid-api-calls.md` (HTTP header requirements)
- `npid-video-submission.md` (Video workflow)
- `raycast-python.md` (Python bridge patterns)
- `npid-api.md` (Session management)

Load ALL of these skills into session context.

### Step 2: Display Critical Constraints

**Translator Pattern (MANDATORY):**
- ALL Laravel interactions through `LegacyTranslator`
- NO inline form construction in routers
- NO inline HTML parsing in routers
- USE `session.post()` not `client.post()`

**Session Pattern (MANDATORY):**
```python
from app.session import NPIDSession  # ✅ Import class, NOT function

def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager  # ✅ Lazy import
    return session_manager
```

**Python Environment (MANDATORY):**
- MUST use: `/Users/singleton23/Raycast/prospect-pipeline/venv/bin/python`
- NEVER use: system Python

**Legacy Quirks:**
- Laravel returns HTML by default
- `X-Requested-With: XMLHttpRequest` required for JSON
- CSRF token auto-injected by `session.post()`
- Form encoding: `application/x-www-form-urlencoded`

### Step 3: Generate Session Checklist

Create checklist for this session:

- [ ] FastAPI changes? → Read `npid-fastapi-skill.md` first
- [ ] New router? → Use `/npid:new-router` template
- [ ] Modifying router? → Run `/npid:validate-routers` after
- [ ] Python scripts? → Verify venv path used
- [ ] Committing? → Pre-commit hook will validate

### Step 4: Load Verification Commands

```bash
# Import pattern check
grep "from app.session import get_session" npid-api-layer/app/routers/*.py

# Inline form construction check
grep "form_data = {" npid-api-layer/app/routers/*.py

# JSON body usage check
grep "json=" npid-api-layer/app/routers/*.py

# Inline HTML parsing check
grep "BeautifulSoup" npid-api-layer/app/routers/*.py
```

### Step 5: Display Session Banner

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NPID LEGACY INTEGRATION SESSION INITIALIZED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Skills Loaded: 6
✅ Translator Pattern: ENFORCED
✅ Session Pattern: ENFORCED
✅ Python Environment: venv only
✅ Validation Commands: Ready

📚 Quick Commands:
  /npid:validate-routers    - Check all routers
  /npid:new-router <name>   - Create new router
  /npid:fix-email-router    - Fix email import bug

⚠️  CRITICAL RULES:
  • Check Python reference FIRST (src/python/npid_api_client.py)
  • Use LegacyTranslator for ALL Laravel calls
  • Define local get_session() in EVERY router
  • NEVER bypass translator pattern

Ready for: Planning → Coding → Reviewing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Session context loaded. Ready to work!**
