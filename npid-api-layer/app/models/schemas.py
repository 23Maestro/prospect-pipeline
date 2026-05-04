"""
Pydantic models for NPID API Layer
Clean, typed interfaces your Raycast extension talks to.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Literal, Dict, Any
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
    season_type: str = Field(default="", description="Season type from HTML attribute (e.g., 'junior', 'sophomore')")
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
    is_from_video_mail_box: Optional[bool] = Field(default=None, description="Mailbox context flag")


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
    jersey_number: Optional[str] = None
    gpa: Optional[str] = None
    head_scout: Optional[str] = None
    scouting_coordinator: Optional[str] = None


class AthleteMeasurables(BaseModel):
    """Height and weight parsed from athlete profile page."""
    athlete_id: str
    height: Optional[str] = None
    weight: Optional[str] = None


class AdminAthleteTableResponse(BaseModel):
    """Structured table response for admin athlete sub-views."""
    headers: List[str]
    rows: List[List[str]]
    count: int
    status_code: int
    html_length: int
    table_found: bool
    endpoint: str
    message: Optional[str] = None


class CommissionLookupRequest(BaseModel):
    """Request for legacy commission period lookup."""
    commperiod: str = Field(..., description="Commission period, e.g. 2026-05-01~2026-05-15")
    scout: Optional[str] = Field(default=None, description="Legacy scout filter; omit for all")


class CommissionEntry(BaseModel):
    """Normalized commission row from legacy commission endpoints."""
    source: str
    athlete_id: Optional[str] = None
    athlete_main_id: Optional[str] = None
    account_id: Optional[str] = None
    athlete_name: Optional[str] = None
    scout: Optional[str] = None
    amount_cents: Optional[int] = None
    amount_label: Optional[str] = None
    plan_price_cents: Optional[int] = None
    plan_price_label: Optional[str] = None
    product: Optional[str] = None
    subscription_name: Optional[str] = None
    status: Optional[str] = None
    paid_at: Optional[str] = None
    parent_bill_date: Optional[str] = None
    row_key: str
    duplicate_key: str
    possible_duplicate: bool = False
    raw: Dict[str, Any] = Field(default_factory=dict)


class CommissionLookupResponse(BaseModel):
    """Normalized response from legacy commission endpoints."""
    success: bool
    commperiod: str
    scout: Optional[str] = None
    source: str
    count: int
    duplicate_count: int
    entries: List[CommissionEntry]
    status_code: int
    content_type: Optional[str] = None
    body_preview: Optional[str] = None


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
    is_from_video_mail_box: Optional[bool] = Field(default=None, description="Mailbox context flag")
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
    email: Optional[str] = None
    sport: Optional[str] = None
    grad_year: Optional[str] = None
    search_all_fields: Optional[str] = None
    select_club_sport: Optional[str] = None
    select_club_state: Optional[str] = None
    select_club_name: Optional[str] = None
    video_editor: Optional[str] = None
    video_progress_stage: Optional[str] = None
    video_progress_status: Optional[str] = None


class VideoUpdateRequest(BaseModel):
    """Request to update an existing video via updatecareervideos."""
    athlete_id: str = Field(..., description="Player ID from URL")
    form_data: Dict[str, str] = Field(..., description="Legacy form fields to forward to Laravel")


class VideoProgressResponse(BaseModel):
    """Response from video progress query."""
    success: bool
    count: int
    tasks: List[dict]  # Includes: positions, video_due_date


class MaterializeTaskRequest(BaseModel):
    """Request to materialize a video progress task from global search."""
    athlete_id: str
    athlete_main_id: str
    athlete_name: Optional[str] = None
    sport_name: Optional[str] = None
    grad_year: Optional[str] = None
    high_school: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    positions: Optional[str] = None
    jersey_number: Optional[str] = None
    assigned_editor: str = Field(default="Jerami Singleton")
    stage: str = Field(default="In Queue")
    status: Optional[str] = Field(default="")
    source: Optional[str] = Field(default="raycast:global_prospect_ingest")


class MaterializeTaskResponse(BaseModel):
    """Response for materialized task."""
    success: bool
    existed: bool
    task: Dict[str, Any]


class RawAthleteSearchRequest(BaseModel):
    """Request for global athlete search (raw search)."""
    term: str = Field(..., description="Search term (name, email, or ID)")
    searching_for: Optional[str] = Field(None, description="Legacy searchingfor parameter")
    email: Optional[str] = Field(None, description="Search by email (admin search)")
    first_name: Optional[str] = Field(None, description="Search by first name (admin search)")
    last_name: Optional[str] = Field(None, description="Search by last name (admin search)")
    include_admin_search: bool = Field(True, description="Whether to run admin search fallback")
    include_recent_search: bool = Field(False, description="Whether to call scoutrecentsearch when IDs are available")


class AdminDuplicateSearchRequest(BaseModel):
    """Request for duplicate profile search using admin searchany flow."""
    search_term: str = Field(..., description="Full athlete name sent via legacy searchany")
    contact_id: str = Field(..., description="Current athlete contact id for admin-page context")
    athlete_main_id: str = Field(..., description="Current athlete main id for admin-page context")
    email: str = Field("", description="Must remain blank for duplicate profile search")


class RawAthleteSearchResult(BaseModel):
    """Normalized athlete search result."""
    athlete_id: str
    athlete_main_id: Optional[str] = None
    name: Optional[str] = None
    grad_year: Optional[str] = None
    sport: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    high_school: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    parent_name: Optional[str] = None
    parent_email: Optional[str] = None
    parent_phone: Optional[str] = None
    url: Optional[str] = None
    positions: Optional[str] = None
    source: Optional[str] = None


class RawAthleteSearchResponse(BaseModel):
    """Response from global athlete search."""
    success: bool
    count: int
    results: List[RawAthleteSearchResult]
    sources: Optional[List[Dict[str, Any]]] = None


class ScoutRecentProfile(BaseModel):
    athlete_id: str
    athlete_main_id: str
    athlete_name: str
    grad_year: Optional[str] = None
    sport: Optional[str] = None
    state: Optional[str] = None
    parent_names: Optional[List[str]] = None


class ScoutRecentProfilesResponse(BaseModel):
    success: bool
    count: int
    profiles: List[ScoutRecentProfile]


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


class AthleteTask(BaseModel):
    task_id: str
    title: Optional[str] = None
    assigned_owner: Optional[str] = None
    due_date: Optional[str] = None
    completion_date: Optional[str] = None
    description: Optional[str] = None
    row_text: Optional[str] = None


class TaskListResponse(BaseModel):
    success: bool
    count: int
    tasks: List[AthleteTask]


class TaskListRequest(BaseModel):
    athlete_id: str
    athlete_main_id: str


class TaskPopupRequest(BaseModel):
    task_id: str


class TaskPopupResponse(BaseModel):
    success: bool
    form_data: Dict[str, str]
    checkbox_fields: List[str]


class TaskUpdateRequest(BaseModel):
    task_id: str
    contact_task: str
    athlete_main_id: str
    task_title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None


class TaskUpdateResponse(BaseModel):
    success: bool
    task_id: Optional[str] = None
    message: Optional[str] = None
    raw_response: Optional[str] = None


class TaskCompleteRequest(BaseModel):
    athlete_id: str
    athlete_main_id: str
    contact_task: Optional[str] = None
    task_id: Optional[str] = None
    task_title: str = Field(default="Video Editing")
    assigned_owner: str = Field(default="Jerami Singleton")
    description: str
    completed_date: str
    completed_time: str
    is_completed: bool = Field(default=True)


class TaskCompleteResponse(BaseModel):
    success: bool
    task_id: Optional[str] = None
    message: Optional[str] = None
    raw_response: Optional[str] = None


class TaskCallAttempt3SentRequest(BaseModel):
    athlete_id: str
    athlete_main_id: str
    task_id: str
    completed_date: str
    completed_time: str
    stage: str = Field(default="Never Spoke To")
    task_title: str = Field(default="Call Attempt 3")
    description: str = Field(
        default="Call the family third time. Then If you do not get a hold of them, code as 'Did Not Speak To'"
    )
    assigned_to: Optional[str] = Field(default="1408164")


class TaskCallAttempt3SentResponse(BaseModel):
    success: bool
    task_id: Optional[str] = None
    stage: Optional[str] = None
    message: Optional[str] = None
    raw_response: Optional[str] = None


class TaskFollowUpMessageSentRequest(BaseModel):
    athlete_id: str
    athlete_main_id: str
    task_id: str
    completed_date: str
    completed_time: str
    stage: str
    task_title: str
    description: str
    assigned_to: Optional[str] = Field(default="1408164")


class TaskFollowUpMessageSentResponse(BaseModel):
    success: bool
    task_id: Optional[str] = None
    stage: Optional[str] = None
    message: Optional[str] = None
    raw_response: Optional[str] = None


class APIError(BaseModel):
    """Standardized error response."""
    success: bool = False
    error: str
    detail: Optional[str] = None
    legacy_response: Optional[str] = None


class VideoAttachment(BaseModel):
    """Single video attachment from athlete."""
    athlete_id: str
    athletename: str
    attachment: str  # Filename
    created_date: str
    expiry_date: str
    fileType: str  # MP4, etc.
    message_id: str  # video_msg_id alias


class VideoAttachmentsResponse(BaseModel):
    """Response from video attachments query."""
    status: Literal["ok", "error"]
    count: int
    attachments: List[VideoAttachment]


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
    include_athlete: bool = True
    parent_ids: Optional[List[str]] = None
    other_email: Optional[str] = None


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


# ============== Contact Models ==============

class ContactPerson(BaseModel):
    """Single contact (student or parent)."""
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    relationship: Optional[str] = None  # Only for parents


class ContactInfoResponse(BaseModel):
    """Enriched contact information."""
    contact_id: str = Field(..., alias='contactId')
    student_athlete: ContactPerson = Field(..., alias='studentAthlete')
    parent1: Optional[ContactPerson] = None
    parent2: Optional[ContactPerson] = None

    class Config:
        populate_by_name = True
        by_alias = True


class ScoutPortalTask(BaseModel):
    """Single task row from the admin portal task list."""
    task_id: Optional[str] = None
    contact_id: str
    athlete_main_id: Optional[str] = None
    athlete_id: Optional[str] = None
    athlete_name: str
    sport: Optional[str] = None
    high_school: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    due_date: Optional[str] = None
    completion_date: Optional[str] = None
    assigned_owner: Optional[str] = None
    grad_year: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    athlete_admin_url: Optional[str] = None
    athlete_profile_url: Optional[str] = None
    athlete_task_url: Optional[str] = None


class ScoutPortalTasksResponse(BaseModel):
    """Task list shown on the admin portal landing page."""
    success: bool
    count: int
    tasks: List[ScoutPortalTask]


class SalesStageOption(BaseModel):
    """Official sales-stage option from legacy Laravel."""
    value: str
    label: str
    selected: bool = False


class SalesStageOptionsResponse(BaseModel):
    """Official sales-stage options for an athlete."""
    success: bool
    count: int
    selected_value: Optional[str] = None
    selected_label: Optional[str] = None
    options: List[SalesStageOption]


class SalesStageUpdateRequest(BaseModel):
    """Update official sales-stage value for an athlete."""
    athlete_main_id: str
    athlete_id: str
    stage: str


class SalesStageUpdateResponse(BaseModel):
    """Result from legacy sales-stage update."""
    success: bool
    stage: str
    athlete_id: str
    athlete_main_id: str
    status_code: int
    tasks_count: int = 0
    created_task: Optional[AthleteTask] = None


class MeetingSetTemplateResponse(BaseModel):
    """Hydrated Meeting Set modal template."""
    success: bool
    meeting_name: Optional[str] = None
    selected_recruit_timezone: Optional[str] = None
    recruit_timezone_options: List[SalesStageOption]
    details_template: Optional[str] = None


class MeetingSetSubmitRequest(BaseModel):
    """Create meeting-set task and send legacy notification email."""
    athlete_id: str
    athlete_main_id: str
    meeting_name: str
    meeting_timezone: str
    assigned_to: str
    open_event_id: str
    task_description: str
    start_time: str
    meeting_length: str = "01:00"
    due_date: str = ""
    existing_task: str = ""
    contact: str = ""
    openmeetings_list_length: str = "-1"
    template_id: str = "210"


class MeetingSetSubmitResponse(BaseModel):
    """Result from legacy /tasks/addmeetingset + notification flow."""
    success: bool
    athlete_id: str
    athlete_main_id: str
    assigned_to: str
    open_event_id: str
    meeting_name: str
    template_id: str
    status_code: int
    email_sent: bool = False
    created_task: Optional[AthleteTask] = None


class HeadScoutSlot(BaseModel):
    """Single open slot for a head scout."""
    id: str
    start: str
    end: str
    scout_name: str


class HeadScoutSchedule(BaseModel):
    """Normalized open schedule for one head scout."""
    scout_name: str
    city: str
    state: str
    calendar_owner_id: str
    meeting_for: str
    slot_count: int
    slots: List[HeadScoutSlot]


class HeadScoutSlotsResponse(BaseModel):
    """Open slots for the configured head scouts in an EST week window."""
    success: bool
    week_start: str
    week_end: str
    timezone_label: str
    scouts: List[HeadScoutSchedule]


class OpenMeetingSlot(BaseModel):
    """Single open meeting option for a scout Meeting Set flow."""
    open_event_id: str
    date_time_label: str
    title: str
    assigned_owner: str
    start_time: str


class OpenMeetingsResponse(BaseModel):
    """Open meeting options for a selected scout Meeting Set owner."""
    success: bool
    meeting_for: str
    count: int
    slots: List[OpenMeetingSlot]


class BookedMeetingEvent(BaseModel):
    """Single booked calendar event for confirmation-message lookup."""
    event_id: str
    title: str
    assigned_owner: str
    start: str
    end: str
    date_time_label: str


class BookedMeetingLookupResponse(BaseModel):
    """Booked meeting match from legacy calendar events feed."""
    success: bool
    calendar_owner_id: str
    title_query: str
    start: str
    end: str
    count: int
    event: Optional[BookedMeetingEvent] = None
    events: List[BookedMeetingEvent] = []


class AthleteBookedMeetingsResponse(BaseModel):
    """Booked meeting rows from athlete admin event section."""
    success: bool
    athlete_id: str
    athlete_main_id: str
    count: int
    events: List[BookedMeetingEvent] = []


class HeadScoutBookedMeetingsResponse(BaseModel):
    """Booked meetings for configured head scouts in an EST week window."""
    success: bool
    week_start: str
    week_end: str
    count: int
    events: List[BookedMeetingEvent] = []


class BookedMeetingTitleUpdateRequest(BaseModel):
    """Update a booked meeting title prefix by specific event id."""
    event_id: str
    event_date: str
    prefix: Literal["(ACF)", "(CF)", "(RSP)", "(CAN)", "(ACF*2)"]


class BookedMeetingTitleUpdateResponse(BaseModel):
    """Booked meeting title prefix update result."""
    success: bool
    event_id: str
    prefix: Literal["(ACF)", "(CF)", "(RSP)", "(CAN)", "(ACF*2)"]
    original_title: str
    updated_title: str
    message: str


class BookedMeetingDetailsResponse(BaseModel):
    """Booked meeting popup details for editing."""
    success: bool
    event_id: str
    title: str
    description: str


class BookedMeetingDescriptionUpdateRequest(BaseModel):
    """Update a booked meeting description by specific event id."""
    event_id: str
    event_date: str
    description: str


class BookedMeetingDescriptionUpdateResponse(BaseModel):
    """Booked meeting description update result."""
    success: bool
    event_id: str
    original_description: str
    updated_description: str
    message: str
