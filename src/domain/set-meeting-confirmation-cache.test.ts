import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSetMeetingConfirmationCacheRows } from './set-meeting-confirmation-cache';

const input = {
  appointmentId: 'apt-1',
  athleteId: 'a1',
  athleteMainId: 'm1',
  athleteName: 'Athlete',
  recipientName: 'Mom',
  recipientPhone: '15554443333',
  headScoutName: 'Scout',
  meetingStartsAt: '2026-05-12T18:00:00-04:00',
  meetingTimezone: 'America/New_York',
  confirmation1Message: 'm1',
  confirmation2Message: 'm2',
  adminUrl: 'https://admin',
  taskUrl: 'https://task',
  generatedAt: '2026-05-10T00:00:00.000Z',
  source: 'set_meetings_confirmation',
};

test('buildSetMeetingConfirmationCacheRows creates exactly two stable rows', () => {
  const rows = buildSetMeetingConfirmationCacheRows(input);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'confirmation_1');
  assert.equal(rows[1].kind, 'confirmation_2');
  assert.notEqual(rows[0].dedupe_key, rows[1].dedupe_key);
  assert.equal(rows[0].dedupe_key, 'set_meeting_confirmation:apt-1:confirmation_1:15554443333');
  assert.equal(rows[0].status, 'cached');
  assert.equal(rows[0].source, 'set_meetings_confirmation');
  assert.equal(rows[0].payload_json.athlete_id, 'a1');
  assert.equal(rows[0].payload_json.recipient_phone, '15554443333');
  assert.equal(rows[0].payload_json.confirmation_kind, 'confirmation_1');
});

test('buildSetMeetingConfirmationCacheRows requires message_body', () => {
  assert.throws(() => buildSetMeetingConfirmationCacheRows({ ...input, confirmation1Message: '' }));
});

test('set meeting confirmation cache stores duration and computed end time', () => {
  const rows = buildSetMeetingConfirmationCacheRows({
    appointmentId: 'event-1',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    recipientName: 'Tiffany Jones',
    recipientPhone: '615-555-1212',
    headScoutName: 'Head Scout D',
    meetingStartsAt: '2026-05-15T19:00:00-04:00',
    meetingTimezone: 'America/New_York',
    meetingDurationMinutes: 60,
    confirmation1Message: 'confirmation one',
    confirmation2Message: 'confirmation two',
    adminUrl:
      'https://legacy-dashboard.example.com/admin/athletes?contactid=1489000&athlete_main_id=951000',
    taskUrl: 'https://legacy-dashboard.example.com/admin/tasks/1',
    generatedAt: '2026-05-14T18:00:00.000Z',
    source: 'set_meetings_confirmation',
  });

  assert.equal(rows[0].meeting_duration_minutes, 60);
  assert.equal(rows[0].meeting_ends_at, '2026-05-16T00:00:00.000Z');
  assert.equal(rows[0].payload_json.meeting_duration_minutes, 60);
  assert.equal(rows[0].payload_json.meeting_ends_at, '2026-05-16T00:00:00.000Z');
  assert.equal(rows[1].meeting_duration_minutes, 60);
  assert.equal(rows[1].meeting_ends_at, '2026-05-16T00:00:00.000Z');
});
