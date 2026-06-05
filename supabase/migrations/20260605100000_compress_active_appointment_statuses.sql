-- Compress active appointment truth.
-- Reschedule pending is a post-meeting outcome, not an active appointment status.

do $$
begin
  if to_regclass('public.appointments') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_active_starts_at_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      drop constraint appointment_truth_active_starts_at_check;
  end if;

  alter table public.appointments
    add constraint appointment_truth_active_starts_at_check
    check (
      status is null
      or status not in (
        'scheduled',
        'rescheduled',
        'confirmation_queued',
        'confirmation_sent'
      )
      or starts_at is not null
      or source_system is null
    ) not valid;

  if exists (
    select 1
    from pg_constraint
    where conname = 'appointment_truth_active_timezone_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      drop constraint appointment_truth_active_timezone_check;
  end if;

  alter table public.appointments
    add constraint appointment_truth_active_timezone_check
    check (
      status is null
      or status not in (
        'scheduled',
        'rescheduled',
        'confirmation_queued',
        'confirmation_sent'
      )
      or meeting_timezone is not null
      or source_system is null
      or source_system in ('sync_current_pipeline', 'sync_booked_meetings')
    ) not valid;
end $$;

drop index if exists public.appointments_active_truth_idx;

create index if not exists appointments_active_truth_idx
  on public.appointments (athlete_key, updated_at desc, starts_at desc)
  where status in (
    'scheduled',
    'rescheduled',
    'confirmation_queued',
    'confirmation_sent'
  );

comment on index public.appointments_active_truth_idx is
  'Active/support appointment rows only. Post-meeting outcomes such as reschedule_pending live in appointments.post_meeting_result.';
