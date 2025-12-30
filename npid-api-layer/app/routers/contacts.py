"""
Contact Router
Handles athlete contact enrichment (student + parents).
"""
from fastapi import APIRouter, HTTPException, Request, Query
import logging

from app.models.schemas import ContactInfoResponse
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

logger = logging.getLogger(__name__)
router = APIRouter(tags=["contacts"])


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/{contact_id}/enriched", response_model=ContactInfoResponse)
async def get_enriched_contact(
    request: Request,
    contact_id: str,
    athlete_main_id: str = Query(..., description="Athlete main ID for contact enrichment")
):
    """
    Fetch full contact info (student + parents with emails and phones).

    Combines:
    - POST /admin/athleteinfo (phones, names, relationships)
    - GET /template/template/athlete_emailslist (emails)

    Returns normalized ContactInfoResponse.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"🔍 Fetching contact info for {contact_id} (main_id: {athlete_main_id})")

    try:
        # Step 1: Fetch athleteinfo (phones + names)
        endpoint, form_data = translator.contact_info_to_legacy(contact_id, athlete_main_id)
        logger.info(f"📞 POST {endpoint}")
        info_response = await session.post(endpoint, data=form_data)

        if info_response.status_code != 200:
            logger.error(f"❌ athleteinfo failed: HTTP {info_response.status_code}")
            raise HTTPException(status_code=info_response.status_code, detail="athleteinfo failed")

        contact_data = translator.parse_athleteinfo_response(info_response.text)
        student_name = contact_data.get('student', {}).get('firstName') if contact_data.get('student') else None
        parent1_name = contact_data.get('parent1', {}).get('firstName') if contact_data.get('parent1') else None
        logger.info(f"✅ Parsed athleteinfo: student={student_name}, parent1={parent1_name}")

        # Step 2: Build response (emails already extracted from athleteinfo)
        result = translator.merge_contact_data(contact_id, contact_data, [])
        logger.info(f"✅ Contact enrichment complete for {contact_id}")

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Contact enrichment failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
