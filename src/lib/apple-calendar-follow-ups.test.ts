import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppleCalendarFollowUpEventDraft } from './apple-calendar-follow-ups.js';

test('buildAppleCalendarFollowUpEventDraft creates a follow-up event with alert', () => {
  const event = buildAppleCalendarFollowUpEventDraft({
    start: new Date('2026-05-05T18:00:00.000Z'),
    contactName: 'Twila Davis',
    phone: '3346892843',
    athleteName: 'Naylon Murphy',
    contactId: '123',
    athleteMainId: '456',
    durationMinutes: 45,
  });

  assert.equal(event.title, 'Follow Up: Twila Davis');
  assert.equal(event.start.toISOString(), '2026-05-05T18:00:00.000Z');
  assert.equal(event.end.toISOString(), '2026-05-05T18:45:00.000Z');
  assert.equal(event.alertMinutesBefore, 10);
  assert.match(event.notes, /SA:Naylon Murphy - 3346892843/);
  assert.match(
    event.notes,
    /https:\/\/dashboard\.nationalpid\.com\/admin\/athletes\?contactid=123&athlete_main_id=456/,
  );
});

test('buildAppleCalendarFollowUpEventDraft defaults duration to 15 minutes', () => {
  const event = buildAppleCalendarFollowUpEventDraft({
    start: new Date('2026-05-05T18:00:00.000Z'),
    contactName: 'Twila Davis',
    phone: '3346892843',
    athleteName: 'Naylon Murphy',
  });

  assert.equal(event.end.toISOString(), '2026-05-05T18:15:00.000Z');
});
