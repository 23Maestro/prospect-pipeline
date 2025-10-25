# MASTER IMPLEMENTATION PLAN
**Prospect Pipeline - Q4 2025 Roadmap**

**Timeline**: October 24-27, 2025 (Critical Ship Date)
**Status**: Planning Phase - Before Any Code Implementation

---

## EXECUTIVE SUMMARY

Three major initiatives requiring coordinated implementation:

1. **🚨 CRITICAL SHIP (by 10/27)**: Contact Search Fix + Reply Functionality + Caching
   - Contact search persistence through assignment workflow
   - Reply capability for both inbox commands
   - 5-minute caching for read inbox

2. **📦 YouTube API Integration** (Phase 2, Post-Ship)
   - Embed videos in Next.js dashboard
   - Auto-upload exported videos to prospect ID YouTube channel
   - Investigate costs and feasibility

3. **🎯 Next.js CSV Workflow** (Phase 2, Post-Ship)
   - Replace Notion with custom Kanban board
   - CSV import from Notion exports
   - Full integration with existing Raycast extension

---

## PHASE 1: CRITICAL SHIP BY 10/27

### Architecture Decisions Made Since REST API Launch (9/27/25)

**Timeline Context**:
- REST API launched: 9/27/25
- Multiple iterations since launch
- Current state: 5 working Raycast commands
- Issue: Contact search and reply functionality incomplete

**Key Technologies**:
- Raycast TypeScript frontend
- Python REST API client (BeautifulSoup4 for HTML parsing)
- NPID Dashboard REST endpoints (no Selenium anymore)
- Notion API for task sync
- Supabase for configuration

### Critical Work Items (3 Days)

#### Item 1: Contact Search Fix & Verification
**Status**: Potentially broken, needs debugging
**Impact**: Blocks assignment workflow reliability
**Time**: 2-4 hours

**Current State**:
- Contact search implemented on 10/12 (commit 7087c62)
- Parses HTML from `/template/calendaraccess/contactslist`
- Extracts athlete/parent data correctly
- **Issue**: Unclear if context persists through entire assignment modal

**Required Actions**:
1. Add logging throughout contact resolution flow (src/assign-videoteam-inbox.tsx:380-440)
2. Verify contacts are passed to AssignmentModal
3. Confirm contact selection persists through form submission
4. Test both athlete email and parent email paths
5. Implement fix if persistence broken

**Files Involved**:
- `src/assign-videoteam-inbox.tsx`
- `src/lib/npid-mcp-adapter.ts`
- `src/python/npid_api_client.py`

---

#### Item 2: Reply Functionality
**Status**: TODO in code, not implemented
**Impact**: Users must leave Raycast to reply
**Time**: 4-6 hours

**Current State**:
- `read-videoteam-inbox.tsx`: Has placeholder "Reply feature coming soon"
- `assign-videoteam-inbox.tsx`: No reply capability
- Python API: No `send_reply_to_message` method

**Required Actions**:
1. Research NPID Dashboard reply endpoint (use browser DevTools)
2. Implement `send_reply_to_message` in Python API
3. Add wrapper in TypeScript MCP adapter
4. Create ReplyForm component
5. Add reply actions to both inbox commands
6. Test send/receive flow

**Files to Create/Modify**:
- `src/python/npid_api_client.py` (add method)
- `src/lib/npid-mcp-adapter.ts` (add wrapper)
- `src/read-videoteam-inbox.tsx` (replace TODO)
- `src/assign-videoteam-inbox.tsx` (add reply action)
- (Optional) `src/components/ReplyForm.tsx` (new component)

---

#### Item 3: Read Inbox Caching
**Status**: Not implemented, needed for performance
**Impact**: Repeated API calls slow down experience
**Time**: 1-2 hours

**Current State**:
- `assign-videoteam-inbox.tsx`: Has 5-minute Cache (just implemented)
- `read-videoteam-inbox.tsx`: Fetches every time

**Required Actions**:
1. Mirror caching implementation from assign inbox
2. Add Cache import
3. Implement 5-minute TTL logic
4. Show "From cache" message
5. Test expiration and refresh

**Files to Modify**:
- `src/read-videoteam-inbox.tsx`

---

### Dependency Resolution

**Critical Path**:
1. **First**: Contact search fix (unblocks assignment workflow)
2. **Parallel**: Reply functionality (independent)
3. **Last**: Caching (polish/performance, least critical)

**External Research Needed**:
- NPID Dashboard reply endpoint (browser DevTools inspection required)

**No Blocking Dependencies**: All work is isolated per command

---

## PHASE 2: YOUTUBE API INTEGRATION (Post-Ship)

### Objectives
1. Embed videos in Next.js Kanban dashboard
2. Auto-upload exported videos to prospect ID YouTube channel
3. Investigate public YouTube API costs

### Architecture Questions
- **What needs embedding?** Prospect profiles with video galleries?
- **Upload source**: What folder/file format do editors export?
- **Frequency**: How often should auto-upload check?
- **Error handling**: Retry policy for failed uploads?

### Scope to Define
- YouTube API key cost (free tier vs. premium)
- Can one key cover both embedding + uploading?
- Rate limits on auto-upload
- Video metadata (title, description, tags)

