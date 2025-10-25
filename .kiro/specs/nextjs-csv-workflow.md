# Next.js CSV Workflow Specification
**Phase 3 - Post-Ship Planning**
**Status**: Research & Design Phase

---

## OVERVIEW

Replace Notion task board with custom Next.js Kanban dashboard that:
1. **Import CSV exports** from Notion
2. **Display Kanban board** for video editing workflow
3. **Sync with Raycast extension** for task updates
4. **Manage athlete profiles** and project metadata

---

## BUSINESS CONTEXT

### Current State
- **Task Management**: Notion database with video editing tasks
- **Statuses**: Revise, HUDL, Dropbox, Not Approved, Uploads, Done
- **Workflow**: Manual status updates, no Kanban visualization
- **Integration**: Raycast reads from Notion API

### Desired State
- **Custom Dashboard**: Next.js Kanban board (own infrastructure)
- **CSV Import**: One-way import from Notion exports
- **Live Updates**: Reflect changes from Raycast extension
- **Better UX**: Drag-drop board, athlete profiles, video previews
- **Data Independence**: Own database, not dependent on Notion subscription

### Timeline
- **Phase 1** (Ship by 10/27): Contact search, Reply, Caching
- **Phase 2** (Target ~11/15): YouTube API integration
- **Phase 3** (Target ~12/01): Next.js CSV workflow

---

## REQUIREMENTS

### Functional Requirements

**FR1: CSV Import**
- Parse Notion CSV export format
- Map CSV columns to database schema
- Validate data (required fields, format)
- Create/update athlete records
- Handle duplicate detection

**FR2: Kanban Board**
- Display tasks in columns by status
- Show task cards with athlete info, due date, video type
- Color-code by priority or stage
- Filter by sport, due date, assigned to
- Search by athlete name, player ID

**FR3: Athlete Profiles**
- Display athlete details (name, sport, grad year, position)
- Show all videos assigned to athlete
- Show assignment history
- Link to NPID profile

**FR4: Sync with Raycast**
- Read tasks from database
- Update task status from Raycast
- Reflect changes in real-time
- Bidirectional data flow

**FR5: Video Management**
- Display video type per task
- Show upload status
- Embed video preview (if uploaded)
- Track video update history

### Non-Functional Requirements

**NF1: Performance**
- Dashboard loads <2 seconds
- Kanban board smooth drag-drop
- CSV import handles 500+ records
- Real-time updates with <500ms latency

**NF2: Reliability**
- No data loss on import
- Graceful error handling
- Transaction support for updates
- Backup/recovery capability

**NF3: Scalability**
- Support multiple users (if needed)
- Handle multiple sports
- Extensible for future features

**NF4: Security**
- Secure database access
- Row-level security (if multi-tenant)
- Audit logging for task updates

---

## DESIGN DECISIONS TO MAKE

### 1. Data Storage

**Option A: Supabase PostgreSQL** (Recommended)
- Existing infrastructure
- Built-in RLS for security
- Real-time subscriptions available
- Cost: Minimal (already in use)

**Option B: Cloud Firestore**
- Real-time updates out of box
- NoSQL structure
- Cost: $1-2/month for this volume

**Option C: Local SQLite**
- No server dependency
- Simple setup
- Downside: Not shareable across users

**Decision**: Use **Supabase** (existing infrastructure, real-time capable)

### 2. CSV Import Strategy

**Option A: One-way Import (Recommended)**
- Import from Notion CSV file
- Store in Supabase
- Updates happen only via import
- Pros: Simple, no sync conflicts
- Cons: Need to re-import for updates

**Option B: Continuous Sync**
- Monitor Notion database for changes
- Sync to Supabase automatically
- Pros: Always up-to-date
- Cons: Complex, requires Notion API polling

**Option C: Manual + Auto Sync**
- Manual import via UI button
- Auto-sync for critical fields
- Pros: Flexible, manageable complexity
- Cons: Hybrid approach

**Decision**: Start with **One-way Import** (Option A)

### 3. CSV Format

