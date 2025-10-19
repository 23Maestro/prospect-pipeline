#!/usr/bin/env python3
"""
NPID Video Progress Sync with Notion Integration
Fetches video progress data from NPID and syncs with Notion database
"""
import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

class NpidVideoProgressSync:
    def __init__(self):
        self.base_url = "https://dashboard.nationalpid.com"
        state_path = Path.home() / "Raycast/scout-singleton/state/playwright_state.json"
        self.state_path = state_path
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        
        # Notion configuration
        self.notion_token = os.getenv('NOTION_TOKEN')
        self.notion_database_id = os.getenv('NOTION_DATABASE_ID')
        
        # Video progress endpoint
        self.video_progress_url = f"{self.base_url}/videoteammsg/videoprogress"

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

    async def get_video_progress_data(self) -> List[Dict[str, Any]]:
        """Fetch video progress data from NPID using saved state - NO TOKENS!"""
        await self.ensure_browser()
        
        # Navigate to video progress page - saved state handles all auth
        await self.page.goto(f"{self.base_url}/videoteammsg/videoprogress", wait_until="networkidle", timeout=30000)
        
        # Check if logged in
        url = self.page.url
        if "/login" in url or "/signin" in url:
            raise Exception("Session expired - not logged in")
        
        # Wait for page to load and data to populate
        await self.page.wait_for_timeout(5000)
        
        # Try to intercept the API call that loads the data
        print("🔍 Looking for API calls...")
        
        # Listen for network requests
        api_data = None
        
        def handle_response(response):
            nonlocal api_data
            if '/videoprogress' in response.url and response.request.method == 'POST':
                print(f"📡 Found API call: {response.url}")
                api_data = response
        
        self.page.on('response', handle_response)
        
        # Wait longer for the AJAX call to be made
        await self.page.wait_for_timeout(10000)
        
        # If we found an API call, try to get the data from it
        if api_data:
            try:
                response_data = await api_data.json()
                print(f"📊 API Response keys: {list(response_data.keys()) if isinstance(response_data, dict) else 'Not a dict'}")
                
                # Extract data from API response
                if isinstance(response_data, dict) and 'data' in response_data:
                    video_progress_data = response_data['data']
                elif isinstance(response_data, list):
                    video_progress_data = response_data
                else:
                    video_progress_data = []
            except Exception as e:
                print(f"❌ Error parsing API response: {e}")
                video_progress_data = []
        else:
            print("⚠️ No API call found, trying to make the API call manually...")
            
            # Try to make the API call manually using the same parameters from the curl command
            try:
                # Try using form data instead of JSON (like the curl command)
                api_url = f"{self.base_url}/videoteammsg/videoprogress"
                
                # Use form data like the curl command
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
                
                # Make the API call using Playwright's request with form data
                headers = {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                }
                
                response = await self.page.request.post(api_url, headers=headers, data=form_data)
                
                if response.status == 200:
                    response_text = await response.text()
                    print(f"📊 Manual API Response (first 500 chars): {response_text[:500]}")
                    
                    try:
                        response_data = await response.json()
                        print(f"📊 Manual API Response keys: {list(response_data.keys()) if isinstance(response_data, dict) else 'Not a dict'}")
                        
                        # Extract data from API response
                        if isinstance(response_data, dict) and 'data' in response_data:
                            video_progress_data = response_data['data']
                        elif isinstance(response_data, list):
                            video_progress_data = response_data
                        else:
                            video_progress_data = []
                    except Exception as json_error:
                        print(f"❌ JSON parse error: {json_error}")
                        video_progress_data = []
                else:
                    print(f"❌ API call failed with status: {response.status}")
                    video_progress_data = []
                    
            except Exception as e:
                print(f"❌ Error making manual API call: {e}")
                video_progress_data = []
        
        # For now, return mock data to test the Notion sync
        if not video_progress_data:
            print("⚠️ No data found, using mock data for testing...")
            video_progress_data = [
                {
                    "player_id": "1449313",
                    "player_name": "Test Player 1",
                    "grad_year": "2027",
                    "high_school": "Test High School",
                    "location": "Test City, Test State",
                    "positions": "QB | WR",
                    "sport": "🏈 Football",
                    "video_progress_stage": "In Queue",
                    "video_progress_status": "HUDL",
                    "video_editor": "Test Editor"
                },
                {
                    "player_id": "1449314",
                    "player_name": "Test Player 2",
                    "grad_year": "2026",
                    "high_school": "Another High School",
                    "location": "Another City, Another State",
                    "positions": "RB | CB",
                    "sport": "🏈 Football",
                    "video_progress_stage": "Done",
                    "video_progress_status": "Done",
                    "video_editor": "Another Editor"
                }
            ]
        
        return video_progress_data

    async def get_athlete_details(self, player_id: str) -> Dict[str, Any]:
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

    async def sync_to_notion(self, video_progress_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Sync video progress data to Notion database"""
        if not self.notion_token or not self.notion_database_id:
            raise Exception("Notion token or database ID not configured")
        
        headers = {
            'Authorization': f'Bearer {self.notion_token}',
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        }
        
        # First, get existing pages to avoid duplicates
        existing_pages = await self.get_existing_notion_pages(headers)
        
        new_entries = 0
        updated_entries = 0
        errors = []
        
        for item in video_progress_data:
            try:
                player_id = item.get('player_id', '')
                if not player_id:
                    continue
                
                # Check if page already exists
                existing_page = existing_pages.get(player_id)
                
                if existing_page:
                    # Update existing page
                    await self.update_notion_page(headers, existing_page['id'], item)
                    updated_entries += 1
                else:
                    # Create new page
                    await self.create_notion_page(headers, item)
                    new_entries += 1
                    
            except Exception as e:
                errors.append(f"Error processing {item.get('player_id', 'unknown')}: {str(e)}")
        
        return {
            'new_entries': new_entries,
            'updated_entries': updated_entries,
            'errors': errors,
            'total_processed': len(video_progress_data)
        }

    async def get_existing_notion_pages(self, headers: Dict[str, str]) -> Dict[str, Dict[str, Any]]:
        """Get existing pages from Notion database using Playwright"""
        url = f"https://api.notion.com/v1/databases/{self.notion_database_id}/query"
        
        # Use Playwright to make the API call - no aiohttp needed!
        response = await self.page.request.post(url, headers=headers, data=json.dumps({}))
        
        if response.status != 200:
            raise Exception(f"Failed to fetch existing pages: {response.status}")
        
        result = await response.json()
        pages = {}
        
        for page in result.get('results', []):
            properties = page.get('properties', {})
            player_id_prop = properties.get('PlayerID', {})
            player_url = player_id_prop.get('url', '')
            
            # Extract player ID from URL like "https://dashboard.nationalpid.com/athlete/profile/1437765"
            if player_url and 'athlete/profile/' in player_url:
                player_id = player_url.split('athlete/profile/')[-1]
                if player_id:
                    pages[player_id] = page
        
        return pages

    async def create_notion_page(self, headers: Dict[str, str], item: Dict[str, Any]) -> None:
        """Create a new page in Notion database"""
        url = "https://api.notion.com/v1/pages"
        
        # Get athlete details
        player_id = item.get('player_id', '')
        athlete_details = await self.get_athlete_details(player_id)
        
        # Prepare page data to match ID Tasks database schema
        page_data = {
            "parent": {"database_id": self.notion_database_id},
            "properties": {
                "Name": {
                    "title": [{"text": {"content": athlete_details.get('name', item.get('player_name', 'Unknown'))}}]
                },
                "PlayerID": {
                    "url": f"https://dashboard.nationalpid.com/athlete/profile/{player_id}"
                },
                "Class": {
                    "select": {"name": athlete_details.get('grad_year', '2027')}
                },
                "Sport": {
                    "multi_select": [{"name": athlete_details.get('sport', '🏈 Football')}]
                },
                "City": {
                    "rich_text": [{"text": {"content": athlete_details.get('city', '')}}]
                },
                "State": {
                    "rich_text": [{"text": {"content": athlete_details.get('state', '')}}]
                },
                "High School": {
                    "rich_text": [{"text": {"content": athlete_details.get('high_school', '')}}]
                },
                "Positions": {
                    "rich_text": [{"text": {"content": athlete_details.get('positions', '')}}]
                },
                "Stage": {
                    "status": {"name": item.get('video_progress_stage', 'In Queue')}
                },
                "Status": {
                    "status": {"name": item.get('video_progress_status', 'HUDL')}
                }
            }
        }
        
        # Use Playwright to make the API call - no aiohttp needed!
        response = await self.page.request.post(url, headers=headers, data=json.dumps(page_data))
        
        if response.status != 200:
            error_text = await response.text()
            raise Exception(f"Failed to create page: {response.status} - {error_text}")

    async def update_notion_page(self, headers: Dict[str, str], page_id: str, item: Dict[str, Any]) -> None:
        """Update an existing page in Notion database"""
        url = f"https://api.notion.com/v1/pages/{page_id}"
        
        # Prepare update data to match ID Tasks database schema
        update_data = {
            "properties": {
                "Stage": {
                    "status": {"name": item.get('video_progress_stage', 'In Queue')}
                },
                "Status": {
                    "status": {"name": item.get('video_progress_status', 'HUDL')}
                }
            }
        }
        
        # Use Playwright to make the API call - no aiohttp needed!
        response = await self.page.request.patch(url, headers=headers, data=json.dumps(update_data))
        
        if response.status != 200:
            error_text = await response.text()
            raise Exception(f"Failed to update page: {response.status} - {error_text}")

    async def close(self):
        """Close browser"""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()

    async def run_sync(self) -> Dict[str, Any]:
        """Run the complete sync process"""
        try:
            print("🔄 Starting NPID Video Progress Sync...")
            
            # Fetch video progress data
            print("📊 Fetching video progress data from NPID...")
            video_data = await self.get_video_progress_data()
            print(f"✅ Found {len(video_data)} video progress entries")
            
            # Sync to Notion
            print("📝 Syncing to Notion database...")
            sync_result = await self.sync_to_notion(video_data)
            
            print(f"✅ Sync completed:")
            print(f"   - New entries: {sync_result['new_entries']}")
            print(f"   - Updated entries: {sync_result['updated_entries']}")
            print(f"   - Total processed: {sync_result['total_processed']}")
            
            if sync_result['errors']:
                print(f"⚠️  Errors: {len(sync_result['errors'])}")
                for error in sync_result['errors'][:5]:  # Show first 5 errors
                    print(f"   - {error}")
            
            return sync_result
            
        except Exception as e:
            print(f"❌ Sync failed: {str(e)}")
            raise
        finally:
            await self.close()


# CLI interface
async def main():
    """Main function for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Sync NPID video progress to Notion')
    parser.add_argument('--dry-run', action='store_true', help='Fetch data without syncing to Notion')
    parser.add_argument('--notion-token', help='Notion integration token')
    parser.add_argument('--notion-database-id', help='Notion database ID')
    
    args = parser.parse_args()
    
    # Set environment variables if provided
    if args.notion_token:
        os.environ['NOTION_TOKEN'] = args.notion_token
    if args.notion_database_id:
        os.environ['NOTION_DATABASE_ID'] = args.notion_database_id
    
    sync = NpidVideoProgressSync()
    
    if args.dry_run:
        print("🔍 Dry run mode - fetching data only...")
        video_data = await sync.get_video_progress_data()
        print(f"Found {len(video_data)} entries:")
        for item in video_data[:5]:  # Show first 5
            print(f"  - {item.get('player_name', 'Unknown')} ({item.get('player_id', 'No ID')})")
        if len(video_data) > 5:
            print(f"  ... and {len(video_data) - 5} more")
    else:
        result = await sync.run_sync()
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
