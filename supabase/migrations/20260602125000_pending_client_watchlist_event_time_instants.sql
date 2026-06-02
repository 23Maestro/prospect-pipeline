alter table public.pending_client_watchlist
  alter column event_start type timestamptz
  using (
    case
      when event_start ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' then event_start::timestamptz
      else event_start::timestamp at time zone 'America/New_York'
    end
  );

alter table public.pending_client_watchlist
  alter column event_end type timestamptz
  using (
    case
      when event_end is null or btrim(event_end) = '' then null
      when event_end ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' then event_end::timestamptz
      else event_end::timestamp at time zone 'America/New_York'
    end
  );

comment on column public.pending_client_watchlist.event_start is
  'Meeting start instant for the pending-client appointment, stored as UTC timestamptz. Display layers render this in the resolved meeting timezone.';

comment on column public.pending_client_watchlist.event_end is
  'Meeting end instant for the pending-client appointment, stored as UTC timestamptz. Display layers render this in the resolved meeting timezone.';
