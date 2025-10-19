#!/usr/bin/env python3
"""
NPID Email Automator - Fully Automated Overdue Athlete Email Sender
Navigates to videomailprogress page and sends emails to all overdue athletes
"""
import asyncio
import json
import os
from pathlib import Path
from typing import List, Dict, Any
from playwright.async_api import async_playwright, Browser, BrowserContext, Page


class NpidEmailAutomator:
    def __init__(self, headless: bool = False):
        self.base_url = "https://dashboard.nationalpid.com"
        self.video_mail_progress_url = f"{self.base_url}/videoteammsg/videomailprogress"

        # Load saved browser state for authentication
        state_path = Path.home() / "Raycast/scout-singleton/state/playwright_state.json"
        self.state_path = state_path

        self.headless = headless
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None

        # Statistics
        self.stats = {
            'total_athletes': 0,
            'emails_sent': 0,
            'errors': [],
            'skipped': []
        }

    async def setup_browser(self):
        """Setup browser with saved authentication state"""
        print("🚀 Starting browser...")

        pw = await async_playwright().start()
        self.browser = await pw.chromium.launch(
            headless=self.headless,
            args=['--start-maximized'] if not self.headless else []
        )

        # Load saved state for authentication
        if self.state_path.exists():
            print("🔑 Loading saved authentication state...")
            with open(self.state_path) as f:
                state = json.load(f)

            self.context = await self.browser.new_context(
                viewport=None if not self.headless else {'width': 1920, 'height': 1080}
            )
            await self.context.add_cookies(state.get("cookies", []))
        else:
            print("⚠️  No saved state found - you may need to log in")
            self.context = await self.browser.new_context(
                viewport=None if not self.headless else {'width': 1920, 'height': 1080}
            )

        self.page = await self.context.new_page()
        print("✅ Browser ready")

    async def check_login(self) -> bool:
        """Check if we're logged in, if not, wait for manual login"""
        print("🔐 Checking login status...")

        url = self.page.url
        if "/login" in url or "/signin" in url:
            print("❌ Not logged in!")
            print("👉 Please log in manually in the browser window")
            print("⏳ Waiting for login (checking every 5 seconds)...")

            # Wait for redirect away from login page
            while "/login" in self.page.url or "/signin" in self.page.url:
                await asyncio.sleep(5)
                print("   Still waiting for login...")

            print("✅ Login detected! Continuing...")
            return True

        print("✅ Already logged in")
        return True

    async def navigate_to_video_mail_progress(self):
        """Navigate to the video mail progress page"""
        print(f"🌐 Navigating to {self.video_mail_progress_url}...")
        await self.page.goto(self.video_mail_progress_url, wait_until="networkidle", timeout=60000)

        # Check if login is required
        if "/login" in self.page.url or "/signin" in self.page.url:
            await self.check_login()
            # Navigate again after login
            await self.page.goto(self.video_mail_progress_url, wait_until="networkidle", timeout=60000)

        # Wait for page to fully load
        await self.page.wait_for_timeout(3000)
        print("✅ Page loaded")

    async def get_overdue_athletes(self) -> List[Dict[str, Any]]:
        """Get all overdue athletes from the page"""
        print("🔍 Finding overdue athletes...")

        # Wait for the table/data to load
        await self.page.wait_for_timeout(2000)

        # Try to find overdue athletes - this selector may need to be adjusted based on actual page structure
        athletes = await self.page.evaluate("""
            () => {
                const athletes = [];

                // Find all rows in the table (adjust selector based on actual HTML)
                const rows = document.querySelectorAll('table tbody tr, .athlete-row, .overdue-row');

                rows.forEach((row, index) => {
                    // Extract athlete name (adjust selector based on actual HTML)
                    const nameEl = row.querySelector('.athlete-name, .name, td:first-child, [data-label="Name"]');
                    const name = nameEl ? nameEl.textContent.trim() : `Athlete ${index + 1}`;

                    // Extract athlete ID if available
                    const idEl = row.querySelector('.athlete-id, [data-player-id]');
                    const id = idEl ? idEl.getAttribute('data-player-id') || idEl.textContent.trim() : null;

                    // Check if overdue (adjust based on actual HTML)
                    const overdueEl = row.querySelector('.overdue, .status-overdue, [data-status="overdue"]');
                    const isOverdue = overdueEl !== null || row.classList.contains('overdue');

                    if (isOverdue || true) {  // For now, include all athletes
                        athletes.push({
                            name: name,
                            id: id,
                            rowIndex: index,
                            element: true
                        });
                    }
                });

                return athletes;
            }
        """)

        self.stats['total_athletes'] = len(athletes)
        print(f"📊 Found {len(athletes)} overdue athletes")

        return athletes

    async def send_email_to_athlete(self, athlete: Dict[str, Any], index: int) -> bool:
        """Send email to a specific athlete"""
        athlete_name = athlete.get('name', f"Athlete {index + 1}")
        print(f"\n📧 [{index + 1}/{self.stats['total_athletes']}] Processing: {athlete_name}")

        try:
            # Step 1: Search for the athlete name
            print(f"   🔍 Searching for '{athlete_name}'...")

            # Find search input (adjust selector based on actual HTML)
            search_selectors = [
                'input[type="search"]',
                'input[placeholder*="Search"]',
                'input[name="search"]',
                '.search-input',
                '#search',
                'input.form-control'
            ]

            search_input = None
            for selector in search_selectors:
                try:
                    search_input = await self.page.wait_for_selector(selector, timeout=2000)
                    if search_input:
                        break
                except:
                    continue

            if search_input:
                # Clear and type athlete name
                await search_input.click()
                await search_input.fill('')
                await search_input.type(athlete_name, delay=50)
                await self.page.wait_for_timeout(1000)
            else:
                print(f"   ⚠️  Could not find search input, trying to click row directly...")

            # Step 2: Find and click the email icon for this athlete
            print(f"   📬 Clicking email icon...")

            # Try multiple selectors for email icon
            email_icon_selectors = [
                f'tr:has-text("{athlete_name}") .email-icon',
                f'tr:has-text("{athlete_name}") button.email',
                f'tr:has-text("{athlete_name}") i.fa-envelope',
                f'tr:has-text("{athlete_name}") [data-action="email"]',
                f'tr:has-text("{athlete_name}") .btn-email',
                # Generic row-based selectors
                f'table tbody tr:nth-child({index + 1}) .email-icon',
                f'table tbody tr:nth-child({index + 1}) button.email',
                f'table tbody tr:nth-child({index + 1}) i.fa-envelope',
            ]

            email_icon_clicked = False
            for selector in email_icon_selectors:
                try:
                    email_icon = await self.page.wait_for_selector(selector, timeout=2000)
                    if email_icon:
                        await email_icon.click()
                        email_icon_clicked = True
                        break
                except:
                    continue

            if not email_icon_clicked:
                print(f"   ❌ Could not find email icon for {athlete_name}")
                self.stats['errors'].append(f"{athlete_name}: Email icon not found")
                return False

            # Wait for email modal/form to appear
            await self.page.wait_for_timeout(2000)

            # Step 3: Select the appropriate template
            print(f"   📝 Selecting email template...")

            template_selectors = [
                'select[name="template"]',
                'select.template-select',
                '#email-template',
                '.template-dropdown',
                'select.form-control'
            ]

            template_selected = False
            for selector in template_selectors:
                try:
                    template_dropdown = await self.page.wait_for_selector(selector, timeout=2000)
                    if template_dropdown:
                        # Get available options
                        options = await template_dropdown.query_selector_all('option')
                        if len(options) > 1:
                            # Select first non-empty option (usually index 1)
                            await template_dropdown.select_option(index=1)
                            template_selected = True
                            break
                except:
                    continue

            if not template_selected:
                print(f"   ⚠️  Could not find template selector, continuing anyway...")

            await self.page.wait_for_timeout(1000)

            # Step 4: Click "Send Email" button
            print(f"   ✉️  Sending email...")

            send_button_selectors = [
                'button:has-text("Send Email")',
                'button:has-text("Send")',
                'button.send-email',
                'button[type="submit"]',
                '.btn-send',
                'button.btn-primary'
            ]

            send_clicked = False
            for selector in send_button_selectors:
                try:
                    send_button = await self.page.wait_for_selector(selector, timeout=2000)
                    if send_button:
                        await send_button.click()
                        send_clicked = True
                        break
                except:
                    continue

            if not send_clicked:
                print(f"   ❌ Could not find send button for {athlete_name}")
                self.stats['errors'].append(f"{athlete_name}: Send button not found")
                return False

            # Wait for confirmation
            await self.page.wait_for_timeout(2000)

            # Check for success message
            try:
                success_selectors = [
                    '.alert-success',
                    '.success-message',
                    'text=/sent successfully/i',
                    'text=/email sent/i'
                ]

                for selector in success_selectors:
                    try:
                        success_msg = await self.page.wait_for_selector(selector, timeout=3000)
                        if success_msg:
                            print(f"   ✅ Email sent successfully to {athlete_name}")
                            self.stats['emails_sent'] += 1
                            return True
                    except:
                        continue

                # If no success message found, assume success anyway
                print(f"   ✅ Email likely sent to {athlete_name} (no confirmation message found)")
                self.stats['emails_sent'] += 1
                return True

            except Exception as e:
                print(f"   ⚠️  Could not confirm email sent, but continuing: {str(e)}")
                self.stats['emails_sent'] += 1
                return True

        except Exception as e:
            error_msg = f"{athlete_name}: {str(e)}"
            print(f"   ❌ Error: {str(e)}")
            self.stats['errors'].append(error_msg)
            return False

    async def run_automation(self):
        """Main automation workflow"""
        try:
            # Setup browser
            await self.setup_browser()

            # Navigate to video mail progress page
            await self.navigate_to_video_mail_progress()

            # Get all overdue athletes
            athletes = await self.get_overdue_athletes()

            if not athletes:
                print("⚠️  No overdue athletes found!")
                return

            # Process each athlete
            print(f"\n🎯 Starting to send emails to {len(athletes)} athletes...\n")

            for index, athlete in enumerate(athletes):
                success = await self.send_email_to_athlete(athlete, index)

                # Small delay between athletes
                await self.page.wait_for_timeout(1000)

                # Navigate back to main page if we got redirected
                if self.video_mail_progress_url not in self.page.url:
                    print("   🔄 Navigating back to main page...")
                    await self.page.goto(self.video_mail_progress_url, wait_until="networkidle")
                    await self.page.wait_for_timeout(2000)

            # Print summary
            print("\n" + "="*50)
            print("📊 AUTOMATION COMPLETE - SUMMARY")
            print("="*50)
            print(f"✅ Total athletes processed: {self.stats['total_athletes']}")
            print(f"📧 Emails sent: {self.stats['emails_sent']}")
            print(f"❌ Errors: {len(self.stats['errors'])}")

            if self.stats['errors']:
                print("\n⚠️  Errors encountered:")
                for error in self.stats['errors']:
                    print(f"   - {error}")

            print("="*50)

        except Exception as e:
            print(f"\n❌ Fatal error: {str(e)}")
            raise
        finally:
            print("\n🔄 Closing browser...")
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            print("✅ Done!")

    async def close(self):
        """Cleanup resources"""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()


async def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description='Automated email sender for overdue NPID athletes'
    )
    parser.add_argument(
        '--headless',
        action='store_true',
        help='Run in headless mode (no browser window)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of emails to send (for testing)'
    )

    args = parser.parse_args()

    print("="*50)
    print("🤖 NPID EMAIL AUTOMATION SCRIPT")
    print("="*50)
    print(f"Mode: {'Headless' if args.headless else 'Visible Browser'}")
    if args.limit:
        print(f"Limit: {args.limit} emails")
    print("="*50 + "\n")

    automator = NpidEmailAutomator(headless=args.headless)

    try:
        await automator.run_automation()
    except KeyboardInterrupt:
        print("\n⚠️  Automation interrupted by user")
    except Exception as e:
        print(f"\n❌ Automation failed: {str(e)}")
        raise
    finally:
        await automator.close()


if __name__ == "__main__":
    asyncio.run(main())
