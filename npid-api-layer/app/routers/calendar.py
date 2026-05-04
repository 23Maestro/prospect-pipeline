"""
Calendar Router
FastAPI endpoints for head scout schedule availability.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import (
    AthleteBookedMeetingsResponse,
    BookedMeetingDescriptionUpdateRequest,
    BookedMeetingDescriptionUpdateResponse,
    BookedMeetingDetailsResponse,
    BookedMeetingLookupResponse,
    BookedMeetingTitleUpdateRequest,
    BookedMeetingTitleUpdateResponse,
    HeadScoutBookedMeetingsResponse,
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


@router.post("/booked-meeting/description", response_model=BookedMeetingDescriptionUpdateResponse)
async def update_booked_meeting_description(
    request: Request,
    payload: BookedMeetingDescriptionUpdateRequest,
):
    """
    Update a booked Meeting Set description by exact event id.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "BOOKED_MEETING_DESCRIPTION_UPDATE %s",
        {
            "event": "BOOKED_MEETING_DESCRIPTION_UPDATE",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "eventId": payload.event_id,
                "eventDate": payload.event_date,
                "descriptionLength": len(payload.description or ""),
            },
        },
    )

    try:
        popup_endpoint, popup_params = translator.booked_meeting_popup_to_legacy(
            event_id=payload.event_id,
            event_date=payload.event_date,
        )
        popup_response = await session.get(popup_endpoint, params=popup_params)
        popup_result = translator.parse_booked_meeting_popup_response(popup_response.text)
        form_data = popup_result.get("form_data", {})

        original_description = str(form_data.get("taskdescription") or "")
        updated_description = str(payload.description or "")

        if updated_description != original_description:
            updated_form_data = translator.apply_booked_meeting_description_update(
                form_data=form_data,
                event_id=payload.event_id,
                description=updated_description,
            )
            endpoint, final_form_data = translator.booked_meeting_title_update_to_legacy(updated_form_data)
            update_response = await session.post(endpoint, data=final_form_data)
            update_result = translator.parse_task_update_response(update_response.text)
            if not update_result.get("success"):
                raise HTTPException(
                    status_code=400,
                    detail=update_result.get("message", "Booked meeting description update failed"),
                )

            verify_popup_response = await session.get(popup_endpoint, params=popup_params)
            verify_popup_result = translator.parse_booked_meeting_popup_response(verify_popup_response.text)
            verified_description = str(
                verify_popup_result.get("form_data", {}).get("taskdescription") or ""
            )
            if verified_description != updated_description:
                raise HTTPException(
                    status_code=409,
                    detail="Booked meeting description save did not stick.",
                )

        return BookedMeetingDescriptionUpdateResponse(
            success=True,
            event_id=payload.event_id,
            original_description=original_description,
            updated_description=updated_description,
            message="Booked meeting description updated",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "BOOKED_MEETING_DESCRIPTION_UPDATE %s",
            {
                "event": "BOOKED_MEETING_DESCRIPTION_UPDATE",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "eventId": payload.event_id,
                    "eventDate": payload.event_date,
                    "descriptionLength": len(payload.description or ""),
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


@router.get("/booked-meetings", response_model=HeadScoutBookedMeetingsResponse)
async def get_head_scout_booked_meetings(
    request: Request,
    start: str,
    end: str,
):
    """
    Fetch booked calendar meetings for configured head scouts in a strict Monday-Sunday week window.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "HEAD_SCOUT_BOOKED_MEETINGS_FETCH %s",
        {
            "event": "HEAD_SCOUT_BOOKED_MEETINGS_FETCH",
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
        result = translator.parse_head_scout_booked_meetings_response(
            raw_response=response.text,
            week_start=start,
            week_end=end,
        )
        logger.info(
            "HEAD_SCOUT_BOOKED_MEETINGS_FETCH %s",
            {
                "event": "HEAD_SCOUT_BOOKED_MEETINGS_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "start": start,
                    "end": end,
                    "count": result.get("count", 0),
                },
            },
        )
        return HeadScoutBookedMeetingsResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "HEAD_SCOUT_BOOKED_MEETINGS_FETCH %s",
            {
                "event": "HEAD_SCOUT_BOOKED_MEETINGS_FETCH",
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


@router.get("/athlete-booked-meetings", response_model=AthleteBookedMeetingsResponse)
async def get_athlete_booked_meetings(
    request: Request,
    athlete_id: str,
    athlete_main_id: str,
):
    """
    Fetch booked meetings from athlete admin event section.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "ATHLETE_BOOKED_MEETINGS_FETCH %s",
        {
            "event": "ATHLETE_BOOKED_MEETINGS_FETCH",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "athleteId": athlete_id,
                "athleteMainId": athlete_main_id,
            },
        },
    )

    try:
        endpoint, params = translator.athlete_events_to_legacy(
            athlete_id=athlete_id,
            athlete_main_id=athlete_main_id,
        )
        response = await session.get(endpoint, params=params)
        result = translator.parse_athlete_events_response(response.text)
        logger.info(
            "ATHLETE_BOOKED_MEETINGS_FETCH %s",
            {
                "event": "ATHLETE_BOOKED_MEETINGS_FETCH",
                "step": "parse",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "athleteId": athlete_id,
                    "athleteMainId": athlete_main_id,
                    "count": result.get("count", 0),
                },
            },
        )
        return AthleteBookedMeetingsResponse(
            success=True,
            athlete_id=athlete_id,
            athlete_main_id=athlete_main_id,
            count=result.get("count", 0),
            events=result.get("events", []),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "ATHLETE_BOOKED_MEETINGS_FETCH %s",
            {
                "event": "ATHLETE_BOOKED_MEETINGS_FETCH",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "athleteId": athlete_id,
                    "athleteMainId": athlete_main_id,
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


@router.get("/booked-meeting/details", response_model=BookedMeetingDetailsResponse)
async def get_booked_meeting_details(
    request: Request,
    event_id: str,
    event_date: str,
):
    """
    Fetch booked Meeting Set popup title and description by exact event id.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "BOOKED_MEETING_DETAILS %s",
        {
            "event": "BOOKED_MEETING_DETAILS",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "eventId": event_id,
                "eventDate": event_date,
            },
        },
    )

    try:
        popup_endpoint, popup_params = translator.booked_meeting_popup_to_legacy(
            event_id=event_id,
            event_date=event_date,
        )
        popup_response = await session.get(popup_endpoint, params=popup_params)
        popup_result = translator.parse_booked_meeting_popup_response(popup_response.text)
        form_data = popup_result.get("form_data", {})
        title = str(form_data.get("tasktitle") or "").strip()
        description = str(form_data.get("taskdescription") or "")

        if not title:
            raise HTTPException(status_code=400, detail="Booked meeting title not found in popup form")

        return BookedMeetingDetailsResponse(
            success=True,
            event_id=event_id,
            title=title,
            description=description,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "BOOKED_MEETING_DETAILS %s",
            {
                "event": "BOOKED_MEETING_DETAILS",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "eventId": event_id,
                    "eventDate": event_date,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/booked-meeting/title", response_model=BookedMeetingTitleUpdateResponse)
async def update_booked_meeting_title(
    request: Request,
    payload: BookedMeetingTitleUpdateRequest,
):
    """
    Update a booked Meeting Set title prefix by exact event id.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(
        "BOOKED_MEETING_TITLE_UPDATE %s",
        {
            "event": "BOOKED_MEETING_TITLE_UPDATE",
            "step": "request",
            "status": "start",
            "feature": FEATURE,
            "context": {
                "eventId": payload.event_id,
                "eventDate": payload.event_date,
                "prefix": payload.prefix,
            },
        },
    )

    try:
        popup_endpoint, popup_params = translator.booked_meeting_popup_to_legacy(
            event_id=payload.event_id,
            event_date=payload.event_date,
        )
        popup_response = await session.get(popup_endpoint, params=popup_params)
        popup_result = translator.parse_booked_meeting_popup_response(popup_response.text)
        form_data = popup_result.get("form_data", {})

        original_title = str(form_data.get("tasktitle") or "").strip()
        if not original_title:
            raise HTTPException(status_code=400, detail="Booked meeting title not found in popup form")

        updated_title = translator.apply_booked_meeting_title_prefix(original_title, payload.prefix)
        logger.info(
            "BOOKED_MEETING_TITLE_UPDATE %s",
            {
                "event": "BOOKED_MEETING_TITLE_UPDATE",
                "step": "prepare",
                "status": "success",
                "feature": FEATURE,
                "context": {
                    "eventId": payload.event_id,
                    "prefix": payload.prefix,
                    "beforeTitle": original_title,
                    "afterTitle": updated_title,
                },
            },
        )

        if updated_title != original_title:
            updated_form_data = translator.apply_booked_meeting_title_update(
                form_data=form_data,
                event_id=payload.event_id,
                title=updated_title,
            )
            endpoint, final_form_data = translator.booked_meeting_title_update_to_legacy(updated_form_data)
            update_response = await session.post(endpoint, data=final_form_data)
            update_result = translator.parse_task_update_response(update_response.text)
            if not update_result.get("success"):
                raise HTTPException(
                    status_code=400,
                    detail=update_result.get("message", "Booked meeting title update failed"),
                )

            verify_popup_response = await session.get(popup_endpoint, params=popup_params)
            verify_popup_result = translator.parse_booked_meeting_popup_response(verify_popup_response.text)
            verified_title = str(verify_popup_result.get("form_data", {}).get("tasktitle") or "").strip()
            if verified_title != updated_title:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f'Booked meeting title save did not stick. '
                        f'Expected "{updated_title}" but found "{verified_title or original_title}".'
                    ),
                )

        return BookedMeetingTitleUpdateResponse(
            success=True,
            event_id=payload.event_id,
            prefix=payload.prefix,
            original_title=original_title,
            updated_title=updated_title,
            message="Booked meeting title updated",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "BOOKED_MEETING_TITLE_UPDATE %s",
            {
                "event": "BOOKED_MEETING_TITLE_UPDATE",
                "step": "request",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {
                    "eventId": payload.event_id,
                    "eventDate": payload.event_date,
                    "prefix": payload.prefix,
                },
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
