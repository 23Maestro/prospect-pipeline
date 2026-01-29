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
