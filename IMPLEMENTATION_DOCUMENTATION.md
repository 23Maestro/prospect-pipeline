# Prospect Pipeline - Complete Implementation Documentation

> **Purpose**: Comprehensive technical documentation for VPS deployment, Claude Skills creation, and Obsidian knowledge base integration.

**Generated**: 2025-11-04
**Repository**: prospect-pipeline
**Base URL**: https://dashboard.nationalpid.com

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Python REST Client Implementation](#2-python-rest-client-implementation)
3. [TypeScript/Raycast Integration Layer](#3-typescriptraycast-integration-layer)
4. [Network Communication Patterns](#4-network-communication-patterns)
5. [Dependencies & Configuration](#5-dependencies--configuration)
6. [File Structure](#6-file-structure)
7. [Key Implementation Patterns](#7-key-implementation-patterns)
8. [Deployment Specifications](#8-deployment-specifications)

---

## 1. Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Raycast UI Layer                         │
│  (TypeScript - User Interface & Command Handlers)           │
└─────────────────────┬───────────────────────────────────────┘
                      │ subprocess spawn
                      │ JSON RPC calls
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Python Server Layer                            │
│  (npid_api_client.py - CLI interface)                       │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP requests
                      │ (requests library)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│           NPID Dashboard REST API                           │
│  (https://dashboard.nationalpid.com)                        │
│  - Cookie-based authentication                              │
│  - CSRF token protection                                    │
│  - HTML responses (parsed with BeautifulSoup)               │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Action** (Raycast UI) → TypeScript command handler
2. **IPC Call** → Spawn Python subprocess with method + JSON args
3. **Python Processing** → Authenticate, make HTTP request, parse response
4. **Response** → JSON output to stdout
5. **UI Update** → TypeScript parses JSON, updates Raycast interface

---

## 2. Python REST Client Implementation

### 2.1 Core API Client (`npid_api_client.py`)

**Location**: `src/python/npid_api_client.py`

#### Authentication Flow

```python
class NPIDAPIClient:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://dashboard.nationalpid.com"
        self.cookie_file = Path.home() / '.npid_session.pkl'
        self.email = os.getenv('NPID_EMAIL', 'jsingleton@prospectid.com')
        self.password = os.getenv('NPID_PASSWORD', 'YBh@Y8Us@1&qwd$')
        self.authenticated = False
        self._load_session()
```

**Session Persistence**: Pickle file at `~/.npid_session.pkl`

#### Login Process

```python
def login(self, force=False) -> bool:
    """Login with remember token for 400-day persistence"""

    # Step 1: Validate existing session
    if not force and self.validate_session():
        logging.info("✅ Already authenticated")
        self.authenticated = True
        return True

    # Step 2: Get CSRF token from login page
    logging.info("🔐 Logging in...")
    csrf_token = self._get_csrf_token()

    # Step 3: Submit login form with remember token
    login_data = {
        'email': self.email,
        'password': self.password,
        '_token': csrf_token,
        'remember': 'on'  # 400-day session
    }

    resp = self.session.post(
        f"{self.base_url}/auth/login",
        data=login_data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': f"{self.base_url}/auth/login"
        },
        allow_redirects=False
    )

    # Step 4: Save session cookies to pickle file
    if resp.status_code == 302:
        logging.info("✅ Login successful")
        self.authenticated = True
        self._save_session()
        return True

    raise Exception(f"Login failed: {resp.status_code}")
```

**Session Validation**:

```python
def validate_session(self) -> bool:
    """Check if current session is valid"""
    try:
        resp = self.session.get(f"{self.base_url}/external/logincheck")
        if resp.status_code == 200:
            data = resp.json()
            return data.get('success') == 'true'
    except Exception:
        logging.exception("Session validation error")
    return False
```

#### Cookie Management

```python
def _load_session(self):
    """Load cookies from pickle file"""
    if self.cookie_file.exists():
        try:
            with open(self.cookie_file, 'rb') as f:
                cookies = pickle.load(f)
                self.session.cookies.update(cookies)
            logging.info(f"✅ Loaded session from {self.cookie_file}")
        except Exception:
            logging.exception("⚠️  Failed to load session")

def _save_session(self):
    """Save cookies to pickle file"""
    try:
        with open(self.cookie_file, 'wb') as f:
            pickle.dump(self.session.cookies, f)
        logging.info(f"✅ Saved session to {self.cookie_file}")
    except Exception:
        logging.exception("⚠️  Failed to save session")
```

### 2.2 API Endpoints

#### Endpoint 1: Get Inbox Threads

**Method**: `GET`
**URL**: `https://dashboard.nationalpid.com/rulestemplates/template/videoteammessagelist`

**Request Parameters**:
```python
params = {
    'athleteid': '',
    'user_timezone': 'America/New_York',
    'type': 'inbox',
    'is_mobile': '',
    'filter_self': 'Me/Un',
    'refresh': 'false',
    'page_start_number': str(page),  # Pagination (1, 2, 3...)
    'search_text': ''
}
```

**Request Headers**:
```python
# Standard browser headers (handled by requests.Session)
# Cookies automatically included from session
```

**Response**: HTML (parsed with BeautifulSoup)

**Implementation**:
```python
def get_inbox_threads(
    self, limit: int = 100, filter_assigned: str = 'both', exclude_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get inbox threads from video team inbox with pagination"""
    self.ensure_authenticated()
    all_threads = []
    page = 1
    max_pages = 2

    while len(all_threads) < limit and page <= max_pages:
        params = {
            'athleteid': '',
            'user_timezone': 'America/New_York',
            'type': 'inbox',
            'is_mobile': '',
            'filter_self': 'Me/Un',
            'refresh': 'false',
            'page_start_number': str(page),
            'search_text': ''
        }

        resp = self.session.get(
            f"{self.base_url}/rulestemplates/template/videoteammessagelist",
            params=params
        )
        resp.raise_for_status()

        # Parse HTML with BeautifulSoup
        soup = BeautifulSoup(resp.text, 'html.parser')
        message_elements = soup.select('div.ImageProfile')

        if not message_elements:
            break

        page_threads = []
        for elem in message_elements:
            if exclude_id and elem.get('id') == exclude_id:
                continue
            try:
                # Check if thread has plus icon (unassigned)
                plus_icon = elem.select_one('i.fa-plus-circle')
                has_plus = plus_icon is not None

                if filter_assigned == 'unassigned' and not has_plus:
                    continue
                if filter_assigned == 'assigned' and has_plus:
                    continue

                thread = self._parse_thread_element(elem, filter_assigned)
                if thread:
                    thread['canAssign'] = has_plus
                    thread['can_assign'] = has_plus
                    page_threads.append(thread)
            except Exception:
                logging.exception("⚠️  Failed to parse thread")
                continue

        all_threads.extend(page_threads)
        logging.info(f"✅ Page {page}: Found {len(page_threads)} threads ({len(all_threads)} total)")
        page += 1

    return all_threads[:limit]
```

**HTML Parsing Logic**:
```python
def _parse_thread_element(
    self, elem, filter_assigned: str = 'both'
) -> Optional[Dict[str, Any]]:
    """Parse a single thread element from inbox HTML"""
    item_id = elem.get('itemid')
    item_code = elem.get('itemcode')
    message_id = elem.get('id')

    if not item_id:
        return None

    # Extract email (hidden span)
    email_elem = elem.select_one('.hidden')
    email = email_elem.text.strip() if email_elem else ""

    # Extract contact metadata
    contact_id = elem.get('contacttask', '')
    athlete_main_id = elem.get('athletemainid', '')

    # Extract sender name
    name_elem = elem.select_one('.msg-sendr-name')
    name = name_elem.text.strip() if name_elem else "Unknown"

    # Extract subject
    subject_elem = elem.select_one('.tit_line1')
    subject = subject_elem.text.strip() if subject_elem else ""

    # Extract preview (strip reply signatures)
    preview_elem = elem.select_one('.tit_univ')
    preview = ""
    if preview_elem:
        preview_text = preview_elem.text.strip()
        reply_pattern = r'On\s+.+?\s+Prospect\s+ID\s+Video\s+.+?wrote:'
        match = re.search(reply_pattern, preview_text, re.IGNORECASE | re.DOTALL)
        if match:
            preview = preview_text[:match.start()].strip()
        else:
            preview = preview_text[:300]

    # Extract timestamp
    date_elem = elem.select_one('.date_css')
    timestamp = date_elem.text.strip() if date_elem else ""

    # Extract attachments
    attachments = []
    attachment_elems = elem.select('.attachment-item')
    for att_elem in attachment_elems:
        att_name = att_elem.get('data-filename', 'Unknown')
        att_url = att_elem.get('data-url', '')
        attachments.append({
            'fileName': att_name,
            'url': att_url,
            'downloadable': bool(att_url)
        })

    return {
        'id': message_id or item_id,
        'itemCode': item_code or item_id,
        'message_id': message_id or item_id,
        'contact_id': contact_id,
        'athleteMainId': athlete_main_id,
        'name': name,
        'email': email,
        'subject': subject,
        'preview': preview,
        'content': preview,
        'timestamp': timestamp,
        'timeStampIso': None,
        'can_assign': True,
        'canAssign': True,
        'isUnread': 'unread' in elem.get('class', []),
        'attachments': attachments
    }
```

#### Endpoint 2: Get Message Detail

**Method**: `GET`
**URL**: `https://dashboard.nationalpid.com/rulestemplates/template/videoteammessage_subject`

**Request Parameters**:
```python
params = {
    'message_id': clean_id,  # ID with 'message_id' prefix removed
    'itemcode': item_code,
    'type': 'inbox',
    'user_timezone': 'America/New_York',
    'filter_self': 'Me/Un'
}
```

**Request Headers**:
```python
headers = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
}
```

**Response**: JSON

**Implementation**:
```python
def get_message_detail(self, message_id: str, item_code: str) -> Dict[str, Any]:
    """Get detailed message content"""
    self.ensure_authenticated()

    # Clean message ID (remove 'message_id' prefix)
    clean_id = (
        message_id.replace('message_id', '', 1)
        if message_id and message_id.startswith('message_id')
        else message_id
    )

    params = {
        'message_id': clean_id,
        'itemcode': item_code,
        'type': 'inbox',
        'user_timezone': 'America/New_York',
        'filter_self': 'Me/Un'
    }

    resp = self.session.get(
        f"{self.base_url}/rulestemplates/template/videoteammessage_subject",
        params=params,
        headers={
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
        }
    )

    if resp.status_code != 200:
        logging.warning(f"⚠️  Failed to fetch message detail: {resp.status_code}")
        return {'message_id': clean_id, 'item_code': item_code, 'content': ''}

    try:
        response_text = resp.text.strip()
        data = json.loads(response_text)
        content = data.get('message_plain', '') or data.get('message', '')

        # Strip reply signatures
        reply_patterns = [
            r'\n\s*On\s+.+?\s+wrote:\s*\n',
            r'\n\s*On\s+.+?\s+at\s+.+?wrote:\s*\n',
            r'\n\s*-{2,}\s*On\s+.+?wrote:\s*-{2,}\s*\n',
        ]
        for pattern in reply_patterns:
            match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
            if match:
                content = content[:match.start()].strip()
                break

        logging.info(f"✅ Fetched message detail for {message_id} ({len(content)} chars)")
        return {
            'message_id': clean_id,
            'item_code': item_code,
            'content': content,
            'subject': data.get('subject', ''),
            'from_email': data.get('from_email', ''),
            'from_name': data.get('from_name', ''),
            'timestamp': data.get('time_stamp', '')
        }
    except Exception:
        logging.exception(f"⚠️  Failed to parse message detail JSON. Response: {resp.text[:500]}")
        return {'message_id': clean_id, 'item_code': item_code, 'content': ''}
```

#### Endpoint 3: Get Assignment Modal

**Method**: `GET`
**URL**: `https://dashboard.nationalpid.com/rulestemplates/template/assignemailtovideoteam`

**Request Parameters**:
```python
params = {
    'message_id': message_id,
    'itemcode': item_code
}
```

**Response**: HTML (form with dropdowns and hidden inputs)

**Implementation**:
```python
def get_assignment_modal(self, message_id: str, item_code: str) -> Dict[str, Any]:
    """Get assignment modal data (owners, stages, statuses)"""
    self.ensure_authenticated()

    params = {'message_id': message_id, 'itemcode': item_code}
    resp = self.session.get(
        f"{self.base_url}/rulestemplates/template/assignemailtovideoteam",
        params=params
    )
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Extract CSRF token
    token_input = soup.select_one('input[name="_token"]')
    form_token = token_input['value'] if token_input else ""

    # Extract owners dropdown
    owners = []
    owner_select = soup.select_one('select[name="videoscoutassignedto"]')
    if owner_select:
        for option in owner_select.select('option'):
            owners.append({
                'value': option.get('value', '').strip(),
                'label': option.text.strip()
            })

    # Extract stages dropdown
    stages = []
    stage_select = soup.select_one('select[name="video_progress_stage"]')
    if stage_select:
        for option in stage_select.select('option'):
            stages.append({
                'value': option.get('value', '').strip(),
                'label': option.text.strip()
            })

    # Extract statuses dropdown
    statuses = []
    status_select = soup.select_one('select[name="video_progress_status"]')
    if status_select:
        for option in status_select.select('option'):
            statuses.append({
                'value': option.get('value', '').strip(),
                'label': option.text.strip()
            })

    # Extract pre-filled contact data (student emails)
    contact_input = soup.select_one('input[name="contact"]')
    contact_search = contact_input.get('value', '') if contact_input else ""

    contact_task_input = soup.select_one('input[name="contact_task"]')
    contact_task = contact_task_input.get('value', '').strip() if contact_task_input else ""

    athlete_input = soup.select_one('input[name="athlete_main_id"]')
    athlete_main_id = athlete_input.get('value', '').strip() if athlete_input else ""

    # Default to Jerami Singleton (ID: 1408164)
    jerami_id = '1408164'
    default_owner = None
    if owners:
        default_owner = next((owner for owner in owners if owner['value'] == jerami_id), None)
        if not default_owner:
            default_owner = owners[0]

    return {
        'formToken': form_token,
        'owners': owners,
        'stages': stages,
        'videoStatuses': statuses,
        'contactSearchValue': contact_search,
        'athleteMainId': athlete_main_id,
        'contactTask': contact_task,
        'messageId': message_id,
        'defaultSearchFor': 'athlete',
        'defaultOwner': default_owner,
        'contactFor': 'athlete'
    }
```

#### Endpoint 4: Search Contacts

**Method**: `GET`
**URL**: `https://dashboard.nationalpid.com/template/calendaraccess/contactslist`

**Request Parameters**:
```python
params = {
    'search': query,       # Email or name
    'searchfor': search_type  # 'athlete' or 'parent'
}
```

**Response**: HTML (table with radio buttons)

**Implementation**:
```python
def search_contacts(
    self, query: str, search_type: str = 'athlete'
) -> List[Dict[str, Any]]:
    """Search for contacts (athletes/parents)"""
    self.ensure_authenticated()

    params = {'search': query, 'searchfor': search_type}
    resp = self.session.get(
        f"{self.base_url}/template/calendaraccess/contactslist",
        params=params
    )

    if resp.status_code != 200:
        logging.warning(f"⚠️  Contact search failed: {resp.status_code}")
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')
    contacts = []
    rows = soup.select('tr')[1:]  # Skip header row

    for row in rows:
        try:
            input_elem = row.select_one('input.contactselected')
            if not input_elem:
                continue

            contact_id = input_elem.get('contactid', '')
            athlete_main_id = input_elem.get('athlete_main_id', '')
            contact_name = input_elem.get('contactname', '')

            cells = row.select('td')
            if len(cells) >= 5:
                ranking = cells[1].text.strip()
                grad_year = cells[2].text.strip()
                state = cells[3].text.strip()
                sport = cells[4].text.strip()

                contacts.append({
                    'contactId': contact_id,
                    'athleteMainId': athlete_main_id,
                    'name': contact_name,
                    'sport': sport,
                    'gradYear': grad_year,
                    'state': state,
                    'ranking': ranking
                })
        except Exception:
            logging.exception("⚠️  Failed to parse contact row")
            continue

    logging.info(f"✅ Found {len(contacts)} contacts for '{query}' ({search_type})")
    return contacts
```

#### Endpoint 5: Assign Thread

**Method**: `POST`
**URL**: `https://dashboard.nationalpid.com/videoteammsg/assignvideoteam`

**Request Headers**:
```python
headers = {
    'Content-Type': 'application/x-www-form-urlencoded'
}
```

**Request Payload**:
```python
form_data = {
    'messageid': payload['messageId'],
    'videoscoutassignedto': payload['ownerId'],  # Owner ID (1408164 = Jerami)
    'contact_task': contact_id,
    'contacttask': contact_id,  # Duplicate for compatibility
    'athlete_main_id': athlete_main_id,
    'athletemainid': athlete_main_id,  # Duplicate
    'contactfor': payload.get('contactFor', 'athlete'),  # 'athlete' or 'parent'
    'contact': payload.get('contact', ''),  # Email
    'video_progress_stage': stage,  # "In Queue", "On Hold", "Done"
    'videoprogressstage': stage,  # Duplicate
    'video_progress_status': status,  # "HUDL", "Dropbox", "Review"
    'videoprogressstatus': status,  # Duplicate
    '_token': payload['formToken']  # CSRF token
}
```

**Response**: JSON or empty (200 OK)

**Implementation**:
```python
def assign_thread(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Assign a thread to video team"""
    self.ensure_authenticated()

    contact_id = payload.get('contact_id', payload.get('contactId', ''))
    athlete_main_id = payload.get('athleteMainId', '')
    stage = payload.get('stage', '') or ''
    status = payload.get('status', '') or ''

    form_data = {
        'messageid': payload['messageId'],
        'videoscoutassignedto': payload['ownerId'],
        'contact_task': contact_id,
        'contacttask': contact_id,
        'athlete_main_id': athlete_main_id,
        'athletemainid': athlete_main_id,
        'contactfor': payload.get('contactFor', 'athlete'),
        'contact': payload.get('contact', ''),
        'video_progress_stage': stage,
        'videoprogressstage': stage,
        'video_progress_status': status,
        'videoprogressstatus': status,
        '_token': payload['formToken']
    }

    resp = self.session.post(
        f"{self.base_url}/videoteammsg/assignvideoteam",
        data=form_data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    resp.raise_for_status()

    # Handle empty response (success)
    if resp.status_code == 200 and not resp.text.strip():
        logging.info(f"✅ Assigned thread {payload['messageId']} (empty response)")
        return {'success': True}

    try:
        result = resp.json()
    except json.JSONDecodeError:
        logging.error(f"Failed to decode JSON. Status: {resp.status_code}, Body: {resp.text}")
        raise Exception(f"Assignment response not valid JSON. Body: {resp.text[:500]}")

    if result.get('success'):
        logging.info(f"✅ Assigned thread {payload['messageId']}")
        return result

    raise Exception(f"Assignment failed: {result}")
```

#### Endpoint 6: Search Video Progress

**Method**: `POST`
**URL**: `https://dashboard.nationalpid.com/videoteammsg/videoprogress`

**Request Headers**:
```python
headers = {
    'Content-Type': 'application/x-www-form-urlencoded'
}
```

**Request Payload**:
```python
data = {
    '_token': csrf_token,
    'first_name': first_name,
    'last_name': last_name
}
```

**Response**: JSON (array of athletes)

**Implementation**:
```python
def search_video_progress(self, first_name: str, last_name: str) -> List[Dict[str, Any]]:
    """Search for players in the video progress workflow."""
    self.ensure_authenticated()
    csrf_token = self._get_csrf_token()

    data = {
        '_token': csrf_token,
        'first_name': first_name,
        'last_name': last_name
    }

    resp = self.session.post(
        f"{self.base_url}/videoteammsg/videoprogress",
        data=data
    )
    resp.raise_for_status()
    return resp.json()
```

#### Endpoint 7: Send Email to Athlete

**Method**: `POST`
**URL**: `https://dashboard.nationalpid.com/admin/addnotification`

**Request Payload**:
```python
email_payload = {
    "_token": csrf_token,
    "notification_type_id": "1",
    "notification_to_type_id": "1",
    "notification_to_id": player_id,
    "notification_from": "James Holcomb",
    "notification_from_email": "jholcomb@nationalpid.com",
    "notification_subject": template_subject,
    "notification_message": template_body,
    "includemysign": "includemysign"
}
```

**Response**: HTML (contains "Email Sent" on success)

#### Endpoint 8: Update Video Progress Stage

**Method**: `POST`
**URL**: `https://dashboard.nationalpid.com/videoteammsg/updatestage`

**Request Payload**:
```python
data = {
    '_token': csrf_token,
    'athlete_id': athlete_id,
    'stage': stage  # "In Queue", "On Hold", "Done"
}
```

### 2.3 CSRF Token Handling

**Token Extraction from Login Page**:
```python
def _get_csrf_token(self) -> str:
    """Extract CSRF token from login page"""
    resp = self.session.get(f"{self.base_url}/auth/login")
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')
    token_input = soup.find('input', {'name': '_token'})
    if not token_input or not token_input.get('value'):
        raise ValueError("Failed to extract CSRF token")
    return token_input['value']
```

**Token from Cookies** (used in assignment):
```python
def get_csrf_token(self):
    """Extract CSRF token from cookies"""
    return self.session.cookies.get('XSRF-TOKEN', '')
```

### 2.4 CLI Interface

**Command-Line Usage**:
```bash
# Login
python3 npid_api_client.py login

# Get inbox threads
python3 npid_api_client.py get_inbox_threads '{"limit": 50, "filter_assigned": "unassigned"}'

# Get message detail
python3 npid_api_client.py get_message_detail '{"message_id": "12345", "item_code": "12345"}'

# Assign thread
python3 npid_api_client.py assign_thread '{
  "messageId": "12345",
  "contactId": "67890",
  "athleteMainId": "11111",
  "ownerId": "1408164",
  "stage": "In Queue",
  "status": "HUDL",
  "contactFor": "athlete",
  "contact": "athlete@email.com",
  "formToken": "csrf_token_here"
}'
```

**Main Function**:
```python
def main():
    """CLI interface for testing"""
    if len(sys.argv) < 2:
        print("Usage: python3 npid_api_client.py <method> [json_args]")
        sys.exit(1)

    method = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    client = NPIDAPIClient()

    try:
        if method == 'login':
            result = client.login()
            print(json.dumps({'success': result}))
        elif method == 'get_inbox_threads':
            limit = args.get('limit', 100)
            filter_assigned = args.get('filter_assigned', 'both')
            exclude_id = args.get('exclude_id')
            threads = client.get_inbox_threads(limit, filter_assigned, exclude_id)
            print(json.dumps(threads))
        # ... other methods
    except Exception:
        logging.exception("CLI execution failed")
        sys.exit(1)
```

---

## 3. TypeScript/Raycast Integration Layer

### 3.1 Python Subprocess Client

**Location**: `src/lib/python-server-client.ts`

**Implementation**:
```typescript
import { spawn } from "child_process";

const PYTHON_PATH = "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3";
const PYTHON_SERVER_PATH = "/Users/singleton23/Raycast/prospect-pipeline/src/python/npid_api_client.py";

export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Spawn Python process with method and JSON args
    const command = `${PYTHON_PATH} ${PYTHON_SERVER_PATH} ${method} '${JSON.stringify(args)}'`;
    const childProcess = spawn(command, {
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      }
    });

    let stdout = "";
    let stderr = "";

    // Collect stdout
    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    // Collect stderr
    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Handle process completion
    childProcess.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result as T);
        } catch (error) {
          console.error("Failed to parse Python script output:", error);
          reject(new Error("Failed to parse Python script output."));
        }
      } else {
        console.error(`Python script exited with code ${code}: ${stderr}`);
        reject(new Error(`Python script failed: ${stderr}`));
      }
    });

    // Handle spawn errors
    childProcess.on('error', (err) => {
      console.error('Spawn error:', err);
      reject(err);
    });
  });
}
```

**Data Serialization Flow**:
```
TypeScript Object → JSON.stringify() → CLI arg
    ↓
Python subprocess receives arg[2]
    ↓
json.loads(sys.argv[2]) → Python dict
    ↓
Process and execute method
    ↓
json.dumps(result) → stdout
    ↓
TypeScript JSON.parse(stdout) → TypeScript Object
```

### 3.2 Raycast Commands

#### Command 1: Assign Video Team Inbox

**File**: `src/assign-videoteam-inbox.tsx`

**Implementation**:
```typescript
export default function InboxCheck() {
  const [messages, setMessages] = useState<NPIDInboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { push, pop } = useNavigation();

  useEffect(() => {
    void loadInboxMessages();
  }, []);

  const loadInboxMessages = async () => {
    try {
      setIsLoading(true);

      // Fetch ONLY unassigned threads (filter on API side)
      // HARD LIMIT: Never show more than 15 unassigned threads
      const threads = await fetchInboxThreads(15, 'unassigned');

      await showToast({
        style: threads.length > 0 ? Toast.Style.Success : Toast.Style.Failure,
        title: `Found ${threads.length} assignable messages`,
        message: threads.length === 0 ? 'All threads are assigned' : 'Ready to assign',
      });

      setMessages(threads);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load inbox',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };
}
```

**Adapter Function** (inline in file):
```typescript
// Note: The code references fetchInboxThreads from './lib/npid-mcp-adapter'
// However, this file doesn't exist in the repo. The actual implementation
// appears to be calling callPythonServer directly.

async function fetchInboxThreads(limit: number, filter: string): Promise<NPIDInboxMessage[]> {
  return callPythonServer<NPIDInboxMessage[]>('get_inbox_threads', {
    limit,
    filter_assigned: filter
  });
}

async function fetchAssignmentModal(messageId: string) {
  const modal = await callPythonServer<VideoTeamAssignmentModal>(
    'get_assignment_modal',
    { message_id: messageId, item_code: messageId }
  );

  // Also fetch pre-loaded contacts if available
  const contacts: VideoTeamContact[] = [];

  return { modal, contacts };
}

async function resolveContactsForAssignment(
  searchValue: string,
  searchType: VideoTeamSearchCategory
) {
  // Try athlete first
  let contacts = await callPythonServer<VideoTeamContact[]>(
    'search_contacts',
    { query: searchValue, search_type: 'athlete' }
  );

  let searchForUsed = 'athlete';

  // Fallback to parent if no athlete found
  if (contacts.length === 0 && searchType !== 'parent') {
    contacts = await callPythonServer<VideoTeamContact[]>(
      'search_contacts',
      { query: searchValue, search_type: 'parent' }
    );
    searchForUsed = 'parent';
  }

  return { contacts, searchForUsed };
}

async function assignVideoTeamMessage(payload: AssignVideoTeamPayload) {
  return callPythonServer('assign_thread', payload);
}
```

**Assignment Flow**:
```typescript
const handleAssignTask = async (message: NPIDInboxMessage) => {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: 'Preparing assignment…'
  });

  try {
    // Step 1: Fetch assignment modal data
    const { modal: modalData, contacts: preloadedContacts } =
      await fetchAssignmentModal(message.id);

    // Step 2: Search for contacts
    const searchValue = modalData.contactSearchValue || message.email || message.name;
    const { contacts, searchForUsed } = await resolveContactsForAssignment(
      searchValue,
      modalData.defaultSearchFor
    );

    const usedSearchResults = contacts.length > 0;
    let contactPool = usedSearchResults ? contacts : preloadedContacts;

    // Step 3: Build fallback contact from modal data
    const fallbackContact: VideoTeamContact | null =
      modalData.contactTask && (modalData.athleteMainId || message.athleteMainId)
        ? {
            contactId: modalData.contactTask,
            athleteMainId: modalData.athleteMainId ?? message.athleteMainId ?? null,
            name: message.name || message.email || modalData.contactTask,
            sport: null,
            gradYear: null,
            state: null,
            top500: null,
            videoEditor: null,
            email: message.email,
          }
        : null;

    if (
      fallbackContact &&
      !contactPool.some((c) => c.contactId === fallbackContact.contactId)
    ) {
      contactPool = [...contactPool, fallbackContact];
    }

    if (contactPool.length === 0) {
      toast.style = Toast.Style.Failure;
      toast.title = 'No contacts found';
      toast.message = 'Try searching manually on the website.';
      return;
    }

    toast.hide();

    // Step 4: Show assignment modal
    push(
      <AssignmentModal
        message={message}
        modalData={modalData}
        contacts={contactPool}
        searchFor={usedSearchResults ? searchForUsed : modalData.contactFor}
        onAssign={async ({ ownerId, stage, status, contact, searchFor }) => {
          const assigningToast = await showToast({
            style: Toast.Style.Animated,
            title: 'Assigning…',
          });

          try {
            const resolvedOwnerId = ownerId || '1408164';

            const payload: AssignVideoTeamPayload = {
              messageId: message.id,
              contactId: contact.contactId,
              contact_id: contact.contactId,
              athleteMainId: contact.athleteMainId ?? modalData.athleteMainId ?? null,
              ownerId: resolvedOwnerId,
              stage: (stage || '') as TaskStage,
              status: (status || '') as TaskStatus,
              searchFor,
              formToken: modalData.formToken,
              contact: contact.email ?? message.email,
            };

            await assignVideoTeamMessage(payload);

            assigningToast.style = Toast.Style.Success;
            assigningToast.title = 'Assigned to Video Team';
            assigningToast.message = `${message.name} → Jerami Singleton`;

            pop();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await loadInboxMessages();
          } catch (error) {
            assigningToast.style = Toast.Style.Failure;
            assigningToast.title = 'Assignment failed';
            assigningToast.message = error instanceof Error ? error.message : 'Unknown error';
          }
        }}
        onCancel={pop}
      />
    );
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = 'Unable to load assignment modal';
    toast.message = error instanceof Error ? error.message : 'Unknown error';
  }
};
```

#### Command 2: Video Updates

**File**: `src/video-updates.tsx`

**3-Step Workflow**:
```typescript
async onSubmit(formValues) {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: 'Processing video update...',
  });

  try {
    let playerId = formValues.playerId;
    let athleteName = formValues.athleteName;

    if (formValues.searchMode === 'name' && selectedPlayer) {
      playerId = selectedPlayer.player_id;
      athleteName = selectedPlayer.name;
    }

    if (!playerId) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Player ID Required';
      return;
    }

    // Step 1: Upload video to NPID profile
    toast.title = 'Updating NPID Profile...';
    const result = await callPythonServer('update_video_profile', {
      player_id: playerId,
      youtube_link: formValues.youtubeLink,
      season: formValues.season,
      video_type: formValues.videoType
    });

    if (result.status === 'ok' && result.data?.success) {
      toast.style = Toast.Style.Success;
      toast.title = 'Video Uploaded!';
      toast.message = `Sending email and updating stage...`;

      // Step 2: Send "Editing Done" email
      try {
        toast.message = `Sending "Editing Done" email...`;
        const emailResult = await callPythonServer('send_email_to_athlete', {
          athlete_name: athleteName,
          template_name: 'Editing Done'
        });

        if (emailResult.status === 'ok' && emailResult.data?.success) {
          toast.message = `Email sent! Updating stage to Done...`;

          // Step 3: Update stage to "Done"
          try {
            const stageResult = await callPythonServer('update_video_progress_stage', {
              athlete_id: playerId,
              stage: 'Done'
            });

            if (stageResult.status === 'ok' && stageResult.data?.success) {
              toast.style = Toast.Style.Success;
              toast.title = 'All Steps Complete!';
              toast.message = `✅ Video uploaded\n✅ Email sent\n✅ Stage updated to Done`;
            } else {
              toast.style = Toast.Style.Success;
              toast.title = 'Video & Email Complete';
              toast.message = `✅ Video uploaded\n✅ Email sent\n⚠️ Stage update failed`;
            }
          } catch (stageError) {
            console.error('Stage update error:', stageError);
            toast.style = Toast.Style.Success;
            toast.title = 'Video & Email Complete';
            toast.message = `✅ Video uploaded\n✅ Email sent\n⚠️ Stage update failed`;
          }
        }
      } catch (emailError) {
        console.error('Email send error:', emailError);
        toast.style = Toast.Style.Success;
        toast.title = 'Video Uploaded';
        toast.message = `✅ Video uploaded\n⚠️ Email send failed`;
      }

      reset();
      setSelectedPlayer(null);
      setSearchResults([]);
      setSeasons([]);
    }
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = 'Failed to Update NPID';
    toast.message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  }
}
```

### 3.3 TypeScript Type Definitions

**File**: `src/types/video-team.ts`

```typescript
export interface NPIDInboxMessage {
  id: string;
  itemCode: string;
  thread_id: string;
  player_id: string;
  contactid: string;
  name: string;
  email: string;
  subject: string;
  content: string;
  preview: string;
  status: 'assigned' | 'unassigned';
  timestamp: string;
  timeStampDisplay: string | null;
  timeStampIso: string | null;
  is_reply_with_signature: boolean;
  isUnread?: boolean;
  stage?: string;
  videoStatus?: string;
  canAssign?: boolean;
  athleteMainId?: string | null;
  attachments?: VideoTeamAttachment[];
}

export interface VideoTeamAttachment {
  fileName: string;
  url: string | null;
  expiresAt: string | null;
  downloadable: boolean;
}

export type VideoTeamSearchCategory =
  | 'athlete'
  | 'parent'
  | 'hs coach'
  | 'club coach'
  | 'college coach';

export interface VideoTeamContact {
  contactId: string;
  athleteMainId: string | null;
  name: string;
  top500: string | null;
  gradYear: string | null;
  state: string | null;
  sport: string | null;
  videoEditor: string | null;
  email?: string | null;
}

export interface VideoTeamAssignmentModal {
  formToken: string;
  messageId: string;
  owners: VideoTeamAssignmentOwner[];
  defaultOwner?: VideoTeamAssignmentOwner;
  stages: VideoTeamAssignmentOption[];
  videoStatuses: VideoTeamAssignmentOption[];
  defaultSearchFor: VideoTeamSearchCategory;
  contactSearchValue: string;
  contactTask?: string;
  athleteMainId?: string | null;
  contactFor: VideoTeamSearchCategory;
}
```

---

## 4. Network Communication Patterns

### 4.1 Authentication Pattern

```
1. Check ~/.npid_session.pkl exists
   ├─ YES → Load cookies → Validate session at /external/logincheck
   │        ├─ Valid → Use existing session
   │        └─ Invalid → Force re-login
   └─ NO → Fresh login required

2. Fresh Login Flow:
   GET /auth/login
   ├─ Parse HTML for CSRF _token
   └─ POST /auth/login
      ├─ email, password, _token, remember=on
      └─ Receive Set-Cookie headers
          └─ Save cookies to ~/.npid_session.pkl
```

### 4.2 CSRF Token Pattern

**Two Token Types**:

1. **Form Token** (`_token`): Extracted from HTML forms
   - Used in: Login, video progress search, email sending
   - Extraction: BeautifulSoup parse `<input name="_token">`

2. **Cookie Token** (`XSRF-TOKEN`): Stored in cookies
   - Used in: Assignment submissions
   - Extraction: `session.cookies.get('XSRF-TOKEN')`

### 4.3 Session Persistence

**Cookie Storage**:
```python
# Save (after login)
with open('~/.npid_session.pkl', 'wb') as f:
    pickle.dump(session.cookies, f)

# Load (on init)
with open('~/.npid_session.pkl', 'rb') as f:
    cookies = pickle.load(f)
    session.cookies.update(cookies)
```

**Session Lifetime**: 400 days (via `remember=on` token)

### 4.4 Error Handling

**Python Layer**:
```python
try:
    resp = self.session.get(url)
    resp.raise_for_status()  # Raises HTTPError for 4xx/5xx
    return resp.json()
except requests.exceptions.HTTPError as e:
    logging.error(f"HTTP Error: {e}")
    return {'error': str(e)}
except json.JSONDecodeError as e:
    logging.error(f"JSON Parse Error: {e}")
    return {'error': 'Invalid JSON response'}
except Exception as e:
    logging.exception("Unexpected error")
    return {'error': str(e)}
```

**TypeScript Layer**:
```typescript
try {
  const result = await callPythonServer('method', args);
  // Process result
} catch (error) {
  await showToast({
    style: Toast.Style.Failure,
    title: 'Operation Failed',
    message: error instanceof Error ? error.message : 'Unknown error'
  });
}
```

---

## 5. Dependencies & Configuration

### 5.1 Python Dependencies

**File**: `src/python/requirements.txt`

```
# REST API dependencies only (no Selenium/Playwright)
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0

# MCP support (for future MCP wrapper)
mcp>=1.9.4
```

**Installation**:
```bash
pip install -r src/python/requirements.txt
```

### 5.2 TypeScript Dependencies

**File**: `package.json`

```json
{
  "name": "prospect-pipeline",
  "title": "Prospect Pipeline",
  "description": "Student-athlete video editing workflow automation",
  "type": "module",
  "dependencies": {
    "@notionhq/client": "^2.2.0",
    "@raycast/api": "^1.102.7",
    "@raycast/utils": "^2.2.1",
    "@supabase/supabase-js": "^2.58.0",
    "date-fns": "^4.1.0",
    "playwright": "^1.55.1",
    "python-shell": "^5.0.0"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^2.1.1",
    "@types/node": "^20.11.0",
    "@types/react": "18.0.9",
    "@typescript-eslint/eslint-plugin": "^8.45.0",
    "@typescript-eslint/parser": "^8.45.0",
    "eslint": "^9.37.0",
    "globals": "^16.4.0",
    "typescript": "^4.9.5"
  }
}
```

**Note**: `playwright` and `python-shell` are listed but not actively used in the REST implementation.

### 5.3 Environment Variables

**Required**:
```bash
# NPID Dashboard Credentials
export NPID_EMAIL="jsingleton@prospectid.com"
export NPID_PASSWORD="YBh@Y8Us@1&qwd$"

# Notion Integration (for video tasks)
export NOTION_TOKEN="secret_xxxxxxxxxxxxx"

# Supabase (for inbox caching)
export SUPABASE_URL="https://xxxxxxxxxxxxx.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Raycast Preferences** (`package.json`):
```json
"preferences": [
  {
    "name": "notionToken",
    "title": "Notion Integration Token",
    "description": "Your Notion API integration token",
    "type": "password",
    "required": true
  },
  {
    "name": "supabaseUrl",
    "title": "Supabase URL",
    "description": "The URL of your Supabase project",
    "type": "textfield",
    "required": true
  },
  {
    "name": "supabaseAnonKey",
    "title": "Supabase Anon Key",
    "description": "The anonymous key for your Supabase project",
    "type": "password",
    "required": true
  }
]
```

### 5.4 Configuration Files

**Python Path Configuration** (`src/lib/python-server-client.ts`):
```typescript
const PYTHON_PATH = "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3";
const PYTHON_SERVER_PATH = "/Users/singleton23/Raycast/prospect-pipeline/src/python/npid_api_client.py";
```

**Session Storage**:
```
~/.npid_session.pkl  # Pickled session cookies (400-day persistence)
```

---

## 6. File Structure

```
prospect-pipeline/
├── src/
│   ├── python/
│   │   ├── npid_api_client.py          # Main REST API client (CLI interface)
│   │   ├── npid_rest_client.py         # Legacy assignment client (Selenium era)
│   │   ├── npid_simple_server.py       # Cached JSON-RPC server (unused)
│   │   ├── npid_email_automator.py     # Email automation helpers
│   │   ├── npid_video_progress_sync.py # Video progress sync (Selenium)
│   │   ├── requirements.txt            # Python dependencies
│   │   ├── SESSION-PERSISTENCE.md      # Session architecture docs
│   │   ├── debug_api_response.py       # Debugging scripts
│   │   ├── debug_message_detail.py
│   │   └── test_message_fetch.py
│   │
│   ├── lib/
│   │   ├── python-server-client.ts     # TypeScript → Python subprocess bridge
│   │   └── supabase-client.ts          # Supabase connection (inbox caching)
│   │
│   ├── types/
│   │   ├── video-team.ts               # Video team type definitions
│   │   └── workflow.ts                 # Workflow stage/status enums
│   │
│   ├── assign-videoteam-inbox.tsx      # Raycast: Assign inbox threads
│   ├── read-videoteam-inbox.tsx        # Raycast: Read inbox
│   ├── video-updates.tsx               # Raycast: 3-step video workflow
│   ├── email-student-athletes.tsx      # Raycast: Email automation
│   ├── active-tasks.tsx                # Raycast: Notion task browser
│   └── generate-names.tsx              # Raycast: Naming conventions
│
├── supabase/
│   └── migrations/
│       └── 001_create_npid_inbox_threads.sql
│
├── .claude/
│   └── skills/
│       └── npid-api.md                 # Claude skill documentation
│
├── package.json                        # Raycast extension manifest
├── tsconfig.json                       # TypeScript config
└── README.md
```

---

## 7. Key Implementation Patterns

### 7.1 Cookie Persistence Pattern

**Pickle-based Session Cache**:

```python
class NPIDAPIClient:
    def __init__(self):
        self.cookie_file = Path.home() / '.npid_session.pkl'
        self._load_session()

    def _load_session(self):
        """Load cookies from pickle file"""
        if self.cookie_file.exists():
            with open(self.cookie_file, 'rb') as f:
                cookies = pickle.load(f)
                self.session.cookies.update(cookies)

    def _save_session(self):
        """Save cookies to pickle file"""
        with open(self.cookie_file, 'wb') as f:
            pickle.dump(self.session.cookies, f)
```

**Why Pickle?**
- Preserves cookie attributes (domain, path, expiry)
- Simple serialization for `requests.cookies.RequestsCookieJar`
- 400-day session persistence with `remember=on` token

### 7.2 Session Validation Pattern

**Prevents Unnecessary Re-authentication**:

```python
def ensure_authenticated(self):
    """Ensure we're authenticated before making requests"""
    if not self.authenticated:
        self.login()

def login(self, force=False) -> bool:
    """Login with remember token for 400-day persistence"""
    # Check if already valid
    if not force and self.validate_session():
        logging.info("✅ Already authenticated")
        self.authenticated = True
        return True

    # Perform login...
```

**Validation Endpoint**:
```python
def validate_session(self) -> bool:
    """Check if current session is valid"""
    try:
        resp = self.session.get(f"{self.base_url}/external/logincheck")
        if resp.status_code == 200:
            data = resp.json()
            return data.get('success') == 'true'
    except Exception:
        logging.exception("Session validation error")
    return False
```

### 7.3 Subprocess Communication Pattern

**TypeScript → Python IPC**:

```typescript
export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Spawn subprocess
    const command = `${PYTHON_PATH} ${PYTHON_SERVER_PATH} ${method} '${JSON.stringify(args)}'`;
    const childProcess = spawn(command, { shell: true });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result as T);
        } catch (error) {
          reject(new Error("Failed to parse Python script output."));
        }
      } else {
        reject(new Error(`Python script failed: ${stderr}`));
      }
    });
  });
}
```

**Python CLI Handler**:
```python
def main():
    method = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    client = NPIDAPIClient()

    result = getattr(client, method)(**args)
    print(json.dumps(result))  # Output to stdout
