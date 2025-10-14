#!/usr/bin/env python3
"""
NPID REST API Client
- Handles CSRF-based login using requests.Session
- Persists cookies (including remember cookie) for 400-day persistence
- Exposes convenient methods for inbox, thread details, assignment modal, assignment, search, and contact resolution

Environment variables:
- NPID_BASE_URL (default: https://dashboard.nationalpid.com)
- NPID_USERNAME
- NPID_PASSWORD
- NPID_SESSION_PATH (cookie jar path; default: ~/.cache/npid/rest-session/cookies.json)
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup
from requests import Response
from requests.cookies import RequestsCookieJar


logger = logging.getLogger(__name__)


@dataclass
class LoginResult:
    success: bool
    status: int
    message: str = ""


class NpidApiClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        session_path: Optional[str] = None,
        timeout_seconds: int = 30,
    ) -> None:
        """
        Initialize the client with connection settings, credential resolution, session persistence location, and a requests session populated from saved cookies.
        
        Parameters:
            base_url (Optional[str]): Base URL for the NPID dashboard; if not provided, uses the NPID_BASE_URL environment variable or "https://dashboard.nationalpid.com".
            username (Optional[str]): Login email; if not provided, uses the NPID_USERNAME environment variable.
            password (Optional[str]): Login password; if not provided, uses the NPID_PASSWORD environment variable.
            session_path (Optional[str]): Filesystem path to store session cookies; if not provided, uses NPID_SESSION_PATH or defaults to ~/.cache/npid/rest-session/cookies.json. The containing directory is created if missing.
            timeout_seconds (int): Request timeout in seconds; coerced to be at least 5 seconds.
        """
        self.base_url: str = (base_url or os.environ.get("NPID_BASE_URL") or "https://dashboard.nationalpid.com").rstrip("/")
        self.username: Optional[str] = username or os.environ.get("NPID_USERNAME")
        self.password: Optional[str] = password or os.environ.get("NPID_PASSWORD")
        self.timeout: int = max(5, timeout_seconds)

        default_session_path = Path.home() / ".cache" / "npid" / "rest-session" / "cookies.json"
        self.session_path: Path = Path(session_path or os.environ.get("NPID_SESSION_PATH") or default_session_path)
        self.session_path.parent.mkdir(parents=True, exist_ok=True)

        self.session: requests.Session = requests.Session()
        self._load_cookies()

    # --------------- Cookie persistence ---------------
    def _load_cookies(self) -> None:
        """
        Load persisted cookies from the configured session_path JSON file into the client's requests.Session.
        
        If the session_path does not exist this method returns without action. When a cookie file is present, it reads the JSON structure expected to contain a "cookies" list and updates the session's cookie jar with those entries. Any errors while reading or parsing the file are caught and the method returns without modifying the session.
        """
        if not self.session_path.exists():
            return
        try:
            data = json.loads(self.session_path.read_text())
            jar = RequestsCookieJar()
            for c in data.get("cookies", []):
                jar.set(
                    name=c.get("name"),
                    value=c.get("value"),
                    domain=c.get("domain"),
                    path=c.get("path", "/"),
                    expires=c.get("expires"),
                    secure=c.get("secure", False),
                    rest={"HttpOnly": c.get("httponly", False)},
                )
            self.session.cookies.update(jar)
            logger.debug("Loaded %d cookies from %s", len(jar), self.session_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load cookies: %s", exc)

    def _save_cookies(self) -> None:
        """
        Save current session cookies to the configured session_path as a JSON file.
        
        Writes a JSON object with a "cookies" array where each entry contains:
        - name: cookie name
        - value: cookie value
        - domain: cookie domain
        - path: cookie path
        - expires: cookie expiration timestamp or None
        - secure: boolean indicating the Secure flag
        - httponly: boolean indicating the HttpOnly flag
        
        If writing fails for any reason, the exception is caught and a warning is logged.
        """
        try:
            export: List[Dict[str, Any]] = []
            for c in self.session.cookies:
                export.append(
                    {
                        "name": c.name,
                        "value": c.value,
                        "domain": c.domain,
                        "path": c.path,
                        "expires": c.expires,
                        "secure": c.secure,
                        "httponly": getattr(c, "_rest", {}).get("HttpOnly", False),
                    }
                )
            self.session_path.write_text(json.dumps({"cookies": export}, indent=2))
            logger.debug("Saved %d cookies to %s", len(export), self.session_path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to save cookies: %s", exc)

    # --------------- CSRF helpers ---------------
    def _get_xsrf_cookie(self) -> str:
        """
        Return the value of the XSRF cookie used for CSRF protection.
        
        Returns:
            The cookie value as a string if present, otherwise an empty string.
        """
        return self.session.cookies.get("XSRF-TOKEN", "")

    def _csrf_headers(self) -> Dict[str, str]:
        """
        Return headers containing the XSRF/CSRF token if present.
        
        Returns:
            dict: A mapping with keys "X-CSRF-TOKEN" and "X-XSRF-TOKEN" set to the XSRF token when available, otherwise an empty dict.
        """
        xsrf = self._get_xsrf_cookie()
        if not xsrf:
            return {}
        # Provide both common header names used by frameworks
        return {"X-CSRF-TOKEN": xsrf, "X-XSRF-TOKEN": xsrf}

    # --------------- Auth ---------------
    def login(self, email: Optional[str] = None, password: Optional[str] = None) -> LoginResult:
        """
        Authenticate with the NPID dashboard and persist session cookies on success.
        
        Attempts to load the login page, extract a CSRF token if present, submit credentials, and save session cookies when authentication appears successful.
        
        Parameters:
            email (Optional[str]): Email address to use for login. If omitted, the client's configured username is used.
            password (Optional[str]): Password to use for login. If omitted, the client's configured password is used.
        
        Returns:
            LoginResult: Result of the login attempt. `success` is `True` when authentication succeeded and cookies were saved; `status` contains the HTTP status code observed; `message` provides a short description.
        """
        email = email or self.username
        password = password or self.password
        if not email or not password:
            return LoginResult(False, 400, "Missing NPID credentials")

        # Prime cookies and extract CSRF token from login page
        login_url = f"{self.base_url}/auth/login"
        try:
            resp = self.session.get(login_url, timeout=self.timeout)
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            return LoginResult(False, getattr(exc, "response", Response()).status_code if hasattr(exc, "response") and exc.response else 500, f"Failed to load login page: {exc}")

        token = ""
        try:
            soup = BeautifulSoup(resp.text, "html.parser")
            # Try hidden input first
            hidden = soup.find("input", {"name": "_token"})
            if hidden and hidden.get("value"):
                token = hidden.get("value")
            if not token:
                # Try meta tag fallback
                meta = soup.find("meta", {"name": "csrf-token"})
                if meta and meta.get("content"):
                    token = meta.get("content")
        except Exception:  # noqa: BLE001
            token = ""

        form: Dict[str, str] = {"email": email, "password": password}
        if token:
            form["_token"] = token

        try:
            post = self.session.post(
                login_url,
                data=form,
                allow_redirects=False,  # Expecting 302 on success
                headers=self._csrf_headers(),
                timeout=self.timeout,
            )
        except Exception as exc:  # noqa: BLE001
            return LoginResult(False, 500, f"Login request failed: {exc}")

        status = post.status_code
        if status in (301, 302, 303, 307, 308):
            self._save_cookies()
            logger.info("NPID login success via redirect %s", status)
            return LoginResult(True, status, "Login successful")

        # Some setups may return 200 with an error page; try to detect
        if status == 200 and "logout" in post.text.lower():
            self._save_cookies()
            logger.info("NPID login likely successful (200 with logout present)")
            return LoginResult(True, status, "Login successful")

        return LoginResult(False, status, f"Unexpected login status: {status}")

    def _ensure_logged_in(self) -> None:
        # Check if session appears valid by requesting a JSON endpoint
        """
        Verify that the client's session is authenticated and attempt re-login if not.
        
        Performs a quick GET request to the inbox JSON endpoint; if the response status is 401, 403, or 419 it attempts to re-authenticate by calling login(). On network/request errors it attempts a single login as well. Raises RuntimeError when a re-login attempt fails.
        """
        try:
            res = self.session.get(f"{self.base_url}/videoteammsg/inbox", headers={"Accept": "application/json"}, timeout=self.timeout)
            if res.status_code in (401, 403, 419):
                logger.info("Session invalid (HTTP %s); attempting re-login", res.status_code)
                result = self.login()
                if not result.success:
                    raise RuntimeError(result.message)
        except requests.RequestException:
            # Try login once on network error
            result = self.login()
            if not result.success:
                raise RuntimeError(result.message)

    # --------------- JSON request helper ---------------
    def request_json(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Any, int]:
        """
        Perform an authenticated HTTP request to the API that expects JSON and return the parsed response and HTTP status.
        
        Parameters:
            method (str): HTTP method to use (typically "GET" or "POST").
            path (str): API path relative to the client's base URL (may start with or without a leading slash).
            params (Optional[Dict[str, Any]]): Query parameters to include in the request.
            payload (Optional[Dict[str, Any]]): JSON body to send for non-GET requests.
        
        Returns:
            Tuple[Any, int]: A tuple where the first element is the parsed JSON response (or a dict with `status` and `text` if the body is not valid JSON) and the second element is the HTTP status code.
        
        Raises:
            RuntimeError: If the underlying HTTP request fails (network error or other requests exceptions).
        """
        self._ensure_logged_in()

        url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        headers = {"Accept": "application/json"}
        headers.update(self._csrf_headers())

        try:
            if method.upper() == "GET":
                resp = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
            else:
                resp = self.session.post(url, params=params, json=payload, headers={**headers, "Content-Type": "application/json"}, timeout=self.timeout)
        except requests.RequestException as exc:
            raise RuntimeError(f"Request failed: {exc}")

        status = resp.status_code
        if status >= 400:
            # Try a single re-login on CSRF/session errors
            if status in (401, 403, 419):
                self.login()
                return self.request_json(method, path, params, payload)

        try:
            data = resp.json()
        except Exception:  # noqa: BLE001
            data = {"status": status, "text": resp.text}

        return data, status

    # --------------- High-level endpoints ---------------
    def get_inbox_threads(self, limit: int = 50) -> Any:
        """
        Fetches inbox threads from the NPID API.
        
        Parameters:
            limit (int): Maximum number of threads to request.
        
        Returns:
            The parsed JSON response containing the inbox threads (structure as returned by the API).
        """
        data, _ = self.request_json("GET", "/videoteammsg/inbox", params={"limit": limit})
        return data

    def get_thread_details(self, thread_id: str) -> Any:
        """
        Fetches the details for a specific inbox thread.
        
        Parameters:
            thread_id (str): ID of the inbox thread to retrieve.
        
        Returns:
            Parsed JSON data representing the thread details.
        """
        data, _ = self.request_json("GET", f"/videoteammsg/inbox/{thread_id}")
        return data

    def get_assignment_modal_data(self, thread_id: str) -> Any:
        """
        Fetch assignment-modal prefetch data for the specified inbox thread.
        
        Parameters:
            thread_id (str): The inbox thread identifier to fetch assignment prefetch data for.
        
        Returns:
            Any: The JSON-decoded response body from the assignment prefetch endpoint.
        """
        data, _ = self.request_json("GET", f"/videoteammsg/inbox/{thread_id}/assignprefetch")
        return data

    def assign_thread(self, thread_id: str, assignee: str, status: str, stage: str) -> Any:
        # Both header and payload token to satisfy CSRF protections
        """
        Assigns a thread to a user and updates its status and stage.
        
        Parameters:
            thread_id (str): Identifier of the thread to assign.
            assignee (str): Identifier (e.g., username or id) of the assignee.
            status (str): New status to set for the thread.
            stage (str): New stage to set for the thread.
        
        Returns:
            The parsed JSON response data from the assignment endpoint.
        """
        payload = {"thread_id": thread_id, "assignee": assignee, "status": status, "stage": stage, "_token": self._get_xsrf_cookie()}
        data, _ = self.request_json("POST", "/videoteammsg/inbox/assign", payload=payload)
        return data

    def search_player(self, query: str) -> Any:
        """
        Searches the video progress index for players matching the given query.
        
        Parameters:
            query (str): Text to search for (player name, email, or other searchable fields).
        
        Returns:
            Any: Parsed JSON data returned by the videoprogress endpoint (usually a list or dict of matching player records).
        """
        params = {"first_name": "", "last_name": "", "email": "", "sport": "0", "states": "0", "athlete_school": "0", "editorassigneddatefrom": "", "editorassigneddateto": "", "grad_year": "", "select_club_sport": "", "select_club_state": "", "select_club_name": "", "video_editor": "", "video_progress": "", "video_progress_stage": "", "video_progress_status": "", "search": query}
        data, _ = self.request_json("GET", "/videoteammsg/videoprogress", params=params)
        return data

    # --------------- Contact resolution (HTML scraping endpoints) ---------------
    def resolve_contacts(self, search: str, searchfor: str = "athlete") -> List[Dict[str, Any]]:
        """
        Resolve contacts matching a search query by fetching and parsing the contacts list HTML.
        
        Fetches the contacts list page for the provided query and returns a list of contact records extracted from the HTML. If the request or parsing fails, an empty list is returned.
        
        Parameters:
            search (str): Text to search for.
            searchfor (str): Target category to search for (for example "athlete"). Defaults to "athlete".
        
        Returns:
            List[Dict[str, Any]]: A list of contact dictionaries with the following keys:
                - contactId (str): The contact identifier from the page.
                - athleteMainId (str | None): Associated athlete main id if present, otherwise None.
                - name (str): Display name or a fallback identifier ("Unknown" if not available).
                - top500: Always None in current implementation (placeholder for ranking).
                - gradYear: Always None in current implementation (placeholder for graduation year).
                - state: Always None in current implementation (placeholder for state).
                - sport: Always None in current implementation (placeholder for sport).
                - videoEditor: Always None in current implementation (placeholder for video editor).
                - _raw (str): Additional raw metadata fragment extracted from nearby text, may be empty.
        """
        try:
            resp = self.session.get(
                f"{self.base_url}/templatecalendaraccesscontactslist",
                params={"search": search, "searchfor": searchfor},
                headers={"Accept": "text/html,application/xhtml+xml"},
                timeout=self.timeout,
            )
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.error("Search failed: %s", exc)
            return []

        try:
            soup = BeautifulSoup(resp.text, "html.parser")
            contacts: List[Dict[str, Any]] = []
            for radio in soup.find_all("input", {"class": "contactselected", "type": "radio"}):
                contact_id = radio.get("contactid", "")
                athlete_id = radio.get("athletemainid", "")
                # Attempt to find associated label text for richer metadata
                label = None
                name_text = ""
                extra_text = ""
                try:
                    label = radio.find_parent("label")
                    if label:
                        name_text = label.get_text(strip=True)
                    else:
                        # Try sibling text
                        name_text = radio.next_sibling.get_text(strip=True) if hasattr(radio.next_sibling, "get_text") else str(radio.next_sibling or "")
                except Exception:
                    name_text = ""
                # Very loose parse for sport/year/state from nearby text
                if name_text and "•" in name_text:
                    parts = [p.strip() for p in name_text.split("•")]
                    if len(parts) >= 2:
                        extra_text = parts[1]
                contacts.append(
                    {
                        "contactId": contact_id,
                        "athleteMainId": athlete_id or None,
                        "name": name_text or contact_id or "Unknown",
                        "top500": None,
                        "gradYear": None,
                        "state": None,
                        "sport": None,
                        "videoEditor": None,
                        "_raw": extra_text,
                    }
                )
            return contacts
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed parsing contacts: %s", exc)
            return []