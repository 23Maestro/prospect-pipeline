do $$
begin
  if exists (
    select 1
    from public.appointments
    where post_meeting_result = 'awaiting_post_meeting_update'
  ) then
    raise exception 'appointments.post_meeting_result contains transient awaiting_post_meeting_update rows; resolve those rows before tightening the constraint';
  end if;
end $$;

alter table public.appointments
  drop constraint if exists appointments_post_meeting_result_check;

alter table public.appointments
  add constraint appointments_post_meeting_result_check
  check (
    post_meeting_result is null
    or post_meeting_result in (
      'closed_won',
      'closed_lost',
      'follow_up',
      'reschedule_pending',
      'rescheduled',
      'no_show',
      'canceled'
    )
  ) not valid;

comment on column public.appointments.post_meeting_result is
  'Durable post-meeting result marker for real outcomes and explicit Pending Clients task states. Ended Meeting Set rows awaiting source-system update are computed as needs_post_meeting_review, not stored here.';
