"""
Mobile API router for externally reachable workflow calls.

These endpoints are intended for Vercel/Tailscale access and require a shared
bearer token. Existing Raycast-local routes remain unchanged.
"""

from datetime import datetime, timezone
import hmac
import os
from typing import Optional
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.models.schemas import HeadScoutSlotsResponse
from app.session import NPIDSession
from app.translators.legacy import LegacyTranslator

router = APIRouter(tags=["mobile"])
HEAD_SCOUT_TIMEZONE = ZoneInfo("America/New_York")


def require_mobile_token(authorization: Optional[str]) -> None:
    token = os.getenv("PROSPECT_API_TOKEN", "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PROSPECT_API_TOKEN is not configured",
        )

    expected = f"Bearer {token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid mobile API token",
        )


def get_session(request: Request) -> NPIDSession:
    from main import session_manager

    return session_manager


class ContactReminderIntakeRequest(BaseModel):
    phone: Optional[str] = None
    name: Optional[str] = None
    message: str
    received_at: Optional[str] = None
    source: Optional[str] = "ios_shortcut"


@router.get("/calendar/head-scout-slots", response_model=HeadScoutSlotsResponse)
async def get_mobile_head_scout_slots(
    request: Request,
    start: str,
    end: str,
):
    require_mobile_token(request.headers.get("authorization"))
    session = get_session(request)
    translator = LegacyTranslator()

    try:
        endpoint, params = translator.head_scout_slots_to_legacy(start=start, end=end)
        response = await session.get(endpoint, params=params)
        result = translator.parse_head_scout_slots_response(
            raw_response=response.text,
            week_start=start,
            week_end=end,
        )
        return HeadScoutSlotsResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def clean_meeting_title(value: str | None) -> str:
    import re

    return re.sub(
        r"^\((?:ACF\*?2?|CF|RSP|CAN|FU|CL|NS|\*)\)\s*",
        "",
        (value or "").replace("Follow Up -", "").strip(),
        flags=re.IGNORECASE,
    ).strip()


def resolve_appointment_title_outcome(value: str | None) -> str:
    import re

    title = (value or "").strip()
    if re.match(r"^\s*\(ENR(?:\s+\$?[0-9]+(?:\.[0-9]{1,2})?)?[^)]*\)\s*", title, flags=re.IGNORECASE):
        return "terminal_enrollment"
    if re.match(r"^\s*\(RSP\)(?:\*\d+)?\s*", title, flags=re.IGNORECASE):
        return "reschedule_pending"
    if re.match(r"^\s*\(CL\)(?:\*\d+)?\s*", title, flags=re.IGNORECASE):
        return "terminal_close_lost"
    if re.match(r"^\s*\(FU\)(?:\*\d+)?\s*", title, flags=re.IGNORECASE):
        return "soft_archive_follow_up"
    if re.match(r"^\s*\(CAN\)(?:\*\d+)?\s*", title, flags=re.IGNORECASE):
        return "soft_archive_canceled"
    if re.match(r"^\s*\(NS\)(?:\*\d+)?\s*", title, flags=re.IGNORECASE):
        return "soft_archive_no_show"
    return "active"


def is_actual_set_meeting_event(event: dict | None) -> bool:
    title = str((event or {}).get("title") or "").strip()
    if not title:
        return False
    if resolve_appointment_title_outcome(title) != "active":
        return False
    normalized = title.lower()
    return not (
        normalized.startswith("follow up -")
        or normalized.startswith("(fu)")
        or normalized.startswith("(cl)")
        or normalized.startswith("(*)")
    )


def parse_head_scout_event_time(value: str | None) -> datetime | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None
    try:
        parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo:
        return parsed.astimezone(HEAD_SCOUT_TIMEZONE)
    return parsed.replace(tzinfo=HEAD_SCOUT_TIMEZONE)


