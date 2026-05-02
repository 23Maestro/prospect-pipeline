"""
Call tracker router.

Runs the existing Supabase sync pipeline from the local API so the dashboard
Refresh button can update source data before re-reading Supabase views.
"""

import asyncio
import os
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

router = APIRouter(tags=["call-tracker"])

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SYNC_SCRIPT = PROJECT_ROOT / "scripts" / "sync-supabase-pipeline.sh"
SYNC_LOCK = asyncio.Lock()
SYNC_TASK: asyncio.Task | None = None
SYNC_STATE: dict[str, Any] = {
    "success": True,
    "status": "idle",
    "message": "No call tracker sync has run from this API process yet.",
}


def _tail_log(max_lines: int = 80) -> list[str]:
    log_dir = Path(os.getenv("RAYCAST_LOG_DIR", str(Path.home() / "raycast_logs"))) / "supabase-sync"
    log_path = log_dir / f"sync-{time.strftime('%Y-%m-%d')}.log"
    if not log_path.exists():
        return []
    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[-max_lines:]


def _public_state() -> dict[str, Any]:
    return {
        **SYNC_STATE,
        "running": bool(SYNC_TASK and not SYNC_TASK.done()),
        "log_tail": _tail_log(80),
    }


async def _run_sync_pipeline() -> dict[str, Any]:
    if not SYNC_SCRIPT.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Missing sync script: {SYNC_SCRIPT}",
        )

    started = time.time()
    async with SYNC_LOCK:
        SYNC_STATE.update(
            {
                "success": False,
                "status": "running",
                "message": "Call tracker sync is running.",
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
        )
        process = await asyncio.create_subprocess_exec(
            "bash",
            str(SYNC_SCRIPT),
            cwd=str(PROJECT_ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **os.environ,
                "API_BASE": os.getenv("API_BASE", "http://127.0.0.1:8000/api/v1"),
                "CALL_TRACKER_OWNER": os.getenv("CALL_TRACKER_OWNER", "Jerami Singleton"),
            },
        )
        stdout, stderr = await process.communicate()

    duration_ms = round((time.time() - started) * 1000)
    payload = {
        "success": process.returncode == 0,
        "status": "complete" if process.returncode == 0 else "failed",
        "duration_ms": duration_ms,
        "return_code": process.returncode,
        "stdout": stdout.decode("utf-8", errors="replace").strip()[-2000:],
        "stderr": stderr.decode("utf-8", errors="replace").strip()[-2000:],
        "log_tail": _tail_log(80),
    }
    SYNC_STATE.update(
        {
            **payload,
            "message": "Call tracker sync completed." if process.returncode == 0 else "Call tracker sync failed.",
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
    )
    if process.returncode != 0:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=payload)
    return payload


async def _run_sync_pipeline_background() -> None:
    try:
        await _run_sync_pipeline()
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"detail": exc.detail}
        SYNC_STATE.update(
            {
                "success": False,
                "status": "failed",
                "message": "Call tracker sync failed.",
                **detail,
                "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
        )
    except Exception as exc:
        SYNC_STATE.update(
            {
                "success": False,
                "status": "failed",
                "message": str(exc),
                "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "log_tail": _tail_log(80),
            }
        )


@router.get("/sync")
async def get_call_tracker_sync_status():
    return _public_state()


@router.post("/sync")
async def sync_call_tracker(wait: bool = Query(True)):
    global SYNC_TASK

    if SYNC_LOCK.locked() or (SYNC_TASK and not SYNC_TASK.done()):
        return {
            **_public_state(),
            "success": False,
            "status": "already_running",
            "message": "Call tracker sync is already running.",
        }

    if not wait:
        SYNC_TASK = asyncio.create_task(_run_sync_pipeline_background())
        return {
            "success": True,
            "status": "started",
            "message": "Call tracker sync started.",
            "running": True,
            "log_tail": _tail_log(40),
        }

    return await _run_sync_pipeline()
