#!/Users/singleton23/.pyenv/versions/3.12.3/bin/python3
#!/usr/bin/env python3
"""
Simplified NPID automation interface - REST API version
No MCP wrapper - just exposes functions that can be called directly
"""
import asyncio
import json
import sys
import time
from pathlib import Path
from npid_api_client import NPIDAPIClient

CACHE_DIR = Path('/tmp/npid_cache')
CACHE_TTL = 300  # 5 minutes

def get_cache_key(func_name, *args, **kwargs):
    """Generate a cache key from function name and arguments."""
    # Sort kwargs to ensure consistent key
    sorted_kwargs = sorted(kwargs.items())
    return f"{func_name}_{json.dumps(args)}_{json.dumps(sorted_kwargs)}"

def read_cache(key):
    """Read data from cache if it exists and is not expired."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / key
    if cache_file.exists():
        try:
            cached_data = json.loads(cache_file.read_text())
            if time.time() - cached_data.get('timestamp', 0) < CACHE_TTL:
                return cached_data.get('data')
        except (json.JSONDecodeError, IOError):
            pass
    return None

def write_cache(key, data):
    """Write data to cache."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / key
    try:
        cache_file.write_text(json.dumps({
            'timestamp': time.time(),
            'data': data
        }))
    except IOError:
        pass


# Initialize REST API client (reuses session)
api_client = None

def get_client():
    """Get a singleton NPIDAPIClient instance"""
    global api_client
    if api_client is None:
        api_client = NPIDAPIClient()
    return api_client

async def get_inbox_threads(limit="50"):
    """Get inbox threads"""
    cache_key = get_cache_key('get_inbox_threads', limit=limit)
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "data": cached_data, "source": "cache"})

    try:
        limit_int = int(limit) if limit.strip() else 50
    except ValueError:
        return json.dumps({"status": "error", "message": "Invalid limit value. Must be an integer."})

    try:
        result = get_client().get_inbox_threads(limit_int)
        write_cache(cache_key, result)
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_thread_details(thread_id):
    """Get thread details"""
    cache_key = get_cache_key('get_thread_details', thread_id=thread_id)
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "thread": cached_data, "source": "cache"})

    try:
        result = get_client().get_thread_details(thread_id)
        write_cache(cache_key, result)
        return json.dumps({"status": "ok", "thread": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def search_player(query):
    """Search for player"""
    cache_key = get_cache_key('search_player', query=query)
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "results": cached_data, "source": "cache"})

    try:
        result = get_client().search_player(query)
        write_cache(cache_key, result)
        return json.dumps({"status": "ok", "results": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_assignment_modal_data(thread_id=None, contact_id=None):
    """Get assignment modal data"""
    cache_key = get_cache_key('get_assignment_modal_data', thread_id=thread_id, contact_id=contact_id)
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "modal": cached_data, "source": "cache"})

    try:
        result = get_client().get_assignment_modal_data(
            thread_id=thread_id,
            contact_id=contact_id
        )
        write_cache(cache_key, result)
        return json.dumps({"status": "ok", "modal": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def assign_thread(thread_id, assignee, status=None, stage=None, contact_id=None):
    """Assign thread"""
    try:
        result = get_client().assign_thread(
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
    cache_key = get_cache_key('get_video_progress')
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "data": cached_data, "source": "cache"})

    try:
        result = get_client().get_video_progress_data()
        write_cache(cache_key, result)
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_athlete_details(player_id):
    """Get athlete details including athlete_main_id from profile URL"""
    cache_key = get_cache_key('get_athlete_details', player_id=player_id)
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "data": cached_data, "source": "cache"})

    try:
        result = get_client().get_athlete_details(player_id)
        write_cache(cache_key, result)
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def update_video_profile(player_id, youtube_link, season, video_type):
    """Update video profile for specific player"""
    try:
        result = get_client().update_video_profile(
            player_id=player_id,
            youtube_link=youtube_link,
            season=season,
            video_type=video_type
        )
        return json.dumps({"status": "ok", "data": result})
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)})

async def get_video_seasons(athlete_id: str, sport_alias: str, video_type: str, athlete_main_id: str):
    """Get available video seasons for a player."""
    cache_key = get_cache_key('get_video_seasons', athlete_id=athlete_id, sport_alias=sport_alias, video_type=video_type, athlete_main_id=athlete_main_id)
    cached_data = read_cache(cache_key)
    if cached_data:
        return json.dumps({"status": "ok", "data": cached_data, "source": "cache"})

    try:
        result = get_client().get_video_seasons(
            athlete_id=athlete_id,
            sport_alias=sport_alias,
            video_type=video_type,
            athlete_main_id=athlete_main_id
        )
        write_cache(cache_key, result)
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
            result = get_inbox_threads(**args)
        elif method == "get_thread_details":
            result = get_thread_details(**args)
        elif method == "search_player":
            result = search_player(**args)
        elif method == "get_assignment_modal_data":
            result = get_assignment_modal_data(**args)
        elif method == "assign_thread":
            result = assign_thread(**args)
        elif method == "get_video_progress":
            result = get_video_progress(**args)
        elif method == "get_athlete_details":
            result = get_athlete_details(**args)
        elif method == "update_video_profile":
            result = update_video_profile(**args)
        elif method == "get_video_seasons":
            result = get_video_seasons(**args)
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
            
            response = handle_request(line.strip())
            print(response, flush=True)
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
