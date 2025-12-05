#!/usr/bin/env python3

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Update Video Stage
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 📊
# @raycast.argument1 { "type": "text", "placeholder": "First Name" }
# @raycast.argument2 { "type": "text", "placeholder": "Last Name" }
# @raycast.argument3 { "type": "dropdown", "placeholder": "Stage", "data": [{"title": "On Hold", "value": "On Hold"}, {"title": "Awaiting Client", "value": "Awaiting Client"}, {"title": "In Queue", "value": "In Queue"}, {"title": "Done", "value": "Done"}] }
# @raycast.packageName Prospect ID Pipeline

# Documentation:
# @raycast.description Search athlete and update video stage
# @raycast.author jerami_singleton
# @raycast.authorURL https://raycast.com/jerami_singleton

import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root / "src" / "python"))

from npid_api_client import NPIDAPIClient

def main():
    if len(sys.argv) < 4:
        print("❌ Usage: update-video-stage.py <first_name> <last_name> <stage>")
        sys.exit(1)

    first_name = sys.argv[1].strip()
    last_name = sys.argv[2].strip()
    stage = sys.argv[3].strip()

    # Validate stage
    valid_stages = ["On Hold", "Awaiting Client", "In Queue", "Done"]
    if stage not in valid_stages:
        print(f"❌ Invalid stage. Must be one of: {', '.join(valid_stages)}")
        sys.exit(1)

    # Initialize client (uses cached session from ~/.npid_session.pkl)
    client = NPIDAPIClient()

    # Search for athlete
    print(f"🔍 Searching for {first_name} {last_name}...")
    search_results = client.search_video_progress(first_name=first_name, last_name=last_name)

    if not search_results:
        print(f"❌ No results found for {first_name} {last_name}")
        sys.exit(1)

    if len(search_results) > 1:
        print(f"⚠️  Found {len(search_results)} athletes:")
        for i, athlete in enumerate(search_results[:5], 1):
            print(f"  {i}. {athlete['athletename']} - {athlete.get('sport', 'N/A')} ({athlete.get('grad_year', 'N/A')})")
        print("\n💡 Using first match. Be more specific if this is wrong.")

    athlete = search_results[0]
    video_msg_id = athlete.get('id') or athlete.get('video_msg_id')

    if not video_msg_id:
        print(f"❌ No video message ID found for {athlete['athletename']}")
        sys.exit(1)

    # Update stage
    print(f"📝 Updating stage to '{stage}' for {athlete['athletename']}...")
    result = client.update_video_stage(
        video_msg_id=str(video_msg_id),
        stage=stage
    )

    if result.get("success"):
        print(f"✅ Stage updated to '{stage}' for {athlete['athletename']}")
    else:
        error_msg = result.get("message") or result.get("error", "Unknown error")
        print(f"❌ Failed to update stage: {error_msg}")
        sys.exit(1)

if __name__ == "__main__":
    main()
