#!/usr/bin/env python3
"""
NPID API JSON-RPC server over stdio
- Uses NpidApiClient (requests-based) instead of Selenium/Playwright
- Stateless per-call but with persisted cookie jar on disk

Methods:
- login {email, password}
- get_inbox_threads {limit}
- get_thread_details {thread_id}
- get_assignment_modal_data {thread_id}
- assign_thread {thread_id, assignee, status, stage}
- search_player {query}
- resolve_contacts {search, searchfor}

Protocol: each request is a single line JSON: {id, method, arguments}
Response: a single line JSON: {id, status: 'ok'|'error', ...}
"""
from __future__ import annotations

import json
import sys
import logging
import os
from typing import Any, Dict

from npid_api_client import NpidApiClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', stream=sys.stderr)
logger = logging.getLogger("npid-api-server")


def make_client() -> NpidApiClient:
    return NpidApiClient(
        base_url=os.environ.get("NPID_BASE_URL"),
        username=os.environ.get("NPID_USERNAME"),
        password=os.environ.get("NPID_PASSWORD"),
        session_path=os.environ.get("NPID_SESSION_PATH"),
        timeout_seconds=int(os.environ.get("NPID_TIMEOUT", "30")),
    )


def ok(id_value: Any, data: Any) -> str:
    return json.dumps({"id": id_value, "status": "ok", "data": data}, ensure_ascii=False)


def err(id_value: Any, message: str) -> str:
    return json.dumps({"id": id_value, "status": "error", "message": message}, ensure_ascii=False)


def handle_request(raw: str) -> str:
    try:
        req = json.loads(raw)
        req_id = req.get("id")
        method = req.get("method")
        args: Dict[str, Any] = req.get("arguments", {}) or {}

        client = make_client()

        if method == "login":
            result = client.login(email=args.get("email"), password=args.get("password"))
            return ok(req_id, {"success": result.success, "status": result.status, "message": result.message})
        if method == "get_inbox_threads":
            limit = int(str(args.get("limit", "50")) or "50")
            return ok(req_id, client.get_inbox_threads(limit))
        if method == "get_thread_details":
            thread_id = str(args.get("thread_id", ""))
            if not thread_id:
                return err(req_id, "thread_id is required")
            return ok(req_id, client.get_thread_details(thread_id))
        if method == "get_assignment_modal_data":
            thread_id = str(args.get("thread_id", ""))
            if not thread_id:
                return err(req_id, "thread_id is required")
            return ok(req_id, client.get_assignment_modal_data(thread_id))
        if method == "assign_thread":
            thread_id = str(args.get("thread_id", ""))
            assignee = str(args.get("assignee", ""))
            status = str(args.get("status", ""))
            stage = str(args.get("stage", ""))
            if not thread_id or not assignee or not status or not stage:
                return err(req_id, "thread_id, assignee, status, and stage are required")
            return ok(req_id, client.assign_thread(thread_id, assignee, status, stage))
        if method == "search_player":
            query = str(args.get("query", ""))
            if not query:
                return err(req_id, "query is required")
            return ok(req_id, client.search_player(query))
        if method == "resolve_contacts":
            search = str(args.get("search", ""))
            searchfor = str(args.get("searchfor", "athlete"))
            if not search:
                return err(req_id, "search is required")
            return ok(req_id, client.resolve_contacts(search, searchfor))

        return err(req_id, f"Unknown method: {method}")
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to handle request: %s", exc, exc_info=True)
        try:
            req_id = json.loads(raw).get("id")
        except Exception:  # noqa: BLE001
            req_id = None
        return err(req_id, str(exc))


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        response = handle_request(line)
        print(response, flush=True)


if __name__ == "__main__":
    main()
