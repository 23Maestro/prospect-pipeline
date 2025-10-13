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
    
    def get_inbox_threads(self, limit: int = 100, filter_assigned: str = 'both') -> List[Dict[str, Any]]:
        """Get inbox threads from video team inbox with pagination
        
        Args:
            limit: Maximum number of threads to return
            filter_assigned: Filter by assignment status
                - 'unassigned': Only unassigned threads (canAssign: true)
                - 'assigned': Only assigned threads (canAssign: false)
                - 'both': All threads (default)
        """
        self.ensure_authenticated()
        
        # Map filter to API parameter - the API handles the filtering!
        filter_map = {
            'unassigned': 'Un',      # Unassigned only
            'assigned': 'Me',        # Assigned to me only
            'both': 'Me/Un'          # Both assigned and unassigned
        }
        filter_self = filter_map.get(filter_assigned, 'Me/Un')
        
        all_threads = []
        page = 1
        max_pages = 2  # Safety limit (100 threads max)
        
        while len(all_threads) < limit and page <= max_pages:
            params = {
                'athleteid': '',
                'user_timezone': 'America/New_York',
                'type': 'inbox',
                'is_mobile': '',
                'filter_self': filter_self,
                'refresh': 'false',
                'page_start_number': str(page),
                'search_text': ''
            }
            
            resp = self.session.get(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist",
                params=params
            )
            resp.raise_for_status()
            
            # Parse HTML response
            soup = BeautifulSoup(resp.text, 'html.parser')
            message_elements = soup.select('div.ImageProfile')
            
            if not message_elements:
                # No more threads on this page
                break
            
            page_threads = []
            for elem in message_elements:
                try:
                    thread = self._parse_thread_element(elem, filter_assigned)
                    if thread:
                        page_threads.append(thread)
                except Exception as e:
                    print(f"⚠️  Failed to parse thread: {e}", file=sys.stderr)
                    continue
            
            all_threads.extend(page_threads)
            print(f"✅ Page {page}: Found {len(page_threads)} threads ({len(all_threads)} total)", file=sys.stderr)
            page += 1
        
        return all_threads[:limit]
    
    def _parse_thread_element(self, elem, filter_assigned: str = 'both') -> Optional[Dict[str, Any]]:
        """Parse a single thread element from inbox HTML
        
        Args:
            elem: BeautifulSoup element for the thread
            filter_assigned: The filter that was used ('unassigned', 'assigned', 'both')
        """
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
        
        # Determine assignment status based on the filter used
        # This is the KEY FIX: The API filter already separated assigned/unassigned!
        if filter_assigned == 'unassigned':
            can_assign = True  # filter_self='Un' returns only unassigned
        elif filter_assigned == 'assigned':
            can_assign = False  # filter_self='Me' returns only assigned
        else:
            # For 'both', we can't determine from HTML alone
            # Default to true (assignable) for backwards compatibility
            can_assign = True
        
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
        """Search for contacts (athletes/parents)
        
        Args:
            query: Email or name to search for
            search_type: 'athlete' or 'parent'
        
        Returns:
            List of contact dictionaries with keys: contactId, name, sport, gradYear, state
        """
        self.ensure_authenticated()
        
        # Use the correct endpoint from HAR file
        params = {
            'search': query,
            'searchfor': search_type  # 'athlete' or 'parent'
        }
        
        resp = self.session.get(
            f"{self.base_url}/template/calendaraccess/contactslist",
            params=params
        )
        
        if resp.status_code != 200:
            print(f"⚠️  Contact search failed: {resp.status_code}", file=sys.stderr)
            return []
        
        # Parse HTML response
        soup = BeautifulSoup(resp.text, 'html.parser')
        contacts = []
        
        # Find all table rows (skip header row)
        rows = soup.select('tr')[1:]  # Skip first row (header)
        
        for row in rows:
            try:
                # Extract contact info from input element
                input_elem = row.select_one('input.contactselected')
                if not input_elem:
                    continue
                
                contact_id = input_elem.get('contactid', '')
                athlete_main_id = input_elem.get('athlete_main_id', '')
                contact_name = input_elem.get('contactname', '')
                
                # Extract data from table cells
                cells = row.select('td')
                if len(cells) >= 5:
                    # Cells: [Name, Ranking, GradYear, State, Sport, ...]
                    ranking = cells[1].text.strip()
                    grad_year = cells[2].text.strip()
                    state = cells[3].text.strip()
                    sport = cells[4].text.strip()
                    
                    contacts.append({
                        'contactId': contact_id,
                        'athleteMainId': athlete_main_id,
                        'name': contact_name,
                        'sport': sport,
                        'gradYear': grad_year,
                        'state': state,
                        'ranking': ranking
                    })
            except Exception as e:
                print(f"⚠️  Failed to parse contact row: {e}", file=sys.stderr)
                continue
        
        print(f"✅ Found {len(contacts)} contacts for '{query}' ({search_type})", file=sys.stderr)
        return contacts
    
    def search_player(self, query: str) -> List[Dict[str, Any]]:
        """Search for players in NPID database"""
        self.ensure_authenticated()
        
        params = {
            'q': query,
            'type': 'athlete'
        }
        
        resp = self.session.get(
            f"{self.base_url}/search/athletes",
            params=params
        )
        
        if resp.status_code != 200:
            print(f"⚠️  Player search failed: {resp.status_code}", file=sys.stderr)
            return []
        
        # Parse HTML response
        soup = BeautifulSoup(resp.text, 'html.parser')
        results = []
        
        # Find athlete result elements (adjust selector based on actual HTML)
        athlete_elements = soup.select('.athlete-result, .search-result')
        
        for elem in athlete_elements[:20]:  # Limit to top 20 results
            try:
                # Extract player ID from link
                link = elem.select_one('a[href*="/athlete/"]')
                if not link:
                    continue
                
                href = link.get('href', '')
                player_id = href.split('/athlete/')[-1].split('/')[0] if '/athlete/' in href else ''
                
                # Extract name
                name_elem = elem.select_one('.athlete-name, .name, h3, h4')
                name = name_elem.text.strip() if name_elem else 'Unknown'
                
                # Extract grad year
                grad_elem = elem.select_one('.grad-year, .year')
                grad_year = grad_elem.text.strip() if grad_elem else ''
                
                # Extract location
                location_elem = elem.select_one('.location, .city-state')
                location = location_elem.text.strip() if location_elem else ''
                
                # Extract high school
                school_elem = elem.select_one('.school, .high-school')
                school = school_elem.text.strip() if school_elem else ''
                
                results.append({
                    'player_id': player_id,
                    'name': name,
                    'grad_year': grad_year,
                    'location': location,
                    'high_school': school,
                    'url': f"{self.base_url}{href}" if not href.startswith('http') else href
                })
            except Exception as e:
                print(f"⚠️  Failed to parse player result: {e}", file=sys.stderr)
                continue
        
        print(f"✅ Found {len(results)} players matching '{query}'", file=sys.stderr)
        return results
    
    def get_athlete_details(self, player_id: str) -> Dict[str, Any]:
        """Get detailed information about an athlete"""
        self.ensure_authenticated()
        
        resp = self.session.get(f"{self.base_url}/athlete/{player_id}")
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Extract athlete details from profile page
        details = {
            'player_id': player_id,
            'name': '',
            'grad_year': '',
            'high_school': '',
            'location': '',
            'positions': '',
            'sport': '',
            'videos': []
        }
        
        # Extract name
        name_elem = soup.select_one('.athlete-name, h1.profile-name, .profile-header h1')
        if name_elem:
            details['name'] = name_elem.text.strip()
        
        # Extract grad year
        grad_elem = soup.select_one('.grad-year, .graduation-year')
        if grad_elem:
            details['grad_year'] = grad_elem.text.strip()
        
        # Extract high school
        school_elem = soup.select_one('.high-school, .school-name')
        if school_elem:
            details['high_school'] = school_elem.text.strip()
        
        # Extract location
        location_elem = soup.select_one('.location, .city-state')
        if location_elem:
            details['location'] = location_elem.text.strip()
        
        # Extract positions
        position_elem = soup.select_one('.positions, .position')
        if position_elem:
            details['positions'] = position_elem.text.strip()
        
        # Extract sport
        sport_elem = soup.select_one('.sport')
        if sport_elem:
            details['sport'] = sport_elem.text.strip()
        
        # Extract existing videos
        video_elements = soup.select('.video-item, .highlight-video')
        for video_elem in video_elements:
            video_link = video_elem.select_one('a[href*="youtube.com"], a[href*="youtu.be"]')
            if video_link:
                details['videos'].append({
                    'url': video_link.get('href', ''),
                    'title': video_elem.text.strip()[:100]
                })
        
        print(f"✅ Retrieved details for {details['name']} ({player_id})", file=sys.stderr)
        return details
    
    def update_video_profile(self, player_id: str, youtube_link: str, season: str, video_type: str) -> Dict[str, Any]:
        """Update athlete profile with new video"""
        self.ensure_authenticated()
        
        # Get CSRF token from profile edit page
        edit_page = self.session.get(f"{self.base_url}/athlete/{player_id}/edit")
        edit_page.raise_for_status()
        
        soup = BeautifulSoup(edit_page.text, 'html.parser')
        csrf_elem = soup.select_one('input[name="csrf_token"], input[name="_token"]')
        csrf_token = csrf_elem.get('value', '') if csrf_elem else ''
        
        # Prepare video data
        video_data = {
            'csrf_token': csrf_token,
            'player_id': player_id,
            'video_url': youtube_link,
            'season': season,
            'video_type': video_type,
            'action': 'add_video'
        }
        
        print(f"🎬 Adding {video_type} video for player {player_id} ({season})", file=sys.stderr)
        
        # POST video update
        resp = self.session.post(
            f"{self.base_url}/athlete/{player_id}/videos/add",
            data=video_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        if resp.status_code == 200 or resp.status_code == 302:
            print(f"✅ Video added successfully to player {player_id}", file=sys.stderr)
            return {
                'success': True,
                'player_id': player_id,
                'video_url': youtube_link,
                'season': season,
                'video_type': video_type
            }
        else:
            print(f"⚠️  Video update failed: {resp.status_code}", file=sys.stderr)
            print(f"Response: {resp.text[:500]}", file=sys.stderr)
            return {
                'success': False,
                'error': f"HTTP {resp.status_code}",
                'message': resp.text[:200]
            }


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
        print("  search_player")
        print("  get_athlete_details")
        print("  update_video_profile")
        sys.exit(1)
    
    method = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    
    client = NPIDAPIClient()
    
    try:
        if method == 'login':
            result = client.login()
            print(json.dumps({'success': result}))
        
        elif method == 'get_inbox_threads':
            limit = args.get('limit', 100)
            filter_assigned = args.get('filter_assigned', 'both')
            threads = client.get_inbox_threads(limit, filter_assigned)
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
        
        elif method == 'search_player':
            query = args['query']
            results = client.search_player(query)
            print(json.dumps(results))
        
        elif method == 'get_athlete_details':
            player_id = args['player_id']
            details = client.get_athlete_details(player_id)
            print(json.dumps(details))
        
        elif method == 'update_video_profile':
            result = client.update_video_profile(
                args['player_id'],
                args['youtube_link'],
                args['season'],
                args['video_type']
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