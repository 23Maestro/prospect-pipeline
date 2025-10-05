#!/usr/bin/env python3
"""Playwright-powered automation layer for the NPID dashboard."""
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

logger = logging.getLogger("npid-automator")


class AutomatorError(RuntimeError):
    """Raised when the Playwright automation layer cannot satisfy a request."""


class NpidAutomator:
    """Manage browser automation for the NPID dashboard using Playwright."""

    def __init__(self, base_url: str, username: str, password: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        state_path = os.environ.get("NPID_PLAYWRIGHT_STATE_PATH", str(Path.home() / "Raycast/scout-singleton/state/playwright_state.json"))
        self._storage_path = Path(state_path).expanduser()
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        token_path = os.environ.get("NPID_TOKEN_PATH", str(Path.home() / "Raycast/scout-singleton/state/npid_tokens.json"))
        self._token_path = Path(token_path).expanduser()
        self._token_path.parent.mkdir(parents=True, exist_ok=True)

        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._csrf_token: str = ""
        self._lock = asyncio.Lock()
        self._last_login: Optional[datetime] = None
        ttl_minutes = int(os.environ.get("NPID_SESSION_TTL_MINUTES", "45"))
        self._session_ttl = timedelta(minutes=max(ttl_minutes, 5))

    async def close(self) -> None:
        async with self._lock:
            if self._context:
                await self._context.close()
            if self._browser:
                await self._browser.close()
            if self._playwright:
                await self._playwright.stop()
            self._context = None
            self._browser = None
            self._playwright = None
            self._page = None
            self._csrf_token = ""

    async def ensure_login(self) -> None:
        async with self._lock:
            await self._ensure_started()
            if self._is_session_fresh():
                await self._persist_token_bundle()
                return
            if not self.username or not self.password:
                raise AutomatorError("NPID_USERNAME and NPID_PASSWORD are required for Playwright auth")
            await self._perform_login()

    def _is_session_fresh(self) -> bool:
        if not self._page or not self._last_login:
            return False
        return datetime.now(timezone.utc) - self._last_login < self._session_ttl

    async def request_json(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None, params: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], int]:
        await self.ensure_login()
        url = self._build_url(path, params)
        body = payload or {}

        async with self._lock:
            result = await self._fetch_json(url, method, body)
            status = result.get("status", 0)
            if status in {401, 403, 419}:
                logger.info("Session rejected (HTTP %s); refreshing login", status)
                await self._perform_login(force=True)
                result = await self._fetch_json(url, method, body)
                status = result.get("status", 0)

        response_body = result.get("body", "")
        try:
            data = json.loads(response_body) if response_body else {}
        except json.JSONDecodeError as exc:
            logger.error("Failed to decode JSON from %s: %s", url, exc)
            raise AutomatorError(f"Unexpected response format from {url}") from exc
        return data, status

    def get_csrf_token(self) -> str:
        return self._csrf_token

    async def _ensure_started(self) -> None:
        if self._playwright:
            return
        playwright = await async_playwright().start()
        headless = os.environ.get("PLAYWRIGHT_HEADFUL", "").strip() == ""
        extra_args = os.environ.get("PLAYWRIGHT_CHROMIUM_ARGS", "")
        chrome_args = ["--disable-dev-shm-usage", "--no-sandbox"]
        if extra_args:
            chrome_args.extend(arg for arg in extra_args.split() if arg)
        browser = await playwright.chromium.launch(headless=headless, args=chrome_args)
        storage = str(self._storage_path) if self._storage_path.exists() else None
        context = await browser.new_context(storage_state=storage)
        page = await context.new_page()

        self._playwright = playwright
        self._browser = browser
        self._context = context
        self._page = page
        if storage:
            await self._refresh_csrf_token()
            self._last_login = datetime.now(timezone.utc)
            await self._persist_token_bundle()

    async def _perform_login(self, force: bool = False) -> None:
        assert self._page is not None
        login_url = f"{self.base_url}/auth/login"
        target_url = f"{self.base_url}/videoteammsg/inbox"
        if not force:
            try:
                await self._page.goto(target_url, wait_until="domcontentloaded")
                if "auth/login" not in self._page.url:
                    await self._refresh_csrf_token()
                    self._last_login = datetime.now(timezone.utc)
                    await self._save_storage_state()
                    return
            except PlaywrightTimeoutError:
                logger.debug("Timeout while checking existing session; continuing with login")

        logger.info("Performing NPID login via Playwright")
        await self._page.goto(login_url, wait_until="domcontentloaded")
        try:
            email_input = self._page.locator("input[name='email']")
            password_input = self._page.locator("input[name='password']")
            submit_button = self._page.locator("button[type='submit'], input[type='submit']")
            await email_input.fill(self.username, timeout=10000)
            await password_input.fill(self.password, timeout=10000)
            await submit_button.click()
            await self._page.wait_for_load_state("networkidle", timeout=20000)
        except PlaywrightTimeoutError as exc:
            raise AutomatorError("Timed out while submitting NPID login form") from exc

        if "auth/login" in self._page.url:
            raise AutomatorError("NPID login failed; still on login page")

        try:
            await self._page.wait_for_load_state("domcontentloaded", timeout=15000)
        except PlaywrightTimeoutError:
            logger.debug("Continuing after login despite DOMContentLoaded timeout")

        await self._refresh_csrf_token()
        self._last_login = datetime.now(timezone.utc)
        await self._save_storage_state()
        await self._persist_token_bundle()

    async def _fetch_json(self, url: str, method: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        assert self._page is not None
        script = """
        async ({ url, method, body, csrf }) => {
            const headers = {
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest'
            };
            const verb = method.toUpperCase();
            if (verb !== 'GET' && verb !== 'HEAD') {
                headers['Content-Type'] = 'application/json;charset=UTF-8';
            }
            if (csrf) {
                headers['X-CSRF-TOKEN'] = csrf;
            }
            const options = {
                method: verb,
                headers,
                credentials: 'same-origin'
            };
            if (verb !== 'GET' && verb !== 'HEAD') {
                options.body = JSON.stringify(body);
            }
            const response = await fetch(url, options);
            const text = await response.text();
            return { status: response.status, body: text };
        }
        """
        try:
            return await self._page.evaluate(script, {"url": url, "method": method, "body": payload, "csrf": self._csrf_token})
        except PlaywrightTimeoutError as exc:
            raise AutomatorError(f"Timed out waiting for response from {url}") from exc

    async def _refresh_csrf_token(self) -> None:
        assert self._page is not None
        try:
            token = await self._page.evaluate("() => document.querySelector(\"meta[name='csrf-token']\")?.getAttribute('content') || ''")
        except PlaywrightTimeoutError:
            token = ""
        if token:
            self._csrf_token = token

    async def _save_storage_state(self) -> None:
        if not self._context:
            return
        try:
            await self._context.storage_state(path=str(self._storage_path))
        except PlaywrightTimeoutError:
            logger.warning("Timed out while saving Playwright storage state")

    def _build_url(self, path: str, params: Optional[Dict[str, Any]]) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            url = path
        else:
            url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        if not params:
            return url
        filtered = {key: value for key, value in params.items() if value not in (None, "")}
        if not filtered:
            return url
        separator = '&' if '?' in url else '?'
        return f"{url}{separator}{urlencode(filtered)}"

    async def _persist_token_bundle(self) -> None:
        if not self._context:
            return
        try:
            cookies = await self._context.cookies()
        except PlaywrightTimeoutError:
            cookies = []

        xsrf_token = ""
        session_cookie = ""
        for cookie in cookies:
            name = cookie.get("name", "")
            value = cookie.get("value", "")
            if name == "XSRF-TOKEN":
                xsrf_token = value
            elif name == "myapp_session":
                session_cookie = value

        bundle = {
            "xsrf_token": xsrf_token,
            "session_cookie": session_cookie,
            "form_token": self._csrf_token,
            "refreshed_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": None,
        }
        tmp_path = self._token_path.with_suffix(".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as handle:
                json.dump(bundle, handle, indent=2)
            tmp_path.replace(self._token_path)
        except OSError as exc:
            logger.warning("Unable to persist token snapshot: %s", exc)


_default_automator: Optional[NpidAutomator] = None


def get_automator() -> NpidAutomator:
    global _default_automator
    if _default_automator is None:
        base_url = os.environ.get("NPID_BASE_URL", "https://dashboard.nationalpid.com")
        username = os.environ.get("NPID_USERNAME", "")
        password = os.environ.get("NPID_PASSWORD", "")
        _default_automator = NpidAutomator(base_url, username, password)
    return _default_automator


__all__ = ["AutomatorError", "NpidAutomator", "get_automator"]
