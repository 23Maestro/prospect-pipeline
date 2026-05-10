import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../migrations/20260510090000_expand_reminders_set_meeting_cache.sql', import.meta.url), 'utf8');

test('migration adds set meeting cache columns to reminders without dropping existing columns', () => {
  assert.match(sql, /alter table if exists reminders/i);
  assert.match(sql, /add column if not exists athlete_key text/i);
  assert.match(sql, /add column if not exists meeting_starts_at timestamptz/i);
  assert.match(sql, /add column if not exists message_body text/i);
  assert.match(sql, /add column if not exists payload_json jsonb not null default '\{\}'::jsonb/i);
  assert.doesNotMatch(sql, /drop column/i);
});
