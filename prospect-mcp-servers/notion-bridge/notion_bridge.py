#!/usr/bin/env python3
"""HTTP bridge for Scout Notion MCP server with JSON-RPC 2.0 support."""
import asyncio
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Awaitable, Callable, Dict

import notion_server

PORT = 8813

logger = logging.getLogger("notion-bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

TOOL_MAP: Dict[str, Callable[..., Awaitable[Any]]] = {
    "query_database": notion_server.query_database,
    "create_page": notion_server.create_page,
    "update_page": notion_server.update_page,
    "get_page": notion_server.get_page,
    "search_pages": notion_server.search_pages,
}


def run_async(func: Callable[..., Awaitable[Any]], **kwargs: Any) -> Any:
    """Run an async MCP tool in a fresh event loop and return the result."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(func(**kwargs))
    finally:
        loop.close()


class MCPBridgeHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path == "/mcp":
            self._handle_mcp_protocol()
        elif self.path == "/mcp-call":
            self._handle_simple_http()
        else:
            self.send_error(404, "Unknown path")

    def _handle_mcp_protocol(self) -> None:
        """Handle JSON-RPC 2.0 MCP protocol requests."""
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            request = json.loads(raw_body.decode("utf-8"))
            
            method = request.get("method")
            params = request.get("params", {})
            request_id = request.get("id")

            if method == "tools/list":
                tools = []
                for tool_name in TOOL_MAP.keys():
                    tools.append({
                        "name": tool_name,
                        "description": f"Execute {tool_name}",
                        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": True}
                    })
                response = {"jsonrpc": "2.0", "id": request_id, "result": {"tools": tools}}
            
            elif method == "tools/call":
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                
                if tool_name not in TOOL_MAP:
                    response = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}}
                else:
                    logger.info("%s called with %s", tool_name, arguments)
                    result = run_async(TOOL_MAP[tool_name], **arguments)
                    response = {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": result}]}}
            else:
                response = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Unknown method: {method}"}}

            body = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            
        except Exception as exc:
            logger.exception("MCP protocol error")
            error_response = {"jsonrpc": "2.0", "id": request.get("id") if 'request' in locals() else None, "error": {"code": -32603, "message": str(exc)}}
            body = json.dumps(error_response).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def _handle_simple_http(self) -> None:
        """Handle simple HTTP POST requests (legacy /mcp-call endpoint)."""
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            tool_name = payload.get("tool")
            arguments = payload.get("arguments", {})

            if tool_name not in TOOL_MAP:
                raise ValueError(f"Unknown tool '{tool_name}'")

