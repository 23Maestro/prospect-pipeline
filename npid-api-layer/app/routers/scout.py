"""
Scout Router
FastAPI endpoints for scout-prep task list functionality.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
import re

from app.models.schemas import ScoutPortalTasksResponse, ScoutRecentProfilesResponse
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["scout"])
logger = logging.getLogger(__name__)
FEATURE = "scout-tasks"


def filter_scout_tasks_by_search(tasks: list[dict], search_text: str | None) -> list[dict]:
    query = normalize_scout_task_search_text(search_text)
    terms = [term for term in query.split() if term]
    if not terms:
        return tasks

    searchable_fields = (
        "athlete_name",
        "contact",
        "title",
        "description",
        "sport",
        "sport_name",
        "high_school",
        "high_school_city",
        "city",
        "state",
        "high_school_state",
        "grad_year",
        "user",
        "assigned_owner",
    )
    matches: list[dict] = []
    for task in tasks:
        text = normalize_scout_task_search_text(
            " ".join(str(task.get(field) or "") for field in searchable_fields)
        )
        words = text.split()
        if query in text or all(
            any(word.startswith(term) for word in words) if len(term) <= 2 else term in text
            for term in terms
        ):
            matches.append(task)
    return matches


def normalize_scout_task_search_text(value: str | None) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split())


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/tasks", response_model=ScoutPortalTasksResponse)
async def get_scout_portal_tasks(
    request: Request,
    assignedto: str = "100001",
    range: str = "todayPastDue",
    start: int | None = None,
    length: int | None = None,
    searchText: str | None = None,
):
    """
    Fetch the scout task list shown by the dashboard task XHR.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "SCOUT_TASKS_FETCH %s",
        {
            "event": "SCOUT_TASKS_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "assignedto": assignedto,
                "range": range,
                "start": start,
                "length": length,
                "searchText": searchText,
            },
        },
    )

    try:
        endpoint, params = translator.portal_tasks_to_legacy(
            assigned_to=assignedto,
            range_value=range,
            start=start,
            length=length,
            search_text=searchText,
        )
        response = await session.get(endpoint, params=params)
        logger.info(
            "SCOUT_TASKS_FETCH %s",
            {
                "event": "SCOUT_TASKS_FETCH",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "assignedto": assignedto,
                    "range": range,
                    "start": start,
                    "length": length,
                    "searchText": searchText,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                },
            },
        )
        result = translator.parse_portal_tasks_response(response.text)
        tasks = result.get("tasks", [])
        tasks = filter_scout_tasks_by_search(tasks, searchText)
        if length is not None and len(tasks) > length:
            page_start = max(start or 0, 0)
            tasks = tasks[page_start:page_start + max(length, 0)]
        logger.info(
            "SCOUT_TASKS_FETCH %s",
            {
                "event": "SCOUT_TASKS_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "assignedto": assignedto,
                    "range": range,
                    "start": start,
                    "length": length,
                    "searchText": searchText,
                    "count": len(tasks),
                },
            },
        )
        return ScoutPortalTasksResponse(success=True, count=len(tasks), tasks=tasks)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "SCOUT_TASKS_FETCH %s",
            {
                "event": "SCOUT_TASKS_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "assignedto": assignedto,
                    "range": range,
                    "start": start,
                    "length": length,
                    "searchText": searchText,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/recent-profiles", response_model=ScoutRecentProfilesResponse)
async def get_scout_recent_profiles(
    request: Request,
    scout_id: str = "100001",
):
    """
    Fetch recently viewed athlete profiles from the scout topviews widget.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "SCOUT_RECENT_PROFILES_FETCH %s",
        {
            "event": "SCOUT_RECENT_PROFILES_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "scoutId": scout_id,
            },
        },
    )

    try:
        endpoint, params = translator.scout_topviews_to_legacy(scout_id=scout_id)
        response = await session.get(endpoint, params=params)
        body_preview = (response.text or "")[:200]
        logger.info(
            "SCOUT_RECENT_PROFILES_FETCH %s",
            {
                "event": "SCOUT_RECENT_PROFILES_FETCH",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "scoutId": scout_id,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                    "bodyLength": len(response.text or ""),
                    "bodyPreview": body_preview,
                },
            },
        )
        result = translator.parse_scout_topviews_response(response.text)
        profiles = result.get("profiles", [])
        logger.info(
            "SCOUT_RECENT_PROFILES_FETCH %s",
            {
                "event": "SCOUT_RECENT_PROFILES_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "scoutId": scout_id,
                    "count": len(profiles),
                    "firstAthlete": profiles[0].get("athlete_name") if profiles else None,
                },
            },
        )
        return ScoutRecentProfilesResponse(success=True, count=len(profiles), profiles=profiles)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "SCOUT_RECENT_PROFILES_FETCH %s",
            {
                "event": "SCOUT_RECENT_PROFILES_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "scoutId": scout_id,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
