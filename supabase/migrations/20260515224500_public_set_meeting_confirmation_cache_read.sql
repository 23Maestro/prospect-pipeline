create policy "public can read cached set meeting confirmations"
  on public.set_meeting_confirmation_cache
  for select
  to anon, authenticated
  using (
    status = 'cached'
    and source = 'set_meetings_confirmation'
    and kind in ('confirmation_1', 'confirmation_2')
  );

grant select on public.set_meeting_confirmation_cache to anon, authenticated;
