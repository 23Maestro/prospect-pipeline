"""
Pydantic models for NPID API Layer
Clean, typed interfaces your Raycast extension talks to.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Literal
from enum import Enum


class VideoType(str, Enum):
    FULL_SEASON = "Full Season Highlight"
    PARTIAL_SEASON = "Partial Season Highlight"
    SINGLE_GAME = "Single Game Highlight"
    SKILLS = "Skills/Training Video"


class VideoSource(str, Enum):
    YOUTUBE = "youtube"
    HUDL = "hudl"


class VideoStage(str, Enum):
    """
    Video stage values - accepts snake_case from TypeScript.
    Translator converts to Title Case for Laravel.
    """
    ON_HOLD = "on_hold"
    AWAITING_CLIENT = "awaiting_client"
    IN_QUEUE = "in_queue"
    DONE = "done"


# ============== Request Models ==============

class VideoSubmitRequest(BaseModel):
    """Clean request model for video submission."""
    athlete_id: str = Field(..., description="Player ID from URL")
    athlete_main_id: str = Field(..., description="Main ID for athlete")
    video_url: str = Field(..., description="YouTube or Hudl URL")
    video_type: VideoType = Field(..., description="Type of highlight video")
    season: str = Field(..., description="Season identifier (e.g., 'highschool:16137')")
    source: VideoSource = Field(default=VideoSource.YOUTUBE)
    auto_approve: bool = Field(default=True, description="Auto-check approval box")
    sport: str = Field(default="football")
    
    @field_validator('video_url')
    @classmethod
    def validate_video_url(cls, v):
        if 'youtu' not in v.lower() and 'hudl' not in v.lower():
            raise ValueError('URL must be YouTube or Hudl')
        return v


class StageUpdateRequest(BaseModel):
    """Request to update video stage/status."""
    video_msg_id: str = Field(..., description="Video message ID from progress page")
    stage: VideoStage = Field(..., description="New stage value")


class AthleteResolveRequest(BaseModel):
    """Request to resolve all IDs for an athlete."""
    athlete_id: Optional[str] = None
    athlete_main_id: Optional[str] = None
    video_msg_id: Optional[str] = None
    
    @field_validator('athlete_id', 'athlete_main_id', 'video_msg_id', mode='before')
    @classmethod
    def at_least_one_id(cls, v, info):
        return v


# ============== Response Models ==============

class Season(BaseModel):
    """Season/team option."""
    value: str
    label: str
    season_type: str = Field(..., alias="season")
    school_added: str


class SeasonsResponse(BaseModel):
    """Response with available seasons."""
    status: Literal["ok", "error"]
    seasons: List[Season]
    athlete_id: str
    athlete_main_id: str


class AthleteIdentifiers(BaseModel):
    """All known IDs for an athlete."""
    athlete_id: str
    athlete_main_id: str
    video_msg_id: Optional[str] = None
    contact_id: Optional[str] = None
    name: str
    grad_year: Optional[str] = None
    high_school: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    positions: Optional[str] = None
    sport: Optional[str] = None


class VideoSubmitResponse(BaseModel):
    """Response from video submission."""
    success: bool
    message: str
    athlete_id: str
    video_url: str
    season: str
    video_type: str


class StageUpdateResponse(BaseModel):
    """Response from stage update."""
    success: bool
    video_msg_id: str
    stage: str
    message: Optional[str] = None


class StatusUpdateRequest(BaseModel):
    """Request to update video status."""
    video_msg_id: str = Field(..., description="Video message ID from progress page")
    status: str = Field(..., description="New status (Revisions, HUDL, Dropbox, etc.)")
    # NO api_key - session.post() auto-injects _token


class StatusUpdateResponse(BaseModel):
    """Response from status update."""
    success: bool
    video_msg_id: str
    status: str
    message: Optional[str] = None


class DueDateUpdateRequest(BaseModel):
    """Request to update video due date."""
    video_msg_id: str = Field(..., description="Video message ID from progress page")
    due_date: str = Field(..., description="Due date in MM/DD/YYYY format")


class DueDateUpdateResponse(BaseModel):
    """Response from due date update."""
    success: bool
    video_msg_id: str
    due_date: str
    message: Optional[str] = None


class VideoProgressFilters(BaseModel):
    """Filters for video progress search."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    sport: Optional[str] = None
    grad_year: Optional[str] = None
    video_editor: Optional[str] = None
    video_progress_stage: Optional[str] = None
    video_progress_status: Optional[str] = None
    # NO club fields: select_club_sport, select_club_state, select_club_name


class VideoProgressResponse(BaseModel):
    """Response from video progress query."""
    success: bool
    count: int
    tasks: List[dict]  # Includes: positions, video_due_date


class Assignment(BaseModel):
    """Video assignment from progress page."""
    video_msg_id: str
    athlete_id: str
    athlete_main_id: Optional[str] = None
    name: str
    grad_year: Optional[str] = None
    high_school: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    positions: Optional[str] = None
    sport: str
    stage: str
    status: Optional[str] = None
    due_date: Optional[str] = None
    assigned_editor: Optional[str] = None
    video_url: Optional[str] = None


class AssignmentsResponse(BaseModel):
    """List of assignments."""
    status: Literal["ok", "error"]
    count: int
    assignments: List[Assignment]


class APIError(BaseModel):
    """Standardized error response."""
    success: bool = False
    error: str
    detail: Optional[str] = None
    legacy_response: Optional[str] = None


# ============== Email Models ==============

class EmailTemplate(BaseModel):
    """Email template dropdown option."""
    label: str
    value: str


class EmailTemplateDataRequest(BaseModel):
    """Request template data (subject, message)."""
    template_id: str
    athlete_id: str


class EmailTemplateDataResponse(BaseModel):
    """Template data from Laravel."""
    sender_name: str
    sender_email: str
    subject: str
    message: str


class SendEmailRequest(BaseModel):
    """Send email to athlete."""
    athlete_id: str
    template_id: str
    notification_from: str
    notification_from_email: str
    notification_subject: str
    notification_message: str


class SendEmailResponse(BaseModel):
    """Email send result."""
    success: bool
    message: str


class AthleteNote(BaseModel):
    """Normalized athlete note entry."""
    title: str
    description: str
    metadata: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None


class NotesListRequest(BaseModel):
    """Request to fetch athlete notes."""
    athlete_id: str
    athlete_main_id: str


class NotesListResponse(BaseModel):
    """List of notes for an athlete."""
    success: bool
    notes: List[AthleteNote]


class AddNoteRequest(BaseModel):
    """Request to add a note to an athlete."""
    athlete_id: str
    athlete_main_id: str
    title: str
    description: str


class AddNoteResponse(BaseModel):
    """Response after adding note."""
    success: bool
    message: str
