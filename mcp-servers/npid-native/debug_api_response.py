#!/usr/bin/env python3
"""Debug the actual API response"""

import sys
from npid_api_client import NPIDAPIClient

def debug_response():
    client = NPIDAPIClient()

    # Get a thread first
    print("Fetching threads...", file=sys.stderr)
    threads = client.get_inbox_threads(limit=1, filter_assigned='both')

    if not threads:
        print("No threads found", file=sys.stderr)
        return

    thread = threads[0]
    message_id = thread['id'].replace('message_id', '')
    item_code = thread.get('itemCode', message_id)

    print(f"\nThread ID: {message_id}", file=sys.stderr)
    print(f"Item Code: {item_code}", file=sys.stderr)

    # Make the raw request
    params = {
        'message_id': message_id,
        'itemcode': item_code,
        'type': 'inbox',
        'user_timezone': 'America/New_York',
        'filter_self': 'Me/Un'
    }

    print(f"\nRequest URL: {client.base_url}/rulestemplates/template/videoteammessage_subject", file=sys.stderr)
    print(f"Params: {params}", file=sys.stderr)

    resp = client.session.get(
        f"{client.base_url}/rulestemplates/template/videoteammessage_subject",
        params=params
    )

    print(f"\nStatus: {resp.status_code}", file=sys.stderr)
    print(f"Content-Type: {resp.headers.get('Content-Type')}", file=sys.stderr)
    print(f"Response length: {len(resp.text)}", file=sys.stderr)
    print(f"\nFirst 1000 chars of response:", file=sys.stderr)
    print(repr(resp.text[:1000]), file=sys.stderr)

    # Try to parse as JSON
    try:
        import json
        data = json.loads(resp.text.strip())
        print(f"\n✅ Successfully parsed JSON", file=sys.stderr)
        print(f"Keys in response: {list(data.keys())[:20]}", file=sys.stderr)

        if 'message_plain' in data:
            print(f"\nmessage_plain length: {len(data['message_plain'])}", file=sys.stderr)
            print(f"message_plain preview: {data['message_plain'][:500]}", file=sys.stderr)

        if 'message' in data:
            print(f"\nmessage length: {len(data['message'])}", file=sys.stderr)
            print(f"message preview: {data['message'][:500]}", file=sys.stderr)

    except Exception as e:
        print(f"\n❌ Failed to parse JSON: {e}", file=sys.stderr)

if __name__ == '__main__':
    debug_response()
