#!/usr/bin/env python3
"""
Email student athletes using REST API - More reliable than Playwright
"""
import sys
import os

# Add src/python directory to path to import NPIDAPIClient
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src/python'))

from npid_api_client import NPIDAPIClient

def send_email_to_athlete(athlete_name: str, template_name: str = "Editing Done: Video Editing Complete"):
    """
    Send email to athlete using REST API

    Benefits over Playwright:
    - No browser needed (faster)
    - More reliable (no DOM selectors to break)
    - Better error handling
    - Session persistence across runs
    - ~10x faster execution
    """
    client = NPIDAPIClient()

    try:
        # Login (uses cached session if available - 400 day persistence)
        print(f"🔐 Authenticating...")
        client.login()

        # Send email using template
        print(f"📧 Sending email to {athlete_name} with template '{template_name}'...")
        result = client.send_email_to_athlete(athlete_name, template_name)

        if result.get('success'):
            print(f"✅ Email sent successfully to {athlete_name}!")
            return True
        else:
            print(f"❌ Failed to send email: {result.get('error')}")
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    # Default test athlete
    athlete_name = "Test Test"  # Same as SEARCH_TEXT in Playwright version
    template_name = "Editing Done: Video Editing Complete"

    print("=" * 60)
    print("REST API Email Automation (NPIDAPIClient)")
    print("=" * 60)

    success = send_email_to_athlete(athlete_name, template_name)

    if success:
        print("\n✅ Script completed successfully")
        sys.exit(0)
    else:
        print("\n❌ Script failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
