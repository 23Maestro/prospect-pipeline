import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMeetingDayLabel,
  buildSetMeetingCandidate,
  buildSetMeetingCandidateIdentityKey,
  buildSetMeetingCandidatesFromAppointments,
  buildSetMeetingCandidatesFromBookedMeetings,
  filterWeeklySetMeetingCandidates,
  getMeetingSortValue,
  selectCurrentSetMeetingAppointmentRows,
  sortSetMeetingCandidates,
} from './set-meetings-candidate';

test('Set Meetings candidate uses bookedMeeting.start as display and sorting source of truth', () => {
  const candidate = buildSetMeetingCandidate({
    athleteKey: '123:456',
    athleteId: '123',
    athleteMainId: '456',
    athleteName: 'Avery Jones',
    taskId: '9001',
    taskDueDate: '2026-05-03T12:00:00.000Z',
    taskTitle: '(SC Move This Task) Confirmation Call',
    bookedMeeting: {
      eventId: 'evt-1',
      title: 'Avery Jones Football',
      assignedOwner: 'Ryan Lietz',
      start: '2026-05-02T23:00:00.000Z',
      end: '2026-05-03T00:00:00.000Z',
      dateTimeLabel: 'Sat 05/02/26 7:00 PM',
    },
  });

  assert.equal(candidate.dueDate, '2026-05-03T12:00:00.000Z');
  assert.equal(candidate.bookedMeeting?.start, '2026-05-02T23:00:00.000Z');
  assert.equal(getMeetingSortValue(candidate), Date.parse('2026-05-02T23:00:00.000Z'));
  assert.equal(buildMeetingDayLabel(candidate), 'Sat, 5/2');
});

test('candidate sorting is stable by bucket, meeting start, and athlete name', () => {
  const later = buildSetMeetingCandidate({
    athleteKey: '2:2',
    athleteId: '2',
    athleteMainId: '2',
    athleteName: 'Zed',
    taskId: '2',
    bookedMeeting: {
      eventId: 'evt-2',
      title: 'Zed Football',
      start: '2026-05-02T23:30:00.000Z',
    },
  });
  const firstAlpha = buildSetMeetingCandidate({
    athleteKey: '1:1',
    athleteId: '1',
    athleteMainId: '1',
    athleteName: 'Avery',
    taskId: '1',
    bookedMeeting: {
      eventId: 'evt-1',
      title: 'Avery Football',
      start: '2026-05-02T23:00:00.000Z',
    },
  });
  const secondAlpha = buildSetMeetingCandidate({
    athleteKey: '3:3',
    athleteId: '3',
    athleteMainId: '3',
    athleteName: 'Bryson',
    taskId: '3',
    bookedMeeting: {
      eventId: 'evt-3',
      title: 'Bryson Football',
      start: '2026-05-02T23:00:00.000Z',
    },
  });

  assert.deepEqual(
    sortSetMeetingCandidates([later, secondAlpha, firstAlpha], new Date('2026-05-01T12:00:00.000Z')).map(
      (candidate) => candidate.athleteName,
    ),
    ['Avery', 'Bryson', 'Zed'],
  );
});

test('Set Meetings row identity distinguishes repeat appointments for the same athlete profile', () => {
  const first = buildSetMeetingCandidate({
    athleteKey: '1499010:953777',
    athleteId: '1499010',
    athleteMainId: '953777',
    athleteName: 'Repeat Prospect',
    taskId: '9001',
    bookedMeeting: {
      eventId: '588446',
      title: 'Repeat Prospect Football',
      start: '2026-06-04T23:00:00.000Z',
    },
  });
  const second = buildSetMeetingCandidate({
    athleteKey: '1499010:953777',
    athleteId: '1499010',
    athleteMainId: '953777',
    athleteName: 'Repeat Prospect',
    taskId: '9001',
    bookedMeeting: {
      eventId: '588447',
      title: 'Repeat Prospect Football',
      start: '2026-06-05T23:00:00.000Z',
    },
  });

  assert.equal(first.key, second.key);
  assert.notEqual(
    buildSetMeetingCandidateIdentityKey(first),
    buildSetMeetingCandidateIdentityKey(second),
  );
});

