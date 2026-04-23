import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppointmentId, buildAthleteKey, buildReminderDedupeKey } from './supabase-lifecycle';

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
