"""
Inbox Router
Handles video team inbox operations: list threads, message detail, assignment, contact search.
"""

from fastapi import APIRouter, HTTPException, Request
import logging
from typing import Optional
from pydantic import BaseModel
from typing_extensions import Literal

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
    page_start_number: int = 1
    only_pagination: bool = False
    search_text: str = ""


class MessageDetailRequest(BaseModel):
    message_id: str
    item_code: str
    body_mode: Literal["contextual", "strict"] = "contextual"
    strict_body: bool = False


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

    logger.info(
        f"📥 Fetching inbox threads (limit={payload.limit}, filter={payload.filter_assigned}, "
        f"page={payload.page_start_number}, search='{payload.search_text}')"
    )

    try:
        endpoint, form_data = translator.inbox_threads_to_legacy(
            payload.limit, payload.filter_assigned, payload.page_start_number, payload.only_pagination, payload.search_text
        )
        logger.info(f"🌐 Laravel request: {endpoint} with params: {form_data}")
        response = await session.get(endpoint, params=form_data)
        result = translator.parse_inbox_threads_response(response.text, payload.filter_assigned)

        logger.info(f"✅ Found {len(result['threads'])} threads")
        if result['threads']:
            logger.info(f"📊 First thread: id={result['threads'][0]['id']}, subject={result['threads'][0]['subject']}")
            logger.info(f"📊 Last thread: id={result['threads'][-1]['id']}, subject={result['threads'][-1]['subject']}")
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
        strict_body = payload.body_mode == "strict" or payload.strict_body
        result = translator.parse_message_detail_response(
            response.text, payload.message_id, payload.item_code, strict_body=strict_body
        )

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
        logger.info(f"📥 STEP 1: Fetching message detail: {detail_endpoint}")
        logger.debug(f"📥 Detail params: {detail_params}")
        detail_response = await session.get(detail_endpoint, params=detail_params)
        logger.info(f"📥 Message detail response: status={detail_response.status_code}, content-type={detail_response.headers.get('content-type')}, length={len(detail_response.text)}")
        logger.debug(f"📥 Detail response headers: {dict(detail_response.headers)}")
        logger.debug(f"📥 Detail response first 500 chars: {detail_response.text[:500]}")

        if detail_response.status_code != 200:
            logger.error(f"❌ Failed to fetch message detail: {detail_response.status_code}")
            logger.error(f"❌ Response body: {detail_response.text[:1000]}")
            raise HTTPException(status_code=detail_response.status_code, detail="Failed to fetch message detail")

        detail_data = translator.parse_message_detail_response(
            detail_response.text, payload.message_id, payload.item_code
        )
        logger.info(f"📊 Parsed detail data keys: {list(detail_data.keys())}")

        # First, get the reply form data to fetch CSRF token and thread info
        form_endpoint, form_params = translator.reply_form_to_legacy(payload.message_id, payload.item_code)
        logger.info(f"📝 STEP 2: Fetching reply form: {form_endpoint}")
        logger.debug(f"📝 Form params: {form_params}")
        form_response = await session.get(form_endpoint, params=form_params)
        logger.info(f"📝 Reply form response: status={form_response.status_code}, content-type={form_response.headers.get('content-type')}, length={len(form_response.text)}")
        logger.debug(f"📝 Form response headers: {dict(form_response.headers)}")
        logger.debug(f"📝 Form response first 500 chars: {form_response.text[:500]}")

        if form_response.status_code != 200:
            logger.error(f"❌ Failed to fetch reply form: {form_response.status_code}")
            logger.error(f"❌ Response body: {form_response.text[:1000]}")
            raise HTTPException(status_code=form_response.status_code, detail="Failed to fetch reply form")

        # Check if we got HTML or a redirect page
        if '<html' not in form_response.text.lower() and 'window.location' in form_response.text.lower():
            logger.error(f"❌ Got JavaScript redirect instead of HTML form")
            logger.error(f"❌ Full response: {form_response.text}")
            raise HTTPException(status_code=401, detail="Session expired - got redirect script")

        thread_data = translator.parse_reply_form_response(form_response.text, payload.message_id)

        csrf_token = thread_data.get('csrf_token', '')
        logger.info(f"📝 STEP 3: Scraped CSRF token length: {len(csrf_token)}, value: {csrf_token[:20] if csrf_token else 'EMPTY'}...")

        if not csrf_token:
            body_sample = form_response.text or ""
            if len(body_sample) > 2000:
                body_sample = body_sample[:2000]
            logger.warning(
                "⚠️ Reply form missing _token. Body sample (first 2000 chars): %r",
                body_sample
            )

        # FALLBACK: If scraping failed, use session token
        if not csrf_token:
            logger.warning(f"⚠️ Token scraping failed, using session token as fallback")
            logger.info(f"🔍 Current session.csrf_token: {session.csrf_token[:20] if session.csrf_token else 'NONE'}...")
            await session.refresh_csrf()  # Ensure fresh token
            csrf_token = session.csrf_token or ''
            thread_data['csrf_token'] = csrf_token  # Update thread_data for translator
            logger.info(f"🔄 After refresh - session token length: {len(csrf_token)}, value: {csrf_token[:20] if csrf_token else 'STILL_EMPTY'}...")

        if not csrf_token:
            logger.error(f"❌ CRITICAL: No CSRF token available (neither scraped nor from session)")
            raise HTTPException(status_code=500, detail="Cannot obtain CSRF token")

        # Now send the reply
        reply_endpoint, reply_data, reply_files = translator.send_reply_to_legacy(
            payload.message_id, payload.item_code, payload.reply_text, thread_data, detail_data
        )
        token_in_data = reply_data.get('_token', '')
        logger.info(f"📤 STEP 4: Prepared reply data")
        logger.debug(f"📤 Reply endpoint: {reply_endpoint}")
        logger.debug(f"📤 Reply data keys: {list(reply_data.keys())}")
        logger.debug(f"📤 Reply data _token: {token_in_data[:20] if token_in_data else 'EMPTY'}...")
        reply_data_safe = {k: v for k, v in reply_data.items() if k != 'message'}
        logger.debug(f"📤 Reply data (excluding message): {reply_data_safe}")
        logger.info(f"📤 Sending reply with token length: {len(token_in_data)}, reply_text length: {len(payload.reply_text)}")

        # Remove skip_csrf_retry to allow automatic recovery from 419/302 errors
        response = await session.post(reply_endpoint, data=reply_data, files=reply_files)

        logger.info(f"📥 STEP 5: Reply response received: status={response.status_code}, content-type={response.headers.get('content-type')}")
        logger.debug(f"📥 Response headers: {dict(response.headers)}")
        logger.debug(f"📥 Response body first 500 chars: {response.text[:500]}")

        # Laravel redirects after successful form submissions (302), check redirect location
        if response.status_code in [200, 302]:
            # If 302, check it's not redirecting to login (which would indicate auth failure)
            if response.status_code == 302:
                redirect_url = response.headers.get('Location', '')
                logger.info(f"📍 Reply response 302, redirecting to: {redirect_url}")
                if '/auth/login' in redirect_url or '/login' in redirect_url:
                    raise HTTPException(status_code=401, detail="Authentication failed - redirected to login")
            logger.info(f"✅ Reply sent successfully (status: {response.status_code})")
            return {"success": True}
        else:
            logger.error(f"❌ Reply failed with status {response.status_code}")
            raise HTTPException(status_code=response.status_code, detail="Reply failed")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Send reply error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
