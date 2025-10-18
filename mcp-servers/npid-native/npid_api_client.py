#!/Users/singleton23/.pyenv/shims/python3
"""Pure REST API client for NPID Dashboard - No Selenium"""

import requests
import pickle
import os
import json
import sys
import re
import logging
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Optional, Dict, List, Any


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


class NPIDAPIClient:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://dashboard.nationalpid.com"
        self.cookie_file = Path.home() / '.npid_session.pkl'
        self.email = os.getenv('NPID_EMAIL', 'jsingleton@prospectid.com')
        self.password = os.getenv('NPID_PASSWORD', 'YBh@Y8Us@1&qwd$')
        self.authenticated = False
        self._load_session()

    def _load_session(self):
        """Load cookies from pickle file"""
        if self.cookie_file.exists():
            try:
                with open(self.cookie_file, 'rb') as f:
                    cookies = pickle.load(f)
                    self.session.cookies.update(cookies)
                logging.info(f"✅ Loaded session from {self.cookie_file}")
            except Exception:
                logging.exception("⚠️  Failed to load session")

    def _save_session(self):
        """Save cookies to pickle file"""
        try:
            with open(self.cookie_file, 'wb') as f:
                pickle.dump(self.session.cookies, f)
            logging.info(f"✅ Saved session to {self.cookie_file}")
        except Exception:
            logging.exception("⚠️  Failed to save session")

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
        except Exception:
            logging.exception("Session validation error")
        return False

    def login(self, force=False) -> bool:
        """Login with remember token for 400-day persistence"""
        if not force and self.validate_session():
            logging.info("✅ Already authenticated")
            self.authenticated = True
            return True
        logging.info("🔐 Logging in...")
        csrf_token = self._get_csrf_token()
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
        if resp.status_code == 302:
            logging.info("✅ Login successful")
            self.authenticated = True
            self._save_session()
            return True
        raise Exception(f"Login failed: {resp.status_code}")

    def ensure_authenticated(self):
        """Ensure we're authenticated before making requests"""
        if not self.authenticated:
            self.login()

    def get_inbox_threads(
        self, limit: int = 100, filter_assigned: str = 'both', exclude_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get inbox threads from video team inbox with pagination"""
        self.ensure_authenticated()
        all_threads = []
        page = 1
        max_pages = 2
        while len(all_threads) < limit and page <= max_pages:
            params = {
                'athleteid': '',
                'user_timezone': 'America/New_York',
                'type': 'inbox',
                'is_mobile': '',
                'filter_self': 'Me/Un',
                'refresh': 'false',
                'page_start_number': str(page),
                'search_text': ''
            }
            resp = self.session.get(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist",
                params=params
            )
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            message_elements = soup.select('div.ImageProfile')
            if not message_elements:
                break
            page_threads = []
            for elem in message_elements:
                if exclude_id and elem.get('id') == exclude_id:
                    continue
                try:
                    plus_icon = elem.select_one('i.fa-plus-circle')
                    has_plus = plus_icon is not None
                    if filter_assigned == 'unassigned' and not has_plus:
                        continue
                    if filter_assigned == 'assigned' and has_plus:
                        continue
                    thread = self._parse_thread_element(elem, filter_assigned)
                    if thread:
                        thread['canAssign'] = has_plus
                        thread['can_assign'] = has_plus
                        page_threads.append(thread)
                except Exception:
                    logging.exception("⚠️  Failed to parse thread")
                    continue
            all_threads.extend(page_threads)
            logging.info(f"✅ Page {page}: Found {len(page_threads)} threads ({len(all_threads)} total)")
            page += 1
        return all_threads[:limit]

    def _parse_thread_element(
        self, elem, filter_assigned: str = 'both'
    ) -> Optional[Dict[str, Any]]:
        """Parse a single thread element from inbox HTML"""
        item_id = elem.get('itemid')
        item_code = elem.get('itemcode')
        message_id = elem.get('id')
        if not item_id:
            return None
        email_elem = elem.select_one('.hidden')
        email = email_elem.text.strip() if email_elem else ""
        contact_id = elem.get('contacttask', '')
        athlete_main_id = elem.get('athletemainid', '')
        name_elem = elem.select_one('.msg-sendr-name')
        name = name_elem.text.strip() if name_elem else "Unknown"
        subject_elem = elem.select_one('.tit_line1')
        subject = subject_elem.text.strip() if subject_elem else ""
        preview_elem = elem.select_one('.tit_univ')
        preview = ""
        if preview_elem:
            preview_text = preview_elem.text.strip()
            reply_pattern = r'On\s+.+?\s+Prospect\s+ID\s+Video\s+.+?wrote:'
            match = re.search(reply_pattern, preview_text, re.IGNORECASE | re.DOTALL)
            if match:
                preview = preview_text[:match.start()].strip()
            else:
                preview = preview_text[:300]
        date_elem = elem.select_one('.date_css')
        timestamp = date_elem.text.strip() if date_elem else ""
        if filter_assigned == 'unassigned':
            can_assign = True
        elif filter_assigned == 'assigned':
            can_assign = False
        else:
            can_assign = True
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
            'content': preview,
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
        clean_id = (
            message_id.replace('message_id', '', 1)
            if message_id and message_id.startswith('message_id')
            else message_id
        )
        params = {
            'message_id': clean_id,
            'itemcode': item_code,
            'type': 'inbox',
            'user_timezone': 'America/New_York',
            'filter_self': 'Me/Un'
        }
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videoteammessage_subject",
            params=params,
            headers={
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        )
        if resp.status_code != 200:
            logging.warning(f"⚠️  Failed to fetch message detail: {resp.status_code}")
            return {'message_id': clean_id, 'item_code': item_code, 'content': ''}
        try:
            response_text = resp.text.strip()
            data = json.loads(response_text)
            content = data.get('message_plain', '') or data.get('message', '')
            reply_patterns = [
                r'\n\s*On\s+.+?\s+wrote:\s*\n',
                r'\n\s*On\s+.+?\s+at\s+.+?wrote:\s*\n',
                r'\n\s*-{2,}\s*On\s+.+?wrote:\s*-{2,}\s*\n',
            ]
            for pattern in reply_patterns:
                match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
                if match:
                    content = content[:match.start()].strip()
                    break
            logging.info(f"✅ Fetched message detail for {message_id} ({len(content)} chars)")
            return {
                'message_id': clean_id,
                'item_code': item_code,
                'content': content,
                'subject': data.get('subject', ''),
                'from_email': data.get('from_email', ''),
                'from_name': data.get('from_name', ''),
                'timestamp': data.get('time_stamp', '')
            }
        except Exception:
            logging.exception(f"⚠️  Failed to parse message detail JSON. Response: {resp.text[:500]}")
            return {'message_id': clean_id, 'item_code': item_code, 'content': ''}

    def get_assignment_modal(self, message_id: str, item_code: str) -> Dict[str, Any]:
        """Get assignment modal data (owners, stages, statuses)"""
        self.ensure_authenticated()
        params = {'message_id': message_id, 'itemcode': item_code}
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/assignemailtovideoteam",
            params=params
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        token_input = soup.select_one('input[name="_token"]')
        form_token = token_input['value'] if token_input else ""
        owners = []
        owner_select = soup.select_one('select[name="videoscoutassignedto"]')
        if owner_select:
            for option in owner_select.select('option'):
                owners.append({'value': option.get('value', '').strip(), 'label': option.text.strip()})
        stages = []
        stage_select = soup.select_one('select[name="video_progress_stage"]')
        if stage_select:
            for option in stage_select.select('option'):
                stages.append({'value': option.get('value', '').strip(), 'label': option.text.strip()})
        statuses = []
        status_select = soup.select_one('select[name="video_progress_status"]')
        if status_select:
            for option in status_select.select('option'):
                statuses.append({'value': option.get('value', '').strip(), 'label': option.text.strip()})
        contact_input = soup.select_one('input[name="contact"]')
        contact_search = contact_input.get('value', '') if contact_input else ""
        contact_for_select = soup.select_one('select[name="contactfor"]')
        default_search_for = ''
        if contact_for_select:
            selected_option = contact_for_select.select_one('option[selected]')
            default_search_for = (
                selected_option.get('value', '').strip() if selected_option
                else contact_for_select.get('value', '').strip()
            )
        contact_task_input = soup.select_one('input[name="contact_task"]')
        contact_task = contact_task_input.get('value', '').strip() if contact_task_input else ""
        athlete_input = soup.select_one('input[name="athlete_main_id"]')
        athlete_main_id = athlete_input.get('value', '').strip() if athlete_input else ""
        message_id_input = soup.select_one('input[name="messageid"]')
        message_id_value = message_id_input.get('value', '').strip() if message_id_input else ""
        jerami_id = '1408164'
        default_owner = None
        if owners:
            default_owner = next((owner for owner in owners if owner['value'] == jerami_id), None)
            if not default_owner:
                default_owner = owners[0]
        return {
            'formToken': form_token,
            'owners': owners,
            'stages': stages,
            'videoStatuses': statuses,
            'contactSearchValue': contact_search,
            'athleteMainId': athlete_main_id,
            'contactTask': contact_task,
            'messageId': message_id_value,
            'defaultSearchFor': default_search_for or 'athlete',
            'defaultOwner': default_owner,
            'contactFor': default_search_for or 'athlete'
        }

    def assign_thread(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Assign a thread to video team"""
        self.ensure_authenticated()
        contact_id = payload.get('contact_id', payload.get('contactId', ''))
        athlete_main_id = payload.get('athleteMainId', '')
        stage = payload.get('stage', '') or ''
        status = payload.get('status', '') or ''
        form_data = {
            'messageid': payload['messageId'],
            'videoscoutassignedto': payload['ownerId'],
            'contact_task': contact_id,
            'contacttask': contact_id,
            'athlete_main_id': athlete_main_id,
            'athletemainid': athlete_main_id,
            'contactfor': payload.get('contactFor', 'athlete'),
            'contact': payload.get('contact', ''),
            'video_progress_stage': stage,
            'videoprogressstage': stage,
            'video_progress_status': status,
            'videoprogressstatus': status,
            '_token': payload['formToken']
        }
        resp = self.session.post(
            f"{self.base_url}/videoteammsg/assignvideoteam",
            data=form_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        resp.raise_for_status()
        if resp.status_code == 200 and not resp.text.strip():
            logging.info(f"✅ Assigned thread {payload['messageId']} (empty response)")
            return {'success': True}
        try:
            result = resp.json()
        except json.JSONDecodeError:
            logging.error(f"Failed to decode JSON. Status: {resp.status_code}, Body: {resp.text}")
            raise Exception(f"Assignment response not valid JSON. Body: {resp.text[:500]}")
        if result.get('success'):
            logging.info(f"✅ Assigned thread {payload['messageId']}")
            return result
        raise Exception(f"Assignment failed: {result}")

    def get_assignment_defaults(self, contact_id: str) -> Dict[str, Any]:
        """Fetch recommended stage/status for a contact"""
        self.ensure_authenticated()
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/messageassigninfo",
            params={'contactid': contact_id},
            headers={'Accept': 'application/json'}
        )
        resp.raise_for_status()
        data = resp.json() if resp.text else {}
        return {'stage': data.get('stage'), 'status': data.get('video_progress_status')}

    def search_contacts(
        self, query: str, search_type: str = 'athlete'
    ) -> List[Dict[str, Any]]:
        """Search for contacts (athletes/parents)"""
        self.ensure_authenticated()
        params = {'search': query, 'searchfor': search_type}
        resp = self.session.get(
            f"{self.base_url}/template/calendaraccess/contactslist", params=params
        )
        if resp.status_code != 200:
            logging.warning(f"⚠️  Contact search failed: {resp.status_code}")
            return []
        soup = BeautifulSoup(resp.text, 'html.parser')
        contacts = []
        rows = soup.select('tr')[1:]
        for row in rows:
            try:
                input_elem = row.select_one('input.contactselected')
                if not input_elem:
                    continue
                contact_id = input_elem.get('contactid', '')
                athlete_main_id = input_elem.get('athlete_main_id', '')
                contact_name = input_elem.get('contactname', '')
                cells = row.select('td')
                if len(cells) >= 5:
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
            except Exception:
                logging.exception("⚠️  Failed to parse contact row")
                continue
        logging.info(f"✅ Found {len(contacts)} contacts for '{query}' ({search_type})")
        return contacts

    def search_player(self, query: str) -> List[Dict[str, Any]]:
        """Search for players in NPID database"""
        self.ensure_authenticated()
        params = {'q': query, 'type': 'athlete'}
        resp = self.session.get(f"{self.base_url}/search/athletes", params=params)
        if resp.status_code != 200:
            logging.warning(f"⚠️  Player search failed: {resp.status_code}")
            return []
        soup = BeautifulSoup(resp.text, 'html.parser')
        results = []
        athlete_elements = soup.select('.athlete-result, .search-result')
        for elem in athlete_elements[:20]:
            try:
                link = elem.select_one('a[href*="/athlete/"]')
                if not link:
                    continue
                href = link.get('href', '')
                player_id = href.split('/athlete/')[-1].split('/')[0] if '/athlete/' in href else ''
                name_elem = elem.select_one('.athlete-name, .name, h3, h4')
                name = name_elem.text.strip() if name_elem else 'Unknown'
                grad_elem = elem.select_one('.grad-year, .year')
                grad_year = grad_elem.text.strip() if grad_elem else ''
                location_elem = elem.select_one('.location, .city-state')
                location = location_elem.text.strip() if location_elem else ''
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
            except Exception:
                logging.exception("⚠️  Failed to parse player result")
                continue
        logging.info(f"✅ Found {len(results)} players matching '{query}'")
        return results

    def get_athlete_details(self, player_id: str) -> Dict[str, Any]:
        """Get detailed information about an athlete"""
        self.ensure_authenticated()
        resp = self.session.get(f"{self.base_url}/athlete/{player_id}")
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        athlete_main_id_input = soup.select_one('input[name="athlete_main_id"]')
        athlete_main_id = athlete_main_id_input.get('value', '') if athlete_main_id_input else ''
        details = {
            'player_id': player_id,
            'athlete_main_id': athlete_main_id,
            'name': '', 'grad_year': '', 'high_school': '', 'location': '',
            'positions': '', 'sport': '', 'videos': []
        }
        name_elem = soup.select_one('.athlete-name, h1.profile-name, .profile-header h1')
        if name_elem:
            details['name'] = name_elem.text.strip()
        grad_elem = soup.select_one('.grad-year, .graduation-year')
        if grad_elem:
            details['grad_year'] = grad_elem.text.strip()
        school_elem = soup.select_one('.high-school, .school-name')
        if school_elem:
            details['high_school'] = school_elem.text.strip()
        location_elem = soup.select_one('.location, .city-state')
        if location_elem:
            details['location'] = location_elem.text.strip()
        position_elem = soup.select_one('.positions, .position')
        if position_elem:
            details['positions'] = position_elem.text.strip()
        sport_elem = soup.select_one('.sport')
        if sport_elem:
            details['sport'] = sport_elem.text.strip()
        video_elements = soup.select('.video-item, .highlight-video')
        for video_elem in video_elements:
            video_link = video_elem.select_one('a[href*="youtube.com"], a[href*="youtu.be"]')
            if video_link:
                details['videos'].append({
                    'url': video_link.get('href', ''),
                    'title': video_elem.text.strip()[:100]
                })
        logging.info(f"✅ Retrieved details for {details['name']} ({player_id})")
        return details

    def get_video_seasons(
        self, athlete_id: str, sport_alias: str, video_type: str, athlete_main_id: str
    ) -> List[Dict[str, Any]]:
        """Get available video seasons for a player."""
        self.ensure_authenticated()
        params = {
            'athlete_id': athlete_id,
            'sport_alias': sport_alias,
            'video_type': video_type,
            'athlete_main_id': athlete_main_id
        }
        resp = self.session.get(
            f"{self.base_url}/template/videotemplate/videoseasons", params=params
        )
        resp.raise_for_status()
        return resp.json()

    def update_video_profile(
        self, player_id: str, youtube_link: str, season: str, video_type: str
    ) -> Dict[str, Any]:
        """Update athlete profile with new video"""
        self.ensure_authenticated()
        edit_page = self.session.get(f"{self.base_url}/athlete/{player_id}/edit")
        edit_page.raise_for_status()
        soup = BeautifulSoup(edit_page.text, 'html.parser')
        csrf_elem = soup.select_one('input[name="csrf_token"], input[name="_token"]')
        csrf_token = csrf_elem.get('value', '') if csrf_elem else ''
        video_data = {
            'csrf_token': csrf_token,
            'player_id': player_id,
            'video_url': youtube_link,
            'season': season,
            'video_type': video_type,
            'action': 'add_video'
        }
        logging.info(f"🎬 Adding {video_type} video for player {player_id} ({season})")
        resp = self.session.post(
            f"{self.base_url}/athlete/{player_id}/videos/add",
            data=video_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        if resp.status_code in [200, 302]:
            logging.info(f"✅ Video added successfully to player {player_id}")
            return {
                'success': True, 'player_id': player_id, 'video_url': youtube_link,
                'season': season, 'video_type': video_type
            }
        else:
            logging.warning(f"⚠️  Video update failed: {resp.status_code}")
            logging.warning(f"Response: {resp.text[:500]}")
            return {
                'success': False, 'error': f"HTTP {resp.status_code}",
                'message': resp.text[:200]
            }


    def get_video_progress_page(self, athlete_name: str) -> str:
        """Gets the HTML content of the video progress page for a given athlete."""
        self.ensure_authenticated()

        logging.info(f"Searching for athlete: {athlete_name}")
        players = self.search_player(athlete_name)
        if not players:
            raise Exception(f"No athlete found with name: {athlete_name}")

        player = players[0]
        player_id = player['player_id']
        logging.info(f"Found player {player['name']} with ID: {player_id}")

        # NOTE: This is an assumed URL structure for the video progress page.
        # The actual URL may be different.
        video_progress_url = f"{self.base_url}/videoteammsg/videomailprogress/{player_id}"

        resp = self.session.get(video_progress_url)
        resp.raise_for_status()

        return resp.text

    def get_page_content(self, url: str) -> str:
        """Gets the HTML content of a given URL."""
        self.ensure_authenticated()
        resp = self.session.get(url)
        resp.raise_for_status()
        return resp.text

    def send_email_to_athlete(self, athlete_name: str, template_name: str) -> Dict[str, Any]:
        """Sends an email to an athlete using a specified template."""
        self.ensure_authenticated()

        logging.info(f"Searching for athlete: {athlete_name}")
        players = self.search_player(athlete_name)
        if not players:
            raise Exception(f"No athlete found with name: {athlete_name}")

        player = players[0]
        player_id = player['player_id']
        logging.info(f"Found player {player['name']} with ID: {player_id}")

        # Get the email templates for the athlete
        resp = self.session.get(f"{self.base_url}/rulestemplates/template/videotemplates?id={player_id}")
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        templates = {option.text.strip(): option.get('value') for option in soup.select('option')}

        template_id = templates.get(template_name)
        if not template_id:
            raise Exception(f"Template '{template_name}' not found for athlete {athlete_name}")

        # Get the template data (subject and body)
        resp = self.session.post(
            f"{self.base_url}/admin/templatedata",
            data={"tmpl": template_id, "_token": self._get_csrf_token(), "athlete_id": player_id},
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        resp.raise_for_status()
        template_data = resp.json()

        # Send the email
        email_payload = {
            "_token": self._get_csrf_token(),
            "notification_type_id": "1",
            "notification_to_type_id": "1",
            "notification_to_id": player_id,
            "notification_from": template_data.get('sender_name', 'James Holcomb'),
            "notification_from_email": template_data.get('sender_email', 'jholcomb@nationalpid.com'),
            "notification_subject": template_data.get('templatesubject', ''),
            "notification_message": template_data.get('templatedescription', ''),
            "includemysign": "includemysign",
        }

        resp = self.session.post(
            f"{self.base_url}/admin/addnotification",
            data=email_payload,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )

        resp.raise_for_status()

        if "Email Sent" in resp.text:
            logging.info(f"Successfully sent email to {athlete_name} with template {template_name}")
            return {'success': True}
        else:
            logging.warning(f"Failed to send email: {resp.text}")
            return {'success': False, 'error': resp.text}

    def get_athletes_from_video_progress_page(self, html_content: str) -> List[str]:
        """Parses the HTML of the video progress page to extract athlete names."""
        soup = BeautifulSoup(html_content, 'html.parser')
        athlete_names = []
        table = soup.find('table', {'class': 'table'})
        if table:
            for row in table.find_all('tr')[1:]:  # Skip header row
                cells = row.find_all('td')
                if len(cells) > 0:
                    athlete_name = cells[0].text.strip()
                    if athlete_name:
                        athlete_names.append(athlete_name)
        return athlete_names

def main():
    """CLI interface for testing"""
    if len(sys.argv) < 2:
        print("Usage: python3 npid_api_client.py <method> [json_args]")
        print("\nAvailable methods:")
        print("  login, get_inbox_threads, get_message_detail, get_assignment_modal, "
              "assign_thread, search_contacts, search_player, get_athlete_details, "
              "update_video_profile, get_video_progress_page, get_page_content, "
              "send_email_to_athlete, get_athletes_from_video_progress_page")
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
            exclude_id = args.get('exclude_id')
            threads = client.get_inbox_threads(limit, filter_assigned, exclude_id)
            print(json.dumps(threads))
        elif method == 'get_message_detail':
            result = client.get_message_detail(args['message_id'], args['item_code'])
            print(json.dumps(result))
        elif method == 'get_assignment_modal':
            result = client.get_assignment_modal(
                args['message_id'], args.get('item_code', args['message_id'])
            )
            print(json.dumps(result))
        elif method == 'assign_thread':
            result = client.assign_thread(args)
            print(json.dumps(result))
        elif method == 'get_assignment_defaults':
            result = client.get_assignment_defaults(args['contact_id'])
            print(json.dumps(result))
        elif method == 'search_contacts':
            result = client.search_contacts(
                args['query'], args.get('search_type', 'athlete')
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
                args['player_id'], args['youtube_link'], args['season'], args['video_type']
            )
            print(json.dumps(result))
        elif method == 'get_video_progress_page':
            html_content = client.get_video_progress_page(args['athlete_name'])
            print(html_content)
        elif method == 'get_page_content':
            html_content = client.get_page_content(args['url'])
            print(html_content)
        elif method == 'send_email_to_athlete':
            result = client.send_email_to_athlete(args['athlete_name'], args['template_name'])
            print(json.dumps(result))
        elif method == 'get_athletes_from_video_progress_page':
            html_content = client.get_page_content("https://dashboard.nationalpid.com/videoteammsg/videomailprogress")
            athlete_names = client.get_athletes_from_video_progress_page(html_content)
            print(json.dumps(athlete_names))
        else:
            print(json.dumps({'error': f'Unknown method: {method}'}))
            sys.exit(1)
    except Exception:
        logging.exception("CLI execution failed")
        sys.exit(1)


if __name__ == '__main__':
    main()
