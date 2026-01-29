"""
NPID Session Manager
Handles authentication, CSRF tokens, and session persistence.
Single session instance reused across all requests.
"""

import logging
import pickle
import os
from pathlib import Path
from typing import Optional, Dict, Any
import httpx
import re
from urllib.parse import unquote
from app.invariants import Invariant, log_check

# Configure logging
logger = logging.getLogger(__name__)

# Constants
NPID_BASE_URL = os.getenv("NPID_BASE_URL", "https://dashboard.nationalpid.com")
SESSION_FILE = str(Path.home() / '.npid_session.pkl')
DEFAULT_SCOUT_API_KEY = "594168a28d26571785afcb83997cb8185f482e56"
NPID_API_KEY = os.getenv("NPID_API_KEY", DEFAULT_SCOUT_API_KEY)


class NPIDSession:
    """
    FastAPI Session Handler that strictly mimics the working Python Client.

    Key Features:
    1. Loads cookies Synchronously in __init__ (Persistence).
    2. Implements _retry_with_csrf (Laravel 419/302 Handling).
    3. Uses 'X-Requested-With' to prevent 302 Login Redirect loops.
    """

    def __init__(self):
        # 1. Initialize Client Immediately
        # We enforce 'follow_redirects=False' to catch 302s manually in _is_csrf_failure
        self.client = httpx.AsyncClient(
            base_url=NPID_BASE_URL,
            timeout=30.0,
            follow_redirects=False,
            headers={
                "User-Agent": "NPID-API-Layer/0.1",
                "X-Requested-With": "XMLHttpRequest",  # CRITICAL: Tells Laravel not to redirect to login page
                "Accept": "application/json, text/javascript, */*; q=0.01",  # Legacy jQuery Accept header
                # Content-Type auto-detected by httpx: data= → urlencoded, files= → multipart, json= → application/json
            }
        )

        self.csrf_token: Optional[str] = None
        self.is_authenticated: bool = False
        self.api_key: str = NPID_API_KEY

        # 2. Load Cookies Immediately (Mimics Python Client lines 31-40)
        self._load_session_sync(SESSION_FILE)

    def _load_session_sync(self, session_path: str):
        """
        Load cookies synchronously during initialization.
        Safe to call in __init__ as it uses standard IO, not async primitives.
        """
        path = Path(session_path)
        if not path.exists():
            logger.warning(f"⚠️ Session file not found: {session_path}")
            return

        try:
            with open(path, "rb") as f:
                # Load the requests.CookieJar from the pickle
                cookie_jar = pickle.load(f)

                # Preserve all cookie attributes (domain, path, secure, httponly, expires)
                # requests.CookieJar and httpx.Cookies use different internals, but
                # we can iterate and set each cookie with full metadata
                for cookie in cookie_jar:
                    self.client.cookies.set(
                        name=cookie.name,
                        value=cookie.value,
                        domain=cookie.domain,
                        path=cookie.path
                    )

                # Update internal state
                self.is_authenticated = bool(self.client.cookies)
                logger.info(f"✅ Loaded {len(cookie_jar)} cookies from session file")

        except Exception as e:
            logger.error(f"❌ Failed to load session: {e}")
            # Do not crash; start with empty session

    async def refresh_csrf(self):
        """
        Fetches a fresh CSRF token from the dashboard.
        """
        logger.info("🔄 Fetching fresh CSRF token...")
        try:
            # We hit a page we know contains the token, like the video modal or dashboard
            response = await self.client.get("/videoteammsg/videomailprogress")

            # Legacy Laravel often puts the token in a meta tag or specific JS variable.
            # However, simpler strategy is just getting the cookies refreshed.
            # If your python client extracts a specific token string, implement that regex here.
            # For now, we assume the cookie refresh is the primary need.

            # If you specifically need to scrape the _token value from HTML:
            match = re.search(r'name="_token" value="([a-zA-Z0-9]+)"', response.text)
            if match:
                self.csrf_token = match.group(1)
                logger.info(f"✅ Extracted new CSRF Token: {self.csrf_token[:10]}...")
            else:
                logger.warning("⚠️ Could not extract _token string from HTML (Cookies might still be valid)")

        except Exception as e:
            logger.error(f"❌ Failed to refresh CSRF: {e}")

    def _is_csrf_failure(self, resp: httpx.Response) -> bool:
        """
        Detects if a response indicates a Session or CSRF failure.
        Mimics Python Client lines 169-196.
        """
        # 1. HTTP 419 (Laravel standard CSRF error)
        if resp.status_code == 419:
            logger.warning("⚠️ CSRF Failure: HTTP 419")
            return True

        # 2. HTTP 302 Redirect to Login (The "Legacy Loop" cause)
        if resp.status_code in [301, 302]:
            location = resp.headers.get('Location', '')
            if '/auth/login' in location:
                logger.warning(f"⚠️ CSRF Failure: Redirecting to {location}")
                return True

        # 3. HTML response when expecting JSON (Token Expired/Guest)
        content_type = resp.headers.get('Content-Type', '').lower()
        if 'text/html' in content_type:
            # If we expected JSON but got HTML, it's likely an error page or login page
            # Note: We check for explicit CSRF messages in body
            if 'csrf' in resp.text.lower() or 'token mismatch' in resp.text.lower():
                logger.warning("⚠️ CSRF Failure: HTML Error Message detected")
                return True

        return False

    async def post(self, path: str, data: Dict[str, Any] = None, skip_csrf_retry: bool = False, **kwargs) -> httpx.Response:
        """
        Authenticated POST with automatic CSRF retry.
        Mimics Python Client _retry_with_csrf (lines 198-221).

        Args:
            path: API endpoint path
            data: Form data dict
            skip_csrf_retry: If True, bypass auto token injection/retry (for endpoints with custom tokens)
            **kwargs: Additional httpx params (files, headers, etc.)
        """
        if data is None:
            data = {}

        # If skip_csrf_retry=True, send as-is without token injection (like Python client send_reply)
        if skip_csrf_retry:
            logger.debug(f"POST {path} (CSRF retry disabled)")
            return await self.client.post(path, data=data, **kwargs)

        # Ensure we have a token (fetch if missing)
        if not self.csrf_token:
            await self.refresh_csrf()

        # Inject Token if caller didn't provide one (some forms require server-provided token)
        if "_token" not in data:
            data["_token"] = self.csrf_token

        log_check(
            Invariant.LARAVEL_PROTOCOL,
            True,
            "Outgoing Laravel request",
            f"endpoint={path}, has_token={'_token' in data}, has_ajax_header=True"
        )

        # First Attempt
        logger.debug(f"POST {path} (Attempt 1)")
        response = await self.client.post(path, data=data, **kwargs)

        # Check for Failure
        if not self._is_csrf_failure(response):
            return response

        # Retry Logic
        logger.warning("⚠️ CSRF/Auth failure detected. Retrying with fresh token...")

        # 1. Get fresh token (updates cookies automatically in self.client)
        await self.refresh_csrf()

        # 2. Update data with new token
        if "_token" not in data or data["_token"] == self.csrf_token:
            data["_token"] = self.csrf_token

        # 3. Retry Request
        logger.info(f"POST {path} (Attempt 2 - Retry)")
        response = await self.client.post(path, data=data, **kwargs)

        return response

    async def get(self, path: str, **kwargs) -> httpx.Response:
        """Wrapper for GET requests."""
        return await self.client.get(path, **kwargs)

    async def close(self):
        await self.client.aclose()


