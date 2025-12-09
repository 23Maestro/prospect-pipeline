"""
Notes Router
FastAPI endpoints for athlete notes.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import (
    NotesListRequest,
    NotesListResponse,
    AddNoteRequest,
    AddNoteResponse
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["notes"])
logger = logging.getLogger(__name__)


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.post("/list", response_model=NotesListResponse)
async def list_athlete_notes(request: Request, payload: NotesListRequest):
    """
    Fetch notes for an athlete/contact.
    Mirrors the notes tab on athlete profile.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching notes for athlete {payload.athlete_id}")

    try:
        endpoint, params = translator.notes_list_to_legacy(
            payload.athlete_id, payload.athlete_main_id
        )
        response = await session.get(endpoint, params=params)
        result = translator.parse_notes_list_response(response.text)

        if result["success"]:
            return NotesListResponse(success=True, notes=result["notes"])
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to fetch notes"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Notes list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add", response_model=AddNoteResponse)
async def add_athlete_note(request: Request, payload: AddNoteRequest):
    """
    Add a new note to an athlete/contact.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📝 Adding note for athlete {payload.athlete_id}")

    try:
        endpoint, form_data = translator.add_note_to_legacy(payload)
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_add_note_response(response.text)

        if result.get("success", False):
            return AddNoteResponse(success=True, message=result.get("message", "Note added"))
        raise HTTPException(status_code=400, detail=result.get("message", "Failed to add note"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Add note error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
