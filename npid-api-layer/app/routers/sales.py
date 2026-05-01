"""
Sales Router
FastAPI endpoints for official sales-stage workflows in scout-prep.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
import re
from typing import Any, Dict, List, Optional

from app.models.schemas import (
    AthleteTask,
    MeetingSetSubmitRequest,
    MeetingSetSubmitResponse,
    MeetingSetTemplateResponse,
    SendEmailRequest,
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


def _strip_move_this_task_prefix(value: Any) -> Optional[str]:
    trimmed = str(value or "").strip()
    if not trimmed:
        return None
    cleaned = trimmed
    cleaned = re.sub(r"^\(?sc move this task\)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    return cleaned or trimmed


def _normalize_task_for_response(task: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(task)
    normalized["title"] = _strip_move_this_task_prefix(task.get("title"))
    return normalized


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


async def _verify_sales_stage_persisted(
    session: NPIDSession,
    translator: LegacyTranslator,
    athlete_id: str,
    expected_stage: str,
) -> str:
    options_endpoint, options_params = translator.sales_stage_options_to_legacy(athlete_id=athlete_id)
    options_response = await session.get(options_endpoint, params=options_params)
    options_result = translator.parse_sales_stage_options_response(options_response.text)
    selected_label = str(options_result.get("selected_label") or "").strip()

    logger.info(
        "SALES_STAGE_UPDATE %s",
        {
            "event": "SALES_STAGE_UPDATE",
            "step": "readback",
            "status": "success",
            "feature": FEATURE,
            "context": {
                "athleteId": athlete_id,
                "expectedStage": expected_stage,
                "selectedLabel": selected_label or None,
                "endpoint": options_endpoint,
                "statusCode": options_response.status_code,
                "bodyLength": len(options_response.text or ""),
                "bodyPreview": (options_response.text or "")[:120],
            },
        },
    )

    if not selected_label or selected_label.lower() == "select":
        raise HTTPException(
            status_code=502,
            detail="Sales stage did not persist; legacy readback is still Select",
        )

    if not translator.sales_stage_labels_match(expected_stage, selected_label):
        raise HTTPException(
            status_code=502,
            detail=f"Sales stage readback mismatch: expected {expected_stage}, got {selected_label}",
        )

    return selected_label


def _is_confirmation_call_task(task: Dict[str, Any]) -> bool:
    title = _normalize_text(task.get("title"))
    description = _normalize_text(task.get("description"))
    return "confirmation call" in title or "confirm the meeting set" in description


def _is_move_this_task(task: Dict[str, Any]) -> bool:
    title = _normalize_text(task.get("title"))
    return "sc move this task" in title


def _pick_created_confirmation_task(tasks: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    candidates = [
        task for task in tasks if _is_move_this_task(task) and _is_incomplete(task)
    ]
    if not candidates:
        candidates = [
            task for task in tasks if _is_confirmation_call_task(task) and _is_incomplete(task)
        ]
    if not candidates:
        return None

    def sort_key(task: Dict[str, Any]) -> tuple[int, str]:
        task_id = str(task.get("task_id") or "").strip()
        numeric = int(task_id) if task_id.isdigit() else -1
        return (numeric, task_id)

    return _normalize_task_for_response(sorted(candidates, key=sort_key, reverse=True)[0])


async def _verify_sales_stage_persisted(
    session: NPIDSession,
    translator: LegacyTranslator,
    athlete_id: str,
    expected_stage: str,
) -> str:
    endpoint, params = translator.sales_stage_options_to_legacy(athlete_id=athlete_id)
    response = await session.get(endpoint, params=params)
    body_preview = (response.text or "")[:200]
    result = translator.parse_sales_stage_options_response(response.text)
    selected_stage = str(
        result.get("selected_label") or result.get("selected_value") or ""
    ).strip()

    if not selected_stage or not translator.sales_stage_labels_match(selected_stage, expected_stage):
        logger.error(
            "SALES_STAGE_VERIFY %s",
            {
                "event": "SALES_STAGE_VERIFY",
                "step": "readback",
                "status": "failure",
                "feature": FEATURE,
                "error": "Sales stage did not persist",
                "context": {
                    "athleteId": athlete_id,
                    "expectedStage": expected_stage,
                    "selectedStage": selected_stage or None,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                    "bodyPreview": body_preview,
                },
            },
        )
        raise HTTPException(
            status_code=502,
            detail=f"Sales stage did not persist; selected is {selected_stage or 'Select'}",
        )

    logger.info(
        "SALES_STAGE_VERIFY %s",
        {
            "event": "SALES_STAGE_VERIFY",
            "step": "readback",
            "status": "success",
            "feature": FEATURE,
            "context": {
                "athleteId": athlete_id,
                "selectedStage": selected_stage,
                "statusCode": response.status_code,
            },
        },
    )
    return selected_stage


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
        legacy_stage = str(data.get("stage") or stage).strip()
        body_preview = (response.text or "")[:200]
        persisted_stage = ""
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

        persisted_stage = await _verify_sales_stage_persisted(
            session=session,
            translator=translator,
            athlete_id=athlete_id,
            expected_stage=legacy_stage,
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
                    "persistedStage": persisted_stage,
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
            stage=persisted_stage or stage,
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


@router.post("/meeting-set", response_model=MeetingSetSubmitResponse)
async def submit_meeting_set(request: Request, payload: MeetingSetSubmitRequest):
    """
    Submit legacy Meeting Set form, then send default Meeting Set email.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    athlete_id = payload.athlete_id.strip()
    athlete_main_id = payload.athlete_main_id.strip()
    assigned_to = payload.assigned_to.strip()
    open_event_id = payload.open_event_id.strip()
    meeting_name = payload.meeting_name.strip()
    template_id = payload.template_id.strip() or "210"

    if not athlete_id or not athlete_main_id:
        raise HTTPException(status_code=400, detail="athlete_id and athlete_main_id are required")
    if not assigned_to or not open_event_id:
        raise HTTPException(status_code=400, detail="assigned_to and open_event_id are required")
    if not meeting_name:
        raise HTTPException(status_code=400, detail="meeting_name is required")

    logger.info(
        "MEETING_SET_SUBMIT %s",
        {
            "event": "MEETING_SET_SUBMIT",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "athleteId": athlete_id,
                "athleteMainId": athlete_main_id,
                "assignedTo": assigned_to,
                "openEventId": open_event_id,
                "templateId": template_id,
            },
        },
    )

    try:
        endpoint, form_data = translator.meeting_set_submit_to_legacy(payload)
        response = await session.post(endpoint, data=form_data)
        body_preview = (response.text or "")[:200]
        if response.status_code >= 400:
            logger.error(
                "MEETING_SET_SUBMIT %s",
                {
                    "event": "MEETING_SET_SUBMIT",
                    "step": "response",
                    "status": "failure",
                    "feature": FEATURE,
                    "error": body_preview or f"HTTP {response.status_code}",
                    "context": {
                        "athleteId": athlete_id,
                        "athleteMainId": athlete_main_id,
                        "assignedTo": assigned_to,
                        "openEventId": open_event_id,
                        "statusCode": response.status_code,
                    },
                },
            )
            raise HTTPException(
                status_code=response.status_code,
                detail=body_preview or f"Meeting Set HTTP {response.status_code}",
            )

        logger.info(
            "MEETING_SET_SUBMIT %s",
            {
                "event": "MEETING_SET_SUBMIT",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "athleteId": athlete_id,
                    "athleteMainId": athlete_main_id,
                    "assignedTo": assigned_to,
                    "openEventId": open_event_id,
                    "statusCode": response.status_code,
                    "bodyPreview": body_preview,
                },
            },
        )

        tasks_endpoint, tasks_params = translator.tasks_list_to_legacy(athlete_id, athlete_main_id)
        tasks_response = await session.get(tasks_endpoint, params=tasks_params)
        tasks_result = translator.parse_tasks_list_response(tasks_response.text)
        tasks = tasks_result.get("tasks", [])
        created_task_payload = _pick_created_confirmation_task(tasks)

        logger.info(
            "MEETING_SET_EMAIL %s",
            {
                "event": "MEETING_SET_EMAIL",
                "step": "request",
                "status": "start",
                "feature": FEATURE,
                "context": {
                    "athleteId": athlete_id,
                    "templateId": template_id,
                },
            },
        )

        template_endpoint, template_form_data = translator.template_data_to_legacy(template_id, athlete_id)
        template_response = await session.post(template_endpoint, data=template_form_data)
        template_data = translator.parse_template_data_response(template_response.text)
        if not template_data:
            raise HTTPException(status_code=500, detail="Failed to parse meeting-set email template data")

        recipients_response = await session.get(f"/rulestemplates/template/sendingtodetails?id={athlete_id}")
        recipients = translator.parse_email_recipients(recipients_response.text)
        parent_ids = [
            str(parent.get("id") or "").strip()
            for parent in recipients.get("parents", [])
            if parent.get("checked") and str(parent.get("id") or "").strip()
        ]
        include_athlete = bool(recipients.get("athlete", {}).get("checked"))
        other_email = str(recipients.get("other_email") or "").strip() or None

        email_request = SendEmailRequest(
            athlete_id=athlete_id,
            template_id=template_id,
            notification_from=str(template_data.get("sender_name") or "Video Team"),
            notification_from_email=str(
                template_data.get("sender_email") or "videoteam@prospectid.com"
            ),
            notification_subject=str(template_data.get("templatesubject") or ""),
            notification_message=str(template_data.get("templatedescription") or ""),
            include_athlete=include_athlete,
            parent_ids=parent_ids or None,
            other_email=other_email,
        )
        email_endpoint, email_form_data = translator.send_email_to_legacy(email_request)
        email_response = await session.post(email_endpoint, data=email_form_data)
        email_sent = email_response.status_code == 200 and "failed" not in (
            email_response.text or ""
        ).lower()

        logger.info(
            "MEETING_SET_EMAIL %s",
            {
                "event": "MEETING_SET_EMAIL",
                "step": "response",
                "status": "success" if email_sent else "failure",
                "feature": FEATURE,
                **(
                    {"error": (email_response.text or "")[:200]}
                    if not email_sent
                    else {}
                ),
                "context": {
                    "athleteId": athlete_id,
                    "templateId": template_id,
                    "includeAthlete": include_athlete,
                    "parentCount": len(parent_ids),
                    "statusCode": email_response.status_code,
                },
            },
        )

        return MeetingSetSubmitResponse(
            success=True,
            athlete_id=athlete_id,
            athlete_main_id=athlete_main_id,
            assigned_to=assigned_to,
            open_event_id=open_event_id,
            meeting_name=meeting_name,
            template_id=template_id,
            status_code=response.status_code,
            email_sent=email_sent,
            created_task=AthleteTask(**created_task_payload) if created_task_payload else None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "MEETING_SET_SUBMIT %s",
            {
                "event": "MEETING_SET_SUBMIT",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "athleteId": athlete_id,
                    "athleteMainId": athlete_main_id,
                    "assignedTo": assigned_to,
                    "openEventId": open_event_id,
                    "templateId": template_id,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
