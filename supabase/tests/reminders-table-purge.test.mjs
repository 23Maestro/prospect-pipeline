import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../migrations/20260602143000_purge_reminders_table.sql', import.meta.url),
  'utf8',
);

test('reminders purge drops only the deprecated table', () => {
  assert.match(migration, /drop table if exists public\.reminders/i);
  assert.doesNotMatch(migration, /\bcascade\b/i);
  assert.doesNotMatch(migration, /drop table if exists public\.set_meeting_confirmation_cache/i);
  assert.doesNotMatch(migration, /drop table if exists public\.appointments/i);
  assert.doesNotMatch(migration, /drop view/i);
});
