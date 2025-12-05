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

# Configure logging
logger = logging.getLogger(__name__)

# Constants
NPID_BASE_URL = os.getenv("NPID_BASE_URL", "https://dashboard.nationalpid.com")
SESSION_FILE = str(Path.home() / '.npid_session.pkl')
NPID_API_KEY = os.getenv("NPID_API_KEY", "")


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
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
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

                # Compatibility Fix: Convert RequestsCookieJar to Dict for httpx
                # requests and httpx use slightly different jar implementations.
                # .get_dict() ensures we get a clean key-value pair.
                if hasattr(cookie_jar, 'get_dict'):
                    cookies = cookie_jar.get_dict()
                else:
                    cookies = dict(cookie_jar)

                self.client.cookies.update(cookies)

                # Update internal state
                self.is_authenticated = bool(self.client.cookies)
                logger.info(f"✅ Loaded {len(cookies)} cookies from session file")

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

    async def post(self, path: str, data: Dict[str, Any] = None, **kwargs) -> httpx.Response:
        """
        Authenticated POST with automatic CSRF retry.
        Mimics Python Client _retry_with_csrf (lines 198-221).
        """
        if data is None:
            data = {}

        # Ensure we have a token (fetch if missing)
        if not self.csrf_token:
            await self.refresh_csrf()

        # Inject Token
        # NOTE: Legacy Laravel often looks for '_token' in the POST body
        data["_token"] = self.csrf_token

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
