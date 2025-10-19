#!/usr/bin/env python3
"""Test script to fetch and display a message detail"""

import json
import sys
from npid_api_client import NPIDAPIClient

def test_message_fetch():
    """Test fetching inbox threads and then get detail for first message"""
    client = NPIDAPIClient()

    print("🔍 Fetching inbox threads...", file=sys.stderr)
    threads = client.get_inbox_threads(limit=5, filter_assigned='both')

    if not threads:
        print("❌ No threads found", file=sys.stderr)
        return

    print(f"✅ Found {len(threads)} threads", file=sys.stderr)

    # Get first thread
    first_thread = threads[0]
    message_id = first_thread['id']
    item_code = first_thread.get('itemCode', message_id)

    # Strip "message_id" prefix if present
    if message_id.startswith('message_id'):
        message_id = message_id.replace('message_id', '')

    print(f"\n📧 First thread:", file=sys.stderr)
    print(f"  ID: {message_id}", file=sys.stderr)
    print(f"  Item Code: {item_code}", file=sys.stderr)
    print(f"  Subject: {first_thread.get('subject', 'N/A')}", file=sys.stderr)
    print(f"  From: {first_thread.get('name', 'N/A')}", file=sys.stderr)
    print(f"  Preview: {first_thread.get('preview', 'N/A')[:100]}...", file=sys.stderr)

    print(f"\n🔍 Fetching full message detail...", file=sys.stderr)
    detail = client.get_message_detail(message_id, item_code)

    print(f"\n📄 Message Detail:", file=sys.stderr)
    print(f"  Content length: {len(detail.get('content', ''))} chars", file=sys.stderr)
    print(f"  Content preview: {detail.get('content', 'N/A')[:200]}...", file=sys.stderr)

    # Print full JSON for debugging
    print("\n📦 Full detail JSON:")
    print(json.dumps(detail, indent=2))

if __name__ == '__main__':
    test_message_fetch()