**Expected Notion Export Format**:
```
Name,Status,PlayerID,Sport,GradYear,Position,DueDate,VideoType,AssignedTo,Notes
John Smith,Revise,12345,Football,2024,QB,2025-10-30,Full Season Highlight,Jane Editor,Needs cuts
Sarah Johnson,HUDL,12346,Basketball,2025,C,2025-11-05,Skills Video,Bob Editor,Waiting for footage
```

**Mapping to Database**:
```
CSV Column → Database Field
Name → athlete_name
Status → task_status (enum: Revise, HUDL, Dropbox, Not Approved, Uploads, Done)
PlayerID → player_id (links to athlete)
Sport → sport
GradYear → grad_year
Position → position
DueDate → due_date
VideoType → video_type (enum: Full Season, Partial Season, Single Game, Skills/Training)
AssignedTo → assigned_editor
Notes → notes
```

**Questions**:
- Is this the standard Notion export format?
- Are there additional columns needed?
- How are custom fields handled?

**Decision Point**: Confirm CSV format before implementation.

### 4. Import Frequency

**Option A: Manual Import**
- User uploads CSV file via UI
- One-time import per workflow
- Pros: Complete control, no automation
- Cons: Manual process, risk of stale data

**Option B: Scheduled Import**
- Auto-import from S3/Google Drive
- Daily or weekly schedule
- Pros: Keeps data fresh
- Cons: Requires file storage setup

**Option C: Watch Folder**
- Monitor local folder for CSV files
- Import when new file detected
- Pros: User-friendly, automatic
- Cons: Requires local folder access

**Decision**: Start with **Manual Import** (Option A), upgrade to scheduled if needed

### 5. Kanban Board UI/UX

**Column Structure**:
```
Revise | HUDL | Dropbox | Not Approved | Uploads | Done
  ↓      ↓       ↓         ↓              ↓        ↓
 [Card] [Card] [Card]   [Card]        [Card]   [Card]
 [Card] [Card] [Card]   [Card]        [Card]   [Card]
 [Card] [Card] [Card]   [Card]        [Card]   [Card]
```

**Card Display**:
```
┌─────────────────────┐
│ John Smith - QB     │
│ Football • 2024     │
│ Full Season Hlgt    │
│ Due: Oct 30         │
│ Assigned: Jane      │
│ [Video Preview]     │
└─────────────────────┘
```

**Interactions**:
- Drag-drop cards between columns
- Click card to see details
- Filter by sport, editor
- Search by name
- Sort by due date

**Question**: Should drag-drop update Raycast immediately?

**Decision Point**: Define UX interactions before implementation.

### 6. Sync Mechanism

**Option A: Polling**
- Dashboard polls Supabase every 5 seconds
- Raycast updates trigger Supabase write
- Pros: Simple, no websocket
- Cons: Slight latency, constant polling

**Option B: Real-time Subscriptions**
- Supabase real-time connections
- Instant updates on changes
- Pros: No latency, efficient
- Cons: Requires websocket, more complex

**Option C: WebSocket (Custom)**
- Custom WebSocket server
- Bidirectional real-time sync
- Pros: Full control
- Cons: Server maintenance, complexity

**Decision**: Use **Supabase Real-time Subscriptions** (built-in, scalable)

---

## ARCHITECTURE

### System Overview

```
┌────────────────────────────────────────────────────────┐
│              Next.js Dashboard (Port 3000)             │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Kanban Board                                     │ │
│  │ - Display tasks in columns                       │ │
│  │ - Drag-drop card movements                       │ │
│  │ - Filter and search                              │ │
│  │ - Real-time updates from Supabase               │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Import Page                                      │ │
│  │ - Upload CSV file from Notion                    │ │
│  │ - Validate and preview data                      │ │
│  │ - Map columns to database fields                 │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Athlete Profiles                                 │ │
│  │ - Show athlete details                           │ │
│  │ - Video history and updates                      │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
        ↓             ↓
    Supabase      YouTube API
    Database      (Video embeds)
        │
        ↑
┌──────────────────────────────────────────────────────┐
│           Raycast Extension                         │
│  - Read tasks from Supabase                         │
│  - Update task status                               │
│  - Real-time sync via Supabase subscriptions        │
└──────────────────────────────────────────────────────┘
```

### Database Schema

**Core Tables**:

