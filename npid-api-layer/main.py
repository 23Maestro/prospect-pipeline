from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from pathlib import Path

from app.session import session_manager
from app.routers.video import router as video_router
from app.routers.athlete import router as athlete_router
from app.routers.assignments import router as assignments_router
from app.routers.email import router as email_router
from app.routers.inbox import router as inbox_router
from app.routers.notes import router as notes_router
from app.routers.contacts import router as contacts_router
from app.routers.craft_tasks import router as craft_router

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.get("/health")
def health():
    return {
        "status": "ok",
        "session_authenticated": session_manager.is_authenticated
    }


# MOUNT THESE – this is what you were missing
app.include_router(video_router, prefix="/api/v1/video", tags=["video"])
app.include_router(athlete_router, prefix="/api/v1/athlete", tags=["athlete"])
app.include_router(assignments_router, prefix="/api/v1/assignments", tags=["assignments"])
app.include_router(email_router, prefix="/api/v1", tags=["email"])
app.include_router(inbox_router, prefix="/api/v1/inbox", tags=["inbox"])
app.include_router(notes_router, prefix="/api/v1/notes", tags=["notes"])
app.include_router(contacts_router, prefix="/api/v1/contacts", tags=["contacts"])
app.include_router(craft_router, prefix="/api/v1/craft", tags=["craft"])
