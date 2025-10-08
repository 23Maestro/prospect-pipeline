# Supabase Caching Implementation for NPID Inbox

## Context
- **Current State**: Direct Python Playwright scraping on every load (15 seconds)
- **Problem**: Too slow for good UX, users want instant inbox loading
- **Root Cause**: Removed Supabase previously because scraper wasn't working (selectors were wrong)
- **Now**: Scraper works correctly (fixed `.tit_line1` subject extraction, plus icon selector, etc.)
- **Solution**: Restore Supabase as cache layer with 90-minute background sync

## Architecture (Hybrid - Option 3)
```
┌─────────────────┐     90 min cron      ┌──────────────┐
│ Python Scraper  │ ──────────────────→ │   Supabase   │
│ (Playwright)    │   fills inbox table  │   (Cache)    │
└─────────────────┘                      └──────────────┘
                                                ↓
                                         instant read (<1s)
                                                ↓
                                         ┌──────────────┐
                                         │   Raycast    │
                                         │  Extension   │
                                         └──────────────┘
                                                ↓
                                         assignment action
                                                ↓
                                         ┌──────────────┐
                                         │ Python Live  │
                                         │ (Modal/Form) │
                                         └──────────────┘
```

## Implementation Tasks

- [ ] 1. Create Supabase schema for inbox threads
  - Design `npid_inbox_threads` table with proper columns
  - Add indexes for fast queries (email, timestamp, status)
  - Include `can_assign`, `status`, `subject`, `preview`, etc
  - Set up RLS policies if needed
  - _Requirements: Fast read access, proper data types_

- [ ] 2. Update Python scraper to write to Supabase
- [ ] 2.1 Add Supabase client to Python scraper
  - Install supabase-py package in venv
  - Configure Supabase URL and anon key from env
  - Create upsert logic for inbox threads
  - Handle connection errors gracefully
  - _Requirements: Reliable data sync_

- [ ] 2.2 Implement batch upsert logic
  - Scrape threads as currently working
  - Batch upsert to Supabase (not one-by-one)
  - Handle duplicates (upsert by thread_id)
  - Log sync status and errors
  - _Requirements: Efficient bulk operations_

- [ ] 3. Set up 90-minute cron job
  - Create standalone Python script for cron execution
  - Add error handling and retry logic
  - Set up cron schedule (*/90 * * * *)
  - Add logging to track sync runs
  - Handle timezone considerations
  - _Requirements: Reliable background sync_

- [ ] 4. Update Raycast extension to read from Supabase
- [ ] 4.1 Restore Supabase queries in inbox commands
  - Update `loadInboxMessages()` to query Supabase
  - Filter by `can_assign = true` for assign command
  - Filter by `status = 'assigned'` for read command
  - Remove direct Python calls for inbox loading
  - _Requirements: Fast UI load times_

- [ ] 4.2 Add fallback and refresh logic
  - Show cached data immediately
  - Add manual "Refresh from NPID" action
  - Handle empty cache gracefully
  - Display last sync timestamp
  - _Requirements: User awareness of data freshness_

- [ ] 5. Keep Python direct calls for assignments
  - Verify `fetchAssignmentModal()` still calls Python
  - Verify `assignVideoTeamMessage()` still calls Python
  - Ensure modal data is fetched fresh for each assignment
  - No changes needed here (keep as-is)
  - _Requirements: Real-time assignment actions_

- [ ] 6. Test and validate complete flow
  - Test inbox load speed (<2 seconds)
  - Verify assignment modal still works
  - Confirm 90-minute sync updates data
  - Test with stale cache vs fresh sync
  - Validate data consistency
  - _Requirements: All functionality working correctly_

## Success Criteria
- ✅ Inbox loads in <2 seconds (vs current 15 seconds)
- ✅ Assignment modal opens with live data
- ✅ Cron job runs reliably every 90 minutes
- ✅ Data stays fresh enough for workflow
- ✅ Users can force refresh if needed

## Technical Notes
- **Supabase Table**: Use UUID for primary key, index on `thread_id` (NPID message ID)
- **Cron Location**: Run on user's local machine or server (not Raycast)
- **Error Handling**: Log failures but don't break UI if Supabase unreachable
- **Data Retention**: Keep threads for 7-30 days, auto-cleanup old data

## References
- Web search confirms Supabase as cache layer is standard pattern
- React Query/SWR can add client-side caching on top if needed later
- 90-minute intervals are reasonable for this use case

