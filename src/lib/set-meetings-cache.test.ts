import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedSetMeetings,
  isSetMeetingsCacheDueForHourlyRefresh,
  setCachedSetMeetings,
  shouldRenderCachedSetMeetingsSnapshot,
} from './set-meetings-cache';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: async <T extends string = string>(key: string) => values.get(key) as T | undefined,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('set meetings cache is fresh inside the same local hour', async () => {
  const storage = createMemoryStorage();
  await setCachedSetMeetings({
    weekStart: '2026-05-11',
    weekEnd: '2026-05-17',
    candidates: [
      {
        key: 'meeting-1',
        athleteId: '1',
        athleteMainId: '2',
        athleteName: 'Anthony Hines',
        stage: 'Meeting Set',
        currentTask: 'Confirmation Call',
        taskId: 'task-1',
        adminUrl: '',
        taskUrl: '',
        source: 'website',
        needsConfirmationText: true,
        needsManualReview: false,
        reason: '',
        badges: [],
        oldFollowUpDateDetected: false,
      },
    ],
    cachedAt: new Date('2026-05-11T20:15:00-04:00'),
    storage,
  });

  const cached = await getCachedSetMeetings<{ athleteName: string }>({
    weekStart: '2026-05-11',
    weekEnd: '2026-05-17',
    now: new Date('2026-05-11T20:59:00-04:00'),
    storage,
  });

  assert.equal(cached?.isDueForHourlyRefresh, false);
  assert.equal(cached?.snapshot.candidates[0]?.athleteName, 'Anthony Hines');
});

test('set meetings cache refreshes after the hour rolls over', () => {
  assert.equal(
    isSetMeetingsCacheDueForHourlyRefresh(
      '2026-05-11T20:15:00-04:00',
      new Date('2026-05-11T21:00:00-04:00'),
    ),
    true,
  );
});

test('set meetings cache is scoped by selected week', async () => {
  const storage = createMemoryStorage();
  await setCachedSetMeetings({
    weekStart: '2026-05-11',
    weekEnd: '2026-05-17',
    candidates: [],
    cachedAt: new Date('2026-05-11T20:15:00-04:00'),
    storage,
  });

  const cached = await getCachedSetMeetings({
    weekStart: '2026-05-18',
    weekEnd: '2026-05-24',
    now: new Date('2026-05-11T20:20:00-04:00'),
    storage,
  });

  assert.equal(cached, null);
});

test('set meetings cache does not render stale empty snapshots while live refresh runs', async () => {
  const storage = createMemoryStorage();
  await setCachedSetMeetings({
    weekStart: '2026-05-11',
    weekEnd: '2026-05-17',
    candidates: [],
    cachedAt: new Date('2026-05-11T20:15:00-04:00'),
    storage,
  });

  const cached = await getCachedSetMeetings({
    weekStart: '2026-05-11',
    weekEnd: '2026-05-17',
    now: new Date('2026-05-11T21:01:00-04:00'),
    storage,
  });

  assert.equal(cached?.isDueForHourlyRefresh, true);
  assert.equal(shouldRenderCachedSetMeetingsSnapshot(cached), false);
});
