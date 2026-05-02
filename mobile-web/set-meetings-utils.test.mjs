import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanMeetingTitle, isActualSetMeetingEvent } from './set-meetings-utils.mjs';

test('set meeting filter keeps active confirmation prefixes visible', () => {
  assert.equal(isActualSetMeetingEvent({ title: '(ACF) Matthew Lindsey Football 2027 NV' }), true);
  assert.equal(isActualSetMeetingEvent({ title: '(ACF*2) Ancel Bynaum Jr Football 2029 TX' }), true);
  assert.equal(isActualSetMeetingEvent({ title: '(CF) Messiah Cummings Football 2029 KY' }), true);
});

test('set meeting filter hides follow-up and terminal result prefixes', () => {
  assert.equal(isActualSetMeetingEvent({ title: 'Follow Up - Poppy Kingan Women Soccer 2028' }), false);
  assert.equal(isActualSetMeetingEvent({ title: '(FU) Messiah Cummings Football 2029 KY' }), false);
  assert.equal(isActualSetMeetingEvent({ title: '(RSP) Jordan Niles Basketball 2026 NC' }), false);
  assert.equal(isActualSetMeetingEvent({ title: '(CAN) Levi Childers Football 2026 CA' }), false);
  assert.equal(isActualSetMeetingEvent({ title: '(NS) Kaleb Rivera Football 2029 PA' }), false);
  assert.equal(isActualSetMeetingEvent({ title: '(CL) Example Athlete Football 2029 PA' }), false);
});

test('clean meeting title removes display prefixes only', () => {
  assert.equal(cleanMeetingTitle('(ACF) Matthew Lindsey Football 2027 NV'), 'Matthew Lindsey Football 2027 NV');
  assert.equal(cleanMeetingTitle('(CF) Messiah Cummings Football 2029 KY'), 'Messiah Cummings Football 2029 KY');
  assert.equal(cleanMeetingTitle('Skyler Pyke Football 2030 TN'), 'Skyler Pyke Football 2030 TN');
});
