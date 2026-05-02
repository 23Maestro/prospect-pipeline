import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL(
    '../migrations/20260502004000_normalize_meeting_set_created_at_from_pipeline_evidence.sql',
    import.meta.url,
  ),
  'utf8',
);

test('normalization uses deprecated pipeline rows only as historical evidence', () => {
  assert.match(sql, /event_type = 'pipeline_task_backfill_current'/i);
  assert.match(sql, /crm_stage,\s*''\)\) = 'meeting set'/i);
  assert.match(sql, /task_status = 'confirmation_call'/i);
  assert.match(sql, /current_appointment_id/i);
  assert.match(sql, /current_meeting,event_id/i);
});

test('normalization updates only existing canonical meeting-set facts to earlier evidence time', () => {
  assert.match(sql, /update lifecycle_events le/i);
  assert.match(sql, /le\.event_type = 'meeting_set'/i);
  assert.match(sql, /le\.athlete_key = evidence\.athlete_key/i);
  assert.match(sql, /evidence\.first_observed_at < le\.created_at/i);
  assert.doesNotMatch(sql, /insert into lifecycle_events/i);
});
