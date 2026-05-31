alter table public.appointments
  add column if not exists post_meeting_result text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_post_meeting_result_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_post_meeting_result_check
      check (
        post_meeting_result is null
        or post_meeting_result in (
          'awaiting_post_meeting_update',
          'closed_won',
          'closed_lost',
          'follow_up',
          'reschedule_pending',
          'rescheduled',
          'no_show',
          'canceled'
        )
      ) not valid;
  end if;
end $$;

create index if not exists appointments_post_meeting_result_idx
  on public.appointments (post_meeting_result, updated_at desc)
  where post_meeting_result is not null;

comment on column public.appointments.post_meeting_result is
  'Durable post-meeting result marker written by action-time and reconcile paths. Commands should interpret current action through lifecycle views.';
