alter table public.pending_client_watchlist enable row level security;

revoke all on table public.pending_client_watchlist from anon, authenticated;
grant select, insert, update, delete on public.pending_client_watchlist to service_role;