def is_meeting_visible_until_end(event: dict | None, now: datetime | None = None) -> bool:
    end_at = parse_head_scout_event_time(str((event or {}).get("end") or ""))
    if not end_at:
        return True
    compare_at = now or datetime.now(HEAD_SCOUT_TIMEZONE)
    if compare_at.tzinfo:
        compare_at = compare_at.astimezone(HEAD_SCOUT_TIMEZONE)
    else:
        compare_at = compare_at.replace(tzinfo=HEAD_SCOUT_TIMEZONE)
    return end_at > compare_at


def is_visible_set_meeting_event(event: dict | None, now: datetime | None = None) -> bool:
    return is_actual_set_meeting_event(event) and is_meeting_visible_until_end(event, now)


def normalize_match_key(value: str | None) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def is_confirmation_task(task: dict) -> bool:
    title = str(task.get("title") or "").strip().lower()
    description = str(task.get("description") or "").strip().lower()
    assigned_owner = str(task.get("assigned_owner") or "").strip().lower()
    return (
        assigned_owner == "jerami singleton"
        and ("confirmation call" in title or "confirm the meeting set" in description)
    )


def pick_confirmation_task(tasks: list[dict]) -> dict | None:
    matches = [task for task in tasks if is_confirmation_task(task)]
    if not matches:
        return None

    def sort_key(task: dict):
        completed_rank = 1 if str(task.get("completion_date") or "").strip() else 0
        due_date = str(task.get("due_date") or "").strip()
        task_id = str(task.get("task_id") or "").strip()
        return (completed_rank, -datetime_sort_value(due_date), _negative_int(task_id))

    return sorted(matches, key=sort_key)[0]


def datetime_sort_value(value: str) -> float:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


def _negative_int(value: str) -> int:
    try:
        return -int(value)
    except Exception:
        return 0


async def fetch_scout_tasks(session: NPIDSession, translator: LegacyTranslator, range_value: str) -> list[dict]:
    endpoint, params = translator.portal_tasks_to_legacy(
        assigned_to="1408164",
        range_value=range_value,
        start=None,
        length=None,
    )
    response = await session.get(endpoint, params=params)
    result = translator.parse_portal_tasks_response(response.text)
    return list(result.get("tasks", []))


async def fetch_contact_info(session: NPIDSession, translator: LegacyTranslator, contact_id: str, athlete_main_id: str) -> dict | None:
    try:
        endpoint, form_data = translator.contact_info_to_legacy(contact_id, athlete_main_id)
        info_response = await session.post(endpoint, data=form_data)
        if info_response.status_code != 200:
            return None
        contact_data = translator.parse_athleteinfo_response(info_response.text)
        return translator.merge_contact_data(contact_id, contact_data, [])
    except Exception:
        return None


def resolve_confirmation_recipient(contact_info: dict | None) -> dict | None:
    if not contact_info:
        return None
    parent1 = contact_info.get("parent1") or {}
    parent2 = contact_info.get("parent2") or {}
    student = contact_info.get("studentAthlete") or contact_info.get("student_athlete") or {}

    for role, person in (("parent1", parent1), ("parent2", parent2), ("studentAthlete", student)):
        phone = str((person or {}).get("phone") or "").strip()
        if phone:
            return {
                "role": role,
                "name": (person or {}).get("name"),
                "phone": phone,
            }
    return None


