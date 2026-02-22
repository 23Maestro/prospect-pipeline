from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import logging
import os
from pathlib import Path

from app.session import session_manager, video_progress_session_manager
from app.routers.video import router as video_router
from app.routers.athlete import router as athlete_router
from app.routers.assignments import router as assignments_router
from app.routers.email import router as email_router
from app.routers.inbox import router as inbox_router
from app.routers.notes import router as notes_router
from app.routers.contacts import router as contacts_router
from app.routers.tasks import router as tasks_router

LOG_DIR = Path("/Users/singleton23/raycast_logs")
LOG_FILE = LOG_DIR / "npid-api-layer.log"

try:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
except Exception as exc:
    print("Failed to create log directory:", exc)

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
DEFAULT_ALLOWED_ORIGINS = "https://recruiting-api.prospectid.com,http://localhost:3000,http://127.0.0.1:3000"
STATIC_DIR.mkdir(parents=True, exist_ok=True)


def _parse_allowed_origins() -> list[str]:
    raw_value = os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    origins = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return origins or ["https://recruiting-api.prospectid.com"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
