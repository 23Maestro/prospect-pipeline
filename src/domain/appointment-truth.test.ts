import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAppointmentTruthWrite,
  isActiveAppointmentStatus,
  mergeAppointmentTruthRow,
  resolveConfirmedRescheduleAppointmentIdentity,
  validateAppointmentTruthWrite,
  type AppointmentTruthRow,
} from './appointment-truth';

const completeAppointment: AppointmentTruthRow = {
  id: '611014',
  starts_at: '2026-05-15T23:00:00.000Z',
  status: 'scheduled',
  source_event_id: '611014',
  meeting_timezone: 'America/Chicago',
  meeting_timezone_label: 'CST',
  head_scout: 'Head Scout D',
  original_appointment_id: '611014',
  reschedule_sequence: 0,
  operator_owner: 'Primary Operator',
  operator_owner_key: 'operator_primary',
  appointment_role: 'initial_set',
  source_system: 'scout_prep_action',
  source_payload: { owner_proof: 'raycast_operator_context' },
};

test('support writes preserve existing durable appointment truth', () => {
  const merged = mergeAppointmentTruthRow(completeAppointment, {
    id: '611014',
    status: 'confirmation_sent',
    status_reason: 'confirmation_sent',
    source_payload: { message_variant: 'confirmation_1' },
  });

  assert.equal(merged.status, 'confirmation_sent');
  assert.equal(merged.meeting_timezone, 'America/Chicago');
  assert.equal(merged.starts_at, '2026-05-15T23:00:00.000Z');
  assert.equal(merged.original_appointment_id, '611014');
  assert.equal(merged.operator_owner, 'Primary Operator');
  assert.deepEqual(merged.source_payload, {
    owner_proof: 'raycast_operator_context',
    message_variant: 'confirmation_1',
  });
});

test('active appointment truth rejects missing required business fields', () => {
  assert.deepEqual(
    validateAppointmentTruthWrite({
      id: '611014',
      status: 'scheduled',
      head_scout: 'Head Scout D',
    }),
    ['starts_at', 'meeting_timezone', 'operator_owner', 'original_appointment_id'],
  );
});

test('reschedule pending is a post-meeting result, not active appointment truth', () => {
  assert.equal(isActiveAppointmentStatus('reschedule_pending'), false);
  assert.deepEqual(
    validateAppointmentTruthWrite({
      id: '611014',
      status: 'reschedule_pending',
    }),
    [],
  );
});

test('reschedule appointment truth requires previous appointment identity', () => {
  assert.throws(
    () =>
      assertAppointmentTruthWrite({
        ...completeAppointment,
        id: '622222',
        status: 'rescheduled',
        appointment_role: 'reschedule',
        original_appointment_id: '611014',
        previous_appointment_id: null,
      }),
    /previous_appointment_id/,
  );
});

test('confirmed reschedule uses one previous appointment identity for Laravel and Supabase', () => {
  const identity = resolveConfirmedRescheduleAppointmentIdentity({
    initialBookedMeeting: null,
    currentBookedMeeting: {
      event_id: 'current-booked-meeting',
      title: 'Victor Williams Football 2027 FL',
    },
  });

  assert.deepEqual(identity, {
    previousAppointmentId: 'current-booked-meeting',
    previousEventId: 'current-booked-meeting',
    source: 'current_booked_meeting',
  });
});

test('confirmed reschedule prefers initial booked meeting identity when present', () => {
  const identity = resolveConfirmedRescheduleAppointmentIdentity({
    initialBookedMeeting: {
      event_id: 'initial-events-tab-meeting',
      title: 'Victor Williams Football 2027 FL',
    },
    currentBookedMeeting: {
      event_id: 'current-booked-meeting',
      title: 'Victor Williams Football 2027 FL',
    },
  });

  assert.equal(identity?.previousAppointmentId, 'initial-events-tab-meeting');
  assert.equal(identity?.previousEventId, 'initial-events-tab-meeting');
  assert.equal(identity?.source, 'initial_booked_meeting');
});
