import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getConfirmationDayPhrase,
  getConfirmationClockLabel,
  getConfirmationDatePhrase,
  getConfirmationTimezoneLabel,
  getGreetingForLocalTime,
  getMeetingReminderPhrase,
  getMeetingTimeOfDayPhrase,
  getMeetingTimeOfDayBucket,
  getReminderTimeLabel,
  resolveIanaTimeZoneFromLegacyLabel,
  resolveLegacyTimezoneLabelFromIana,
} from './outreach-time-wording';

test('same-day Friday evening meeting says tonight', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-01T14:00:00.000Z'),
      meetingStart: new Date('2026-05-01T23:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'tonight',
  );
});

test('same-day Friday afternoon meeting says this afternoon', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-01T14:00:00.000Z'),
      meetingStart: new Date('2026-05-01T18:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'this afternoon',
  );
});

test('Friday to Saturday morning meeting says tomorrow morning', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-01T14:00:00.000Z'),
      meetingStart: new Date('2026-05-02T14:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'tomorrow morning',
  );
});

test('Friday evening to Saturday evening meeting says tomorrow evening', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-01T22:00:00.000Z'),
      meetingStart: new Date('2026-05-02T23:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'tomorrow evening',
  );
});

test('same-day Saturday evening meeting says tonight', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-02T13:00:00.000Z'),
      meetingStart: new Date('2026-05-02T23:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'tonight',
  );
});

test('Saturday to Sunday morning meeting says tomorrow morning', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-02T13:00:00.000Z'),
      meetingStart: new Date('2026-05-03T15:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'tomorrow morning',
  );
});

test('Thursday to Saturday meeting does not say tomorrow', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-04-30T13:00:00.000Z'),
      meetingStart: new Date('2026-05-02T15:00:00.000Z'),
      meetingTimezone: 'EST',
    }),
    'on Saturday morning',
  );
});

test('meeting timezone controls date comparison instead of machine timezone', () => {
  assert.equal(
    getConfirmationDayPhrase({
      now: new Date('2026-05-02T04:30:00.000Z'),
      meetingStart: new Date('2026-05-02T06:30:00.000Z'),
      meetingTimezone: 'PST',
    }),
    'tonight',
  );
});

test('date phrase and reminder label use the same meeting timezone helpers', () => {
  const meetingStart = new Date('2026-05-02T23:00:00.000Z');

  assert.equal(getMeetingTimeOfDayBucket(meetingStart, 'EST'), 'evening');
  assert.equal(
    getConfirmationDatePhrase({
      now: new Date('2026-05-01T22:00:00.000Z'),
      meetingStart,
      meetingTimezone: 'EST',
    }),
    'tomorrow evening 5/2',
  );
  assert.equal(getReminderTimeLabel({ meetingStart, meetingTimezone: 'EST' }), '7:00pm eastern');
});

test('requested API resolves legacy and IANA timezone labels', () => {
  assert.equal(resolveIanaTimeZoneFromLegacyLabel('CST'), 'America/Chicago');
  assert.equal(resolveLegacyTimezoneLabelFromIana('America/Los_Angeles'), 'PST');
  assert.equal(resolveLegacyTimezoneLabelFromIana('America/Phoenix'), 'MST');
});

test('requested API builds greeting and meeting reminder phrases from meeting timezone', () => {
  const now = new Date('2026-05-01T14:00:00.000Z');
  const meetingStart = new Date('2026-05-01T23:00:00.000Z');

  assert.equal(getGreetingForLocalTime({ now, meetingTimezone: 'EST' }), 'Good morning');
  assert.equal(getMeetingTimeOfDayPhrase({ meetingStart, meetingTimezone: 'EST' }), 'evening');
  assert.equal(
    getMeetingReminderPhrase({ now, meetingStart, meetingTimezone: 'EST' }),
    '7:00pm eastern tonight',
  );
});

test('confirmation clock and timezone labels come from the same timezone resolver', () => {
  const meetingStart = new Date('2026-04-26T19:00:00.000Z');

  assert.equal(getConfirmationClockLabel({ meetingStart, meetingTimezone: 'CST' }), '2:00 PM');
  assert.equal(getConfirmationTimezoneLabel('CST'), 'CT');
});
