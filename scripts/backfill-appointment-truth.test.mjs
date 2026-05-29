import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAppointmentTruthPatches,
  inferAppointmentRole,
  normalizeMeetingTimezone,
  resolveOwnerByName,
  resolveTimezoneLabel,
} from './backfill-appointment-truth.mjs';

const owners = [
  {
    ownerKey: 'jerami_singleton',
    personName: 'Jerami Singleton',
    aliases: ['Jerami'],
  },
  {
    ownerKey: 'ryan_lietz',
    personName: 'Ryan Lietz',
    aliases: ['Coach Ryan'],
  },
];

test('timezone labels resolve from IANA zones when contact label is missing', () => {
  assert.equal(normalizeMeetingTimezone('CST'), 'America/Chicago');
  assert.equal(normalizeMeetingTimezone('America/Phoenix'), 'America/Phoenix');
  assert.equal(normalizeMeetingTimezone('Select Recruit Time Zone'), null);
  assert.equal(resolveTimezoneLabel('America/Chicago'), 'CST');
  assert.equal(resolveTimezoneLabel('America/Los_Angeles'), 'PST');
  assert.equal(resolveTimezoneLabel('America/Chicago', 'CT'), 'CST');
  assert.equal(resolveTimezoneLabel('America/New_York', 'CST'), 'EST');
});

test('backfill patches timezone from booked meeting details before related appointments', () => {
  const result = buildAppointmentTruthPatches({
    owners,
    appointments: [
      {
        id: 'appt-1',
        athlete_key: 'athlete-1',
        starts_at: '2026-05-28T23:00:00.000Z',
        status: 'scheduled',
        meeting_timezone: null,
        meeting_timezone_label: null,
        source_payload: {},
      },
      {
        id: 'appt-2',
        athlete_key: 'athlete-1',
        starts_at: '2026-05-29T23:00:00.000Z',
        status: 'rescheduled',
        meeting_timezone: 'America/New_York',
        meeting_timezone_label: 'EST',
        source_payload: {},
      },
    ],
    confirmationRows: [],
    bookedMeetingDetailRows: [{ appointment_id: 'appt-1', meeting_timezone: 'CST' }],
    contactRows: [],
    lifecycleRows: [],
  });

  const patch = result.patches.find((entry) => entry.appointmentId === 'appt-1');
  assert.equal(patch.patch.meeting_timezone, 'America/Chicago');
  assert.equal(patch.patch.meeting_timezone_label, 'CST');
  assert.deepEqual(patch.sources.filter((source) => source === 'booked_meeting_details'), [
    'booked_meeting_details',
  ]);
});

test('backfill can inherit timezone from a related appointment for same athlete', () => {
  const result = buildAppointmentTruthPatches({
    owners,
    appointments: [
      {
        id: 'appt-1',
        athlete_key: 'athlete-1',
        starts_at: '2026-05-28T23:00:00.000Z',
        status: 'scheduled',
        meeting_timezone: null,
        meeting_timezone_label: null,
        source_payload: {},
      },
      {
        id: 'appt-2',
        athlete_key: 'athlete-1',
        starts_at: '2026-05-29T23:00:00.000Z',
        status: 'rescheduled',
        meeting_timezone: 'America/New_York',
        meeting_timezone_label: 'EST',
        source_payload: {},
      },
    ],
    confirmationRows: [],
    bookedMeetingDetailRows: [],
    contactRows: [],
    lifecycleRows: [],
  });

  const patch = result.patches.find((entry) => entry.appointmentId === 'appt-1');
  assert.equal(patch.patch.meeting_timezone, 'America/New_York');
  assert.equal(patch.patch.meeting_timezone_label, 'EST');
  assert.deepEqual(patch.sources.filter((source) => source === 'related_appointment'), [
    'related_appointment',
  ]);
});

test('owner lookup matches aliases and normalized names', () => {
  assert.equal(resolveOwnerByName(owners, ' coach   ryan ')?.ownerKey, 'ryan_lietz');
  assert.equal(resolveOwnerByName(owners, 'Jerami Singleton')?.ownerKey, 'jerami_singleton');
});

test('appointment role uses lifecycle event before appointment status', () => {
  assert.equal(
    inferAppointmentRole({ status: 'scheduled' }, { event_type: 'rescheduled' }),
    'reschedule',
  );
  assert.equal(inferAppointmentRole({ status: 'no_show' }, null), 'post_meeting_outcome');
  assert.equal(inferAppointmentRole({ status: 'scheduled' }, null), 'initial_set');
});