```sql
-- Athletes
CREATE TABLE athletes (
  id UUID PRIMARY KEY,
  player_id TEXT UNIQUE,
  name TEXT NOT NULL,
  sport TEXT,
  grad_year INTEGER,
  position TEXT,
  high_school TEXT,
  state TEXT,
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Video Tasks
CREATE TABLE video_tasks (
  id UUID PRIMARY KEY,
  athlete_id UUID REFERENCES athletes(id),
  status TEXT NOT NULL, -- Revise, HUDL, Dropbox, Not Approved, Uploads, Done
  video_type TEXT, -- Full Season, Partial Season, Single Game, Skills/Training
  due_date DATE,
  assigned_editor TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Video Uploads
CREATE TABLE video_uploads (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES video_tasks(id),
  youtube_url TEXT,
  youtube_video_id TEXT,
  upload_status TEXT, -- pending, uploading, success, failed
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Import History
CREATE TABLE import_history (
  id UUID PRIMARY KEY,
  import_date TIMESTAMP DEFAULT NOW(),
  filename TEXT,
  records_imported INTEGER,
  records_updated INTEGER,
  records_failed INTEGER,
  status TEXT, -- success, partial_success, failed
  error_message TEXT
);
```

**Relationships**:
```
athletes (1) ← → (N) video_tasks
video_tasks (1) ← → (1) video_uploads
```

### API Endpoints (Next.js Backend)

**Athletes**:
- `GET /api/athletes` - List all athletes
- `GET /api/athletes/:id` - Get athlete details
- `POST /api/athletes` - Create athlete
- `PUT /api/athletes/:id` - Update athlete

**Video Tasks**:
- `GET /api/tasks` - List all tasks (with filters)
- `GET /api/tasks/:id` - Get task details
- `PUT /api/tasks/:id` - Update task (status change)
- `DELETE /api/tasks/:id` - Delete task

**Imports**:
- `POST /api/import/csv` - Upload and import CSV
- `GET /api/import/history` - View import history
- `GET /api/import/preview` - Preview CSV before import

**Search & Filter**:
- `GET /api/search?q=Smith` - Search by name
- `GET /api/tasks?sport=Football&status=Revise` - Filter tasks

---

## DATA FLOW

### Import Flow

```
1. User uploads Notion CSV
   ↓
2. Server validates CSV format
   - Check required columns
   - Validate data types
   - Check for duplicates
   ↓
3. Server maps CSV to database schema
   - Parse athlete data
   - Parse task data
   - Create relationships
   ↓
4. Server performs import
   - Upsert athletes (by player_id)
   - Create/update tasks
   - Log import results
   ↓
5. Dashboard updates (real-time)
   - Supabase publishes changes
   - Next.js dashboard refreshes
   - Raycast syncs via subscription
   ↓
6. User sees updated Kanban board
```

### Task Update Flow

```
1. User drags card in Kanban board
   ↓
2. Dashboard sends PUT request
   - `/api/tasks/:id` with new status
   ↓
3. Server updates Supabase
   - Updates task status
   - Records updated_at timestamp
   ↓
4. Supabase publishes change (real-time)
   - Next.js dashboard updates
   - Raycast extension notified
   ↓
5. Raycast Extension updates locally
   - Reflects new status
   - Shows toast notification
   ↓
6. All systems in sync
```

### Raycast Sync Flow

```
1. User updates task in Raycast
   (e.g., "Mark as Done")
   ↓
2. Raycast calls Python API
   - `update_video_progress_stage`
   ↓
3. Python API updates Supabase
   - Task status changes
   ↓
4. Supabase publishes via real-time
   ↓
5. Next.js dashboard updates
   - Card moves to new column
   - Real-time visual update
   ↓
6. All systems in sync
```

---

## IMPLEMENTATION PLAN (High-level)

### Phase 3A: Setup & Design (Effort: 3-4 days)

1. **Database Schema**
   - Create Supabase tables
   - Set up relationships and indexes
   - Configure RLS (if needed)

2. **Project Setup**
   - Initialize Next.js project
   - Install dependencies (React, Tailwind, Supabase client)
   - Configure environment variables
   - Set up folder structure

3. **Backend API**
   - Implement API endpoints
   - Add validation and error handling
   - Test with Postman

