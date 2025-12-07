---
name: npid:validate-routers
description: Validate all FastAPI routers against npid-fastapi-skill.md patterns
---

# FastAPI Router Validation

Run comprehensive validation on all routers in `npid-api-layer/app/routers/`

## Validation Checks

### 1. Import Pattern Check

**Verify:** All routers import `NPIDSession` class, NOT `get_session` function

```bash
grep -n "from app.session import" npid-api-layer/app/routers/*.py
```

**Expected:** All files show `from app.session import NPIDSession`

**Violations:** Any file with `from app.session import get_session`

---

### 2. Local get_session() Check

**Verify:** Each router defines local `get_session()` helper

```bash
for file in npid-api-layer/app/routers/*.py; do
  echo "Checking $file..."
  grep -q "def get_session(request: Request)" "$file" && echo "✅ Has get_session()" || echo "❌ Missing get_session()"
done
```

**Expected:** All routers have local helper function

---

### 3. Translator Pattern Check

**Verify:** All routers use `LegacyTranslator`

```bash
grep -n "LegacyTranslator" npid-api-layer/app/routers/*.py
```

**Expected:** All routers import and use translator

---

### 4. Inline Form Construction Check

**Verify:** NO inline `form_data = {` in routers

```bash
grep -n "form_data = {" npid-api-layer/app/routers/*.py
```

**Expected:** No results (all form data via translator)

---

### 5. Inline HTML Parsing Check

**Verify:** NO BeautifulSoup imports in routers

```bash
grep -n "BeautifulSoup" npid-api-layer/app/routers/*.py
```

**Expected:** No results (all parsing in translator)

---

### 6. Session Wrapper Check

**Verify:** All POST calls use `session.post()` not `client.post()`

```bash
grep -n "\.post(" npid-api-layer/app/routers/*.py | grep -v "session.post" | grep -v "@router.post"
```

**Expected:** No results (only @router.post decorators)

---

### 7. JSON Body Check

**Verify:** NO `json=` parameter in POST requests

```bash
grep -n "json=" npid-api-layer/app/routers/*.py
```

**Expected:** No results (Laravel requires form-encoding)

---

## Validation Report

Display summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FASTAPI ROUTER VALIDATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Routers Checked:
- athlete.py
- assignments.py
- email.py
- video.py

Violations Found: [COUNT]

[If violations:]
❌ VIOLATIONS DETECTED:

[List violations with file:line]

💡 Suggested Fixes:
[Per-violation fix suggestions]

[If no violations:]
✅ ALL ROUTERS COMPLIANT

All routers follow npid-fastapi-skill.md patterns.
Ready to commit!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Next Steps

**If violations found:**
1. Review violation details
2. Use `/npid:fix-email-router` for known email bug
3. Manually fix other violations following patterns
4. Re-run `/npid:validate-routers` to confirm

**If no violations:**
1. Proceed with development
2. Pre-commit hook will prevent future violations
