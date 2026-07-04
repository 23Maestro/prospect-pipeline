import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMeetingSetLaravelPayload } from './meeting-set-contract';

test('meeting set contract builds Laravel payload with legacy field names', () => {
  const payload = buildMeetingSetLaravelPayload({
    athleteId: '1489000',
    athleteMainId: '951000',
    meetingName: 'Avery Jones Soccer 2027 PA',
    meetingTimezone: 'EST',
    assignedToLegacyUserId: '200002',
    meetingForLegacyUserId: '200002',
    openEventId: '613999',
    calendarOwnerId: 'calendar_owner_b',
    bookedMeetingAssignedOwner: 'Head Scout B',
    taskDescription: 'Main Number:\nOther Details:',
    startTime: '19:00',
    meetingLength: '01:00',
  });

  assert.equal(payload.assigned_to, '200002');
  assert.equal(payload.meeting_for, '200002');
  assert.equal(payload.meetingfor, '200002');
  assert.equal(payload.open_event_id, '613999');
  assert.equal(payload.calendar_owner_id, 'calendar_owner_b');
  assert.equal(payload.booked_meeting_assigned_owner, 'Head Scout B');
});
