#!/usr/bin/env python3
"""
Simplified NPID automation interface
No MCP wrapper - just exposes functions that can be called directly
"""
import asyncio
import json
import sys
from npid_automator_complete import get_automator

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

async def get_video_progress():
    """Get video progress data"""
    try:
        result = await automator.get_video_progress_data()
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_athlete_details(player_id):
    """Get athlete details by player ID"""
    try:
        result = await automator.get_athlete_details(player_id)
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def update_video_profile(player_id, youtube_link, season, video_type):
    """Update video profile for specific player"""
    try:
        result = await automator.update_video_profile(
            player_id=player_id,
            youtube_link=youtube_link,
            season=season,
            video_type=video_type
        )
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

# Simple JSON-RPC style interface
async def handle_request(request):
    """Handle a single request"""
    try:
        req = json.loads(request)
        request_id = req.get("id")
        method = req.get("method")
        args = req.get("arguments", {})
        
        result = None
        if method == "get_inbox_threads":
            result = await get_inbox_threads(**args)
        elif method == "get_thread_details":
            result = await get_thread_details(**args)
        elif method == "search_player":
            result = await search_player(**args)
        elif method == "get_assignment_modal_data":
            result = await get_assignment_modal_data(**args)
        elif method == "assign_thread":
            result = await assign_thread(**args)
        elif method == "get_video_progress":
            result = await get_video_progress(**args)
        elif method == "get_athlete_details":
            result = await get_athlete_details(**args)
        elif method == "update_video_profile":
            result = await update_video_profile(**args)
        else:
            result = json.dumps({"status": "error", "message": f"Unknown method: {method}"})
        
        # Parse result and add request ID
        result_obj = json.loads(result)
        result_obj["id"] = request_id
        return json.dumps(result_obj)
    except Exception as e:
        return json.dumps({"id": req.get("id") if 'req' in locals() else None, "status": "error", "message": str(e)})

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
