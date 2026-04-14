"""
Sales Router
FastAPI endpoints for official sales-stage workflows in scout-prep.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import SalesStageOptionsResponse, MeetingSetTemplateResponse
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["sales"])
logger = logging.getLogger(__name__)
FEATURE = "sales-stage"


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


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
