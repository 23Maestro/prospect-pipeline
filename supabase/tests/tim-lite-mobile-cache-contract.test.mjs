import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260603100000_tim_lite_mobile_cache.sql', import.meta.url),
  'utf8',
);

test('Tim Lite creates isolated appointment and confirmation cache tables', () => {
  assert.match(sql, /create table if not exists public\.tim_lite_appointments/i);
  assert.match(sql, /create table if not exists public\.tim_lite_confirmation_cache/i);
  assert.match(sql, /operator_key text not null default 'tim_risner'/i);
  assert.match(sql, /check \(operator_key = 'tim_risner'\)/i);
  assert.match(sql, /appointment_id text not null/i);
  assert.match(sql, /athlete_name text not null/i);
  assert.match(sql, /recipient_phone text/i);
  assert.match(sql, /head_scout_name text/i);
  assert.match(sql, /meeting_starts_at timestamptz/i);
  assert.match(sql, /meeting_timezone text/i);
  assert.match(sql, /message_body text/i);
  assert.match(sql, /admin_url text/i);
  assert.match(sql, /task_url text/i);
});

test('Tim Lite cache reads stay server-side and scoped to cached Tim rows', () => {
  assert.match(sql, /alter table public\.tim_lite_appointments enable row level security/i);
  assert.match(sql, /alter table public\.tim_lite_confirmation_cache enable row level security/i);
  assert.match(sql, /revoke all on table public\.tim_lite_appointments from anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.tim_lite_confirmation_cache from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.tim_lite_appointments to service_role/i);
  assert.match(sql, /grant select, insert, update, delete on public\.tim_lite_confirmation_cache to service_role/i);
  assert.match(sql, /operator_key = 'tim_risner'/i);
  assert.match(sql, /status = 'cached'/i);
  assert.match(sql, /kind in \('confirmation_1', 'confirmation_2'\)/i);
  assert.doesNotMatch(sql, /grant select on public\.tim_lite_appointments to anon/i);
  assert.doesNotMatch(sql, /grant select on public\.tim_lite_confirmation_cache to anon/i);
  assert.doesNotMatch(sql, /create policy "public can read tim lite/i);
});

test('Tim Lite search RPC uses the confirmation cache and does not expose table-wide contact reads', () => {
  assert.match(sql, /create or replace function public\.search_tim_lite_confirmation_cache\(input_query text\)/i);
  assert.match(sql, /from public\.tim_lite_confirmation_cache cache/i);
  assert.match(sql, /cache\.operator_key = 'tim_risner'/i);
  assert.match(sql, /cache\.kind = 'confirmation_1'/i);
  assert.match(sql, /grant execute on function public\.search_tim_lite_confirmation_cache\(text\) to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.search_tim_lite_confirmation_cache\(text\) to anon/i);
  assert.doesNotMatch(sql, /from public\.athlete_contact_cache/i);
  assert.doesNotMatch(sql, /grant select on public\.athlete_contact_cache to anon/i);
});
