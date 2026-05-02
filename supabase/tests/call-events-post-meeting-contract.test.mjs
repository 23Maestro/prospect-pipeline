import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260502005000_call_events_post_meeting_outcome_contract.sql', import.meta.url),
  'utf8',
);
const persistence = readFileSync(
  new URL('../../src/domain/supabase-persistence.ts', import.meta.url),
  'utf8',
);

test('call_events is documented as compatibility storage for post-meeting outcomes only', () => {
  assert.match(sql, /comment on table call_events/i);
  assert.match(sql, /post-meeting outcome facts only/i);
  assert.match(sql, /Dial\/contact activity belongs in call_activity_events/i);
  assert.match(sql, /Meeting-set daily tracking belongs in lifecycle_events/i);
});

test('domain persistence names call_events writes as post-meeting outcome facts', () => {
  assert.match(persistence, /upsertPostMeetingOutcomeFacts/);
  assert.match(persistence, /'call_events'/);
  assert.doesNotMatch(persistence, /function upsertCallEvents/);
});
