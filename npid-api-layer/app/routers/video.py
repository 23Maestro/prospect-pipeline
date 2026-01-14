"""
Video Router
Handles video submission and stage updates.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
import httpx
import re

from app.models.schemas import (
    VideoSubmitRequest,
    VideoSubmitResponse,
    StageUpdateRequest,
    StageUpdateResponse,
    StatusUpdateRequest,
    StatusUpdateResponse,
    DueDateUpdateRequest,
    DueDateUpdateResponse,
    VideoProgressFilters,
    VideoProgressResponse,
    VideoAttachmentsResponse,
    SeasonsResponse,
    Season,
    APIError,
    VideoUpdateRequest
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession
from pydantic import BaseModel
from fastapi import Query

logger = logging.getLogger(__name__)
router = APIRouter(tags=["video"])


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


class SeasonsProxyRequest(BaseModel):
    athlete_id: str
    athlete_main_id: str
    video_type: str
    sport_alias: str


class RemoveVideoRequest(BaseModel):
    athlete_id: str
    athlete_main_id: str
    video_id: str


@router.post("/seasons")
async def proxy_seasons(request: Request, payload: SeasonsProxyRequest):
    """
    Fetch seasons for an athlete and video type.
    Uses translator pattern - NO inline form construction or HTML parsing.

    Mirrors: src/python/npid_api_client.py:911-960
    """
    session = get_session(request)
    translator = LegacyTranslator()

    endpoint, form_data = translator.seasons_request_to_legacy(
        payload.athlete_id,
        payload.sport_alias,
        payload.video_type,
        payload.athlete_main_id
    )

    logger.info(f"📤 Fetching seasons for athlete {payload.athlete_id}")

    try:
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_seasons_response(response.text)

        if result["success"]:
            logger.info(f"✅ Found {len(result['seasons'])} seasons")
            return {"success": True, "seasons": result["seasons"]}
        else:
            logger.warning(f"⚠️ No seasons found")
            return {"success": True, "seasons": []}

    except Exception as exc:
        logger.error(f"❌ Seasons fetch error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/submit", response_model=VideoSubmitResponse)
async def submit_video(request: Request, payload: VideoSubmitRequest):
    """
    Submit a video to an athlete's profile.
    
    This is the clean endpoint your Raycast extension calls.
    Translates to legacy Laravel form post internally.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    
    # Translate clean request to legacy format
    endpoint, form_data = translator.video_submit_to_legacy(payload)
    
    logger.info(f"📤 Submitting video for athlete {payload.athlete_id}")
    logger.debug(f"   Endpoint: {endpoint}")
    logger.debug(f"   Form data: {form_data}")
    
    try:
        # Execute legacy request
        response = await session.post(endpoint, data=form_data)
        raw_text = response.text
        
        # Parse the nested response garbage
        result = translator.parse_video_submit_response(raw_text)
        
        if result["success"]:
            logger.info(f"✅ Video submitted successfully for athlete {payload.athlete_id}")
            return VideoSubmitResponse(
                success=True,
                message=result.get("message", "Video uploaded successfully"),
                athlete_id=payload.athlete_id,
                video_url=payload.video_url,
                season=payload.season,
                video_type=payload.video_type.value
            )
        else:
            logger.warning(f"⚠️ Video submit failed: {result.get('message')}")
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": result.get("message", "Unknown error"),
                    "legacy_response": result.get("raw")
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Video submit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{video_msg_id}/stage", response_model=StageUpdateResponse)
async def update_stage(request: Request, video_msg_id: str, payload: StageUpdateRequest):
    """
    Update video stage (Pending, In Progress, Done, etc.)
    
    Uses the video_msg_id from the video progress page.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    
    # Ensure video_msg_id matches
    if payload.video_msg_id != video_msg_id:
        payload.video_msg_id = video_msg_id
    
    endpoint, form_data = translator.stage_update_to_legacy(payload)

    logger.info(f"📤 Updating stage for video_msg_id {video_msg_id} to {payload.stage.value} (mailbox={payload.is_from_video_mail_box})")
    logger.debug(f"📦 Form data: {form_data}")

    try:
        response = await session.post(endpoint, data=form_data)
        logger.debug(f"📥 Response status: {response.status_code}, content-type: {response.headers.get('content-type')}")
        result = translator.parse_stage_update_response(response.text)
        
        if result["success"]:
            logger.info(f"✅ Stage updated to {payload.stage.value}")
            return StageUpdateResponse(
                success=True,
                video_msg_id=video_msg_id,
                stage=result.get("stage", payload.stage.value),
                message="Stage updated successfully"
            )
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": result.get("error", "Stage update failed"),
                    "legacy_response": result.get("raw")
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Stage update error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/seasons/{athlete_id}", response_model=SeasonsResponse)
async def get_seasons(
    request: Request,
    athlete_id: str,
    athlete_main_id: str,  # REQUIRED - must be extracted from profile page URL
    sport: str = "football",
    video_type: str = "Full Season Highlight"
):
    """
    Get available seasons/teams for an athlete.

    CRITICAL: athlete_main_id is REQUIRED and must be provided by caller.
    - Found ONLY on athlete profile page URL: /athlete/media/{athlete_id}/{athlete_main_id}
    - NOT available from API endpoints
    - NO fallback to athlete_id (causes silent failures)

    Caller must:
    1. Fetch profile page: GET /athlete/profile/{athlete_id}
    2. Extract media tab link: /athlete/media/{athlete_id}/{athlete_main_id}
    3. Parse athlete_main_id from URL
    4. Pass to this endpoint

    Reference: src/python/npid_api_client.py:692-714
    """
    session = get_session(request)
    translator = LegacyTranslator()

    if not athlete_main_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "athlete_main_id is required",
                "message": "athlete_main_id must be extracted from athlete profile page URL (/athlete/media/{athlete_id}/{athlete_main_id})",
                "reference": "See npid-api-layer/README.md for athlete_main_id extraction"
            }
        )

    endpoint, form_data = translator.seasons_request_to_legacy(
        athlete_id, sport, video_type, athlete_main_id
    )
    
    logger.info(f"📤 Fetching seasons for athlete {athlete_id}")
    
    try:
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_seasons_response(response.text)
        
        if result["success"]:
            seasons = [
                Season(
                    value=s["value"],
                    label=s["label"],
                    season=s.get("season", ""),
                    school_added=s.get("school_added", "")
                )
                for s in result["seasons"]
                if s.get("value")  # Skip empty placeholder
            ]
            
            return SeasonsResponse(
                status="ok",
                seasons=seasons,
                athlete_id=athlete_id,
                athlete_main_id=athlete_main_id
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "Failed to fetch seasons")
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Seasons fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{video_msg_id}/status", response_model=StatusUpdateResponse)
async def update_status(
    request: Request,
    video_msg_id: str,
    payload: StatusUpdateRequest
):
    """
    Update video status (Revisions, HUDL, Dropbox, Not Approved, External Links).
    Curl verified 2025-12-05. NO api_key.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    # Ensure video_msg_id matches
    if payload.video_msg_id != video_msg_id:
        payload.video_msg_id = video_msg_id

    endpoint, form_data = translator.status_update_to_legacy(
        video_msg_id, payload.status, is_from_mailbox=payload.is_from_video_mail_box or False
    )

    logger.info(f"📤 Updating status for video_msg_id {video_msg_id} to {payload.status} (mailbox={payload.is_from_video_mail_box})")
    logger.debug(f"📦 Form data: {form_data}")

    try:
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_status_update_response(response.text)

        if result["success"]:
            logger.info(f"✅ Status updated to {payload.status}")
            return StatusUpdateResponse(
                success=True,
                video_msg_id=video_msg_id,
                status=payload.status,
                message="Status updated successfully"
            )
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": result.get("error", "Status update failed"),
                    "legacy_response": result.get("raw")
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Status update error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{video_msg_id}/duedate", response_model=DueDateUpdateResponse)
async def update_due_date(
    request: Request,
    video_msg_id: str,
    payload: DueDateUpdateRequest
):
    """
    Update video due date.
    Curl verified 2025-12-05. Date format: MM/DD/YYYY. NO api_key.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    # Ensure video_msg_id matches
    if payload.video_msg_id != video_msg_id:
        payload.video_msg_id = video_msg_id

    endpoint, form_data = translator.due_date_update_to_legacy(
        video_msg_id, payload.due_date
    )

    logger.info(f"📤 Updating due date for video_msg_id {video_msg_id} to {payload.due_date}")

    try:
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_due_date_update_response(response.text)

        if result["success"]:
            logger.info(f"✅ Due date updated to {payload.due_date}")
            return DueDateUpdateResponse(
                success=True,
                video_msg_id=video_msg_id,
                due_date=payload.due_date,
                message="Due date updated successfully"
            )
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": result.get("error", "Due date update failed"),
                    "legacy_response": result.get("raw")
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Due date update error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/progress")
async def get_video_progress(
    request: Request,
    filters: VideoProgressFilters
):
    """
    Fetch video progress data with optional filters.
    Returns list of video tasks with athlete info, status, stage, due dates.
    Curl verified 2025-12-05. NO club fields.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    # Convert filters to dict, removing None values
    filter_dict = {k: v for k, v in filters.dict().items() if v is not None}

    endpoint, form_data = translator.video_progress_to_legacy(filter_dict)

    logger.info(f"📤 Fetching video progress (filters: {filter_dict})")

    try:
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_video_progress_response(response.text)

        if result["success"]:
            tasks = result["tasks"]
            logger.info(f"✅ Found {len(tasks)} video progress tasks")
            return VideoProgressResponse(
                success=True,
                count=len(tasks),
                tasks=tasks
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "Failed to fetch video progress")
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Video progress fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/attachments", response_model=VideoAttachmentsResponse)
async def get_video_attachments(request: Request):
    """
    Fetch all video mail attachments from athletes.
    Returns list of downloadable video files with metadata.
    Mirrors: src/python/npid_api_client.py:1088-1129
    """
    session = get_session(request)
    translator = LegacyTranslator()

    endpoint, form_data = translator.video_attachments_to_legacy()

    logger.info("📤 Fetching video mail attachments")

    try:
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_video_attachments_response(response.text)

        if result["success"]:
            attachments = result["attachments"]
            logger.info(f"✅ Found {len(attachments)} video attachments")
            return VideoAttachmentsResponse(
                status="ok",
                count=len(attachments),
                attachments=attachments
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "Failed to fetch video attachments")
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Video attachments fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sortable")
async def get_video_sortable(
    request: Request,
    athlete_id: str = Query(..., alias="athlete_id"),
    athlete_main_id: str = Query(..., alias="athlete_main_id"),
    sport_alias: str = Query(..., alias="sport_alias")
):
    """
    Fetch sortable videos HTML for an athlete.
    Mirrors: GET /template/template/videosortable?athleteid=...&sport_alias=...&athlete_main_id=...
    """
    session = get_session(request)
    try:
        response = await session.get(
            "/template/template/videosortable",
            params={
                "athleteid": athlete_id,
                "sport_alias": sport_alias,
                "athlete_main_id": athlete_main_id
            }
        )
        logger.info(f"📤 Fetched videosortable for athlete {athlete_id} (len={len(response.text)})")
        return {"success": True, "html": response.text}
    except Exception as e:
        logger.error(f"❌ Failed to fetch videosortable: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remove")