```

### 7.4 Error Propagation Pattern

**Python → TypeScript Error Flow**:

```python
# Python: Return error in JSON
try:
    result = client.get_inbox_threads(limit)
    print(json.dumps(result))
except Exception as e:
    logging.exception("CLI execution failed")
    sys.exit(1)  # Non-zero exit code
```

```typescript
// TypeScript: Parse exit code
childProcess.on("close", (code) => {
  if (code === 0) {
    resolve(JSON.parse(stdout));
  } else {
    reject(new Error(`Python script failed: ${stderr}`));
  }
});

// UI: Display error toast
try {
  await callPythonServer('method', args);
} catch (error) {
  await showToast({
    style: Toast.Style.Failure,
    title: 'Operation Failed',
    message: error.message
  });
}
```

### 7.5 HTML Parsing Pattern

**BeautifulSoup for Non-JSON Endpoints**:

```python
# Parse inbox HTML
resp = self.session.get(f"{self.base_url}/rulestemplates/template/videoteammessagelist")
soup = BeautifulSoup(resp.text, 'html.parser')

# Select message elements
message_elements = soup.select('div.ImageProfile')

for elem in message_elements:
    # Extract data attributes
    item_id = elem.get('itemid')
    contact_id = elem.get('contacttask')

    # Extract nested text
    name_elem = elem.select_one('.msg-sendr-name')
    name = name_elem.text.strip() if name_elem else "Unknown"

    # Extract hidden fields
    email_elem = elem.select_one('.hidden')
    email = email_elem.text.strip() if email_elem else ""
