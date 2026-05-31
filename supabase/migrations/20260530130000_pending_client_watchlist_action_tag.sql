alter table public.pending_client_watchlist
  add column if not exists action_tag text not null default 'Missing Notes';

alter table public.pending_client_watchlist
  drop constraint if exists pending_client_watchlist_action_tag_check;

alter table public.pending_client_watchlist
  add constraint pending_client_watchlist_action_tag_check
    check (action_tag in ('Operator Input', 'Scout Update', 'Payment Watch', 'Missing Notes'));

comment on column public.pending_client_watchlist.action_tag is
  'Helper-facing Pending Clients tag. Lifecycle truth remains in lifecycle/current appointment sources.';
