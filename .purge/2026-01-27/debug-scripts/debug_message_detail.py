#!/usr/bin/env python3
"""Debug script to test message detail fetching and HTML parsing"""

import sys
from npid_api_client import NPIDAPIClient

def debug_message_detail(message_id: str, item_code: str):
    """Fetch and debug message detail HTML"""
    client = NPIDAPIClient()

    params = {
        'message_id': message_id,
        'itemcode': item_code,
        'type': 'inbox',
        'user_timezone': 'America/New_York',
        'filter_self': 'MeUn'
    }

    print(f"🔍 Fetching message detail for ID: {message_id}", file=sys.stderr)

    resp = client.session.get(
        f"{client.base_url}/rulestemplates/template/videoteammessage_subject",
        params=params
    )

    print(f"📊 Response status: {resp.status_code}", file=sys.stderr)
    print(f"📦 Response length: {len(resp.text)} chars", file=sys.stderr)

    # Save HTML to file for inspection
    html_file = f"/tmp/message_{message_id}_detail.html"
    with open(html_file, 'w') as f:
        f.write(resp.text)
    print(f"💾 Saved HTML to: {html_file}", file=sys.stderr)

    # Try various selectors
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(resp.text, 'html.parser')

    print("\n🔎 Testing CSS selectors:", file=sys.stderr)
    selectors = [
        '.message-content',
        '.message-body',
        '.email-content',
        '.content',
        '#message-content',
        '.msg-content',
        'div.content',
        '.tit_univ',
        '.modal-body',
        'body'
    ]

    for selector in selectors:
        elem = soup.select_one(selector)
        if elem:
            text = elem.text.strip()[:200]
            print(f"  ✅ {selector}: Found ({len(elem.text)} chars) - {text}...", file=sys.stderr)
        else:
            print(f"  ❌ {selector}: Not found", file=sys.stderr)

    # Print all div classes found
    print("\n📋 All div classes found:", file=sys.stderr)
    all_divs = soup.find_all('div', class_=True)
    unique_classes = set()
    for div in all_divs:
        for cls in div.get('class', []):
            unique_classes.add(cls)
    for cls in sorted(unique_classes)[:30]:
        print(f"  - {cls}", file=sys.stderr)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 debug_message_detail.py <message_id> <item_code>")
        sys.exit(1)

    debug_message_detail(sys.argv[1], sys.argv[2])