test('backfill patches timezone, owner, head scout key, and initial chain defaults', () => {
  const result = buildAppointmentTruthPatches({
    owners,
    appointments: [
      {
        id: 'appt-1',
        athlete_key: 'athlete-1',
        head_scout: 'Ryan Lietz',
        starts_at: '2026-05-28T23:00:00.000Z',
        status: 'scheduled',
        meeting_timezone: null,
        meeting_timezone_label: null,
        previous_appointment_id: null,
        original_appointment_id: null,
        reschedule_sequence: 0,
        operator_owner: null,
        operator_owner_key: null,
        head_scout_key: null,
        appointment_role: null,
        source_payload: {},
        updated_at: '2026-05-28T20:00:00.000Z',
      },
    ],
    confirmationRows: [{ appointment_id: 'appt-1', meeting_timezone: 'America/Chicago' }],
    contactRows: [{ athlete_key: 'athlete-1', timezone: 'America/New_York', timezone_label: 'EST' }],
    lifecycleRows: [
      {
        athlete_key: 'athlete-1',
        event_type: 'meeting_set',
        created_at: '2026-05-28T20:00:00.000Z',
        payload_json: {
          appointment_id: 'appt-1',
          owner_context: { active_operator_name: 'Jerami Singleton', active_operator_key: 'jerami_singleton' },
        },
      },
    ],
  });

  assert.equal(result.unrepairable.length, 0);
  assert.equal(result.patches.length, 1);
  assert.deepEqual(
    {
      meeting_timezone: result.patches[0].patch.meeting_timezone,
      meeting_timezone_label: result.patches[0].patch.meeting_timezone_label,
      operator_owner: result.patches[0].patch.operator_owner,
      operator_owner_key: result.patches[0].patch.operator_owner_key,
      head_scout_key: result.patches[0].patch.head_scout_key,
      appointment_role: result.patches[0].patch.appointment_role,
      original_appointment_id: result.patches[0].patch.original_appointment_id,
      reschedule_sequence: result.patches[0].patch.reschedule_sequence,
    },
    {
      meeting_timezone: 'America/Chicago',
      meeting_timezone_label: 'CST',
      operator_owner: 'Jerami Singleton',
      operator_owner_key: 'jerami_singleton',
      head_scout_key: 'ryan_lietz',
      appointment_role: 'initial_set',
      original_appointment_id: 'appt-1',
      reschedule_sequence: 0,
    },
  );
});

test('reschedule chains use explicit previous appointment id when present', () => {
  const result = buildAppointmentTruthPatches({
    owners,
    appointments: [
      {
        id: 'appt-1',
        athlete_key: 'athlete-1',
        head_scout: 'Ryan Lietz',
        starts_at: '2026-05-01T20:00:00.000Z',
        status: 'scheduled',
        original_appointment_id: 'appt-1',
        reschedule_sequence: 0,
        source_payload: {},
        updated_at: '2026-05-01T20:00:00.000Z',
      },
      {
        id: 'appt-2',
        athlete_key: 'athlete-1',
        head_scout: 'Ryan Lietz',
        starts_at: '2026-05-02T20:00:00.000Z',
        status: 'rescheduled',
        previous_appointment_id: null,
        original_appointment_id: null,
        reschedule_sequence: 0,
        appointment_role: null,
        source_payload: {},
        updated_at: '2026-05-02T20:00:00.000Z',
      },
    ],
    confirmationRows: [],
    contactRows: [],
    lifecycleRows: [
      {
        athlete_key: 'athlete-1',
        event_type: 'rescheduled',
        created_at: '2026-05-02T19:00:00.000Z',
        payload_json: { appointment_id: 'appt-2', previous_appointment_id: 'appt-1' },
      },
    ],
  });

  const reschedulePatch = result.patches.find((patch) => patch.appointmentId === 'appt-2');
  assert.equal(result.unrepairable.length, 0);
  assert.equal(reschedulePatch.patch.previous_appointment_id, 'appt-1');
  assert.equal(reschedulePatch.patch.original_appointment_id, 'appt-1');
  assert.equal(reschedulePatch.patch.reschedule_sequence, 1);
});

test('ambiguous previous appointment inference is reported as unrepairable', () => {
  const result = buildAppointmentTruthPatches({
    owners,
    appointments: [
      { id: 'a1', athlete_key: 'athlete-1', starts_at: '2026-05-01T20:00:00.000Z', status: 'scheduled', source_payload: {} },
      { id: 'a2', athlete_key: 'athlete-1', starts_at: '2026-05-02T20:00:00.000Z', status: 'scheduled', source_payload: {} },
      {
        id: 'a3',
        athlete_key: 'athlete-1',
        starts_at: '2026-05-03T20:00:00.000Z',
        status: 'rescheduled',
        previous_appointment_id: null,
        appointment_role: null,
        source_payload: {},
      },
    ],
    confirmationRows: [],
    contactRows: [],
    lifecycleRows: [],
  });

  assert.equal(result.unrepairable[0].reason, 'multiple_plausible_previous_appointments');
  assert.deepEqual(result.unrepairable[0].candidate_appointment_ids, ['a1', 'a2']);
  assert.equal(result.unrepairable.length, 1);
});