```

---

## 8. Deployment Specifications

### 8.1 VPS Requirements

**System Requirements**:
- **OS**: Ubuntu 20.04+ or Debian 11+
- **Python**: 3.9+
- **Memory**: 512MB minimum (1GB recommended)
- **Disk**: 1GB for dependencies + cache
- **Network**: Outbound HTTPS to dashboard.nationalpid.com

**Python Environment**:
```bash
# Install Python 3.9+
sudo apt update
sudo apt install python3 python3-pip python3-venv

# Create virtual environment
python3 -m venv /opt/prospect-pipeline/venv
source /opt/prospect-pipeline/venv/bin/activate

# Install dependencies
pip install -r /opt/prospect-pipeline/src/python/requirements.txt
```

**Environment Configuration**:
```bash
# /etc/environment or ~/.bashrc
export NPID_EMAIL="jsingleton@prospectid.com"
export NPID_PASSWORD="YBh@Y8Us@1&qwd$"
export NPID_SESSION_FILE="/var/cache/npid_session.pkl"
```

**Session Storage**:
```bash
# Create cache directory
mkdir -p /var/cache/npid
chown www-data:www-data /var/cache/npid
chmod 700 /var/cache/npid
```

### 8.2 API Server Deployment

**Option 1: Flask REST API** (Recommended)

```python
# server.py
from flask import Flask, request, jsonify
from npid_api_client import NPIDAPIClient

