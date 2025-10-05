#!/usr/bin/env python3
"""Scout Notion MCP Server - All Notion API tools for ID Tasks database."""
import json
import logging
import os
import sys
from datetime import datetime, timezone

from mcp.server.fastmcp import FastMCP
from notion_client import Client
from notion_client.errors import APIResponseError

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger("notion-server")

mcp = FastMCP("notion")

NOTION_TOKEN = os.environ.get("NOTION_API_TOKEN", "")
notion = Client(auth=NOTION_TOKEN) if NOTION_TOKEN else None


def _success(payload):
    return json.dumps({"status": "ok", "data": payload}, ensure_ascii=False)


def _failure(message):
    return json.dumps({"status": "error", "message": message}, ensure_ascii=False)


@mcp.tool()
async def query_database(database_id: str = "", filter_json: str = "", sorts_json: str = "") -> str:
    """Query Notion database with filters and sorts - returns formatted task list."""
    if not notion:
        return _failure("NOTION_API_TOKEN not configured")
    
    if not database_id.strip():
        return _failure("database_id is required")
    
    logger.info(f"Querying database {database_id}")
    
    try:
        query_params = {"database_id": database_id.replace("-", "")}
        
        if filter_json.strip():
            query_params["filter"] = json.loads(filter_json)
        
        if sorts_json.strip():
            query_params["sorts"] = json.loads(sorts_json)
        
        response = notion.databases.query(**query_params)
        
        tasks = []
        for page in response.get("results", []):
            props = page.get("properties", {})
            task = {
                "id": page["id"],
                "url": page["url"],
                "name": props.get("Name", {}).get("title", [{}])[0].get("plain_text", ""),
                "status": props.get("Status", {}).get("status", {}).get("name", ""),
                "sport": [s["name"] for s in props.get("Sport", {}).get("multi_select", [])],
                "class": props.get("Class", {}).get("select", {}).get("name", ""),
                "due_date": props.get("Due Date", {}).get("date", {}).get("start", ""),
                "player_id": props.get("PlayerID", {}).get("url", "")
            }
            tasks.append(task)
        
        return _success({"tasks": tasks, "count": len(tasks)})
    
    except APIResponseError as exc:
        logger.error(f"Notion API error: {exc}")
        return _failure(f"Notion API error: {exc}")
    except json.JSONDecodeError as exc:
        return _failure(f"Invalid JSON in filter or sorts: {exc}")
    except Exception as exc:
        logger.error(f"Unexpected error: {exc}", exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def create_page(parent_id: str = "", title: str = "", properties_json: str = "") -> str:
    """Create new page in Notion database with properties."""
    if not notion:
        return _failure("NOTION_API_TOKEN not configured")
    
    if not parent_id.strip() or not title.strip():
        return _failure("parent_id and title are required")
    
    logger.info(f"Creating page in {parent_id}")
    
    try:
        page_data = {
            "parent": {"database_id": parent_id.replace("-", "")},
            "properties": {
                "Name": {"title": [{"text": {"content": title}}]}
            }
        }
        
        if properties_json.strip():
            additional_props = json.loads(properties_json)
            page_data["properties"].update(additional_props)
        
        result = notion.pages.create(**page_data)
        
        return _success({
            "page_id": result["id"],
            "url": result["url"],
            "title": title
        })
    
    except APIResponseError as exc:
        logger.error(f"Notion API error: {exc}")
        return _failure(f"Notion API error: {exc}")
    except json.JSONDecodeError as exc:
        return _failure(f"Invalid JSON in properties: {exc}")
    except Exception as exc:
        logger.error(f"Unexpected error: {exc}", exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def update_page(page_id: str = "", properties_json: str = "") -> str:
    """Update properties of existing Notion page."""
    if not notion:
        return _failure("NOTION_API_TOKEN not configured")
    
    if not page_id.strip() or not properties_json.strip():
        return _failure("page_id and properties_json are required")
    
    logger.info(f"Updating page {page_id}")
    
    try:
        properties = json.loads(properties_json)
        result = notion.pages.update(
            page_id=page_id.replace("-", ""),
            properties=properties
        )
        
        return _success({
            "page_id": result["id"],
            "url": result["url"],
            "updated": True
        })
    
    except APIResponseError as exc:
        logger.error(f"Notion API error: {exc}")
        return _failure(f"Notion API error: {exc}")
    except json.JSONDecodeError as exc:
        return _failure(f"Invalid JSON in properties: {exc}")
    except Exception as exc:
        logger.error(f"Unexpected error: {exc}", exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def get_page(page_id: str = "") -> str:
    """Get full details of a Notion page including all properties."""
    if not notion:
        return _failure("NOTION_API_TOKEN not configured")
    
    if not page_id.strip():
        return _failure("page_id is required")
    
    logger.info(f"Fetching page {page_id}")
    
    try:
        page = notion.pages.retrieve(page_id=page_id.replace("-", ""))
        return _success({"page": page})
    
    except APIResponseError as exc:
        logger.error(f"Notion API error: {exc}")
        return _failure(f"Notion API error: {exc}")
    except Exception as exc:
        logger.error(f"Unexpected error: {exc}", exc_info=True)
        return _failure(str(exc))


@mcp.tool()
async def search_pages(query: str = "", filter_value: str = "page") -> str:
    """Search across all Notion pages and databases by title or content."""
    if not notion:
        return _failure("NOTION_API_TOKEN not configured")
    
    if not query.strip():
        return _failure("query is required")
    
    logger.info(f"Searching for: {query}")
    
    try:
        search_params = {"query": query}
        
        if filter_value in ["page", "database"]:
            search_params["filter"] = {"value": filter_value, "property": "object"}
        
        response = notion.search(**search_params)
        
        results = []
        for item in response.get("results", []):
            results.append({
                "id": item["id"],
                "type": item["object"],
                "url": item["url"],
                "title": item.get("properties", {}).get("title", {}).get("title", [{}])[0].get("plain_text", "")
                    if item["object"] == "page" else item.get("title", [{}])[0].get("plain_text", "")
            })
        
        return _success({"results": results, "count": len(results)})
    
    except APIResponseError as exc:
        logger.error(f"Notion API error: {exc}")
        return _failure(f"Notion API error: {exc}")
    except Exception as exc:
        logger.error(f"Unexpected error: {exc}", exc_info=True)
        return _failure(str(exc))


if __name__ == "__main__":
    logger.info("Starting Notion MCP server...")
    
    if not NOTION_TOKEN:
        logger.warning("NOTION_API_TOKEN not set")
    
    try:
        mcp.run(transport='stdio')
    except Exception as exc:
        logger.error(f"Server error: {exc}", exc_info=True)
        sys.exit(1)
