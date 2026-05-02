"""
Commissions Router
FastAPI endpoints for legacy commission source evidence.
"""

from fastapi import APIRouter, HTTPException, Request
import logging

from app.models.schemas import CommissionLookupRequest, CommissionLookupResponse
from app.translators.legacy import LegacyTranslator
from app.session import NPIDSession

router = APIRouter(tags=["commissions"])
logger = logging.getLogger(__name__)
FEATURE = "commissions"


def get_session(request: Request) -> NPIDSession:
    """Get session from app state."""
    from main import session_manager
    return session_manager


@router.post("/stripe", response_model=CommissionLookupResponse)
async def get_stripe_commissions(request: Request, payload: CommissionLookupRequest):
    """
    Fetch normalized Stripe commission rows for a legacy half-month period.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    try:
        endpoint, form_data = translator.stripe_commissions_to_legacy(
            commperiod=payload.commperiod,
            scout=payload.scout,
        )
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_commission_lookup_response(
            raw_response=response.text,
            source="stripe_commissions",
            commperiod=payload.commperiod,
            scout=payload.scout,
            status_code=response.status_code,
            content_type=response.headers.get("content-type"),
        )
        return CommissionLookupResponse(**result)
    except Exception as exc:
        logger.error(
            "COMMISSION_FETCH %s",
            {
                "event": "COMMISSION_FETCH",
                "step": "stripe",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {"commperiod": payload.commperiod, "scout": payload.scout},
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/stripe-payroll", response_model=CommissionLookupResponse)
async def get_stripe_payroll_commissions(request: Request, payload: CommissionLookupRequest):
    """
    Fetch normalized Stripe payroll commission rows for a legacy half-month period.
    """
    session = get_session(request)
    translator = LegacyTranslator()

    try:
        endpoint, form_data = translator.stripe_commission_payroll_to_legacy(
            commperiod=payload.commperiod,
            scout=payload.scout,
        )
        response = await session.post(endpoint, data=form_data)
        result = translator.parse_commission_lookup_response(
            raw_response=response.text,
            source="stripe_commission_payroll",
            commperiod=payload.commperiod,
            scout=payload.scout,
            status_code=response.status_code,
            content_type=response.headers.get("content-type"),
        )
        return CommissionLookupResponse(**result)
    except Exception as exc:
        logger.error(
            "COMMISSION_FETCH %s",
            {
                "event": "COMMISSION_FETCH",
                "step": "stripe_payroll",
                "status": "failure",
                "feature": FEATURE,
                "error": str(exc),
                "context": {"commperiod": payload.commperiod, "scout": payload.scout},
            },
        )
        raise HTTPException(status_code=500, detail=str(exc))
