#!/usr/bin/env python3
"""
Unified Session Manager - Hybrid Playwright/Selenium Architecture
Consolidates session persistence from scout-n8n-singleton and playerid-updates-v2

Architecture:
- Playwright: Primary session engine with persistent context (userDataDir)
- Selenium: DOM fallback for complex modal interactions and robust HTML parsing
- Shared State: Centralized cache at ~/.cache/playwright/npid/ for cookies/tokens
"""
import os
import json
import logging
from pathlib import Path
from enum import Enum
from typing import Optional, Dict, Any
from contextlib import contextmanager

from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class AutomationEngine(Enum):
    """Automation engine selection"""
    SELENIUM = "selenium"
    PLAYWRIGHT = "playwright"  # Future expansion


class SessionManager:
    """
    Hybrid session manager for NPID automation
    Maintains persistent browser sessions across script executions
    """
    
    # Centralized session cache
    CACHE_DIR = Path.home() / ".cache" / "playwright" / "npid"
    SELENIUM_PROFILE_DIR = CACHE_DIR / "selenium-profile"
    SHARED_STATE_DIR = CACHE_DIR / "shared-state"
    
    # Session files
    COOKIES_FILE = SHARED_STATE_DIR / "cookies.json"
    SESSION_STATE_FILE = SHARED_STATE_DIR / "session_state.json"
    
    def __init__(
        self,
        engine: AutomationEngine = AutomationEngine.SELENIUM,
        headless: bool = False,
        debug: bool = False
    ):
        """
        Initialize session manager
        
        Args:
            engine: Automation engine to use (default: Selenium)
            headless: Run browser in headless mode
            debug: Enable debug logging
        """
        self.engine = engine
        self.headless = headless
        self.debug = debug
        self.driver: Optional[webdriver.Chrome] = None
        
        # Ensure cache directories exist
        self._init_cache_directories()
        
        if debug:
            logging.getLogger().setLevel(logging.DEBUG)
            logger.debug("Session manager initialized in debug mode")
    
    def _init_cache_directories(self):
        """Create cache directory structure if it doesn't exist"""
        for directory in [self.SELENIUM_PROFILE_DIR, self.SHARED_STATE_DIR]:
            directory.mkdir(parents=True, exist_ok=True)
            logger.debug(f"Ensured cache directory exists: {directory}")
    
    def _build_selenium_driver(self) -> webdriver.Chrome:
        """
        Build Selenium Chrome driver with persistent profile
        
        Returns:
            Configured Chrome WebDriver instance
        """
        logger.info("Building Selenium ChromeDriver with persistent session...")
        
        options = Options()
        
        # Persistent profile for session continuity
        options.add_argument(f"--user-data-dir={self.SELENIUM_PROFILE_DIR}")
        
        # Headless configuration
        if self.headless:
            options.add_argument("--headless=new")
        
        # Stability flags
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1280,800")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--no-sandbox")
        options.add_argument("--start-maximized")
        
        # Suppress unnecessary logging
        if not self.debug:
            options.add_argument("--disable-logging")
            options.add_argument("--log-level=3")
            options.add_experimental_option('excludeSwitches', ['enable-logging'])
        
        # Chrome binary location detection
        chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        
        for chrome_path in chrome_paths:
            if os.path.exists(chrome_path):
                options.binary_location = chrome_path
                logger.debug(f"Using Chrome binary: {chrome_path}")
                break
        
        # ChromeDriver setup with explicit path (bypasses webdriver-manager bug)
        try:
            # Use explicit path to avoid THIRD_PARTY_NOTICES.chromedriver bug
            chromedriver_path = "/Users/singleton23/.wdm/drivers/chromedriver/mac64/141.0.7390.76/chromedriver-mac-arm64/chromedriver"
            service = ChromeService(executable_path=chromedriver_path)
            
            driver = webdriver.Chrome(service=service, options=options)
            driver.implicitly_wait(10)  # Standard implicit wait
            
            logger.info("✓ Selenium ChromeDriver initialized successfully")
            return driver
            
        except Exception as e:
            logger.error(f"Failed to initialize ChromeDriver: {e}")
            raise
    
    def initialize(self):
        """Initialize the session manager and browser driver"""
        if self.engine == AutomationEngine.SELENIUM:
            self.driver = self._build_selenium_driver()
        else:
            raise NotImplementedError(f"Engine {self.engine} not yet implemented")
        
        # Load session state if it exists
        self._load_session_state()
        
        return self.driver
    
    def _load_session_state(self):
        """Load persisted session state from shared cache"""
        if self.SESSION_STATE_FILE.exists():
            try:
                with open(self.SESSION_STATE_FILE, 'r') as f:
                    state = json.load(f)
                    logger.info(f"Loaded session state: {state.get('last_login', 'unknown')}")
            except Exception as e:
                logger.warning(f"Could not load session state: {e}")
    
    def _save_session_state(self, state: Dict[str, Any]):
        """Save session state to shared cache"""
        try:
            with open(self.SESSION_STATE_FILE, 'w') as f:
                json.dump(state, f, indent=2)
                logger.debug(f"Saved session state: {state}")
        except Exception as e:
            logger.error(f"Failed to save session state: {e}")
    
    def save_cookies(self):
        """Export current browser cookies to shared cache"""
        if not self.driver:
            logger.warning("No active driver - cannot save cookies")
            return
        
        try:
            cookies = self.driver.get_cookies()
            with open(self.COOKIES_FILE, 'w') as f:
                json.dump(cookies, f, indent=2)
            
            logger.info(f"✓ Saved {len(cookies)} cookies to {self.COOKIES_FILE}")
            
            # Update session state
            self._save_session_state({
                'last_cookie_save': str(self.COOKIES_FILE.stat().st_ctime),
                'cookie_count': len(cookies)
            })
            
        except Exception as e:
            logger.error(f"Failed to save cookies: {e}")
    
    def load_cookies(self):
        """Load cookies from shared cache into browser"""
        if not self.driver:
            logger.warning("No active driver - cannot load cookies")
            return
        
        if not self.COOKIES_FILE.exists():
            logger.info("No saved cookies found - fresh session")
            return
        
        try:
            with open(self.COOKIES_FILE, 'r') as f:
                cookies = json.load(f)
            
            for cookie in cookies:
                self.driver.add_cookie(cookie)
            
            logger.info(f"✓ Loaded {len(cookies)} cookies from {self.COOKIES_FILE}")
            
        except Exception as e:
            logger.error(f"Failed to load cookies: {e}")
    
    def cleanup(self):
        """Clean up browser resources"""
        if self.driver:
            try:
                self.save_cookies()  # Persist cookies before cleanup
                self.driver.quit()
                logger.info("✓ Session cleanup completed")
            except Exception as e:
                logger.error(f"Error during cleanup: {e}")
            finally:
                self.driver = None
    
    def get_active_engine(self) -> AutomationEngine:
        """Get currently active automation engine"""
        return self.engine
    
    @contextmanager
    def session(self):
        """
        Context manager for session lifecycle
        
        Usage:
            with SessionManager().session() as driver:
                driver.get('https://example.com')
        """
        try:
            driver = self.initialize()
            yield driver
        finally:
            self.cleanup()


# === CONVENIENCE FUNCTIONS ===

def get_selenium_driver(headless: bool = False, debug: bool = False) -> webdriver.Chrome:
    """
    Get a configured Selenium driver with persistent session
    
    Args:
        headless: Run in headless mode
        debug: Enable debug logging
    
    Returns:
        Configured Chrome WebDriver
    """
    manager = SessionManager(
        engine=AutomationEngine.SELENIUM,
        headless=headless,
        debug=debug
    )
    return manager.initialize()


# === EXAMPLE USAGE ===
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Test unified session manager")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--url", default="https://dashboard.nationalpid.com", 
                       help="Test URL to navigate to")
    
    args = parser.parse_args()
    
    # Test session manager
    manager = SessionManager(headless=args.headless, debug=args.debug)
    
    with manager.session() as driver:
        logger.info(f"Navigating to {args.url}...")
        driver.get(args.url)
        
        logger.info(f"Current URL: {driver.current_url}")
        logger.info(f"Page title: {driver.title}")
        
        # Test session persistence
        input("\n✓ Press Enter to save session and exit...")
        
    logger.info("Session test completed successfully")
