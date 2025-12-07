---
name: npid-fastapi-validator
description: Validates FastAPI routers against npid-fastapi-skill.md patterns
type: validator
---

# NPID FastAPI Router Validator Agent

## Purpose

Automated validation agent that checks all FastAPI routers in `npid-api-layer/app/routers/` for compliance with npid-fastapi-skill.md patterns.

## Validation Rules

### 1. Import Pattern Validation

**Rule:** All routers MUST import `NPIDSession` class, NOT `get_session` function

**Check:**
```bash
grep -n "from app.session import get_session" npid-api-layer/app/routers/*.py
```

**Expected:** No results

**Violation Example:**
```python
# ❌ WRONG
from app.session import get_session
```

**Correct Pattern:**
```python
# ✅ CORRECT
from app.session import NPIDSession
```

---

### 2. Local get_session() Helper Validation

**Rule:** Every router MUST define local `get_session()` helper

**Check:**
```bash
for file in npid-api-layer/app/routers/*.py; do
  grep -q "def get_session(request: Request)" "$file" || echo "❌ $file missing get_session()"
done
```

**Correct Pattern:**
```python
def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager
```

---

### 3. Translator Usage Validation

**Rule:** All routers MUST use `LegacyTranslator` for Laravel interactions

**Check:**
```bash
grep -n "LegacyTranslator" npid-api-layer/app/routers/*.py
```

**Expected:** All routers import and use translator

---

### 4. Inline Form Construction Validation

**Rule:** NO inline `form_data = {` construction in routers

**Check:**
```bash
grep -n "form_data = {" npid-api-layer/app/routers/*.py
```

**Expected:** No results (all form data via translator)

**Violation Example:**
```python
# ❌ WRONG - Inline form construction
form_data = {
    "_token": session.csrf_token,
    "athlete_id": payload.athlete_id
}
```

**Correct Pattern:**
```python
# ✅ CORRECT - Use translator
endpoint, form_data = translator.method_to_legacy(payload)
```

---

### 5. Inline HTML Parsing Validation

**Rule:** NO BeautifulSoup imports in routers

**Check:**
```bash
grep -n "BeautifulSoup" npid-api-layer/app/routers/*.py
```

**Expected:** No results (all parsing in translator)

---

### 6. Session Wrapper Validation

**Rule:** All POST calls MUST use `session.post()` not `client.post()`

**Check:**
```bash
grep -n "\.post(" npid-api-layer/app/routers/*.py | grep -v "session.post" | grep -v "@router.post"
```

**Expected:** No results (only @router.post decorators)

---

### 7. JSON Body Validation

**Rule:** NO `json=` parameter in POST requests

**Check:**
```bash
grep -n "json=" npid-api-layer/app/routers/*.py
```

**Expected:** No results (Laravel requires form-encoding)

---

## Agent Workflow

When invoked (via `/npid:validate-routers`):

1. **Read all router files** in `npid-api-layer/app/routers/`
2. **Run all 7 validation checks**
3. **Collect violations** with file:line references
4. **Generate fix suggestions** for each violation
5. **Display validation report**

## Validation Report Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FASTAPI ROUTER VALIDATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Routers Checked: 4
- athlete.py
- assignments.py
- email.py
- video.py

Violations Found: [COUNT]

[If violations found:]

❌ VIOLATION 1: Import Pattern
File: npid-api-layer/app/routers/email.py:14
Found: from app.session import get_session
Expected: from app.session import NPIDSession

💡 Fix:
  1. Change line 14 to: from app.session import NPIDSession
  2. Add local helper after logger:
     def get_session(request: Request) -> NPIDSession:
         from main import session_manager
         return session_manager
  3. Run /npid:fix-email-router for automated fix

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[If no violations:]

✅ ALL ROUTERS COMPLIANT

All routers follow npid-fastapi-skill.md patterns:
  ✅ Import NPIDSession class (not get_session)
  ✅ Define local get_session() helper
  ✅ Use LegacyTranslator
  ✅ No inline form construction
  ✅ No inline HTML parsing
  ✅ Use session.post() wrapper
  ✅ No json= parameters

Ready to commit!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Fix Suggestions

For each violation type, provide specific fix instructions:

**Import Violation:**
- Use `/npid:fix-email-router` if email.py
- Manually change import statement
- Add local get_session() helper

**Missing get_session():**
- Add helper function after logger definition
- Use exact pattern from working routers

**Inline Form Construction:**
- Move form logic to LegacyTranslator
- Create new translator method
- Call translator in router

**Inline HTML Parsing:**
- Move parsing logic to LegacyTranslator
- Create parse_* method
- Call translator in router

**Session Wrapper:**
- Replace `client.post()` with `session.post()`
- Let NPIDSession handle CSRF

**JSON Body:**
- Remove `json=` parameter
- Use `data=` for form-encoding

## Integration

Agent can be invoked:
1. Manually via `/npid:validate-routers` command
2. Automatically via pre-commit hook
3. As part of CI/CD pipeline
4. On session start (optional)

**Validator agent ready for use!**