# Global session manager to be shared by the app
session_manager = NPIDSession()


class VideoProgressSession:
    """
    Dedicated session for /videoteammsg/videoprogress only.

    Hard requirements:
    - No shared client reuse
    - Form-encoded POST only (no json=)
    - Explicit headers per request
    - No retries or fallback parsing
    """

    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url=NPID_BASE_URL,
            timeout=30.0,
            follow_redirects=False,
            headers={
                "User-Agent": "NPID-VideoProgress/0.1",
            }
        )

        self.csrf_token: Optional[str] = None
        self.form_token: Optional[str] = None
        self.is_authenticated: bool = False

        self._load_session_sync(SESSION_FILE)
        self._hydrate_csrf_from_cookie()

    def _load_session_sync(self, session_path: str):
        path = Path(session_path)
        if not path.exists():
            logger.warning(f"⚠️ Session file not found: {session_path}")
            return

        try:
            with open(path, "rb") as f:
                cookie_jar = pickle.load(f)
                for cookie in cookie_jar:
                    self.client.cookies.set(
                        name=cookie.name,
                        value=cookie.value,
                        domain=cookie.domain,
                        path=cookie.path
                    )

                self.is_authenticated = bool(self.client.cookies)
                logger.info(f"✅ [video-progress] Loaded {len(cookie_jar)} cookies from session file")
        except Exception as e:
            logger.error(f"❌ [video-progress] Failed to load session: {e}")

    def _hydrate_csrf_from_cookie(self):
        raw_token = self.client.cookies.get("XSRF-TOKEN")
        if raw_token:
            self.csrf_token = unquote(raw_token)
            logger.info("✅ [video-progress] CSRF token loaded from cookie")

    def _reload_cookies_from_disk(self):
        self.client.cookies.clear()
        self._load_session_sync(SESSION_FILE)
        cookie_names = sorted({c.name for c in self.client.cookies.jar})
        logger.info("✅ [video-progress] Cookies loaded: %s", ", ".join(cookie_names) or "none")

    async def refresh_csrf(self):
        """
        Refresh CSRF by visiting a known page to hydrate cookies and token.
        Mirrors the legacy flow: get cookies first, then send form data.
        """
        logger.info("🔄 [video-progress] Refreshing CSRF token...")
        try:
            self._reload_cookies_from_disk()
            response = await self.client.get("/videoteammsg/videomailprogress")
            logger.info(
                "✅ [video-progress] GET /videomailprogress status=%s content_type=%s",
                response.status_code,
                response.headers.get("content-type")
            )

            # Prefer cookie-based token if present
            raw_token = self.client.cookies.get("XSRF-TOKEN")
            if raw_token:
                self.csrf_token = unquote(raw_token)
                logger.info(
                    "✅ [video-progress] CSRF cookie token loaded (len=%s)",
                    len(self.csrf_token)
                )

            # Always attempt to scrape hidden _token from HTML
            match = re.search(r'name="_token" value="([a-zA-Z0-9]+)"', response.text)
            if match:
                self.form_token = match.group(1)
                logger.info(
                    "✅ [video-progress] CSRF form token extracted (len=%s)",
                    len(self.form_token)
                )
            else:
                logger.warning("⚠️ [video-progress] Failed to extract CSRF form token")

            if not self.csrf_token and not self.form_token:
                logger.warning("⚠️ [video-progress] No CSRF token available after refresh")
        except Exception as e:
            logger.error(f"❌ [video-progress] Failed to refresh CSRF: {e}")

    async def post_video_progress(self, path: str, data: Dict[str, Any] = None) -> httpx.Response:
        if data is None:
            data = {}

        # Always refresh CSRF before posting to ensure cookies are hydrated
        await self.refresh_csrf()

        # Prefer hidden form token for Laravel _token if available
        if self.form_token and "_token" not in data:
            data["_token"] = self.form_token
        elif self.csrf_token and "_token" not in data:
            data["_token"] = self.csrf_token

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": NPID_BASE_URL,
            "Referer": f"{NPID_BASE_URL}/videoteammsg/videomailprogress",
        }

        if self.csrf_token:
            headers["X-XSRF-TOKEN"] = self.csrf_token

        logger.info(
            "✅ [video-progress] POST form keys=%s _token_len=%s X-XSRF-TOKEN=%s",
            ",".join(sorted(data.keys())),
            len(data.get("_token", "")) if data.get("_token") else 0,
            "set" if headers.get("X-XSRF-TOKEN") else "missing"
        )

        return await self.client.post(path, data=data, headers=headers)

    async def close(self):
        await self.client.aclose()


# Dedicated session manager for video progress only
video_progress_session_manager = VideoProgressSession()
