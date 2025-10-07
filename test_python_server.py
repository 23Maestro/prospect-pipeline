#!/usr/bin/env python3
"""Test the Python server directly"""
import asyncio
import json
import sys
import os

# Add to path
sys.path.insert(0, '/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native')

from npid_automator_complete import get_automator

async def test_inbox():
    """Test getting inbox"""
    print("Starting test...", file=sys.stderr)
    automator = get_automator()
    
    try:
        print("Getting inbox threads...", file=sys.stderr)
        result = await automator.get_inbox_threads(5)
        print("Got result:", json.dumps(result, indent=2), file=sys.stderr)
        print(json.dumps({"status": "ok", "threads": result}))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"status": "error", "message": str(e)}))
    finally:
        await automator.close()

if __name__ == "__main__":
    asyncio.run(test_inbox())
