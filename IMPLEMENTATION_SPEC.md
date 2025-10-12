# REST API Implementation Spec - NPID Assignment Flow

## 📋 OBJECTIVE
Implement complete NpidRestClient class from Perplexity thread (Oct 10, 2025 at 2:42am) into the prospect-pipeline codebase.

## 📁 FILE LOCATIONS

### Create New File
```
/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/npid_rest_client.py
```

### Modify Existing File
```
/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/npid_automator_complete.py
```

## 📖 SOURCE CODE

### Complete NpidRestClient Class
Located in document index 1 (attached to this conversation).

Key components:
1. `__init__(self, session_cookies)` - Initialize with session cookies
2. `get_csrf_token(self)` - Extract CSRF from cookies
3. `assign_thread(self, message_id, email, stage, status)` - Main assignment method
4. `_submit_assignment(...)` - Submit assignment POST request

## 🔧 IMPLEMENTATION STEPS

### Step 1: Create npid_rest_client.py
Copy the complete NpidRestClient class from the Perplexity message (see document index 1).

**Requirements:**
- Import: `requests`, `BeautifulSoup`, `logging`
- Set `self.owner_id = '1408164'` (Jerami Singleton)
- Base URL: `https://dashboard.nationalpid.com`

### Step 2: Update npid_automator_complete.py

Modify the `assign_thread` method to use REST client instead of Selenium:

```python
def assign_thread(self, thread_id, assignee, status=None, stage=None, 
                  email=None, **kwargs):
    """
    Assign thread using REST API
    
    Args:
        thread_id: Message ID from inbox
        assignee: Owner ID (should be '1408164' for Jerami)
        status: Video progress status
        stage: Video progress stage
        email: Contact email (extracted from inbox)
    """
    
    # Import REST client
    from npid_rest_client import NpidRestClient
    
    # Get session cookies from current Selenium session
    cookies = {cookie['name']: cookie['value'] 
               for cookie in self.driver.get_cookies()}
    
    # Initialize REST client
    rest_client = NpidRestClient(cookies)
    
    # Assign with REST API (fast, no modal clicking)
    result = rest_client.assign_thread(
        message_id=thread_id,
        email=email,  # From inbox scraping
        stage=stage or 'In Queue',
        status=status or 'HUDL'
    )
    
    return result
```

### Step 3: Test Imports

Verify the code works:

```python
# Test import
from mcp_servers.npid_native.npid_rest_client import NpidRestClient
from mcp_servers.npid_native.npid_automator_complete import NpidAutomator

print("✅ Imports successful")
```

## ✅ KEY FEATURES IMPLEMENTED

1. **Student Email Flow** (instant):
   - Pre-filled data from modal
   - Direct assignment with no search

2. **Parent Email Flow** (auto-search):
   - Searches with `searchfor=parent`
   - Extracts contact_id and athlete_id from radio button
   - Submits assignment

3. **Owner Always Set**:
   - `videoscoutassignedto='1408164'` (Jerami Singleton)
   - No exceptions

4. **Stage/Status Included**:
   - Every assignment includes stage and status
   - Defaults: 'In Queue' and 'HUDL'

## 🧪 TESTING PLAN

### Test Cases

**Student Email (Instant):**
```python
result = rest_client.assign_thread(
    message_id='12345',
    email='softballbrae@gmail.com',
    stage='In Queue',
    status='HUDL'
)
# Expected: {'success': True, 'contact_id': '...', 'athlete_id': '...'}
```

**Parent Email (Search Required):**
```python
result = rest_client.assign_thread(
    message_id='67890',
    email='aksartin@aol.com',
    stage='In Queue',
    status='Dropbox'
)
# Expected: {'success': True, 'contact_id': '...', 'athlete_id': '...'}
```

## 📦 DEPENDENCIES

Ensure these are in requirements.txt:
```
requests
beautifulsoup4
selenium
```

## 🎯 SUCCESS CRITERIA

- [ ] npid_rest_client.py created with complete class
- [ ] npid_automator_complete.py updated with new assign_thread method
- [ ] Imports work without errors
- [ ] Student email flow works (instant assignment)
- [ ] Parent email flow works (auto-search)
- [ ] Owner always set to 1408164
- [ ] Stage/Status included in every assignment

## 🚫 OUT OF SCOPE

- No Supabase integration
- No n8n workflows
- No database operations
- No Raycast extension changes yet
- Focus ONLY on REST API client implementation

## 📅 DEADLINE

October 13, 2025

## 📎 REFERENCE

- Source: Perplexity thread from Oct 10, 2025 at 2:42am
- HAR file: adminvideomailbox.har.txt (document index 1)
- Working flow validated in HAR file
