import { LocalStorage } from '@raycast/api';

const STORAGE_KEY = 'scout-prep:personal-follow-ups';
const STORAGE_VERSION = 1;
const MAX_ENTRIES = 25;

type StorageLike = Pick<typeof LocalStorage, 'getItem' | 'setItem'>;

export type PersonalFollowUpProspectResult = {
  athlete_id: string;
  athlete_main_id?: string;
  name?: string;
  grad_year?: string;
  sport?: string;
  state?: string;
  city?: string;
  high_school?: string;
  email?: string;
  phone?: string;
  parent_name?: string;
  parent_email?: string;
  parent_phone?: string;
  url?: string;
  positions?: string;
  source?: string;
  jersey_number?: string;
};

export type PersonalFollowUpEntry = {
  id: string;
  result: PersonalFollowUpProspectResult;
  searchMode: 'athlete' | 'parent';
  addedAt: string;
};

type PersistedPersonalFollowUps = {
  version: number;
  entries: PersonalFollowUpEntry[];
};

function buildEntryId(
  result: PersonalFollowUpProspectResult,
  searchMode: PersonalFollowUpEntry['searchMode'],
) {
  const athleteId = String(result.athlete_id || '').trim();
  const athleteMainId = String(result.athlete_main_id || '').trim();
  const parentPhone = String(result.parent_phone || '').trim();
  const phone = String(result.phone || '').trim();
  return [searchMode, athleteId, athleteMainId || 'missing-main-id', parentPhone || phone || 'no-phone'].join(':');
}

function normalizeEntry(entry: Partial<PersonalFollowUpEntry>): PersonalFollowUpEntry | null {
  const result = entry.result;
  const athleteId = String(result?.athlete_id || '').trim();
  if (!result || !athleteId) {
    return null;
  }

  const searchMode = entry.searchMode === 'parent' ? 'parent' : 'athlete';
  return {
    id: entry.id || buildEntryId(result, searchMode),
    result: {
      ...result,
      athlete_id: athleteId,
    },
    searchMode,
    addedAt: entry.addedAt || new Date().toISOString(),
  };
}

export async function listPersonalFollowUps(
  storage: StorageLike = LocalStorage,
): Promise<PersonalFollowUpEntry[]> {
  const raw = await storage.getItem<string>(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPersonalFollowUps>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is PersonalFollowUpEntry => Boolean(entry));
  } catch {
    return [];
  }
}

async function savePersonalFollowUps(
  entries: PersonalFollowUpEntry[],
  storage: StorageLike = LocalStorage,
): Promise<void> {
  await storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: STORAGE_VERSION,
      entries: entries.slice(0, MAX_ENTRIES),
    } satisfies PersistedPersonalFollowUps),
  );
}

export async function addPersonalFollowUp(
  result: PersonalFollowUpProspectResult,
  searchMode: PersonalFollowUpEntry['searchMode'],
  storage: StorageLike = LocalStorage,
): Promise<PersonalFollowUpEntry | null> {
  const entry = normalizeEntry({
    id: buildEntryId(result, searchMode),
    result,
    searchMode,
    addedAt: new Date().toISOString(),
  });
  if (!entry) {
    return null;
  }

  const existing = await listPersonalFollowUps(storage);
  const filtered = existing.filter((item) => item.id !== entry.id);
  await savePersonalFollowUps([entry, ...filtered], storage);
  return entry;
}

export async function removePersonalFollowUp(
  id: string,
  storage: StorageLike = LocalStorage,
): Promise<void> {
  const existing = await listPersonalFollowUps(storage);
  await savePersonalFollowUps(
    existing.filter((entry) => entry.id !== id),
    storage,
  );
}
