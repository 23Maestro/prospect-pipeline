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
    PENDING = "Pending"
    IN_PROGRESS = "In Progress"
    DONE = "Done"
    ON_HOLD = "On Hold"


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
