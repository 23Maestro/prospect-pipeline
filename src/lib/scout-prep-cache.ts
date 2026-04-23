import { LocalStorage } from '@raycast/api';
import type { ContactInfo } from './npid-mcp-adapter';

const CACHE_VERSION = 2;
const MEASURABLES_TTL_MS = 24 * 60 * 60 * 1000;
const CONTACT_INFO_TTL_MS = 24 * 60 * 60 * 1000;

type StorageLike = Pick<typeof LocalStorage, 'getItem' | 'setItem'>;

export type ScoutPrepMeasurables = {
  height?: string | null;
  weight?: string | null;
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
