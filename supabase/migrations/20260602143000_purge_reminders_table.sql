-- Purge the deprecated reminders table.
--
-- Set-meeting confirmation prep now uses public.set_meeting_confirmation_cache.
-- Apple Reminder utilities are local app helpers and do not use this table.

drop table if exists public.reminders;