@router.get("/calendar/booked-meetings")
async def get_mobile_booked_meetings(
    request: Request,
    start: str,
    end: str,
    task_range: str = "thisWeek",
):
    require_mobile_token(request.headers.get("authorization"))
    session = get_session(request)
    translator = LegacyTranslator()

    try:
        endpoint, params = translator.head_scout_slots_to_legacy(start=start, end=end)
        response = await session.get(endpoint, params=params)
        result = translator.parse_head_scout_booked_meetings_response(
            raw_response=response.text,
            week_start=start,
            week_end=end,
        )
        tasks = await fetch_scout_tasks(
            session,
            translator,
            "nextWeek" if task_range == "nextWeek" else "thisWeek",
        )
        tasks_by_athlete = {}
        for task in tasks:
            if not is_confirmation_task(task):
                continue
            key = normalize_match_key(task.get("athlete_name"))
            if key:
                tasks_by_athlete.setdefault(key, []).append(task)

        materialized_events = []
        actual_events = [event for event in result.get("events", []) if is_visible_set_meeting_event(event)]
        for event in actual_events:
            title_key = normalize_match_key(clean_meeting_title(event.get("title")))
            matching_key = next((key for key in tasks_by_athlete if key and key in title_key), None)
            matched_task = pick_confirmation_task(tasks_by_athlete.get(matching_key, [])) if matching_key else None
            if not matching_key or not matched_task:
                continue
            tasks_by_athlete.pop(matching_key, None)

            athlete_id = str((matched_task or {}).get("athlete_id") or (matched_task or {}).get("contact_id") or "").strip()
            athlete_main_id = str((matched_task or {}).get("athlete_main_id") or "").strip()
            if not athlete_id or not athlete_main_id:
                continue

            contact_info = (
                await fetch_contact_info(session, translator, athlete_id, athlete_main_id)
                if athlete_id and athlete_main_id
                else None
            )
            admin_query = urlencode({"contactid": athlete_id, "athlete_main_id": athlete_main_id})
            task_query = urlencode({"contactid": athlete_id, "athlete_main_id": athlete_main_id, "tasktab": "1"})
            materialized_events.append(
                {
                    **event,
                    "key": f"{athlete_id}:{athlete_main_id}",
                    "athlete_id": athlete_id,
                    "athlete_main_id": athlete_main_id,
                    "athlete_name": (matched_task or {}).get("athlete_name"),
                    "stage": "Meeting Set",
                    "current_task": str((matched_task or {}).get("title") or "").replace("Move this Task:", "").strip() or "Confirmation Call",
                    "task_id": str((matched_task or {}).get("task_id") or "").strip() or None,
                    "head_scout_name": event.get("assigned_owner"),
                    "booked_meeting_title": event.get("title"),
                    "current_meeting_label": event.get("date_time_label"),
                    "admin_url": f"https://dashboard.nationalpid.com/admin/athletes?{admin_query}",
                    "task_url": f"https://dashboard.nationalpid.com/admin/athletes?{task_query}",
                    "confirmation_recipient": resolve_confirmation_recipient(contact_info),
                    "source": "website",
                    "operator_status": "active_meeting_queue",
                }
            )

        return {
            "success": True,
            "week_start": result.get("week_start"),
            "week_end": result.get("week_end"),
            "count": len(materialized_events),
            "raw_booked_count": result.get("count", 0),
            "events": sorted(materialized_events, key=lambda event: str(event.get("start") or "")),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/contact-reminder-intake")
async def contact_reminder_intake(
    request: Request,
    payload: ContactReminderIntakeRequest,
):
    require_mobile_token(request.headers.get("authorization"))

    received_at = payload.received_at or datetime.now(timezone.utc).isoformat()
    clean_phone = (payload.phone or "").strip()
    clean_name = (payload.name or "").strip()
    clean_message = payload.message.strip()

    if not clean_message:
        raise HTTPException(status_code=422, detail="message is required")

    title_name = clean_name or clean_phone or "Client"
    reminder_title = f"Follow up with {title_name}"
    reminder_notes = "\n".join(
        part
        for part in [
            f"Source: {payload.source or 'ios_shortcut'}",
            f"Received: {received_at}",
            f"Phone: {clean_phone}" if clean_phone else "",
            f"Name: {clean_name}" if clean_name else "",
            "",
            clean_message,
        ]
        if part != ""
    )

    return {
        "success": True,
        "received_at": received_at,
        "source": payload.source or "ios_shortcut",
        "input": {
            "phone": clean_phone or None,
            "name": clean_name or None,
            "message": clean_message,
        },
        "reminder": {
            "title": reminder_title,
            "notes": reminder_notes,
        },
        "contact": {
            "name": clean_name or None,
            "phone": clean_phone or None,
        },
        "next_action": "create_reminder",
    }
