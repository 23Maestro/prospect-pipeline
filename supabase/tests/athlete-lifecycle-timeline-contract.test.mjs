import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../migrations/20260529163000_athlete_lifecycle_timeline.sql', import.meta.url),
  'utf8',
);

test('athlete lifecycle timeline resolves identity from athlete key', () => {
  assert.match(sql, /create or replace view public\.athlete_lifecycle_timeline as/i);
  assert.match(sql, /from public\.lifecycle_events le/i);
  assert.match(sql, /left join public\.athletes athlete\s+on athlete\.athlete_key = le\.athlete_key/i);
  assert.match(sql, /coalesce\(athlete_name, payload_json->>'athlete_name', payload_json->>'name'\) as athlete_name/i);
});

test('athlete lifecycle timeline centralizes sales stage meaning and next actions', () => {
  for (const normalizedStage of [
    'meeting_set',
    'reschedule_pending',
    'rescheduled',
    'meeting_follow_up',
    'closed_won',
    'closed_lost',
    'inactive',
    'no_show',
  ]) {
    assert.match(sql, new RegExp(`'${normalizedStage}'`, 'i'));
  }

  for (const nextAction of [
    'await_meeting_result',
    'reschedule_client',
    'follow_up_for_result',
    'tally_enrollment_revenue',
    'drop_from_pipeline',
    'archive_inactive',
    'monitor_or_reschedule',
  ]) {
    assert.match(sql, new RegExp(`'${nextAction}'`, 'i'));
  }
});

test('athlete lifecycle current compresses repeated timeline rows into one current record', () => {
  assert.match(sql, /create or replace view public\.athlete_lifecycle_current as/i);
  assert.match(sql, /row_number\(\) over \(\s*partition by timeline\.athlete_key/i);
  assert.match(sql, /where ranked\.recency_rank = 1/i);
  assert.match(sql, /left join public\.active_athlete_meeting_truth truth\s+on truth\.athlete_key = ranked\.athlete_key/i);
});

test('timeline exposes show, enrollment, active monitoring, and terminal flags', () => {
  assert.match(sql, /normalized_stage in \('closed_won', 'closed_lost', 'reschedule_pending', 'meeting_follow_up'\) as indicates_showed/i);
  assert.match(sql, /normalized_stage = 'closed_won' as counts_as_enrollment/i);
  assert.match(sql, /normalized_stage in \('closed_won', 'closed_lost', 'inactive'\) as is_terminal/i);
  assert.match(sql, /normalized_stage in \('meeting_set', 'rescheduled', 'reschedule_pending', 'meeting_follow_up', 'no_show', 'new_opportunity', 'call_attempt'\) as is_active_or_monitoring/i);
});