app = Flask(__name__)
client = NPIDAPIClient()

@app.route('/api/inbox_threads', methods=['GET'])
def get_inbox_threads():
    limit = int(request.args.get('limit', 100))
    filter_assigned = request.args.get('filter', 'both')
    threads = client.get_inbox_threads(limit, filter_assigned)
    return jsonify(threads)

@app.route('/api/assign_thread', methods=['POST'])
def assign_thread():
    payload = request.json
    result = client.assign_thread(payload)
    return jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

**Systemd Service** (`/etc/systemd/system/npid-api.service`):
```ini
[Unit]
Description=NPID API Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/prospect-pipeline
Environment="NPID_EMAIL=jsingleton@prospectid.com"
Environment="NPID_PASSWORD=YBh@Y8Us@1&qwd$"
ExecStart=/opt/prospect-pipeline/venv/bin/python server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Start Service**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable npid-api
sudo systemctl start npid-api
sudo systemctl status npid-api
```

**Option 2: CLI-only Deployment**

```bash
# Run commands via SSH
ssh user@vps 'cd /opt/prospect-pipeline && venv/bin/python src/python/npid_api_client.py get_inbox_threads "{\"limit\": 50}"'
```

### 8.3 Claude Skills Integration

**Skill Definition** (`.claude/skills/npid-api.md`):