### Phase 3B: Import Functionality (Effort: 2-3 days)

1. **CSV Parsing**
   - Implement CSV reader
   - Map columns to schema
   - Validate data

2. **Import Logic**
   - Upsert athletes
   - Create/update tasks
   - Handle duplicates
   - Log import results

3. **Import UI**
   - Upload form
   - Preview table
   - Progress indicator
   - Success/error messages

### Phase 3C: Kanban Board (Effort: 4-5 days)

1. **Component Structure**
   - Board layout (columns)
   - Card component
   - Drag-drop library (react-beautiful-dnd or dnd-kit)

2. **Features**
   - Display tasks in columns
   - Drag-drop between columns
   - Filter by sport/editor
   - Search by name
   - Sort by due date

3. **Real-time Updates**
   - Supabase subscriptions
   - Update card when status changes
   - Optimistic UI updates

### Phase 3D: Athlete Profiles (Effort: 2-3 days)

1. **Profile Page**
   - Athlete details
   - Video history
   - Current tasks
   - Stats/achievements

2. **Connections**
   - Link to NPID profile
   - Show YouTube videos (if available)
   - Display athlete timeline

### Phase 3E: Raycast Integration (Effort: 2-3 days)

1. **Update Raycast Commands**
   - Fetch from Supabase instead of Notion
   - Update task status in Supabase
   - Subscribe to real-time changes

2. **Sync Logic**
   - Handle conflicts
   - Offline queue (if needed)
   - Error recovery

3. **Testing**
   - Test Raycast ↔ Dashboard sync
   - Test real-time updates
   - Test offline behavior

### Phase 3F: Testing & Deployment (Effort: 3-4 days)

1. **Unit Testing**
   - CSV parsing tests
   - Validation tests
   - API tests

2. **Integration Testing**
   - End-to-end import
   - Kanban board interactions
   - Raycast sync

3. **Deployment**
   - Deploy to production
   - Set up CI/CD
   - Monitor performance

**Total Effort**: ~16-22 days

---

## TECH STACK

**Frontend** (Next.js):
- **Framework**: Next.js 14+ (React 18)
- **UI Components**: Shadcn/ui or Material-UI
- **Styling**: Tailwind CSS
- **Drag-Drop**: react-beautiful-dnd or dnd-kit
- **State Management**: React Query / TanStack Query
- **Real-time**: Supabase real-time client

**Backend** (Next.js API Routes):
- **Framework**: Next.js API routes
- **Database**: Supabase PostgreSQL
- **CSV Parsing**: `papaparse` or `csv-parser`
- **Validation**: `zod` or `yup`

**Integration**:
- **Supabase Client**: `@supabase/supabase-js`
- **Real-time**: Supabase real-time subscriptions
- **API Communication**: `axios` or `fetch`

---

## FOLDER STRUCTURE

