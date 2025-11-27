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
    SeasonsResponse,
    Season,
    APIError
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession
from pydantic import BaseModel

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


@router.api_route("/seasons", methods=["GET", "POST"])
async def proxy_seasons(request: Request, payload: SeasonsProxyRequest):
    """
    Proxy seasons request directly to Laravel's scout-api endpoint.
    Returns parsed HTML <option> elements as JSON.

    Mirrors: src/python/npid_api_client.py:911-960
    """
    session = get_session(request)
    client = session.client
    if client is None:
        await session.initialize()
        client = session.client

    try:
        # Ensure we have CSRF/api key loaded from session
        if not session.csrf_token:
            await session.refresh_csrf()

        # CRITICAL: Use snake_case parameter names matching live endpoints
        # CRITICAL: Use form-encoded data (NOT JSON)
        form_data = {
            "_token": session.csrf_token,
            "return_type": "html",  # Endpoint returns HTML, not JSON
            "athlete_id": payload.athlete_id,  # NOT athleteId
            "sport_alias": payload.sport_alias,  # NOT sportAlias
            "video_type": payload.video_type,  # NOT videoType
            "athlete_main_id": payload.athlete_main_id  # NOT athleteMainId
        }
        if session.api_key:
            form_data["api_key"] = session.api_key

        response = await client.post(
            "/API/scout-api/video-seasons-by-video-type",
            data=form_data,  # Form-encoded, NOT json=
            headers={
                "Accept": "*/*",  # NOT application/json
                "Content-Type": "application/x-www-form-urlencoded",  # NOT application/json
                "X-Requested-With": "XMLHttpRequest",
            },
        )
        response.raise_for_status()

        # Response is ALWAYS HTML with <option> elements
        # Parse using BeautifulSoup like Python client does
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(response.text, 'html.parser')
        seasons = []

        # Find newVideoSeason select element
        select = soup.find('select', {'id': 'newVideoSeason'})
        if not select:
            # Fallback: try by name attribute
            select = soup.find('select', {'name': 'newVideoSeason'})

        if select:
            for option in select.find_all('option'):
                value = option.get('value', '')
                text = option.text.strip()
                if value and value != '':
                    seasons.append({
                        'value': value,
                        'label': text,
                        'season': option.get('season', ''),
                        'school_added': option.get('school_added', '')
                    })

        if seasons:
            logger.info(f"✅ Parsed {len(seasons)} seasons from HTML response")
            return {"success": True, "seasons": seasons}

        # No seasons found - log for debugging
        snippet = response.text[:200]
        logger.warning(f"⚠️ No seasons found in HTML response: {snippet}")
        return {"success": True, "seasons": []}  # Return empty list, not error

    except httpx.HTTPStatusError as exc:
        logger.error(f"❌ Seasons proxy failed: {exc.response.text}")
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except Exception as exc:
        logger.error(f"❌ Seasons proxy error: {exc}")
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
    
    logger.info(f"📤 Updating stage for video_msg_id {video_msg_id} to {payload.stage.value}")
    
    try:
        response = await session.post(endpoint, data=form_data)
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
                "reference": "See docs/npid-api-layer/README.md for athlete_main_id extraction"
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
