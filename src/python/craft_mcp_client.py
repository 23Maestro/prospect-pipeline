#!/usr/bin/env python3
"""
Minimal Craft MCP client bridge for Raycast.
Implements reminder upsert using MCP tools only:
 - blocks_get
 - blocks_add
 - blocks_update
"""

import asyncio
import json
import sys
from typing import Any, Dict, Generator, List, Optional, Tuple

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def _iter_blocks(obj: Any) -> Generator[Dict[str, Any], None, None]:
    if isinstance(obj, dict):
        if "id" in obj and "type" in obj:
            yield obj
        for value in obj.values():
            yield from _iter_blocks(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from _iter_blocks(item)


def _extract_text_content(tool_result: Any) -> str:
    content = getattr(tool_result, "content", None) or []
    for item in content:
        text = getattr(item, "text", None)
        if isinstance(text, str) and text:
            return text
    return ""


def _parse_tool_payload(tool_result: Any) -> Any:
    structured = getattr(tool_result, "structuredContent", None)
    if structured is not None:
        return structured
    text = _extract_text_content(tool_result)
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text


def _find_existing_block_id(payload: Any, markers: List[str]) -> Optional[str]:
    for block in _iter_blocks(payload):
        markdown = str(block.get("markdown") or "")
        for marker in markers:
            if f"[{marker}]" in markdown or f"<!-- {marker} -->" in markdown:
                block_id = block.get("id")
                if block_id:
                    return str(block_id)
    return None


def _normalize_task_markdown(markdown: str) -> str:
    text = markdown.strip()
    if text.startswith("- [ ]"):
        text = text[5:].strip()
    return " ".join(text.split())


def _find_existing_block_by_athlete_and_schedule(
    payload: Any, athlete_name: str, schedule_date: str
) -> Optional[str]:
    normalized_athlete = " ".join((athlete_name or "").split()).strip().lower()
    if not normalized_athlete:
        return None

    for block in _iter_blocks(payload):
        markdown = str(block.get("markdown") or "")
        task_info = block.get("taskInfo") or {}
        existing_schedule = str(task_info.get("scheduleDate") or "").strip()
        if existing_schedule != schedule_date:
            continue
        normalized_markdown = _normalize_task_markdown(markdown).lower()
        if normalized_markdown == normalized_athlete:
            block_id = block.get("id")
            if block_id:
                return str(block_id)
    return None


def _find_first_id(payload: Any) -> Optional[str]:
    for block in _iter_blocks(payload):
        block_id = block.get("id")
        if block_id:
            return str(block_id)
    return None


async def _upsert_reminder(args: Dict[str, Any]) -> Dict[str, Any]:
    mcp_url = str(args.get("mcp_url") or "").strip()
    document_id = str(args.get("document_id") or "").strip()
    markdown = str(args.get("markdown") or "")
    markers = [str(m).strip() for m in (args.get("markers") or []) if str(m).strip()]
    schedule_date = str(args.get("schedule_date") or "").strip()
    athlete_name = str(args.get("athlete_name") or "").strip()
    password = str(args.get("password") or "").strip()

    if not mcp_url:
        return {"success": False, "error": "missing mcp_url"}
    if not document_id:
        return {"success": False, "error": "missing document_id"}
    if not markdown:
        return {"success": False, "error": "missing markdown"}
    if not markers:
        return {"success": False, "error": "missing markers"}
    if not schedule_date:
        return {"success": False, "error": "missing schedule_date"}

    request_url = mcp_url
    if password:
        sep = "&" if "?" in request_url else "?"
        request_url = f"{request_url}{sep}password={password}"

    async with streamablehttp_client(request_url) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()

            get_result = await session.call_tool(
                "blocks_get",
                arguments={"id": document_id, "format": "json"},
            )
            payload = _parse_tool_payload(get_result)
            matched_block_id = _find_existing_block_id(payload, markers)
            if not matched_block_id:
                matched_block_id = _find_existing_block_by_athlete_and_schedule(
                    payload, athlete_name, schedule_date
                )

            if matched_block_id:
                await session.call_tool(
                    "blocks_update",
                    arguments={
                        "blocks": [
                            {
                                "id": matched_block_id,
                                "markdown": markdown,
                                "listStyle": "task",
                                "taskInfo": {"scheduleDate": schedule_date},
                            }
                        ]
                    },
                )
                return {
                    "success": True,
                    "operation": "update",
                    "document_id": document_id,
                    "matched_block_id": matched_block_id,
                }

            add_result = await session.call_tool(
                "blocks_add",
                arguments={
                    "blocks": [
                        {
                            "type": "text",
                            "markdown": markdown,
                            "listStyle": "task",
                            "taskInfo": {"scheduleDate": schedule_date},
                        }
                    ],
                    "position": {"position": "end", "pageId": document_id},
                },
            )
            created_payload = _parse_tool_payload(add_result)
            created_block_id = _find_first_id(created_payload)
            return {
                "success": True,
                "operation": "create",
                "document_id": document_id,
                "created_block_id": created_block_id,
            }


def main() -> None:
    method = sys.argv[1] if len(sys.argv) > 1 else ""
    raw_args = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        args = json.loads(raw_args)
    except Exception:
        args = {}

    try:
        if method == "upsert_reminder":
            result = asyncio.run(_upsert_reminder(args))
            print(json.dumps(result))
            return
        print(json.dumps({"success": False, "error": f"unknown method: {method}"}))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))


if __name__ == "__main__":
    main()
