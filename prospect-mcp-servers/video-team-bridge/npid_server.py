#!/usr/bin/env python3
"""NPID Video Team MCP Server powered by Playwright automation."""
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

from mcp.server.fastmcp import FastMCP

from npid_automator import AutomatorError, get_automator

# Configure logging to stderr
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger("npid-server")

# Initialize MCP server - NO PROMPT PARAMETER!
mcp = FastMCP("npid")

# Configuration
automator = get_automator()


def _success(payload):
    return json.dumps({"status": "ok", "data": payload}, ensure_ascii=False)


def _failure(message):
    return json.dumps({"status": "error", "message": message}, ensure_ascii=False)


async def _json_request(method: str, path: str, payload=None, params=None):
    data, status = await automator.request_json(method, path, payload=payload, params=params)
    if status >= 400:
        raise AutomatorError(f"HTTP {status} while requesting {path}")
    return data


@mcp.tool()
async def get_inbox_threads(limit: str = "50") -> str:
    """Get video team inbox threads with email content and metadata."""
    logger.info("Fetching inbox threads with limit %s", limit)
    try:
        limit_int = int(limit) if limit.strip() else 50
    except ValueError:
        limit_int = 50

    try:
        data = await _json_request("GET", "/videoteammsg/inbox", params={"limit": limit_int})
        if isinstance(data, list):
            data = data[:limit_int]
        elif isinstance(data, dict) and "data" in data:
            data["data"] = data["data"][:limit_int]
        return _success({"threads": data, "limit": limit_int})
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def get_thread_details(thread_id: str = "") -> str:
    """Get detailed thread information including email content and attachments."""
    if not thread_id.strip():
        return _failure("Thread ID is required")

    logger.info("Fetching thread details for %s", thread_id)
    try:
        data = await _json_request("GET", f"/videoteammsg/inbox/{thread_id}")
        return _success({"thread": data})
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def get_assignment_modal_data(thread_id: str = "") -> str:
    """Get assignment modal data including available editors, status and stage options."""
    if not thread_id.strip():
        return _failure("Thread ID is required")

    logger.info("Fetching assignment modal data for %s", thread_id)
    try:
        data = await _json_request("GET", f"/videoteammsg/inbox/{thread_id}/assignprefetch")
        return _success({"modal": data})
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def assign_thread(thread_id: str = "", assignee: str = "Jerami Singleton", status: str = "INBOX", stage: str = "Editing") -> str:
    """Assign a thread to an editor with status and stage (locks player to assignee)."""
    if not thread_id.strip():
        return _failure("Thread ID is required")

    logger.info("Assigning thread %s to %s with status %s, stage %s", thread_id, assignee, status, stage)
    payload = {
        "thread_id": thread_id,
        "assignee": assignee,
        "status": status,
        "stage": stage,
        "_token": ""
    }
    try:
        await automator.ensure_login()
        csrf = automator.get_csrf_token()
        if csrf:
            payload["_token"] = csrf
        data, status_code = await automator.request_json(
            "POST",
            "/videoteammsg/inbox/assign",
            payload=payload,
        )
        if status_code >= 400:
            raise AutomatorError(f"HTTP {status_code} while assigning thread")
        return _success(
            {
                "thread_id": thread_id,
                "assignee": assignee,
                "status": status,
                "stage": stage,
                "response": data,
            }
        )
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def search_player(query: str = "") -> str:
    """Search for players by name, email, or ID for assignment purposes."""
    if not query.strip():
        return _failure("Search query is required")

    logger.info("Searching for player: %s", query)
    params = {
        "first_name": "",
        "last_name": "",
        "email": "",
        "sport": "0",
        "states": "0",
        "athlete_school": "0",
        "editorassigneddatefrom": "",
        "editorassigneddateto": "",
        "grad_year": "",
        "select_club_sport": "",
        "select_club_state": "",
        "select_club_name": "",
        "video_editor": "",
        "video_progress": "",
        "video_progress_stage": "",
        "video_progress_status": "",
        "search": query
    }
    try:
        data = await _json_request("GET", "/videoteammsg/videoprogress", params=params)
        return _success({"query": query, "results": data})
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def get_my_assignments(assignee: str = "Jerami Singleton") -> str:
    """Get current assignments for a specific editor."""
    logger.info("Fetching assignments for %s", assignee)
    params = {
        "first_name": "",
        "last_name": "",
        "email": "",
        "sport": "0",
        "states": "0",
        "athlete_school": "0",
        "editorassigneddatefrom": "",
        "editorassigneddateto": "",
        "grad_year": "",
        "select_club_sport": "",
        "select_club_state": "",
        "select_club_name": "",
        "video_editor": assignee,
        "video_progress": "",
        "video_progress_stage": "",
        "video_progress_status": ""
    }
    try:
        data = await _json_request("GET", "/videoteammsg/videoprogress", params=params)
        return _success({"assignee": assignee, "results": data})
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def check_inbox_updates() -> str:
    """Check for new inbox messages and return summary of unassigned items."""
    logger.info("Checking for inbox updates")
    try:
        data = await _json_request("GET", "/videoteammsg/inbox")
        unassigned_count = 0
        recent_items = []
        if isinstance(data, list):
            for item in data:
                if not item.get("assigned", False):
                    unassigned_count += 1
                    recent_items.append({
                        "id": item.get("id"),
                        "player_name": item.get("player_name"),
                        "sport": item.get("sport"),
                        "created_at": item.get("created_at")
                    })
        summary = {
            "unassigned_count": unassigned_count,
            "recent_unassigned": recent_items[:5],
            "last_checked": datetime.now(timezone.utc).isoformat()
        }
        return _success(summary)
    except AutomatorError as exc:
        logger.error("Automation error: %s", exc)
        return _failure(str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return _failure(str(exc))


# === SERVER STARTUP ===
if __name__ == "__main__":
    logger.info("Starting NPID Video Team MCP server (Playwright mode)...")
    try:
        asyncio.run(automator.ensure_login())
    except AutomatorError as exc:
        logger.warning("Playwright authentication not ready: %s", exc)
    except RuntimeError:
        logger.debug("Event loop already running; skipping eager login")

    try:
        mcp.run(transport='stdio')
    except Exception as exc:  # noqa: BLE001
        logger.error("Server error: %s", exc, exc_info=True)
        sys.exit(1)
