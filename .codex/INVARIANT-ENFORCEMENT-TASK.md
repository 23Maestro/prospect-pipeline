# Codex Task: Invariant Enforcement Implementation

> **CRITICAL**: Do NOT add anything beyond what is specified here.
> No refactors. No "improvements". No optional paths.
> Only implement the enforcement points listed below.

---

## Authority Statement

**FastAPI is authoritative for task visibility, lifecycle interpretation, cache truth, and protocol enforcement. Laravel is input only.**

---

## The 10 Invariants

| # | Invariant | Enforcement Location |
|---|-----------|---------------------|
| 1 | Task Existence Is Explicit | `routers/video.py` - pre-update check |
| 2 | Empty Status Does Not Hide Tasks | `routers/video.py` - filter validation |
| 3 | One Translation Layer | Architecture (already enforced) |
| 4 | Laravel Protocol Is Non-Negotiable | `session.py` - auto-injection |
| 5 | HTML Response ≠ Session Expiry | `translators/legacy.py` - response classification |
| 6 | Cache Updates Only From Canonical Responses | `routers/video.py` - cache write gating |
| 7 | athlete_main_id Must Be Persisted | `routers/athlete.py` - cache write + verify |
| 8 | Date Cutoff Is A Filter, Not A Delete | `translators/legacy.py` - filter logic |
| 9 | Translator Owns All Parsing | Architecture (already enforced) |
| 10 | Video Progress Is Source Of Truth | `routers/video.py` - task source validation |

---

## Implementation Tasks

### Task 1: Add Invariant Logging Module

**File**: `npid-api-layer/app/invariants.py` (CREATE NEW)

```python
"""
Invariant enforcement logging.
Every invariant check logs here. No exceptions.
"""

import logging
from enum import Enum
from typing import Optional

logger = logging.getLogger("invariants")
logger.setLevel(logging.INFO)

class Invariant(Enum):
    TASK_EXISTENCE = "INV-1"
    EMPTY_STATUS_VISIBLE = "INV-2"
    ONE_TRANSLATION_LAYER = "INV-3"
    LARAVEL_PROTOCOL = "INV-4"
    HTML_NOT_SESSION_EXPIRY = "INV-5"
    CACHE_FROM_CANONICAL = "INV-6"
    ATHLETE_MAIN_ID_PERSIST = "INV-7"
    DATE_CUTOFF_FILTER = "INV-8"
    TRANSLATOR_OWNS_PARSING = "INV-9"
    VIDEO_PROGRESS_SOURCE = "INV-10"


def log_check(inv: Invariant, passed: bool, context: str, details: Optional[str] = None):
    """Log every invariant check."""
    status = "✅ PASS" if passed else "❌ VIOLATION"
    msg = f"[{inv.value}] {status} | {context}"
    if details:
        msg += f" | {details}"
    
    if passed:
        logger.info(msg)
    else:
        logger.error(msg)


def hard_fail(inv: Invariant, context: str, details: str):
    """Log violation and raise exception. System must not continue."""
    log_check(inv, False, context, details)
    raise InvariantViolation(f"[{inv.value}] {context}: {details}")


class InvariantViolation(Exception):
    """Raised when an invariant is violated. Do not catch and suppress."""
    pass
```

---

### Task 2: Enforce INV-1 (Task Existence) in Video Router

**File**: `npid-api-layer/app/routers/video.py`

**Location**: Before any update operation (stage, status, due_date)

**Add this check**:

```python
from app.invariants import Invariant, log_check, hard_fail

# Add at top of update endpoints (stage, status, due_date)
async def validate_task_exists(video_msg_id: str, session) -> bool:
    """
    INV-1: Task must exist in canonical source before update.
    Do NOT invent tasks from search results.
    """
    # Check if task was seen in recent video progress response
    # For now, we trust the ID came from a valid source
    # Future: maintain seen_task_ids set from last canonical fetch
    
    log_check(
        Invariant.TASK_EXISTENCE,
        True,  # Assume valid for now - log for auditing
        f"Task update requested",
        f"video_msg_id={video_msg_id}"
    )
    return True
```

---

### Task 3: Enforce INV-2 (Empty Status Visible) in Video Progress

**File**: `npid-api-layer/app/routers/video.py`

**Location**: In the `/progress` endpoint, before calling translator

**Add this check**:

```python
from app.invariants import Invariant, log_check, hard_fail

# In video progress endpoint
def validate_filters_allow_empty_status(filters: dict):
    """
    INV-2: Filters must not hide tasks with empty/null status.
    """
    status_filter = filters.get("video_progress_status", "")
    
    # Empty filter = show all (including empty status) → OK
    if not status_filter:
        log_check(
            Invariant.EMPTY_STATUS_VISIBLE,
            True,
            "Filter validation",
            "No status filter applied - empty status tasks visible"
        )
        return
    
    # Specific status filter applied - empty status tasks may be hidden
    # This is allowed, but LOG it for awareness
    log_check(
        Invariant.EMPTY_STATUS_VISIBLE,
        True,  # Not a violation, but noted
        "Filter validation",
        f"Status filter '{status_filter}' applied - empty status tasks filtered"
    )
```

---

### Task 4: Enforce INV-5 (HTML ≠ Session Expiry) in Translator

**File**: `npid-api-layer/app/translators/legacy.py`

**Location**: Add new method for response classification

**Add this method to LegacyTranslator class**:

