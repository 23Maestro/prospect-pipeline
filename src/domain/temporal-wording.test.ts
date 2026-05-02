import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getConfirmationDayPhrase,
  getConfirmationDatePhrase,
  getMeetingTimeOfDayBucket,
  getReminderTimeLabel,
} from './temporal-wording';

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
