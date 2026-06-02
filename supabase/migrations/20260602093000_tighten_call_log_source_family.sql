-- Tighten call_log source_family after the first live projection proved the
-- distinction: source_family is the canonical drained fact family, while
-- source_system preserves raw provenance such as legacy_sales_stage_current or
-- stripe_commissions.

alter table public.call_log
  drop constraint if exists call_log_source_family_check;

alter table public.call_log
  add constraint call_log_source_family_check
  check (
    source_family in (
      'call_activity_events',
      'lifecycle_events',
      'meeting_events'
    )
  ) not valid;

comment on column public.call_log.source_family is
  'Canonical drained fact family: call_activity_events, lifecycle_events, or meeting_events. Raw systems such as legacy_sales_stage_current, stripe, or commissions belong in source_system or payload_json.';

comment on column public.call_log.source_system is
  'Raw upstream/provenance label, such as legacy_sales_stage_current, scout_prep_action, stripe_commissions, or manual_repair. This is not the canonical source family.';
