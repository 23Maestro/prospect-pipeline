# CRITICAL SHIP PLAN - Phase 1
**Deadline: October 27, 2025 (3 Days from Oct 24)**
**Status: Ready for Implementation**

---

## OVERVIEW

Three interconnected work items to ship by 10/27:

1. **Contact Search Fix & Verification** (2-4 hrs)
2. **Reply Functionality** (4-6 hrs)
3. **Read Inbox Caching** (1-2 hrs)

**Total Time Estimate**: 7-12 hours

**Critical Path**: Contact search (unblocks assignment) → Reply (feature complete) → Caching (performance polish)

---

## WORK ITEM 1: CONTACT SEARCH FIX & VERIFICATION

### Problem Statement

**Current Behavior**: Contact search works initially but may not persist through entire assignment modal.

**Symptom**: When assigning videos:
- Athlete emails: Contact found, assignment works ✓
- Parent emails: Contact found initially, but may lose context during assignment process ❌
- Fallback used: Works but isn't ideal

**Root Cause**: Unclear - needs debugging. Suspect contact data not fully carried through modal lifecycle.

### Solution Approach

**Strategy**: Add logging to trace contact resolution through entire assignment flow.

#### Step 1.1: Identify Contact Resolution Points

**File**: `src/assign-videoteam-inbox.tsx`

Find and log these points:

```typescript
// Point A: Initial contact search (around line 385)
const { contacts, searchForUsed } = await resolveContactsForAssignment(
  searchValue,
  modalData.defaultSearchFor,
);
// ADD HERE:
console.log('🔍 Contact search result:', { contacts, searchForUsed, searchValue });
```

```typescript
// Point B: Contact pool creation (around line 391)
let contactPool = usedSearchResults ? contacts : preloadedContacts;
// ADD HERE:
console.log('📦 Contact pool created:', { contactPool, usedSearchResults });
```

