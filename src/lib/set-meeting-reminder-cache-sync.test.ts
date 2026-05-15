import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScoutPrepContext } from '../features/scout-prep/types';
import { buildMeetingSetReminderCacheRowsFromScoutPrep } from './set-meeting-reminder-cache-sync';

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

test('buildMeetingSetReminderCacheRowsFromScoutPrep caches both confirmation messages after Meeting Set save', () => {
  const rows = buildMeetingSetReminderCacheRowsFromScoutPrep({
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
  assert.equal(rows[0].admin_url, 'https://dashboard.nationalpid.com/admin/athletes?contactid=1489000&athlete_main_id=951000');
  assert.equal(rows[0].kind, 'confirmation_1');
  assert.equal(rows[1].kind, 'confirmation_2');
  assert.match(rows[0].message_body, /Prospect ID Zoom Meeting/);
  assert.match(rows[1].message_body, /Please reply YES/);
});