```markdown
# NPID API Client Skill

Interact with National PID Dashboard REST API for athlete and video team operations.

## Context
- **Client**: Prospect ID (Client 2)
- **API Base**: https://dashboard.nationalpid.com
- **Session**: Cookie-based (400-day persistence)
- **Client Location**: `/opt/prospect-pipeline/src/python/npid_api_client.py`

## Common Operations

### Get Inbox Threads
```python
from npid_api_client import NPIDAPIClient

client = NPIDAPIClient()
threads = client.get_inbox_threads(limit=50, filter_assigned='unassigned')
print(f"Found {len(threads)} unassigned threads")
```

### Assign Thread to Video Team
```python
payload = {
    'messageId': '12345',
    'contactId': '67890',
    'athleteMainId': '11111',
    'ownerId': '1408164',  # Jerami Singleton
    'stage': 'In Queue',
    'status': 'HUDL',
    'contactFor': 'athlete',
    'contact': 'athlete@email.com',
    'formToken': 'csrf_token'
}
result = client.assign_thread(payload)
```

### Search Athletes
```python
athletes = client.search_player('John Doe')
for athlete in athletes:
    print(f"{athlete['name']} - {athlete['grad_year']} - {athlete['high_school']}")
```

## Best Practices
- Always check `client.validate_session()` before operations
- Use session caching to avoid re-authentication
- Handle exceptions with try/except blocks
- Log operations for debugging
```

