"""
Athlete Router
Handles athlete ID resolution and profile lookups.
"""

from fastapi import APIRouter, HTTPException, Request
from typing import Optional
import logging

from app.models.schemas import (
    AthleteIdentifiers,
    RawAthleteSearchRequest,
    RawAthleteSearchResponse
)
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
            # Fetch full profile page (hash fragments don't work server-side)
            # The HTML contains all grade levels, we'll parse the correct one
            profile_url = f"/athlete/profile/{aid}"
            grade_level = None
            if grad_year:
                # Calculate grade level for parsing context
                from datetime import datetime
                current_year = datetime.now().year
                current_month = datetime.now().month
                school_year_end = current_year + 1 if current_month >= 8 else current_year
                years_until_grad = grad_year - school_year_end
                grade_level = 12 - years_until_grad
                logger.info(f"📍 Calculated grade level: {grade_level} for grad_year {grad_year}")

            profile_response = await session.get(profile_url)
            logger.info(f"📥 Profile response: status={profile_response.status_code}, length={len(profile_response.text)}, has_athlete={('athlete' in profile_response.text.lower())}")
            if profile_response.status_code == 200 and "athlete" in profile_response.text.lower():
                athlete_id = aid
                athlete_main_id = translator.extract_athlete_main_id(profile_response.text) or athlete_main_id
                logger.info(f"📝 Extracted athlete_main_id: {athlete_main_id}")
                # Only hydrate profile data if we don't already have it
                if not profile_data:
                    profile_data = translator.parse_athlete_profile_data(profile_response.text, grade_level=grade_level)
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


def _merge_search_results(
    base_results: list,
    new_results: list
) -> list:
    merged = {}
    for item in base_results + new_results:
        if not isinstance(item, dict):
            continue
        athlete_id = item.get("athlete_id")
        if not athlete_id:
            continue
        existing = merged.get(athlete_id, {})
        for key, value in item.items():
            if existing.get(key) in (None, "", []) and value not in (None, "", []):
                existing[key] = value
        existing_source = existing.get("source")
        new_source = item.get("source")
        if new_source:
            if existing_source:
                if new_source not in str(existing_source):
                    existing["source"] = f"{existing_source}|{new_source}"
            else:
                existing["source"] = new_source
        if not existing:
            existing = item
        merged[athlete_id] = existing
    return list(merged.values())


@router.post("/raw-search", response_model=RawAthleteSearchResponse)
async def raw_search(request: Request, payload: RawAthleteSearchRequest):
    """
    Global athlete search that uses legacy search endpoints.
    Uses /search/searchathlete and /admin/searchathlete.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    term = (payload.term or "").strip()
    results = []
    sources = []

    if not term:
        return RawAthleteSearchResponse(success=True, count=0, results=[], sources=[])

    logger.info(
        "🔎 Raw athlete search term=%s email=%s first_name=%s last_name=%s include_admin_search=%s",
        term,
        payload.email,
        payload.first_name,
        payload.last_name,
        payload.include_admin_search
    )

    try:
        # Primary: global search endpoint
        endpoint, params = translator.search_athlete_to_legacy(term, payload.searching_for)
        search_response = await session.get(endpoint, params=params)
        logger.info(
            "📥 searchathlete status=%s content_type=%s length=%s",
            search_response.status_code,
            search_response.headers.get("content-type"),
            len(search_response.text or "")
        )
        parsed = translator.parse_search_athlete_response(search_response.text or "")
        results = _merge_search_results(results, parsed.get("results", []))
        sources.append({
            "source": "searchathlete",
            "status": search_response.status_code,
            "count": len(parsed.get("results", [])),
            "format": parsed.get("format")
        })

        # Optional: admin search (email/name)
        should_admin_search = payload.include_admin_search or payload.email or payload.first_name or payload.last_name
        if should_admin_search:
            admin_filters = {}
            email_value = payload.email
            if not email_value and "@" in term:
                email_value = term
            if email_value:
                admin_filters["email"] = email_value
            if payload.first_name or payload.last_name:
                admin_filters["first_name"] = payload.first_name or ""
                admin_filters["last_name"] = payload.last_name or ""
            if not admin_filters:
                name_parts = term.split()
                if len(name_parts) >= 2:
                    admin_filters["first_name"] = name_parts[0]
                    admin_filters["last_name"] = " ".join(name_parts[1:])
                else:
                    admin_filters["searchany"] = term

            endpoint, form_data = translator.admin_search_athlete_to_legacy(admin_filters)
            admin_response = await session.post(endpoint, data=form_data)
            logger.info(
                "📥 admin searchathlete status=%s content_type=%s length=%s",
                admin_response.status_code,
                admin_response.headers.get("content-type"),
                len(admin_response.text or "")
            )
            admin_parsed = translator.parse_admin_search_athlete_response(admin_response.text or "")
            results = _merge_search_results(results, admin_parsed.get("results", []))
            sources.append({
                "source": "admin_search",
                "status": admin_response.status_code,
                "count": len(admin_parsed.get("results", [])),
                "format": admin_parsed.get("format")
            })

        # Optional: scout recent search for entries that have both IDs
        if payload.include_recent_search:
            recent_limit = 5
            recent_count = 0
            for item in results:
                athlete_id = item.get("athlete_id")
                athlete_main_id = item.get("athlete_main_id")
                if not athlete_id or not athlete_main_id:
                    continue
                endpoint, params = translator.scout_recent_search_to_legacy(athlete_id, athlete_main_id)
                recent_response = await session.get(endpoint, params=params)
                recent_parsed = translator.parse_scout_recent_search_response(recent_response.text or "")
                sources.append({
                    "source": "scoutrecentsearch",
                    "status": recent_response.status_code,
                    "athlete_id": athlete_id,
                    "count": len(recent_parsed.get("entries", [])),
                    "format": recent_parsed.get("format")
                })
                recent_count += 1
                if recent_count >= recent_limit:
                    break

        return RawAthleteSearchResponse(
            success=True,
            count=len(results),
            results=results,
            sources=sources
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Raw athlete search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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
    
    # Construct standard video progress filter request
    # Jeremiah confirmed: filtering by task ID in the dashboard POST search works.
    filters = {"search_all_fields": task_id}
    endpoint, form_data = translator.video_progress_to_legacy(filters)
    
    try:
        # Execute POST request (just like the main list)
        response = await session.post(endpoint, data=form_data)
        
        # Parse using standard parser
        result = translator.parse_video_progress_response(response.text)
        
        if result["success"]:
            tasks = result.get("tasks", [])
            logger.info(f"   Search returned {len(tasks)} tasks")
            
            # Find the specific task
            for task in tasks:
                if str(task.get("id")) == str(task_id):
                    athlete_id = str(task.get("athlete_id"))
                    logger.info(f"✅ FOUND MATCH: Task {task_id} belongs to athlete {athlete_id}")
                    return {
                         "task_id": task_id,
                         "athlete_id": athlete_id,
                         "athlete_main_id": str(task.get("athlete_main_id")) if task.get("athlete_main_id") else None,
                         "name": task.get("athletename"),
                         "sport": task.get("sport_name"),
                         "found": True
                    }
                    
            if tasks:
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
