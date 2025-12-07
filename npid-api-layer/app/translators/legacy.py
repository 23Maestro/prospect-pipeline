"""
Legacy Translator
Converts clean API requests to legacy Laravel form data.
This is the core abstraction that isolates you from Laravel's quirks.
"""

import re
import json
import logging
from typing import Dict, Any, Optional, Tuple, List
from bs4 import BeautifulSoup
from app.models.schemas import VideoSubmitRequest, StageUpdateRequest, VideoSource, SendEmailRequest

logger = logging.getLogger(__name__)


class LegacyTranslator:
    """
    Translates between clean API models and legacy Laravel endpoints.
    When Laravel changes parameter names, you fix it here — nowhere else.
    """
    
    # ============== Request Translation ==============
    
    @staticmethod
    def video_submit_to_legacy(request: VideoSubmitRequest) -> Tuple[str, Dict[str, Any]]:
        """
        Convert VideoSubmitRequest to legacy form data.

        Mirrors: src/python/npid_api_client.py:859-873

        Returns:
            Tuple of (endpoint_path, form_data)
        """
        endpoint = f"/athlete/update/careervideos/{request.athlete_id}"

        # Extract season value from full season string (e.g., "18249" from "highschool:18249")
        # The season comes from the /API/scout-api/video-seasons-by-video-type response
        season_value = ""
        if request.season and ":" in request.season:
            # Parse season ID from value like "highschool:18249"
            # Format: {level}:{id} where level = highschool/middleschool/camp
            season_value = request.season.split(":")[-1]

        form_data = {
            # CRITICAL: Match exact field names from live capture
            "athleteviewtoken": "",  # Always empty per verified behavior
            "schoolinfo[add_video_season]": season_value,  # The ACTUAL season field (receives dropdown value)
            "sport_alias": request.sport,  # Required - which sport this video is for
            "url_source": request.source.value,  # 'youtube' or 'hudl'
            "newVideoLink": request.video_url,  # NOT 'youtubeLink'
            "videoType": request.video_type.value,  # Full Season Highlight, etc.
            "newVideoSeason": "",  # Always EMPTY (Laravel quirk: dropdown value goes to schoolinfo instead)
            "athlete_main_id": request.athlete_main_id,  # REQUIRED - from profile page
        }

        # The checkbox requires BOTH fields (legacy AngularJS nonsense)
        if request.auto_approve:
            form_data["approve_video"] = "1"
            # Note: approve_video_checkbox NOT included per live capture

        return endpoint, form_data
    
    @staticmethod
    def stage_update_to_legacy(request: StageUpdateRequest) -> Tuple[str, Dict[str, Any]]:
        """
        Convert StageUpdateRequest to legacy form data.
        Curl verified 2025-12-07. NO api_key, NO extra fields.

        Converts snake_case to Title Case for Laravel.
        """
        endpoint = "/API/scout-api/video-stage"

        # Convert snake_case to Title Case (e.g., "on_hold" -> "On Hold")
        stage_map = {
            "on_hold": "On Hold",
            "awaiting_client": "Awaiting Client",
            "in_queue": "In Queue",
            "done": "Done"
        }
        stage_value = stage_map.get(request.stage.value, "In Queue")

        form_data = {
            "video_msg_id": request.video_msg_id,
            "video_progress_stage": stage_value
        }

        return endpoint, form_data

    @staticmethod
    def status_update_to_legacy(video_msg_id: str, status: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert status update to legacy form data.
        Curl verified 2025-12-07. NO api_key, NO extra fields.
        """
        endpoint = "/API/scout-api/video-status"

        form_data = {
            "video_msg_id": video_msg_id,
            "video_progress_status": status
        }

        return endpoint, form_data

    @staticmethod
    def due_date_update_to_legacy(video_msg_id: str, due_date: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert due date update to legacy form data.

        Args:
            video_msg_id: Video message ID
            due_date: Due date in MM/DD/YYYY format
        """
        endpoint = "/tasks/videoduedate"

        form_data = {
            "video_msg_id": video_msg_id,
            "video_due_date": due_date,
        }

        return endpoint, form_data

    @staticmethod
    def video_progress_to_legacy(filters: Dict[str, str] = None) -> Tuple[str, Dict[str, Any]]:
        """
        Convert video progress filters to legacy form data.
        Mirrors: src/python/npid_api_client.py:1043-1089

        NO club fields - user requested removal.
        """
        endpoint = "/videoteammsg/videoprogress"

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
            "video_editor": "",
            "video_progress": "",
            "video_progress_stage": "",
            "video_progress_status": ""
        }

        if filters:
            form_data.update(filters)

        return endpoint, form_data
    
    @staticmethod
    def seasons_request_to_legacy(
        athlete_id: str,
        sport: str,
        video_type: str,
        athlete_main_id: str,
        api_key: str = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Build seasons fetch request.

        CRITICAL: This is the ONLY endpoint that requires api_key.
        All other video endpoints (status, stage, duedate, progress) use ONLY _token.
        """
        endpoint = "/API/scout-api/video-seasons-by-video-type"

        form_data = {
            "athlete_id": athlete_id,
            "sport_alias": sport,
            "video_type": video_type,
            "athlete_main_id": athlete_main_id,
        }

        # ONLY this endpoint needs api_key
        if api_key:
            form_data["api_key"] = api_key

        return endpoint, form_data
    
    # ============== Response Translation ==============
    
    @staticmethod
    def parse_video_submit_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse the nested garbage response from video submit.
        
        Laravel returns things like:
        {"status":"ok","data":{"success":true,"response":"\r\n{\"success\":\"false\",\"message\":\"..\"}"}}
        
        We need to dig out the actual result.
        """
        try:
            outer = json.loads(raw_response)
            
            # Check for nested response string
            if "data" in outer and "response" in outer["data"]:
                inner_str = outer["data"]["response"].strip()
                # Try to parse the inner JSON
                try:
                    inner = json.loads(inner_str)
                    return {
                        "success": inner.get("success") == "true" or inner.get("success") is True,
                        "message": inner.get("message", ""),
                        "raw": outer
                    }
                except json.JSONDecodeError:
                    # Inner response wasn't JSON
                    return {
                        "success": "success" in inner_str.lower() and "true" in inner_str.lower(),
                        "message": inner_str,
                        "raw": outer
                    }
            
            # Direct response
            return {
                "success": outer.get("success") == "true" or outer.get("success") is True,
                "message": outer.get("message", ""),
                "raw": outer
            }
            
        except json.JSONDecodeError:
            # Not JSON at all - probably HTML error page
            return {
                "success": False,
                "message": "Invalid response from server",
                "raw": raw_response[:500]
            }
    
    @staticmethod
    def parse_seasons_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse seasons response.
        
        This endpoint sometimes returns HTML <option> tags instead of JSON.
        We handle both.
        """
        try:
            data = json.loads(raw_response)
            
            if data.get("status") == "ok" and "data" in data:
                return {
                    "success": True,
                    "seasons": data["data"]
                }
            return {
                "success": False,
                "seasons": [],
                "error": "Unexpected response format"
            }
            
        except json.JSONDecodeError:
            # It's probably HTML - parse option tags
            seasons = []
            option_pattern = r'<option[^>]*value="([^"]*)"[^>]*>([^<]+)</option>'
            
            for match in re.finditer(option_pattern, raw_response):
                value, label = match.groups()
                if value:  # Skip empty placeholder option
                    seasons.append({
                        "value": value,
                        "label": label.strip(),
                        "season": "",  # Not available in HTML response
                        "school_added": ""
                    })
            
            return {
                "success": len(seasons) > 0,
                "seasons": seasons,
                "was_html": True
            }
    
    @staticmethod
    def parse_stage_update_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse stage update response.
        Laravel returns HTTP 200 with no meaningful body on success.
        Mirrors: src/python/npid_api_client.py:1319-1324
        """
        # Laravel just returns HTTP 200, no JSON to parse
        # Empty response or any content = success (HTTP status determines success)
        return {
            "success": True,
            "raw": raw_response[:500] if raw_response else ""
        }

    @staticmethod
    def parse_status_update_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse status update response.
        Laravel returns HTTP 200 with no meaningful body on success.
        Mirrors: src/python/npid_api_client.py:1346-1351
        """
        # Laravel just returns HTTP 200, no JSON to parse
        # Empty response or any content = success (HTTP status determines success)
        return {
            "success": True,
            "raw": raw_response[:500] if raw_response else ""
        }

    @staticmethod
    def parse_due_date_update_response(raw_response: str) -> Dict[str, Any]:
        """Parse due date update response.
        Laravel returns empty response (HTTP 200) on success."""
        # Laravel endpoint returns empty body on success
        if not raw_response or raw_response.strip() == "":
            return {
                "success": True,
                "message": "Due date updated (Laravel returned empty success response)"
            }

        # Try JSON parsing if response has content
        try:
            data = json.loads(raw_response)
            return {
                "success": True,
                "video_msg_id": data.get("video_msg_id"),
                "due_date": data.get("video_due_date"),
                "raw": data
            }
        except json.JSONDecodeError:
            # Non-empty but not JSON - treat as error
            return {
                "success": False,
                "error": "Invalid response format",
                "raw": raw_response[:500]
            }

    @staticmethod
    def parse_video_progress_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse video progress response.
        Response includes: positions (primaryposition, secondaryposition, thirdposition), video_due_date
        """
        try:
            data = json.loads(raw_response)
            if isinstance(data, list):
                return {"success": True, "tasks": data}
            return {"success": False, "tasks": [], "error": "Unexpected format"}
        except json.JSONDecodeError:
            return {"success": False, "tasks": [], "error": "Invalid JSON"}

    @staticmethod
    def extract_athlete_main_id(html: str) -> Optional[str]:
        """
        Extract athlete_main_id from HTML page.
        
        The ID might be in:
        - URL: /athlete/media/PLAYER_ID/MAIN_ID
        - Hidden input: <input name="athlete_main_id" value="...">
        - JavaScript: athlete_main_id = "..."
        """
        patterns = [
            r'/athlete/media/\d+/(\d+)',
            r'athlete_main_id["\s:=]+["\']?(\d+)',
            r'name="athlete_main_id"[^>]*value="(\d+)"',
            r'athleteMainId["\s:=]+["\']?(\d+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, html)
            if match:
                return match.group(1)

        return None

    # ============== Email Translators ==============

    @staticmethod
    def parse_email_templates(html_response: str) -> List[Dict[str, str]]:
        """
        Parse email template dropdown from HTML.
        GET /rulestemplates/template/sendingtodetails?id={athlete_id}
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        templates = []
        for option in soup.find_all('option'):
            if option.get('value'):
                templates.append({
                    "label": option.text.strip(),
                    "value": option.get('value')
                })
        return templates

    @staticmethod
    def template_data_to_legacy(template_id: str, athlete_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert template data request to legacy format.
        POST /admin/templatedata
        """
        endpoint = "/admin/templatedata"
        form_data = {
            "tmpl": template_id,
            "athlete_id": athlete_id
        }
        return endpoint, form_data

    @staticmethod
    def send_email_to_legacy(request: SendEmailRequest) -> Tuple[str, Dict[str, Any]]:
        """
        Convert send email request to legacy multipart form data.
        POST /admin/addnotification
        """
        endpoint = "/admin/addnotification"

        # Build form data matching Laravel expectations from user's verified curl
        form_data = {
            "notification_type_id": "1",
            "notification_to_type_id": "1",
            "notification_to_id": request.athlete_id,
            "notification_from": request.notification_from,
            "notification_from_email": request.notification_from_email,
            "notification_subject": request.notification_subject,
            "notification_message": request.notification_message,
            "indvtemplate": request.template_id,
            "_wysihtml5_mode": "1",
        }

        return endpoint, form_data