```
prospect-id-tasks/  (existing Next.js project)
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── board/
│   │   │   └── page.tsx           # Kanban board
│   │   ├── import/
│   │   │   └── page.tsx           # CSV import
│   │   ├── athletes/
│   │   │   ├── page.tsx           # Athletes list
│   │   │   └── [id]/
│   │   │       └── page.tsx       # Athlete profile
│   │   └── api/
│   │       ├── athletes/
│   │       │   ├── route.ts       # GET/POST athletes
│   │       │   └── [id]/route.ts  # PUT/DELETE athlete
│   │       ├── tasks/
│   │       │   ├── route.ts       # GET tasks
│   │       │   └── [id]/route.ts  # PUT task
│   │       └── import/
│   │           └── csv/route.ts   # POST CSV import
│   ├── components/
│   │   ├── KanbanBoard.tsx
│   │   ├── TaskCard.tsx
│   │   ├── ImportForm.tsx
│   │   ├── AthleteProfile.tsx
│   │   └── common/
│   ├── lib/
│   │   ├── supabase.ts            # Supabase client
│   │   ├── csv-parser.ts          # CSV utilities
│   │   └── hooks/
│   │       ├── useTasksQuery.ts   # React Query hooks
│   │       └── useRealtimeSync.ts
│   └── types/
│       └── index.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## QUESTIONS FOR CLARIFICATION

Before implementation, answer:

1. **CSV Format**: What is the exact Notion CSV export format?
   - Column names: _______________
   - Data types: _______________
   - Sample file available?

2. **Import Frequency**: Manual or automatic?
   - Manual (user uploads): Yes/No
   - Scheduled (auto-import from file): Yes/No
   - Watch folder: Yes/No

3. **Kanban Interaction**: Should drag-drop update immediately?
   - Update to Supabase: Yes/No
   - Update Raycast: Yes/No
   - Show confirmation dialog: Yes/No

4. **Real-time Sync**: How important is real-time?
   - Must have: Instant updates
   - Nice to have: Updates within seconds
   - Not needed: Can refresh manually

5. **Multi-user**: Will multiple people use dashboard?
   - Single user: Just you
   - Small team: 2-5 people
   - Large team: 5+ people

6. **Historical Data**: Keep old imports?
   - Delete and replace: Each import overwrites
   - Archive: Keep history of all imports
   - Merge: Update existing, add new

7. **Video Integration**: Should videos appear on dashboard?
   - Yes: Embed YouTube previews
   - No: Just show metadata/links
   - Later: Phase 4 feature

---

## RISKS & MITIGATION

| Risk | Impact | Mitigation |
|------|--------|-----------|
| CSV format changes | Import breaks | Validate format, provide error messages |
| Data conflicts on sync | Data loss | Implement versioning, conflict resolution |
| Real-time sync lag | Confusing UX | Implement optimistic updates |
| Large CSV imports slow | Bad UX | Pagination, background job queue |
| Notion dependency still exists | Still need Notion | Provide fallback import format |
| Raycast↔Dashboard desync | Conflicting data | Implement last-write-wins or conflict resolution |

---

## SUCCESS CRITERIA

### Phase 3A (Setup & Design)
- ✅ Database schema created
- ✅ Next.js project initialized
- ✅ API endpoints defined
- ✅ Environment configured

### Phase 3B (Import)
- ✅ CSV parser working
- ✅ Validation and preview working
- ✅ Import creates athletes and tasks
- ✅ Duplicate handling working

### Phase 3C (Kanban Board)
- ✅ Board displays all tasks
- ✅ Drag-drop works smoothly
- ✅ Status updates persist
- ✅ Filters and search working
- ✅ Real-time updates from Supabase

### Phase 3D (Athlete Profiles)
- ✅ Profiles display athlete details
- ✅ Video history visible
- ✅ Links to NPID work

### Phase 3E (Raycast Integration)
- ✅ Raycast reads from Supabase
- ✅ Task updates sync to dashboard
- ✅ Dashboard updates sync to Raycast
- ✅ Real-time subscriptions working

### Phase 3F (Testing & Deployment)
- ✅ All tests passing
- ✅ Deployed to production
- ✅ No Notion dependency (can work standalone)
- ✅ Performance acceptable

---

## MIGRATION PATH

### Step 1: Run Parallel
- Keep Notion as source of truth
- Import CSV weekly to Next.js
- Use Next.js for viewing/organizing
- Update both Notion and Supabase

### Step 2: Dashboard Primary
- Use Next.js dashboard as primary
- Update Raycast to use Supabase
- Keep Notion as backup
- Maintain weekly exports

### Step 3: Full Migration
- Abandon Notion entirely
- Next.js + Supabase as primary
- Raycast fully integrated
- CSV exports for backup

---

## FUTURE ENHANCEMENTS (Not in Scope)

- Multi-user with team management
- Role-based access control
- Custom workflows per sport
- Advanced analytics and reporting
- Mobile app for athletes
- Automated email notifications
- Slack integration
- Calendar view

---

## NEXT STEPS

1. **Answer clarification questions** above
2. **Confirm CSV format** from Notion
3. **Finalize database schema**
4. **Set up Next.js project**
5. **Begin Phase 3A implementation**

---

## REFERENCES

- Next.js: https://nextjs.org/docs
- Supabase: https://supabase.com/docs
- React Query: https://tanstack.com/query/latest
- Drag-Drop: https://github.com/atlassian/react-beautiful-dnd
- CSV Parsing: https://www.papaparse.com/
