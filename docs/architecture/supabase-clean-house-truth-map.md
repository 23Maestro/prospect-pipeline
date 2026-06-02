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
| `call_log` | Reporting / Pre-Meeting Tasks / Enrollments & Outcomes | Canonical target | One event ledger for dials, contacts, meeting sets, post-meeting outcomes, and enrollment payment evidence. The schema, first Call Tracker backfill, shared writers, and Prospect Web readers are live. This intentionally avoids the old `call_events` compatibility-view history. |
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

`call_log` is the target name for the centralized event ledger. `20260602090000_call_log_canonical_ledger.sql` defines the schema, the first Call Tracker backfill has been applied, shared writers now route reporting facts to `call_log`, and Prospect Web reads `call_log` directly. `20260602113000_purge_call_tracker_compatibility_views.sql` drops the old Call Tracker compatibility views. The old `call_events` name is intentionally retired because the current migration history includes `20260503044000_rename_call_events_to_meeting_events.sql`, which renamed the old table to `meeting_events` and recreated `call_events` as a deprecated compatibility view.

Completed in this Call Tracker slice:

1. Backfilled `call_log` from `call_activity_events`, `meeting_events`, and lifecycle meeting-set facts without deleting old rows.
2. Kept `source_family` to the canonical drained fact families only: `call_activity_events`, `lifecycle_events`, or `meeting_events`; raw upstream labels such as `legacy_sales_stage_current` or `stripe_commissions` stay in `source_system` or payload fields.
3. Proved live target parity with `node scripts/audit-call-tracker-live-parity.mjs --summary`: parity true over 723 canonical rows, closed-won 6.
4. Moved shared call activity, meeting-set reporting copy, post-meeting outcome, and Stripe/commission payment evidence writers into `call_log`.
5. Moved Prospect Web Call Tracker and meeting readback readers to direct `call_log` reads.
6. Added purge migrations for `weekly_operator_funnel_metrics`, `call_tracker_summary`, `call_tracker_events_owner_context`, `call_tracker_events_deduped`, `call_tracker_events`, `call_tracker_meeting_sets`, and `call_events`.

Remaining broader cleanup:

1. `call_activity_events` and `meeting_events` are still historical source tables and repair-script references. Drop them only after the next delete gate proves no repair/audit workflow needs them.
2. Prospect Web meeting readback now reads `appointments` plus `lifecycle_events` directly. Do not purge `active_athlete_meeting_truth` or `athlete_lifecycle_timeline` yet: `scripts/audit-meeting-readback-live-parity.mjs` currently reports live old-vs-new parity false, so those gaps must be reviewed before deletion.
3. Keep using `scripts/audit-call-tracker-live-parity.mjs --summary` after purging Call Tracker views; it now falls back to `call_log` when compatibility views are gone.

## Repeatable Refactor Playbook

Use this same loop for the remaining Linear cleanup tasks so each Supabase refactor is predictable:

1. Read the bucket map and name the owner before editing.
2. Use `supabase migration list` to compare local migrations against live Supabase before assuming a table/view exists.
3. Add or extend one repo-owned audit/parity script for the surface; do not create a second truth path.
4. Generate a dry-run projection first, then make the script report both projected rows and insertable rows.
5. Mirror every database constraint in the dry-run insertability gate. Row-count parity is not enough; the first `call_log` backfill attempt proved a projection can match dashboard totals while still violating `call_log_count_shape_check`.
6. Preserve raw provenance in `source_system` or payload fields. Keep canonical family/status fields constrained to the clean vocabulary.
7. Apply schema migrations before data backfills, then immediately rerun the parity script against the live target table.
8. Move compatibility readers only after target parity is true.
9. Move writers after readers have a stable canonical surface.
10. Delete old surfaces only after active repo references are gone and the Linear issue has the proof run attached.

Known quirks from the first `call_log` run:

- Supabase schema cache may show a missing table until the migration is actually pushed; local migration files alone are not proof.
- Supabase CLI can mutate `.temp` metadata such as `supabase/.temp/cli-latest`; do not include that churn in cleanup commits.
- Compatibility projections may include non-insertable rows that exist only to preserve legacy UI behavior. Keep those visible in the audit as skipped rows instead of forcing them into the canonical table.
- For Call Tracker, `callLogProjection.parity` proves old reporting counts still match; `callLogTarget.parity` proves the new canonical table is actually populated and ready for readers.
