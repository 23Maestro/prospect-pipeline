---
name: npid:fix-email-router
description: Fix email router import violation
---

# Fix Email Router Import Bug

Apply vetted fix to `npid-api-layer/app/routers/email.py` to resolve ImportError.

## Bug Details

**File:** `npid-api-layer/app/routers/email.py:14`

**Current (BROKEN):**
```python
from app.session import get_session  # ❌ Function doesn't exist
```

**Issue:** `app.session` module does NOT export a `get_session()` function, causing ImportError when FastAPI loads routers.

## Fix Implementation

### Step 1: Change Import Statement (Line 14)

**Replace:**
```python
from app.session import get_session
```

**With:**
```python
from app.session import NPIDSession
```

### Step 2: Add Local get_session() Helper

**Insert after line 18** (after logger definition, before first @router.get):

```python
def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager
```

## Verification

After applying fix, run:

```bash
# 1. Check import fixed
grep -n "from app.session import" npid-api-layer/app/routers/email.py
# Expected: "from app.session import NPIDSession"

# 2. Verify get_session defined
grep -A 3 "def get_session" npid-api-layer/app/routers/email.py
# Expected: Function definition with session_manager import

# 3. Run validation
/npid:validate-routers
# Expected: No violations

# 4. Test FastAPI server
cd npid-api-layer
source venv/bin/activate
python -m uvicorn main:app --reload --port 8000
# Expected: Server starts WITHOUT ImportError
```

## Complete Fixed File Structure

```python
"""
Email Router
FastAPI endpoints for email functionality using verified curl commands.
"""

from fastapi import APIRouter, Request, HTTPException
from app.models.schemas import (
    EmailTemplateDataRequest,
    EmailTemplateDataResponse,
    SendEmailRequest,
    SendEmailResponse
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession  # ✅ FIXED
import logging

router = APIRouter(prefix="/email", tags=["email"])
logger = logging.getLogger(__name__)


def get_session(request: Request) -> NPIDSession:  # ✅ ADDED
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/templates/{athlete_id}")
async def get_email_templates(request: Request, athlete_id: str):
    # ... rest of implementation unchanged
```

## Testing

After fix applied:

1. **Start FastAPI:**
   ```bash
   cd npid-api-layer && venv/bin/python -m uvicorn main:app --reload --port 8000
   ```

2. **Test endpoints:**
   ```bash
   # Test templates
   http GET :8000/api/v1/email/templates/1464610

   # Test template data
   http POST :8000/api/v1/email/template-data \
     template_id="172" \
     athlete_id="1464610"
   ```

3. **Test Raycast:**
   ```bash
   npm run dev
   ```
   Open "Email Student Athletes" command

## Success Criteria

- ✅ No ImportError when starting FastAPI
- ✅ Email router loads correctly
- ✅ All 3 endpoints functional (/templates, /template-data, /send)
- ✅ Raycast extension email command works
- ✅ `/npid:validate-routers` shows no violations

**Email router fixed successfully!**
