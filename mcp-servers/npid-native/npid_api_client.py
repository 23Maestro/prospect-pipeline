#!/usr/bin/env python3
"""Pure REST API client for NPID Dashboard - No Selenium"""

import requests
import pickle
import os
import json
import sys
import re
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Optional, Dict, List, Any
from datetime import datetime

class NPIDAPIClient:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://dashboard.nationalpid.com"
        self.cookie_file = Path.home() / '.npid_session.pkl'
        self.email = os.getenv('NPID_EMAIL', 'jsingleton@prospectid.com')
        self.password = os.getenv('NPID_PASSWORD', 'YBh@Y8Us@1&qwd$')
        self.authenticated = False
        
        # Load saved session if exists
        self._load_session()
        
    def _load_session(self):
        """Load cookies from pickle file"""
        if self.cookie_file.exists():
            try:
                with open(self.cookie_file, 'rb') as f:
                    cookies = pickle.load(f)
                    self.session.cookies.update(cookies)
                print(f"✅ Loaded session from {self.cookie_file}", file=sys.stderr)
            except Exception as e:
                print(f"⚠️  Failed to load session: {e}", file=sys.stderr)
    
    def _save_session(self):
        """Save cookies to pickle file"""
        try:
            with open(self.cookie_file, 'wb') as f:
                pickle.dump(self.session.cookies, f)
            print(f"✅ Saved session to {self.cookie_file}", file=sys.stderr)
        except Exception as e:
            print(f"⚠️  Failed to save session: {e}", file=sys.stderr)
    
    def _get_csrf_token(self) -> str:
        """Extract CSRF token from login page"""
        resp = self.session.get(f"{self.base_url}/auth/login")
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        token_input = soup.find('input', {'name': '_token'})
        
        if not token_input or not token_input.get('value'):
            raise ValueError("Failed to extract CSRF token")
        
        return token_input['value']
    
    def validate_session(self) -> bool:
        """Check if current session is valid"""
        try:
            resp = self.session.get(f"{self.base_url}/external/logincheck")
            if resp.status_code == 200:
                data = resp.json()
                return data.get('success') == 'true'
        except Exception as e:
            print(f"Session validation error: {e}", file=sys.stderr)
        return False
    
    def login(self, force=False) -> bool:
        """Login with remember token for 400-day persistence"""
        # Check if already authenticated
        if not force and self.validate_session():
            print("✅ Already authenticated", file=sys.stderr)
            self.authenticated = True
            return True
        
        print("🔐 Logging in...", file=sys.stderr)
        
        # Get fresh CSRF token
        csrf_token = self._get_csrf_token()
        
        # Login with remember=on for 400-day cookie
        login_data = {
            'email': self.email,
            'password': self.password,
            '_token': csrf_token,
            'remember': 'on'
        }
        
        resp = self.session.post(
            f"{self.base_url}/auth/login",
            data=login_data,
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': f"{self.base_url}/auth/login"
            },
            allow_redirects=False
        )
        
        # 302 redirect = success
        if resp.status_code == 302:
            print("✅ Login successful", file=sys.stderr)
            self.authenticated = True
            self._save_session()
            return True
        
        raise Exception(f"Login failed: {resp.status_code}")
    
    def ensure_authenticated(self):
        """Ensure we're authenticated before making requests"""
        if not self.authenticated:
            self.login()
    
    def get_inbox_threads(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get inbox threads from video team inbox"""
        self.ensure_authenticated()
        
        params = {
            'athleteid': '',
            'user_timezone': 'America/New_York',
            'type': 'inbox',
            'is_mobile': '',
            'filter_self': 'MeUn',  # Me + Unassigned
            'refresh': 'false',
            'page_start_number': '1',
            'search_text': ''
        }
        
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videoteammessagelist",
            params=params
        )
        resp.raise_for_status()
        
        # Parse HTML response
        soup = BeautifulSoup(resp.text, 'html.parser')
        threads = []
        
        # Find all message containers (div.ImageProfile)
        message_elements = soup.select('div.ImageProfile')
        
        for elem in message_elements[:limit]:
            try:
                thread = self._parse_thread_element(elem)
                if thread:
                    threads.append(thread)
            except Exception as e:
                print(f"⚠️  Failed to parse thread: {e}", file=sys.stderr)
                continue
        
        print(f"✅ Found {len(threads)} inbox threads", file=sys.stderr)
        return threads
    
    def _parse_thread_element(self, elem) -> Optional[Dict[str, Any]]:
        """Parse a single thread element from inbox HTML"""
        # Extract IDs
        item_id = elem.get('itemid')
        item_code = elem.get('itemcode')
        message_id = elem.get('id')
        
        if not item_id:
            return None
        
        # Extract email from hidden div
        email_elem = elem.select_one('.hidden')
        email = email_elem.text.strip() if email_elem else ""
        
        # Extract contact and athlete IDs
        contact_id = elem.get('contacttask', '')
        athlete_main_id = elem.get('athletemainid', '')
        
        # Extract name
        name_elem = elem.select_one('.msg-sendr-name')
        name = name_elem.text.strip() if name_elem else "Unknown"
        
        # Extract subject from tit_line1
        subject_elem = elem.select_one('.tit_line1')
        subject = subject_elem.text.strip() if subject_elem else ""
        
        # Extract preview from tit_univ (strip reply chains)
        preview_elem = elem.select_one('.tit_univ')
        preview = ""
        if preview_elem:
            preview_text = preview_elem.text.strip()
            # Strip reply chain
            reply_pattern = r'On\s+.+?\s+Prospect\s+ID\s+Video\s+.+?wrote:'
            match = re.search(reply_pattern, preview_text, re.IGNORECASE | re.DOTALL)
            if match:
                preview = preview_text[:match.start()].strip()
            else:
                preview = preview_text[:300] if len(preview_text) > 300 else preview_text
        
        # Extract timestamp
        date_elem = elem.select_one('.date_css')
        timestamp = date_elem.text.strip() if date_elem else ""
        
        # Check if assigned - look for plus icon (➕) or assign button for unassigned
        # Look for assign button or plus icon indicating unassigned status
        assign_button = elem.select_one('.assign-button, [title*="assign"], [title*="Assign"]')
        plus_icon = elem.select_one('text:contains("➕"), .plus-icon, [class*="plus"]')
        owner_badge = elem.select_one('.msg-badge-owner, .owner-badge, [class*="owner"]')
        
        # If there's an assign button or plus icon, it's unassigned
        # If there's an owner badge, it's assigned
        is_assigned = bool(owner_badge) and not bool(assign_button or plus_icon)
        can_assign = not is_assigned
        
        # Extract attachments
        attachments = []
        attachment_elems = elem.select('.attachment-item')
        for att_elem in attachment_elems:
            att_name = att_elem.get('data-filename', 'Unknown')
            att_url = att_elem.get('data-url', '')
            attachments.append({
                'fileName': att_name,
                'url': att_url,
                'downloadable': bool(att_url)
            })
        
        return {
            'id': message_id or item_id,
            'itemCode': item_code or item_id,
            'message_id': message_id or item_id,
            'contact_id': contact_id,
            'athleteMainId': athlete_main_id,
            'name': name,
            'email': email,
            'subject': subject,
            'preview': preview,
            'content': preview,  # Use preview as content
            'timestamp': timestamp,
            'timeStampIso': None,
            'can_assign': can_assign,
            'canAssign': can_assign,
            'isUnread': 'unread' in elem.get('class', []),
            'attachments': attachments
        }
    
    def get_message_detail(self, message_id: str, item_code: str) -> Dict[str, Any]:
        """Get detailed message content"""
        self.ensure_authenticated()
        
        params = {
            'message_id': message_id,
            'itemcode': item_code,
            'type': 'inbox',
            'user_timezone': 'America/New_York',
            'filter_self': 'MeUn'
        }
        
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videoteammessage_subject",
            params=params
        )
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Extract full message content
        content_elem = soup.select_one('.message-content')
        content = content_elem.text.strip() if content_elem else ""
        
        return {
            'message_id': message_id,
            'item_code': item_code,
            'content': content
        }
    
    def get_assignment_modal(self, message_id: str, item_code: str) -> Dict[str, Any]:
        """Get assignment modal data (owners, stages, statuses)"""
        self.ensure_authenticated()
        
        params = {
            'message_id': message_id,
            'itemcode': item_code
        }
        
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/assignemailtovideoteam",
            params=params
        )
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Extract CSRF token
        token_input = soup.select_one('input[name="_token"]')
        form_token = token_input['value'] if token_input else ""
        
        # Extract owners dropdown
        owners = []
        owner_select = soup.select_one('select[name="videoscoutassignedto"]')
        if owner_select:
            for option in owner_select.select('option'):
                owners.append({
                    'value': option.get('value', ''),
                    'label': option.text.strip()
                })
        
        # Extract stages dropdown
        stages = []
        stage_select = soup.select_one('select[name="stage"]')
        if stage_select:
            for option in stage_select.select('option'):
                stages.append({
                    'value': option.get('value', ''),
                    'label': option.text.strip()
                })
        
        # Extract video statuses dropdown
        statuses = []
        status_select = soup.select_one('select[name="contacttask"]')
        if status_select:
            for option in status_select.select('option'):
                statuses.append({
                    'value': option.get('value', ''),
                    'label': option.text.strip()
                })
        
        # Extract contact search value
        contact_input = soup.select_one('input[name="contact_search"]')
        contact_search = contact_input.get('value', '') if contact_input else ""
        
        # Extract athlete main ID
        athlete_input = soup.select_one('input[name="athlete_main_id"]')
        athlete_main_id = athlete_input.get('value', '') if athlete_input else ""
        
        return {
            'formToken': form_token,
            'owners': owners,
            'stages': stages,
            'videoStatuses': statuses,
            'contactSearchValue': contact_search,
            'athleteMainId': athlete_main_id,
            'defaultSearchFor': 'athlete',
            'defaultOwner': owners[0] if owners else None
        }
    
    def assign_thread(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Assign a thread to video team"""
        self.ensure_authenticated()
        
        # Build form data
        form_data = {
            'messageid': payload['messageId'],
            'videoscoutassignedto': payload['ownerId'],
            'contacttask': payload['status'],
            'athlete_main_id': payload.get('athleteMainId', ''),
            '_token': payload['formToken']
        }
        
        resp = self.session.post(
            f"{self.base_url}/videoteammsg/assignvideoteam",
            data=form_data,
            headers={
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        )
        resp.raise_for_status()
        
        result = resp.json()
        
        if result.get('success'):
            print(f"✅ Assigned thread {payload['messageId']}", file=sys.stderr)
            return result
        
        raise Exception(f"Assignment failed: {result}")
    
    def search_contacts(self, query: str, search_type: str = 'athlete') -> List[Dict[str, Any]]:
        """Search for contacts (athletes/parents)"""
        self.ensure_authenticated()
        
        params = {
            'query': query,
            'type': search_type
        }
        
        resp = self.session.get(
            f"{self.base_url}/api/contacts/search",
            params=params
        )
        
        if resp.status_code != 200:
            return []
        
        contacts = resp.json()
        return contacts if isinstance(contacts, list) else []


def main():
    """CLI interface for testing"""
    if len(sys.argv) < 2:
        print("Usage: python3 npid_api_client.py <method> [json_args]")
        print("\nAvailable methods:")
        print("  login")
        print("  get_inbox_threads")
        print("  get_message_detail")
        print("  get_assignment_modal")
        print("  assign_thread")
        print("  search_contacts")
        sys.exit(1)
    
    method = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    
    client = NPIDAPIClient()
    
    try:
        if method == 'login':
            result = client.login()
            print(json.dumps({'success': result}))
        
        elif method == 'get_inbox_threads':
            limit = args.get('limit', 50)
            threads = client.get_inbox_threads(limit)
            print(json.dumps(threads))
        
        elif method == 'get_message_detail':
            result = client.get_message_detail(
                args['message_id'],
                args['item_code']
            )
            print(json.dumps(result))
        
        elif method == 'get_assignment_modal':
            result = client.get_assignment_modal(
                args['message_id'],
                args.get('item_code', args['message_id'])
            )
            print(json.dumps(result))
        
        elif method == 'assign_thread':
            result = client.assign_thread(args)
            print(json.dumps(result))
        
        elif method == 'search_contacts':
            result = client.search_contacts(
                args['query'],
                args.get('search_type', 'athlete')
            )
            print(json.dumps(result))
        
        else:
            print(json.dumps({'error': f'Unknown method: {method}'}))
            sys.exit(1)
    
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()