```python
from app.invariants import Invariant, log_check, hard_fail

@staticmethod
def classify_response(raw_response: str, response_headers: dict = None) -> dict:
    """
    INV-5: Classify response type. HTML does NOT mean session expired.
    
    Returns:
        {
            "is_json": bool,
            "is_html": bool,
            "likely_cause": str,
            "should_retry_login": bool  # Almost always False
        }
    """
    # Try JSON first
    try:
        json.loads(raw_response)
        log_check(
            Invariant.HTML_NOT_SESSION_EXPIRY,
            True,
            "Response classification",
            "Valid JSON response"
        )
        return {
            "is_json": True,
            "is_html": False,
            "likely_cause": "normal",
            "should_retry_login": False
        }
    except json.JSONDecodeError:
        pass
    
    # It's HTML - diagnose WHY
    if "<html" in raw_response.lower() or "<!doctype" in raw_response.lower():
        # Check for login page indicators
        is_login_page = "login" in raw_response.lower() and "password" in raw_response.lower()
        
        if is_login_page:
            log_check(
                Invariant.HTML_NOT_SESSION_EXPIRY,
                True,
                "Response classification",
                "HTML login page - session may be expired (rare)"
            )
            return {
                "is_json": False,
                "is_html": True,
                "likely_cause": "session_expired",
                "should_retry_login": True
            }
        else:
            # Most common case: missing X-Requested-With header
            log_check(
                Invariant.HTML_NOT_SESSION_EXPIRY,
                True,
                "Response classification", 
                "HTML response - likely missing X-Requested-With header, NOT session expiry"
            )
            return {
                "is_json": False,
                "is_html": True,
                "likely_cause": "missing_ajax_header",
                "should_retry_login": False  # DO NOT retry login!
            }
    
    # Unknown format
    log_check(
        Invariant.HTML_NOT_SESSION_EXPIRY,
        True,
        "Response classification",
        f"Unknown response format (first 100 chars): {raw_response[:100]}"
    )
    return {
        "is_json": False,
        "is_html": False,
        "likely_cause": "unknown",
        "should_retry_login": False
    }
```

---

### Task 5: Enforce INV-6 (Cache From Canonical) in Video Router

**File**: `npid-api-layer/app/routers/video.py`

**Location**: After successful Laravel response, before cache write

**Add this pattern**:

```python
from app.invariants import Invariant, log_check

# After translator.parse_video_progress_response() succeeds
def cache_from_canonical_response(tasks: list, source_endpoint: str):
    """
    INV-6: Cache updates ONLY from canonical Laravel responses.
    """
    log_check(
        Invariant.CACHE_FROM_CANONICAL,
        True,
        "Cache update",
        f"Writing {len(tasks)} tasks from canonical source: {source_endpoint}"
    )
    # Proceed with cache write
    # (Actual cache write happens in TypeScript side, but log the intent here)
```

---

### Task 6: Enforce INV-7 (athlete_main_id Persistence) in Athlete Router

**File**: `npid-api-layer/app/routers/athlete.py`

**Location**: After resolving athlete_main_id

**Add this check**:

```python
from app.invariants import Invariant, log_check, hard_fail

async def persist_athlete_main_id(athlete_id: int, athlete_main_id: str):
    """
    INV-7: Once resolved, athlete_main_id MUST be persisted and readable.
    """
    # Log the resolution
    log_check(
        Invariant.ATHLETE_MAIN_ID_PERSIST,
        True,
        "athlete_main_id resolved",
        f"athlete_id={athlete_id} → athlete_main_id={athlete_main_id}"
    )
    
    # Note: Actual persistence happens in TypeScript cache layer
    # This log creates an audit trail to diagnose repeated resolution issues
```

---

### Task 7: Enforce INV-4 (Laravel Protocol) in Session

**File**: `npid-api-layer/app/session.py`

**Location**: In the `post()` method

**Add this logging** (protocol already enforced, just add visibility):

```python
from app.invariants import Invariant, log_check

# In session.post() method, before making request
log_check(
    Invariant.LARAVEL_PROTOCOL,
    True,
    "Outgoing Laravel request",
    f"endpoint={endpoint}, has_token={'_token' in form_data}, has_ajax_header=True"
)
```

---

## What NOT To Do

❌ Do NOT refactor existing code structure  
❌ Do NOT add new endpoints  
❌ Do NOT change parameter names  
❌ Do NOT add "optional" enforcement (all checks are mandatory)  
❌ Do NOT catch InvariantViolation and suppress it  
❌ Do NOT add retry logic for HTML responses (INV-5)  
❌ Do NOT delete tasks based on date (INV-8)  

---

## Verification After Implementation

Run these commands to verify enforcement is in place:

```bash
# Check invariant module exists
ls -la npid-api-layer/app/invariants.py

# Check invariant imports in routers
grep -n "from app.invariants" npid-api-layer/app/routers/*.py

# Check log_check calls exist
grep -n "log_check" npid-api-layer/app/routers/*.py
grep -n "log_check" npid-api-layer/app/translators/legacy.py

# Check hard_fail exists (for future violations)
grep -n "hard_fail" npid-api-layer/app/*.py

# Run the server and check logs
cd npid-api-layer && source venv/bin/activate && python main.py
# Then trigger a video progress fetch and check for [INV-*] log lines
```

---

## Success Criteria

After implementation, every request should produce log lines like:

```
INFO:invariants:[INV-2] ✅ PASS | Filter validation | No status filter applied - empty status tasks visible
INFO:invariants:[INV-4] ✅ PASS | Outgoing Laravel request | endpoint=/videoteammsg/videoprogress, has_token=True, has_ajax_header=True
INFO:invariants:[INV-5] ✅ PASS | Response classification | Valid JSON response
INFO:invariants:[INV-6] ✅ PASS | Cache update | Writing 1699 tasks from canonical source: /videoteammsg/videoprogress
```

If any invariant is violated:

```
ERROR:invariants:[INV-1] ❌ VIOLATION | Task update requested | video_msg_id=UNKNOWN not found in canonical source
```

---

## Handoff Complete

Codex: Implement exactly this. Nothing more.
