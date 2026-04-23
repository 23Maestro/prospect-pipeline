import { LocalStorage } from '@raycast/api';
import type { ScoutAthleteTask } from '../features/scout-prep/types';

const STORAGE_KEY = 'scout-prep:follow-up-index';
const STORAGE_VERSION = 1;
const MAX_ENTRIES = 50;
const FOLLOW_UP_CACHE_PREFIX = 'scout-prep:follow-up-cache:';
const FOLLOW_UP_CACHE_VERSION = 1;
const FOLLOW_UP_CACHE_TTL_MS = 5 * 60 * 1000;

type StorageLike = Pick<typeof LocalStorage, 'getItem' | 'setItem'>;

export type ScoutPrepFollowUpPointer = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  gradYear?: string | null;
  addedAt: string;
};

type PersistedIndex = {
  version: number;
  entries: ScoutPrepFollowUpPointer[];
};

type FollowUpCacheRecord = {
  version: number;
  cachedAt: string;
  task: ScoutAthleteTask | null;
};

function normalizePointer(
  pointer: Omit<ScoutPrepFollowUpPointer, 'addedAt'>,
): ScoutPrepFollowUpPointer | null {
  const athleteId = String(pointer.athleteId || '').trim();
  const athleteMainId = String(pointer.athleteMainId || '').trim();
  const athleteName = String(pointer.athleteName || '').trim();
  if (!athleteId || !athleteMainId || !athleteName) {
    return null;
  }

  return {
    athleteId,
    athleteMainId,
    athleteName,
    gradYear: pointer.gradYear ? String(pointer.gradYear).trim() : null,
    addedAt: new Date().toISOString(),
  };
}

async function loadIndex(storage: StorageLike = LocalStorage): Promise<ScoutPrepFollowUpPointer[]> {
  const raw = await storage.getItem<string>(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedIndex>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.filter((entry): entry is ScoutPrepFollowUpPointer => {
      return Boolean(
        entry &&
        String(entry.athleteId || '').trim() &&
        String(entry.athleteMainId || '').trim() &&
        String(entry.athleteName || '').trim() &&
        String(entry.addedAt || '').trim(),
      );
    });
  } catch {
    return [];
  }
}

async function saveIndex(
  entries: ScoutPrepFollowUpPointer[],
  storage: StorageLike = LocalStorage,
): Promise<void> {
  await storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: STORAGE_VERSION,
      entries: entries.slice(0, MAX_ENTRIES),
    } satisfies PersistedIndex),
  );
}

function buildFollowUpCacheKey(athleteId: string, athleteMainId: string): string {
  return `${FOLLOW_UP_CACHE_PREFIX}${String(athleteId).trim()}:${String(athleteMainId).trim()}`;
}

export async function listScoutPrepFollowUpPointers(
  storage: StorageLike = LocalStorage,
): Promise<ScoutPrepFollowUpPointer[]> {
  return loadIndex(storage);
}

export async function addScoutPrepFollowUpPointer(
  pointer: Omit<ScoutPrepFollowUpPointer, 'addedAt'>,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  const normalized = normalizePointer(pointer);
  if (!normalized) {
    return;
  }

  const existing = await loadIndex(storage);
  const filtered = existing.filter(
    (entry) =>
      !(
        entry.athleteId === normalized.athleteId && entry.athleteMainId === normalized.athleteMainId
      ),
  );
  await saveIndex([normalized, ...filtered], storage);
}

export async function removeScoutPrepFollowUpPointer(
  athleteId: string,
  athleteMainId: string,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  const normalizedAthleteId = String(athleteId || '').trim();
  const normalizedAthleteMainId = String(athleteMainId || '').trim();
  if (!normalizedAthleteId || !normalizedAthleteMainId) {
    return;
  }

  const existing = await loadIndex(storage);
  await saveIndex(
    existing.filter(
      (entry) =>
        !(
          entry.athleteId === normalizedAthleteId && entry.athleteMainId === normalizedAthleteMainId
        ),
    ),
    storage,
  );
  await storage.setItem(buildFollowUpCacheKey(normalizedAthleteId, normalizedAthleteMainId), '');
}

export async function getCachedScoutPrepFollowUpTask(
  athleteId: string,
  athleteMainId: string,
  storage: StorageLike = LocalStorage,
): Promise<ScoutAthleteTask | null | undefined> {
  const normalizedAthleteId = String(athleteId || '').trim();
  const normalizedAthleteMainId = String(athleteMainId || '').trim();
  if (!normalizedAthleteId || !normalizedAthleteMainId) {
    return undefined;
  }

  const raw = await storage.getItem<string>(
    buildFollowUpCacheKey(normalizedAthleteId, normalizedAthleteMainId),
  );
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<FollowUpCacheRecord>;
    if (parsed.version !== FOLLOW_UP_CACHE_VERSION || !parsed.cachedAt) {
      return undefined;
    }
    const cachedAtMs = Date.parse(parsed.cachedAt);
    if (Number.isNaN(cachedAtMs) || Date.now() - cachedAtMs > FOLLOW_UP_CACHE_TTL_MS) {
      return undefined;
    }
    return (parsed.task as ScoutAthleteTask | null | undefined) ?? null;
  } catch {
    return undefined;
  }
}

export async function setCachedScoutPrepFollowUpTask(
  athleteId: string,
  athleteMainId: string,
  task: ScoutAthleteTask | null,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  const normalizedAthleteId = String(athleteId || '').trim();
  const normalizedAthleteMainId = String(athleteMainId || '').trim();
  if (!normalizedAthleteId || !normalizedAthleteMainId) {
    return;
  }

  const record: FollowUpCacheRecord = {
    version: FOLLOW_UP_CACHE_VERSION,
    cachedAt: new Date().toISOString(),
    task,
  };
  await storage.setItem(
    buildFollowUpCacheKey(normalizedAthleteId, normalizedAthleteMainId),
    JSON.stringify(record),
  );
}
