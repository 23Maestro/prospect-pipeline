-- Remove old patch-era outcome rows that were superseded by a stronger row for
-- the same athlete and outcome. Example: Zyon had a null-title/null-revenue
-- legacy close_won row plus the real ENR $99 appointment row.

with classified as (
  select
    id,
    athlete_key,
    raw_event_type,
    appointment_id,
    live_event_id,
    booked_event_title,
    revenue_cents,
    created_at,
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
      when lower(coalesce(raw_crm_stage, '')) like '%no show%'
        or lower(coalesce(booked_event_title, '')) like '(ns)%' then 'no_show'
      else null
    end as outcome
  from call_events
),
superseded as (
  select weak.id
  from classified weak
  where weak.raw_event_type = 'sales_stage_reconciled'
    and weak.outcome is not null
    and nullif(weak.live_event_id, '') is null
    and nullif(weak.booked_event_title, '') is null
    and weak.revenue_cents is null
    and exists (
      select 1
      from classified strong
      where strong.id <> weak.id
        and strong.athlete_key = weak.athlete_key
        and strong.outcome = weak.outcome
        and (
          nullif(strong.live_event_id, '') is not null
          or nullif(strong.booked_event_title, '') is not null
          or strong.revenue_cents is not null
        )
    )
)
delete from call_events ce
using superseded
where ce.id = superseded.id;