**MCP Server Configuration** (future):

```json
{
  "mcpServers": {
    "npid-api": {
      "command": "python",
      "args": ["/opt/prospect-pipeline/src/python/npid_mcp_server.py"],
      "env": {
        "NPID_EMAIL": "jsingleton@prospectid.com",
        "NPID_PASSWORD": "YBh@Y8Us@1&qwd$"
      }
    }
  }
}
```

### 8.4 Obsidian Documentation Structure

**Vault Structure**:

```
Obsidian-Vault/
├── Clients/
│   └── Prospect-ID/
│       ├── Systems/
│       │   ├── NPID-API-Client.md
│       │   ├── Video-Workflow.md
│       │   └── Session-Management.md
│       ├── Endpoints/
│       │   ├── Inbox-Threads.md
│       │   ├── Assignment-Modal.md
│       │   ├── Contact-Search.md
│       │   └── Video-Progress.md
│       ├── Authentication/
│       │   ├── Cookie-Based-Auth.md
│       │   ├── CSRF-Tokens.md
│       │   └── Session-Validation.md
│       └── Deployment/
│           ├── VPS-Setup.md
│           ├── Environment-Config.md
│           └── Troubleshooting.md
```

**Example Note** (`NPID-API-Client.md`):

```markdown
---
tags: [api, python, rest-client, prospect-id]
created: 2025-11-04
updated: 2025-11-04
---

# NPID API Client

REST API client for National PID Dashboard operations.

## Quick Start

```python
from npid_api_client import NPIDAPIClient

