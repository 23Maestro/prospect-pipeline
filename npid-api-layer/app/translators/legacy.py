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
import html
from html import escape
from app.models.schemas import (
    VideoSubmitRequest,
    StageUpdateRequest,
    VideoSource,
    SendEmailRequest,
    AddNoteRequest,
    TaskCompleteRequest
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
        "<span style=\"color: #232a36;font-weight: bold;\">Web</span>&nbsp;www.prospectid.com<br>"
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href='https://www.facebook.com/NationalPID' target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/facebook_sign.png' "
        "alt='facebook' width='24' height='24' border='0'></a> "
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href='https://twitter.com/@NationalPID' target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/twitter_sign.png' "
        "alt='twitter' width='24' height='24' border='0'></a> "
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href='https://www.instagram.com/nationalprospect_id' target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/instagram_sign.png' "
        "alt='instagram' width='24' height='24' border='0'></a> "
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href='https://www.linkedin.com/company/prospect-id-28' target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/linkedin_sign.png' "
        "alt='linkedin' width='24' height='24' border='0'></a> "
        "<a style='font-size: 0px; line-height: 0px; padding-right: 3px;' "
        "href='https://www.youtube.com/@Prospect_ID/videos' target='_blank'><img "
        "src='https://dashboard.nationalpid.com/mandrillemail/signature_icons_v2/youtube_sign.png' "
        "alt='youtube' width='24' height='24' border='0'></a></td></tr></tbody></table><br>"
    )
    
    # ============== Request Translation ==============
    
    @staticmethod
    def video_submit_to_legacy(request: VideoSubmitRequest) -> Tuple[str, Dict[str, Any]]:
        """
        Convert VideoSubmitRequest to legacy form data.

        Mirrors verified curl command (Step 4):
        POST /athlete/update/careervideos/PLAYER_ID
        Body: _token=...&url_source=youtube&newVideoLink=...&videoType=...&newVideoSeason=...&approve_video=1&approve_video_checkbox=on&athlete_main_id=...
        """
        endpoint = f"/athlete/update/careervideos/{request.athlete_id}"

        # Preserve whatever caller sends (e.g., "highschool:18249" or plain numeric)
        season_value = request.season

        form_data = {
            "athlete_id": request.athlete_id,  # REQUIRED per verified user workflow
            "athleteviewtoken": "",
            "schoolinfo[add_video_season]": request.season_type or "",
            "url_source": request.source.value,
            "newVideoLink": request.video_url,
            "videoType": request.video_type.value,
            "newVideoSeason": season_value,
            "athlete_main_id": request.athlete_main_id,
            "sport_alias": request.sport,  # REQUIRED per verified user workflow
        }

        # Dual approval fields required ALWAYS:
        # 1. approve_video = "1"
        # 2. approve_video_checkbox = "on"
        form_data["approve_video"] = "1"
        form_data["approve_video_checkbox"] = "on"

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

        # Add mailbox parameter if provided (Dec 2025 feature)
        if request.is_from_video_mail_box:
            form_data["is_from_video_mail_box"] = "Yes"

        return endpoint, form_data

    @staticmethod
    def remove_video_to_legacy(athlete_id: str, athlete_main_id: str, video_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Convert remove video request to legacy form data.
        POST /athlete/update/remove_video/{athlete_id}
        """
        endpoint = f"/athlete/update/remove_video/{athlete_id}"
        form_data = {
            "id": video_id,
            "athlete_main_id": athlete_main_id
        }
        return endpoint, form_data

    @staticmethod
    def status_update_to_legacy(video_msg_id: str, status: str, is_from_mailbox: bool = False) -> Tuple[str, Dict[str, Any]]:
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

        # Add mailbox parameter if provided (Dec 2025 feature)
        if is_from_mailbox:
            form_data["is_from_video_mail_box"] = "Yes"

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
            "select_club_sport": "",
            "select_club_state": "",
            "select_club_name": "",
            "video_editor": "",
            "video_progress": "",
            "video_progress_stage": "",
            "video_progress_status": ""
        }

        if filters:
            form_data.update(filters)

        return endpoint, form_data

    @staticmethod
    def video_attachments_to_legacy() -> Tuple[str, Dict[str, Any]]:
        """
        Fetch all video mail attachments.
        Mirrors: src/python/npid_api_client.py:1088-1129

        Returns:
            Tuple of (endpoint_path, form_data)

        Note: This endpoint only requires _token (no other parameters).
        Content-Type is application/json but body is form-encoded (_token only).
        """
        endpoint = "/videoteammsg/videomailattachments"

        # Only _token required (auto-injected by session.post)
        form_data = {}

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
            # Not JSON at all - Laravel often appends HTML/errors.
            # Try to salvage embedded JSON substring like {"success":"true",...}
            try:
                start = raw_response.find('{')
                end = raw_response.rfind('}') + 1
                if start != -1 and end > start:
                    snippet = raw_response[start:end]
                    inner = json.loads(snippet)
                    return {
                        "success": inner.get("success") == "true" or inner.get("success") is True,
                        "message": inner.get("message", ""),
                        "raw": raw_response[:500]
                    }
            except Exception:
                pass

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
            # Parse full option tag with all attributes
            option_pattern = r'<option\s+([^>]*)>([^<]+)</option>'

            for match in re.finditer(option_pattern, raw_response):
                attrs_str, label = match.groups()

                # Extract attributes
                value = re.search(r'value="([^"]*)"', attrs_str)
                season = re.search(r'season="([^"]*)"', attrs_str)
                school_added = re.search(r'school_added="([^"]*)"', attrs_str)

                value_str = value.group(1) if value else ""
                if value_str:  # Skip empty placeholder option
                    # Extract season - try attribute first, then parse from label
                    season_type = ""
                    if season:
                        season_type = season.group(1)
                    else:
                        # Fallback: parse from label text
                        label_text = html.unescape(label.strip())
                        if "Senior" in label_text:
                            season_type = "senior"
                        elif "Junior" in label_text:
                            season_type = "junior"
                        elif "Sophomore" in label_text:
                            season_type = "sophomore"
                        elif "Freshman" in label_text:
                            season_type = "freshman"

                    seasons.append({
                        "value": value_str,
                        "label": html.unescape(label.strip()),
                        "season": season_type,
                        "school_added": school_added.group(1) if school_added else ""
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
                # Normalize stage fields so Raycast sees consistent values
                for task in data:
                    if not isinstance(task, dict):
                        continue
                    stage = task.get("video_progress_stage") or task.get("stage") or ""
                    stage = stage.strip() if isinstance(stage, str) else stage
                    if stage:
                        task["video_progress_stage"] = stage
                        task["stage"] = stage
                return {"success": True, "tasks": data}
            return {"success": False, "tasks": [], "error": "Unexpected format"}
        except json.JSONDecodeError:
            return {"success": False, "tasks": [], "error": "Invalid JSON"}

    @staticmethod
    def parse_video_attachments_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse video mail attachments response.
        Mirrors: src/python/npid_api_client.py:1120-1129

        Returns list of attachments with:
        - athlete_id (contact_id alias)
        - athletename
        - attachment (filename)
        - created_date
        - expiry_date
        - fileType
        - message_id (video_msg_id alias)
        """
        try:
            data = json.loads(raw_response)
            if isinstance(data, list):
                return {"success": True, "attachments": data, "count": len(data)}
            return {"success": False, "attachments": [], "count": 0, "error": "Unexpected format"}
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse video attachments response: {e}")
            return {"success": False, "attachments": [], "count": 0, "error": "Invalid JSON"}

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

    @staticmethod
    def parse_athlete_profile_data(html: str, grade_level: int = None) -> Dict[str, Any]:
        """
        Extract athlete profile data from HTML page using selectolax.
        ASSUMES HTML is always returned - robust HTML parsing.

        Args:
            html: Full profile page HTML
            grade_level: Grade level (9-12) to help locate correct tab section
        """
        from selectolax.parser import HTMLParser
        data = {}

        try:
            tree = HTMLParser(html)

            # Map grade level to tab ID patterns for context
            grade_patterns = {
                12: ["senior", "12"],
                11: ["junior", "11"],
                10: ["sophomore", "10"],
                9: ["freshman", "9", "freshmen"]
            }

            # Search for jersey number in the entire page
            # The HTML contains all tabs, we look for "Jersey #" anywhere
            jersey_labels = []
            for node in tree.css('label, th, td, div, span'):
                if not node.text():
                    continue
                text = node.text(strip=True)
                if 'jersey' in text.lower():
                    jersey_labels.append(text)
                if text == "Jersey #":
                    logger.info(f"✅ Found 'Jersey #' label")

                    # Try next sibling (Pattern 1)
                    if node.next:
                        jersey_text = node.next.text(strip=True) if hasattr(node.next, 'text') else ''
                        if jersey_text:
                            data['jersey_number'] = f"#{jersey_text}"
                            logger.info(f"✅ Jersey number from next sibling: {jersey_text}")
                            break

                    # Try parent's next sibling (Pattern 2 - tr > td structure)
                    parent = node.parent
                    if parent and parent.next:
                        jersey_text = parent.next.text(strip=True) if hasattr(parent.next, 'text') else ''
                        if jersey_text:
                            data['jersey_number'] = f"#{jersey_text}"
                            logger.info(f"✅ Jersey number from parent next sibling: {jersey_text}")
                            break

                    # Try finding in same row (Pattern 3 - table row with multiple tds)
                    if parent and parent.tag == 'tr':
                        tds = parent.css('td')
                        for i, td in enumerate(tds):
                            if td.text(strip=True) == "Jersey #" and i + 1 < len(tds):
                                jersey_text = tds[i + 1].text(strip=True)
                                if jersey_text:
                                    data['jersey_number'] = f"#{jersey_text}"
                                    logger.info(f"✅ Jersey number from table cell: {jersey_text}")
                                    break
                    break

            if not data.get('jersey_number'):
                logger.debug(f"⚠️ No jersey number found in profile HTML")
                if jersey_labels:
                    logger.debug(f"🔍 Found {len(jersey_labels)} labels containing 'jersey': {jersey_labels[:10]}")
                else:
                    logger.debug(f"🔍 No labels containing 'jersey' found at all")

        except Exception as e:
            logger.error(f"Profile data extraction error: {e}", exc_info=True)

        return data

    @staticmethod
    def parse_video_progress_ids(html: str) -> Dict[str, Any]:
        """
        Best-effort extraction of identifiers from video progress search page.

        The HTML is inconsistent, so we rely on broad regex patterns that
        match both explicit form fields and embedded links/script assignments.
        """
        if not html:
            return {}

        athlete_id = None
        athlete_main_id = None

        # Athlete/contact ID hints
        # Athlete/contact ID hints
        id_patterns = [
            # Specific strong signals first
            r'data-athlete-id=["\']?(\d+)',
            r'data-contact-id=["\']?(\d+)',
            r'contact[_-]?task["\s:=]+["\']?(\d+)',
            r'athlete[_-]?id["\s:=]+["\']?(\d+)',
            r'/athlete/(?:media|profile)/(\d+)',
            # Broader fallbacks
            r'data-contact["\s:=]+["\']?(\d+)',
            r'data-athlete["\s:=]+["\']?(\d+)',
            # JSON-like pattern for when we parse raw API responses that might be embedded
            r'"athlete_id"\s*:\s*"?(\d+)"?',
        ]
        for pattern in id_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                athlete_id = match.group(1)
                break

        # Athlete main ID hints (reuse existing extractor patterns)
        athlete_main_id = LegacyTranslator.extract_athlete_main_id(html)
        if not athlete_main_id:
            main_patterns = [
                r'athlete[_-]?main[_-]?id["\s:=]+["\']?(\d+)',
                r'data-athlete-main-id["\s:=]+["\']?(\d+)',
            ]
            for pattern in main_patterns:
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    athlete_main_id = match.group(1)
                    break

        # Optional profile metadata (best-effort only)
        name = None
        name_match = re.search(r'athlete\s*name["\s:=]+["\']?([^"\'>]+)', html, re.IGNORECASE)
        if name_match:
            name = name_match.group(1).strip()

        grad_year = None
        grad_match = re.search(r'\b(20\d{2})\b', html)
        if grad_match:
            grad_year = grad_match.group(1)

        high_school = None
        hs_match = re.search(r'(?:high\s*school|hs)["\s:=]+["\']?([^"\'<>]+)', html, re.IGNORECASE)
        if hs_match:
            high_school = hs_match.group(1).strip()

        sport = None
        sport_match = re.search(r'sport[_\s:=]+["\']?([a-z ]+)', html, re.IGNORECASE)
        if sport_match:
            sport = sport_match.group(1).strip()

        positions = None
        positions_match = re.search(r'positions?["\s:=]+["\']?([^"\'<>]+)', html, re.IGNORECASE)
        if positions_match:
            positions = positions_match.group(1).strip()

        return {
            "athlete_id": athlete_id,
            "athlete_main_id": athlete_main_id,
            "profile": {
                "name": name or "",
                "grad_year": grad_year,
                "high_school": high_school,
                "positions": positions,
                "sport": sport,
            }
        }

    # ============== Email Translators ==============

    @staticmethod
    def parse_email_templates(html_response: str) -> List[Dict[str, str]]:
        """
        Parse email template dropdown from HTML.
        GET /rulestemplates/template/videotemplates?id={athlete_id}
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
    def parse_email_recipients(html_response: str) -> Dict[str, Any]:
        """
        Parse recipients (athlete/parents/other) from sendingtodetails HTML.
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        athlete = {"id": None, "email": None, "checked": False}
        parents = []
        other_email = None

        # Athlete checkbox
        athlete_input = soup.find('input', {'name': 'notification_to_athlete'})
        if athlete_input:
            athlete["checked"] = athlete_input.has_attr('checked')
            # Extract email from label text
            label_text = athlete_input.next_sibling
            if label_text and isinstance(label_text, str):
                text = label_text.strip()
                if '(' in text and ')' in text:
                    athlete["email"] = text.split('(')[-1].split(')')[0]

        # Parents
        for inp in soup.find_all('input', {'name': 'notification_to_parent[]'}):
            pid = inp.get('value')
            checked = inp.has_attr('checked')
            label_text = inp.next_sibling
            email = None
            if label_text and isinstance(label_text, str):
                txt = label_text.strip()
                if '(' in txt and ')' in txt:
                    email = txt.split('(')[-1].split(')')[0]
            if pid:
                parents.append({"id": pid, "email": email, "checked": checked})

        # Other
        other_inp = soup.find('input', {'name': 'notification_to_other'})
        if other_inp and other_inp.get('value'):
            other_email = other_inp.get('value').strip()

        return {
            "athlete": athlete,
            "parents": parents,
            "other_email": other_email
        }

    @staticmethod
    def contact_info_to_legacy(contact_id: str, athlete_main_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Build athleteinfo POST request.
        Endpoint: POST /admin/athleteinfo

        Note: _token is auto-injected by session.post() - do NOT include it here
        """
        endpoint = "/admin/athleteinfo"
        form_data = {
            "athlete_selected": contact_id,
            "athlete_table_length": "5",
            "athleteselected": contact_id,
            "athlete_main_id": athlete_main_id,
            "show_section": ""
        }
        return endpoint, form_data

    @staticmethod
    def parse_athleteinfo_response(html: str) -> Dict[str, Any]:
        """
        Parse athleteinfo HTML form using selectolax.

        Actual HTML structure uses:
        - Student: first_name, last_name, phone, email
        - Guardians: GUARDIAN[ID][first_name], GUARDIAN[ID][last_name],
                     GUARDIAN[ID][relationship], GUARDIAN[ID][phone], GUARDIAN[ID][email]

        Returns: {
            "student": {"firstName": ..., "lastName": ..., "phone": ..., "email": ...},
            "parent1": {"firstName": ..., "lastName": ..., "relationship": ..., "phone": ..., "email": ...},
            "parent2": {...} or None
        }
        """
        import logging
        import re
        from selectolax.parser import HTMLParser
        logger = logging.getLogger(__name__)

        tree = HTMLParser(html)

        # DEBUG: Save HTML to file for inspection
        import os
        debug_file = '/Users/singleton23/raycast_logs/athleteinfo_response.html'
        try:
            with open(debug_file, 'w') as f:
                f.write(html)
            logger.info(f"💾 Saved athleteinfo HTML to {debug_file}")
        except:
            pass

        def get_input_value(name: str) -> str:
            """Extract value from input field by name."""
            inp = tree.css_first(f'input[name="{name}"]')
            if inp and inp.attributes:
                value = inp.attributes.get('value', '')
                if value:
                    return value.strip() if value.strip() else None
            return None

        # Extract student data
        student = {
            "firstName": get_input_value('first_name'),
            "lastName": get_input_value('last_name'),
            "phone": get_input_value('phone'),
            "email": get_input_value('email')
        }

        # Extract guardian data using GUARDIAN[ID][field] pattern
        guardian_inputs = tree.css('input[name^="GUARDIAN["]')
        guardians = {}

        for inp in guardian_inputs:
            if not inp.attributes:
                continue
            name = inp.attributes.get('name', '')
            value = inp.attributes.get('value', '')
            if value is None:
                continue
            value = value.strip()

            # Parse: GUARDIAN[ID][field]
            match = re.match(r'GUARDIAN\[(\d+)\]\[(\w+)\]', name)
            if match:
                guardian_id, field = match.groups()
                if guardian_id not in guardians:
                    guardians[guardian_id] = {}
                guardians[guardian_id][field] = value if value else None

        logger.info(f"🔍 DEBUG: Found {len(guardians)} guardians: {list(guardians.keys())}")

        # Filter out guardians without a relationship (incomplete entries)
        # Only check 'relationship' field, not 'parentsno' (which is just parent1/parent2 identifier)
        valid_guardians = []
        for guardian_id, guardian_data in guardians.items():
            relationship = guardian_data.get('relationship', '')
            if relationship and relationship.strip():
                valid_guardians.append((guardian_id, guardian_data))

        logger.info(f"🔍 DEBUG: Valid guardians (with relationship): {len(valid_guardians)}")

        # Convert valid guardians to parent1/parent2
        parent1 = None
        parent2 = None

        if len(valid_guardians) > 0:
            g1_id, g1_data = valid_guardians[0]
            parent1 = {
                "firstName": g1_data.get('first_name'),
                "lastName": g1_data.get('last_name'),
                "relationship": g1_data.get('relationship') or 'Parent',
                "phone": g1_data.get('phone'),
                "email": g1_data.get('email')
            }

        if len(valid_guardians) > 1:
            g2_id, g2_data = valid_guardians[1]
            parent2 = {
                "firstName": g2_data.get('first_name'),
                "lastName": g2_data.get('last_name'),
                "relationship": g2_data.get('relationship') or 'Parent',
                "phone": g2_data.get('phone'),
                "email": g2_data.get('email')
            }

        # Extract emails from checkbox labels
        # Pattern: > Athlete (email@example.com), > Parent 1 (email@example.com), > Parent 2 (email@example.com)
        import re

        athlete_email = None
        parent1_email = None
        parent2_email = None

        # Extract athlete email
        athlete_match = re.search(r'>\s*Athlete\s*\(([^)]+@[^)]+)\)', html)
        if athlete_match:
            athlete_email = athlete_match.group(1).strip()
            logger.info(f"📧 Extracted athlete email: {athlete_email}")

        # Extract parent 1 email
        parent1_match = re.search(r'>\s*Parent 1\s*\(([^)]+@[^)]+)\)', html)
        if parent1_match:
            parent1_email = parent1_match.group(1).strip()
            logger.info(f"📧 Extracted parent1 email: {parent1_email}")

        # Extract parent 2 email
        parent2_match = re.search(r'>\s*Parent 2\s*\(([^)]+@[^)]+)\)', html)
        if parent2_match:
            parent2_email = parent2_match.group(1).strip()
            logger.info(f"📧 Extracted parent2 email: {parent2_email}")

        # Add emails to contact data
        student['email'] = athlete_email

        # Create parent1 if we have an email even if no relationship field
        if parent1_email and not parent1:
            # Get data from guardians dict even if no relationship
            guardian_list = list(guardians.items())
            if len(guardian_list) > 0:
                g1_id, g1_data = guardian_list[0]
                parent1 = {
                    "firstName": g1_data.get('first_name'),
                    "lastName": g1_data.get('last_name'),
                    "relationship": g1_data.get('relationship') or 'Parent',
                    "phone": g1_data.get('phone'),
                    "email": None
                }

        if parent1:
            parent1['email'] = parent1_email

        # Create parent2 if we have an email even if no relationship field
        if parent2_email and not parent2:
            guardian_list = list(guardians.items())
            if len(guardian_list) > 1:
                g2_id, g2_data = guardian_list[1]
                parent2 = {
                    "firstName": g2_data.get('first_name'),
                    "lastName": g2_data.get('last_name'),
                    "relationship": g2_data.get('relationship') or 'Parent',
                    "phone": g2_data.get('phone'),
                    "email": None
                }

        if parent2:
            parent2['email'] = parent2_email

        logger.info(f"📋 Parsed contact data - Student: {student.get('firstName')} {student.get('lastName')}, Parent1: {parent1.get('firstName') if parent1 else None}")
        return {"student": student, "parent1": parent1, "parent2": parent2}

    @staticmethod
    def parse_contact_emails_response(html_text: str) -> List[str]:
        """
        Parse athlete_emailslist HTML table response.

        Extracts emails from "Email To" column, filters out @prospectid.com,
        and returns unique emails only.

        Returns: List of unique email strings (filtered, no @prospectid.com)
        """
        import logging
        from selectolax.parser import HTMLParser
        logger = logging.getLogger(__name__)

        try:
            tree = HTMLParser(html_text)

            # Find all table rows in tbody
            rows = tree.css('tbody tr')
            logger.info(f"📧 DEBUG: Found {len(rows)} email history rows")

            # Extract all "Email To" values (3rd column) - preserve order, deduplicate
            seen_emails = set()
            emails = []
            filtered_count = 0

            for row in rows:
                cells = row.css('td')
                if len(cells) >= 3:
                    email_cell = cells[2]  # "Email To" is 3rd column
                    email = email_cell.text(strip=True)

                    # Only filter @prospectid.com (explicit requirement)
                    if '@prospectid.com' in email.lower():
                        filtered_count += 1
                        continue

                    if email and '@' in email and email not in seen_emails:
                        seen_emails.add(email)
                        emails.append(email)
                        logger.info(f"📧 DEBUG: Found email: {email}")
            logger.info(f"📧 DEBUG: Parsed {len(emails)} unique emails, filtered {filtered_count} @prospectid.com emails")
            return emails

        except Exception as e:
            logger.error(f"📧 DEBUG: Failed to parse emails: {e}", exc_info=True)
            return []

    @staticmethod
    def merge_contact_data(
        contact_id: str,
        contact_data: Dict[str, Any],
        emails: List[str]  # Kept for signature compatibility but unused
    ) -> Dict[str, Any]:
        """
        Build ContactInfoResponse from athleteinfo data.

        Emails are already extracted in parse_athleteinfo_response from checkbox labels.
        """
        student = contact_data.get("student", {})
        parent1_data = contact_data.get("parent1", {})
        parent2_data = contact_data.get("parent2")

        result = {
            "contact_id": contact_id,
            "student_athlete": {
                "name": f"{student.get('firstName', '')} {student.get('lastName', '')}".strip(),
                "email": student.get("email"),
                "phone": student.get("phone")
            },
            "parent1": None,
            "parent2": None
        }

        if parent1_data and parent1_data.get("firstName"):
            result["parent1"] = {
                "name": f"{parent1_data.get('firstName', '')} {parent1_data.get('lastName', '')}".strip(),
                "relationship": parent1_data.get("relationship", "Parent"),
                "email": parent1_data.get("email"),
                "phone": parent1_data.get("phone")
            }

        if parent2_data and parent2_data.get("firstName"):
            result["parent2"] = {
                "name": f"{parent2_data.get('firstName', '')} {parent2_data.get('lastName', '')}".strip(),
                "relationship": parent2_data.get("relationship", "Parent"),
                "email": parent2_data.get("email"),
                "phone": parent2_data.get("phone")
            }

        return result

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

        if request.include_athlete:
            form_data["notification_to_athlete"] = "Athlete"

        if request.parent_ids:
            for pid in request.parent_ids:
                form_data.setdefault("notification_to_parent[]", [])
                form_data["notification_to_parent[]"].append(pid)

        if request.other_email:
            form_data["mail_to_other"] = "Other"
            form_data["notification_to_other"] = request.other_email

        return endpoint, form_data

    # ============== Inbox Translators ==============
    # Ported from: src/python/npid_api_client.py

    @staticmethod
    def inbox_threads_to_legacy(
        limit: int,
        filter_assigned: str,
        page_start_number: int = 1,
        only_pagination: bool = False,
        search_text: str = ""
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Convert inbox threads request to legacy params.
        GET /rulestemplates/template/videoteammessagelist
        Mirrors: npid_api_client.py:232-244
        """
        endpoint = "/rulestemplates/template/videoteammessagelist"
        safe_page = page_start_number if page_start_number > 0 else 1
        params = {
            "athleteid": "",
            "user_timezone": "America/New_York",
            "type": "inbox",
            "is_mobile": "",
            "filter_self": "Me/Un",
            "refresh": "false",
            "page_start_number": str(safe_page),
            "search_text": search_text
        }
        # Removed only_pagination logic - matches Python reference implementation
        return endpoint, params

    @staticmethod
    def parse_inbox_threads_response(html_response: str, filter_assigned: str) -> Dict[str, Any]:
        """
        Parse inbox threads from HTML.
        Mirrors: npid_api_client.py:247-337
        """
        def _extract_video_management_params(href: str) -> Dict[str, str]:
            """
            Extract athlete identifiers from new video mailbox endpoints.

            Example URLs:
            - /template/template/videosortable?is_from_video_mail_box=Yes&athleteid=1460597&sport_alias=&athlete_main_id=939628
            - /template/template/addvideoform?is_from_video_mail_box=Yes&athleteid=1460597&sport_alias=&athlete_main_id=939628
            """
            if not href:
                return {}

            href = href.replace("&amp;", "&")

            if ("template/template/videosortable" not in href) and ("template/template/addvideoform" not in href):
                return {}

            athlete_id_match = re.search(r'(?:\?|&)(?:athleteid|athlete_id|athleteId)=(\d+)', href, re.IGNORECASE)
            athlete_main_id_match = re.search(
                r'(?:\?|&)(?:athlete_main_id|athletemainid|athleteMainId)=(\d+)', href, re.IGNORECASE
            )
            sport_alias_match = re.search(r'(?:\?|&)(?:sport_alias|sportAlias)=([^&]*)', href, re.IGNORECASE)

            return {
                "athlete_id": athlete_id_match.group(1) if athlete_id_match else "",
                "athlete_main_id": athlete_main_id_match.group(1) if athlete_main_id_match else "",
                "sport_alias": sport_alias_match.group(1) if sport_alias_match else "",
            }

        def _extract_video_management_params_from_text(text: str) -> Dict[str, str]:
            """
            Same as _extract_video_management_params, but scans any text/HTML (href, onclick, data-url, etc).
            This catches the new per-thread "Manage Videos" endpoints even when they aren't plain hrefs.
            """
            if not text:
                return {}
            text = text.replace("&amp;", "&")
            if ("template/template/videosortable" not in text) and ("template/template/addvideoform" not in text):
                return {}

            athlete_id_match = re.search(r'(?:\?|&|\b)(?:athleteid|athlete_id|athleteId)=(\d+)', text, re.IGNORECASE)
            athlete_main_id_match = re.search(
                r'(?:\?|&|\b)(?:athlete_main_id|athletemainid|athleteMainId)=(\d+)', text, re.IGNORECASE
            )
            sport_alias_match = re.search(
                r'(?:\?|&|\b)(?:sport_alias|sportAlias)=([^&\s"\']*)', text, re.IGNORECASE
            )
            return {
                "athlete_id": athlete_id_match.group(1) if athlete_id_match else "",
                "athlete_main_id": athlete_main_id_match.group(1) if athlete_main_id_match else "",
                "sport_alias": sport_alias_match.group(1) if sport_alias_match else "",
            }

        soup = BeautifulSoup(html_response, 'html.parser')
        threads = []

        message_elements = soup.select('div.ImageProfile')
        for elem in message_elements:
            try:
                item_id = elem.get('itemid')
                item_code = elem.get('itemcode')
                raw_message_id = elem.get('id') or ""
                if not raw_message_id:
                    logger.warning(
                        f"⚠️ Missing message_id for thread {item_id}; skipping to avoid incorrect IDs"
                    )
                    continue

                message_id = raw_message_id
                # video_msg_id should be the numeric thread ID, not the message_id string
                video_msg_id = item_id if item_id else raw_message_id

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

                # Extract athlete_id/contact_id and athlete_main_id.
                #
                # IMPORTANT:
                # - video_msg_id is ONLY for stage/status updates.
                # - athlete_id (aka contact_id/contacttask) and athlete_main_id are for notes/video management.
                athlete_id = ""
                athlete_main_id = ""
                sport_alias = ""

                # Preferred (and ONLY trusted source): extract from the new per-thread video mailbox URLs.
                for link in elem.select('a[href]'):
                    params = _extract_video_management_params(link.get('href', ''))
                    if params.get("athlete_id") or params.get("athlete_main_id"):
                        athlete_id = athlete_id or params.get("athlete_id", "")
                        athlete_main_id = athlete_main_id or params.get("athlete_main_id", "")
                        sport_alias = sport_alias or params.get("sport_alias", "")
                        if athlete_id and athlete_main_id:
                            break

                # Also scan the full element HTML for params (covers onclick/data-* cases).
                if (not athlete_id) or (not athlete_main_id):
                    params = _extract_video_management_params_from_text(str(elem))
                    athlete_id = athlete_id or params.get("athlete_id", "")
                    athlete_main_id = athlete_main_id or params.get("athlete_main_id", "")
                    sport_alias = sport_alias or params.get("sport_alias", "")

                # Final fallback: Try contact_id attribute directly
                if not athlete_id:
                    athlete_id = elem.get('contact_id', '')

                # Log if still not found (for debugging)
                if not athlete_id:
                    logger.warning(
                        f"⚠️ Missing athleteid/athlete_main_id params for thread {item_id} (video_msg_id={video_msg_id}); video management + notes will be unavailable for this thread"
                    )
                    # Save HTML sample for first failed thread
                    if item_id == '13620':
                        with open('/tmp/inbox_thread_sample.html', 'w') as f:
                            f.write(str(elem.prettify()) if hasattr(elem, 'prettify') else str(elem))

                # Log extraction result
                if athlete_id or athlete_main_id:
                    logger.info(
                        f"🆔 Thread {item_id} (video_msg_id={video_msg_id}) ids: athlete_id={athlete_id or '∅'} athlete_main_id={athlete_main_id or '∅'}"
                    )

                # Extract sport_alias (needed for video management endpoints) - prefer management URL; fallback to attrs.
                if not sport_alias:
                    sport_alias = elem.get('sport_alias', '') or elem.get('data-sport', '') or elem.get('data-sport-alias', '')

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
                    "id": message_id,
                    "itemCode": item_code or item_id,
                    "message_id": message_id,
                    "video_msg_id": video_msg_id,
                    "thread_id": item_id,
                    "contact_id": athlete_id,  # Aliases: athlete_id, contacttask (same value)
                    "athlete_id": athlete_id,  # explicit alias for clarity
                    "athleteMainId": athlete_main_id,
                    "sport_alias": sport_alias,  # NEW - needed for video management endpoints
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
        Mirrors: src/python/npid_api_client.py:400-419
        """
        endpoint = "/rulestemplates/template/videoteammessage_subject"
        clean_id = message_id.replace('message_id', '', 1) if message_id.startswith('message_id') else message_id
        params = {
            "message_id": clean_id,
            "itemcode": item_code,
            "type": "inbox",
            "user_timezone": "America/New_York",
            "filter_self": "Me/Un",
        }
        return endpoint, params

    @staticmethod
    def _parse_email_content(raw_content: str, strip_template: bool = True) -> str:
        """
        Clean email content using html2text and email_reply_parser.

        - Converts HTML to clean markdown/text
        - Uses email_reply_parser to extract visible reply (strips quoted replies)
        - Optionally strips NPID video instructions template
        - Strips Jerami's signature block (only shown in outgoing replies, not when reading)
        """
        if not raw_content:
            return ""

        content = raw_content

        # Convert HTML to text using html2text
        html_hints = ['<html', '<body', '<div', '<p', '<br', '<table', '<span', '<tr', '<td']
        if any(hint in content.lower() for hint in html_hints):
            # Pre-processing to ensure <br> and <p> have enough space for Markdown
            # Replace <br> with double newline to ensure it's not collapsed by Markdown renderers
            content = re.sub(r'<br\s*/?>', '\n\n', content, flags=re.IGNORECASE)

            h = html2text.HTML2Text()
            h.ignore_links = True
            h.ignore_images = True
            h.ignore_emphasis = False
            h.body_width = 0  # No line wrapping
            h.protect_links = True
            h.unicode_snob = True # Use Unicode instead of ASCII equivalents
            content = h.handle(content)

        # Add line breaks before reply chain initiators for readability
        # Pattern: "defense. On Thu, Dec 4, 2025 at 6:11 AM" → "defense.\n\nOn Thu, Dec 4, 2025 at 6:11 AM"
        content = re.sub(
            r'\s+(On\s+[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s+[APap][Mm])',
            r'\n\n\1',
            content,
            flags=re.IGNORECASE
        )

        # DON'T strip quoted replies - keep full thread with line breaks for readability

        # Strip Jerami's signature block when DISPLAYING messages (signature is only for outgoing)
        # Pattern: "Kind Regards," followed by signature details
        signature_patterns = [
            # Full signature block with pipe separator
            r'Kind\s*Regards,?\s*\|?\s*Jerami\s+Singleton.*?(?:Web\s+www\.(?:prospectid|nationalpid)\.com|$)',
            # Signature starting with "Kind Regards" through web line
            r'Kind\s*Regards,?\s*\n+.*?Jerami\s+Singleton.*?(?:Web\s+www\.(?:prospectid|nationalpid)\.com|$)',
            # Just the signature details without "Kind Regards"
            r'\|\s*Jerami\s+Singleton\s*\n+Content\s+Creator.*?Web\s+www\.(?:prospectid|nationalpid)\.com',
        ]
        for pattern in signature_patterns:
            content = re.sub(pattern, '', content, flags=re.IGNORECASE | re.DOTALL)

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
                # Template detected - already stripped above via wrote_patterns
                pass

        # Use email_reply_parser to extract just the visible reply (most recent)
        parsed = EmailReplyParser.parse_reply(content)

        # Clean up and ensure Markdown line breaks
        lines = parsed.split('\n')
        cleaned = []
        for line in lines:
            line = line.strip()
            if line:
                # Add two spaces at the end of each non-empty line for a hard break in Markdown
                cleaned.append(line + "  ")
            else:
                cleaned.append("")

        # Join with double newlines to ensure paragraph separation
        return '\n\n'.join(cleaned).strip()

    @staticmethod
    def parse_message_detail_response(response_text: str, message_id: str, item_code: str) -> Dict[str, Any]:
        """
        Parse message detail from JSON response.
        Uses html2text and email_reply_parser for clean extraction.

        CRITICAL: Extract attachments BEFORE html2text (ignore_links=True strips URLs).
        """
        def _extract_href_from_fragment(html_fragment: str) -> str:
            if not html_fragment:
                return ""
            try:
                from selectolax.parser import HTMLParser
                tree = HTMLParser(html_fragment)
                anchor = tree.css_first('a')
                return anchor.attributes.get('href', '') if anchor else ""
            except Exception as e:
                logger.debug(f"Failed to parse link fragment with selectolax: {e}")
                return ""

        def _extract_manage_video_ids(html_fragment: str) -> Dict[str, str]:
            if not html_fragment:
                return {"athlete_id": "", "athlete_main_id": ""}
            try:
                from selectolax.parser import HTMLParser
                tree = HTMLParser(html_fragment)
                node = tree.css_first('[athleteid]') or tree.css_first('[athlete_main_id]')
                if not node:
                    return {"athlete_id": "", "athlete_main_id": ""}
                return {
                    "athlete_id": node.attributes.get('athleteid', ''),
                    "athlete_main_id": node.attributes.get('athlete_main_id', ''),
                }
            except Exception as e:
                logger.debug(f"Failed to parse add_manage_videos with selectolax: {e}")
                return {"athlete_id": "", "athlete_main_id": ""}

        try:
            data = json.loads(response_text.strip())
            raw_content = data.get('message_plain', '') or data.get('message', '')
            raw_message_html = data.get('message', '') or data.get('body_html', '')

            # Extract contact_id from JSON (direct or from athlete_profile_link HTML fragment)
            contact_id = data.get('contact_id', '')
            athlete_main_id = ""
            athlete_links = {
                "profile": "",
                "notes": "",
                "search": "",
                "addVideoForm": "",
            }

            # Fallback: Parse athlete_profile_link HTML fragment if contact_id not directly available
            if data.get('athlete_profile_link'):
                profile_href = _extract_href_from_fragment(data.get('athlete_profile_link', ''))
                athlete_links["profile"] = profile_href

                if not contact_id and profile_href:
                    match = re.search(r'(?:profile/|contactid=)(\d+)', profile_href)
                    if match:
                        contact_id = match.group(1)
                        logger.info(f"✅ Extracted contact_id {contact_id} from athlete_profile_link")

            if data.get('athlete_notes_link'):
                athlete_links["notes"] = _extract_href_from_fragment(data.get('athlete_notes_link', ''))

            if data.get('athlete_search_link'):
                athlete_links["search"] = _extract_href_from_fragment(data.get('athlete_search_link', ''))

            if data.get('add_manage_videos'):
                manage_ids = _extract_manage_video_ids(data.get('add_manage_videos', ''))
                if manage_ids.get("athlete_id") and not contact_id:
                    contact_id = manage_ids["athlete_id"]
                if manage_ids.get("athlete_main_id"):
                    athlete_main_id = manage_ids["athlete_main_id"]
                if manage_ids.get("athlete_id") and manage_ids.get("athlete_main_id"):
                    athlete_links["addVideoForm"] = (
                        "/template/template/addvideoform"
                        f"?is_from_video_mail_box=Yes&athleteid={manage_ids['athlete_id']}"
                        f"&sport_alias=&athlete_main_id={manage_ids['athlete_main_id']}"
                    )

            # EXTRACT ATTACHMENTS BEFORE CLEANING (preserve download URLs)
            attachments = []
            if raw_message_html:
                soup = BeautifulSoup(raw_message_html, 'html.parser')

                # Look for attachment links (common patterns in NPID emails)
                attachment_links = soup.select('a[href*="download"], a[href*="attachment"], a[href*=".mp4"], a[href*=".mov"]')
                for link in attachment_links:
                    href = link.get('href', '')
                    text = link.get_text(strip=True)
                    if href and ('download' in href.lower() or any(ext in href.lower() for ext in ['.mp4', '.mov', '.avi', '.pdf', '.zip'])):
                        # Extract filename from link text or URL
                        filename = text if text and not text.lower().startswith(('click', 'download', 'here')) else href.split('/')[-1]
                        attachments.append({
                            "fileName": filename,
                            "url": href if href.startswith('http') else f"https://dashboard.nationalpid.com{href}",
                            "downloadable": True,
                            "expiresAt": None
                        })

            # Parse and clean the email content (strips links via ignore_links=True)
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
                "contact_id": contact_id or None,
                "athlete_main_id": athlete_main_id or None,
                "athlete_links": athlete_links,
                "attachments": attachments,  # ✅ Attachments preserved with URLs
            }
        except Exception as e:
            logger.warning(f"Failed to parse message detail: {e}")
            return {"message_id": message_id, "item_code": item_code, "content": "", "attachments": []}

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
    def tasks_list_to_legacy(athlete_id: str, athlete_main_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Build request for athlete tasks list.
        GET /template/template/athlete_taskslist
        """
        endpoint = "/template/template/athlete_taskslist"
        params = {"id": athlete_id, "athlete_main_id": athlete_main_id}
        return endpoint, params

    @staticmethod
    def parse_tasks_list_response(html_response: str) -> Dict[str, Any]:
        """
        Parse athlete tasks HTML table into normalized entries.
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        tasks: List[Dict[str, Any]] = []

        rows = soup.select('tr')
        for row in rows:
            if row.find('th'):
                continue
            cells = row.find_all('td')
            if not cells:
                continue

            row_html = str(row)
            task_id = None

            for attr_name in ("data-taskid", "data-task-id", "data-id"):
                if row.has_attr(attr_name):
                    task_id = row.get(attr_name)
                    break

            if not task_id:
                match = re.search(r"edittaskid=(\d+)", row_html)
                if match:
                    task_id = match.group(1)

            if not task_id:
                link = row.find('a', href=re.compile(r"edittaskid=\d+"))
                if link and link.get('href'):
                    match = re.search(r"edittaskid=(\d+)", link.get('href', ''))
                    if match:
                        task_id = match.group(1)

            text_cells = [cell.get_text(" ", strip=True) for cell in cells]
            row_text = " | ".join([cell for cell in text_cells if cell])

            due_date = text_cells[0] if len(text_cells) > 0 else None
            completion_date = text_cells[1] if len(text_cells) > 1 else None
            assigned_owner = text_cells[2] if len(text_cells) > 2 else None
            title = text_cells[3] if len(text_cells) > 3 else None
            description = text_cells[4] if len(text_cells) > 4 else None

            tasks.append({
                "task_id": task_id or "",
                "title": title,
                "assigned_owner": assigned_owner,
                "due_date": due_date,
                "completion_date": completion_date,
                "description": description,
                "row_text": row_text or None
            })

        return {"success": True, "tasks": tasks}

    @staticmethod
    def task_popup_to_legacy(task_id: str) -> Tuple[str, Dict[str, Any]]:
        """
        Build request for task popup form.
        GET /template/template/taskpopup
        """
        endpoint = "/template/template/taskpopup"
        params = {"edittaskid": task_id}
        return endpoint, params

    @staticmethod
    def parse_task_popup_response(html_response: str) -> Dict[str, Any]:
        """
        Parse task popup form into form data payload.
        """
        soup = BeautifulSoup(html_response, 'html.parser')
        form = soup.find('form') or soup
        form_data: Dict[str, str] = {}
        checkbox_fields: List[str] = []

        for input_elem in form.find_all('input'):
            name = input_elem.get('name')
            if not name:
                continue
            input_type = (input_elem.get('type') or 'text').lower()
            if input_type in ("submit", "button", "reset", "file"):
                continue
            if input_type in ("checkbox", "radio"):
                checkbox_fields.append(name)
                if input_elem.has_attr('checked'):
                    form_data[name] = input_elem.get('value') or "1"
                continue
            form_data[name] = input_elem.get('value') or ""

        for select in form.find_all('select'):
            name = select.get('name')
            if not name:
                continue
            selected = select.find('option', selected=True)
            if not selected:
                selected = select.find('option')
            if selected:
                form_data[name] = selected.get('value') or selected.get_text(strip=True)

        for textarea in form.find_all('textarea'):
            name = textarea.get('name')
            if not name:
                continue
            form_data[name] = textarea.get_text() or ""

        return {
            "success": True,
            "form_data": form_data,
            "checkbox_fields": sorted(set(checkbox_fields))
        }

    @staticmethod
    def apply_task_completion(
        request: TaskCompleteRequest,
        form_data: Dict[str, Any],
        checkbox_fields: List[str]
    ) -> Dict[str, Any]:
        """
        Apply completion updates to task form data.
        """
        updated = dict(form_data)

        if request.task_title:
            updated["tasktitle"] = request.task_title

        updated["taskdescription"] = request.description
        updated["completedate"] = request.completed_date if request.is_completed else ""
        updated["completed_time"] = request.completed_time if request.is_completed else ""

        if request.athlete_main_id:
            updated["athlete_main_id"] = request.athlete_main_id
        if request.athlete_id and "contact_task" not in updated:
            updated["contact_task"] = request.athlete_id

        if request.is_completed:
            for field_name in checkbox_fields:
                updated[field_name] = updated.get(field_name) or "1"
        else:
            for field_name in checkbox_fields:
                if field_name in updated:
                    del updated[field_name]

        return updated

    @staticmethod
    def task_update_to_legacy(form_data: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Convert updated task form data to legacy request.
        POST /tasks/addtask
        """
        endpoint = "/tasks/addtask"
        return endpoint, form_data

    @staticmethod
    def parse_task_update_response(raw_response: str) -> Dict[str, Any]:
        """
        Parse task update response (Laravel returns HTML or JSON).
        """
        if not raw_response.strip():
            return {"success": True, "message": "Task updated"}

        try:
            data = json.loads(raw_response)
            if isinstance(data, dict):
                success_value = data.get("success", True)
                success = (
                    success_value if isinstance(success_value, bool)
                    else str(success_value).lower() == "true"
                )
                return {
                    "success": success,
                    "message": data.get("message", "Task updated"),
                    "raw": raw_response
                }
        except json.JSONDecodeError:
            pass

        lowered = raw_response.lower()
        if "error" in lowered and "task" in lowered:
            return {"success": False, "message": "Task update failed", "raw": raw_response}

        return {"success": True, "message": "Task updated", "raw": raw_response}

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
        clean_id = message_id.replace('message_id', '', 1) if message_id.startswith('message_id') else message_id
        params = {"id": clean_id, "itemcode": item_code, "tab": "inbox"}
        return endpoint, params

    @staticmethod
    def parse_reply_form_response(html_response: str, message_id: str) -> Dict[str, Any]:
        """
        Parse reply form to extract CSRF token and thread data.
        Mirrors: src/python/npid_api_client.py:548-551
        """
        from app.routers.inbox import logger
        soup = BeautifulSoup(html_response, 'html.parser')
        token = soup.find('input', {'name': '_token'})
        token_value = token.get('value') if token else ''

        if not token_value:
            logger.warning(f"⚠️ No _token found in reply form HTML (length: {len(html_response)})")
            # Log a sample to debug
            logger.debug(f"HTML sample: {html_response[:500]}")
        else:
            logger.info(f"✅ Scraped reply form token: {token_value[:20]}...")

        return {
            "csrf_token": token_value,
            "message_id": message_id
        }

    @staticmethod
    def _format_reply_text(reply_text: str) -> str:
        """
        Format reply text for sending.
        Mirrors: src/python/npid_api_client.py:588 (sends as-is)
        """
        if not reply_text:
            return ""
        # Send reply text as-is (Python doesn't escape HTML)
        return reply_text

    @staticmethod
    def _build_previous_message_block(message_id: str, detail_data: Dict[str, Any]) -> str:
        """
        Build previous message block for reply (quoted original message).
        Mirrors: src/python/npid_api_client.py:586-587

        Note: Signature is now added in send_reply_to_legacy, not here.
        """
        original_html = detail_data.get('raw_message_html') or detail_data.get('message') or ''
        if not original_html:
            return ""
        timestamp = detail_data.get('timestamp_wrote') or detail_data.get('timestamp') or ''
        # Build the quoted previous message (signature is prepended in send_reply_to_legacy)
        previous_msg = f'<br><br>{timestamp}<br>{original_html}'
        return f"<div id=\"previous_message{message_id}\">{previous_msg}</div>"

    @staticmethod
    def send_reply_to_legacy(message_id: str, item_code: str, reply_text: str, thread_data: Dict, detail_data: Dict[str, Any]) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
        """
        Convert send reply to legacy form data.
        POST /videoteammsg/sendmessage
        Mirrors: src/python/npid_api_client.py:573-602
        """
        clean_id = message_id.replace('message_id', '', 1) if message_id.startswith('message_id') else message_id
        endpoint = "/videoteammsg/sendmessage"
        subject_source = detail_data.get('raw_subject') or detail_data.get('subject') or ''
        formatted_subject = f"Re: {subject_source}" if subject_source else "Re: Video Team"
        # Use cleaned message_id when present to align with detail endpoint parsing.
        reply_main_id = detail_data.get('message_id') or clean_id
        reply_body = LegacyTranslator._format_reply_text(reply_text)
        previous_block = LegacyTranslator._build_previous_message_block(clean_id, detail_data)

        # Build full message: reply body + HTML signature + quoted previous message
        full_message = f"{reply_body}{LegacyTranslator.SIGNATURE_HTML}{previous_block}"

        form_data = {
            "_token": thread_data.get('csrf_token', ''),  # Use scraped token from reply form
            "message_type": "send",
            "reply_message_id": clean_id,
            "reply_main_id": reply_main_id,
            "draftid": "",
            "message_subject": formatted_subject,
            "message_message": full_message
        }
        files = {
            "mail_attachment": ("", b"", "application/octet-stream")
        }
        return endpoint, form_data, files
