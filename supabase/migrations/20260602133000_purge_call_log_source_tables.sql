-- Purge legacy Call Tracker source tables after call_log became the canonical ledger.
--
-- Do not force-drop dependent objects: if a live view/function still depends on
-- either table, this migration must fail instead of silently dropping it.

drop table if exists public.call_activity_events;
drop table if exists public.meeting_events;
