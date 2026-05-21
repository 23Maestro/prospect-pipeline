import { Cache, LocalStorage } from '@raycast/api';
import type { ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import type { ContactInfo } from './npid-mcp-adapter';

const CACHE_VERSION = 2;
const MEASURABLES_TTL_MS = 24 * 60 * 60 * 1000;
const CONTACT_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const MAXPREPS_CONTEXT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_CALL_BLOCK_COUNTS_TTL_MS = 12 * 60 * 60 * 1000;
const DAILY_CALL_BLOCK_COUNTS_KEY = 'daily-call-blocks:task-counts';

type StorageLike = Pick<typeof LocalStorage, 'getItem' | 'setItem'>;
type CacheLike = Pick<Cache, 'get' | 'set'>;

const scoutPrepContextCache = new Cache({ namespace: 'scout-prep-context' });
const dailyCallBlockCountsCache = new Cache({ namespace: 'scout-prep-task-counts' });

export type ScoutPrepMeasurables = {
  height?: string | null;
  weight?: string | null;
};

export type ScoutPrepMaxPrepsContext = {
  mascot: string;
  state_rank: string;
  url: string;
  athlete_context?: string | null;
};

export type ScoutPrepMaxPrepsCacheInput = {
  athleteName?: string | null;
  highSchool?: string | null;
  state?: string | null;
  sport?: string | null;
};

export type DailyCallBlockTaskCounts = {
  touch1Count: number;
  remainingTaskCount: number;
};

type CacheRecord<T> = {
  version: number;
  cachedAt: string;
  data: T;
};

export type CacheReadResult<T> = {
  data: T;
  isFresh: boolean;
  cacheAgeMs: number;
} | null;

function buildMeasurablesKey(athleteId: string): string {
  return `scout-prep:measurables:${String(athleteId).trim()}`;
}

function buildContactInfoKey(contactId: string, athleteMainId: string): string {
  return `scout-prep:contact:${String(contactId).trim()}:${String(athleteMainId).trim()}`;
}

function normalizeKeyPart(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildMaxPrepsContextKey(input: ScoutPrepMaxPrepsCacheInput): string {
  return [
    'scout-prep:maxpreps',
    normalizeKeyPart(input.athleteName),
    normalizeKeyPart(input.highSchool),
    normalizeKeyPart(input.state),
    normalizeKeyPart(input.sport),
  ].join(':');
}

function buildScoutPrepContextKey(task: ScoutPortalTask): string {
  const taskId = normalizeKeyPart(task.task_id);
  if (taskId) {
    return `scout-prep:context:task:${taskId}`;
  }

  return [
    'scout-prep:context:fallback',
    normalizeKeyPart(task.contact_id),
    normalizeKeyPart(task.athlete_id),
    normalizeKeyPart(task.athlete_main_id),
    normalizeKeyPart(task.title),
  ].join(':');
}

function serializeRecord<T>(data: T): string {
  return JSON.stringify({
    version: CACHE_VERSION,
    cachedAt: new Date().toISOString(),
    data,
  } satisfies CacheRecord<T>);
}

function parseCacheRecord<T>(rawValue: string | null, ttlMs: number): CacheReadResult<T> {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CacheRecord<T>>;
    if (parsed.version !== CACHE_VERSION || !parsed.cachedAt || parsed.data === undefined) {
      return null;
    }
    const cachedAtMs = Date.parse(parsed.cachedAt);
    if (Number.isNaN(cachedAtMs)) {
      return null;
    }
    const cacheAgeMs = Math.max(0, Date.now() - cachedAtMs);
    return {
      data: parsed.data,
      isFresh: cacheAgeMs < ttlMs,
      cacheAgeMs,
    };
  } catch {
    return null;
  }
}

function parsePersistentCacheRecord<T>(rawValue: string | null): CacheReadResult<T> {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CacheRecord<T>>;
    if (parsed.version !== CACHE_VERSION || !parsed.cachedAt || parsed.data === undefined) {
      return null;
    }
    const cachedAtMs = Date.parse(parsed.cachedAt);
    if (Number.isNaN(cachedAtMs)) {
      return null;
    }
    return {
      data: parsed.data,
      isFresh: true,
      cacheAgeMs: Math.max(0, Date.now() - cachedAtMs),
    };
  } catch {
    return null;
  }
}

