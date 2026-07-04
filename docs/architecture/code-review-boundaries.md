# Code Review Boundaries
This repo is a Prospect ID workflow extension. Code review should protect behavior and data meaning before style.
## Must Not Break
- Laravel / Prospect ID executes real website state changes.
- Raycast is the operator UI.
- FastAPI is the legacy Laravel adapter.
- Supabase is extension persistence and reporting.
- Vercel / Next.js is the web adapter.
- Domain modules define ownership, operator context, athlete identity, task meaning, meeting meaning, outreach wording, materialization, and reporting meaning.
## Honest Reporting Gate
`npm test` is the local deterministic report gate. It runs existing tests and writes `.tmp/honest-test-report.json`.

During review, agents must not turn a failed report into a new fix unless the user explicitly asks for implementation. Report the failing suite, the suspected boundary, and the missing proof.

`npm test` must not run sync, repair, backfill write mode, live API mutation, Laravel mutation, Supabase mutation, or deployment commands. Live readback remains a separate manual proof step and must be named separately from local test proof.
## Adapter Rules
Adapters may fetch, translate, render, proxy, and persist.
Adapters must not redefine:
- owner identity
- active operator
- task meaning
- meeting meaning
- outreach wording
- materialization status
- Call Tracker counting rules
## Laravel Boundary
Preserve these field names exactly when crossing into FastAPI/Laravel:
- `assigned_owner`
- `assigned_to`
- `meeting_for`
- `meetingfor`
- `calendar_owner_id`
- `head_scout`
- `scouting_coordinator`
Do not rename these to prettier internal names at the adapter boundary.
## Owner Boundary
`config/prospect-id-owners.json` is the shared owner source of truth.
Flag hardcoded owner values outside config, tests, or intentional message copy:
- `Primary Operator`
- `100001`
- head scout calendar owner IDs
- meeting_for IDs
- assigned_to IDs
Secondary Operator is a known owner profile, not the active dashboard operator.
## Supabase Boundary
Supabase rows should carry proof.
- `source_owner` and `owner_proof` are persistence compatibility outputs.
- Domain code should prefer `resolvedOwnerName`, `ownerProof`, `resolvedFromField`, `taskAssignedOwner`, and `materializationStatus`.
- `athlete_pipeline_state` is a snapshot, not a dashboard fact.
- `lifecycle_events` is audit/history. Do not count it wholesale.
- `call_activity_events` is daily dial/contact activity.
- `meeting_events` is post-meeting outcomes.
- Materialized `meeting_set` lifecycle rows can count only with active-operator proof.
## Call Tracker Counting
Do not use `activity_kind` alone for dashboard counts.
Top-line reporting must use:
- `counts_as_dial`
- `counts_as_contact`
- `counts_as_meeting_set`
- `counts_as_post_meeting_outcome`
Locked rules:
- Left Voice Mail 1/2 and Never Spoke To = dial only.
- Called - Unable to Leave VM = dial only.
- Spoke/contact statuses = dial + contact.
- Meeting Set = dial + contact + meeting_set.
- Closed Won, Closed Lost, RSP, No Show, Canceled = post-meeting outcomes only.
## Raycast Boundary
Raycast files should render UI and execute actions.
They should call domain modules for:
- task selection
- contact selection
- message context
- post-call planning
- Set Meetings candidate shaping
- outreach time wording
- materialization checks
## FastAPI Boundary
FastAPI adapts legacy Laravel behavior.
It should:
- preserve field names
- parse HTML/JSON safely
- use shared owner config
- avoid owning domain meaning
- avoid materializing ownership from calendar/head_scout alone
## Vercel Boundary
Vercel / Next.js is the web adapter.
It should:
- serve pages
- call server routes
- read Supabase safely
- proxy FastAPI safely
It should not:
- expose service role keys
- expose internal FastAPI/Tailscale secrets
- recompute ownership/materialization in browser code
- invent its own Call Tracker counting rules