```typescript
// Point C: Modal initialization (around line 426)
push(
  <AssignmentModal
    message={message}
    modalData={modalData}
    contacts={contactPool}
    searchFor={effectiveSearchFor}
```
// ADD HERE:
console.log('🎬 Modal opened with contacts:', { contactPool, effectiveSearchFor });
```

#### Step 1.2: Verify Modal Receives & Uses Contacts

**File**: `src/assign-videoteam-inbox.tsx` (AssignmentModal component, starting ~line 45)

Inside AssignmentModal, add logging:

```typescript
function AssignmentModal({
  message,
  modalData,
  contacts,
  searchFor,
  ...
}: AssignmentModalProps) {
  // ADD HERE:
  useEffect(() => {
    console.log('📋 AssignmentModal mounted with:', { contacts, searchFor });
  }, [contacts, searchFor]);

  // When contact is selected:
  const handleContactSelect = (selectedId: string) => {
    console.log('👤 Contact selected:', { selectedId, allContacts: contacts });
  };
```

#### Step 1.3: Verify Assignment API Call

**File**: `src/assign-videoteam-inbox.tsx` (in handleAssignTask or assignment submission)

Log the assignment call:

```typescript
// Before assignment API call:
console.log('📤 Sending assignment with:', {
  contactId,
  messageId,
  stage,
  status,
  notes,
});

const result = await assignVideoTeamMessage({...});

// ADD HERE:
console.log('✅ Assignment result:', result);
```

#### Step 1.4: Testing Both Paths

**Test Case 1: Athlete Email**
1. Open assign inbox
2. Select message from athlete email
3. Check console logs:
   - [ ] Contact search finds athlete (log Point A)
   - [ ] Contact pool contains athlete (log Point B)
   - [ ] Modal receives contacts (log Point C)
   - [ ] Assignment sends correct contactId (log Point 1.3)

**Test Case 2: Parent Email**
1. Open assign inbox
2. Select message from parent email
3. Check console logs:
   - [ ] Contact search finds parent (log Point A)
   - [ ] Contact pool contains parent (log Point B)
   - [ ] Modal receives contacts (log Point C)
   - [ ] Assignment sends correct contactId (log Point 1.3)

**Test Case 3: No Match**
1. Open assign inbox
2. Select message with unmatched email
3. Check console logs:
   - [ ] Contact search returns empty (log Point A)
   - [ ] Fallback contact used (log Point B)
   - [ ] Modal receives fallback contact (log Point C)
   - [ ] Assignment sends fallback contactId (log Point 1.3)

### Implementation Checklist

- [ ] Add console.log at Point A (contact search result)
- [ ] Add console.log at Point B (contact pool creation)
- [ ] Add console.log at Point C (modal initialization)
- [ ] Add logging in AssignmentModal component
- [ ] Add logging in assignment API call
- [ ] Test athlete email path
- [ ] Test parent email path
- [ ] Test no-match fallback path
- [ ] Review logs and identify any issues
- [ ] Implement fix if persistence broken (if found)

### Expected Outcome

After debugging:
- Contact search works reliably for both athlete and parent emails
- Contact data flows correctly through assignment modal
- Assignment happens with correct contact ID
- All three paths (athlete, parent, fallback) work as expected

---

## WORK ITEM 2: REPLY FUNCTIONALITY

### Problem Statement

**Current State**:
- Users can view messages but cannot reply without leaving Raycast
- `read-videoteam-inbox.tsx`: Has TODO placeholder
- `assign-videoteam-inbox.tsx`: No reply capability
- Python API: No reply method

**Impact**: Workflow requires context switching to NPID dashboard

### Solution Approach

**High-level Flow**:
```
User clicks "Reply"
  ↓
ReplyForm modal opens
  ↓
User enters reply text
  ↓
Submit → Python API sends reply
  ↓
Toast confirms success
  ↓
Return to message list
```

### Implementation Steps

#### Step 2.1: Research NPID Reply Endpoint

**Where**: NPID Dashboard (https://dashboard.nationalpid.com)

**How**:
1. Open NPID Dashboard in browser
2. Go to Video Team Inbox
3. Open a message and click "Reply"
4. Open DevTools (F12 → Network tab)
5. Type a reply and click send
6. Watch for POST request in Network tab
7. Document:
   - **Endpoint**: `/rulestemplates/template/...` or similar
   - **Method**: POST
   - **Parameters**: What parameters are sent?
   - **Request body**: JSON, form data, or both?
   - **Response**: What does server return?

**Expected Format**:
```
POST /rulestemplates/template/videoteammessage_reply
Headers: {
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/json',
  ...
}
Body: {
  message_id: "...",
  itemcode: "...",
  reply_text: "...",
  type: "inbox",
  user_timezone: "America/New_York"
}
```

#### Step 2.2: Implement Python Method

**File**: `src/python/npid_api_client.py`

Add this method after `send_email_to_athlete` (around line 730):

```python
def send_reply_to_message(self, message_id: str, item_code: str, reply_text: str) -> Dict[str, Any]:
    """Send a reply to a video team inbox message"""
    self.ensure_authenticated()

    clean_id = (
        message_id.replace('message_id', '', 1)
        if message_id and message_id.startswith('message_id')
        else message_id
    )

    # Based on research from Step 2.1, construct the request
    data = {
        'message_id': clean_id,
        'itemcode': item_code,
        'reply_text': reply_text,
        'type': 'inbox',
        'user_timezone': 'America/New_York'
    }

    try:
        resp = self.session.post(
            f"{self.base_url}/rulestemplates/template/videoteammessage_reply",
            json=data,
            headers={
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        )

        if resp.status_code != 200:
            logging.warning(f"⚠️  Failed to send reply: {resp.status_code}")
            return {'success': False, 'error': f'HTTP {resp.status_code}'}

        try:
            response_data = resp.json()
            success = response_data.get('success', False) or resp.status_code == 200
            return {
                'success': success,
                'message_id': clean_id,
                'response': response_data
            }
        except json.JSONDecodeError:
            # Server might return success even without JSON
            return {'success': True, 'message_id': clean_id}

    except Exception as e:
        logging.error(f"❌ Reply error: {e}")
        return {'success': False, 'error': str(e)}
```

#### Step 2.3: Add TypeScript Wrapper

**File**: `src/lib/npid-mcp-adapter.ts`

Add this function:

```typescript
export async function sendReplyToMessage(
  messageId: string,
  itemCode: string,
  replyText: string,
): Promise<{ success: boolean; message?: string }> {
  const result = await callPythonServer<{
    success: boolean;
    error?: string;
    message_id?: string;
  }>('send_reply_to_message', {
    message_id: messageId,
    item_code: itemCode,
    reply_text: replyText,
  });

  if (result.status !== 'ok' || !result.data?.success) {
    throw new Error(result.data?.error || 'Failed to send reply');
  }

  return { success: true };
}
```

#### Step 2.4: Create ReplyForm Component (Optional)

**File**: `src/components/ReplyForm.tsx` (new file)

```typescript
import { Form, ActionPanel, Action, useNavigation, showToast, Toast } from '@raycast/api';
import { useForm } from '@raycast/utils';
import { sendReplyToMessage } from '../lib/npid-mcp-adapter';
import type { NPIDInboxMessage } from '../types/video-team';

interface ReplyFormProps {
  message: NPIDInboxMessage;
  onReplySuccess?: () => void;
}

export function ReplyForm({ message, onReplySuccess }: ReplyFormProps) {
  const { pop } = useNavigation();

  const { handleSubmit, itemProps } = useForm<{ replyText: string }>({
    async onSubmit(values) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Sending reply...',
      });

      try {
        await sendReplyToMessage(
          message.id,
          message.itemCode || '',
          values.replyText,
        );

        toast.style = Toast.Style.Success;
        toast.title = 'Reply sent!';
        toast.message = `Message sent to ${message.name}`;

        onReplySuccess?.();
        pop();
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Failed to send reply';
        toast.message = error instanceof Error ? error.message : 'Unknown error';
      }
    },
    validation: {
      replyText: (value) => {
        if (!value || value.trim().length === 0) return 'Reply cannot be empty';
        if (value.length > 5000) return 'Reply too long (max 5000 characters)';
        return undefined;
      },
    },
  });

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Reply" onSubmit={handleSubmit} />
          <Action title="Cancel" onAction={pop} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="From"
        text={message.name || message.email || 'Unknown'}
      />
      <Form.TextArea
        title="Reply Message"
        placeholder="Type your reply..."
        {...itemProps.replyText}
      />
    </Form>
  );
}
```

#### Step 2.5: Update read-videoteam-inbox.tsx

**File**: `src/read-videoteam-inbox.tsx`

Find the line with "Reply to Email" TODO and replace:

```typescript
// BEFORE:
<Action
  title="Reply to Email"
  icon={Icon.Reply}
  onAction={() => {
    // TODO: Implement reply functionality
    showToast({ style: Toast.Style.Success, title: 'Reply feature coming soon' });
  }}
