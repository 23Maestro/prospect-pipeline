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
| `scripts/sync-booked-meetings-to-supabase.mjs` | Audit/reconcile booked meeting facts and external calendar state. |
| `scripts/sync-commissions-to-supabase.mjs` | Audit/reconcile commission rows. |
| `scripts/backsync-lifecycle-call-activity-events.mjs` | Legacy repair only. |
| `scripts/materialize-call-tracker-data-contract.mjs` | Legacy/static browser contract materialization only. |

## Clean-house target

See `docs/architecture/supabase-clean-house-truth-map.md` for the repo-owned delete and migration map.

- `lifecycleSalesStage` is the one lifecycle/sales-stage writer.
- `lifecycle_events` is the only lifecycle/sales-stage history table.
- `appointments` owns meeting timing/detail/reschedule chain.
- `call_log` is the centralized table for call, meeting-set, post-meeting, and enrollment payment reporting facts. Its schema, backfill, shared writers, and Prospect Web readers are live.
- `call_events` is a deprecated compatibility/history name. Current schema history still recreates it as a view over `meeting_events`; do not move readers there or reuse it as the canonical target.
- `athlete_lifecycle_current`, `athlete_lifecycle_timeline`, `active_athlete_meeting_truth`, `athlete_pipeline_state`, `meeting_events`, `call_activity_events`, `call_tracker_*`, `weekly_operator_funnel_metrics`, `meeting_truth_anomalies`, and `reminders` are migration/delete targets.

## Rules

- Do not add new script-local lifecycle translation helpers.
- Use `src/domain/supabase-lifecycle-translator.ts` for event prefix, CRM stage, task status, appointment status, and post-meeting outcome translation.
- Use `src/lib/supabase-lifecycle.ts` for Raycast action-time Supabase writes.
- Treat confirmation cache as confirmation-message support only.
- For successful Raycast Meeting Set submits, write exactly two confirmation cache rows (`confirmation_1` and `confirmation_2`) or fail loudly with the missing source field.
- If a required stage, event title, or athlete event-list fact is missing, fix the source-domain write or reconcile path. Do not add broad fallback guesses.
