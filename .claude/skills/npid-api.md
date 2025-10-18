# NPID API Client Skill

Interact with National PID Dashboard REST API for athlete and video team operations.

## Context
- **Client**: Prospect ID (Client 2)
- **API Base**: https://dashboard.nationalpid.com
- **Session**: Cookie-based (400-day persistence)
- **Client Location**: `mcp-servers/npid-native/npid_api_client.py`

## Common Operations

### Authentication
```python
from npid_api_client import NPIDAPIClient

client = NPIDAPIClient()
client.login()  # Uses cached session if available
```

### Search Video Progress
```python
# Search for athletes in video workflow
athletes = client.session.post(
    'https://dashboard.nationalpid.com/videoteammsg/videoprogress',
    data={'_token': csrf_token, 'first_name': 'John', 'last_name': 'Doe'}
).json()
```

### Get Email Templates
```python
# Get available email templates for athlete
athlete_id = '252287'
resp = client.session.get(
    f'https://dashboard.nationalpid.com/rulestemplates/template/videotemplates?id={athlete_id}'
)
```

### Send Email
```python
# Send templated email to athlete
email_payload = {
    "_token": csrf_token,
    "notification_type_id": "1",
    "notification_to_type_id": "1",
    "notification_to_id": athlete_id,
    "notification_from": "Video Team",
    "notification_from_email": "videoteam@prospectid.com",
    "notification_subject": subject,
    "notification_message": message,
    "includemysign": "includemysign"
}

resp = client.session.post(
    f"{client.base_url}/admin/addnotification",
    data=email_payload
)
```

## Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/videoteammsg/videoprogress` | POST | Search athletes in video workflow |
| `/rulestemplates/template/videotemplates` | GET | Get email templates |
| `/admin/addnotification` | POST | Send email to athlete |
| `/rulestemplates/template/videoteammessagelist` | GET | Get inbox threads |
| `/external/logincheck` | GET | Validate session |

## Best Practices
- Always check `client.validate_session()` before operations
- Use session caching to avoid re-authentication
- Parse CSRF tokens from page HTML for POST requests
- Handle athlete search by first_name + last_name (not full name)
- Email sender should be `videoteam@prospectid.com`

## Session Management
```python
# Session stored at: ~/.npid_session.pkl
# Auto-loads on client init
# 400-day persistence with remember token
```
