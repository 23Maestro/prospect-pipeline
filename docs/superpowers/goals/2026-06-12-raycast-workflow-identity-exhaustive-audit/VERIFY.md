# Verification

## Read-Only Inputs

- `AGENTS.md`
- `docs/architecture/scouting-coordinator-system-map.md`
- `docs/architecture/scout-prep-supabase-source-of-truth.md`
- `src/scout-prep.tsx`
- `src/head-scout-schedules.tsx`
- `src/client-message-inbox.tsx`
- `src/view-set-meetings.tsx`
- `src/domain/post-call-action.ts`
- `src/lib/scout-prep-task-completion.ts`
- `src/lib/client-message-export.ts`
- `src/lib/client-message-sandbox.ts`
- `src/lib/pending-client-watchlist.ts`
- `src/lib/supabase-lifecycle.ts`

## Commands Run

```sh
wc -l src/scout-prep.tsx src/head-scout-schedules.tsx src/client-message-inbox.tsx src/view-set-meetings.tsx
rg -n "athlete_id|athleteId|athlete_main_id|athleteMainId|contact_id|contactId|appointmentId|event_id|eventId|open_event_id|previous_event_id|previous_appointment_id|task_id|taskId|crmStage|stageLabel|record[A-Z]|updateSalesStage|completeScoutPrepTaskAfterVoicemail|addAthleteNote|markPendingClientResolved|createReminder|createCalFollowUpBooking|createAppleCalendarFollowUpEvent" src/scout-prep.tsx src/head-scout-schedules.tsx src/client-message-inbox.tsx src/view-set-meetings.tsx
rg -n "Action\.|ActionPanel\.Section|title=\"|navigationTitle=\"" src/scout-prep.tsx src/head-scout-schedules.tsx src/client-message-inbox.tsx src/view-set-meetings.tsx
rg -n "function completeScoutPrepTaskAfterVoicemail|completeScoutPrepTaskAfterVoicemail|recordVoicemailFollowUpSent|buildPostCallActionPlan|resolveConfirmationCleanupPlanFromTask|markPendingClientResolved|PendingClient|source_event_id|clientMatch|crmStage|currentTaskTitle|taskStatus" src/lib src/domain src/scout-prep.tsx src/head-scout-schedules.tsx src/client-message-inbox.tsx
git status --short --branch
node scripts/audit-raycast-workflow-identity-contract.mjs --json
node --test scripts/audit-raycast-workflow-identity-contract.test.mjs
npx tsx --test src/domain/sales-stage-contract.test.ts
npx tsx --test src/lib/student-athlete-message-resolver.test.ts
npx tsx --test src/lib/supabase-lifecycle.test.ts
npm run build
git diff --check
npm test
```

## Current Contract Coverage

The Raycast workflow identity audit contract currently covers:

- Meetings: confirmed reschedule previous appointment identity.
- Meetings: Meeting Set appointment identity through `buildPostCallActionPlan`.
- Pre-Meeting Tasks: Post-Call Update task completion through `buildPostCallActionPlan`.
- Admin Data & Contacts: Scout Prep contact-cache sync through `syncAthleteContactCacheFromScoutPrepContext`.
- Meetings: Head Scout confirmation appointment identity from booked meeting event identity.
- Client Communication: Client Messages export preserves canonical `currentTaskId`.
- Admin Data & Contacts: contact-cache Client Messages admission reads and exposes lifecycle `current_task_id`.
- Client Communication and Pre-Meeting Tasks: Client Messages send completion passes `currentTaskId` to task completion.
- Meetings, Enrollments & Outcomes, Lifecycle & Stage Truth: Head Scout prefix-to-stage mapping uses `postCallStageForAppointmentTitlePrefix`.
- Lifecycle & Stage Truth and Pre-Meeting Tasks: Scout Prep batch stage completion stays routed through `buildPostCallActionPlan`.
- Enrollments & Outcomes: Pending Client removal uses the watchlist `source_event_id` helper path and forbids treating that source event id as a Laravel task completion id.

## Gaps Closed

- Client Messages task completion now carries canonical `currentTaskId` from lifecycle/contact-cache/export/sandbox surfaces into `completeScoutPrepTaskAfterVoicemail`.
- Head Scout `(RSP)/(CAN)` prefix handling now resolves post-call stage through the lifecycle/stage domain helper instead of inline UI mapping.
- Scout Prep batch stage completion is now represented in the audit contract.
- Pending Client source-event identity is now guarded as watchlist/source-event support identity and is not allowed as a Laravel task completion id.

## Verification Status

Complete for the scoped Raycast Scout Prep / Set Meetings / Client Messages identity audit. The contract now covers all six Scouting Coordinator buckets where durable identity can drift, and the focused plus broad proof gates passed locally.
