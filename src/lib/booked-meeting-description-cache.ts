import { LocalStorage } from '@raycast/api';

const CACHE_PREFIX = 'booked-meeting-description';

type CachedMeetingDescription = {
  athleteId: string;
  athleteMainId: string;
  eventId: string;
  description: string;
  cachedAt: string;
};

function clean(value?: string | number | null): string {
  return String(value || '').trim();
}

function buildKeys(args: {
  athleteId?: string | null;
  athleteMainId?: string | null;
  eventId?: string | null;
}): string[] {
  const athleteId = clean(args.athleteId);
  const athleteMainId = clean(args.athleteMainId);
  const eventId = clean(args.eventId);
  const keys: string[] = [];

  if (eventId) keys.push(`${CACHE_PREFIX}:event:${eventId}`);
  if (athleteMainId) keys.push(`${CACHE_PREFIX}:athlete-main:${athleteMainId}`);
  if (athleteId) keys.push(`${CACHE_PREFIX}:athlete:${athleteId}`);

  return keys;
}

export async function cacheBookedMeetingDescription(args: {
  athleteId?: string | null;
  athleteMainId?: string | null;
  eventId?: string | null;
  description?: string | null;
}): Promise<void> {
  const description = clean(args.description);
  if (!description) return;

  const payload: CachedMeetingDescription = {
    athleteId: clean(args.athleteId),
    athleteMainId: clean(args.athleteMainId),
    eventId: clean(args.eventId),
    description,
    cachedAt: new Date().toISOString(),
  };

  await Promise.all(
    buildKeys(args).map((key) => LocalStorage.setItem(key, JSON.stringify(payload))),
  );
}

export async function getCachedBookedMeetingDescription(args: {
  athleteId?: string | null;
  athleteMainId?: string | null;
  eventId?: string | null;
}): Promise<string | null> {
  for (const key of buildKeys(args)) {
    const raw = await LocalStorage.getItem<string>(key);
    if (!raw) continue;

    try {
      const payload = JSON.parse(raw) as Partial<CachedMeetingDescription>;
      const description = clean(payload.description);
      if (description) return description;
    } catch {
      const description = clean(raw);
      if (description) return description;
    }
  }

  return null;
}