async def remove_video(request: Request, payload: RemoveVideoRequest):
    """
    Remove a video by video_id for an athlete.
    POST /athlete/update/remove_video/{athlete_id}
    """
    session = get_session(request)
    translator = LegacyTranslator()

    endpoint, form_data = translator.remove_video_to_legacy(
        payload.athlete_id,
        payload.athlete_main_id,
        payload.video_id
    )

    logger.info(
        "🗑️ Removing video %s for athlete %s (accept=%s)",
        payload.video_id,
        payload.athlete_id,
        session.client.headers.get("Accept")
    )

    try:
        response = await session.post(endpoint, data=form_data)
        logger.info(
            "📥 Remove video response (status=%s content_type=%s location=%s length=%s)",
            response.status_code,
            response.headers.get("content-type"),
            response.headers.get("location"),
            len(response.text or "")
        )
        if response.status_code == 200:
            return {"success": True}
        logger.warning("⚠️ Remove video body preview: %s", (response.text or "")[:500])
        raise HTTPException(status_code=response.status_code, detail="Failed to remove video")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Remove video error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/edit")
async def get_video_edit(
    request: Request,
    athlete_id: str = Query(..., alias="athlete_id"),
    athlete_main_id: str = Query(..., alias="athlete_main_id"),
    video_id: str = Query(..., alias="video_id"),
    is_from_video_mail_box: str = Query("", alias="is_from_video_mail_box"),
):
    """
    Fetch edit video HTML for a specific video.
    Mirrors: GET /template/template/videoedit?is_from_video_mail_box=&id=...&r=0&e=...&athlete_main_id=...
    """
    session = get_session(request)
    params = {
        "is_from_video_mail_box": is_from_video_mail_box,
        "id": athlete_id,
        "r": "0",
        "e": video_id,
        "athlete_main_id": athlete_main_id,
    }

    logger.info(
        "📝 Fetching videoedit (athlete_id=%s video_id=%s main_id=%s accept=%s)",
        athlete_id,
        video_id,
        athlete_main_id,
        session.client.headers.get("Accept")
    )
    try:
        response = await session.get("/template/template/videoedit", params=params)
        if response.status_code != 200:
            logger.warning(
                "⚠️ videoedit response (status=%s content_type=%s location=%s length=%s)",
                response.status_code,
                response.headers.get("content-type"),
                response.headers.get("location"),
                len(response.text or "")
            )
            logger.warning("⚠️ videoedit body preview: %s", (response.text or "")[:500])
            raise HTTPException(status_code=response.status_code, detail="Failed to fetch video edit form")
        logger.info(f"📤 Fetched videoedit for athlete {athlete_id}, video {video_id} (len={len(response.text)})")
        return {"success": True, "html": response.text}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to fetch videoedit: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update")
async def update_video(request: Request, payload: VideoUpdateRequest):
    """
    Update an existing video via updatecareervideos.
    POST /athlete/update/updatecareervideos/{athlete_id}
    """
    session = get_session(request)
    endpoint = f"/athlete/update/updatecareervideos/{payload.athlete_id}"
    logger.info(
        "📝 Updating video for athlete %s (accept=%s form_keys=%s)",
        payload.athlete_id,
        session.client.headers.get("Accept"),
        sorted(payload.form_data.keys())
    )

    try:
        response = await session.post(
            endpoint,
            data=payload.form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
        )
        logger.info(
            "📥 Update video response (status=%s content_type=%s location=%s length=%s)",
            response.status_code,
            response.headers.get("content-type"),
            response.headers.get("location"),
            len(response.text or "")
        )
        if response.headers.get("content-type", "").lower().startswith("text/html"):
            logger.info("🧾 Update video HTML preview: %s", (response.text or "")[:500])
        if response.status_code in [200, 302]:
            return {"success": True}
        logger.warning("⚠️ Update video body preview: %s", (response.text or "")[:500])
        raise HTTPException(status_code=response.status_code, detail="Failed to update video")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Update video error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
