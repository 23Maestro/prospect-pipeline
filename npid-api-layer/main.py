from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.session import session_manager
from app.routers.video import router as video_router
from app.routers.athlete import router as athlete_router
from app.routers.assignments import router as assignments_router
from app.routers.email import router as email_router
from app.routers.inbox import router as inbox_router
from app.routers.notes import router as notes_router

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
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
