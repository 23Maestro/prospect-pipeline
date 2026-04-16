"""
Sales Router
FastAPI endpoints for official sales-stage workflows in scout-prep.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
from typing import Any, Dict, List, Optional

from app.models.schemas import (
    AthleteTask,
    MeetingSetTemplateResponse,
    SalesStageOptionsResponse,
    SalesStageUpdateRequest,
    SalesStageUpdateResponse,
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["sales"])
logger = logging.getLogger(__name__)
FEATURE = "sales-stage"


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_incomplete(task: Dict[str, Any]) -> bool:
    return not _normalize_text(task.get("completion_date"))


def _is_follow_up_call_task(task: Dict[str, Any]) -> bool:
    title = _normalize_text(task.get("title"))
    description = _normalize_text(task.get("description"))
    owner = _normalize_text(task.get("assigned_owner"))
    owner_ok = "jerami" in owner
    content_ok = title.startswith("call attempt") or "call the family" in description
    return owner_ok and content_ok and _is_incomplete(task)


def _pick_created_follow_up_task(tasks: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    candidates = [task for task in tasks if _is_follow_up_call_task(task)]
    if not candidates:
        return None

    def sort_key(task: Dict[str, Any]) -> tuple[int, str]:
        task_id = str(task.get("task_id") or "").strip()
        numeric = int(task_id) if task_id.isdigit() else -1
        return (numeric, task_id)

    return sorted(candidates, key=sort_key, reverse=True)[0]


@router.get("/stages/{athlete_id}", response_model=SalesStageOptionsResponse)
async def get_sales_stage_options(request: Request, athlete_id: str):
    """
    Fetch official sales-stage dropdown options for an athlete.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "SALES_STAGE_FETCH %s",
        {
            "event": "SALES_STAGE_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {"athleteId": athlete_id},
        },
    )

    try:
        endpoint, params = translator.sales_stage_options_to_legacy(athlete_id=athlete_id)
        response = await session.get(endpoint, params=params)
        logger.info(
            "SALES_STAGE_FETCH %s",
            {
                "event": "SALES_STAGE_FETCH",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "athleteId": athlete_id,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                    "bodyLength": len(response.text or ""),
                    "bodyPreview": (response.text or "")[:120],
                },
            },
        )
        result = translator.parse_sales_stage_options_response(response.text)
        logger.info(
            "SALES_STAGE_FETCH %s",
            {
                "event": "SALES_STAGE_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "athleteId": athlete_id,
                    "count": len(result.get("options", [])),
                    "selectedLabel": result.get("selected_label"),
                },
            },
        )
        return SalesStageOptionsResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "SALES_STAGE_FETCH %s",
            {
                "event": "SALES_STAGE_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {"athleteId": athlete_id},
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/meeting-set-template", response_model=MeetingSetTemplateResponse)
async def get_meeting_set_template(
    request: Request,
    adminathlete: str,
    athlete_main_id: str,
    cal_date: str = "",
    cal_time: str = "",
):
    """
    Fetch hydrated Meeting Set modal template data.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "MEETING_SET_TEMPLATE_FETCH %s",
        {
            "event": "MEETING_SET_TEMPLATE_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "adminathlete": adminathlete,
                "athleteMainId": athlete_main_id,
                "calDate": cal_date,
                "calTime": cal_time,
            },
        },
    )

    try:
        endpoint, params = translator.meeting_set_template_to_legacy(
            adminathlete=adminathlete,
            athlete_main_id=athlete_main_id,
            cal_date=cal_date,
            cal_time=cal_time,
        )
        response = await session.get(endpoint, params=params)
        logger.info(
            "MEETING_SET_TEMPLATE_FETCH %s",
            {
                "event": "MEETING_SET_TEMPLATE_FETCH",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "adminathlete": adminathlete,
                    "athleteMainId": athlete_main_id,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                    "bodyLength": len(response.text or ""),
                    "bodyPreview": (response.text or "")[:120],
                },
            },
        )
        result = translator.parse_meeting_set_template_response(response.text)
        logger.info(
            "MEETING_SET_TEMPLATE_FETCH %s",
            {
                "event": "MEETING_SET_TEMPLATE_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "adminathlete": adminathlete,
                    "athleteMainId": athlete_main_id,
                    "hasMeetingName": bool(result.get("meeting_name")),
                    "timezoneCount": len(result.get("recruit_timezone_options", [])),
                    "hasDetailsTemplate": bool(result.get("details_template")),
                },
            },
        )
        return MeetingSetTemplateResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "MEETING_SET_TEMPLATE_FETCH %s",
            {
                "event": "MEETING_SET_TEMPLATE_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "adminathlete": adminathlete,
                    "athleteMainId": athlete_main_id,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/stage", response_model=SalesStageUpdateResponse)
async def update_sales_stage(request: Request, payload: SalesStageUpdateRequest):
    """
    Update official sales stage through legacy /tasks/salesstage.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    stage = payload.stage.strip()
    athlete_main_id = payload.athlete_main_id.strip()
    athlete_id = payload.athlete_id.strip()

    if not athlete_main_id or not athlete_id or not stage:
        raise HTTPException(status_code=400, detail="athlete_main_id, athlete_id, and stage are required")

    logger.info(
        "SALES_STAGE_UPDATE %s",
        {
            "event": "SALES_STAGE_UPDATE",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "athleteId": athlete_id,
                "athleteMainId": athlete_main_id,
                "stage": stage,
            },
        },
    )

    try:
        endpoint, data = translator.sales_stage_update_to_legacy(
            athlete_main_id=athlete_main_id,
            athlete_id=athlete_id,
            stage=stage,
        )
        response = await session.post(endpoint, data=data)
        body_preview = (response.text or "")[:200]
        if response.status_code >= 400:
            logger.error(
                "SALES_STAGE_UPDATE %s",
                {
                    "event": "SALES_STAGE_UPDATE",
                    "step": "response",
                    "status": "failure",
                    "feature": FEATURE,
                    "error": body_preview or f"HTTP {response.status_code}",
                    "context": {
                        "athleteId": athlete_id,
                        "athleteMainId": athlete_main_id,
                        "stage": stage,
                        "statusCode": response.status_code,
                    },
                },
            )
            raise HTTPException(
                status_code=response.status_code,
                detail=body_preview or f"Sales stage update HTTP {response.status_code}",
            )

        logger.info(
            "SALES_STAGE_UPDATE %s",
            {
                "event": "SALES_STAGE_UPDATE",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "athleteId": athlete_id,
                    "athleteMainId": athlete_main_id,
                    "stage": stage,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "bodyPreview": body_preview,
                },
            },
        )
        tasks_endpoint, tasks_params = translator.tasks_list_to_legacy(athlete_id, athlete_main_id)
        tasks_response = await session.get(tasks_endpoint, params=tasks_params)
        tasks_result = translator.parse_tasks_list_response(tasks_response.text)
        tasks = tasks_result.get("tasks", [])
        created_task_payload = _pick_created_follow_up_task(tasks)

        return SalesStageUpdateResponse(
            success=True,
            stage=stage,
            athlete_id=athlete_id,
            athlete_main_id=athlete_main_id,
            status_code=response.status_code,
            tasks_count=len(tasks),
            created_task=AthleteTask(**created_task_payload) if created_task_payload else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "SALES_STAGE_UPDATE %s",
            {
                "event": "SALES_STAGE_UPDATE",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "athleteId": athlete_id,
                    "athleteMainId": athlete_main_id,
                    "stage": stage,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
