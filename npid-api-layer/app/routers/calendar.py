"""
Calendar Router
FastAPI endpoints for head scout schedule availability.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import HeadScoutSlotsResponse
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
