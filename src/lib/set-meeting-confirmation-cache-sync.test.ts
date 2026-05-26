import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScoutPrepContext } from '../features/scout-prep/types';
import { buildMeetingSetConfirmationCacheRowsFromScoutPrep } from './set-meeting-confirmation-cache-sync';

function buildContext(): ScoutPrepContext {
  return {
    task: {
      contact_id: '1489000',
      athlete_main_id: '951000',
      athlete_name: 'Avery Jones',
      athlete_task_url: 'https://dashboard.nationalpid.com/admin/tasks/1',
    },
    resolved: {
      athlete_id: '1489000',
      athlete_main_id: '951000',
      head_scout: 'Ryan Lietz',
      sport: 'Football',
    },
    contactInfo: {
      contactId: '1489000',
      studentAthlete: {
        name: 'Avery Jones',
        email: null,
        phone: '615-555-3000',
      },
      parent1: {
        name: 'Tiffany Jones',
        relationship: 'Mother',
        email: null,
        phone: '615-555-1212',
      },
      parent2: null,
    },
    notes: [],
    tasks: [],
  };
}

test('buildMeetingSetConfirmationCacheRowsFromScoutPrep caches both confirmation messages after Meeting Set save', () => {
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep({
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    context: buildContext(),
    meetingSet: {
      openEventId: 'event-1',
      startsAt: '2026-05-15T19:00:00-04:00',
      meetingTimezone: 'EST',
      meetingLength: '01:30',
      headScout: 'Ryan Lietz',
    },
    generatedAt: '2026-05-14T18:00:00.000Z',
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].appointment_id, 'event-1');
  assert.equal(rows[0].athlete_key, '1489000:951000');
  assert.equal(rows[0].recipient_phone, '615-555-1212');
  assert.equal(rows[0].meeting_duration_minutes, 90);
  assert.equal(rows[0].meeting_ends_at, '2026-05-16T00:30:00.000Z');
  assert.equal(
    rows[0].admin_url,
    'https://dashboard.nationalpid.com/admin/athletes?contactid=1489000&athlete_main_id=951000',
  );
  assert.equal(rows[0].kind, 'confirmation_1');
  assert.equal(rows[1].kind, 'confirmation_2');
  assert.match(rows[0].message_body, /Prospect ID Zoom Meeting/);
  assert.match(rows[1].message_body, /Please reply YES/);
});

test('buildMeetingSetConfirmationCacheRowsFromScoutPrep fails when required mobile cache fields are missing', () => {
  assert.throws(
    () =>
      buildMeetingSetConfirmationCacheRowsFromScoutPrep({
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        context: buildContext(),
        meetingSet: {
          startsAt: '2026-05-15T19:00:00-04:00',
          meetingTimezone: 'EST',
          meetingLength: '01:00',
          headScout: 'Ryan Lietz',
        },
        generatedAt: '2026-05-14T18:00:00.000Z',
      }),
    /Missing required Meeting Set confirmation cache fields: appointmentId/,
  );
});

test('buildMeetingSetConfirmationCacheRowsFromScoutPrep fails when meeting length is missing', () => {
  assert.throws(
    () =>
      buildMeetingSetConfirmationCacheRowsFromScoutPrep({
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        context: buildContext(),
        meetingSet: {
          openEventId: 'event-1',
          startsAt: '2026-05-15T19:00:00-04:00',
          meetingTimezone: 'EST',
          headScout: 'Ryan Lietz',
        },
        generatedAt: '2026-05-14T18:00:00.000Z',
      }),
    /Missing required Meeting Set confirmation cache fields: meetingLength/,
  );
});

test('buildMeetingSetConfirmationCacheRowsFromScoutPrep fails when meeting length is invalid', () => {
  assert.throws(
    () =>
      buildMeetingSetConfirmationCacheRowsFromScoutPrep({
        athleteId: '1489000',
        athleteMainId: '951000',
        athleteName: 'Avery Jones',
        context: buildContext(),
        meetingSet: {
          openEventId: 'event-1',
          startsAt: '2026-05-15T19:00:00-04:00',
          meetingTimezone: 'EST',
          meetingLength: 'bad',
          headScout: 'Ryan Lietz',
        },
        generatedAt: '2026-05-14T18:00:00.000Z',
      }),
    /Invalid Meeting Set confirmation cache meeting length: bad/,
  );
});


test('buildMeetingSetConfirmationCacheRowsFromScoutPrep writes weekend cache messages for intended send day', () => {
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep({
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    context: buildContext(),
    meetingSet: {
      openEventId: 'event-1',
      startsAt: '2026-05-23T10:00:00',
      meetingTimezone: 'EST',
      meetingLength: '01:00',
      headScout: 'Ryan Lietz',
    },
    generatedAt: '2026-05-22T12:00:00.000Z',
  });

  assert.match(
    rows[0].message_body,
    /Prospect ID Zoom Meeting tomorrow morning 5\/23 at 10:00 AM ET/,
  );
  assert.match(rows[1].message_body, /still has you down for 10:00am eastern tomorrow morning/);
});

test('buildMeetingSetConfirmationCacheRowsFromScoutPrep writes weekday cache messages for same-day send', () => {
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep({
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    context: buildContext(),
    meetingSet: {
      openEventId: 'event-1',
      startsAt: '2026-05-25T18:00:00',
      meetingTimezone: 'CST',
      meetingLength: '01:00',
      headScout: 'Ryan Lietz',
    },
    generatedAt: '2026-05-22T12:00:00.000Z',
  });

  assert.match(rows[0].message_body, /Prospect ID Zoom Meeting tonight 5\/25 at 6:00 PM CT/);
  assert.match(rows[1].message_body, /still has you down for 6:00pm central tonight/);
});


test('central labels keep 7:00 PM CT and central wording for both confirmations', () => {
  const rows = buildMeetingSetConfirmationCacheRowsFromScoutPrep({
    athleteId: '1489000', athleteMainId: '951000', athleteName: 'Avery Jones', context: buildContext(),
    meetingSet: { openEventId: 'event-2', startsAt: '2026-05-25T19:00:00', meetingTimezone: 'Central', meetingLength: '01:00', headScout: 'Ryan Lietz' },
    generatedAt: '2026-05-22T12:00:00.000Z',
  });
  assert.match(rows[0].message_body, /7:00 PM CT/);
  assert.match(rows[1].message_body, /7:00pm central/);
  assert.doesNotMatch(rows[0].message_body, /8:00 PM ET/);
});
