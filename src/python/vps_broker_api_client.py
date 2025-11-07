#!/usr/bin/env python3
"""VPS Broker API Client - 12 confirmed endpoints"""

import requests
import pickle
import os
import logging
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Optional, Dict, List, Any

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(Path.home() / '.vps_broker.log'),
        logging.StreamHandler()
    ]
)


class VPSBrokerClient:
    """REST API client for VPS dashboard"""

    # Valid string values for stages/statuses
    STAGES = {
        "on_hold": "On Hold",
        "awaiting_client": "Awaiting Client",
        "in_queue": "In Queue",
        "done": "Done"
    }

    STATUSES = {
        "revisions": "Revisions",
        "hudl": "HUDL",
        "dropbox": "Dropbox",
        "external_links": "External Links",
        "not_approved": "Not Approved"
    }

    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://dashboard.nationalpid.com"
        # Share same session as npid_api_client
        self.cookie_file = Path.home() / '.npid_session.pkl'
        self.email = os.getenv('NPID_EMAIL', 'videoteam@prospectid.com')
        self.password = os.getenv('NPID_PASSWORD', '')
        self.csrf_token = None
        self.csrf_token_cache = {}  # Cache tokens by page URL for retry
        self._load_session()

    def _load_session(self):
        """Load pickled session cookies"""
        if self.cookie_file.exists():
            try:
                with open(self.cookie_file, 'rb') as f:
                    cookies = pickle.load(f)
                    self.session.cookies.update(cookies)
                logging.info("✅ Loaded session from cache")
            except Exception as e:
                logging.warning(f"⚠️  Failed to load session: {e}")

    def _save_session(self):
        """Save session cookies to pickle"""
        try:
            with open(self.cookie_file, 'wb') as f:
                pickle.dump(self.session.cookies, f)
            logging.info("✅ Saved session to cache")
        except Exception as e:
            logging.warning(f"⚠️  Failed to save session: {e}")

    def _get_csrf_token_from_page(self, url: str) -> str:
        """Extract CSRF token from any page"""
        try:
            resp = self.session.get(url)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            token_input = soup.find('input', {'name': '_token'})
            if token_input and token_input.get('value'):
                self.csrf_token = token_input['value']
                logging.info(f"🔑 Got CSRF token: {self.csrf_token[:20]}...")
                return self.csrf_token
            else:
                logging.error(f"❌ No _token input found on {url}")
                logging.error(f"Page title: {soup.find('title').text if soup.find('title') else 'No title'}")
        except Exception as e:
            logging.error(f"Failed to extract CSRF token: {e}")
        return None

    def authenticate(self, force: bool = False) -> bool:
        """Authenticate and get CSRF token"""
        token = self._get_csrf_token_from_page(
            f"{self.base_url}/rulestemplates/template/videoteammessagelist"
        )
        if token:
            self._save_session()
            return True
        return False

    def _is_csrf_failure(self, response) -> bool:
        """Detect if response is a CSRF failure (419, redirect, or HTML masquerading as JSON)"""
        # 419 = CSRF token mismatch
        if response.status_code == 419:
            return True

        # Check for redirect to login
        if response.status_code in (301, 302, 303, 307, 308):
            if '/login' in response.headers.get('location', ''):
                return True

        # Check if response is HTML login page
        if 'text/html' in response.headers.get('content-type', ''):
            if 'login' in response.text.lower() or '<title>' in response.text:
                if any(x in response.text for x in ['National Prospect ID | Login', '<title>Login</title>']):
                    return True

        # Laravel quirk: 200 OK but returns HTML instead of JSON (invalid session/CSRF)
        if response.status_code == 200 and 'text/html' in response.headers.get('content-type', ''):
            text_lower = response.text.lower()
            if '<!doctype html>' in text_lower or '<html' in text_lower:
                logging.warning("⚠️  Got HTML response instead of JSON (invalid session/CSRF)")
                return True

        return False

    def _get_token_for_modal(self, message_id: str = None) -> str:
        """Get fresh CSRF token from assignment modal page (auto-retry helper)"""
        # Use cached token if available for this modal
        modal_key = f"assignvideoteam_{message_id}" if message_id else "assignvideoteam"

        if modal_key in self.csrf_token_cache:
            cached_token = self.csrf_token_cache[modal_key]
            logging.debug(f"♻️  Using cached token for {modal_key}")
            return cached_token

        # Fetch fresh token from modal page
        modal_url = f"{self.base_url}/rulestemplates/template/assignemailtovideoteam"
        if message_id:
            modal_url += f"?message_id={message_id}"

        try:
            resp = self.session.get(modal_url, timeout=10)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            token_input = soup.find('input', {'name': '_token'})

            if token_input and token_input.get('value'):
                token = token_input['value']
                self.csrf_token = token
                self.csrf_token_cache[modal_key] = token
                logging.info(f"🔑 Fresh CSRF token cached: {token[:20]}...")
                return token
            else:
                logging.error(f"❌ No _token found on modal page: {modal_url}")
        except Exception as e:
            logging.error(f"Failed to fetch token from modal: {e}")

        return None

    def _retry_with_csrf(self, method: str, url: str, data: Dict = None,
                        headers: Dict = None, message_id: str = None) -> requests.Response:
        """Retry a request with fresh CSRF token if it fails with CSRF error"""
        # First attempt with current token
        resp = self.session.request(method, url, data=data, headers=headers, timeout=10)

        if not self._is_csrf_failure(resp):
            return resp

        # CSRF failure detected - get fresh token and retry
        logging.warning("⚠️  CSRF failure detected, fetching fresh token...")
        fresh_token = self._get_token_for_modal(message_id)

        if not fresh_token:
            logging.error("❌ Could not get fresh CSRF token, failing request")
            return resp

        # Update data with fresh token
        if data:
            data['_token'] = fresh_token
        elif headers:
            headers['X-CSRF-TOKEN'] = fresh_token

        # Retry request
        logging.info("🔄 Retrying request with fresh CSRF token...")
        resp = self.session.request(method, url, data=data, headers=headers, timeout=10)
        return resp

    # === INBOX ENDPOINTS (6) ===

    def get_inbox(self) -> List[Dict[str, Any]]:
        """GET /rulestemplates/template/videoteammessagelist"""
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videoteammessagelist"
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return []

    def get_thread(self, thread_id: str) -> Dict[str, Any]:
        """GET /rulestemplates/template/videoteammessage_subject?id={thread_id}"""
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videoteammessage_subject",
            params={"id": thread_id}
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return {}

    def get_assign_email_to_team(self, thread_id: str) -> Dict[str, Any]:
        """GET /rulestemplates/template/assignemailtovideoteam?id={thread_id}"""
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/assignemailtovideoteam",
            params={"id": thread_id}
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return {}

    def search_contacts(self, search: str) -> List[Dict[str, Any]]:
        """GET /template/calendaraccess/contactslist?search={query}"""
        resp = self.session.get(
            f"{self.base_url}/template/calendaraccess/contactslist",
            params={"search": search}
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return []

    def get_video_progress(self, filters: Dict[str, str] = None) -> List[Dict[str, Any]]:
        """POST /videoteammsg/videoprogress - Fetch video progress data with CSRF retry"""
        form_data = {
            "first_name": "",
            "last_name": "",
            "email": "",
            "sport": "0",
            "states": "0",
            "athlete_school": "0",
            "editorassigneddatefrom": "",
            "editorassigneddateto": "",
            "grad_year": "",
            "select_club_sport": "",
            "select_club_state": "",
            "select_club_name": "",
            "video_editor": "",
            "video_progress": "",
            "video_progress_stage": "",
            "video_progress_status": ""
        }

        # Apply optional filters
        if filters:
            form_data.update(filters)

        headers = {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
        }

        resp = self._retry_with_csrf(
            method='POST',
            url=f"{self.base_url}/videoteammsg/videoprogress",
            data=form_data,
            headers=headers
        )

        try:
            if resp.status_code == 200:
                return resp.json()
            else:
                logging.error(f"Failed to fetch video progress: {resp.status_code}")
                return []
        except Exception as e:
            logging.error(f"Error parsing video progress response: {e}")
            return []

    def assign_thread(self, payload: Dict[str, Any]) -> bool:
        """POST /videoteammsg/assignvideoteam - Full assignment with all fields"""
        # Get CSRF token from assignment modal page (has actual form with _token)
        message_id_temp = payload.get('messageId', 'message_id12870')
        # Keep the full message_id format for the modal URL parameter
        self._get_csrf_token_from_page(
            f"{self.base_url}/rulestemplates/template/assignemailtovideoteam?message_id={message_id_temp}"
        )

        # Extract fields from payload
        message_id_raw = payload.get('messageId') or payload.get('thread_id')
        # Strip "message_id" prefix to get numeric ID only
        message_id = message_id_raw.replace('message_id', '') if message_id_raw else ''
        contact_id = payload.get('contactId') or payload.get('contact_id', '')
        athlete_main_id = payload.get('athleteMainId', '')
        owner_id = payload.get('ownerId', '1408164')  # Default to Jerami
        stage = payload.get('stage', '')
        status = payload.get('status', '')
        contact_for = payload.get('contactFor', 'athlete')
        contact_email = payload.get('contact', '')
        
        # EXACT field names from working browser request - no duplicates
        form_data = {
            '_token': self.csrf_token,
            'contact_task': contact_id,
            'athlete_main_id': athlete_main_id,
            'messageid': message_id,  # Numeric ID only, no "message_id" prefix
            'videoscoutassignedto': owner_id,
            'contactfor': contact_for,
            'contact': contact_email,
            'video_progress_stage': stage,
            'video_progress_status': status
        }
        
        logging.info(f"🔍 Assignment payload: {form_data}")

        # Use CSRF retry middleware for robust request handling
        resp = self._retry_with_csrf(
            method='POST',
            url=f"{self.base_url}/videoteammsg/assignvideoteam",
            data=form_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            message_id=message_id
        )

        logging.info(f"🔍 Response status: {resp.status_code}")
        logging.info(f"🔍 Response text (first 300 chars): {resp.text[:300]}")

        # Check if we got redirected to login page
        if self._is_csrf_failure(resp):
            logging.warning("⚠️ CSRF/session failed even after retry, re-authenticating...")
            if self.authenticate():
                # Retry assignment with fresh session
                logging.info("🔄 Retrying assignment after full re-auth...")
                return self.assign_thread(payload)
            else:
                logging.error("❌ Re-authentication failed")
                return False

        if resp.status_code == 200:
            logging.info(f"✅ Assigned thread {message_id} to owner {owner_id}")
            return True
        else:
            logging.error(f"❌ Assignment failed: {resp.status_code} - {resp.text[:200]}")
            return False

    def send_reply(self, thread_id: str, message: str) -> bool:
        """POST /videoteammsg/sendmessage"""
        if not self.csrf_token:
            self._get_csrf_token_from_page(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist"
            )

        payload = {
            "_token": self.csrf_token,
            "videoteam_mailbox_id": thread_id,
            "message": message
        }
        resp = self.session.post(
            f"{self.base_url}/videoteammsg/sendmessage",
            data=payload
        )
        return resp.status_code == 200

    # === PROGRESS ENDPOINTS (2) ===

    def update_stage(self, thread_id: str, stage: str) -> bool:
        """POST /tasks/videostage - Update stage using STRING values with CSRF retry"""
        if stage not in self.STAGES:
            raise ValueError(f"Invalid stage: {stage}. Valid: {list(self.STAGES.keys())}")

        if not self.csrf_token:
            self._get_csrf_token_from_page(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist"
            )

        payload = {
            "_token": self.csrf_token,
            "video_msg_id": thread_id,
            "video_progress_stage": self.STAGES[stage]
        }

        resp = self._retry_with_csrf(
            method='POST',
            url=f"{self.base_url}/tasks/videostage",
            data=payload
        )
        return resp.status_code == 200

    def update_status(self, thread_id: str, status: str) -> bool:
        """POST /tasks/videocompletemessage - Update status using STRING values with CSRF retry"""
        if status not in self.STATUSES:
            raise ValueError(f"Invalid status: {status}. Valid: {list(self.STATUSES.keys())}")

        if not self.csrf_token:
            self._get_csrf_token_from_page(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist"
            )

        payload = {
            "_token": self.csrf_token,
            "video_msg_id": thread_id,
            "video_progress_status": self.STATUSES[status]
        }

        resp = self._retry_with_csrf(
            method='POST',
            url=f"{self.base_url}/tasks/videocompletemessage",
            data=payload
        )
        return resp.status_code == 200

    # === DELIVERABLES ENDPOINTS (2) ===

    def post_video(self, contact_id: str, youtube_url: str, athlete_id: str,
                   sport: str = "football", video_type: str = "Partial Season Highlight",
                   season: str = "highschool:16267") -> Dict[str, Any]:
        """POST /athlete/update/careervideos/{contact_id}"""
        if not self.csrf_token:
            self._get_csrf_token_from_page(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist"
            )

        payload = {
            "_token": self.csrf_token,
            "athleteviewtoken": "",
            "schoolinfo[add_video_season]": "sophomore",
            "sport_alias": sport,
            "url_source": "youtube",
            "newVideoLink": youtube_url,
            "videoType": video_type,
            "newVideoSeason": season,
            "athlete_main_id": athlete_id
        }
        resp = self.session.post(
            f"{self.base_url}/athlete/update/careervideos/{contact_id}",
            data=payload
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return {"success": resp.status_code == 200}

    def unapprove_video(self, video_id: str, athlete_id: str) -> bool:
        """POST /career/unapprovevideo - Remove old approved video"""
        if not self.csrf_token:
            self._get_csrf_token_from_page(
                f"{self.base_url}/rulestemplates/template/videoteammessagelist"
            )

        payload = {
            "video_id": video_id,
            "_token": self.csrf_token,
            "athlete_id": athlete_id
        }
        resp = self.session.post(
            f"{self.base_url}/career/unapprovevideo",
            data=payload
        )
        return resp.status_code == 200

    # === EMAIL ENDPOINTS (2) ===

    def get_email_templates(self, contact_id: str) -> List[Dict[str, Any]]:
        """GET /rulestemplates/template/videotemplates?id={contact_id}"""
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videotemplates",
            params={"id": contact_id}
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return []

    def get_sending_details(self, contact_id: str) -> Dict[str, Any]:
        """GET /rulestemplates/template/sendingtodetails?id={contact_id}"""
        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/sendingtodetails",
            params={"id": contact_id}
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except:
            return {}


def main():
    """CLI interface for testing"""
    import sys
    import json
    
    if len(sys.argv) < 2:
        print("Usage: python3 vps_broker_api_client.py <method> [json_args]")
        print("\nAvailable methods:")
        print("  authenticate, get_inbox, get_thread, get_assign_email_to_team,")
        print("  search_contacts, get_video_progress, assign_thread, send_reply,")
        print("  update_stage, update_status, post_video, unapprove_video,")
        print("  get_email_templates, get_sending_details")
        sys.exit(1)
    
    method = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    client = VPSBrokerClient()
    
    try:
        if method == 'authenticate':
            result = client.authenticate()
            print(json.dumps({'success': result}))
        elif method == 'get_inbox':
            result = client.get_inbox()
            print(json.dumps(result))
        elif method == 'get_thread':
            result = client.get_thread(args['thread_id'])
            print(json.dumps(result))
        elif method == 'get_assign_email_to_team':
            result = client.get_assign_email_to_team(args['thread_id'])
            print(json.dumps(result))
        elif method == 'search_contacts':
            result = client.search_contacts(args['search'])
            print(json.dumps(result))
        elif method == 'get_video_progress':
            filters = args.get('filters', {}) if isinstance(args, dict) else {}
            result = client.get_video_progress(filters)
            print(json.dumps(result))
        elif method == 'assign_thread':
            result = client.assign_thread(args)
            print(json.dumps({'success': result}))
        elif method == 'send_reply':
            result = client.send_reply(args['thread_id'], args['message'])
            print(json.dumps({'success': result}))
        elif method == 'update_stage':
            result = client.update_stage(args['thread_id'], args['stage'])
            print(json.dumps({'success': result}))
        elif method == 'update_status':
            result = client.update_status(args['thread_id'], args['status'])
            print(json.dumps({'success': result}))
        elif method == 'post_video':
            result = client.post_video(
                args['contact_id'],
                args['youtube_url'],
                args['athlete_id'],
                args.get('sport', 'football'),
                args.get('video_type', 'Partial Season Highlight'),
                args.get('season', 'highschool:16267')
            )
            print(json.dumps(result))
        elif method == 'unapprove_video':
            result = client.unapprove_video(args['video_id'], args['athlete_id'])
            print(json.dumps({'success': result}))
        elif method == 'get_email_templates':
            result = client.get_email_templates(args['contact_id'])
            print(json.dumps(result))
        elif method == 'get_sending_details':
            result = client.get_sending_details(args['contact_id'])
            print(json.dumps(result))
        else:
            print(json.dumps({'error': f'Unknown method: {method}'}))
            sys.exit(1)
    except Exception as e:
        logging.exception("CLI execution failed")
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
