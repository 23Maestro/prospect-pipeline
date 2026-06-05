import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyLifecycleStage, summarizeCanonicalCoverage } from './audit-meeting-readback-live-parity.mjs';

const source = readFileSync(new URL('./audit-meeting-readback-live-parity.mjs', import.meta.url), 'utf8');

test('meeting readback parity audit stays read-only', () => {
  assert.doesNotMatch(source, /\b(insert|upsert|update|delete|patch)\b/i);
  assert.match(source, /appointments\?select/);
  assert.match(source, /lifecycle_events\?select/);
  assert.doesNotMatch(source, /active_athlete_meeting_truth/);
  assert.doesNotMatch(source, /athlete_lifecycle_timeline/);
});

test('meeting readback parity does not treat reschedule pending as an active appointment status', () => {
  const activeStatusBlock = source.match(/const activeAppointmentStatuses = new Set\(\[([\s\S]*?)\]\);/);

  assert.ok(activeStatusBlock, 'active appointment status block should be explicit');
  assert.doesNotMatch(activeStatusBlock[1], /reschedule_pending/);
});

test('meeting readback audit reports canonical appointment and lifecycle coverage', () => {
  const summary = summarizeCanonicalCoverage({
    activeRows: [{ id: 'appt-1' }, { id: 'appt-2' }],
    lifecycleRows: [{ id: 'life-1' }],
  });

  assert.equal(summary.activeMeetings.source, 'appointments');
  assert.equal(summary.activeMeetings.rows, 2);
  assert.equal(summary.activeMeetings.appointmentIds, 2);
  assert.equal(summary.lifecycle.source, 'lifecycle_events');
  assert.equal(summary.lifecycle.rows, 1);
  assert.equal(summary.lifecycle.lifecycleEventIds, 1);
});

test('meeting readback parity uses lifecycle stage classification matching the view intent', () => {
  assert.equal(classifyLifecycleStage({ crm_stage: 'Meeting Set' }), 'meeting_set');
  assert.equal(classifyLifecycleStage({ crm_stage: 'Actual Meeting - Follow Up' }), 'meeting_follow_up');
  assert.equal(classifyLifecycleStage({ crm_stage: 'Meeting Result - Res. Pending' }), 'reschedule_pending');
  assert.equal(classifyLifecycleStage({ crm_stage: 'Closed Won' }), 'closed_won');
});
