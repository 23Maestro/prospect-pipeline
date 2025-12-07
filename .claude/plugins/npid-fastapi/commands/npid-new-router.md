---
name: npid:new-router
description: Create new FastAPI router using vetted template
arguments: <router-name>
---

# Create New FastAPI Router

Create a new router at `npid-api-layer/app/routers/{router-name}.py` using the approved template that follows npid-fastapi-skill.md patterns.

## Usage

```bash
/npid:new-router <router-name>
```

Example:
```bash
/npid:new-router notifications
```

Creates: `npid-api-layer/app/routers/notifications.py`

## Template

```python
"""
{RouterName} Router
FastAPI endpoints for {router-name} functionality.
"""

from fastapi import APIRouter, Request, HTTPException
from app.models.schemas import (
    # Add your schemas here
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession
import logging

router = APIRouter(prefix="/{router-name}", tags=["{router-name}"])
logger = logging.getLogger(__name__)


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/example/{id}")
async def example_get(request: Request, id: str):
    """
    Example GET endpoint.
    Replace with actual endpoint implementation.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📤 Example GET for {id}")

    try:
        # GET requests don't need CSRF token
        response = await session.get(f"/legacy/endpoint?id={id}")

        # Parse response (HTML or JSON)
        # Use translator for HTML parsing
        result = {"success": True, "data": response.text[:100]}

        return result
    except Exception as e:
        logger.error(f"❌ Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/example")
async def example_post(request: Request):
    """
    Example POST endpoint.
    Replace with actual endpoint implementation.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📤 Example POST")

    try:
        # Translator converts request → Laravel form data
        endpoint, form_data = translator.example_to_legacy()

        # session.post() auto-injects _token
        response = await session.post(endpoint, data=form_data)

        # Parse response
        result = {"success": True, "message": "Example completed"}

        return result
    except Exception as e:
        logger.error(f"❌ Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

## Pattern Checklist

Before completing, verify:

- [ ] ✅ Imports `NPIDSession` class (NOT `get_session` function)
- [ ] ✅ Defines local `get_session()` helper
- [ ] ✅ Imports `LegacyTranslator`
- [ ] ✅ Uses `session.post()` for POST requests
- [ ] ✅ Calls translator methods (no inline form data)
- [ ] ✅ No inline HTML parsing
- [ ] ✅ No `json=` parameter usage
- [ ] ✅ Registered in main.py
- [ ] ✅ Passes `/npid:validate-routers`

**Router created successfully! Ready for implementation.**
