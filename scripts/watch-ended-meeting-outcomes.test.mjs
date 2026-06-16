import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appointmentEndIso,
  athleteNameFromMeetingTitle,
  buildReplacementAppointmentRow,
  buildWatcherFailureEmail,
  buildAthleteName,
  isWatchCandidate,
  parseLiveEventTimeAsEastern,
  resolveWatcherDecision,
  selectedStageFromPayload,
} from './watch-ended-meeting-outcomes.mjs';

const NOW = new Date('2026-06-15T18:00:00.000Z');

test('ended meeting watcher admits only active unresolved appointments inside the seven-day window', () => {
  assert.equal(
    isWatchCandidate(
      {
        id: 'appt-1',
        athlete_id: '123',
        athlete_main_id: '456',
        status: 'scheduled',
        starts_at: '2026-06-15T16:00:00.000Z',
        post_meeting_result: null,
      },
      NOW,
      7,
    ),
    true,
  );
  assert.equal(
    isWatchCandidate(
      {
        id: 'appt-2',
        athlete_id: '123',
        athlete_main_id: '456',
        status: 'scheduled',
        starts_at: '2026-06-15T19:00:00.000Z',
        post_meeting_result: null,
      },
      NOW,
      7,
    ),
    false,
  );
  assert.equal(
    isWatchCandidate(
      {
        id: 'appt-3',
        athlete_id: '123',
        athlete_main_id: '456',
        status: 'scheduled',
        starts_at: '2026-06-01T16:00:00.000Z',
        post_meeting_result: null,
      },
      NOW,
      7,
    ),
    false,
  );
  assert.equal(
    isWatchCandidate(
      {
        id: 'appt-4',
        athlete_id: '123',
        athlete_main_id: '456',
        status: 'scheduled',
        starts_at: '2026-06-15T16:00:00.000Z',
        post_meeting_result: 'no_show',
      },
      NOW,
      7,
    ),
    false,
  );
});

test('ended meeting watcher treats Meeting Set as waiting, not a stored outcome', () => {
  assert.deepEqual(
    resolveWatcherDecision({
      appointment: { id: '777' },
      selectedStage: 'Meeting Set',
      liveEvent: { event_id: '777', title: 'Sample Athlete Football 2027 PA' },
    }),
    {
      action: 'still_waiting',
      selectedStage: 'Meeting Set',
      postMeetingResult: null,
      taskStatus: 'confirmation_call',
    },
  );
});

test('ended meeting watcher writes only real post-meeting sales stages', () => {
  assert.deepEqual(
    resolveWatcherDecision({
      appointment: { id: '777' },
      selectedStage: 'Meeting Result - Res. Pending',
      liveEvent: { event_id: '777', title: '(RSP) Sample Athlete Football 2027 PA' },
    }),
    {
      action: 'write_post_meeting_result',
      selectedStage: 'Meeting Result - Res. Pending',
      postMeetingResult: 'reschedule_pending',
      taskStatus: 'reschedule_pending',
    },
  );
  assert.equal(
    resolveWatcherDecision({
      appointment: { id: '777' },
      selectedStage: 'New Opportunity',
      liveEvent: { event_id: '777', title: 'Sample Athlete Football 2027 PA' },
    }).action,
    'no_post_meeting_change',
  );
});

test('ended meeting watcher lets Laravel sales stage beat conflicting title prefixes', () => {
  assert.deepEqual(
    resolveWatcherDecision({
      appointment: { id: '777' },
      selectedStage: 'Meeting Result - No Show',
      liveEvent: { event_id: '777', title: '(RSP) Sample Athlete Football 2027 PA' },
    }),
    {
      action: 'write_post_meeting_result',
      selectedStage: 'Meeting Result - No Show',
      postMeetingResult: 'no_show',
      taskStatus: 'no_show',
    },
  );
});

test('rescheduled stage requires evidence of a replacement live event', () => {
  assert.equal(
    resolveWatcherDecision({
      appointment: { id: '777' },
      selectedStage: 'Meeting Result - Rescheduled',
      liveEvent: { event_id: '777', title: 'Sample Athlete Football 2027 PA' },
    }).action,
    'needs_reschedule_event_review',
  );
  assert.deepEqual(
    resolveWatcherDecision({
      appointment: { id: '777' },
      selectedStage: 'Meeting Result - Rescheduled',
      liveEvent: { event_id: '888', title: 'Sample Athlete Football 2027 PA' },
    }),
    {
      action: 'write_post_meeting_result',
      selectedStage: 'Meeting Result - Rescheduled',
      postMeetingResult: 'rescheduled',
      taskStatus: 'confirmation_call',
    },
  );
});