export async function getCachedScoutPrepMeasurables(
  athleteId: string,
  storage: StorageLike = LocalStorage,
): Promise<CacheReadResult<ScoutPrepMeasurables>> {
  return parseCacheRecord<ScoutPrepMeasurables>(
    await storage.getItem<string>(buildMeasurablesKey(athleteId)),
    MEASURABLES_TTL_MS,
  );
}

export async function setCachedScoutPrepMeasurables(
  athleteId: string,
  data: ScoutPrepMeasurables,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  await storage.setItem(buildMeasurablesKey(athleteId), serializeRecord(data));
}

export async function getCachedScoutPrepContactInfo(
  contactId: string,
  athleteMainId: string,
  storage: StorageLike = LocalStorage,
): Promise<CacheReadResult<ContactInfo>> {
  return parseCacheRecord<ContactInfo>(
    await storage.getItem<string>(buildContactInfoKey(contactId, athleteMainId)),
    CONTACT_INFO_TTL_MS,
  );
}

export async function setCachedScoutPrepContactInfo(
  contactId: string,
  athleteMainId: string,
  data: ContactInfo,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  await storage.setItem(buildContactInfoKey(contactId, athleteMainId), serializeRecord(data));
}

export async function getCachedScoutPrepMaxPrepsContext(
  input: ScoutPrepMaxPrepsCacheInput,
  storage: StorageLike = LocalStorage,
): Promise<CacheReadResult<ScoutPrepMaxPrepsContext>> {
  return parseCacheRecord<ScoutPrepMaxPrepsContext>(
    await storage.getItem<string>(buildMaxPrepsContextKey(input)),
    MAXPREPS_CONTEXT_TTL_MS,
  );
}

export async function setCachedScoutPrepMaxPrepsContext(
  input: ScoutPrepMaxPrepsCacheInput,
  data: ScoutPrepMaxPrepsContext,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  await storage.setItem(buildMaxPrepsContextKey(input), serializeRecord(data));
}

export async function getCachedScoutPrepContext(
  task: ScoutPortalTask,
  cache: CacheLike = scoutPrepContextCache,
): Promise<CacheReadResult<ScoutPrepContext>> {
  return parsePersistentCacheRecord<ScoutPrepContext>(
    cache.get(buildScoutPrepContextKey(task)) || null,
  );
}

export async function setCachedScoutPrepContext(
  task: ScoutPortalTask,
  data: ScoutPrepContext,
  cache: CacheLike = scoutPrepContextCache,
): Promise<void> {
  cache.set(buildScoutPrepContextKey(task), serializeRecord(data));
}

export async function getCachedDailyCallBlockTaskCounts(
  cache: CacheLike = dailyCallBlockCountsCache,
): Promise<CacheReadResult<DailyCallBlockTaskCounts>> {
  return parseCacheRecord<DailyCallBlockTaskCounts>(
    cache.get(DAILY_CALL_BLOCK_COUNTS_KEY) || null,
    DAILY_CALL_BLOCK_COUNTS_TTL_MS,
  );
}

export async function setCachedDailyCallBlockTaskCounts(
  counts: DailyCallBlockTaskCounts,
  cache: CacheLike = dailyCallBlockCountsCache,
): Promise<void> {
  cache.set(
    DAILY_CALL_BLOCK_COUNTS_KEY,
    serializeRecord({
      touch1Count: Math.max(0, Math.floor(counts.touch1Count)),
      remainingTaskCount: Math.max(0, Math.floor(counts.remainingTaskCount)),
    }),
  );
}
