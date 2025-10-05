#!/usr/bin/env python3
"""HTTP bridge for the Scout NPID MCP server with JSON-RPC 2.0 support."""
import asyncio
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Awaitable, Callable, Dict

import npid_server  # noqa: F401 - ensures global automator is initialised

PORT = 8812

logger = logging.getLogger("npid-bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Map tool names to the async functions defined in npid_server
TOOL_MAP: Dict[str, Callable[..., Awaitable[Any]]] = {
    "get_inbox_threads": npid_server.get_inbox_threads,
    "get_thread_details": npid_server.get_thread_details,
    "get_assignment_modal_data": npid_server.get_assignment_modal_data,
    "assign_thread": npid_server.assign_thread,
    "search_player": npid_server.search_player,
    "get_my_assignments": npid_server.get_my_assignments,
    "check_inbox_updates": npid_server.check_inbox_updates,
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
    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
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
                # Return list of available tools
                tools = []
                for tool_name in TOOL_MAP.keys():
                    tools.append({
                        "name": tool_name,
                        "description": f"Execute {tool_name}",
                        "inputSchema": {
                            "type": "object",
                            "properties": {},
                            "additionalProperties": True
                        }
                    })
                
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {"tools": tools}
                }
            
            elif method == "tools/call":
                # Execute a tool
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                
                if tool_name not in TOOL_MAP:
                    response = {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {
                            "code": -32601,
                            "message": f"Unknown tool: {tool_name}"
                        }
                    }
                else:
                    logger.info("%s called with %s", tool_name, arguments)
                    result = run_async(TOOL_MAP[tool_name], **arguments)
                    
                    response = {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": result
                                }
                            ]
                        }
                    }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32601,
                        "message": f"Unknown method: {method}"
                    }
                }

            body = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            
        except Exception as exc:  # noqa: BLE001
            logger.exception("MCP protocol error")
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {
                    "code": -32603,
                    "message": str(exc)
                }
            }
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

            logger.info("%s called with %s", tool_name, arguments)
            result = run_async(TOOL_MAP[tool_name], **arguments)

            response = {
                "success": True,
                "data": result,
            }
            body = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001
            logger.exception("MCP tool invocation failed")
            response = {
                "success": False,
                "error": str(exc),
            }
            body = json.dumps(response).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: D401
        # Suppress default access logging; we already log important events.
        return


def main() -> None:
    logger.info("Scout NPID MCP bridge listening on http://0.0.0.0:%s", PORT)
    logger.info("  - /mcp endpoint: JSON-RPC 2.0 MCP protocol")
    logger.info("  - /mcp-call endpoint: Simple HTTP POST")
    httpd = HTTPServer(("0.0.0.0", PORT), MCPBridgeHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down NPID MCP bridge")
        httpd.shutdown()


if __name__ == "__main__":
    main()
