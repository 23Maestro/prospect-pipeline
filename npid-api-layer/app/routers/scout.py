"""
Scout Router
FastAPI endpoints for scout-prep task list functionality.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import ScoutPortalTasksResponse
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["scout"])
logger = logging.getLogger(__name__)
FEATURE = "scout-tasks"


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/tasks", response_model=ScoutPortalTasksResponse)
async def get_scout_portal_tasks(
    request: Request,
    assignedto: str = "1408164",
    range: str = "todayPastDue",
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
            },
        },
    )

    try:
        endpoint, params = translator.portal_tasks_to_legacy(assigned_to=assignedto, range_value=range)
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
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                },
            },
        )
        result = translator.parse_portal_tasks_response(response.text)
        tasks = result.get("tasks", [])
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
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
