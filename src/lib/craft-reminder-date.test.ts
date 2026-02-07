import test from 'node:test';
import assert from 'node:assert/strict';
import { getInQueueReminderDefaultDate } from './craft-reminder-date.js';

test('getInQueueReminderDefaultDate: uses video due date and subtracts 2 days', () => {
  const result = getInQueueReminderDefaultDate('February 09, 2026');
  const yyyyMmDd = result.toISOString().slice(0, 10);
  assert.equal(yyyyMmDd, '2026-02-07');
});

test('getInQueueReminderDefaultDate: falls back to now when video due date is invalid', () => {
  const fixedNow = new Date('2026-02-06T12:00:00.000Z');
  const result = getInQueueReminderDefaultDate('not-a-date', fixedNow);
  assert.equal(result.toISOString(), fixedNow.toISOString());
});
