"""
Mobile API router for externally reachable workflow calls.

These endpoints are intended for Vercel/Tailscale access and require a shared
bearer token. Existing Raycast-local routes remain unchanged.
"""

from datetime import datetime, timezone
import hmac
import os
import pickle
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, status
import httpx
from pydantic import BaseModel
from requests.cookies import RequestsCookieJar

from app.models.schemas import HeadScoutSlotsResponse
from app.session import NPIDSession, NPID_BASE_URL
from app.translators.legacy import LegacyTranslator

router = APIRouter(tags=["mobile"])
HEAD_SCOUT_TIMEZONE = ZoneInfo("America/New_York")
ACTIVE_OPERATOR_NAME = "Primary Operator"
DASHBOARD_BASE_URL = "https://legacy-dashboard.example.com"
COACH_RISNER_SESSION_FILE = Path.home() / ".npid_sessions" / "coach_risner.pkl"
COACH_RISNER_OPERATOR_NAME = "Secondary Operator"


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


def get_coach_risner_session() -> NPIDSession:
    return NPIDSession(session_file=str(COACH_RISNER_SESSION_FILE))


def get_coach_risner_assigned_to() -> str:
    return os.getenv("COACH_RISNER_ASSIGNED_TO", "").strip()


class ContactReminderIntakeRequest(BaseModel):
    phone: Optional[str] = None
    name: Optional[str] = None
    message: str
    received_at: Optional[str] = None
    source: Optional[str] = "ios_shortcut"


class CoachRisnerLoginRequest(BaseModel):
    email: str
    password: str


@router.post("/coach-risner/login")
async def login_coach_risner(request: Request, payload: CoachRisnerLoginRequest):
    require_mobile_token(request.headers.get("authorization"))

    email = payload.email.strip()
    password = payload.password
    if not email or not password:
      raise HTTPException(
          status_code=status.HTTP_400_BAD_REQUEST,
          detail="Prospect ID email and password are required",
      )

    async with httpx.AsyncClient(
        base_url=NPID_BASE_URL,
        timeout=30.0,
        follow_redirects=False,
        headers={
            "User-Agent": "NPID-API-Layer/0.1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    ) as client:
        login_page = await client.get("/auth/login")
        if login_page.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Prospect login page returned HTTP {login_page.status_code}",
            )

        token_match = re.search(r'name="_token"\s+value="([^"]+)"', login_page.text)
        if not token_match:
            token_match = re.search(r'value="([^"]+)"\s+name="_token"', login_page.text)
        if not token_match:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not read Prospect login token",
            )

        login_response = await client.post(
            "/auth/login",
            data={
                "email": email,
                "password": password,
                "_token": token_match.group(1),
                "remember": "on",
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": f"{NPID_BASE_URL}/auth/login",
            },
        )

        location = login_response.headers.get("location", "")
        if login_response.status_code not in [301, 302] or "/auth/login" in location:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Prospect login failed",
            )

        cookie_jar = RequestsCookieJar()
        for cookie in client.cookies.jar:
            cookie_jar.set(
                cookie.name,
                cookie.value,
                domain=cookie.domain,
                path=cookie.path,
            )

        COACH_RISNER_SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(COACH_RISNER_SESSION_FILE, "wb") as session_file:
            pickle.dump(cookie_jar, session_file)

    return {
        "success": True,
        "operator": "coach_risner",
        "session_file": {
            "path": str(COACH_RISNER_SESSION_FILE),
            "exists": COACH_RISNER_SESSION_FILE.exists(),
            "size_bytes": COACH_RISNER_SESSION_FILE.stat().st_size,
        },
        "message": "Coach Risner Prospect session saved",
    }


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
    return re.sub(
        r"^\((?:ACF\*?2?|CF|RSP|CAN|FU|CL|NS|\*)\)\s*",
        "",
        (value or "").replace("Follow Up -", "").strip(),
        flags=re.IGNORECASE,
    ).strip()


def resolve_appointment_title_outcome(value: str | None) -> str:
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
        normalized == "open"
        or normalized == "coaching session"
        or normalized.startswith("follow up -")
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
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def is_confirmation_task(task: dict, assigned_owner: str = ACTIVE_OPERATOR_NAME) -> bool:
    title = str(task.get("title") or "").strip().lower()
    description = str(task.get("description") or "").strip().lower()
    task_assigned_owner = str(task.get("assigned_owner") or "").strip().lower()
    normalized_owner = assigned_owner.strip().lower()
    return (
        (not normalized_owner or task_assigned_owner == normalized_owner)
        and ("confirmation call" in title or "confirm the meeting set" in description)
    )


def is_confirmation_task_for_owner(task: dict, owner_name: str) -> bool:
    title = str(task.get("title") or "").strip().lower()
    description = str(task.get("description") or "").strip().lower()
    assigned_owner = str(task.get("assigned_owner") or "").strip().lower()
    normalized_owner = owner_name.strip().lower()
    return (
        (not normalized_owner or assigned_owner == normalized_owner)
        and ("confirmation call" in title or "confirm the meeting set" in description)
    )


def pick_confirmation_task(tasks: list[dict], assigned_owner: str = ACTIVE_OPERATOR_NAME) -> dict | None:
    matches = [task for task in tasks if is_confirmation_task_for_owner(task, assigned_owner)]
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


async def fetch_scout_tasks(
    session: NPIDSession,
    translator: LegacyTranslator,
    range_value: str,
    assigned_to: str = "100001",
) -> list[dict]:
    endpoint, params = translator.portal_tasks_to_legacy(
        assigned_to=assigned_to,
        range_value=range_value,
        start=None,
        length=None,
    )
    response = await session.get(endpoint, params=params)
    result = translator.parse_portal_tasks_response(response.text)
    return list(result.get("tasks", []))


