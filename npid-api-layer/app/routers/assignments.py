"""
Assignments Router
Fetches and filters video assignments from the progress page.
"""

from fastapi import APIRouter, HTTPException, Request, Query
from typing import Optional, List
import logging
import re

from app.models.schemas import Assignment, AssignmentsResponse, VideoStage
from app.session import NPIDSession

logger = logging.getLogger(__name__)
router = APIRouter(tags=["assignments"])


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("", response_model=AssignmentsResponse)
async def get_assignments(
    request: Request,
    status: Optional[str] = Query(None, description="Filter by stage: Pending, In Progress, Done"),
    editor: Optional[str] = Query(None, description="Filter by assigned editor"),
    sport: Optional[str] = Query(None, description="Filter by sport"),
    limit: int = Query(50, ge=1, le=200, description="Max results to return")
):
    """
    Fetch video assignments from the progress page.
    
    This is your canonical source - the Video Progress page contains
    the merged view of all assignment data.
    """
    session = get_session(request)
    
    logger.info(f"📋 Fetching assignments (status={status}, editor={editor}, sport={sport})")
    
    try:
        # Fetch the video progress page
        response = await session.get("/videoteammsg/videomailprogress")
        
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="Could not fetch progress page")
        
        # Parse assignments from HTML
        assignments = _parse_progress_page(response.text)
        
        # Apply filters
        if status:
            assignments = [a for a in assignments if a.stage.lower() == status.lower()]
        if editor:
            assignments = [a for a in assignments if editor.lower() in (a.assigned_editor or "").lower()]
        if sport:
            assignments = [a for a in assignments if a.sport.lower() == sport.lower()]
        
        # Apply limit
        assignments = assignments[:limit]
        
        logger.info(f"✅ Found {len(assignments)} assignments")
        
        return AssignmentsResponse(
            status="ok",
            count=len(assignments),
            assignments=assignments
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error fetching assignments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pending", response_model=AssignmentsResponse)
async def get_pending_assignments(request: Request, limit: int = Query(50, ge=1, le=200)):
    """Convenience endpoint for pending assignments only."""
    return await get_assignments(request, status="Pending", limit=limit)


@router.get("/in-progress", response_model=AssignmentsResponse)
async def get_in_progress_assignments(request: Request, limit: int = Query(50, ge=1, le=200)):
    """Convenience endpoint for in-progress assignments only."""
    return await get_assignments(request, status="In Progress", limit=limit)


def _parse_progress_page(html: str) -> List[Assignment]:
    """
    Parse assignments from the video progress page HTML.
    
    The progress page is a table with rows containing:
    - Athlete name
    - Athlete ID (in links/data attributes)
    - Video msg ID 
    - Grad year
    - High school
    - City/State
    - Positions
    - Sport
    - Stage
    - Due date
    - Assigned editor
    """
    assignments = []
    
    # Find table rows - adjust pattern based on actual HTML structure
    # This is a best-effort extraction; may need tuning for actual page
    
    row_pattern = r'<tr[^>]*class="[^"]*video-row[^"]*"[^>]*>(.*?)</tr>'
    rows = re.findall(row_pattern, html, re.DOTALL | re.IGNORECASE)
    
    # Fallback: try to find any table rows with video data
    if not rows:
        row_pattern = r'<tr[^>]*data-video[^>]*>(.*?)</tr>'
        rows = re.findall(row_pattern, html, re.DOTALL | re.IGNORECASE)
    
    # Another fallback: look for rows with athlete IDs
    if not rows:
        row_pattern = r'<tr[^>]*>(.*?athlete.*?)</tr>'
        rows = re.findall(row_pattern, html, re.DOTALL | re.IGNORECASE)
    
    for row_html in rows:
        try:
            assignment = _parse_assignment_row(row_html)
            if assignment and assignment.athlete_id:
                assignments.append(assignment)
        except Exception as e:
            logger.debug(f"Failed to parse row: {e}")
            continue
    
    return assignments


def _parse_assignment_row(row_html: str) -> Optional[Assignment]:
    """Parse a single assignment from a table row."""
    
    # Extract video_msg_id
    msg_id_match = re.search(r'video[_-]?msg[_-]?id["\s:=]+["\']?(\d+)', row_html, re.IGNORECASE)
    video_msg_id = msg_id_match.group(1) if msg_id_match else None
    
    if not video_msg_id:
        # Try data attribute
        msg_id_match = re.search(r'data-id["\s=]+["\']?(\d+)', row_html, re.IGNORECASE)
        video_msg_id = msg_id_match.group(1) if msg_id_match else ""
    
    # Extract athlete_id
    athlete_id_match = re.search(r'athlete[_-]?id["\s:=]+["\']?(\d+)', row_html, re.IGNORECASE)
    if not athlete_id_match:
        athlete_id_match = re.search(r'/athlete/(?:media|profile)/(\d+)', row_html)
    athlete_id = athlete_id_match.group(1) if athlete_id_match else ""
    
    # Extract athlete_main_id if present
    main_id_match = re.search(r'athlete[_-]?main[_-]?id["\s:=]+["\']?(\d+)', row_html, re.IGNORECASE)
    athlete_main_id = main_id_match.group(1) if main_id_match else None
    
    # Extract name from first visible text or specific element
    name_match = re.search(r'<td[^>]*>([A-Z][a-z]+\s+[A-Z][a-z]+)', row_html)
    name = name_match.group(1).strip() if name_match else ""
    
    # Extract stage
    stage_match = re.search(r'(?:stage|status)["\s:=]+["\']?(Pending|In Progress|Done|On Hold)', row_html, re.IGNORECASE)
    stage = stage_match.group(1) if stage_match else "Pending"
    
    # Extract sport
    sport_match = re.search(r'sport["\s:=]+["\']?(football|basketball|baseball|soccer|volleyball)', row_html, re.IGNORECASE)
    sport = sport_match.group(1).lower() if sport_match else "football"
    
    # Extract grad year
    grad_match = re.search(r'\b(20\d{2})\b', row_html)
    grad_year = grad_match.group(1) if grad_match else None
    
    # Extract high school
    hs_match = re.search(r'(?:high\s*school|hs)["\s:=]+["\']?([^"\'<]+)', row_html, re.IGNORECASE)
    high_school = hs_match.group(1).strip() if hs_match else None
    
    if not athlete_id:
        return None
    
    return Assignment(
        video_msg_id=video_msg_id or "",
        athlete_id=athlete_id,
        athlete_main_id=athlete_main_id,
        name=name,
        grad_year=grad_year,
        high_school=high_school,
        city=None,
        state=None,
        positions=None,
        sport=sport,
        stage=stage,
        status=None,
        due_date=None,
        assigned_editor=None,
        video_url=None
    )