test('weekly booked meeting candidates render meeting-set rows even while confirmation task is pending', () => {
  const candidates = buildSetMeetingCandidatesFromBookedMeetings({
    operatorName: 'Jerami Singleton',
    bookedMeetings: [
      {
        event_id: 'evt-jerami',
        title: 'Avery Jones Football',
        assigned_owner: 'Ryan Lietz',
        start: '2026-05-02T23:00:00.000Z',
        end: '2026-05-03T00:00:00.000Z',
        date_time_label: 'Sat 05/02/26 7:00 PM',
      },
      {
        event_id: 'evt-tim',
        athlete_id: '789',
        athlete_main_id: '111',
        athlete_name: 'Tim Prospect',
        title: 'Tim Prospect Football',
        assigned_owner: 'Ryan Lietz',
        start: '2026-05-02T23:00:00.000Z',
        end: '2026-05-03T00:00:00.000Z',
        date_time_label: 'Sat 05/02/26 7:00 PM',
      },
    ],
    tasks: [
      {
        contact_id: '123',
        athlete_id: '123',
        athlete_main_id: '456',
        athlete_name: 'Avery Jones',
        task_id: '9001',
        title: 'Confirmation Call',
        assigned_owner: 'Jerami Singleton',
      },
      {
        contact_id: '789',
        athlete_id: '789',
        athlete_main_id: '111',
        athlete_name: 'Tim Prospect',
        task_id: '9002',
        title: 'Confirmation Call',
        assigned_owner: 'Tim Risner',
      },
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.athleteName), [
    'Avery Jones',
    'Tim Prospect',
  ]);
  assert.equal(candidates[0].taskId, '9001');
  assert.equal(candidates[1].taskId, '');
  assert.equal(candidates[1].currentTask, 'Confirmation Call');
});

test('weekly appointments are Set Meetings render truth before confirmation task hydration', () => {
  const candidates = buildSetMeetingCandidatesFromAppointments({
    operatorName: 'Jerami Singleton',
    appointments: [
      {
        id: '587281',
        sourceEventId: '587281',
        athleteId: '1499428',
        athleteMainId: '954160',
        athleteName: 'Dorian Bentley',
        headScout: 'Ryan Lietz',
        startsAt: '2026-06-04T23:00:00.000Z',
        meetingTitle: 'Dorian Bentley Football 2028 FL',
      },
    ],
    tasks: [],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].athleteName, 'Dorian Bentley');
  assert.equal(candidates[0].taskId, '');
  assert.equal(candidates[0].bookedMeeting?.event_id, '587281');
  assert.equal(candidates[0].headScoutName, 'Ryan Lietz');
});

test('weekly Set Meetings hides expired same-week appointment rows', () => {
  const candidates = buildSetMeetingCandidatesFromAppointments({
    operatorName: 'Jerami Singleton',
    appointments: [
      {
        id: '587281',
        sourceEventId: '587281',
        athleteId: '1499428',
        athleteMainId: '954160',
        athleteName: 'Dorian Bentley',
        headScout: 'Ryan Lietz',
        startsAt: '2026-06-04T23:00:00.000Z',
        endsAt: '2026-06-05T00:00:00.000Z',
        meetingTitle: 'Dorian Bentley Football 2028 FL',
        status: 'scheduled',
      },
      {
        id: '588446',
        sourceEventId: '588446',
        athleteId: '1499010',
        athleteMainId: '953777',
        athleteName: 'Wenstan Penermon',
        headScout: 'Ryan Lietz',
        startsAt: '2026-06-07T20:00:00.000Z',
        endsAt: '2026-06-07T21:00:00.000Z',
        meetingTitle: 'Wenstan Penermon Football 2027 GA',
        status: 'scheduled',
      },
    ],
    tasks: [],
  });

  assert.deepEqual(
    filterWeeklySetMeetingCandidates({
      candidates,
      weeklyMeetingsOnly: true,
      weekStart: '2026-06-01',
      weekEnd: '2026-06-08',
      now: new Date('2026-06-05T14:00:00.000Z'),
    }).map((candidate) => candidate.athleteName),
    ['Wenstan Penermon'],
  );
});

test('current appointment selection suppresses old rescheduled row when new appointment exists', () => {
  const selected = selectCurrentSetMeetingAppointmentRows([
    {
      id: '586604',
      sourceEventId: '586604',
      athleteId: '1499010',
      athleteMainId: '953777',
      athleteName: 'Wenstan Penermon',
      headScout: 'Ryan Lietz',
      startsAt: '2026-06-03T22:00:00.000Z',
      meetingTitle: 'Wenstan Penermon Football 2027 GA',
      status: 'rescheduled',
      postMeetingResult: 'rescheduled',
      originalAppointmentId: '586604',
      rescheduleSequence: 0,
    },
    {
      id: '588446',
      sourceEventId: '588446',
      athleteId: '1499010',
      athleteMainId: '953777',
      athleteName: 'Wenstan Penermon',
      headScout: 'Ryan Lietz',
      startsAt: '2026-06-07T20:00:00.000Z',
      meetingTitle: 'Wenstan Penermon Football 2027 GA',
      status: 'scheduled',
      previousAppointmentId: '586604',
      originalAppointmentId: '586604',
      rescheduleSequence: 1,
    },
  ]);

  assert.deepEqual(selected.map((row) => row.id), ['588446']);
});

test('current appointment selection excludes post-meeting result rows from Set Meetings', () => {
  const selected = selectCurrentSetMeetingAppointmentRows([
    {
      id: 'appt_no_show',
      sourceEventId: 'appt_no_show',
      athleteId: '1499428',
      athleteMainId: '954160',
      athleteName: 'Dorian Bentley',
      startsAt: '2026-06-04T23:00:00.000Z',
      meetingTitle: 'Dorian Bentley Football 2028 FL',
      status: 'scheduled',
      postMeetingResult: 'no_show',
    },
    {
      id: 'appt_rsp',
      sourceEventId: 'appt_rsp',
      athleteId: '1499010',
      athleteMainId: '953777',
      athleteName: 'Wenstan Penermon',
      startsAt: '2026-06-07T20:00:00.000Z',
      meetingTitle: 'Wenstan Penermon Football 2027 GA',
      status: 'scheduled',
      postMeetingResult: 'reschedule_pending',
    },
    {
      id: 'appt_active',
      sourceEventId: 'appt_active',
      athleteId: '1499500',
      athleteMainId: '954500',
      athleteName: 'Active Prospect',
      startsAt: '2026-06-07T21:00:00.000Z',
      meetingTitle: 'Active Prospect Football 2028 FL',
      status: 'scheduled',
      postMeetingResult: null,
    },
  ]);

  assert.deepEqual(selected.map((row) => row.id), ['appt_active']);
});

test('current appointment selection keeps repeat appointments when old row is not rescheduled outcome', () => {
  const selected = selectCurrentSetMeetingAppointmentRows([
    {
      id: '588446',
      sourceEventId: '588446',
      athleteId: '1499010',
      athleteMainId: '953777',
      athleteName: 'Repeat Prospect',
      startsAt: '2026-06-04T23:00:00.000Z',
      meetingTitle: 'Repeat Prospect Football',
      status: 'scheduled',
    },
    {
      id: '588447',
      sourceEventId: '588447',
      athleteId: '1499010',
      athleteMainId: '953777',
      athleteName: 'Repeat Prospect',
      startsAt: '2026-06-05T23:00:00.000Z',
      meetingTitle: 'Repeat Prospect Football',
      status: 'scheduled',
    },
  ]);

  assert.deepEqual(selected.map((row) => row.id), ['588446', '588447']);
});

test('weekly appointments render only the new active appointment after reschedule chain selection', () => {
  const candidates = buildSetMeetingCandidatesFromAppointments({
    operatorName: 'Jerami Singleton',
    appointments: [
      {
        id: '586604',
        sourceEventId: '586604',
        athleteId: '1499010',
        athleteMainId: '953777',
        athleteName: 'Wenstan Penermon',
        headScout: 'Ryan Lietz',
        startsAt: '2026-06-03T22:00:00.000Z',
        meetingTitle: 'Wenstan Penermon Football 2027 GA',
        status: 'rescheduled',
        postMeetingResult: 'rescheduled',
      },
      {
        id: '588446',
        sourceEventId: '588446',
        athleteId: '1499010',
        athleteMainId: '953777',
        athleteName: 'Wenstan Penermon',
        headScout: 'Ryan Lietz',
        startsAt: '2026-06-07T20:00:00.000Z',
        meetingTitle: 'Wenstan Penermon Football 2027 GA',
        status: 'scheduled',
        previousAppointmentId: '586604',
      },
    ],
    tasks: [],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].bookedMeeting?.event_id, '588446');
});
