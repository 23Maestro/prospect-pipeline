"""
NPID Session Manager
Handles authentication, CSRF tokens, and session persistence.
Single session instance reused across all requests.
"""

import httpx
import logging
import re
from typing import Optional
from datetime import datetime, timedelta
import os
from pathlib import Path
import pickle

logger = logging.getLogger(__name__)

# Load from environment or fallback
NPID_BASE_URL = os.getenv("NPID_BASE_URL", "https://dashboard.nationalpid.com")
NPID_EMAIL = os.getenv("NPID_EMAIL", "")
NPID_PASSWORD = os.getenv("NPID_PASSWORD", "")
NPID_API_KEY = os.getenv("NPID_API_KEY", "")
SESSION_FILE = "/Users/singleton23/.npid_session.pkl"


class NPIDSession:
    """
    Manages authenticated session with NPID Laravel backend.
    Handles login, CSRF token refresh, and request execution.
    """
    
    def __init__(self):
        self.client: Optional[httpx.AsyncClient] = None
        self.csrf_token: Optional[str] = None
        self.is_authenticated: bool = False
        self.last_auth_time: Optional[datetime] = None
        self.api_key: str = NPID_API_KEY
        self.session_authenticated: bool = False

    async def initialize(self):
        """Initialize HTTP client and authenticate."""
        self.client = httpx.AsyncClient(
            base_url=NPID_BASE_URL,
            timeout=30.0,
            follow_redirects=True,
            headers={
                "User-Agent": "NPID-API-Layer/0.1",
                "X-Requested-With": "XMLHttpRequest"
            }
        )
        self.login()
        await self.refresh_csrf()
        
    async def close(self):
        """Close HTTP client."""
        if self.client:
            await self.client.aclose()
            
    def login(self):
        """
        Load existing Laravel session from disk.
        If session file doesn't exist or is invalid, fall back to credential login.
        """
        # Try loading existing session first
        if SESSION_FILE and Path(SESSION_FILE).exists():
            self._load_session(SESSION_FILE)
            self.is_authenticated = True
            self.session_authenticated = True
            logger.info("✅ Loaded session from disk")
            return True

        # Fallback: Login with credentials if session file missing
        if NPID_EMAIL and NPID_PASSWORD:
            logger.warning("⚠️ Session file not found, logging in with credentials...")
            return self._perform_login()

        logger.error("❌ No session file and no credentials provided")
        raise Exception("Cannot authenticate: no session file and no credentials in .env")

    def _perform_login(self):
        """Perform actual login with credentials (fallback only)."""
        import asyncio
        from bs4 import BeautifulSoup

        if not self.client:
            raise Exception("HTTP client not initialized")

        # Get CSRF token from login page
        loop = asyncio.get_event_loop()
        login_page = loop.run_until_complete(self.client.get("/auth/login"))
        soup = BeautifulSoup(login_page.text, 'html.parser')
        token_input = soup.find('input', {'name': '_token'})

        if not token_input:
            raise Exception("Could not find CSRF token on login page")

        csrf_token = token_input.get('value')

        # Login with credentials
        login_data = {
            'email': NPID_EMAIL,
            'password': NPID_PASSWORD,
            '_token': csrf_token,
            'remember': 'on'  # 400-day persistence
        }

        response = loop.run_until_complete(
            self.client.post(
                "/auth/login",
                data=login_data,
                headers={
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': f"{NPID_BASE_URL}/auth/login"
                }
            )
        )

        if response.status_code in [200, 302]:
            logger.info("✅ Login successful with credentials")
            self.is_authenticated = True
            self.session_authenticated = True

            # Save session for future use
            self._save_session()
            return True

        raise Exception(f"Login failed: HTTP {response.status_code}")

    def _save_session(self):
        """Save cookies to session file for reuse."""
        if not SESSION_FILE or not self.client:
            return
        try:
            session_path = Path(SESSION_FILE)
            with open(session_path, 'wb') as f:
                pickle.dump(dict(self.client.cookies), f)
            logger.info(f"✅ Saved session to {session_path}")
        except Exception as e:
            logger.error(f"❌ Failed to save session: {e}")

    def _load_session(self, session_path: str):
        """Load cookies from an existing session file."""
        if not session_path:
            return
        try:
            session_file = Path(session_path)
            if session_file.exists():
                with open(session_file, "rb") as f:
                    cookies = pickle.load(f)
                    if self.client:
                        self.client.cookies.update(cookies)
                logger.info(f"✅ Loaded session from {session_file}")
            else:
                logger.warning(f"⚠️ Session file not found: {session_file}")
        except Exception as e:
            logger.error(f"❌ Failed to load session from {session_path}: {e}")
            
    async def ensure_authenticated(self):
        """Re-authenticate if session is stale (>30 min)."""
        # No automatic login; rely on preloaded session only.
        return
            
    async def get(self, path: str, **kwargs) -> httpx.Response:
        """Execute authenticated GET request."""
        await self.ensure_authenticated()
        return await self.client.get(path, **kwargs)
        
    async def post(self, path: str, data: dict = None, **kwargs) -> httpx.Response:
        """Execute authenticated POST request with CSRF token."""
        await self.ensure_authenticated()

        if data is None:
            data = {}

        # Inject CSRF token
        if not self.csrf_token:
            await self.refresh_csrf()
        data["_token"] = self.csrf_token

        # Inject API key if available
        if self.api_key:
            data["api_key"] = self.api_key
            
        return await self.client.post(
            path,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            **kwargs
        )

    async def refresh_csrf(self):
        """Fetch a fresh CSRF token from Laravel and cache it."""
        if not self.client:
            return
        try:
            resp = await self.client.get("/auth/login")
            token_match = re.search(r'name="_token"\\s+value="([^"]+)"', resp.text)
            if token_match:
                self.csrf_token = token_match.group(1)
                logger.info("✅ Refreshed CSRF token from /auth/login")
        except Exception as e:
            logger.error(f"❌ Failed to refresh CSRF token: {e}")


# Global session manager to be shared by the app
session_manager = NPIDSession()
