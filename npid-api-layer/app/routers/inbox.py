"""
Inbox Router
Handles video team inbox operations: list threads, message detail, assignment, contact search.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
from typing import Optional
from pydantic import BaseModel

from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

logger = logging.getLogger(__name__)
router = APIRouter(tags=["inbox"])


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


# ============== Request Models ==============

class InboxThreadsRequest(BaseModel):
    limit: int = 100
    filter_assigned: str = "both"  # 'unassigned', 'assigned', or 'both'


class MessageDetailRequest(BaseModel):
    message_id: str
    item_code: str


class AssignmentModalRequest(BaseModel):
    message_id: str
    item_code: str


class AssignThreadRequest(BaseModel):
    messageId: str
    ownerId: str
    contact_id: Optional[str] = ""
    contactId: Optional[str] = ""
    athleteMainId: Optional[str] = ""
    stage: Optional[str] = ""
    status: Optional[str] = ""
    contactFor: Optional[str] = "athlete"
    searchFor: Optional[str] = None
    contact: Optional[str] = ""
    formToken: Optional[str] = ""


class ContactSearchRequest(BaseModel):
    query: str
    search_type: str = "athlete"  # 'athlete' or 'parent'


class AssignmentDefaultsRequest(BaseModel):
    contact_id: str


class SendReplyRequest(BaseModel):
    message_id: str
    item_code: str
    reply_text: str


# ============== Endpoints ==============

@router.post("/threads")
async def get_inbox_threads(request: Request, payload: InboxThreadsRequest):
    """
    Fetch inbox threads with optional filter for assignment status.
    Mirrors: src/python/npid_api_client.py:223-273
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching inbox threads (limit={payload.limit}, filter={payload.filter_assigned})")

    try:
        endpoint, form_data = translator.inbox_threads_to_legacy(
            payload.limit, payload.filter_assigned
        )
        response = await session.get(endpoint, params=form_data)
        result = translator.parse_inbox_threads_response(response.text, payload.filter_assigned)

        logger.info(f"✅ Found {len(result['threads'])} threads")
        return {"success": True, "threads": result["threads"]}

    except Exception as e:
        logger.error(f"❌ Inbox threads error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/message")
async def get_message_detail(request: Request, payload: MessageDetailRequest):
    """
    Get detailed message content.
    Mirrors: src/python/npid_api_client.py:339-401
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching message detail for {payload.message_id}")

    try:
        endpoint, params = translator.message_detail_to_legacy(
            payload.message_id, payload.item_code
        )
        response = await session.get(endpoint, params=params)
        result = translator.parse_message_detail_response(response.text, payload.message_id, payload.item_code)

        logger.info(f"✅ Message detail fetched ({len(result.get('content', ''))} chars)")
        return {"success": True, **result}

    except Exception as e:
        logger.error(f"❌ Message detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/assignment-modal")
async def get_assignment_modal(request: Request, payload: AssignmentModalRequest):
    """
    Get assignment modal data (owners, stages, statuses, form token).
    Mirrors: src/python/npid_api_client.py:424-485
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching assignment modal for {payload.message_id}")

    try:
        endpoint, params = translator.assignment_modal_to_legacy(
            payload.message_id, payload.item_code
        )
        response = await session.get(endpoint, params=params)
        result = translator.parse_assignment_modal_response(response.text)

        logger.info(f"✅ Assignment modal fetched (owners={len(result.get('owners', []))})")
        return {"success": True, "modal": result}

    except Exception as e:
        logger.error(f"❌ Assignment modal error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/assign")
async def assign_thread(request: Request, payload: AssignThreadRequest):
    """
    Assign thread to video team member.
    Mirrors: src/python/npid_api_client.py:487-528
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📤 Assigning thread {payload.messageId} to owner {payload.ownerId}")

    try:
        endpoint, form_data = translator.assign_thread_to_legacy(payload.dict())
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_assign_thread_response(response.text)

        if result["success"]:
            logger.info(f"✅ Thread {payload.messageId} assigned successfully")
            return {"success": True}
        else:
            raise HTTPException(status_code=400, detail=result.get("error", "Assignment failed"))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Assign thread error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/contacts/search")
async def search_contacts(request: Request, payload: ContactSearchRequest):
    """
    Search for contacts (athletes or parents).
    Mirrors: src/python/npid_api_client.py:607-649
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"🔍 Searching contacts: '{payload.query}' ({payload.search_type})")

    try:
        endpoint, params = translator.contact_search_to_legacy(payload.query, payload.search_type)
        response = await session.get(endpoint, params=params)
        result = translator.parse_contact_search_response(response.text)

        logger.info(f"✅ Found {len(result['contacts'])} contacts")
        return {"success": True, "contacts": result["contacts"]}

    except Exception as e:
        logger.error(f"❌ Contact search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/assignment-defaults")
async def get_assignment_defaults(request: Request, payload: AssignmentDefaultsRequest):
    """
    Get recommended stage/status for a contact.
    Mirrors: src/python/npid_api_client.py:530-540
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📥 Fetching assignment defaults for contact {payload.contact_id}")

    try:
        endpoint, params = translator.assignment_defaults_to_legacy(payload.contact_id)
        response = await session.get(endpoint, params=params)
        result = translator.parse_assignment_defaults_response(response.text)

        logger.info(f"✅ Assignment defaults: stage={result.get('stage')}, status={result.get('status')}")
        return {"success": True, **result}

    except Exception as e:
        logger.error(f"❌ Assignment defaults error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reply")
async def send_reply(request: Request, payload: SendReplyRequest):
    """
    Send reply to inbox message.
    Mirrors: src/python/npid_api_client.py:576-605
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📤 Sending reply to message {payload.message_id}")

    try:
        # Fetch message detail for previous content/signature
        detail_endpoint, detail_params = translator.message_detail_to_legacy(
            payload.message_id, payload.item_code
        )
        detail_response = await session.get(detail_endpoint, params=detail_params)
        detail_data = translator.parse_message_detail_response(
            detail_response.text, payload.message_id, payload.item_code
        )

        # First, get the reply form data to fetch CSRF token and thread info
        form_endpoint, form_params = translator.reply_form_to_legacy(payload.message_id, payload.item_code)
        form_response = await session.get(form_endpoint, params=form_params)
        thread_data = translator.parse_reply_form_response(form_response.text, payload.message_id)

        # Now send the reply
        reply_endpoint, reply_data, reply_files = translator.send_reply_to_legacy(
            payload.message_id, payload.item_code, payload.reply_text, thread_data, detail_data
        )
        response = await session.post(reply_endpoint, data=reply_data, files=reply_files)

        if response.status_code == 200:
            logger.info(f"✅ Reply sent successfully")
            return {"success": True}
        else:
            raise HTTPException(status_code=response.status_code, detail="Reply failed")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Send reply error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
