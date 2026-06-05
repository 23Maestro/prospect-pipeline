import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterActiveSetMeetingEvents,
  isActiveSetMeetingAppointmentStatus,
  isCurrentCachedMeeting,
  parseCachedMeetingInstant,
// @ts-expect-error Static browser module does not ship TypeScript declarations.
} from '../public/prospect-mobile/set-meetings-utils.mjs';

test('cached meeting timestamps stay as real instants instead of subtracting fixed EST offset', () => {
  assert.equal(
    parseCachedMeetingInstant('2026-05-23T14:00:00Z')?.toISOString(),
    '2026-05-23T14:00:00.000Z',
  );
});

test('mobile set meetings hides past meetings for this week using display local time', () => {
  const reloadTime = new Date('2026-05-22T00:43:00Z'); // May 21, 8:43 PM Eastern

  assert.equal(isCurrentCachedMeeting('2026-05-19T00:00:00Z', 'this', reloadTime), false);
  assert.equal(isCurrentCachedMeeting('2026-05-21T23:30:00Z', 'this', reloadTime), false);
  assert.equal(isCurrentCachedMeeting('2026-05-22T02:00:00Z', 'this', reloadTime), true);
  assert.equal(
    isCurrentCachedMeeting(
      '2026-05-21T23:00:00Z',
      'this',
      reloadTime,
      '2026-05-22T00:00:00Z',
    ),
    false,
  );
});

test('mobile set meetings keeps next week rows independent from current reload clock', () => {
  const reloadTime = new Date('2026-05-22T00:43:00Z');

  assert.equal(isCurrentCachedMeeting('2026-05-19T00:00:00Z', 'next', reloadTime), true);
});

test('mobile set meetings only admits active appointment statuses', () => {
  assert.equal(isActiveSetMeetingAppointmentStatus('scheduled'), true);
  assert.equal(isActiveSetMeetingAppointmentStatus('confirmation_queued'), true);
  assert.equal(isActiveSetMeetingAppointmentStatus('confirmation_sent'), true);
  assert.equal(isActiveSetMeetingAppointmentStatus('rescheduled'), true);
  assert.equal(isActiveSetMeetingAppointmentStatus('reschedule_pending'), false);
  assert.equal(isActiveSetMeetingAppointmentStatus('no_show'), false);
  assert.equal(isActiveSetMeetingAppointmentStatus('closed_won'), false);
});

test('mobile set meetings filters confirmation-cache rows through appointment truth', () => {
  const events = [
    { appointment_id: 'baker', athlete_name: 'Baker' },
    { appointment_id: 'kale', athlete_name: 'Kale' },
    { appointment_id: 'shown_status_only', athlete_name: 'Shown Status Only' },
    { appointment_id: 'active', athlete_name: 'Active' },
  ];

  assert.deepEqual(
    filterActiveSetMeetingEvents(
      events,
      new Map([
        ['baker', { status: 'reschedule_pending' }],
        ['kale', { status: 'scheduled', post_meeting_result: 'no_show' }],
        ['shown_status_only', { status: 'scheduled', postMeetingResult: 'reschedule_pending' }],
        ['active', { status: 'scheduled' }],
      ]),
    ).map((event: { athlete_name?: string }) => event.athlete_name),
    ['Active'],
  );
});
