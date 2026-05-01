from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import hmac
import logging
import os
from pathlib import Path

from app.session import (
    get_session_file_status,
    session_manager,
    video_progress_session_manager,
)
from app.routers.video import router as video_router
from app.routers.athlete import router as athlete_router
from app.routers.assignments import router as assignments_router
from app.routers.email import router as email_router
from app.routers.inbox import router as inbox_router
from app.routers.notes import router as notes_router
from app.routers.contacts import router as contacts_router
from app.routers.tasks import router as tasks_router
from app.routers.scout import router as scout_router
from app.routers.sales import router as sales_router
from app.routers.calendar import router as calendar_router
from app.routers.mobile import router as mobile_router

LOG_DIR = Path(os.getenv("RAYCAST_LOG_DIR", "/Users/singleton23/raycast_logs"))
LOG_FILE = LOG_DIR / "npid-api-layer.log"

try:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
except Exception as exc:
    LOG_DIR = Path("/tmp/raycast_logs")
    LOG_FILE = LOG_DIR / "npid-api-layer.log"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    print("Failed to create log directory, using fallback:", exc)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
root_logger = logging.getLogger()
if not any(
    isinstance(handler, logging.FileHandler) and getattr(handler, "baseFilename", "") == str(LOG_FILE)
    for handler in root_logger.handlers
):
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    root_logger.addHandler(file_handler)
logger = logging.getLogger(__name__)

app = FastAPI(title="NPID API Bridge", version="1.0")

STATIC_DIR = Path(__file__).parent / "app" / "static"
DEFAULT_ALLOWED_ORIGINS = "https://recruiting-api.prospectid.com,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8888,http://127.0.0.1:8888"
STATIC_DIR.mkdir(parents=True, exist_ok=True)


def _parse_allowed_origins() -> list[str]:
    raw_value = os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    origins = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return origins or ["https://recruiting-api.prospectid.com"]


def _host_without_port(value: str | None) -> str:
    return (value or "").split(":", 1)[0].strip().lower()


def _is_public_tailscale_request(request: Request) -> bool:
    host = _host_without_port(request.headers.get("host"))
    forwarded_host = _host_without_port(request.headers.get("x-forwarded-host"))
    return host.endswith(".ts.net") or forwarded_host.endswith(".ts.net")


app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_token_for_public_tailscale_requests(request: Request, call_next):
    if request.url.path == "/health" or not _is_public_tailscale_request(request):
        return await call_next(request)

    token = os.getenv("PROSPECT_API_TOKEN", "").strip()
    if not token:
        return JSONResponse(
            {"detail": "PROSPECT_API_TOKEN is not configured"},
            status_code=503,
        )

    expected = f"Bearer {token}"
    authorization = request.headers.get("authorization")
    if not authorization or not hmac.compare_digest(authorization, expected):
        return JSONResponse(
            {"detail": "Missing or invalid mobile API token"},
            status_code=401,
        )

    return await call_next(request)


@app.on_event("startup")
async def startup_event():
    # Cookies already loaded in NPIDSession.__init__
    # Just refresh CSRF token
    await session_manager.refresh_csrf()
    logger.info("✅ FastAPI startup complete")


@app.on_event("shutdown")
async def shutdown_event():
    await session_manager.close()
    await video_progress_session_manager.close()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "session_authenticated": session_manager.is_authenticated
    }


@app.get("/auth-status")
async def auth_status():
    shared_probe = await session_manager.probe_auth()
    video_progress_probe = await video_progress_session_manager.probe_auth()

    return {
        "status": "ok",
        "session_file": get_session_file_status(),
        "shared_session": {
            **session_manager.debug_snapshot(),
            "probe": shared_probe,
        },
        "video_progress_session": {
            **video_progress_session_manager.debug_snapshot(),
            "probe": video_progress_probe,
        },
        "summary": {
            "cookies_present": bool(session_manager.client.cookies),
            "shared_session_valid": shared_probe["auth_valid"],
            "video_progress_session_valid": video_progress_probe["auth_valid"],
            "likely_disconnected": not (
                shared_probe["auth_valid"] and video_progress_probe["auth_valid"]
            ),
        },
    }


@app.post("/auth/reload")
async def auth_reload():
    session_manager.reload_from_disk()
    video_progress_session_manager.reload_from_disk()
    await session_manager.refresh_csrf()
    await video_progress_session_manager.refresh_csrf()

    return await auth_status()


@app.get("/")
def portal_home():
    portal_file = STATIC_DIR / "index.html"
    if portal_file.exists():
        return FileResponse(portal_file)
    return {
        "status": "ok",
        "message": "Portal UI not found. Ensure app/static/index.html exists."
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# MOUNT THESE – this is what you were missing
app.include_router(video_router, prefix="/api/v1/video", tags=["video"])
app.include_router(athlete_router, prefix="/api/v1/athlete", tags=["athlete"])
app.include_router(assignments_router, prefix="/api/v1/assignments", tags=["assignments"])
app.include_router(email_router, prefix="/api/v1", tags=["email"])
app.include_router(inbox_router, prefix="/api/v1/inbox", tags=["inbox"])
app.include_router(notes_router, prefix="/api/v1/notes", tags=["notes"])
app.include_router(contacts_router, prefix="/api/v1/contacts", tags=["contacts"])
app.include_router(tasks_router, prefix="/api/v1/tasks", tags=["tasks"])
app.include_router(scout_router, prefix="/api/v1/scout", tags=["scout"])
app.include_router(sales_router, prefix="/api/v1/sales", tags=["sales"])
app.include_router(calendar_router, prefix="/api/v1/calendar", tags=["calendar"])
app.include_router(mobile_router, prefix="/api/v1/mobile", tags=["mobile"])
