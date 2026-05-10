import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSetMeetingReminderCacheRows } from './set-meeting-reminder-cache';

const input = {
  appointmentId: 'apt-1', athleteId: 'a1', athleteMainId: 'm1', athleteName: 'Athlete',
  recipientName: 'Mom', recipientPhone: '15554443333', headScoutName: 'Scout',
  meetingStartsAt: '2026-05-12T18:00:00-04:00', meetingTimezone: 'America/New_York',
  confirmation1Message: 'm1', confirmation2Message: 'm2', adminUrl: 'https://admin', taskUrl: 'https://task',
  generatedAt: '2026-05-10T00:00:00.000Z', source: 'set_meetings_confirmation',
};

test('buildSetMeetingReminderCacheRows creates exactly two stable rows', () => {
  const rows = buildSetMeetingReminderCacheRows(input);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'confirmation_1');
  assert.equal(rows[1].kind, 'confirmation_2');
  assert.notEqual(rows[0].dedupe_key, rows[1].dedupe_key);
  assert.equal(rows[0].dedupe_key, 'set_meeting_reminder:apt-1:confirmation_1:15554443333');
  assert.equal(rows[0].status, 'cached');
  assert.equal(rows[0].source, 'set_meetings_confirmation');
  assert.equal(rows[0].payload_json.athlete_id, 'a1');
  assert.equal(rows[0].payload_json.recipient_phone, '15554443333');
});

test('buildSetMeetingReminderCacheRows requires message_body', () => {
  assert.throws(() => buildSetMeetingReminderCacheRows({ ...input, confirmation1Message: '' }));
});
