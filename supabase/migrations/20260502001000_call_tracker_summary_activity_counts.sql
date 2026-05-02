-- Surface dial/contact counters from the unified tracker event stream.
-- Meeting-set rows remain contact evidence, but call activity rows are first-class inputs.

create or replace view call_tracker_summary as
select
  count(*)::integer as total_events,
  count(*) filter (
    where tracker_outcome in (
      'spoke_follow_up',
      'meeting_set',
      'reschedule_pending',
      'rescheduled',
      'canceled',
      'closed_won',
      'closed_lost',
      'not_interested'
    )
  )::integer as spoke_with,
  count(*) filter (where tracker_outcome = 'voicemail')::integer as voicemail_only,
  count(*) filter (where tracker_outcome = 'meeting_set')::integer as meetings_set,
  count(*) filter (where tracker_outcome = 'reschedule_pending')::integer as reschedule_pending,
  count(*) filter (where tracker_outcome = 'closed_won')::integer as closed_won,
  coalesce(sum(revenue_cents) filter (where tracker_outcome = 'closed_won'), 0)::integer as money_earned_cents,
  min(occurred_at) as first_event_at,
  max(occurred_at) as last_event_at,
  count(distinct appointment_id) filter (where appointment_id is not null)::integer as appointments_tracked,
  count(*) filter (
    where tracker_outcome in (
      'meeting_set',
      'reschedule_pending',
      'rescheduled',
      'canceled',
      'closed_won',
      'closed_lost',
      'no_show',
      'spoke_follow_up'
    )
  )::integer as meeting_outcomes_total,
  count(*) filter (where tracker_outcome = 'rescheduled')::integer as rescheduled,
  count(*) filter (where tracker_outcome = 'canceled')::integer as canceled,
  count(*) filter (where tracker_outcome = 'no_show')::integer as no_show,
  count(*) filter (where tracker_outcome = 'needs_review')::integer as needs_review,
  count(*) filter (
    where raw_event_type = 'call_activity'
      and tracker_outcome in ('voicemail', 'spoke_follow_up')
  )::integer as dials,
  count(*) filter (
    where (
      raw_event_type = 'call_activity'
      and tracker_outcome = 'spoke_follow_up'
    )
    or tracker_outcome = 'meeting_set'
  )::integer as contacts
from call_tracker_events;

grant select on call_tracker_summary to anon, authenticated;
