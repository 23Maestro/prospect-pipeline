#!/usr/bin/env python3
"""
Complete NPID Automator with all inbox methods
Uses the saved Playwright state for 400-day session
"""
import asyncio
import json
import os
import re
from pathlib import Path
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

class NpidAutomator:
    def __init__(self):
        self.base_url = "https://dashboard.nationalpid.com"
        state_path = Path(__file__).parent / "playwright_state.json"
        self.state_path = state_path
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None

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

    async def get_inbox_threads(self, limit=50):
        """Get inbox threads from NPID"""
        await self.ensure_browser()
        
        # Navigate to inbox
        await self.page.goto(f"{self.base_url}/admin/videomailbox", wait_until="networkidle", timeout=30000)
        
        # Check if logged in
        url = self.page.url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Wait for page to fully load (inbox loads via AJAX)
        await self.page.wait_for_timeout(3000)
        
        # NPID uses div.ImageProfile for each message in #inbox_tab
        message_elements = await self.page.query_selector_all('#inbox_tab div.ImageProfile')
        
        threads = []
        for elem in message_elements[:limit]:
            try:
                # Get message ID from attributes
                item_id = await elem.get_attribute('itemid')
                item_code = await elem.get_attribute('itemcode')
                message_id = await elem.get_attribute('id')
                
                if not item_id:
                    continue
                
                # Extract email from hidden div
                email_elem = await elem.query_selector('.hidden')
                email = (await email_elem.text_content()).strip() if email_elem else ""
                
                # Extract name from msg-sendr-name span
                name_elem = await elem.query_selector('.msg-sendr-name')
                name = (await name_elem.text_content()).strip() if name_elem else "Unknown"
                
                # Extract ACTUAL subject from tit_line1 (not preview from tit_univ!)
                subject_elem = await elem.query_selector('.tit_line1')
                subject = ""
                if subject_elem:
                    subject = (await subject_elem.text_content()).strip()
                
                # Extract preview/content from tit_univ (but strip reply chains)
                preview_elem = await elem.query_selector('.tit_univ')
                preview = ""
                if preview_elem:
                    preview_text = (await preview_elem.text_content()).strip()
                    # Strip reply chain - everything after "On ... Prospect ID Video ... wrote:"
                    import re
                    reply_pattern = r'On\s+.+?\s+Prospect\s+ID\s+Video\s+.+?wrote:'
                    match = re.search(reply_pattern, preview_text, re.IGNORECASE | re.DOTALL)
                    if match:
                        preview = preview_text[:match.start()].strip()
                    else:
                        preview = preview_text[:300] if len(preview_text) > 300 else preview_text
                
                # Extract timestamp from date_css
                time_elem = await elem.query_selector('.date_css')
                timestamp = ""
                if time_elem:
                    timestamp_text = (await time_elem.text_content()).strip()
                    # Get first line only (date, not time)
                    timestamp = timestamp_text.split('\n')[0].strip() if timestamp_text else ""
                
                # Check assignment status by looking for plus icon (assignable) vs profile pic (assigned)
                # Assignable threads have: <i class="fa fa-plus-circle assign_video_team">
                # Assigned threads have: <img src*="PROFILE_IMG">
                plus_icon = await elem.query_selector('.fa-plus-circle')
                profile_img = await elem.query_selector('img[src*="PROFILE_IMG"]')
                
                can_assign = plus_icon is not None
                is_assigned = profile_img is not None
                
                threads.append({
                    "id": message_id or f"message_{item_id}",
                    "itemcode": item_code or "",
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

    async def get_thread_details(self, thread_id):
        """Get full email content by clicking thread and extracting from detail view"""
        await self.ensure_browser()
        
        # Ensure we're on the inbox page
        if "/videomailbox" not in self.page.url:
            await self.page.goto(f"{self.base_url}/admin/videomailbox", wait_until="networkidle", timeout=30000)
            await self.page.wait_for_timeout(2000)
        
        try:
            # Click on the thread to open detail view (using correct selector)
            clickable = await self.page.query_selector(f'#{thread_id} .rightTwo')
            if not clickable:
                raise Exception(f"Thread {thread_id} not found")
            
            await clickable.click()
            await self.page.wait_for_timeout(2000)
            
            # Extract email details from the detail view
            # Subject from tit_line1 in detail view
            subject_elem = await self.page.query_selector('.tit_line1')
            subject = (await subject_elem.text_content()).strip() if subject_elem else ""
            
            # Get full message body from msgs_full
            body_elem = await self.page.query_selector('.msgs_full')
            full_content = ""
            if body_elem:
                body_text = (await body_elem.text_content()).strip()
                # Strip reply chain - everything after "On ... Prospect ID Video ... wrote:"
                import re
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

    async def search_player(self, query):
        """Search for a player"""
        await self.ensure_browser()
        
        # Navigate to search or use search field
        await self.page.fill('input[name="searchstring"], #findaathlete', query)
        await self.page.wait_for_timeout(1000)
        
        # Get autocomplete results
        results = await self.page.query_selector_all('.ui-autocomplete li, .search-result')
        
        contacts = []
        for result in results[:10]:
            text = await result.text_content()
            contacts.append({
                "contactId": text.strip(),
                "name": text.strip(),
                "email": ""
            })
        
        return contacts

    async def get_assignment_modal_data(self, thread_id=None, contact_id=None):
        """Get assignment modal data"""
        await self.ensure_browser()
        
        # Ensure we're on inbox page
        if "/videomailbox" not in self.page.url:
            await self.page.goto(f"{self.base_url}/admin/videomailbox", wait_until="networkidle", timeout=30000)
            await self.page.wait_for_timeout(2000)
        
        # Click the plus icon to open assignment modal
        if thread_id:
            # Look for the assign_img div which contains the plus button
            assign_img = await self.page.query_selector(f'#{thread_id} .assign_img')
            if assign_img:
                await assign_img.click()
            else:
                # Fallback: look for plus icon directly
                plus_icon = await self.page.query_selector(f'#{thread_id} .fa-plus-circle')
                if not plus_icon:
                    raise Exception(f"Plus icon not found for thread {thread_id}")
                await plus_icon.click()
        
        # Wait for modal to open (Assigned Owner field appears)
        await self.page.wait_for_selector('select[name="owner"], input[name="owner"]', timeout=5000)
        await self.page.wait_for_timeout(1000)
        
        # Extract modal options
        owners = await self.page.query_selector_all('select[name="owner"] option, input[name="owner"]')
        stages = await self.page.query_selector_all('select[name="stage"] option')
        statuses = await self.page.query_selector_all('select[name="status"] option')
        
        owner_options = []
        for owner in owners:
            value = await owner.get_attribute('value')
            text = await owner.text_content()
            if value:
                owner_options.append({"value": value, "label": text or value})
        
        stage_options = []
        for stage in stages:
            value = await stage.get_attribute('value')
            text = await stage.text_content()
            if value:
                stage_options.append({"value": value, "label": text or value})
        
        status_options = []
        for status in statuses:
            value = await status.get_attribute('value')
            text = await status.text_content()
            if value:
                status_options.append({"value": value, "label": text or value})
        
        return {
            "owners": owner_options,
            "stages": stage_options,
            "videoStatuses": status_options,
            "defaultOwner": owner_options[0] if owner_options else None
        }

    async def assign_thread(self, thread_id, assignee, status=None, stage=None, contact_id=None):
        """Assign a thread to someone"""
        await self.ensure_browser()
        
        # Ensure we're on inbox page
        if "/videomailbox" not in self.page.url:
            await self.page.goto(f"{self.base_url}/admin/videomailbox", wait_until="networkidle", timeout=30000)
            await self.page.wait_for_timeout(2000)
        
        # Click the plus icon to open assignment modal
        # Look for the assign_img div which contains the plus button
        assign_img = await self.page.query_selector(f'#{thread_id} .assign_img')
        if assign_img:
            await assign_img.click()
        else:
            # Fallback: look for plus icon directly
            plus_icon = await self.page.query_selector(f'#{thread_id} .fa-plus-circle')
            if not plus_icon:
                raise Exception(f"Plus icon not found for thread {thread_id}")
            await plus_icon.click()
        
        # Wait for modal to open (Assigned Owner field appears)
        await self.page.wait_for_selector('select[name="owner"], input[name="owner"]', timeout=5000)
        await self.page.wait_for_timeout(1000)
        
        # Fill form
        await self.page.fill('select[name="owner"], input[name="owner"]', assignee)
        
        if contact_id:
            await self.page.fill('input[name="contact"], select[name="contact"]', contact_id)
        
        if stage:
            await self.page.select_option('select[name="stage"]', stage)
        
        if status:
            await self.page.select_option('select[name="status"]', status)
        
        # Submit
        await self.page.click('button[type="submit"], button:has-text("Assign"), button:has-text("Save")')
        
        # Wait for success
        await self.page.wait_for_selector('.success-message, .alert-success', timeout=10000)
        
        return {"success": True, "thread_id": thread_id, "assigned_to": assignee}

    async def get_video_progress_data(self):
        """Get video progress data from NPID using saved state - NO TOKENS!"""
        await self.ensure_browser()
        
        # Navigate to video progress page - saved state handles all auth
        await self.page.goto(f"{self.base_url}/videoteammsg/videomailprogress", wait_until="networkidle", timeout=30000)
        
        # Check if logged in
        url = self.page.url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Wait for page to load and data to populate
        await self.page.wait_for_timeout(5000)
        
        # Extract video progress data directly from the page - no API calls needed!
        video_progress_data = await self.page.evaluate("""
            () => {
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
            }
        """)
        
        return video_progress_data

    async def get_athlete_details(self, player_id: str):
        """Get detailed athlete information by player ID"""
        await self.ensure_browser()
        
        # Navigate to athlete profile
        profile_url = f"{self.base_url}/athlete/profile/{player_id}"
        await self.page.goto(profile_url, wait_until="networkidle", timeout=30000)
        
        # Extract athlete details
        athlete_data = await self.page.evaluate("""
            () => {
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
            }
        """)
        
        return athlete_data

    async def update_video_profile(self, player_id: str, youtube_link: str, season: str, video_type: str):
        """Update video profile for specific player"""
        await self.ensure_browser()
        
        # Navigate to add video form
        add_video_url = f"{self.base_url}/template/template/addvideoform?athleteid={player_id}"
        await self.page.goto(add_video_url, wait_until="networkidle", timeout=30000)
        
        # Check if logged in
        url = self.page.url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Fill the video form
        await self.page.fill('input[name="youtube_url"], input[name="video_url"]', youtube_link)
        await self.page.select_option('select[name="season"]', season)
        await self.page.select_option('select[name="video_type"]', video_type)
        
        # Submit the form
        await self.page.click('button[type="submit"], input[type="submit"]')
        
        # Wait for success
        await self.page.wait_for_selector('.success-message, .alert-success', timeout=10000)
        
        return {"success": True, "player_id": player_id, "youtube_link": youtube_link}

    async def close(self):
        """Close browser"""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()


# Singleton instance
_automator = None

def get_automator():
    global _automator
    if _automator is None:
        _automator = NpidAutomator()
    return _automator