### Expected Deliverables
- Comprehensive design document (in `.kiro/specs/youtube-api-integration.md`)
- Implementation plan with exact file changes
- Cost analysis and licensing decision

---

## PHASE 3: NEXT.JS CSV WORKFLOW (Post-Ship)

### Objectives
1. Replace Notion with custom Next.js Kanban board
2. Import CSV exports from Notion
3. Full sync with Raycast extension

### Architecture Questions
- **CSV Format**: What Notion export format? (default or custom mapping?)
- **Data Sync**: Which direction? (Next.js ← CSV, one-way or bidirectional?)
- **Raycast Integration**: How does Raycast talk to Next.js app?
- **Storage**: Database (Supabase) or local files?

### Scope to Define
- Database schema for prospects/athletes
- CSV parsing and validation logic
- Kanban board UI/UX
- Sync mechanism (webhooks, polling, manual import?)
- Search and filtering across imported data

### Expected Deliverables
- Comprehensive design document (in `.kiro/specs/nextjs-csv-workflow.md`)
- Database schema definition
- CSV import specification
- Implementation plan with exact file paths and code

---

## TIMELINE SUMMARY

| Phase | Items | Time | Deadline | Status |
|-------|-------|------|----------|--------|
| **1: Critical Ship** | Contact fix, Reply, Caching | 7-12 hrs | **10/27/25** | 🚨 IN PROGRESS |
| **2: YouTube API** | Research, Design, Plan | TBD | ~11/15 | 📋 Planning |
| **3: Next.js CSV** | Research, Design, Plan | TBD | ~12/01 | 📋 Planning |

---

## DECISION CHECKLIST BEFORE CODE

### Phase 1 (Critical Ship) - Decision Points

- [ ] Contact search issue reproduced and root cause identified
- [ ] NPID Dashboard reply endpoint researched and documented
- [ ] Reply implementation approach decided (HTTP POST parameters, etc.)
- [ ] Cache TTL confirmed (5 minutes matches assign inbox)

### Phase 2 (YouTube API) - Decision Points

- [ ] YouTube API tier decided (free/paid)
- [ ] Key cost estimate obtained
- [ ] Embedding use case clarified
- [ ] Upload source and format confirmed
- [ ] Auto-upload frequency decided

### Phase 3 (Next.js CSV) - Decision Points

- [ ] CSV source format confirmed (default Notion export)
- [ ] Data flow direction decided (one-way or bidirectional)
- [ ] Database schema drafted
- [ ] Raycast↔Next.js sync mechanism decided
- [ ] Import frequency and validation rules defined

---

## FILE ORGANIZATION FOR PLANNING

All implementation plans will be stored in `.kiro/specs/`:

```
.kiro/specs/
├── CRITICAL-SHIP-PLAN.md          # Phase 1: 10/27 deadline
├── youtube-api-integration.md      # Phase 2: Research + Design
└── nextjs-csv-workflow.md          # Phase 3: Research + Design
```

---

## NEXT STEPS

1. ✅ **This master plan** - Overview and dependencies
2. ✅ **Create detailed specs** for each phase (separate files)
3. ✅ **Research phase 2 & 3** - Define scope and decisions
4. 🚀 **Implement phase 1** - Contact fix ✅, Reply 🔄, Caching (by 10/27)
5. 🚀 **Ship phase 1**
6. 📦 **Plan and implement phases 2 & 3** - Post-ship roadmap

---

## SUCCESS CRITERIA

### Phase 1 (Ship by 10/27)
- ✅ Contact search works reliably (athlete + parent emails)
- ✅ Users can reply from both inbox commands
- ✅ Read inbox messages cached for 5 minutes
- ✅ All existing functionality intact
- ✅ No breaking changes
- ✅ Tested end-to-end

### Phase 2 (YouTube API)
- ✅ Design document approved
- ✅ Cost analysis complete
- ✅ Implementation plan with exact file paths
- ✅ API integration approach decided

### Phase 3 (Next.js CSV)
- ✅ Design document approved
- ✅ Database schema finalized
- ✅ CSV parsing logic specified
- ✅ Sync mechanism decided
- ✅ Implementation plan with exact code examples

---

## KEY ASSUMPTIONS

1. **Contact search fix**: Issue is in modal state management, not Python API
2. **Reply functionality**: NPID Dashboard has HTTP endpoint for replies (no websocket)
3. **YouTube API**: Has free tier or acceptable pricing
4. **Next.js workflow**: Can coexist with Raycast extension
5. **CSV import**: Notion default export format is suitable

---

## RISK MITIGATION

| Risk | Mitigation |
|------|-----------|
| Contact search unfixable | Fallback contact logic already exists |
| NPID no reply endpoint | Implement web redirect with prefilled message |
| YouTube API too expensive | Defer implementation or use alternative |
| CSV sync too complex | Start with one-way import, improve later |

---

## NOTES

- **REST API Learning**: Much learned since 9/27 REST API launch. Contact search and reply are the remaining pieces.
- **Multiple Iterations**: Project has gone through many changes. Plans should reflect current state accurately.
- **3-Day Deadline**: Phase 1 must ship by 10/27. No scope creep.
- **Future Flexibility**: Phases 2 & 3 can be reprioritized based on business needs post-ship.
