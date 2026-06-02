import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260602133000_purge_call_log_source_tables.sql', import.meta.url),
  'utf8',
);

test('call_log source table purge drops legacy source tables without cascade', () => {
  assert.match(sql, /drop table if exists public\.call_activity_events;/i);
  assert.match(sql, /drop table if exists public\.meeting_events;/i);
  assert.doesNotMatch(sql, /\bcascade\b/i);
  assert.doesNotMatch(sql, /drop table if exists public\.call_log/i);
  assert.doesNotMatch(sql, /drop view/i);
});
