import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreRescheduleRecoverySlot } from './reschedule-recovery-context';
import type { HeadScoutSlot } from './head-scout-schedules';

function slot(overrides: Partial<HeadScoutSlot & { scout_name: string }> = {}) {
  return {
    id: 'slot-1',
    start: '2026-06-15T18:00:00',
    end: '2026-06-15T19:00:00',
    scout_name: 'Coach Foley',
    ...overrides,
  } as HeadScoutSlot & { scout_name: string };
}

test('scoreRescheduleRecoverySlot prioritizes the previous head scout', () => {
  const previousScout = scoreRescheduleRecoverySlot({
    slot: slot({ scout_name: 'Coach Foley' }),
    previousHeadScoutName: 'Foley',
    targetMinutes: null,
    clientTimezone: 'America/New_York',
    weekOffset: 0,
    now: new Date('2026-06-01T12:00:00Z'),
  });
  const differentScout = scoreRescheduleRecoverySlot({
    slot: slot({ scout_name: 'Coach Risner' }),
    previousHeadScoutName: 'Foley',
    targetMinutes: null,
    clientTimezone: 'America/New_York',
    weekOffset: 0,
    now: new Date('2026-06-01T12:00:00Z'),
  });

  assert.ok(previousScout < differentScout);
});

test('scoreRescheduleRecoverySlot penalizes later week offsets after scout priority', () => {
  const thisWeek = scoreRescheduleRecoverySlot({
    slot: slot({ scout_name: 'Coach Foley' }),
    previousHeadScoutName: 'Foley',
    targetMinutes: null,
    clientTimezone: 'America/New_York',
    weekOffset: 0,
    now: new Date('2026-06-01T12:00:00Z'),
  });
  const nextWeek = scoreRescheduleRecoverySlot({
    slot: slot({ scout_name: 'Coach Foley' }),
    previousHeadScoutName: 'Foley',
    targetMinutes: null,
    clientTimezone: 'America/New_York',
    weekOffset: 1,
    now: new Date('2026-06-01T12:00:00Z'),
  });

  assert.ok(thisWeek < nextWeek);
});
