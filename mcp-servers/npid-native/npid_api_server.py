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
    """
    Create an NpidApiClient configured from environment variables.
    
    Reads the following environment variables to configure the client:
    - NPID_BASE_URL
    - NPID_USERNAME
    - NPID_PASSWORD
    - NPID_SESSION_PATH
    - NPID_TIMEOUT (defaults to 30 seconds if unset)
    
    Returns:
        NpidApiClient: Client configured with values sourced from the environment.
    """
    return NpidApiClient(
        base_url=os.environ.get("NPID_BASE_URL"),
        username=os.environ.get("NPID_USERNAME"),
        password=os.environ.get("NPID_PASSWORD"),
        session_path=os.environ.get("NPID_SESSION_PATH"),
        timeout_seconds=int(os.environ.get("NPID_TIMEOUT", "30")),
    )


def ok(id_value: Any, data: Any) -> str:
    """
    Format a successful JSON-RPC response line containing the given request id and payload.
    
    Parameters:
        id_value (Any): The request identifier to include in the response `id` field.
        data (Any): The response payload to include in the `data` field.
    
    Returns:
        json_str (str): A JSON-encoded string with keys `id`, `status` set to `"ok"`, and `data`; encoding uses ensure_ascii=False.
    """
    return json.dumps({"id": id_value, "status": "ok", "data": data}, ensure_ascii=False)


def err(id_value: Any, message: str) -> str:
    """
    Format an error response for the JSON-RPC-over-stdio protocol as a single-line JSON string.
    
    Parameters:
        id_value: The request identifier to include in the response (may be None).
        message (str): Human-readable error message to include.
    
    Returns:
        str: A JSON string containing `id`, `status` set to `"error"`, and `message`. ensure_ascii is disabled.
    """
    return json.dumps({"id": id_value, "status": "error", "message": message}, ensure_ascii=False)


def handle_request(raw: str) -> str:
    """
    Handle a single JSON-RPC request (one JSON object per line) and produce a single-line JSON response string.
    
    Parameters:
        raw (str): A single-line JSON string with shape {"id": any, "method": str, "arguments": dict}. Supported methods: "login", "get_inbox_threads", "get_thread_details", "get_assignment_modal_data", "assign_thread", "search_player", "resolve_contacts". Required argument keys vary by method and missing required arguments yield an error response.
    
    Returns:
        str: A JSON-formatted string representing the response object. On success the response has shape {"id": <id>, "status": "ok", "data": ...}; on error it has shape {"id": <id>, "status": "error", "message": "<error message>"}.
    """
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
    """
    Process newline-delimited JSON-RPC requests from standard input and emit single-line JSON responses to standard output.
    
    Reads each non-empty input line as a request, obtains a single-line JSON response for it, prints the response, and flushes stdout immediately.
    """
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        response = handle_request(line)
        print(response, flush=True)


if __name__ == "__main__":
    main()