client = NPIDAPIClient()
threads = client.get_inbox_threads(limit=50)
```

## Architecture

![[npid-architecture-diagram.png]]

See: [[Session-Management]], [[Authentication]]

## Methods

### get_inbox_threads()
Fetch video team inbox threads with pagination.

**Parameters**:
- `limit` (int): Max threads to return (default: 100)
- `filter_assigned` (str): 'both', 'assigned', 'unassigned'

**Returns**: `List[Dict]`

**Example**:
```python
threads = client.get_inbox_threads(limit=15, filter_assigned='unassigned')
```

## Related
- [[Video-Workflow]]
- [[Raycast-Integration]]
- [[VPS-Deployment]]
```

---

## Appendix A: Environment Setup Checklist

### Local Development
- [ ] Python 3.9+ installed
- [ ] Virtual environment created
- [ ] Dependencies installed (`pip install -r requirements.txt`)
- [ ] Environment variables set (NPID_EMAIL, NPID_PASSWORD)
- [ ] Session file permissions (`chmod 600 ~/.npid_session.pkl`)
- [ ] Test authentication (`python npid_api_client.py login`)

### VPS Deployment
- [ ] Ubuntu/Debian server provisioned
- [ ] Python 3.9+ installed
- [ ] Virtual environment created at `/opt/prospect-pipeline/venv`
- [ ] Dependencies installed in venv
- [ ] Environment variables configured in `/etc/environment`
- [ ] Cache directory created (`/var/cache/npid`)
- [ ] Systemd service configured
- [ ] Firewall rules configured (if using Flask API)
- [ ] Test CLI execution
- [ ] Test API server (if deployed)

