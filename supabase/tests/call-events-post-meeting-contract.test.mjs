import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260503044000_rename_call_events_to_meeting_events.sql', import.meta.url),
  'utf8',
);
const persistence = readFileSync(
  new URL('../../src/domain/supabase-persistence.ts', import.meta.url),
  'utf8',
);

test('meeting_events is documented as storage for post-meeting outcomes only', () => {
  assert.match(sql, /alter table public\.call_events rename to meeting_events/i);
  assert.match(sql, /comment on table meeting_events/i);
  assert.match(sql, /Meeting\/post-meeting outcome facts only/i);
  assert.match(sql, /Dial\/contact activity belongs in call_activity_events/i);
  assert.match(sql, /Meeting-set daily tracking belongs in lifecycle_events/i);
  assert.match(sql, /create view call_events as/i);
  assert.match(sql, /Deprecated compatibility view/i);
});

test('domain persistence writes post-meeting outcome facts to call_log', () => {
  assert.match(persistence, /upsertPostMeetingOutcomeFacts/);
  assert.match(persistence, /buildCallLogFactFromMeetingOutcomeFact/);
  assert.match(persistence, /'call_log'/);
  assert.doesNotMatch(persistence, /function upsertCallEvents/);
});
