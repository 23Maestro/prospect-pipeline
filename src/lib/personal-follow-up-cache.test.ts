import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPersonalFollowUp,
  listPersonalFollowUps,
  removePersonalFollowUp,
} from './personal-follow-up-cache.js';

type MockStorage = {
  values: Map<string, string>;
  getItem<T>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string): Promise<void>;
};

function createStorage(): MockStorage {
  const values = new Map<string, string>();
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

test('personal follow-up cache saves newest entry first and dedupes by result', async () => {
  const storage = createStorage();
  await addPersonalFollowUp(
    {
      athlete_id: '123',
      athlete_main_id: '456',
      name: 'Jamel Riggins',
      parent_name: 'Anita Riggins',
      parent_phone: '(702) 675-1544',
    },
    'parent',
    storage,
  );
  await addPersonalFollowUp(
    {
      athlete_id: '123',
      athlete_main_id: '456',
      name: 'Jamel Riggins',
      parent_name: 'Anita Riggins',
      parent_phone: '(702) 675-1544',
    },
    'parent',
    storage,
  );

  const entries = await listPersonalFollowUps(storage);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].result.parent_name, 'Anita Riggins');
  assert.equal(entries[0].searchMode, 'parent');
});

test('personal follow-up cache removes entries by id', async () => {
  const storage = createStorage();
  const saved = await addPersonalFollowUp(
    {
      athlete_id: '123',
      athlete_main_id: '456',
      name: 'Jamel Riggins',
      parent_phone: '(702) 675-1544',
    },
    'parent',
    storage,
  );
  assert.ok(saved);

  await removePersonalFollowUp(saved.id, storage);
  assert.deepEqual(await listPersonalFollowUps(storage), []);
});

