-- Post-meeting outcomes are one canonical fact per athlete, appointment, and result.
-- Sales-stage/event-title evidence may create the fact first; paid commission evidence
-- can later enrich the same close_won fact with revenue instead of adding another win.

with normalized as (
  select
    id,
    concat_ws(
      ':',
      'post_meeting_outcome',
      athlete_key,
      coalesce(
        nullif(live_event_id, ''),
        nullif(appointment_id, ''),
        nullif(lower(booked_event_title), ''),
        occurred_at::date::text,
        id::text
      ),
      case
        when lower(coalesce(raw_crm_stage, '')) like '%close won%'
          or lower(coalesce(raw_crm_stage, '')) like '%closed won%'
          or lower(coalesce(booked_event_title, '')) like '(enr%' then 'closed_won'
        when lower(coalesce(raw_crm_stage, '')) like '%close lost%'
          or lower(coalesce(raw_crm_stage, '')) like '%closed lost%'
          or lower(coalesce(booked_event_title, '')) like '(cl)%' then 'closed_lost'
        when lower(coalesce(raw_crm_stage, '')) like '%res.%pending%'
          or lower(coalesce(raw_crm_stage, '')) like '%reschedule%pending%'
          or lower(coalesce(booked_event_title, '')) like '(rsp)%' then 'reschedule_pending'
        when lower(coalesce(raw_crm_stage, '')) = 'rescheduled'
          or lower(coalesce(raw_crm_stage, '')) like '%result%rescheduled%' then 'rescheduled'
        when lower(coalesce(raw_crm_stage, '')) like '%canceled%'
          or lower(coalesce(booked_event_title, '')) like '(can)%' then 'canceled'
        when lower(coalesce(raw_crm_stage, '')) like '%no show%'
          or lower(coalesce(booked_event_title, '')) like '(ns)%' then 'no_show'
        when lower(coalesce(raw_crm_stage, '')) like 'spoke to%'
          or lower(coalesce(raw_crm_stage, '')) like '%follow up%'
          or lower(coalesce(booked_event_title, '')) like '(fu)%' then 'spoke_follow_up'
        else coalesce(nullif(raw_task_status, ''), 'needs_review')
      end
    ) as canonical_dedupe_key
  from call_events
  where raw_event_type = 'post_meeting_outcome'
),
ranked as (
  select
    ce.id,
    normalized.canonical_dedupe_key,
    row_number() over (
      partition by normalized.canonical_dedupe_key
      order by
        (ce.revenue_cents is not null) desc,
        (ce.source = 'stripe_commissions') desc,
        (ce.booked_event_title is not null) desc,
        (ce.live_event_id is not null) desc,
        ce.created_at desc,
        ce.id desc
    ) as row_rank
  from call_events ce
  join normalized on normalized.id = ce.id
)
delete from call_events ce
using ranked
where ce.id = ranked.id
  and ranked.row_rank > 1;

with normalized as (
  select
    id,
    concat_ws(
      ':',
      'post_meeting_outcome',
      athlete_key,
      coalesce(
        nullif(live_event_id, ''),
        nullif(appointment_id, ''),
        nullif(lower(booked_event_title), ''),
        occurred_at::date::text,
        id::text
      ),
      case
        when lower(coalesce(raw_crm_stage, '')) like '%close won%'
          or lower(coalesce(raw_crm_stage, '')) like '%closed won%'
          or lower(coalesce(booked_event_title, '')) like '(enr%' then 'closed_won'
        when lower(coalesce(raw_crm_stage, '')) like '%close lost%'
          or lower(coalesce(raw_crm_stage, '')) like '%closed lost%'
          or lower(coalesce(booked_event_title, '')) like '(cl)%' then 'closed_lost'
        when lower(coalesce(raw_crm_stage, '')) like '%res.%pending%'
          or lower(coalesce(raw_crm_stage, '')) like '%reschedule%pending%'
          or lower(coalesce(booked_event_title, '')) like '(rsp)%' then 'reschedule_pending'
        when lower(coalesce(raw_crm_stage, '')) = 'rescheduled'
          or lower(coalesce(raw_crm_stage, '')) like '%result%rescheduled%' then 'rescheduled'
        when lower(coalesce(raw_crm_stage, '')) like '%canceled%'
          or lower(coalesce(booked_event_title, '')) like '(can)%' then 'canceled'
        when lower(coalesce(raw_crm_stage, '')) like '%no show%'
          or lower(coalesce(booked_event_title, '')) like '(ns)%' then 'no_show'
        when lower(coalesce(raw_crm_stage, '')) like 'spoke to%'
          or lower(coalesce(raw_crm_stage, '')) like '%follow up%'
          or lower(coalesce(booked_event_title, '')) like '(fu)%' then 'spoke_follow_up'
        else coalesce(nullif(raw_task_status, ''), 'needs_review')
      end
    ) as canonical_dedupe_key
  from call_events
  where raw_event_type = 'post_meeting_outcome'
)
update call_events ce
set dedupe_key = normalized.canonical_dedupe_key
from normalized
where ce.id = normalized.id
  and ce.dedupe_key is distinct from normalized.canonical_dedupe_key;

comment on column call_events.dedupe_key is
  'Canonical idempotency key. post_meeting_outcome rows dedupe by athlete, appointment/title, and outcome so commission revenue enriches the same win fact.';
