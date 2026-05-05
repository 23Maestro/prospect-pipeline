import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalFallbackEmail,
  buildCalFollowUpBookingPayload,
  normalizePhoneToE164,
} from './cal-follow-ups.js';

test('normalizePhoneToE164 formats US callback numbers', () => {
  assert.equal(normalizePhoneToE164('615-555-1212'), '+16155551212');
  assert.equal(normalizePhoneToE164('1 (615) 555-1212'), '+16155551212');
  assert.equal(normalizePhoneToE164('+44 20 7946 0958'), '+442079460958');
});

test('buildCalFallbackEmail creates a stable email from phone or contact name', () => {
  assert.equal(
    buildCalFallbackEmail({
      phone: '615-555-1212',
      contactName: 'Tiffany Rawls',
    }),
    'followup+6155551212@example.com',
  );
  assert.equal(
    buildCalFallbackEmail({
      contactName: 'Tiffany Rawls',
    }),
    'followup+tiffany-rawls@example.com',
  );
});

test('buildCalFollowUpBookingPayload forces exact-time Cal booking with metadata', () => {
  const payload = buildCalFollowUpBookingPayload(
    {
      start: new Date('2026-05-05T20:30:00.000Z'),
      contactName: 'Tiffany Rawls',
      phone: '615-555-1212',
      athleteName: 'Carlos Rawls',
      contactId: '123',
      athleteMainId: '456',
      timeZone: 'America/Chicago',
    },
    {
      calFollowUpEventTypeId: '789',
    },
  );

  assert.equal(payload.start, '2026-05-05T20:30:00.000Z');
  assert.equal(payload.eventTypeId, 789);
  assert.equal(payload.attendee.name, 'Tiffany Rawls');
  assert.equal(payload.attendee.email, 'followup+6155551212@example.com');
  assert.equal(payload.attendee.phoneNumber, '+16155551212');
  assert.equal(payload.attendee.timeZone, 'America/Chicago');
  assert.equal(payload.allowConflicts, true);
  assert.equal(payload.allowBookingOutOfBounds, true);
  assert.equal(payload.metadata.athleteName, 'Carlos Rawls');
  assert.equal(
    payload.metadata.dashboardUrl,
    'https://dashboard.nationalpid.com/admin/athletes?contactid=123&athlete_main_id=456',
  );
});

test('buildCalFollowUpBookingPayload requires event type id', () => {
  assert.throws(
    () =>
      buildCalFollowUpBookingPayload(
        {
          start: new Date('2026-05-05T20:30:00.000Z'),
          contactName: 'Tiffany Rawls',
          phone: '615-555-1212',
          athleteName: 'Carlos Rawls',
        },
        {},
      ),
    /Set Cal Follow Up Event Type ID/,
  );
});
