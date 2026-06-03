import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_BOOKED_MEETING_CONFIRMATION_PREFIXES,
  NON_ACTIVE_BOOKED_MEETING_PREFIXES,
  buildWeeklyOperatorMeetingSetCandidates,
  isActualSetMeetingTitle,
  resolveBookedMeetingTitleOutcome,
} from './booked-meeting-source';

test('weekly operator meeting-set candidates render booked meetings and enrich matching operator confirmation task', () => {
  const candidates = buildWeeklyOperatorMeetingSetCandidates({
    operatorName: 'Jerami Singleton',
    bookedMeetings: [
      {
        event_id: '613999',
        title: 'Bryce Hill Football 2026 PA',
        assigned_owner: 'Ryan Lietz',
        start: '2026-05-04T19:00:00-04:00',
        end: '2026-05-04T20:00:00-04:00',
        date_time_label: 'Mon 05/04/26 7:00 PM - 8:00 PM',
      },
      {
        event_id: '614000',
        athlete_id: '1491001',
        athlete_main_id: '952901',
        athlete_name: 'Other Athlete',
        title: 'Other Athlete Football 2026 PA',
        assigned_owner: 'Ryan Lietz',
        start: '2026-05-04T21:00:00-04:00',
        end: '2026-05-04T22:00:00-04:00',
      },
    ],
    tasks: [
      {
        task_id: '9001',
        athlete_id: '1491000',
        athlete_main_id: '952900',
        athlete_name: 'Bryce Hill',
        assigned_owner: 'Jerami Singleton',
        title: 'Confirmation Call',
        description: 'Confirm the meeting set',
        due_date: '2026-05-01T15:00:00-04:00',
      },
      {
        task_id: '9002',
        athlete_id: '1491001',
        athlete_main_id: '952901',
        athlete_name: 'Other Athlete',
        assigned_owner: 'Tim Risner',
        title: 'Confirmation Call',
        description: 'Confirm the meeting set',
      },
    ],
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].athleteKey, '1491000:952900');
  assert.equal(candidates[0].athleteName, 'Bryce Hill');
  assert.equal(candidates[0].taskAssignedOwner, 'Jerami Singleton');
  assert.equal(candidates[0].bookedMeeting.eventId, '613999');
  assert.equal(candidates[0].bookedMeeting.assignedOwner, 'Ryan Lietz');
  assert.equal(candidates[0].evidence.source, 'weekly_booked_meetings_with_operator_confirmation_task');
  assert.equal(candidates[1].athleteName, 'Other Athlete');
  assert.equal(candidates[1].taskId, '');
  assert.equal(candidates[1].evidence.source, 'weekly_booked_meetings_without_confirmation_task');
});

test('booked meeting title helper keeps active confirmation prefixes countable', () => {
  assert.deepEqual([...ACTIVE_BOOKED_MEETING_CONFIRMATION_PREFIXES], ['(ACF)', '(CF)', '(ACF*2)']);

  for (const title of [
    '(ACF) Bryce Hill Football 2026 PA',
    '(CF) Bryce Hill Football 2026 PA',
    '(ACF*2) Bryce Hill Football 2026 PA',
    'Bryce Hill Football 2026 PA',
  ]) {
    assert.equal(resolveBookedMeetingTitleOutcome(title), 'active');
    assert.equal(isActualSetMeetingTitle(title), true);
  }
});

test('booked meeting title helper excludes terminal and non-active prefixes', () => {
  assert.deepEqual([...NON_ACTIVE_BOOKED_MEETING_PREFIXES], ['(ENR)', '(FU)', '(CL)', '(CAN)', '(NS)', '(RSP)']);

  assert.equal(resolveBookedMeetingTitleOutcome('(ENR $99 - Post Date) Bryce Hill Football 2026 PA'), 'terminal_enrollment');
  assert.equal(resolveBookedMeetingTitleOutcome('(FU) Bryce Hill Football 2026 PA'), 'soft_archive_follow_up');
  assert.equal(resolveBookedMeetingTitleOutcome('(CL) Bryce Hill Football 2026 PA'), 'terminal_close_lost');
  assert.equal(resolveBookedMeetingTitleOutcome('(CAN) Bryce Hill Football 2026 PA'), 'soft_archive_canceled');
  assert.equal(resolveBookedMeetingTitleOutcome('(NS)*2 Bryce Hill Football 2026 PA'), 'soft_archive_no_show');
  assert.equal(resolveBookedMeetingTitleOutcome('(RSP) Bryce Hill Football 2026 PA'), 'reschedule_pending');

  for (const title of [
    '(ENR $99 - Post Date) Bryce Hill Football 2026 PA',
    '(FU) Bryce Hill Football 2026 PA',
    '(CL) Bryce Hill Football 2026 PA',
    '(CAN) Bryce Hill Football 2026 PA',
    '(NS)*2 Bryce Hill Football 2026 PA',
    '(RSP) Bryce Hill Football 2026 PA',
  ]) {
    assert.equal(isActualSetMeetingTitle(title), false);
  }
});
