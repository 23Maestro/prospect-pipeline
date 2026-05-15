import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260514090000_athlete_contact_cache.sql', import.meta.url),
  'utf8',
);

test('athlete_contact_cache migration creates lookup table and active indexes', () => {
  assert.match(sql, /create table if not exists public\.athlete_contact_cache/i);
  assert.match(sql, /athlete_key text not null/i);
  assert.match(sql, /normalized_phone text not null/i);
  assert.match(sql, /unique \(normalized_phone, athlete_key\)/i);
  assert.match(sql, /where cache_status = 'active'/i);
  assert.match(sql, /on public\.athlete_contact_cache \(athlete_key, updated_at desc\)/i);
});

test('athlete_contact_cache migration keeps browser access on RPC only', () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.athlete_contact_cache from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.athlete_contact_cache to service_role/i);
  assert.match(sql, /create or replace function public\.lookup_athlete_contact_cache\(input_phone text\)/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /grant execute on function public\.lookup_athlete_contact_cache\(text\) to anon, authenticated/i);
  assert.doesNotMatch(sql, /grant select on public\.athlete_contact_cache to anon/i);
  assert.doesNotMatch(sql, /grant select on public\.athlete_contact_cache to authenticated/i);
});
