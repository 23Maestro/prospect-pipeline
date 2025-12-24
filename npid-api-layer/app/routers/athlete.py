"""
Athlete Router
Handles athlete ID resolution and profile lookups.
"""

from fastapi import APIRouter, HTTPException, Request
from typing import Optional
import logging

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
async def resolve_athlete(request: Request, any_id: str, grad_year: Optional[int] = None):
    """
    Resolve all known IDs for an athlete given any single ID.

    Accepts athlete_id, athlete_main_id, or video_msg_id.
    Optional grad_year helps fetch correct profile section with jersey number.
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

    async def hydrate_from_profile(aid: str):
        """Fetch profile page to extract main_id and metadata."""
        nonlocal athlete_id, athlete_main_id, profile_data
        try:
            # Calculate grade level suffix if grad_year provided
            profile_url = f"/athlete/profile/{aid}"
            if grad_year:
                # Use season calculator logic to determine grade level
                from datetime import datetime
                current_year = datetime.now().year
                current_month = datetime.now().month
                school_year_end = current_year + 1 if current_month >= 8 else current_year
                years_until_grad = grad_year - school_year_end
                grade_level = 12 - years_until_grad

                # Map grade to level details hash
                grade_map = {
                    12: "senioro",
                    11: "junioro",
                    10: "sophomoreo",
                    9: "freshmano",
                    8: "8thgradeo",
                    7: "7thgradeo"
                }
                if grade_level in grade_map:
                    profile_url += f"#leveldetails{grade_map[grade_level]}"
                    logger.info(f"📍 Using profile URL with grade level: {profile_url}")

            profile_response = await session.get(profile_url)
            logger.info(f"📥 Profile response: status={profile_response.status_code}, length={len(profile_response.text)}, has_athlete={('athlete' in profile_response.text.lower())}")
            if profile_response.status_code == 200 and "athlete" in profile_response.text.lower():
                athlete_id = aid
                athlete_main_id = translator.extract_athlete_main_id(profile_response.text) or athlete_main_id
                logger.info(f"📝 Extracted athlete_main_id: {athlete_main_id}")
                # Only hydrate profile data if we don't already have it
                if not profile_data:
                    profile_data = translator.parse_athlete_profile_data(profile_response.text)
                    logger.info(f"📊 Profile data parsed: {profile_data}")
                else:
                    logger.info("⏭️  Skipping profile parse (already have data)")
            else:
                logger.warning(f"⚠️  Profile page validation failed")
        except Exception as e:
            logger.error(f"❌ Profile fetch failed for {aid}: {e}", exc_info=True)
    
    # Try to load athlete profile page with the ID
    # First assume it's an athlete_id
    await hydrate_from_profile(any_id)
    
    # If we still don't have both IDs, try the CRM/search
    if not athlete_id or not athlete_main_id:
        # Try video progress page search
        try:
            search_response = await session.get(
                "/videoteammsg/videomailprogress",
                params={"search": any_id}
            )

            # Extract from search results
            ids = translator.parse_video_progress_ids(search_response.text)
            if ids:
                athlete_id = ids.get("athlete_id") or athlete_id
                athlete_main_id = ids.get("athlete_main_id") or athlete_main_id
                profile_data.update(ids.get("profile", {}))
                
        except Exception as e:
            logger.debug(f"Progress page search failed: {e}")

    # If progress page gave us athlete_id but no main_id, fetch profile to extract it
    if athlete_id and not athlete_main_id:
        await hydrate_from_profile(athlete_id)
    
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
        sport=profile_data.get("sport"),
        jersey_number=profile_data.get("jersey_number")
    )

    # Cache the result
    athlete_cache.set(any_id, result)
    if athlete_id != any_id:
        athlete_cache.set(athlete_id, result)
    if athlete_main_id and athlete_main_id != any_id:
        athlete_cache.set(athlete_main_id, result)
    
    return result


@router.get("/athletetaskid/{task_id}/resolve")
async def resolve_from_task_id(request: Request, task_id: str):
    """
    Resolve athlete_id from a video task ID (video_msg_id).
    
    Uses standard Video Progress search (POST) to find the task.
    This reuses the robust parser from the main video/progress endpoint.
    """
    session = get_session(request)
    translator = LegacyTranslator()
    
    logger.info(f"🔍 Resolving athlete from task ID: {task_id} via POST search")
    
    # 1. Construct standard video progress filter request
    # We filter by 'search_all_fields' which is the text search box on the page
    # This matches ID, name, email, etc.
    filters = {"search_all_fields": task_id}
    endpoint, form_data = translator.video_progress_to_legacy(filters)
    
    try:
        # 2. Execute POST request (just like the main list)
        response = await session.post(endpoint, data=form_data)
        
        # 3. Parse using standard parser
        result = translator.parse_video_progress_response(response.text)
        
        if result["success"]:
            tasks = result.get("tasks", [])
            logger.info(f"   Search returned {len(tasks)} tasks")
            
            # 4. Find the specific task (string comparison just in case)
            for task in tasks:
                if str(task.get("id")) == str(task_id):
                    athlete_id = str(task.get("athlete_id"))
                    # Try to get athlete_main_id if available (custom parser might not extract it here yet)
                    # But verifying athlete_id is the big win.
                    logger.info(f"✅ FOUND MATCH: Task {task_id} belongs to athlete {athlete_id}")
                    return {
                         "task_id": task_id,
                         "athlete_id": athlete_id,
                         "athlete_main_id": None, # Parser might not give this, but Step 3 will resolve it
                         "name": task.get("athletename"),
                         "sport": task.get("sport_name"),
                         "found": True
                    }
                    
            # If we got tasks but none matched exact ID (unlikely with search, but possible partial match)
            if tasks:
                # If exact ID match failed, but we only have 1 result and it's super confident... 
                # actually, let's Stick to strict ID matching for safety.
                logger.warning(f"⚠️ Search returned tasks but none matched ID {task_id}")
                
    except Exception as e:
        logger.error(f"Task search failed: {e}")
        
    raise HTTPException(status_code=404, detail=f"No athlete found for task ID {task_id}")


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
        profile_data = translator.parse_athlete_profile_data(html)

        return AthleteIdentifiers(
            athlete_id=athlete_id,
            athlete_main_id=athlete_main_id or "",
            name=profile_data.get("name", ""),
            grad_year=profile_data.get("grad_year"),
            high_school=profile_data.get("high_school"),
            city=profile_data.get("city"),
            state=profile_data.get("state"),
            positions=profile_data.get("positions"),
            sport=profile_data.get("sport"),
            jersey_number=profile_data.get("jersey_number")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching athlete details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{athlete_id}/name")
async def get_athlete_name(request: Request, athlete_id: str):
    """
    Fetch athlete name for a contact/athlete id.
    Mirrors: GET /template/videotemplate/athletename?id=...
    """
    session = get_session(request)

    try:
        response = await session.get(
            "/template/videotemplate/athletename",
            params={"id": athlete_id},
        )
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail="Failed to fetch athlete name")

        return {
            "athlete_id": athlete_id,
            "name": (response.text or "").strip(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching athlete name: {e}")
        raise HTTPException(status_code=500, detail=str(e))
