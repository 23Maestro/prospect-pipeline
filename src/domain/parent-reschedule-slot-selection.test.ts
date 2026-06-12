import assert from 'node:assert/strict';
import test from 'node:test';
import { selectParentRescheduleSlots } from './parent-reschedule-slot-selection';

function slot(overrides: Partial<Parameters<typeof selectParentRescheduleSlots>[0]['slots'][number]>) {
  return {
    id: overrides.id || 'slot',
    scoutName: overrides.scoutName || 'Coach Ryan',
    messageLabel: overrides.messageLabel || 'Mon, Jun 15 at 6:00 PM ET',
    weekLabel: overrides.weekLabel || 'this week',
    weekOffset: overrides.weekOffset ?? 0,
    start: overrides.start || '2026-06-15T18:00',
    end: overrides.end || '2026-06-15T18:30',
    openEventId: overrides.openEventId || overrides.id || 'slot',
    isPreviousScout: overrides.isPreviousScout ?? overrides.scoutName === 'Coach Ryan',
  };
}

test('parent reschedule slot selection allows alternate scout ASAP options early in the week', () => {
  const selected = selectParentRescheduleSlots({
    previousHeadScoutName: 'Coach Ryan',
    now: new Date('2026-06-15T14:00:00.000Z'), // Monday morning ET
    slots: [
      slot({
        id: 'ryan-next-week',
        scoutName: 'Coach Ryan',
        isPreviousScout: true,
        weekOffset: 1,
        weekLabel: 'next week',
        start: '2026-06-22T18:00',
      }),
      slot({
        id: 'jeffrey-this-week',
        scoutName: 'Coach Jeffrey',
        isPreviousScout: false,
        weekOffset: 0,
        weekLabel: 'this week',
        start: '2026-06-15T19:00',
      }),
      slot({
        id: 'ryan-next-week-2',
        scoutName: 'Coach Ryan',
        isPreviousScout: true,
        weekOffset: 1,
        weekLabel: 'next week',
        start: '2026-06-23T18:00',
      }),
    ],
  });

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ['jeffrey-this-week', 'ryan-next-week', 'ryan-next-week-2'],
  );
});

test('parent reschedule slot selection shifts to next-week same scout after Wednesday evening', () => {
  const selected = selectParentRescheduleSlots({
    previousHeadScoutName: 'Coach Ryan',
    now: new Date('2026-06-18T00:00:00.000Z'), // Wednesday 8 PM ET
    slots: [
      slot({
        id: 'jeffrey-this-week',
        scoutName: 'Coach Jeffrey',
        isPreviousScout: false,
        weekOffset: 0,
        weekLabel: 'this week',
        start: '2026-06-18T19:00',
      }),
      slot({
        id: 'ryan-next-week',
        scoutName: 'Coach Ryan',
        isPreviousScout: true,
        weekOffset: 1,
        weekLabel: 'next week',
        start: '2026-06-23T18:00',
      }),
      slot({
        id: 'ryan-next-week-2',
        scoutName: 'Coach Ryan',
        isPreviousScout: true,
        weekOffset: 1,
        weekLabel: 'next week',
        start: '2026-06-24T18:00',
      }),
    ],
  });

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ['ryan-next-week', 'ryan-next-week-2', 'jeffrey-this-week'],
  );
});