/>

// AFTER:
<Action
  title="Reply to Email"
  icon={Icon.Reply}
  onAction={() => {
    push(<ReplyForm message={message} onReplySuccess={refresh} />);
  }}
/>
```

Add import at top:
```typescript
import { ReplyForm } from '../components/ReplyForm';
```

#### Step 2.6: Update assign-videoteam-inbox.tsx

**File**: `src/assign-videoteam-inbox.tsx`

Add reply action to the AssignmentModal or message detail view:

```typescript
// In the Actions section of the modal:
<Action
  title="Reply Before Assigning"
  icon={Icon.Reply}
  onAction={() => {
    push(<ReplyForm message={message} onReplySuccess={() => { /* refresh */ }} />);
  }}
/>
```

Or in the message list detail view:

```typescript
// When viewing message details:
<ActionPanel>
  <Action
    title="Open Assignment"
    onAction={() => handleAssignTask(message)}
  />
  <Action
    title="Reply"
    icon={Icon.Reply}
    onAction={() => {
      push(<ReplyForm message={message} />);
    }}
  />
</ActionPanel>
```

### Implementation Checklist

- [ ] Research NPID reply endpoint (browser DevTools)
- [ ] Document endpoint, method, parameters
- [ ] Implement send_reply_to_message in Python API
- [ ] Add sendReplyToMessage wrapper in TypeScript
- [ ] Create ReplyForm component
- [ ] Add reply action to read-videoteam-inbox.tsx
- [ ] Add reply action to assign-videoteam-inbox.tsx
- [ ] Test reply send in read inbox
- [ ] Test reply send in assign inbox
- [ ] Test error handling (empty message, API failure)
- [ ] Verify toast notifications work correctly

### Testing Checklist

- [ ] Reply opens form correctly
- [ ] Can type multi-line message
- [ ] Form validates non-empty message
- [ ] Form validates max length
- [ ] Send button submits reply
- [ ] Success toast appears
- [ ] Returns to message list after success
- [ ] Error toast appears on failure
- [ ] Can retry failed reply

---

## WORK ITEM 3: READ INBOX CACHING

### Problem Statement

**Current State**: Read inbox fetches messages every time, no caching

**Impact**: Slower experience, repeated API calls

**Solution**: Mirror the 5-minute Cache implementation from assign-videoteam-inbox.tsx

### Implementation

**File**: `src/read-videoteam-inbox.tsx`

#### Step 3.1: Add Cache Import

Find the imports section and add:

```typescript
// BEFORE:
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';

