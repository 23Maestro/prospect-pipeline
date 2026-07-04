#!/usr/bin/env python3

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Update Video Status
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 🎬
# @raycast.argument1 { "type": "text", "placeholder": "First Name" }
# @raycast.argument2 { "type": "text", "placeholder": "Last Name" }
# @raycast.argument3 { "type": "dropdown", "placeholder": "Status", "data": [{"title": "Revisions", "value": "Revisions"}, {"title": "HUDL", "value": "HUDL"}, {"title": "Dropbox", "value": "Dropbox"}, {"title": "External Links", "value": "External Links"}, {"title": "Not Approved", "value": "Not Approved"}] }
# @raycast.packageName Prospect ID Pipeline

# Documentation:
# @raycast.description Search athlete and update video status
# @raycast.author Primary Operator
# @raycast.authorURL https://raycast.com/primary-operator

import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root / "src" / "python"))

from npid_api_client import NPIDAPIClient

def main():
    if len(sys.argv) < 4:
        print("❌ Usage: update-video-status.py <first_name> <last_name> <status>")
        sys.exit(1)

    first_name = sys.argv[1].strip()
    last_name = sys.argv[2].strip()
    status = sys.argv[3].strip()

    # Validate status
    valid_statuses = ["Revisions", "HUDL", "Dropbox", "External Links", "Not Approved"]
    if status not in valid_statuses:
        print(f"❌ Invalid status. Must be one of: {', '.join(valid_statuses)}")
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

    # Update status
    print(f"📝 Updating status to '{status}' for {athlete['athletename']}...")
    result = client.update_video_status(
        video_msg_id=str(video_msg_id),
        status=status
    )

    if result.get("success"):
        print(f"✅ Status updated to '{status}' for {athlete['athletename']}")
    else:
        error_msg = result.get("message") or result.get("error", "Unknown error")
        print(f"❌ Failed to update status: {error_msg}")
        sys.exit(1)

if __name__ == "__main__":
    main()
