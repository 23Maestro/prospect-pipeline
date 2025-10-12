## 🚀 IMPLEMENTATION REQUEST - NPID REST CLIENT

Hi Claude! Please implement a REST API client for NPID assignment flow.

### 📁 Working Directory
```bash
cd /Users/singleton23/Raycast/prospect-pipeline/
```

### 📋 What to Build

**File 1: Create npid_rest_client.py**
Location: `mcp-servers/npid-native/npid_rest_client.py`

**File 2: Update npid_automator_complete.py**  
Location: `mcp-servers/npid-native/npid_automator_complete.py`

### 📖 Source Code

The complete `NpidRestClient` class is in the attached document (index 1).

**Copy this entire class into npid_rest_client.py:**
- Import requests, BeautifulSoup, logging
- Class with 4 methods: __init__, get_csrf_token, assign_thread, _submit_assignment
- Owner ID hardcoded: '1408164' (Jerami Singleton)
- Base URL: 'https://dashboard.nationalpid.com'

### 🔧 Integration

In `npid_automator_complete.py`, replace the `assign_thread` method with REST API version:

```python
def assign_thread(self, thread_id, assignee, status=None, stage=None, email=None, **kwargs):
    from npid_rest_client import NpidRestClient
    
    cookies = {cookie['name']: cookie['value'] 
               for cookie in self.driver.get_cookies()}
    
    rest_client = NpidRestClient(cookies)
    
    result = rest_client.assign_thread(
        message_id=thread_id,
        email=email,
        stage=stage or 'In Queue',
        status=status or 'HUDL'
    )
    
    return result
```

### ✅ Deliverables

1. Create `npid_rest_client.py` with complete class
2. Update `assign_thread()` method in `npid_automator_complete.py`
3. Test imports work
4. Verify no syntax errors

### 🧪 Test Commands

```bash
cd /Users/singleton23/Raycast/prospect-pipeline/
python3 -c "from mcp_servers.npid_native.npid_rest_client import NpidRestClient; print('✅')"
```

### 🎯 Key Requirements

- ✅ Student emails = instant (pre-filled modal data)
- ✅ Parent emails = auto-search with `searchfor=parent`
- ✅ Owner always '1408164' (Jerami Singleton)
- ✅ Stage/Status included in every POST
- ✅ No modal clicking (direct HTTP)

### 📎 Reference

Full spec: `/Users/singleton23/Raycast/prospect-pipeline/IMPLEMENTATION_SPEC.md`
Source code: Document index 1 (attached)
