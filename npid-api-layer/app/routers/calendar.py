"""
Calendar Router
FastAPI endpoints for head scout schedule availability.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import (
    BookedMeetingLookupResponse,
    HeadScoutSlotsResponse,
    OpenMeetingsResponse,
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["calendar"])
logger = logging.getLogger(__name__)
FEATURE = "head-scout-slots"


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/head-scout-slots", response_model=HeadScoutSlotsResponse)
async def get_head_scout_slots(
    request: Request,
    start: str,
    end: str,
):
    """
    Fetch open calendar slots for configured head scouts.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "HEAD_SCOUT_SLOTS_FETCH %s",
        {
            "event": "HEAD_SCOUT_SLOTS_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "start": start,
                "end": end,
            },
        },
    )

    try:
        endpoint, params = translator.head_scout_slots_to_legacy(start=start, end=end)
        response = await session.get(endpoint, params=params)
        logger.info(
            "HEAD_SCOUT_SLOTS_FETCH %s",
            {
                "event": "HEAD_SCOUT_SLOTS_FETCH",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "start": start,
                    "end": end,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                    "bodyLength": len(response.text or ""),
                    "bodyPreview": (response.text or "")[:120],
                },
            },
        )
        result = translator.parse_head_scout_slots_response(
            raw_response=response.text,
            week_start=start,
            week_end=end,
        )
        logger.info(
            "HEAD_SCOUT_SLOTS_GROUP %s",
            {
                "event": "HEAD_SCOUT_SLOTS_GROUP",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "start": start,
                    "end": end,
                    "scoutCount": len(result.get("scouts", [])),
                    "slotCount": sum(int(scout.get("slot_count", 0)) for scout in result.get("scouts", [])),
                },
            },
        )
        return HeadScoutSlotsResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "HEAD_SCOUT_SLOTS_FETCH %s",
            {
                "event": "HEAD_SCOUT_SLOTS_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "start": start,
                    "end": end,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/open-meetings", response_model=OpenMeetingsResponse)
async def get_open_meetings(
    request: Request,
    meeting_for: str,
):
    """
    Fetch open meetings for a selected Meeting Set owner.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "OPEN_MEETINGS_FETCH %s",
        {
            "event": "OPEN_MEETINGS_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "meetingFor": meeting_for,
            },
        },
    )

    try:
        endpoint, params = translator.open_meetings_to_legacy(meeting_for=meeting_for)
        response = await session.get(endpoint, params=params)
        logger.info(
            "OPEN_MEETINGS_FETCH %s",
            {
                "event": "OPEN_MEETINGS_FETCH",
                "step": "response",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "meetingFor": meeting_for,
                    "endpoint": endpoint,
                    "statusCode": response.status_code,
                    "contentType": response.headers.get("content-type"),
                    "bodyLength": len(response.text or ""),
                    "bodyPreview": (response.text or "")[:120],
                },
            },
        )
        result = translator.parse_open_meetings_response(response.text)
        logger.info(
            "OPEN_MEETINGS_FETCH %s",
            {
                "event": "OPEN_MEETINGS_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "meetingFor": meeting_for,
                    "count": len(result.get("slots", [])),
                },
            },
        )
        return OpenMeetingsResponse(meeting_for=meeting_for, **result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "OPEN_MEETINGS_FETCH %s",
            {
                "event": "OPEN_MEETINGS_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "meetingFor": meeting_for,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/booked-meeting", response_model=BookedMeetingLookupResponse)
async def get_booked_meeting(
    request: Request,
    calendar_owner_id: str,
    title: str,
    start: str,
    end: str,
):
    """
    Fetch booked calendar event for a scout owner and meeting title.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    scout_config = next(
        (
            config
            for config in translator.HEAD_SCOUT_CONFIG
            if str(config.get("calendar_owner_id") or "").strip() == calendar_owner_id.strip()
        ),
        None,
    )
    scout_name = str((scout_config or {}).get("scout_name") or "").strip()

    logger.info(
        "BOOKED_MEETING_FETCH %s",
        {
            "event": "BOOKED_MEETING_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "calendarOwnerId": calendar_owner_id,
                "title": title,
                "start": start,
                "end": end,
                "scoutName": scout_name,
            },
        },
    )

    try:
        endpoint, params = translator.booked_meeting_to_legacy(
            calendar_owner_id=calendar_owner_id,
            start=start,
            end=end,
        )
        response = await session.get(endpoint, params=params)
        result = translator.parse_booked_meeting_response(
            response.text,
            title_query=title,
            scout_name=scout_name,
        )
        logger.info(
            "BOOKED_MEETING_FETCH %s",
            {
                "event": "BOOKED_MEETING_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "calendarOwnerId": calendar_owner_id,
                    "title": title,
                    "start": start,
                    "end": end,
                    "count": result.get("count", 0),
                    "found": bool(result.get("event")),
                },
            },
        )
        return BookedMeetingLookupResponse(
            calendar_owner_id=calendar_owner_id,
            title_query=title,
            start=start,
            end=end,
            **result,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "BOOKED_MEETING_FETCH %s",
            {
                "event": "BOOKED_MEETING_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "calendarOwnerId": calendar_owner_id,
                    "title": title,
                    "start": start,
                    "end": end,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