test('rescheduled replacement live event builds active replacement appointment truth', () => {
  assert.equal(parseLiveEventTimeAsEastern('2026-06-16T20:00'), '2026-06-17T00:00:00.000Z');

  const row = buildReplacementAppointmentRow({
    athleteKey: '1499820:954548',
    appointment: {
      id: '673775',
      athlete_id: '1499820',
      athlete_main_id: '954548',
      head_scout: 'Nasir Adderley',
      operator_owner: 'Jerami Singleton',
      operator_owner_key: 'jerami_singleton',
      original_appointment_id: '673775',
      reschedule_sequence: 0,
      source_payload: {
        meeting_name: 'Niko Acors Football 2028 VA',
      },
    },
    liveEvent: {
      event_id: '695750',
      title: '(ACF)*2 Niko Acors Football 2028 VA',
      assigned_owner: 'Nasir Adderley',
      start: '2026-06-16T20:00',
      end: '2026-06-16T21:00',
    },
  });

  assert.equal(row.id, '695750');
  assert.equal(row.starts_at, '2026-06-17T00:00:00.000Z');
  assert.equal(row.status, 'rescheduled');
  assert.equal(row.post_meeting_result, null);
  assert.equal(row.previous_appointment_id, '673775');
  assert.equal(row.original_appointment_id, '673775');
  assert.equal(row.reschedule_sequence, 1);
  assert.equal(row.appointment_role, 'reschedule');
  assert.equal(row.source_system, 'ended_meeting_outcome_watch');
  assert.equal(row.source_payload.ends_at, '2026-06-17T01:00:00.000Z');
});

test('watcher reads selected stage from FastAPI sales-stage payloads and derives end fallback', () => {
  assert.equal(
    selectedStageFromPayload({
      selected_label: 'Meeting Set',
      options: [{ label: 'Meeting Result - No Show', selected: true }],
    }),
    'Meeting Result - No Show',
  );
  assert.equal(
    appointmentEndIso({ starts_at: '2026-06-15T16:00:00.000Z' }),
    '2026-06-15T17:00:00.000Z',
  );
});

test('ended meeting watcher never treats athlete key as athlete name', () => {
  assert.equal(athleteNameFromMeetingTitle('(ACF) Deontae Griffin Football 2029 AR'), 'Deontae Griffin');
  assert.equal(
    buildAthleteName(
      {
        athlete_id: '1499628',
        athlete_main_id: '954358',
        source_payload: {
          booked_event_title: '(ACF) Deontae Griffin Football 2029 AR',
        },
      },
      { athlete_name: '1499628:954358' },
    ),
    'Deontae Griffin',
  );
  assert.equal(
    buildAthleteName(
      {
        athlete_id: '1499628',
        athlete_main_id: '954358',
      },
      { athlete_name: '1499628:954358' },
      null,
      {
        athleteName: '1499628:954358',
        contactCacheAthleteName: 'Deontae Griffin',
        confirmationCacheAthleteName: 'Deontae Griffin',
      },
    ),
    'Deontae Griffin',
  );
  assert.throws(
    () =>
      buildAthleteName(
        {
          athlete_id: '1499628',
          athlete_main_id: '954358',
          source_payload: { athlete_name: '1499628:954358' },
        },
        {},
      ),
    /Missing real athlete name/,
  );
});

test('ended meeting watcher failure email tells operator to fix source data', () => {
  const email = buildWatcherFailureEmail({
    dryRun: false,
    windowDays: 7,
    candidates: 1,
    failures: [
      {
        appointmentId: '630569',
        athleteId: '1499628',
        athleteMainId: '954358',
        error: 'Missing real athlete name for 1499628:954358',
      },
    ],
  });
  assert.equal(email.subject, 'Prospect Pipeline watcher failed: 1 row');
  assert.match(email.body, /What happened/);
  assert.match(email.body, /Why this matters/);
  assert.match(email.body, /Appointment 630569/);
  assert.match(email.body, /Athlete key: 1499628:954358/);
  assert.match(email.body, /scripts\/watch-ended-meeting-outcomes\.mjs/);
  assert.match(email.body, /docs\/architecture\/scout-prep-supabase-source-of-truth\.md/);
  assert.match(email.body, /Do not add broad fallback guesses/);
});
