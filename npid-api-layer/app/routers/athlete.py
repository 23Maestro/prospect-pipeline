"""
Athlete Router
Handles athlete ID resolution and profile lookups.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
import re

from app.models.schemas import AthleteIdentifiers
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession
from app.cache import athlete_cache

logger = logging.getLogger(__name__)
router = APIRouter(tags=["athlete"])


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/{any_id}/resolve", response_model=AthleteIdentifiers)
async def resolve_athlete(request: Request, any_id: str):
    """
    Resolve all known IDs for an athlete given any single ID.
    
    Accepts athlete_id, athlete_main_id, or video_msg_id.
    Returns the full set of identifiers plus basic profile info.
    
    Results are cached to avoid repeated lookups.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    
    # Check cache first
    cached = athlete_cache.get(any_id)
    if cached:
        logger.info(f"📦 Cache hit for {any_id}")
        return cached
    
    logger.info(f"🔍 Resolving athlete IDs for {any_id}")
    
    athlete_id = None
    athlete_main_id = None
    profile_data = {}
    
    # Try to load athlete profile page with the ID
    # First assume it's an athlete_id
    try:
        profile_response = await session.get(f"/athlete/media/{any_id}")
        
        if profile_response.status_code == 200 and "athlete" in profile_response.text.lower():
            athlete_id = any_id
            athlete_main_id = translator.extract_athlete_main_id(profile_response.text)
            profile_data = _extract_profile_data(profile_response.text)
    except Exception as e:
        logger.debug(f"Profile fetch failed for {any_id}: {e}")
    
    # If we still don't have both IDs, try the CRM/search
    if not athlete_id or not athlete_main_id:
        # Try video progress page search
        try:
            search_response = await session.get(
                "/videoteammsg/videomailprogress",
                params={"search": any_id}
            )
            
            # Extract from search results
            ids = _extract_ids_from_progress_page(search_response.text)
            if ids:
                athlete_id = ids.get("athlete_id") or athlete_id
                athlete_main_id = ids.get("athlete_main_id") or athlete_main_id
                profile_data.update(ids.get("profile", {}))
                
        except Exception as e:
            logger.debug(f"Progress page search failed: {e}")
    
    if not athlete_id:
        raise HTTPException(
            status_code=404,
            detail=f"Could not resolve athlete with ID: {any_id}"
        )
    
    result = AthleteIdentifiers(
        athlete_id=athlete_id,
        athlete_main_id=athlete_main_id or "",
        name=profile_data.get("name", ""),
        grad_year=profile_data.get("grad_year"),
        high_school=profile_data.get("high_school"),
        city=profile_data.get("city"),
        state=profile_data.get("state"),
        positions=profile_data.get("positions"),
        sport=profile_data.get("sport")
    )

    # Cache the result
    athlete_cache.set(any_id, result)
    if athlete_id != any_id:
        athlete_cache.set(athlete_id, result)
    if athlete_main_id and athlete_main_id != any_id:
        athlete_cache.set(athlete_main_id, result)
    
    return result


@router.get("/{athlete_id}/details", response_model=AthleteIdentifiers)
async def get_athlete_details(request: Request, athlete_id: str):
    """
    Get detailed athlete information.
    
    Fetches from athlete profile page and extracts all available metadata.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    
    logger.info(f"📄 Fetching details for athlete {athlete_id}")
    
    try:
        # Get the athlete media page
        response = await session.get(f"/athlete/media/{athlete_id}")
        
        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Athlete not found")
        
        html = response.text
        athlete_main_id = translator.extract_athlete_main_id(html)
        profile_data = _extract_profile_data(html)
        
        return AthleteIdentifiers(
            athlete_id=athlete_id,
            athlete_main_id=athlete_main_id or "",
            name=profile_data.get("name", ""),
            grad_year=profile_data.get("grad_year"),
            high_school=profile_data.get("high_school"),
            city=profile_data.get("city"),
            state=profile_data.get("state"),
            positions=profile_data.get("positions"),
            sport=profile_data.get("sport")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching athlete details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _extract_profile_data(html: str) -> dict:
    """Extract athlete profile data from HTML page."""
    data = {}
    
    # Name - disabled
    # Grad year - disabled
    # High school - disabled
    # City/state - disabled
    # Sport - disabled
    
    return data


def _extract_ids_from_progress_page(html: str) -> dict:
    """Deprecated: HTML scraping removed."""
    return {}
