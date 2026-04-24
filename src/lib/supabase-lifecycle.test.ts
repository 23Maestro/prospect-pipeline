import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppointmentId,
  buildAthleteKey,
  buildReminderDedupeKey,
  resolveLifecycleRetentionDecision,
} from './supabase-lifecycle';

test('buildAthleteKey keeps athlete and main id together', () => {
  assert.equal(buildAthleteKey('123', '456'), '123:456');
});

test('buildAppointmentId prefers explicit appointment id', () => {
  assert.equal(
    buildAppointmentId({
      athleteId: '123',
      athleteMainId: '456',
      appointmentId: 'evt_1',
      startsAt: '2026-04-21T10:00:00-04:00',
    }),
    'evt_1',
  );
});

test('buildAppointmentId falls back to athlete key + starts_at', () => {
  assert.equal(
    buildAppointmentId({
      athleteId: '123',
      athleteMainId: '456',
      startsAt: '2026-04-21T10:00:00-04:00',
    }),
    'appointment:123:456:2026-04-21T14:00:00.000Z',
  );
});

test('buildReminderDedupeKey normalizes send_at', () => {
  assert.equal(
    buildReminderDedupeKey({
      appointmentId: 'evt_1',
      kind: 'confirmation',
      suffix: 'queued',
      sendAt: '2026-04-22T09:30:00-04:00',
    }),
    'evt_1:confirmation:queued:2026-04-22T13:30:00.000Z',
  );
});

test('enrollment event titles purge lifecycle rows even if supabase is stale', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(ENR $69) Victor Williams Football 2028 TX',
  });

  assert.equal(result.action, 'purge');
});

test('(FU) event titles soft archive active meeting rows', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(FU) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'soft_archive');
});

test('(CL) event titles purge lifecycle rows as close lost', () => {
  const result = resolveLifecycleRetentionDecision({
    crmStage: 'Meeting Set',
    bookedEventTitle: '(CL) Terry Smith Football 2028 TX',
  });

  assert.equal(result.action, 'purge');
});

test('terminal crm stages purge lifecycle rows without title help', () => {
  const result = resolveLifecycleRetentionDecision({
    liveCrmStage: 'Actual Meeting Closed Won',
  });

  assert.equal(result.action, 'purge');
});
