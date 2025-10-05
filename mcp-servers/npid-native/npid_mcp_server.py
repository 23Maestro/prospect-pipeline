#!/usr/bin/env python3
"""Native MCP server for NPID using Stdio communication."""
import asyncio
import json
import logging
import sys
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Import the existing automation
import npid_server

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("npid-mcp-native")

# Create MCP server
app = Server("scout-npid")

# Define tools
@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available NPID tools."""
    return [
        Tool(
            name="get_inbox_threads",
            description="Get inbox threads from NPID video team inbox",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "string",
                        "description": "Maximum number of threads to return",
                        "default": "50"
                    }
                }
            }
        ),
        Tool(
            name="get_thread_details",
            description="Get details for a specific inbox thread",
            inputSchema={
                "type": "object",
                "properties": {
                    "thread_id": {
                        "type": "string",
                        "description": "The ID of the thread to fetch details for"
                    }
                },
                "required": ["thread_id"]
            }
        ),
        Tool(
            name="assign_thread",
            description="Assign a thread to an owner with status and stage",
            inputSchema={
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string"},
                    "assignee": {"type": "string"},
                    "status": {"type": "string"},
                    "stage": {"type": "string"},
                    "contact_id": {"type": "string"}
                },
                "required": ["thread_id", "assignee"]
            }
        ),
        Tool(
            name="search_player",
            description="Search for players in NPID",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for player name"
                    }
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="get_assignment_modal_data",
            description="Get data for assignment modal",
            inputSchema={
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string"},
                    "contact_id": {"type": "string"}
                }
            }
        ),
    ]

@app.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    """Execute a tool and return results."""
    try:
        logger.info(f"Calling tool: {name} with args: {arguments}")
        
        # Map tool names to functions
        tool_map = {
            "get_inbox_threads": npid_server.get_inbox_threads,
            "get_thread_details": npid_server.get_thread_details,
            "assign_thread": npid_server.assign_thread,
            "search_player": npid_server.search_player,
            "get_assignment_modal_data": npid_server.get_assignment_modal_data,
        }
        
        if name not in tool_map:
            raise ValueError(f"Unknown tool: {name}")
        
        # Call the appropriate function
        result = await tool_map[name](**arguments)
        
        # Return result as TextContent
        return [TextContent(
            type="text",
            text=json.dumps(result) if not isinstance(result, str) else result
        )]
        
    except Exception as e:
        logger.exception(f"Tool execution failed: {e}")
        return [TextContent(
            type="text",
            text=json.dumps({
                "status": "error",
                "message": str(e)
            })
        )]

async def main():
    """Run the MCP server using Stdio transport."""
    logger.info("Starting NPID MCP server (native, stdio)")
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())