def strip_move_this_task_prefix(value: str | None) -> str:
    text = str(value or "").strip()
    cleaned = re.sub(r"^\(SC Move This Task\)\s*", "", text, flags=re.IGNORECASE).strip()
    return cleaned or text


def build_dashboard_admin_url(athlete_id: str, athlete_main_id: str) -> str:
    query = urlencode({"contactid": athlete_id, "athlete_main_id": athlete_main_id})
    return f"{DASHBOARD_BASE_URL}/admin/athletes?{query}"


def build_dashboard_task_url(athlete_id: str, athlete_main_id: str) -> str:
    query = urlencode({"contactid": athlete_id, "athlete_main_id": athlete_main_id, "tasktab": "1"})
    return f"{DASHBOARD_BASE_URL}/admin/athletes?{query}"


def build_mobile_set_meetings_response(
    calendar_result: dict,
    tasks: list[dict],
    operator_name: str = ACTIVE_OPERATOR_NAME,
) -> dict:
    tasks_by_athlete: dict[str, list[dict]] = {}
    for task in tasks:
        if not is_confirmation_task_for_owner(task, operator_name):
            continue
        key = normalize_match_key(task.get("athlete_name"))
        if key:
            tasks_by_athlete.setdefault(key, []).append(task)

    materialized_events = []
    for event in calendar_result.get("events", []) or []:
        if not is_actual_set_meeting_event(event):
            continue

        event_id = str((event or {}).get("event_id") or "").strip()
        start = str((event or {}).get("start") or "").strip()
        title = str((event or {}).get("title") or "").strip()
        if not event_id or not start or not title:
            continue

        title_key = normalize_match_key(clean_meeting_title(title))
        matching_key = next((key for key in tasks_by_athlete if key and key in title_key), None)
        matched_task = pick_confirmation_task(tasks_by_athlete.get(matching_key, []), operator_name) if matching_key else None
        if not matching_key or not matched_task:
            continue
        tasks_by_athlete.pop(matching_key, None)

        athlete_id = str((matched_task or {}).get("athlete_id") or (matched_task or {}).get("contact_id") or "").strip()
        athlete_main_id = str((matched_task or {}).get("athlete_main_id") or "").strip()
        athlete_name = str((matched_task or {}).get("athlete_name") or "").strip()
        if not athlete_id or not athlete_main_id or not athlete_name:
            continue

        materialized_events.append(
            {
                **event,
                "key": f"{athlete_id}:{athlete_main_id}",
                "athlete_id": athlete_id,
                "athlete_main_id": athlete_main_id,
                "athlete_name": athlete_name,
                "stage": "Meeting Set",
                "current_task": strip_move_this_task_prefix(matched_task.get("title")) or "Confirmation Call",
                "task_id": str((matched_task or {}).get("task_id") or "").strip() or None,
                "head_scout_name": event.get("assigned_owner"),
                "booked_meeting_title": title,
                "current_meeting_label": event.get("date_time_label"),
                "admin_url": build_dashboard_admin_url(athlete_id, athlete_main_id),
                "task_url": build_dashboard_task_url(athlete_id, athlete_main_id),
                "confirmation_recipient": None,
                "source": "website",
                "crm_sales_stage": "Meeting Set",
                "lifecycle_state": "scheduled",
                "needs_confirmation_text": True,
                "needs_manual_review": False,
                "reason": f"Weekly booked meeting assigned to {operator_name} confirmation queue.",
                "operator_status": "active_meeting_queue",
                "badges": [],
            }
        )

    return {
        "success": True,
        "week_start": calendar_result.get("week_start"),
        "week_end": calendar_result.get("week_end"),
        "count": len(materialized_events),
        "raw_booked_count": calendar_result.get("count", 0),
        "events": sorted(
            materialized_events,
            key=lambda event: (str(event.get("start") or ""), str(event.get("athlete_name") or "")),
        ),
    }


async def hydrate_confirmation_context(
    session: NPIDSession,
    translator: LegacyTranslator,
    payload: dict,
) -> dict:
    hydrated_events = []
    for event in payload.get("events", []) or []:
        contact_info = await fetch_contact_info(
            session,
            translator,
            str(event.get("athlete_id") or ""),
            str(event.get("athlete_main_id") or ""),
        )
        recipient = resolve_confirmation_recipient(contact_info)
        hydrated_events.append(
            {
                **event,
                "confirmation_recipient": recipient,
                "contact_timezone": (contact_info or {}).get("timezone"),
                "contact_timezone_label": (contact_info or {}).get("timezone_label"),
            }
        )
    return {**payload, "events": hydrated_events}


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
        return build_mobile_set_meetings_response(result, tasks)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/set-meetings")
async def get_mobile_set_meetings(
    request: Request,
    start: str,
    end: str,
    task_range: str = "thisWeek",
):
    return await get_mobile_booked_meetings(
        request=request,
        start=start,
        end=end,
        task_range=task_range,
    )


@router.get("/coach-risner/set-meetings")
async def get_coach_risner_set_meetings(
    request: Request,
    start: str,
    end: str,
    task_range: str = "thisWeek",
):
    require_mobile_token(request.headers.get("authorization"))
    if not COACH_RISNER_SESSION_FILE.exists():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Coach Risner Prospect session is missing. Log in through /tim-mobile first.",
        )

    session = get_coach_risner_session()
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
            assigned_to=get_coach_risner_assigned_to(),
        )
        payload = build_mobile_set_meetings_response(
            result,
            tasks,
            operator_name=COACH_RISNER_OPERATOR_NAME,
        )
        return await hydrate_confirmation_context(session, translator, payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        await session.close()


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
