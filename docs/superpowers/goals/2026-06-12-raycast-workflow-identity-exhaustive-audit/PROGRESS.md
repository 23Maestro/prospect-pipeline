# Progress

## 2026-06-12

### Completed

- Re-read repository and Supabase source-of-truth guardrails.
- Confirmed the Scouting Coordinator system map has six buckets, not five.
- Inventoried identity-bearing Raycast command surfaces in:
  - `src/scout-prep.tsx`
  - `src/head-scout-schedules.tsx`
  - `src/client-message-inbox.tsx`
  - `src/view-set-meetings.tsx`
- Classified support-only payloads separately from durable truth writes.
- Verified the previous confirmed-reschedule fix uses the Meetings-owned appointment identity resolver.
- Expanded the audit script beyond the initial confirmed-reschedule slice to cover all durable drift points found in the Raycast workflow inventory.
- Carried `currentTaskId` through Client Messages export, contact-cache admission, message resolution, sandbox matching, and send completion.
- Moved Head Scout `(RSP)/(CAN)` prefix-to-stage meaning into `src/domain/sales-stage-contract.ts`.
- Added audit contracts for Client Messages task identity, Head Scout prefix outcome mapping, batch stage completion, and Pending Client source-event identity.

### Inventory Summary

| Surface | Bucket | Identity | Status |
| --- | --- | --- | --- |
| Scout Prep Post-Call Update, Meeting Set | Meetings, Lifecycle & Stage Truth, Pre-Meeting Tasks | `open_event_id`, `appointmentId`, `sourceEventId`, task completion | Covered by existing audit contract. |
| Scout Prep Post-Call Update, confirmed reschedule | Meetings | `previous_event_id`, `previous_appointment_id` | Covered by existing audit contract. |
| Scout Prep Post-Call Update, task completion | Pre-Meeting Tasks, Lifecycle & Stage Truth | `task_id`, `crmStage` | Covered by existing audit contract via `buildPostCallActionPlan`. |
| Scout Prep contact-cache sync | Admin Data & Contacts | `athlete_id`, `athlete_main_id`, `contact_id` | Covered by existing audit contract through contact-cache helper. |
| Head Scout confirmation text/cache | Meetings, Client Communication | `event_id`, `appointment_id` | Covered by existing audit contract. |
| Head Scout booked meeting prefix update | Meetings | `event_id`, event date | Valid adapter mapping; update helper owns source-system write. |
| Head Scout `(RSP)/(CAN)` prefix to Post-Call stage | Meetings, Enrollments & Outcomes, Lifecycle & Stage Truth | prefix-derived stage | Closed: UI calls `postCallStageForAppointmentTitlePrefix`. |
| Pending Clients watchlist remove | Enrollments & Outcomes | `source_event_id` | Covered: helper-owned Supabase row patch guarded by audit contract. |
| Pending Client reschedule follow-up | Meetings, Client Communication, Enrollments & Outcomes | synthetic task from watchlist row | Covered: audit forbids using `source_event_id` as a Laravel task completion id. |
| Client Messages send follow-up | Client Communication, Pre-Meeting Tasks, Lifecycle & Stage Truth | `contactId`, `athleteMainId`, `currentTaskId`, task title, `crmStage` | Closed: completion now passes canonical `currentTaskId` when available. |
| Client Messages reschedule review | Client Communication, Meetings | appointment truth lookup for previous meeting, message send | Valid support mapping; task completion now inherits Client Messages `currentTaskId`. |
| Reminders, Cal follow-ups, Apple Calendar follow-ups | Pre-Meeting Tasks, Client Communication | `contactId`, `athleteMainId`, phone | Support payloads only; not Supabase durable truth. |
| Scout Prep batch stage completion | Lifecycle & Stage Truth, Pre-Meeting Tasks | stage, `task_id` | Covered: audit proves use of `buildPostCallActionPlan`. |
| Scout Prep confirmation cleanup batch | Meetings, Pre-Meeting Tasks | confirmation task/due date | Mostly helper-owned; support/action contract recommended. |
| Navigation/open/copy actions | Admin Data & Contacts or support-only | URL params, display IDs | Adapter/display mappings; no durable truth. |

### Current Answer

Yes, the scoped Raycast workflow identity audit is now complete across all six buckets. The previous confirmed-reschedule slice is still covered, and the broader drift risks found during exhaustive inventory now have runtime fixes and audit contracts.

### Implementation Completed

1. Client Messages task completion:
   - Carried `currentTaskId` through `PipelineClientExportRow`, `AthleteContactCacheClientMatch`, `StudentAthleteMessageResolution`, and `ClientDirectoryMatch`.
   - Passed `taskId: chat.clientMatch.currentTaskId || null` to `completeScoutPrepTaskAfterVoicemail`.
   - Added Raycast workflow identity audit contracts proving Client Messages preserves and uses the canonical task ID.

2. Head Scout prefix outcome mapping:
   - Moved `(RSP)/(CAN)` to stage mapping into `postCallStageForAppointmentTitlePrefix`.
   - Added an audit contract proving the UI uses the domain helper before pushing `PostCallUpdateForm`.

3. Batch stage completion:
   - Added audit coverage proving batch sales-stage completion stays routed through `buildPostCallActionPlan`.

4. Pending Client row identity:
   - Added a narrow contract that `markPendingClientResolved` receives the watchlist source-event identity and that synthetic pending-client source event IDs are not treated as durable Laravel task IDs.

### Proof

- `node scripts/audit-raycast-workflow-identity-contract.mjs --json` passed with no findings.
- `node --test scripts/audit-raycast-workflow-identity-contract.test.mjs` passed.
- `npx tsx --test src/domain/sales-stage-contract.test.ts` passed.
- `npx tsx --test src/lib/student-athlete-message-resolver.test.ts` passed.
- `npx tsx --test src/lib/supabase-lifecycle.test.ts` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npm test` passed and wrote `.tmp/honest-test-report.json`.

### Linear Recommendation

Create or update a follow-up Linear issue under the Prospect Pipeline source-of-truth work:

Title: `Exhaustive Raycast workflow identity coverage across Scouting Coordinator buckets`

Status:
- Linear `23M-52` created for this exhaustive audit.
- This receipt should be attached/updated with the implementation and proof summary.