### Raycast Extension
- [ ] Node.js 18+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] Python path configured in `python-server-client.ts`
- [ ] Notion token added to Raycast preferences
- [ ] Supabase credentials configured
- [ ] Extension built (`npm run build`)
- [ ] Extension installed in Raycast
- [ ] Test inbox command
- [ ] Test assignment command

---

## Appendix B: API Endpoint Reference

| Endpoint | Method | Purpose | Auth | CSRF |
|----------|--------|---------|------|------|
| `/auth/login` | GET | Get login form | ❌ | ✅ Form |
| `/auth/login` | POST | Submit credentials | ❌ | ✅ Form |
| `/external/logincheck` | GET | Validate session | ✅ | ❌ |
| `/rulestemplates/template/videoteammessagelist` | GET | Get inbox threads | ✅ | ❌ |
| `/rulestemplates/template/videoteammessage_subject` | GET | Get message detail | ✅ | ❌ |
| `/rulestemplates/template/assignemailtovideoteam` | GET | Get assignment form | ✅ | ✅ Form |
| `/template/calendaraccess/contactslist` | GET | Search contacts | ✅ | ❌ |
| `/videoteammsg/assignvideoteam` | POST | Submit assignment | ✅ | ✅ Cookie |
| `/videoteammsg/videoprogress` | POST | Search video progress | ✅ | ✅ Form |
| `/admin/addnotification` | POST | Send email | ✅ | ✅ Form |
| `/videoteammsg/updatestage` | POST | Update progress stage | ✅ | ✅ Form |

---

**END OF DOCUMENTATION**

---

*Generated for VPS deployment, Claude Skills creation, and Obsidian knowledge base integration.*
