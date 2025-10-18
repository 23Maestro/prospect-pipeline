# Video Team Workflow Skill

Manage athlete video editing workflow for Prospect ID video team.

## Context
- **Client**: Prospect ID (Client 2)
- **Workflow**: Video progress tracking and athlete communications
- **Team**: Video editors managing athlete highlight videos

## Workflow Stages

### 1. Inbox Management
Athletes/parents email requests → Unassigned inbox → Assign to video editor

```python
# Get unassigned threads
threads = client.get_inbox_threads(limit=15, filter_assigned='unassigned')

# Assign to video team
payload = {
    'messageId': thread['id'],
    'contactId': athlete['contactId'],
    'athleteMainId': athlete['athleteMainId'],
    'ownerId': '1408164',  # Jerami Singleton
    'stage': 'In Queue',
    'status': 'New Request',
    'formToken': csrf_token
}
client.assign_thread(payload)
```

### 2. Video Progress Tracking
Track athletes through editing pipeline: New → In Progress → Revisions → Complete

**Stages:**
- In Queue
- Editing In Progress
- Waiting on Footage
- Complete

**Statuses:**
- New Request
- In Progress
- Revisions
- Editing Complete
- On Hold

### 3. Email Communications
Send status updates to athletes at key milestones

**Common Templates:**
- "Video Instructions" - Initial request received
- "Your Video Editing is Underway" - Started editing
- "Editing Done: Video Editing Complete" - Finished
- "Revisions" - Requesting changes
- "Uploading Video Directions to Dropbox" - Upload instructions

```python
# Send email to athlete
client.send_email_to_athlete(
    athlete_name="John Doe",
    template_name="Editing Done: Video Editing Complete"
)
```

## Raycast Commands

### Assign Video Team Inbox
**Purpose**: Assign unassigned inbox messages to video editors
**Flow**:
1. Fetch unassigned threads (max 15)
2. Select thread to assign
3. Auto-detect athlete/parent contact
4. Choose owner, stage, status
5. Submit assignment

**Key Features:**
- Auto-contact detection (athlete vs parent)
- Recommended stage/status based on history
- Attachment download support
- Real-time inbox refresh

### Email Student Athletes
**Purpose**: Send templated emails to athletes
**Flow**:
1. Enter athlete name
2. Select email template from dropdown
3. System searches video progress workflow
4. Finds athlete and sends email

**Available Templates:**
- Editing Done
- Video Instructions
- Hudl Login Request
- Uploading Video Directions to Dropbox
- Your Video Editing is Underway
- Editing Done: Ad Removed
- Video Guidelines
- Revisions

### Read Video Team Inbox
**Purpose**: View and manage inbox messages
**Features**:
- View message content
- Download attachments
- Quick assign from message view
- Search by subject/contact

## Data Model

### Athlete Record
```typescript
{
  id: number,
  athlete_id: number,
  athletename: string,
  grad_year: number,
  sport_name: string,
  high_school: string,
  high_school_city: string,
  high_school_state: string,
  stage: string,
  video_progress_status: string,
  assignedvideoeditor: string,
  video_due_date: string
}
```

### Inbox Thread
```typescript
{
  id: string,
  message_id: string,
  contact_id: string,
  athleteMainId: string,
  name: string,
  email: string,
  subject: string,
  content: string,
  timestamp: string,
  can_assign: boolean,
  attachments: Attachment[]
}
```

## Best Practices

1. **Always use video progress search** - Athletes may not be in main player database
2. **Search by first + last name** - Split full name for API calls
3. **Sender is always Video Team** - Use `videoteam@prospectid.com`
4. **Limit inbox queries** - Max 15 threads to avoid performance issues
5. **Mark tasks complete** - Update status after email sent
6. **Handle parents separately** - Contact type detection is important

## Common Operations

### Search for Athlete in Workflow
```python
data = {
    '_token': csrf_token,
    'first_name': 'John',
    'last_name': 'Doe'
}
athletes = session.post(
    'https://dashboard.nationalpid.com/videoteammsg/videoprogress',
    data=data
).json()
```

### Get Recommended Assignment
```python
defaults = client.get_assignment_defaults(contact_id)
# Returns: {'stage': 'In Queue', 'status': 'New Request'}
```

### Update Video Status
Used when video editing progresses through pipeline stages.

## Integration Points

- **Notion**: Task tracking database
- **Supabase**: Data storage
- **NPID Dashboard**: Source of truth for athlete data
- **Email**: Gmail/SMTP for notifications
