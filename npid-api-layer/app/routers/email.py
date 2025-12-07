"""
Email Router
FastAPI endpoints for email functionality using verified curl commands.
"""

from fastapi import APIRouter, Request, HTTPException
from app.models.schemas import (
    EmailTemplateDataRequest,
    EmailTemplateDataResponse,
    SendEmailRequest,
    SendEmailResponse
)
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession
import logging

router = APIRouter(prefix="/email", tags=["email"])
logger = logging.getLogger(__name__)


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.get("/templates/{athlete_id}")
async def get_email_templates(request: Request, athlete_id: str):
    """
    Get email templates for athlete.
    GET /rulestemplates/template/sendingtodetails?id={athlete_id}
    Returns HTML with <option> elements - parsed to JSON.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    logger.info(f"📧 Fetching email templates for athlete {athlete_id}")

    try:
        response = await session.get(f"/rulestemplates/template/sendingtodetails?id={athlete_id}")
        templates = translator.parse_email_templates(response.text)

        logger.info(f"✅ Found {len(templates)} email templates")
        return {"success": True, "templates": templates}
    except Exception as e:
        logger.error(f"❌ Failed to fetch templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/template-data", response_model=EmailTemplateDataResponse)
async def get_template_data(request: Request, payload: EmailTemplateDataRequest):
    """
    Get template data (sender, subject, message).
    POST /admin/templatedata
    Body: tmpl={template_id}&athlete_id={athlete_id}
    """
    session = get_session(request)
    translator = LegacyTranslator()

    endpoint, form_data = translator.template_data_to_legacy(
        payload.template_id,
        payload.athlete_id
    )

    logger.info(f"📧 Fetching template data: template={payload.template_id}, athlete={payload.athlete_id}")

    try:
        response = await session.post(endpoint, data=form_data)
        data = response.json()

        logger.info(f"✅ Template data retrieved")
        return EmailTemplateDataResponse(
            sender_name=data.get("sender_name", "Video Team"),
            sender_email=data.get("sender_email", "videoteam@prospectid.com"),
            subject=data.get("templatesubject", ""),
            message=data.get("templatedescription", "")
        )
    except Exception as e:
        logger.error(f"❌ Failed to get template data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send", response_model=SendEmailResponse)
async def send_email(request: Request, payload: SendEmailRequest):
    """
    Send email to athlete.
    POST /admin/addnotification
    Uses multipart/form-data matching user's verified curl command.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    endpoint, form_data = translator.send_email_to_legacy(payload)

    logger.info(f"📧 Sending email to athlete {payload.athlete_id} with template {payload.template_id}")

    try:
        # Laravel expects form-encoded data
        response = await session.post(endpoint, data=form_data)

        # Laravel returns HTML with "Email Sent" message on success
        if "Email Sent" in response.text or response.status_code == 200:
            logger.info(f"✅ Email sent successfully")
            return SendEmailResponse(success=True, message="Email sent successfully")
        else:
            logger.warning(f"⚠️ Email send returned unexpected response")
            return SendEmailResponse(success=False, message="Failed to send email")
    except Exception as e:
        logger.error(f"❌ Failed to send email: {e}")
        raise HTTPException(status_code=500, detail=str(e))
