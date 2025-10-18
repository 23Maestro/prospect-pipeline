#!/Users/singleton23/.pyenv/shims/python3
"""
Email automation script for Raycast extension
Bridges Raycast UI to NPIDAPIClient REST API
"""
import sys
import os
import argparse

# Add mcp-servers directory to path to import NPIDAPIClient
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'mcp-servers/npid-native'))

from npid_api_client import NPIDAPIClient

def main():
    parser = argparse.ArgumentParser(description='Send email to student athlete')
    parser.add_argument('--athlete_name', required=True, help='Full name of the athlete')
    parser.add_argument('--template_value', required=True, help='Email template name')

    args = parser.parse_args()

    try:
        from bs4 import BeautifulSoup

        # Initialize API client
        client = NPIDAPIClient()

        # Login (uses cached session if available)
        print(f"🔐 Authenticating...")
        client.login()

        # Search for athlete in video progress (not player database)
        print(f"🔍 Searching for athlete: {args.athlete_name}")

        # Parse name for video progress search
        name_parts = args.athlete_name.split()
        first_name = name_parts[0] if len(name_parts) > 0 else ""
        last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

        # Get CSRF token
        html = client.get_page_content('https://dashboard.nationalpid.com/videoteammsg/videomailprogress')
        soup = BeautifulSoup(html, 'html.parser')
        token_input = soup.find('input', {'name': '_token'})
        csrf_token = token_input['value'] if token_input else ''

        # Search video progress
        data = {
            '_token': csrf_token,
            'first_name': first_name,
            'last_name': last_name
        }

        resp = client.session.post(
            'https://dashboard.nationalpid.com/videoteammsg/videoprogress',
            data=data
        )

        athletes = resp.json()

        if not athletes or len(athletes) == 0:
            print(f"❌ ERROR: No athlete found with name: {args.athlete_name}")
            sys.exit(1)

        athlete = athletes[0]
        athlete_id = str(athlete.get('athlete_id'))

        print(f"✅ Found athlete: {athlete.get('athletename')} (ID: {athlete_id})")

        # Get email templates for this athlete
        resp = client.session.get(
            f'https://dashboard.nationalpid.com/rulestemplates/template/videotemplates?id={athlete_id}'
        )
        soup = BeautifulSoup(resp.text, 'html.parser')

        template_id = None
        for option in soup.find_all('option'):
            if args.template_value in option.text:
                template_id = option.get('value')
                break

        if not template_id:
            print(f"❌ ERROR: Template '{args.template_value}' not found")
            sys.exit(1)

        print(f"📧 Sending email with template '{args.template_value}' (ID: {template_id})...")

        # Get template data
        resp = client.session.post(
            f"{client.base_url}/admin/templatedata",
            data={"tmpl": template_id, "_token": csrf_token, "athlete_id": athlete_id}
        )
        template_data = resp.json()

        # Send email
        email_payload = {
            "_token": csrf_token,
            "notification_type_id": "1",
            "notification_to_type_id": "1",
            "notification_to_id": athlete_id,
            "notification_from": template_data.get('sender_name', 'Video Team'),
            "notification_from_email": template_data.get('sender_email', 'videoteam@prospectid.com'),
            "notification_subject": template_data.get('templatesubject', ''),
            "notification_message": template_data.get('templatedescription', ''),
            "includemysign": "includemysign",
        }

        resp = client.session.post(
            f"{client.base_url}/admin/addnotification",
            data=email_payload
        )

        if "Email Sent" in resp.text or resp.status_code == 200:
            print(f"✅ Email sent successfully to {args.athlete_name}!")
            print(f"\n--- Email Process Attempted ---")
            print(f"Athlete: {args.athlete_name}")
            print(f"Template: {args.template_value}")
            print(f"Status: SUCCESS")
            sys.exit(0)
        else:
            print(f"❌ ERROR: Failed to send email")
            print(f"Response: {resp.text[:200]}")
            sys.exit(1)

    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
