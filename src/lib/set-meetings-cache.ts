import { LocalStorage } from '@raycast/api';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CACHE_VERSION = 5;
const FALLBACK_CACHE_DIR = path.join(os.homedir(), '.prospect-pipeline', 'raycast-cache');

type StorageLike = {
  getItem<T extends string = string>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string): Promise<void>;
};

export type SetMeetingsCacheSnapshot<TCandidate = unknown> = {
  version: number;
  cachedAt: string;
  weekStart: string;
  weekEnd: string;
  scoutName?: string | null;
  candidates: TCandidate[];
};

export type SetMeetingsCacheReadResult<TCandidate = unknown> = {
  snapshot: SetMeetingsCacheSnapshot<TCandidate>;
  isDueForHourlyRefresh: boolean;
} | null;

function buildSetMeetingsCacheKey(args: {
  weekStart: string;
  weekEnd: string;
  scoutName?: string | null;
}): string {
  return [
    'set-meetings',
    'weekly',
    args.weekStart,
    args.weekEnd,
    String(args.scoutName || 'all')
      .trim()
      .toLowerCase(),
  ].join(':');
}

function buildFallbackCachePath(args: {
  weekStart: string;
  weekEnd: string;
  scoutName?: string | null;
}): string {
  const safeKey = buildSetMeetingsCacheKey(args).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(FALLBACK_CACHE_DIR, `${safeKey}.json`);
}

async function readFallbackCache<TCandidate>(args: {
  weekStart: string;
  weekEnd: string;
  scoutName?: string | null;
  now?: Date;
}): Promise<SetMeetingsCacheReadResult<TCandidate>> {
  const filePath = buildFallbackCachePath(args);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SetMeetingsCacheSnapshot<TCandidate>>;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.weekStart !== args.weekStart ||
      parsed.weekEnd !== args.weekEnd ||
      !parsed.cachedAt ||
      !Array.isArray(parsed.candidates)
    ) {
      return null;
    }
    return {
      snapshot: {
        version: CACHE_VERSION,
        cachedAt: parsed.cachedAt,
        weekStart: parsed.weekStart,
        weekEnd: parsed.weekEnd,
        scoutName: parsed.scoutName || null,
        candidates: parsed.candidates,
      },
      isDueForHourlyRefresh: isSetMeetingsCacheDueForHourlyRefresh(parsed.cachedAt, args.now),
    };
  } catch {
    return null;
  }
}

async function writeFallbackCache<TCandidate>(snapshot: SetMeetingsCacheSnapshot<TCandidate>) {
  fs.mkdirSync(FALLBACK_CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    buildFallbackCachePath({
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      scoutName: snapshot.scoutName,
    }),
    JSON.stringify(snapshot),
  );
}

function getLocalHourBucket(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
  ].join('-');
}

export function isSetMeetingsCacheDueForHourlyRefresh(cachedAt: string, now = new Date()): boolean {
  const cachedDate = new Date(cachedAt);
  if (Number.isNaN(cachedDate.getTime())) {
    return true;
  }
  return getLocalHourBucket(cachedDate) !== getLocalHourBucket(now);
}

export function shouldRenderCachedSetMeetingsSnapshot<TCandidate>(
  cached: SetMeetingsCacheReadResult<TCandidate>,
): cached is NonNullable<SetMeetingsCacheReadResult<TCandidate>> {
  if (!cached) {
    return false;
  }
  return !cached.isDueForHourlyRefresh || cached.snapshot.candidates.length > 0;
}

export async function getCachedSetMeetings<TCandidate = unknown>(args: {
  weekStart: string;
  weekEnd: string;
  scoutName?: string | null;
  now?: Date;
  storage?: StorageLike;
}): Promise<SetMeetingsCacheReadResult<TCandidate>> {
  const storage = args.storage || LocalStorage;
  const rawValue = await storage.getItem<string>(
    buildSetMeetingsCacheKey({
      weekStart: args.weekStart,
      weekEnd: args.weekEnd,
      scoutName: args.scoutName,
    }),
  );
  if (!rawValue) {
    return readFallbackCache<TCandidate>(args);
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SetMeetingsCacheSnapshot<TCandidate>>;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.weekStart !== args.weekStart ||
      parsed.weekEnd !== args.weekEnd ||
      !parsed.cachedAt ||
      !Array.isArray(parsed.candidates)
    ) {
      return readFallbackCache<TCandidate>(args);
    }

    return {
      snapshot: {
        version: CACHE_VERSION,
        cachedAt: parsed.cachedAt,
        weekStart: parsed.weekStart,
        weekEnd: parsed.weekEnd,
        scoutName: parsed.scoutName || null,
        candidates: parsed.candidates,
      },
      isDueForHourlyRefresh: isSetMeetingsCacheDueForHourlyRefresh(parsed.cachedAt, args.now),
    };
  } catch {
    return readFallbackCache<TCandidate>(args);
  }
}

export async function setCachedSetMeetings<TCandidate = unknown>(args: {
  weekStart: string;
  weekEnd: string;
  scoutName?: string | null;
  candidates: TCandidate[];
  cachedAt?: Date;
  storage?: StorageLike;
}): Promise<SetMeetingsCacheSnapshot<TCandidate>> {
  const snapshot: SetMeetingsCacheSnapshot<TCandidate> = {
    version: CACHE_VERSION,
    cachedAt: (args.cachedAt || new Date()).toISOString(),
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    scoutName: args.scoutName || null,
    candidates: args.candidates,
  };
  const storage = args.storage || LocalStorage;
  await storage.setItem(
    buildSetMeetingsCacheKey({
      weekStart: args.weekStart,
      weekEnd: args.weekEnd,
      scoutName: args.scoutName,
    }),
    JSON.stringify(snapshot),
  );
  await writeFallbackCache(snapshot);
  return snapshot;
}
