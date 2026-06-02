# Scout Prep Supabase Source Of Truth

This file pins which workflow owns each Supabase write so lifecycle logic does not drift back into script-local helpers.

FastAPI remains a source-system adapter; Supabase remains durable reporting truth. Domain modules define lifecycle and sales-stage meaning. Prospect Web/Vercel may read Supabase reporting truth, but it must not own lifecycle or sales-stage meaning.

## Primary write path

| Workflow | Source action | Laravel/FastAPI write | Supabase write | Notes |
| --- | --- | --- | --- | --- |
| Scout Prep post-call action | Raycast Scout Prep | Task/stage update route succeeds first | `lifecycleSalesStage` | This is the primary lifecycle/sales-stage writer for Raycast-owned actions. |
| Scout Prep meeting set | Raycast Scout Prep | Meeting creation and sales stage save succeed first | `recordMeetingSet` / lifecycle mutation plus `set_meeting_confirmation_cache` | Confirmation cache is required for Prospect Mobile confirmation prep actions and must write both confirmation rows. |
| Confirmation texts | Raycast View Set Meetings / Head Scout Schedules | Calendar title prefix update | Confirmation cache and event title state | Confirmation cache is not lifecycle truth. |
| Pending Clients | Current pipeline state | Reads current sales stage and athlete event list | Reads Supabase pipeline/lifecycle state | It must not read confirmation cache. |

## Meeting Time Mutation Rights

Meeting time means one thing across the system: the appointment start/end instant for the client meeting. Supabase stores that instant as UTC ISO. UI surfaces render that instant in the client/resolved meeting timezone.

| Field meaning | Canonical durable field | Support copies | Allowed writers | Not allowed |
| --- | --- | --- | --- | --- |
| Meeting start instant | `appointments.starts_at` | `set_meeting_confirmation_cache.meeting_starts_at`, `pending_client_watchlist.event_start`, `call_log.booked_event_starts_at` | Raycast action-time meeting set/reschedule writers and explicit human-approved repair | Sales-stage reconciler, post-meeting watcher, Call Tracker reporting repair |
| Meeting end instant | derived one-hour end or stored support end | `set_meeting_confirmation_cache.meeting_ends_at`, `pending_client_watchlist.event_end`, `call_log.booked_event_ends_at` | Same writer that owns the corresponding start instant | Sales-stage reconciler, post-meeting watcher, Call Tracker reporting repair |
| Meeting timezone | `appointments.meeting_timezone` / `meeting_timezone_label` | confirmation-message support rows and contact cache fallback evidence | Raycast meeting set/reschedule writer, explicit timezone repair from confirmed source evidence | Post-meeting outcome logic |

Rules:

- A post-meeting watcher may update appointment `status`, `post_meeting_result`, and `status_reason`; it may not update `starts_at`.
- A reporting writer may copy already-confirmed meeting start/end into `call_log`; it may not invent or normalize appointment time truth.
- `set_meeting_confirmation_cache` is not lifecycle truth, but for same-appointment-id repair it is valid evidence for the confirmed meeting start/end because Prospect Mobile confirmation prep uses it.
- The hourly cron must not run broad booked-meeting backfills that overwrite appointment time from Laravel local calendar strings.
- `pending_client_watchlist.event_start` and `event_end` are timestamp instants, not display strings. If a source adapter returns a legacy no-offset head-scout meeting stamp, normalize it as Eastern meeting-local time before writing Supabase.
- `call_log.event_at` and `reporting_at` for post-meeting outcome facts are the meeting event instant. `occurred_at` may record when the cron or payment evidence observed the outcome, but UI/reporting must not use detection time as meeting time.

## Reconcile and audit path

Reconcile scripts exist for state that did not originate from a Raycast action-time write:

- manual Laravel sales stage changes
- calendar title or event-list changes
- event description details
- commission updates
- historical repair or backfill

These scripts may write Supabase only through canonical writer paths, but they are audit/reconcile/repair jobs, not the primary Scout Prep writer.

## Script roles

| Script | Role |
| --- | --- |
| `scripts/reconcile-current-sales-stages-to-supabase.mjs` | Audit/reconcile current Laravel/calendar state into Supabase. |
| `scripts/sync-current-pipeline-to-supabase.mjs` | Audit/reconcile current pipeline drift and external/manual state. |
| `scripts/sync-booked-meetings-to-supabase.mjs` | Manual audit/repair for booked meeting facts and external calendar state. It is not part of the hourly cron because appointment time mutation needs confirmed evidence. |
| `scripts/sync-commissions-to-supabase.mjs` | Audit/reconcile commission rows. |
| `scripts/backsync-lifecycle-call-activity-events.mjs` | Legacy repair only. |
| `scripts/materialize-call-tracker-data-contract.mjs` | Legacy/static browser contract materialization only. |

## Clean-house target

See `docs/architecture/supabase-clean-house-truth-map.md` for the repo-owned delete and migration map.

- `lifecycleSalesStage` is the one lifecycle/sales-stage writer.
- `lifecycle_events` is the only lifecycle/sales-stage history table.
- `appointments` owns meeting timing/detail/reschedule chain.
- `call_log` is the centralized table for call, meeting-set, post-meeting, and enrollment payment reporting facts. Its schema, backfill, shared writers, Prospect Web readers, and old source-table purge are live.
- `call_events` is a deprecated compatibility/history name. Current schema history still recreates it as a view over `meeting_events`; do not move readers there or reuse it as the canonical target.
- `athlete_lifecycle_current`, `athlete_lifecycle_timeline`, `active_athlete_meeting_truth`, `athlete_pipeline_state`, `call_tracker_*`, `weekly_operator_funnel_metrics`, `meeting_truth_anomalies`, `meeting_events`, `call_activity_events`, and `reminders` have been purged as views/tables where they existed live.

## Rules

- Do not add new script-local lifecycle translation helpers.
- Use `src/domain/supabase-lifecycle-translator.ts` for event prefix, CRM stage, task status, appointment status, and post-meeting outcome translation.
- Use `src/lib/supabase-lifecycle.ts` for Raycast action-time Supabase writes.
- Treat confirmation cache as confirmation-message support only.
- For successful Raycast Meeting Set submits, write exactly two confirmation cache rows (`confirmation_1` and `confirmation_2`) or fail loudly with the missing source field.
- If a required stage, event title, or athlete event-list fact is missing, fix the source-domain write or reconcile path. Do not add broad fallback guesses.
