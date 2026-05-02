import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMeetingDayLabel,
  buildSetMeetingCandidate,
  buildSetMeetingCandidatesFromBookedMeetings,
  getMeetingSortValue,
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

test('weekly booked meeting candidates only materialize active-operator matches', () => {
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

  assert.deepEqual(candidates.map((candidate) => candidate.athleteName), ['Avery Jones']);
});
