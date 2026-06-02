# Supabase Clean-House Truth Map

This is the deletion and migration map for Prospect Pipeline Supabase cleanup.

The operating rule:

> Sales stage is truth. `lifecycleSalesStage` is the one repo-owned writer that turns sales stage into lifecycle state. Appointments attach meeting timing and detail. `call_log` attaches reporting facts.

FastAPI remains the source-system adapter for Prospect Pipeline data access. Supabase remains durable persistence. Domain modules define lifecycle, appointment, and reporting meaning; Prospect Web readers only display or aggregate those domain-owned facts.

## Canonical End State

| Surface | Bucket | Role | Plain English |
| --- | --- | --- | --- |
| `athletes` | Admin Data & Contacts | Canonical truth | Who the athlete is. |
| `athlete_contact_cache` | Admin Data & Contacts / Client Communication | Canonical support | How to contact the athlete/family and open admin/task links. |
| `appointments` | Meetings | Canonical truth | Meeting timing, scout, timezone, event id, and reschedule chain. |
| `lifecycle_events` | Lifecycle & Stage Truth | Canonical truth | Sales-stage history and normalized lifecycle state through `lifecycleSalesStage`. |
| `call_log` | Reporting / Pre-Meeting Tasks / Enrollments & Outcomes | Canonical target | Future one event table for dials, contacts, meeting sets, and post-meeting outcomes. This intentionally avoids the old `call_events` compatibility-view history. |
| `set_meeting_confirmation_cache` | Client Communication | Temporary support | Confirmation-message prep only; not lifecycle or meeting truth. |
| `pending_client_watchlist` | Enrollments & Outcomes | Temporary support | Review queue only; not final outcome truth. |

## Delete Targets

These surfaces must not be treated as durable truth. Freeze writes, migrate readers, prove parity, then drop.

| Surface | Bucket | Current problem | Replacement |
| --- | --- | --- | --- |
| `athlete_lifecycle_current` | Lifecycle & Stage Truth | Persists a second current state. | Latest state from `lifecycle_events`. |
| `athlete_lifecycle_timeline` | Lifecycle & Stage Truth | Persists a second lifecycle history shape. | Query/derive from `lifecycle_events`. |
| `active_athlete_meeting_truth` | Meetings | Masks appointment truth as another current-meeting source. | `appointments` plus latest lifecycle state. |
| `athlete_pipeline_state` | Lifecycle & Stage Truth | Competes with lifecycle current and sales stage. | `lifecycle_events` latest state. |
| `meeting_events` | Enrollments & Outcomes | Splits post-meeting outcomes away from one event table. | Canonical `call_log`. |
| `call_events` | Reporting / Compatibility | Deprecated compatibility view name with confusing table history. | Canonical `call_log`; keep only as temporary alias if required during migration. |
| `call_activity_events` | Pre-Meeting Tasks | Splits call activity away from one event table. | Canonical `call_log`. |
| `call_tracker_events` | Reporting | Reporting projection with table-like name. | API/query over canonical `call_log`. |
| `call_tracker_events_deduped` | Reporting | Hides source duplication after the fact. | Fix canonical facts before reporting. |
| `call_tracker_events_owner_context` | Reporting | Reporting projection with owner context. | API/query over canonical `call_log`. |
| `call_tracker_meeting_sets` | Reporting | Meeting-set reporting-only projection. | API/query over canonical `call_log`. |
| `call_tracker_summary` | Reporting | Summary projection with truth-like name. | API aggregate over canonical `call_log`. |
| `weekly_operator_funnel_metrics` | Reporting | Metrics projection with truth-like name. | API aggregate over canonical `call_log`. |
| `meeting_truth_anomalies` | Meetings / Audit | Audit table/view can be mistaken for facts. | Code-owned audit only; no Supabase fact source. |
| `reminders` | Client Communication | Overlaps confirmation cache. | `set_meeting_confirmation_cache` or a future single message table. |

## Writer Rules

- `lifecycleSalesStage` is the only allowed lifecycle/sales-stage writer.
- Direct writes to `lifecycle_events` are allowed only inside `src/lib/supabase-lifecycle.ts` and explicitly approved repair/audit scripts.
- No writer may use deleted projection tables as source truth.
- `appointments` owns timing/detail only and may not override sales-stage meaning.
- Post-meeting outcome facts must be derived from sales stage and attached to an appointment when one exists.
- Reconciler scripts are audit/repair only. They may call canonical writers, but may not invent truth from stale projection rows or stale event titles.

## Migration Gate

Before dropping a surface:

1. List every reader and writer.
2. Assign each reader/writer to a Scouting Coordinator bucket.
3. Move writers to `lifecycleSalesStage`, `appointments`, or canonical `call_log`.
4. Move readers to canonical helpers/API aggregation.
5. Run old-vs-new parity for counts and latest-state readback.
6. Confirm the table/view has zero active repo references.
7. Drop only after the above is true.

## Call Log Readiness

`call_log` is the target name for the future centralized event table. The old `call_events` name is intentionally retired because the current migration history includes `20260503044000_rename_call_events_to_meeting_events.sql`, which renames the old table to `meeting_events` and recreates `call_events` as a deprecated compatibility view.

That means the next Call Tracker migration is not "read `call_events` directly." The next migration is:

1. Define the canonical `call_log` row shape for dials, contacts, meeting sets, and post-meeting outcomes.
2. Move `call_activity_events` writers into that canonical shape.
3. Move `meeting_events` post-meeting outcome writers into that canonical shape.
4. Move meeting-set facts from lifecycle-derived reporting into that canonical shape.
5. Prove `call_tracker_summary` and `call_tracker_events_owner_context` parity against `call_log`.
6. Only then move Prospect Web readers off the compatibility views.