// AFTER:
import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  useNavigation,
  Cache,  // ADD THIS
} from '@raycast/api';
```

#### Step 3.2: Initialize Cache in Component

Find where state is declared (around line with `useState`):

```typescript
export default function ReadVideoTeamInbox() {
  const [messages, setMessages] = useState<NPIDInboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ADD AFTER useState declarations:
  const cache = new Cache();
```

#### Step 3.3: Replace loadInboxMessages Function

Find the current `loadInboxMessages` function and replace it:

```typescript
// BEFORE:
const loadInboxMessages = async () => {
  try {
    setIsLoading(true);
    // ... fetch logic
  } finally {
    setIsLoading(false);
  }
};

// AFTER:
const loadInboxMessages = async () => {
  try {
    setIsLoading(true);

    // Check cache first (5 minute TTL)
    const cached = cache.get('read_inbox_threads');
    const cacheTime = cache.get('read_inbox_threads_time');
    const now = Date.now();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    if (cached && cacheTime && (now - parseInt(cacheTime)) < CACHE_TTL) {
      const threads = JSON.parse(cached) as NPIDInboxMessage[];
      setMessages(threads);
      setIsLoading(false);
      await showToast({
        style: Toast.Style.Success,
        title: `Loaded ${threads.length} cached messages`,
        message: 'From cache (refresh in settings)',
      });
      return;
    }

    // Fetch assigned threads (adjust filter as needed)
    const threads = await fetchInboxThreads(50, 'assigned');

    // Update cache
    cache.set('read_inbox_threads', JSON.stringify(threads));
    cache.set('read_inbox_threads_time', now.toString());

    await showToast({
      style: threads.length > 0 ? Toast.Style.Success : Toast.Style.Failure,
      title: `Loaded ${threads.length} messages`,
      message: threads.length === 0 ? 'No assigned messages' : 'Ready to read and reply',
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
```

### Implementation Checklist

- [ ] Add Cache import
- [ ] Initialize cache instance
- [ ] Replace loadInboxMessages with caching version
- [ ] Test first load (shows "Loaded X messages")
- [ ] Test second load within 5 min (shows "Loaded X cached messages")
- [ ] Test load after 5 min (fetches fresh data)
- [ ] Verify cache timeout works correctly

### Testing Checklist

- [ ] First open: Fetches from API, shows normal message
- [ ] Immediate reopen: Shows cached message
- [ ] After 5 mins: Fetches fresh data
- [ ] Cache correctly prevents repeated API calls
- [ ] Toast message indicates cache vs. fresh fetch

---

## IMPLEMENTATION TIMELINE

### Day 1 (Oct 24) - TODAY
- [ ] **Complete Work Item 1** (Contact Search - 2-4 hrs)
  - [ ] Add logging throughout contact flow
  - [ ] Test all three paths (athlete, parent, fallback)
  - [ ] Identify and document any issues
  - [ ] Implement fix if needed

**Target**: Finish by end of day with contact search verified/fixed

### Day 2 (Oct 25)
- [ ] **Complete Work Item 2** (Reply - 4-6 hrs)
  - [ ] Research NPID reply endpoint (browser DevTools)
  - [ ] Implement Python method
  - [ ] Add TypeScript wrapper
  - [ ] Create ReplyForm component
  - [ ] Integrate into both inbox commands
  - [ ] Test all reply paths

**Target**: Finish by end of day with reply fully functional

### Day 3 (Oct 26)
- [ ] **Complete Work Item 3** (Caching - 1-2 hrs)
  - [ ] Mirror implementation from assign inbox
  - [ ] Test cache behavior
  - [ ] Verify TTL works correctly

**Target**: Finish by midday, leaving buffer for testing and fixes

### Final (Oct 26-27)
- [ ] **Integration Testing**: All features together
- [ ] **Bug Fixes**: Address any issues found
- [ ] **Final Testing**: End-to-end verification
- [ ] **SHIP!** 🚀

---

## TESTING STRATEGY

### Unit Testing (Per Feature)

**Contact Search**:
- [ ] Athlete email found
- [ ] Parent email found
- [ ] No match uses fallback
- [ ] Assignment sends correct contact

**Reply**:
- [ ] Form opens correctly
- [ ] Validates non-empty message
- [ ] Validates max length
- [ ] Sends successfully
- [ ] Error handling works

**Caching**:
- [ ] First load fetches API
- [ ] Second load uses cache
- [ ] Cache expires after 5 min
- [ ] No repeated API calls within TTL

### Integration Testing

- [ ] Assign inbox: Assign message with reply capability
- [ ] Read inbox: Reply with caching enabled
- [ ] Complete workflow: Search → Assign → Reply → View

### Edge Cases

- [ ] Network error during assignment
- [ ] Network error during reply
- [ ] Empty message reply (validation)
- [ ] Cache corruption/parsing error
- [ ] Multiple rapid opens (concurrent requests)

---

## SUCCESS CRITERIA

### Must Have ✅
- Contact search persists through assignment
- Users can reply from both inbox commands
- Read inbox has 5-minute caching
- All tests pass
- No breaking changes

### Should Have (Nice to Have) 📦
- Reply form has character counter
- Cache shows time remaining
- Better error messages

### Won't Have (Post-Ship) ❌
- Bulk replies
- Reply templates
- Cache warming on app start

---

## ROLLBACK PLAN

If any feature breaks during implementation:

1. **Contact Search Fix**: Keep all debugging logs, revert to 10/12 commit (7087c62) if unfixable
2. **Reply**: Don't add actions if not complete - users still have TODO message
3. **Caching**: Don't merge if breaks existing behavior - fallback to original fetch

---

## CRITICAL NOTES

⚠️ **Contact Search**: Must investigate root cause before final ship. If unfixable, document the limitation.

⚠️ **Reply Endpoint**: Requires browser research - don't guess the API endpoint. Use DevTools Network tab.

⚠️ **3-Day Deadline**: No scope creep. These three items only. Everything ships together.

⚠️ **Testing**: Test each feature thoroughly before considering done.

---

## FILES TO MODIFY

1. `src/assign-videoteam-inbox.tsx` - Contact debugging + optional reply
2. `src/read-videoteam-inbox.tsx` - Reply UI + Caching
3. `src/python/npid_api_client.py` - Add send_reply_to_message
4. `src/lib/npid-mcp-adapter.ts` - Add sendReplyToMessage wrapper
5. `src/components/ReplyForm.tsx` - NEW component for reply form
6. (Optional) `src/types/video-team.ts` - If new types needed

---

## SUCCESS CHECKLIST (Final)

Before shipping on 10/27:

- [ ] Contact search verified working (athlete + parent + fallback)
- [ ] Reply functionality tested (both inbox commands)
- [ ] Read inbox caching tested (5-min TTL works)
- [ ] All existing features still work
- [ ] Console logs cleaned up (or on main branch for debugging)
- [ ] No TypeScript errors
- [ ] No runtime errors
- [ ] End-to-end workflow tested
- [ ] Ready to ship 🚀
