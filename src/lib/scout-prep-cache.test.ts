import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedScoutPrepContactInfo,
  getCachedDailyCallBlockTaskCounts,
  getCachedScoutPrepContext,
  getCachedScoutPrepMeasurables,
  getCachedScoutPrepMaxPrepsContext,
  setCachedDailyCallBlockTaskCounts,
  setCachedScoutPrepContactInfo,
  setCachedScoutPrepContext,
  setCachedScoutPrepMeasurables,
  setCachedScoutPrepMaxPrepsContext,
} from './scout-prep-cache.js';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepValues,
  isScoutPrepContactCacheUsable,
  isScoutPrepContextCacheUsableForDisplay,
  resolveScoutPrepContactLookupIds,
} from './scout-prep.js';
import type { ContactInfo } from './npid-mcp-adapter.js';
import type { ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types.js';

type MockStorage = {
  values: Map<string, string>;
  getItem<T>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string): Promise<void>;
};

type MockCache = {
  values: Map<string, string>;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
};

function createStorage(initial?: Record<string, string>): MockStorage {
  const values = new Map(Object.entries(initial || {}));
  return {
    values,
    async getItem<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createCache(initial?: Record<string, string>): MockCache {
  const values = new Map(Object.entries(initial || {}));
  return {
    values,
    get(key: string) {
      return values.get(key);
    },
    set(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function buildContactInfo(): ContactInfo {
  return {
    contactId: '123',
    studentAthlete: {
      name: 'August Nyakeoga',
      email: null,
      phone: '6515550000',
    },
    parent1: {
      name: 'Peter Osebe',
      relationship: 'Father',
      email: null,
      phone: '6515551111',
    },
    parent2: null,
  };
}

function buildScoutPrepTask(overrides: Partial<ScoutPortalTask> = {}): ScoutPortalTask {
  return {
    task_id: 'task-123',
    contact_id: '1489285',
    athlete_id: '1489285',
    athlete_main_id: '456',
    athlete_name: 'Jance Mercado',
    sport: 'Football',
    high_school: 'Republic High School',
    city: 'Republic',
    state: 'MO',
    grad_year: '2028',
    title: 'Call Attempt 1',
    ...overrides,
  };
}

function buildScoutPrepContext(task = buildScoutPrepTask()): ScoutPrepContext {
  return {
    task,
    resolved: {
      athlete_id: task.athlete_id,
      athlete_main_id: task.athlete_main_id,
      sport: task.sport,
      high_school: task.high_school,
      city: task.city,
      state: task.state,
      positions: 'OLB',
      gpa: '3.4',
      head_scout: 'Primary Operator',
      scouting_coordinator: null,
      height: `6'1"`,
      weight: '205 lbs',
    },
    contactInfo: buildContactInfo(),
    notes: [
      {
        title: 'Coach note',
        description: 'Explosive first step.',
      },
    ],
    tasks: [
      {
        task_id: 'task-123',
        title: 'Call Attempt 1',
        assigned_owner: 'Primary Operator',
        due_date: '05/19/2026 09:00 AM',
        completion_date: null,
        description: 'Call Attempt 1',
      },
    ],
  };
}

test('scout prep cache: valid fresh measurables entry returns data', async () => {
  const storage = createStorage();
  await setCachedScoutPrepMeasurables('1489285', { height: `6'2"`, weight: '320 lbs' }, storage);
  const cached = await getCachedScoutPrepMeasurables('1489285', storage);
  assert.ok(cached);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.data.height, `6'2"`);
  assert.equal(cached.data.weight, '320 lbs');
});

test('scout prep cache: stale entry stays readable but marked stale', async () => {
  const staleIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const storage = createStorage({
    'scout-prep:measurables:1489285': JSON.stringify({
      version: 4,
      cachedAt: staleIso,
      data: { height: `6'2"`, weight: '320 lbs' },
    }),
  });
  const cached = await getCachedScoutPrepMeasurables('1489285', storage);
  assert.ok(cached);
  assert.equal(cached.isFresh, false);
  assert.equal(cached.data.weight, '320 lbs');
});

test('scout prep cache: corrupt JSON ignored', async () => {
  const storage = createStorage({
    'scout-prep:measurables:1489285': '{"bad"',
  });
  const cached = await getCachedScoutPrepMeasurables('1489285', storage);
  assert.equal(cached, null);
});

test('scout prep cache: version mismatch ignored', async () => {
  const storage = createStorage({
    'scout-prep:contact:123:456': JSON.stringify({
      version: 999,
      cachedAt: new Date().toISOString(),
      data: buildContactInfo(),
    }),
  });
  const cached = await getCachedScoutPrepContactInfo('123', '456', storage);
  assert.equal(cached, null);
});

test('scout prep cache: contact round-trip works', async () => {
  const storage = createStorage();
  await setCachedScoutPrepContactInfo('123', '456', buildContactInfo(), storage);
  const cached = await getCachedScoutPrepContactInfo('123', '456', storage);
  assert.ok(cached);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.data.parent1?.name, 'Peter Osebe');
});

test('scout prep contact lookup uses resolved athlete ids over task ids', () => {
  const ids = resolveScoutPrepContactLookupIds({
    taskContactId: '1498420',
    resolvedAthleteId: '1494473',
    taskAthleteMainId: '953676',
    resolvedAthleteMainId: '953398',
  });

  assert.deepEqual(ids, {
    contactId: '1494473',
    athleteMainId: '953398',
  });
});

test('scout prep contact cache is not usable without parent1', () => {
  assert.equal(isScoutPrepContactCacheUsable(buildContactInfo()), true);
  assert.equal(
    isScoutPrepContactCacheUsable({
      ...buildContactInfo(),
      parent1: null,
    }),
    false,
  );
});

test('scout prep display context cache remains usable when positions are missing', () => {
  const context = buildScoutPrepContext(buildScoutPrepTask());
  assert.equal(isScoutPrepContextCacheUsableForDisplay(context), true);

  assert.equal(
    isScoutPrepContextCacheUsableForDisplay({
      ...context,
      resolved: {
        ...context.resolved,
        positions: null,
      },
    }),
    true,
  );
});

test('scout prep cache: maxpreps context round-trip normalizes lookup key', async () => {
  const storage = createStorage();
  await setCachedScoutPrepMaxPrepsContext(
    {
      athleteName: 'Jance Mercado',
      highSchool: 'Republic High School',
      state: 'MO',
      sport: 'Football',
    },
    {
      mascot: 'Republic Tigers',
      state_rank: 'MO Rank 24',
      url: 'https://www.maxpreps.com/mo/republic/republic-tigers/football/',
      athlete_context: '#28 Jance Mercado So. OLB',
    },
    storage,
  );

  const cached = await getCachedScoutPrepMaxPrepsContext(
    {
      athleteName: ' jance   mercado ',
      highSchool: 'republic high school',
      state: 'mo',
      sport: 'football',
    },
    storage,
  );

  assert.ok(cached);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.data.mascot, 'Republic Tigers');
  assert.equal(cached.data.athlete_context, '#28 Jance Mercado So. OLB');
});

test('scout prep cache: context round-trip uses task id key', async () => {
  const cache = createCache();
  const task = buildScoutPrepTask();
  const context = buildScoutPrepContext(task);

  await setCachedScoutPrepContext(task, context, cache);
  const cached = await getCachedScoutPrepContext(task, cache);

  assert.ok(cached);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.data.contactInfo.studentAthlete.name, 'August Nyakeoga');
  assert.equal(cached.data.resolved.high_school, 'Republic High School');
});

test('scout prep cache: context fallback key normalizes task fields', async () => {
  const cache = createCache();
  const task = buildScoutPrepTask({
    task_id: null,
    contact_id: ' 1489285 ',
    athlete_id: '1489285',
    athlete_main_id: '456',
    title: ' Call   Attempt 1 ',
  });

  await setCachedScoutPrepContext(task, buildScoutPrepContext(task), cache);
  const cached = await getCachedScoutPrepContext(
    buildScoutPrepTask({
      task_id: null,
      contact_id: '1489285',
      athlete_id: '1489285',
      athlete_main_id: '456',
      title: 'call attempt 1',
    }),
    cache,
  );

  assert.ok(cached);
  assert.equal(cached.data.task.task_id, null);
  assert.equal(cached.data.resolved.athlete_main_id, '456');
});

test('scout prep cache: corrupt context JSON ignored', async () => {
  const cache = createCache({
    'scout-prep:context:task:task-123': '{"bad"',
  });
  const cached = await getCachedScoutPrepContext(buildScoutPrepTask(), cache);
  assert.equal(cached, null);
});

test('scout prep cache: cached context remains renderable', async () => {
  const cache = createCache();
  const task = buildScoutPrepTask();
  const context = buildScoutPrepContext(task);

  await setCachedScoutPrepContext(task, context, cache);
  const cached = await getCachedScoutPrepContext(task, cache);
  assert.ok(cached);

  const values = buildScoutPrepValues({
    athleteName: cached.data.contactInfo.studentAthlete.name,
    parent1Name: cached.data.contactInfo.parent1?.name,
    parent2Name: cached.data.contactInfo.parent2?.name,
    gradYear: cached.data.task.grad_year,
    sport: cached.data.resolved.sport,
  });
  const markdown = buildScoutPrepDetailMarkdown(values, cached.data);

  assert.match(markdown, /August Nyakeoga|Jance Mercado/);
  assert.match(markdown, /Football/);
  assert.match(markdown, /- \*\*Position:\*\* OLB/);
});

test('scout prep cache: daily call block counts round down and never go negative', async () => {
  const cache = createCache();

  await setCachedDailyCallBlockTaskCounts(
    {
      touch1Count: 10.9,
      remainingTaskCount: -4,
    },
    cache,
  );

  const cached = await getCachedDailyCallBlockTaskCounts(cache);
  assert.ok(cached);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.data.touch1Count, 10);
  assert.equal(cached.data.remainingTaskCount, 0);
});
