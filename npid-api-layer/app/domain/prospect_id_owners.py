"""Shared Prospect ID owner directory loader.

This mirrors the TypeScript owner source without changing legacy request shapes.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parents[3]
OWNER_CONFIG_PATH = REPO_ROOT / "config" / "prospect-id-owners.json"


@lru_cache(maxsize=1)
def get_owner_config() -> Dict[str, Any]:
    with OWNER_CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def get_owner_by_key(owner_key: str) -> Optional[Dict[str, Any]]:
    normalized_key = str(owner_key or "").strip()
    if not normalized_key:
        return None
    for owner in get_owner_config().get("owners", []):
        if owner.get("ownerKey") == normalized_key:
            return owner
    return None


def get_active_operator() -> Dict[str, Any]:
    config = get_owner_config()
    owner = get_owner_by_key(config.get("activeOperatorKey"))
    if not owner:
        raise ValueError("Active operator is missing from Prospect ID owner config")
    return owner


def get_head_scout_owners() -> List[Dict[str, Any]]:
    owners = []
    for owner in get_owner_config().get("owners", []):
        if "head_scout" in owner.get("roles", []):
            owners.append(owner)
    return owners


def get_head_scout_calendar_owner_ids() -> List[str]:
    return [
        str(owner.get("calendarOwnerId") or "").strip()
        for owner in get_head_scout_owners()
        if str(owner.get("calendarOwnerId") or "").strip()
    ]


def get_head_scout_calendar_access_user_id() -> str:
    return str(get_owner_config().get("headScoutCalendarAccessUserId") or "").strip()


def get_head_scout_config_for_legacy() -> List[Dict[str, str]]:
    legacy_config: List[Dict[str, str]] = []
    for owner in get_head_scout_owners():
        legacy_config.append(
            {
                "scout_name": str(owner.get("personName") or "").strip(),
                "city": str(owner.get("city") or "").strip(),
                "state": str(owner.get("state") or "").strip(),
                "calendar_owner_id": str(owner.get("calendarOwnerId") or "").strip(),
                "meeting_for": str(owner.get("meetingForLegacyUserId") or "").strip(),
            }
        )
    return legacy_config
