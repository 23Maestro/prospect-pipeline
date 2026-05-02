import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260502002000_lifecycle_meeting_set_source_contract.sql', import.meta.url),
  'utf8',
);

test('meeting-set source contract migration adds canonical dedupe key', () => {
  assert.match(sql, /add column if not exists dedupe_key text/i);
  assert.match(sql, /create unique index if not exists lifecycle_events_dedupe_key_unique_idx/i);
  assert.match(sql, /concat\(\s*'meeting_set:'[\s\S]*athlete_key[\s\S]*appointment_id/i);
});

test('meeting-set source contract cleans legacy duplicate rows before enforcing uniqueness', () => {
  assert.match(sql, /row_number\(\) over/i);
  assert.match(sql, /delete from lifecycle_events/i);
  assert.match(sql, /where le\.id = ranked\.id/i);
});
