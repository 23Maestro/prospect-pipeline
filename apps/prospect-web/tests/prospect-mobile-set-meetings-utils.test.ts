import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCurrentCachedMeeting,
  parseCachedMeetingInstant,
} from '../public/prospect-mobile/set-meetings-utils.mjs';

test('cached meeting timestamps stay as real instants instead of subtracting fixed EST offset', () => {
  assert.equal(
    parseCachedMeetingInstant('2026-05-23T14:00:00Z')?.toISOString(),
    '2026-05-23T14:00:00.000Z',
  );
});

test('mobile set meetings hides past meetings for this week using display local time', () => {
  const reloadTime = new Date('2026-05-22T00:43:00Z'); // May 21, 8:43 PM Eastern

  assert.equal(isCurrentCachedMeeting('2026-05-19T00:00:00Z', 'this', reloadTime), false);
  assert.equal(isCurrentCachedMeeting('2026-05-21T23:30:00Z', 'this', reloadTime), false);
  assert.equal(isCurrentCachedMeeting('2026-05-22T02:00:00Z', 'this', reloadTime), true);
});

test('mobile set meetings keeps next week rows independent from current reload clock', () => {
  const reloadTime = new Date('2026-05-22T00:43:00Z');

  assert.equal(isCurrentCachedMeeting('2026-05-19T00:00:00Z', 'next', reloadTime), true);
});
