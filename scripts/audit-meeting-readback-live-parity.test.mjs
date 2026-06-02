import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyLifecycleStage, summarizeParity } from './audit-meeting-readback-live-parity.mjs';

const source = readFileSync(new URL('./audit-meeting-readback-live-parity.mjs', import.meta.url), 'utf8');

test('meeting readback parity audit stays read-only', () => {
  assert.doesNotMatch(source, /\b(insert|upsert|update|delete|patch)\b/i);
  assert.match(source, /active_athlete_meeting_truth/);
  assert.match(source, /athlete_lifecycle_timeline/);
  assert.match(source, /appointments\?select/);
  assert.match(source, /lifecycle_events\?select/);
});

test('meeting readback parity compares old projection ids to canonical ids', () => {
  const summary = summarizeParity({
    oldActiveRows: [{ resolved_appointment_id: 'appt-1' }],
    newActiveRows: [{ id: 'appt-1' }, { id: 'appt-2' }],
    oldLifecycleRows: [{ lifecycle_event_id: 'life-1' }],
    newLifecycleRows: [{ id: 'life-1' }],
  });

  assert.equal(summary.activeMeetings.oldSource, 'active_athlete_meeting_truth');
  assert.equal(summary.activeMeetings.newSource, 'appointments');
  assert.equal(summary.activeMeetings.missingInNew, 0);
  assert.equal(summary.activeMeetings.extraInNew, 1);
  assert.equal(summary.activeMeetings.parity, false);
  assert.equal(summary.lifecycle.parity, true);
});

test('meeting readback parity uses lifecycle stage classification matching the view intent', () => {
  assert.equal(classifyLifecycleStage({ crm_stage: 'Meeting Set' }), 'meeting_set');
  assert.equal(classifyLifecycleStage({ crm_stage: 'Actual Meeting - Follow Up' }), 'meeting_follow_up');
  assert.equal(classifyLifecycleStage({ crm_stage: 'Meeting Result - Res. Pending' }), 'reschedule_pending');
  assert.equal(classifyLifecycleStage({ crm_stage: 'Closed Won' }), 'closed_won');
});
