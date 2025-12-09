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
import html2text
from email_reply_parser import EmailReplyParser
from html import escape
from app.models.schemas import (
    VideoSubmitRequest,
    StageUpdateRequest,
    VideoSource,
    SendEmailRequest,
    AddNoteRequest
)

logger = logging.getLogger(__name__)


class LegacyTranslator:
    """
    Translates between clean API models and legacy Laravel endpoints.
    When Laravel changes parameter names, you fix it here — nowhere else.
    """

    SIGNATURE_HTML = (
        "<br><br><span>Kind Regards,</span><div><br></div><table style=\"width: 100%;font-size: 14px;\" "
        "width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tbody><tr><td style=\"padding: "
        "0cm; border: none !important;\" valign=\"top\"><span><b>Jerami Singleton</b></span><br>"
        "<span style=\"color: #232a36;\"><em>Content Creator at Prospect ID</em></span><br>"
        "<span style=\"color: #232a36;font-weight: bold;\">Phone</span>&nbsp;(407) 473-3637<br>"
        "<span style=\"color: #232a36;font-weight: bold;\">Email</span>&nbsp;videoteam@prospectid.com<br>"
        "<span style=\"color: #232a36;font-weight: bold;\">Web</span>&nbsp;www.nationalpid.com<br>"
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href=https://www.facebook.com/NationalPID target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/facebook_sign.png' "
        "alt='facebook' width='24' height='24' border='0'></a> "
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href=https://twitter.com/@NationalPID target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/twitter_sign.png' "
        "alt='twitter' width='24' height='24' border='0'></a> "
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href=https://www.instagram.com/nationalprospect_id target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/instagram_sign.png' "
        "alt='instagram' width='24' height='24' border='0'></a>  </td></tr></tbody></table><br>"
    )

    SIGNATURE_HTML = (
        "<br><br><span>Kind Regards,</span><div><br></div><table style=\"width: 100%;font-size: 14px;\" "
        "width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tbody><tr><td style=\"padding: "
        "0cm; border: none !important;\" valign=\"top\"><span><b>Jerami Singleton</b></span><br><span style=\"color: "
        "#232a36;\"><em>Content Creator at Prospect ID</em></span><br><span style=\"color: #232a36;font-weight: bold;\">Phone" 
        "</span>&nbsp;(407) 473-3637<br><span style=\"color: #232a36;font-weight: bold;\">Email</span>&nbsp;videoteam@prospectid.com"
        "<br><span style=\"color: #232a36;font-weight: bold;\">Web</span>&nbsp;www.nationalpid.com<br><a style='font-size: 0px;"
        " line-height: 0px; padding-right: 3px;' href=https://www.facebook.com/NationalPID target='_blank'><img src='"
        "https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/facebook_sign.png' alt='facebook' width='24' "
        "height='24' border='0'></a> <a style='font-size: 0px; line-height: 0px; padding-right: 3px;' href=https://twitter.com/@NationalPID "
        "target='_blank'><img src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/twitter_sign.png' alt='twitter' "
        "width='24' height='24' border='0'></a> <a style='font-size: 0px; line-height: 0px; padding-right: 3px;' href=https://www.instagram.com/"
        "nationalprospect_id target='_blank'><img src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/instagram_sign.png' "
        "alt='instagram' width='24' height='24' border='0'></a>  </td></tr></tbody></table><br>"
    )
    
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
            form_data["approve_video_checkbox"] = "1"
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

        # Map snake_case/lowercase to Title Case for Laravel
        status_map = {
            "revisions": "Revisions",
            "hudl": "HUDL",
            "dropbox": "Dropbox",
            "external_links": "External Links",
            "not_approved": "Not Approved",
        }
        status_value = status_map.get(status.lower(), "HUDL")

        form_data = {
            "video_msg_id": video_msg_id,
            "video_progress_status": status_value
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
            "return_type": "html"
        }

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
            if isinstance(data, list):
                return {"success": True, "seasons": data}
            if isinstance(data, dict):
                if data.get("status") == "ok" and "data" in data:
                    return {"success": True, "seasons": data["data"]}
                if "seasons" in data and isinstance(data["seasons"], list):
                    return {"success": True, "seasons": data["seasons"]}
                return {
                    "success": False,
                    "seasons": [],
                    "error": data.get("message", "Unexpected response format")
                }
            return {"success": False, "seasons": [], "error": "Invalid JSON response"}
            
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

    # ============== Inbox Translators ==============
    # Ported from: src/python/npid_api_client.py

    @staticmethod
    def inbox_threads_to_legacy(limit: int, filter_assigned: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert inbox threads request to legacy params.
        GET /rulestemplates/template/videoteammessagelist
        Mirrors: npid_api_client.py:232-244
        """
        endpoint = "/rulestemplates/template/videoteammessagelist"
        params = {
            "athleteid": "",
            "user_timezone": "America/New_York",
            "type": "inbox",
            "is_mobile": "",
            "filter_self": "Me/Un",
            "refresh": "false",
            "page_start_number": "1",
            "search_text": ""
        }
        return endpoint, params

    @staticmethod
    def parse_inbox_threads_response(html_response: str, filter_assigned: str) -> Dict[str, Any]:
        """
        Parse inbox threads from HTML.
        Mirrors: npid_api_client.py:247-337
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        threads = []

        message_elements = soup.select('div.ImageProfile')
        for elem in message_elements:
            try:
                item_id = elem.get('itemid')
                item_code = elem.get('itemcode')
                message_id = elem.get('id')

                if not item_id:
                    continue

                # Check assignment status via plus icon
                plus_icon = elem.select_one('i.fa-plus-circle')
                has_plus = plus_icon is not None

                if filter_assigned == 'unassigned' and not has_plus:
                    continue
                if filter_assigned == 'assigned' and has_plus:
                    continue

                # Extract fields
                email_elem = elem.select_one('.hidden')
                email = email_elem.text.strip() if email_elem else ""
                contact_id = elem.get('contacttask', '')
                athlete_main_id = elem.get('athletemainid', '')

                name_elem = elem.select_one('.msg-sendr-name')
                raw_name = name_elem.text.strip() if name_elem else "Unknown"
                # Title case the name
                name = raw_name.title() if raw_name else "Unknown"

                subject_elem = elem.select_one('.tit_line1')
                raw_subject = subject_elem.text.strip() if subject_elem else ""
                # Clean subject: remove RE:/Re:/Fwd: prefixes
                subject = re.sub(r'^(Re:\s*|RE:\s*|Fwd:\s*|FWD:\s*)+', '', raw_subject).strip()

                preview_elem = elem.select_one('.tit_univ')
                preview = preview_elem.text.strip()[:300] if preview_elem else ""

                date_elem = elem.select_one('.date_css')
                timestamp = date_elem.text.strip() if date_elem else ""

                # Attachments
                attachments = []
                for att_elem in elem.select('.attachment-item'):
                    attachments.append({
                        "fileName": att_elem.get('data-filename', 'Unknown'),
                        "url": att_elem.get('data-url', ''),
                        "downloadable": bool(att_elem.get('data-url'))
                    })

                threads.append({
                    "id": message_id or item_id,
                    "itemCode": item_code or item_id,
                    "message_id": message_id or item_id,
                    "contact_id": contact_id,
                    "athleteMainId": athlete_main_id,
                    "name": name,
                    "email": email,
                    "subject": subject,
                    "preview": preview,
                    "content": preview,
                    "timestamp": timestamp,
                    "can_assign": has_plus,
                    "canAssign": has_plus,
                    "isUnread": 'unread' in elem.get('class', []),
                    "attachments": attachments
                })
            except Exception as e:
                logger.warning(f"Failed to parse thread: {e}")
                continue

        return {"threads": threads}

    @staticmethod
    def message_detail_to_legacy(message_id: str, item_code: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert message detail request to legacy params.
        GET /rulestemplates/template/videoteammessage_subject
        """
        endpoint = "/rulestemplates/template/videoteammessage_subject"
        clean_id = message_id.replace('message_id', '', 1) if message_id.startswith('message_id') else message_id
        params = {
            "message_id": clean_id,
            "itemcode": item_code,
            "type": "inbox",
            "user_timezone": "America/New_York",
            "filter_self": "Me/Un"
        }
        return endpoint, params

    @staticmethod
    def _parse_email_content(raw_content: str, strip_template: bool = True) -> str:
        """
        Clean email content using html2text and email_reply_parser.
        
        - Converts HTML to clean markdown/text
        - Uses email_reply_parser to extract visible reply (strips quoted replies)
        - Optionally strips NPID video instructions template
        """
        if not raw_content:
            return ""
        
        content = raw_content
        
        # Convert HTML to text using html2text
        if '<html' in content.lower() or '<body' in content.lower() or '<div' in content.lower():
            h = html2text.HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            h.ignore_emphasis = False
            h.body_width = 0  # No line wrapping
            content = h.handle(content)
        
        # Strip NPID video instructions template
        if strip_template:
            template_markers = [
                "This is a friendly reminder that we need video footage",
                "Please let me know where you are in the process",
                "…don't have video footage yet",
                "…have Hudl, Crossover",
                "NPID Dropbox folder",
                "Video Team at National Prospect ID",
                "18291 N. Pima Road",
                "helping thousands of athletes connect to college coaches",
                "Connect With Us",
            ]
            
            # Check if this is mostly template content
            template_count = sum(1 for m in template_markers if m.lower() in content.lower())
            if template_count >= 2:
                # Find and remove template - it usually starts after "On ... wrote:"
                wrote_match = re.search(
                    r'On\s+[A-Za-z]{3,4},?\s*[A-Za-z]{3}\s+\d{1,2},?\s*\d{4}.+?wrote:',
                    content, re.IGNORECASE | re.DOTALL
                )
                if wrote_match:
                    # Keep only content before "On ... wrote:"
                    content = content[:wrote_match.start()].strip()
        
        # Use email_reply_parser to extract just the visible reply (most recent)
        parsed = EmailReplyParser.parse_reply(content)
        
        # Clean up excessive whitespace
        lines = parsed.split('\n')
        cleaned = []
        prev_empty = False
        for line in lines:
            is_empty = not line.strip()
            if is_empty and prev_empty:
                continue
            cleaned.append(line)
            prev_empty = is_empty
        
        return '\n'.join(cleaned).strip()

    @staticmethod
    def parse_message_detail_response(response_text: str, message_id: str, item_code: str) -> Dict[str, Any]:
        """
        Parse message detail from JSON response.
        Uses html2text and email_reply_parser for clean extraction.
        """
        try:
            data = json.loads(response_text.strip())
            raw_content = data.get('message_plain', '') or data.get('message', '')
            raw_message_html = data.get('message', '') or data.get('body_html', '')
            
            # Parse and clean the email content
            content = LegacyTranslator._parse_email_content(raw_content, strip_template=True)
            
            # Clean subject
            raw_subject = data.get('subject', '') or data.get('message_subject', '')
            subject = re.sub(r'^(Re:\s*|RE:\s*|Fwd:\s*|FWD:\s*)+', '', raw_subject).strip()
            
            # Title case the name  
            raw_name = data.get('from_name', '')
            from_name = raw_name.title() if raw_name else ''

            return {
                "message_id": message_id,
                "item_code": item_code,
                "content": content,
                "subject": subject,
                "from_email": data.get('from_email', ''),
                "from_name": from_name,
                "timestamp": data.get('time_stamp', '') or data.get('timestamp', ''),
                "timestamp_wrote": data.get('time_stamp_wrote', ''),
                "raw_message_html": raw_message_html,
                "raw_subject": raw_subject,
            }
        except Exception as e:
            logger.warning(f"Failed to parse message detail: {e}")
            return {"message_id": message_id, "item_code": item_code, "content": ""}

    @staticmethod
    def assignment_modal_to_legacy(message_id: str, item_code: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert assignment modal request to legacy params.
        GET /rulestemplates/template/assignemailtovideoteam
        """
        endpoint = "/rulestemplates/template/assignemailtovideoteam"
        params = {"message_id": message_id, "itemcode": item_code}
        return endpoint, params

    @staticmethod
    def parse_assignment_modal_response(html_response: str) -> Dict[str, Any]:
        """
        Parse assignment modal from HTML.
        Mirrors: npid_api_client.py:424-485
        """
        soup = BeautifulSoup(html_response, 'html.parser')

        # Extract CSRF token
        token_input = soup.select_one('input[name="_token"]')
        form_token = token_input['value'] if token_input else ""

        # Extract owners
        owners = []
        owner_select = soup.select_one('select[name="videoscoutassignedto"]')
        if owner_select:
            for option in owner_select.select('option'):
                owners.append({
                    "value": option.get('value', '').strip(),
                    "label": option.text.strip()
                })

        # Extract stages
        stages = []
        stage_select = soup.select_one('select[name="video_progress_stage"]')
        if stage_select:
            for option in stage_select.select('option'):
                stages.append({
                    "value": option.get('value', '').strip(),
                    "label": option.text.strip()
                })

        # Extract statuses
        statuses = []
        status_select = soup.select_one('select[name="video_progress_status"]')
        if status_select:
            for option in status_select.select('option'):
                statuses.append({
                    "value": option.get('value', '').strip(),
                    "label": option.text.strip()
                })

        # Extract other fields
        contact_input = soup.select_one('input[name="contact"]')
        contact_search = contact_input.get('value', '') if contact_input else ""

        contact_for_select = soup.select_one('select[name="contactfor"]')
        default_search_for = 'athlete'
        if contact_for_select:
            selected = contact_for_select.select_one('option[selected]')
            if selected:
                default_search_for = selected.get('value', '').strip() or 'athlete'

        contact_task_input = soup.select_one('input[name="contact_task"]')
        contact_task = contact_task_input.get('value', '').strip() if contact_task_input else ""

        athlete_input = soup.select_one('input[name="athlete_main_id"]')
        athlete_main_id = athlete_input.get('value', '').strip() if athlete_input else ""

        message_id_input = soup.select_one('input[name="messageid"]')
        message_id_value = message_id_input.get('value', '').strip() if message_id_input else ""

        # Default owner (Jerami)
        jerami_id = '1408164'
        default_owner = None
        if owners:
            default_owner = next((o for o in owners if o['value'] == jerami_id), None) or owners[0]

        return {
            "formToken": form_token,
            "owners": owners,
            "stages": stages,
            "videoStatuses": statuses,
            "contactSearchValue": contact_search,
            "athleteMainId": athlete_main_id,
            "contactTask": contact_task,
            "messageId": message_id_value,
            "defaultSearchFor": default_search_for,
            "defaultOwner": default_owner,
            "contactFor": default_search_for
        }

    @staticmethod
    def assign_thread_to_legacy(payload: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Convert assign thread request to legacy form data.
        POST /videoteammsg/assignvideoteam
        
        Curl verified 2025-12-08:
        _token, contact_task, athlete_main_id, messageid, videoscoutassignedto,
        contactfor, contact, video_progress_stage, video_progress_status
        """
        endpoint = "/videoteammsg/assignvideoteam"

        # Extract values from payload - handle both naming conventions from frontend
        contact_id = payload.get('contact_id') or payload.get('contactId', '')
        athlete_main_id = payload.get('athleteMainId', '') or ''
        stage = payload.get('stage', '') or ''
        status = payload.get('status', '') or ''
        
        # Clean the message ID - remove 'message_id' prefix if present
        message_id = str(payload.get('messageId', ''))
        if message_id.startswith('message_id'):
            message_id = message_id.replace('message_id', '')

        # EXACT form data matching curl - NO duplicate fields
        form_data = {
            "_token": payload.get('formToken', ''),
            "contact_task": contact_id,
            "athlete_main_id": athlete_main_id,
            "messageid": message_id,
            "videoscoutassignedto": payload.get('ownerId', '1408164'),
            "contactfor": payload.get('contactFor', 'athlete'),
            "contact": payload.get('contact', ''),
            "video_progress_stage": stage,
            "video_progress_status": status,
        }


        return endpoint, form_data

    @staticmethod
    def parse_assign_thread_response(response_text: str) -> Dict[str, Any]:
        """
        Parse assign thread response.
        Response format: contact_task=X&athlete_main_id=Y&messageid=Z&...
        """
        result = {"success": True}

        if not response_text.strip():
            return result

        # Try JSON first
        try:
            data = json.loads(response_text)
            return {"success": data.get('success', True)}
        except:
            pass

        # Parse form-encoded response body
        # Format: contact_task=1441304&athlete_main_id=931626&messageid=13427&...
        from urllib.parse import parse_qs
        try:
            params = parse_qs(response_text)
            result["contact_id"] = params.get('contact_task', [''])[0]
            result["athlete_main_id"] = params.get('athlete_main_id', [''])[0]
            result["message_id"] = params.get('messageid', [''])[0]
        except:
            pass

        return result

    @staticmethod
    def contact_search_to_legacy(query: str, search_type: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert contact search request to legacy params.
        GET /template/calendaraccess/contactslist
        """
        endpoint = "/template/calendaraccess/contactslist"
        params = {"search": query, "searchfor": search_type}
        return endpoint, params

    @staticmethod
    def parse_contact_search_response(html_response: str) -> Dict[str, Any]:
        """
        Parse contact search from HTML table.
        Mirrors: npid_api_client.py:607-649
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        contacts = []

        rows = soup.select('tr')[1:]  # Skip header
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
                    contacts.append({
                        "contactId": contact_id,
                        "athleteMainId": athlete_main_id,
                        "name": contact_name,
                        "ranking": cells[1].text.strip(),
                        "gradYear": cells[2].text.strip(),
                        "state": cells[3].text.strip(),
                        "sport": cells[4].text.strip()
                    })
            except Exception:
                continue

        return {"contacts": contacts}

    @staticmethod
    def assignment_defaults_to_legacy(contact_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert assignment defaults request to legacy params.
        GET /rulestemplates/messageassigninfo
        """
        endpoint = "/rulestemplates/messageassigninfo"
        params = {"contacttask": contact_id}
        return endpoint, params

    @staticmethod
    def parse_assignment_defaults_response(response_text: str) -> Dict[str, Any]:
        """
        Parse assignment defaults from JSON.
        """
        try:
            data = json.loads(response_text) if response_text else {}
            return {
                "stage": data.get('stage'),
                "status": data.get('video_progress_status')
            }
        except:
            return {"stage": None, "status": None}

    @staticmethod
    def notes_list_to_legacy(athlete_id: str, athlete_main_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Build request for athlete notes list.
        GET /template/template/athlete_noteslist
        """
        endpoint = "/template/template/athlete_noteslist"
        params = {"id": athlete_id, "athlete_main_id": athlete_main_id}
        return endpoint, params

    @staticmethod
    def parse_notes_list_response(html_response: str) -> Dict[str, Any]:
        """
        Parse athlete notes HTML table/list into normalized entries.
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        notes = []

        # Primary fallback: table rows
        rows = soup.select('tr')
        for row in rows:
            if row.find('th'):
                continue
            cells = row.find_all('td')
            if not cells:
                continue
            text_cells = [cell.get_text(" ", strip=True) for cell in cells]
            title = text_cells[0] if text_cells else "Note"
            description = text_cells[-1] if len(text_cells) > 1 else ""
            metadata = " | ".join(text_cells[1:-1]) if len(text_cells) > 2 else None
            notes.append({
                "title": title or "Note",
                "description": description,
                "metadata": metadata,
                "created_by": row.get('data-createdby'),
                "created_at": row.get('data-created')
            })

        # Secondary fallback: list items
        if not notes:
            items = soup.select('.noteslist li, .note_item, .notes_list_item')
            for item in items:
                title = item.find(class_='title') or item.find('strong')
                meta = item.find(class_='meta')
                body = item.find(class_='description') or item
                notes.append({
                    "title": title.get_text(" ", strip=True) if title else "Note",
                    "description": body.get_text(" ", strip=True) if body else "",
                    "metadata": meta.get_text(" ", strip=True) if meta else None,
                    "created_by": item.get('data-createdby'),
                    "created_at": item.get('data-created')
                })

        if not notes:
            # As a last resort, return the raw text so UI can display something useful
            text_content = soup.get_text("\n", strip=True)
            if text_content:
                notes.append({
                    "title": "Notes",
                    "description": text_content,
                    "metadata": None,
                    "created_by": None,
                    "created_at": None
                })

        return {"success": True, "notes": notes}

    @staticmethod
    def add_note_to_legacy(request: AddNoteRequest) -> Tuple[str, Dict[str, Any]]:
        """
        Convert AddNoteRequest to legacy form data.
        POST /tasks/addnote
        """
        endpoint = "/tasks/addnote"
        form_data = {
            "athlete_id": request.athlete_id,
            "athlete_main_id": request.athlete_main_id,
            "notestitle": request.title,
            "notesdescription": request.description,
            "existingnote": ""
        }
        return endpoint, form_data

    @staticmethod
    def parse_add_note_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse add note response (Laravel returns HTML or JSON).
        """
        if not raw_response.strip():
            return {"success": True, "message": "Note added"}
        try:
            data = json.loads(raw_response)
            if isinstance(data, dict):
                return {
                    "success": data.get("success", True),
                    "message": data.get("message", "Note added")
                }
        except json.JSONDecodeError:
            pass
        return {"success": True, "message": "Note added"}

    @staticmethod
    def reply_form_to_legacy(message_id: str, item_code: str) -> Tuple[str, Dict[str, Any]]:
        """
        Get reply form data to fetch CSRF token.
        GET /rulestemplates/template/videoteam_msg_sendingto
        """
        endpoint = "/rulestemplates/template/videoteam_msg_sendingto"
        params = {"id": message_id, "itemcode": item_code, "tab": "inbox"}
        return endpoint, params

    @staticmethod
    def parse_reply_form_response(html_response: str, message_id: str) -> Dict[str, Any]:
        """
        Parse reply form to extract CSRF token and thread data.
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        token = soup.find('input', {'name': '_token'})
        return {
            "csrf_token": token.get('value') if token else '',
            "message_id": message_id
        }

    @staticmethod
    def _format_reply_text(reply_text: str) -> str:
        if not reply_text:
            return ""
        return escape(reply_text).replace('\n', '<br>')

    @classmethod
    def _build_previous_message_block(cls, message_id: str, detail_data: Dict[str, Any]) -> str:
        original_html = detail_data.get('raw_message_html') or detail_data.get('content') or ''
        if not original_html:
            return ""
        timestamp = detail_data.get('timestamp_wrote') or detail_data.get('timestamp') or ''
        pieces = [cls.SIGNATURE_HTML]
        if timestamp:
            pieces.append(f" {timestamp} ")
        pieces.append(original_html)
        inner = ''.join(pieces)
        return f"<div id=\"previous_message{message_id}\">{inner}</div>"

    @staticmethod
    def send_reply_to_legacy(message_id: str, item_code: str, reply_text: str, thread_data: Dict, detail_data: Dict[str, Any]) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
        """
        Convert send reply to legacy form data.
        POST /videoteammsg/sendmessage
        """
        endpoint = "/videoteammsg/sendmessage"
        subject_source = detail_data.get('raw_subject') or detail_data.get('subject') or ''
        formatted_subject = f"Re: {subject_source}" if subject_source else "Re: Video Team"
        reply_main_id = detail_data.get('message_id') or message_id
        reply_body = LegacyTranslator._format_reply_text(reply_text)
        previous_block = LegacyTranslator._build_previous_message_block(message_id, detail_data)
        full_message = f"{reply_body}{previous_block}"

        form_data = {
            "_token": thread_data.get('csrf_token', ''),
            "message_type": "send",
            "reply_message_id": message_id,
            "reply_main_id": reply_main_id,
            "draftid": "",
            "message_subject": formatted_subject,
            "message_message": full_message
        }
        files = {
            "mail_attachment": ("", b"", "application/octet-stream")
        }
        return endpoint, form_data, files
