import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPOINTMENT_TITLE_PREFIXES,
  applyAppointmentTitlePrefix,
} from './head-scout-event-prefix';

test('adds prefix to unprefixed title', () => {
  assert.equal(
    applyAppointmentTitlePrefix('Victor Williams Football 2027 FL', '(ACF)'),
    '(ACF) Victor Williams Football 2027 FL',
  );
});

test('replaces existing known prefix', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(RSP) Victor Williams Football 2027 FL', '(CF)'),
    '(CF) Victor Williams Football 2027 FL',
  );
});

test('avoids duplicating the same prefix', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(CAN) Victor Williams Football 2027 FL', '(CAN)'),
    '(CAN) Victor Williams Football 2027 FL',
  );
});

test('preserves athlete title text', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(ACF) Donzi Ojeikere Football 2028 TX', '(ACF*2)'),
    '(ACF*2) Donzi Ojeikere Football 2028 TX',
  );
});

test('handles unknown existing prefix safely', () => {
  assert.equal(
    applyAppointmentTitlePrefix('(FU) Donzi Ojeikere Football 2028 TX', '(CF)'),
    '(CF) (FU) Donzi Ojeikere Football 2028 TX',
  );
});

test('exported prefixes stay in expected order', () => {
  assert.deepEqual(APPOINTMENT_TITLE_PREFIXES, ['(ACF)', '(CF)', '(RSP)', '(CAN)', '(ACF*2)']);
});
