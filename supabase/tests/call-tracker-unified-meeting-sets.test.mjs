import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260502003000_call_tracker_unify_lifecycle_meeting_sets.sql', import.meta.url),
  'utf8',
);

test('unified tracker stream includes lifecycle meeting-set facts', () => {
  assert.match(sql, /lifecycle_meeting_set_facts as/i);
  assert.match(sql, /from lifecycle_events le/i);
  assert.match(sql, /where le\.event_type = 'meeting_set'/i);
  assert.match(sql, /union all\s+select \* from lifecycle_meeting_set_facts/i);
});

test('unified meeting-set facts use lifecycle transition time for daily tracking', () => {
  const lifecycleCte = sql.match(/lifecycle_meeting_set_facts as \([\s\S]*?\n\)/i)?.[0] || '';
  assert.match(lifecycleCte, /le\.created_at as occurred_at/i);
  assert.match(lifecycleCte, /le\.created_at as event_at/i);
  assert.match(sql, /appointment_starts_at stays in payload_json->>'starts_at'/i);
});
