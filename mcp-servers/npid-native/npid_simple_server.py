#!/usr/bin/env python3
"""
Simplified NPID automation interface
No MCP wrapper - just exposes functions that can be called directly
"""
import asyncio
import json
import sys
from npid_automator import get_automator

automator = get_automator()

async def get_inbox_threads(limit="50"):
    """Get inbox threads"""
    try:
        result = await automator.get_inbox_threads(int(limit))
        return json.dumps({"status": "ok", "threads": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_thread_details(thread_id):
    """Get thread details"""
    try:
        result = await automator.get_thread_details(thread_id)
        return json.dumps({"status": "ok", "thread": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def search_player(query):
    """Search for player"""
    try:
        result = await automator.search_player(query)
        return json.dumps({"status": "ok", "results": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_assignment_modal_data(thread_id=None, contact_id=None):
    """Get assignment modal data"""
    try:
        result = await automator.get_assignment_modal_data(
            thread_id=thread_id,
            contact_id=contact_id
        )
        return json.dumps({"status": "ok", "modal": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def assign_thread(thread_id, assignee, status=None, stage=None, contact_id=None):
    """Assign thread"""
    try:
        result = await automator.assign_thread(
            thread_id=thread_id,
            assignee=assignee,
            status=status,
            stage=stage,
            contact_id=contact_id
        )
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

# Simple JSON-RPC style interface
async def handle_request(request):
    """Handle a single request"""
    try:
        req = json.loads(request)
        method = req.get("method")
        args = req.get("arguments", {})
        
        if method == "get_inbox_threads":
            return await get_inbox_threads(**args)
        elif method == "get_thread_details":
            return await get_thread_details(**args)
        elif method == "search_player":
            return await search_player(**args)
        elif method == "get_assignment_modal_data":
            return await get_assignment_modal_data(**args)
        elif method == "assign_thread":
            return await assign_thread(**args)
        else:
            return json.dumps({"status": "error", "message": f"Unknown method: {method}"})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def main():
    """Read JSON requests from stdin, write responses to stdout"""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            
            response = await handle_request(line.strip())
            print(response, flush=True)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
