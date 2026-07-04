import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookedMeetingLookupWindow,
  buildHeadScoutWeekWindow,
  filterVisibleHeadScoutSlots,
  formatHeadScoutNaturalSlotLabel,
  formatHeadScoutSlotDate,
  formatHeadScoutSlotStartLabel,
  formatHeadScoutSlotTimeRange,
  getCurrentEasternSlotStamp,
  HEAD_SCOUT_ORDER,
  type HeadScoutSlot,
} from './head-scout-schedules';

test('buildHeadScoutWeekWindow anchors to Monday in EST', () => {
  const now = new Date('2026-04-16T16:30:00Z');
  const current = buildHeadScoutWeekWindow(0, now);
  const next = buildHeadScoutWeekWindow(1, now);

  assert.deepEqual(current, { start: '2026-04-13', end: '2026-04-20' });
  assert.deepEqual(next, { start: '2026-04-20', end: '2026-04-27' });
});

test('filterVisibleHeadScoutSlots hides past slots only in current week', () => {
  const now = new Date('2026-04-16T20:30:00Z');
  const slots: HeadScoutSlot[] = [
    { id: '1', start: '2026-04-16T15:00', end: '2026-04-16T16:00', scout_name: 'Head Scout B' },
    { id: '2', start: '2026-04-16T17:00', end: '2026-04-16T18:00', scout_name: 'Head Scout B' },
  ];

  assert.equal(getCurrentEasternSlotStamp(now), '2026-04-16T16:30');
  assert.deepEqual(
    filterVisibleHeadScoutSlots(slots, 0, now).map((slot) => slot.id),
    ['2'],
  );
  assert.deepEqual(
    filterVisibleHeadScoutSlots(slots, 1, now).map((slot) => slot.id),
    ['1', '2'],
  );
});

test('booked meeting lookup window is wider than the due-date month', () => {
  assert.deepEqual(
    buildBookedMeetingLookupWindow(
      new Date('2026-04-19T18:00:00Z'),
      new Date('2026-04-20T12:00:00Z'),
    ),
    { start: '2026-03-05', end: '2026-08-18' },
  );
});

test('head scout order includes canonical calendar owner and meeting-for ids', () => {
  const jeffrey = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout B');
  const luther = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout C');
  const david = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout A');
  const nasir = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout H');
  const ryan = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout D');
  const james = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout E');
  const logan = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout F');
  const kenton = HEAD_SCOUT_ORDER.find((scout) => scout.scout_name === 'Head Scout G');

  assert.deepEqual(
    {
      city: david?.city,
      state: david?.state,
      calendar_owner_id: david?.calendar_owner_id,
      meeting_for: david?.meeting_for,
    },
    {
      city: 'Example City',
      state: 'FL',
      calendar_owner_id: 'calendar_owner_a',
      meeting_for: '200001',
    },
  );
  assert.deepEqual(
    {
      calendar_owner_id: jeffrey?.calendar_owner_id,
      meeting_for: jeffrey?.meeting_for,
    },
    { calendar_owner_id: 'calendar_owner_b', meeting_for: '200002' },
  );
  assert.deepEqual(
    {
      calendar_owner_id: luther?.calendar_owner_id,
      meeting_for: luther?.meeting_for,
    },
    { calendar_owner_id: 'calendar_owner_c', meeting_for: '200003' },
  );
  assert.deepEqual(
    {
      city: nasir?.city,
      state: nasir?.state,
      calendar_owner_id: nasir?.calendar_owner_id,
      meeting_for: nasir?.meeting_for,
    },
    {
      city: 'Example City',
      state: 'TN',
      calendar_owner_id: 'calendar_owner_h',
      meeting_for: '200008',
    },
  );
  assert.deepEqual(
    {
      calendar_owner_id: ryan?.calendar_owner_id,
      meeting_for: ryan?.meeting_for,
    },
    { calendar_owner_id: 'calendar_owner_d', meeting_for: '200004' },
  );
  assert.deepEqual(
    {
      city: james?.city,
      state: james?.state,
      calendar_owner_id: james?.calendar_owner_id,
      meeting_for: james?.meeting_for,
    },
    {
      city: 'Example City',
      state: 'NC',
      calendar_owner_id: 'calendar_owner_e',
      meeting_for: '200005',
    },
  );
  assert.deepEqual(
    {
      city: logan?.city,
      state: logan?.state,
      calendar_owner_id: logan?.calendar_owner_id,
      meeting_for: logan?.meeting_for,
    },
    {
      city: 'Example City',
      state: 'SC',
      calendar_owner_id: 'calendar_owner_f',
      meeting_for: '200006',
    },
  );
  assert.deepEqual(
    {
      city: kenton?.city,
      state: kenton?.state,
      calendar_owner_id: kenton?.calendar_owner_id,
      meeting_for: kenton?.meeting_for,
    },
    {
      city: 'Example City',
      state: 'VA',
      calendar_owner_id: 'calendar_owner_g',
      meeting_for: '200007',
    },
  );
});

test('formatHeadScoutSlotTimeRange renders EST 12-hour labels', () => {
  assert.equal(
    formatHeadScoutSlotTimeRange('2026-04-16T17:00', '2026-04-16T18:00'),
    '5:00 PM - 6:00 PM EST',
  );
});

test('formatHeadScoutSlotStartLabel removes duplicate periods and compacts timezone', () => {
  assert.equal(formatHeadScoutSlotStartLabel('5:00 PM - 6:00 PM EST', 'EST'), '5PM ET');
  assert.equal(formatHeadScoutSlotStartLabel('6PM - 7PM Eastern', 'Eastern'), '6PM ET');
  assert.equal(formatHeadScoutSlotStartLabel('6:30 PM - 7:30 PM Central', 'Central'), '6:30PM CT');
});

test('formatHeadScoutNaturalSlotLabel renders natural client-timezone labels', () => {
  assert.deepEqual(
    formatHeadScoutNaturalSlotLabel('2026-06-01T18:00', '2026-06-01T19:00', 'America/Chicago'),
    {
      dateLabel: 'Monday, June 1',
      timeLabel: '5PM CT',
      messageLabel: 'Monday, June 1 at 5PM CT',
      zoneLabel: 'CT',
    },
  );
});

test('formatHeadScoutNaturalSlotLabel resolves legacy EST with daylight saving time', () => {
  assert.deepEqual(formatHeadScoutNaturalSlotLabel('2026-05-27T17:00', '2026-05-27T18:00', 'EST'), {
    dateLabel: 'Wednesday, May 27',
    timeLabel: '5PM ET',
    messageLabel: 'Wednesday, May 27 at 5PM ET',
    zoneLabel: 'ET',
  });
});

test('formatHeadScoutSlotDate guards malformed slot values', () => {
  assert.equal(formatHeadScoutSlotDate('16:00'), 'Unknown Date');
});
