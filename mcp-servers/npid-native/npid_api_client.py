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
        return self.session.cookies.get("XSRF-TOKEN", "")

    def _csrf_headers(self) -> Dict[str, str]:
        xsrf = self._get_xsrf_cookie()
        if not xsrf:
            return {}
        # Provide both common header names used by frameworks
        return {"X-CSRF-TOKEN": xsrf, "X-XSRF-TOKEN": xsrf}

    # --------------- Auth ---------------
    def login(self, email: Optional[str] = None, password: Optional[str] = None) -> LoginResult:
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
        data, _ = self.request_json("GET", "/videoteammsg/inbox", params={"limit": limit})
        return data

    def get_thread_details(self, thread_id: str) -> Any:
        data, _ = self.request_json("GET", f"/videoteammsg/inbox/{thread_id}")
        return data

    def get_assignment_modal_data(self, thread_id: str) -> Any:
        data, _ = self.request_json("GET", f"/videoteammsg/inbox/{thread_id}/assignprefetch")
        return data

    def assign_thread(self, thread_id: str, assignee: str, status: str, stage: str) -> Any:
        # Both header and payload token to satisfy CSRF protections
        payload = {"thread_id": thread_id, "assignee": assignee, "status": status, "stage": stage, "_token": self._get_xsrf_cookie()}
        data, _ = self.request_json("POST", "/videoteammsg/inbox/assign", payload=payload)
        return data

    def search_player(self, query: str) -> Any:
        params = {"first_name": "", "last_name": "", "email": "", "sport": "0", "states": "0", "athlete_school": "0", "editorassigneddatefrom": "", "editorassigneddateto": "", "grad_year": "", "select_club_sport": "", "select_club_state": "", "select_club_name": "", "video_editor": "", "video_progress": "", "video_progress_stage": "", "video_progress_status": "", "search": query}
        data, _ = self.request_json("GET", "/videoteammsg/videoprogress", params=params)
        return data

    # --------------- Contact resolution (HTML scraping endpoints) ---------------
    def resolve_contacts(self, search: str, searchfor: str = "athlete") -> List[Dict[str, Any]]:
        """Resolve contacts by parsing HTML returned from search endpoint.
        Falls back to empty list if nothing found.
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
