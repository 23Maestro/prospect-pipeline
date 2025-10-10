#!/usr/bin/env python3
"""
Complete NPID Automator with all inbox methods
Uses the saved Playwright state for 400-day session
"""
from session_manager import SessionManager
import re
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class NpidAutomator:
    def __init__(self, headless=True):
        self.base_url = "https://dashboard.nationalpid.com"
        self.manager = SessionManager(headless=headless)
        self.driver: WebDriver | None = None

    async def ensure_browser(self):
        """Ensure browser is running with saved state"""
        if self.browser and self.context and self.page:
            return
        
        pw = await async_playwright().start()
        self.browser = await pw.chromium.launch(headless=True)
        
        # Load saved state
        if self.state_path.exists():
            with open(self.state_path) as f:
                state = json.load(f)
            self.context = await self.browser.new_context()
            await self.context.add_cookies(state.get("cookies", []))
        else:
            self.context = await self.browser.new_context()
        
        self.page = await self.context.new_page()

    def get_inbox_threads(self, limit=50):
        """Get inbox threads from NPID"""
        driver = self._get_driver()
        
        # Navigate to inbox
        driver.get(f"{self.base_url}/admin/videomailbox")
        
        # Check if logged in
        url = driver.current_url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Wait for page to fully load (inbox loads via AJAX)
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, '#inbox_tab div.ImageProfile'))
        )
        
        # NPID uses div.ImageProfile for each message in #inbox_tab
        message_elements = driver.find_elements(By.CSS_SELECTOR, '#inbox_tab div.ImageProfile')
        
        threads = []
        for elem in message_elements[:limit]:
            try:
                # Get message ID from attributes
                item_id = elem.get_attribute('itemid')
                item_code = elem.get_attribute('itemcode')
                message_id = elem.get_attribute('id')
                
                if not item_id:
                    continue
                
                # Extract email from hidden div
                email_elem = elem.find_element(By.CSS_SELECTOR, '.hidden')
                email = email_elem.text.strip() if email_elem else ""

                # Extract contact and athlete IDs from data attributes
                contact_id = elem.get_attribute('contacttask')
                athlete_main_id = elem.get_attribute('athletemainid')
                
                # Extract name from msg-sendr-name span
                name_elem = elem.find_element(By.CSS_SELECTOR, '.msg-sendr-name')
                name = name_elem.text.strip() if name_elem else "Unknown"
                
                # Extract ACTUAL subject from tit_line1 (not preview from tit_univ!)
                subject_elem = elem.find_element(By.CSS_SELECTOR, '.tit_line1')
                subject = ""
                if subject_elem:
                    subject = subject_elem.text.strip()
                
                # Extract preview/content from tit_univ (but strip reply chains)
                preview_elem = elem.find_element(By.CSS_SELECTOR, '.tit_univ')
                preview = ""
                if preview_elem:
                    preview_text = preview_elem.text.strip()
                    # Strip reply chain - everything after "On ... Prospect ID Video ... wrote:"
                    reply_pattern = r'On\s+.+?\s+Prospect\s+ID\s+Video\s+.+?wrote:'
                    match = re.search(reply_pattern, preview_text, re.IGNORECASE | re.DOTALL)
                    if match:
                        preview = preview_text[:match.start()].strip()
                    else:
                        preview = preview_text[:300] if len(preview_text) > 300 else preview_text
                
                # Extract timestamp from date_css
                time_elem = elem.find_element(By.CSS_SELECTOR, '.date_css')
                timestamp = ""
                if time_elem:
                    timestamp_text = time_elem.text.strip()
                    # Get first line only (date, not time)
                    timestamp = timestamp_text.split('\n')[0].strip() if timestamp_text else ""
                
                # Check assignment status by looking for plus icon (assignable) vs profile pic (assigned)
                # Assignable threads have: <i class="fa fa-plus-circle assign_video_team">
                # Assigned threads have: <img src*="PROFILE_IMG">
                plus_icon = elem.find_elements(By.CSS_SELECTOR, '.fa-plus-circle')
                profile_img = elem.find_elements(By.CSS_SELECTOR, 'img[src*="PROFILE_IMG"]')
                
                can_assign = len(plus_icon) > 0
                is_assigned = len(profile_img) > 0
                
                threads.append({
                    "id": message_id or f"message_{item_id}",
                    "itemcode": item_code or "",
                    "contact_id": contact_id or "",
                    "athlete_main_id": athlete_main_id or "",
                    "name": name,
                    "subject": subject,
                    "preview": preview,
                    "status": "assigned" if is_assigned else "unassigned",
                    "timestamp": timestamp,
                    "email": email,
                    "can_assign": can_assign
                })
            except Exception as e:
                continue
        
        return threads

    def get_thread_details(self, thread_id):
        """Get full email content by clicking thread and extracting from detail view"""
        driver = self._get_driver()
        
        # Ensure we're on the inbox page
        if "/videomailbox" not in driver.current_url:
            driver.get(f"{self.base_url}/admin/videomailbox")
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '#inbox_tab'))
            )
        
        try:
            # Click on the thread to open detail view (using correct selector)
            clickable = driver.find_element(By.CSS_SELECTOR, f'#{thread_id} .rightTwo')
            if not clickable:
                raise Exception(f"Thread {thread_id} not found")
            
            clickable.click()
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '.msgs_full'))
            )
            
            # Extract email details from the detail view
            # Subject from tit_line1 in detail view
            subject_elem = driver.find_element(By.CSS_SELECTOR, '.tit_line1')
            subject = subject_elem.text.strip() if subject_elem else ""
            
            # Get full message body from msgs_full
            body_elem = driver.find_element(By.CSS_SELECTOR, '.msgs_full')
            full_content = ""
            if body_elem:
                body_text = body_elem.text.strip()
                # Strip reply chain - everything after "On ... Prospect ID Video ... wrote:"
                reply_pattern = r'On\s+.+?\s+Prospect\s+ID\s+Video\s+.+?wrote:'
                match = re.search(reply_pattern, body_text, re.IGNORECASE | re.DOTALL)
                if match:
                    full_content = body_text[:match.start()].strip()
                else:
                    full_content = body_text
            
            return {
                "id": thread_id,
                "subject": subject,
                "content": full_content,
                "attachments": []
            }
        except Exception as e:
            return {"id": thread_id, "content": "", "error": str(e)}

    def search_player(self, query):
        """Search for a player"""
        driver = self._get_driver()
        
        # Navigate to search or use search field
        search_input = driver.find_element(By.CSS_SELECTOR, 'input[name="searchstring"], #findaathlete')
        search_input.send_keys(query)
        
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, '.ui-autocomplete li, .search-result'))
        )
        
        # Get autocomplete results
        results = driver.find_elements(By.CSS_SELECTOR, '.ui-autocomplete li, .search-result')
        
        contacts = []
        for result in results[:10]:
            text = result.text.strip()
            contacts.append({
                "contactId": text,
                "name": text,
                "email": ""
            })
        
        return contacts

    def get_assignment_modal_data(self, thread_id=None, contact_id=None):
        """Get assignment modal data"""
        driver = self._get_driver()
        
        # Ensure we're on inbox page
        if "/videomailbox" not in driver.current_url:
            driver.get(f"{self.base_url}/admin/videomailbox")
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '#inbox_tab'))
            )
        
        # Click the plus icon to open assignment modal
        if thread_id:
            # Look for the assign_img div which contains the plus button
            try:
                assign_img = driver.find_element(By.CSS_SELECTOR, f'#{thread_id} .assign_img')
                driver.execute_script("arguments[0].click();", assign_img)
            except Exception:
                # Fallback: look for plus icon directly
                plus_icon = driver.find_element(By.CSS_SELECTOR, f'#{thread_id} .fa-plus-circle')
                if not plus_icon:
                    raise Exception(f"Plus icon not found for thread {thread_id}")
                driver.execute_script("arguments[0].click();", plus_icon)
        
        # Wait for modal to open (Assigned Owner field appears)
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'select[name="owner"], input[name="owner"]'))
        )
        
        # Extract modal options
        owners = driver.find_elements(By.CSS_SELECTOR, 'select[name="owner"] option, input[name="owner"]')
        stages = driver.find_elements(By.CSS_SELECTOR, 'select[name="stage"] option')
        statuses = driver.find_elements(By.CSS_SELECTOR, 'select[name="status"] option')
        
        owner_options = []
        for owner in owners:
            value = owner.get_attribute('value')
            text = owner.text
            if value:
                owner_options.append({"value": value, "label": text or value})
        
        stage_options = []
        for stage in stages:
            value = stage.get_attribute('value')
            text = stage.text
            if value:
                stage_options.append({"value": value, "label": text or value})
        
        status_options = []
        for status in statuses:
            value = status.get_attribute('value')
            text = status.text
            if value:
                status_options.append({"value": value, "label": text or value})
        
        return {
            "owners": owner_options,
            "stages": stage_options,
            "videoStatuses": status_options,
            "defaultOwner": owner_options[0] if owner_options else None
        }

    def assign_thread(self, thread_id, assignee=None, status=None, stage=None, contact_id=None,
                      athlete_main_id=None, contact_email=None):
        """
        Assign a thread via REST API (handles both student and parent emails)

        Flow:
        1. Student emails: Instant assignment (modal has pre-filled data)
        2. Parent emails: Auto-search with searchfor=parent
        3. Always assigns to Jerami Singleton (1408164)

        Args:
            thread_id: Thread message ID
            contact_email: Email address from inbox (required)
            stage: Video progress stage (default: "In Queue")
            status: Video progress status (default: "HUDL")
        """
        from npid_rest_client import NpidRestClient

        driver = self._get_driver()

        # Ensure we're logged in (driver has cookies)
        if "/videomailbox" not in driver.current_url:
            driver.get(f"{self.base_url}/admin/videomailbox")
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '#inbox_tab'))
            )

        # Extract cookies from Selenium driver
        cookies = {}
        for cookie in driver.get_cookies():
            cookies[cookie['name']] = cookie['value']

        # Create REST client with cookies
        client = NpidRestClient(cookies)

        # Make REST API call (handles student vs parent logic internally)
        result = client.assign_thread(
            message_id=thread_id,
            email=contact_email,
            stage=stage or 'In Queue',
            status=status or 'HUDL'
        )

        return result

    def get_video_progress_data(self):
        """Get video progress data from NPID using saved state - NO TOKENS!"""
        driver = self._get_driver()
        
        # Navigate to video progress page - saved state handles all auth
        driver.get(f"{self.base_url}/videoteammsg/videomailprogress")
        
        # Check if logged in
        url = driver.current_url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Wait for page to load and data to populate
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'tr[data-player-id], .video-progress-row, .athlete-row'))
        )
        
        # Extract video progress data directly from the page - no API calls needed!
        video_progress_data = driver.execute_script("""
            const data = [];
            
            // Look for video progress table rows or data containers
            const rows = document.querySelectorAll('tr[data-player-id], .video-progress-row, .athlete-row');
            
            rows.forEach(row => {
                try {
                    const playerId = row.getAttribute('data-player-id') || 
                                   row.querySelector('[data-player-id]')?.getAttribute('data-player-id') ||
                                   row.querySelector('.player-id')?.textContent?.trim();
                    
                    const name = row.querySelector('.player-name, .athlete-name, .name')?.textContent?.trim() ||
                               row.querySelector('td:nth-child(1)')?.textContent?.trim();
                    
                    const gradYear = row.querySelector('.grad-year, .class-of')?.textContent?.trim() ||
                                   row.querySelector('td:nth-child(2)')?.textContent?.trim();
                    
                    const highSchool = row.querySelector('.high-school, .school')?.textContent?.trim() ||
                                     row.querySelector('td:nth-child(3)')?.textContent?.trim();
                    
                    const location = row.querySelector('.location, .city-state')?.textContent?.trim() ||
                                   row.querySelector('td:nth-child(4)')?.textContent?.trim();
                    
                    const positions = row.querySelector('.positions, .position')?.textContent?.trim() ||
                                    row.querySelector('td:nth-child(5)')?.textContent?.trim();
                    
                    const sport = row.querySelector('.sport, .primary-sport')?.textContent?.trim() ||
                                row.querySelector('td:nth-child(6)')?.textContent?.trim();
                    
                    const videoStage = row.querySelector('.video-stage, .stage')?.textContent?.trim() ||
                                     row.querySelector('td:nth-child(7)')?.textContent?.trim();
                    
                    const videoStatus = row.querySelector('.video-status, .status')?.textContent?.trim() ||
                                      row.querySelector('td:nth-child(8)')?.textContent?.trim();
                    
                    const videoEditor = row.querySelector('.video-editor, .editor')?.textContent?.trim() ||
                                      row.querySelector('td:nth-child(9)')?.textContent?.trim();
                    
                    if (playerId && name) {
                        data.push({
                            player_id: playerId,
                            player_name: name,
                            grad_year: gradYear || '',
                            high_school: highSchool || '',
                            location: location || '',
                            positions: positions || '',
                            sport: sport || '',
                            video_progress_stage: videoStage || '',
                            video_progress_status: videoStatus || '',
                            video_editor: videoEditor || ''
                        });
                    }
                } catch (e) {
                    console.log('Error parsing row:', e);
                }
            });
            
            return data;
        """)
        
        return video_progress_data

    def get_athlete_details(self, player_id: str):
        """Get detailed athlete information by player ID"""
        driver = self._get_driver()
        
        # Navigate to athlete profile
        profile_url = f"{self.base_url}/athlete/profile/{player_id}"
        driver.get(profile_url)
        
        # Wait for page to load
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, '.athlete-name, h1, .profile-name'))
        )
        
        # Extract athlete details
        athlete_data = driver.execute_script("""
            const data = {};
            
            // Get name
            const nameEl = document.querySelector('.athlete-name, h1, .profile-name');
            if (nameEl) data.name = nameEl.textContent.trim();
            
            // Get graduation year
            const gradEl = document.querySelector('.grad-year, .class-of');
            if (gradEl) data.grad_year = gradEl.textContent.trim();
            
            // Get high school
            const schoolEl = document.querySelector('.high-school, .school-name');
            if (schoolEl) data.high_school = schoolEl.textContent.trim();
            
            // Get city/state
            const locationEl = document.querySelector('.location, .city-state');
            if (locationEl) data.location = locationEl.textContent.trim();
            
            // Get positions
            const positionsEl = document.querySelector('.positions, .position');
            if (positionsEl) data.positions = positionsEl.textContent.trim();
            
            // Get sport
            const sportEl = document.querySelector('.sport, .primary-sport');
            if (sportEl) data.sport = sportEl.textContent.trim();
            
            return data;
        """)
        
        return athlete_data

    def update_video_profile(self, player_id: str, youtube_link: str, season: str, video_type: str):
        """Update video profile for specific player"""
        driver = self._get_driver()
        
        # Navigate to add video form
        add_video_url = f"{self.base_url}/template/template/addvideoform?athleteid={player_id}"
        driver.get(add_video_url)
        
        # Check if logged in
        url = driver.current_url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Fill the video form
        wait = WebDriverWait(driver, 10)
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'input[name="youtube_url"], input[name="video_url"]'))).send_keys(youtube_link)
        
        from selenium.webdriver.support.ui import Select
        Select(driver.find_element(By.CSS_SELECTOR, 'select[name="season"]')).select_by_value(season)
        Select(driver.find_element(By.CSS_SELECTOR, 'select[name="video_type"]')).select_by_value(video_type)
        
        # Submit the form
        driver.find_element(By.CSS_SELECTOR, 'button[type="submit"], input[type="submit"]').click()
        
        # Wait for success
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.success-message, .alert-success')))
        
        return {"success": True, "player_id": player_id, "youtube_link": youtube_link}

    def __enter__(self):
        self.driver = self.manager.initialize()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.manager.cleanup()

    def _get_driver(self):
        """Ensure driver is available"""
        if self.driver is None:
            self.driver = self.manager.initialize()
        return self.driver


# Singleton instance
_automator = None

def get_automator(headless=True):
    global _automator
    if _automator is None:
        _automator = NpidAutomator(headless=headless)
    return _automator
