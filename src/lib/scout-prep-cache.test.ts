import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedScoutPrepContactInfo,
  getCachedScoutPrepMeasurables,
  setCachedScoutPrepContactInfo,
  setCachedScoutPrepMeasurables,
} from './scout-prep-cache.js';
import type { ContactInfo } from './npid-mcp-adapter.js';

type MockStorage = {
  values: Map<string, string>;
  getItem<T>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string): Promise<void>;
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
      version: 1,
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
