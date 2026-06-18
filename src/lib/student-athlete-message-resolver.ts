import type { AthleteContactCacheClientMatch } from './athlete-contact-cache';
import { isPendingClientReviewFollowUpSourceStage } from '../domain/pending-client-watchlist';

export type StudentAthleteMessageAssociatedContact = {
  role: string;
  name: string | null;
  relationshipLabel: string;
  normalizedPhoneNumber: string;
};

export type StudentAthleteMessageResolution = {
  normalizedPhone: string;
  displayName: string;
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  contactId: string | null;
  crmStage: string | null;
  taskStatus: string | null;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  timezone: string | null;
  timezoneLabel: string | null;
  associatedContacts: StudentAthleteMessageAssociatedContact[];
  ambiguity: 'none' | 'multiple_athletes';
  source: 'athlete_contact_cache';
};

function toDisplayName(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split('-')
        .map((piece) => (piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece))
        .join('-'),
    )
    .join(' ');
}

function relationshipRole(row: AthleteContactCacheClientMatch): string {
  const normalized = String(row.relationshipLabel || '')
    .trim()
    .toLowerCase();
  if (normalized.includes('student')) return 'studentAthlete';
  if (
    normalized.includes('father') ||
    normalized.includes('dad') ||
    normalized.includes('parent 2')
  ) {
    return 'parent2';
  }
  if (
    normalized.includes('mother') ||
    normalized.includes('mom') ||
    normalized.includes('parent 1')
  ) {
    return 'parent1';
  }
  return normalized.replace(/[^a-z0-9]+/g, '_') || 'contact';
}

function associatedContactsForAthlete(
  rows: AthleteContactCacheClientMatch[],
  phoneResolutionByPhone: Map<string, string | null>,
): StudentAthleteMessageAssociatedContact[] {
  return Array.from(
    new Map(
      rows
        .filter((row) => {
          if (!phoneResolutionByPhone.has(row.normalizedPhone)) return true;
          const resolvedAthleteKey = phoneResolutionByPhone.get(row.normalizedPhone);
          return Boolean(resolvedAthleteKey && resolvedAthleteKey === row.athleteKey);
        })
        .map((row) => [
          `${relationshipRole(row)}:${row.normalizedPhone}`,
          {
            role: relationshipRole(row),
            name: toDisplayName(row.contactName) || row.contactName,
            relationshipLabel: row.relationshipLabel,
            normalizedPhoneNumber: row.normalizedPhone,
          } satisfies StudentAthleteMessageAssociatedContact,
        ]),
    ).values(),
  );
}

function isReviewFollowUpCacheMatch(row: AthleteContactCacheClientMatch): boolean {
  return isPendingClientReviewFollowUpSourceStage({
    crmStage: row.crmStage,
    taskStatus: row.taskStatus,
    taskTitle: row.currentTaskTitle,
  });
}

function buildPhoneResolutionByPhone(
  rows: AthleteContactCacheClientMatch[],
): Map<string, string | null> {
  const rowsByPhone = new Map<string, AthleteContactCacheClientMatch[]>();
  for (const row of rows) {
    rowsByPhone.set(row.normalizedPhone, [...(rowsByPhone.get(row.normalizedPhone) || []), row]);
  }

  const result = new Map<string, string | null>();
  for (const [phone, phoneRows] of rowsByPhone.entries()) {
    const athleteKeys = new Set(phoneRows.map((row) => row.athleteKey));
    if (athleteKeys.size <= 1) {
      result.set(phone, phoneRows[0]?.athleteKey || null);
      continue;
    }

    const qualifyingKeys = new Set(
      phoneRows.filter(isReviewFollowUpCacheMatch).map((row) => row.athleteKey),
    );
    result.set(phone, qualifyingKeys.size === 1 ? Array.from(qualifyingKeys)[0] : null);
  }
  return result;
}

export function buildStudentAthleteMessageResolutions(
  rows: AthleteContactCacheClientMatch[],
): StudentAthleteMessageResolution[] {
  const rowsByAthleteKey = new Map<string, AthleteContactCacheClientMatch[]>();

  for (const row of rows) {
    rowsByAthleteKey.set(row.athleteKey, [...(rowsByAthleteKey.get(row.athleteKey) || []), row]);
  }

  const phoneResolutionByPhone = buildPhoneResolutionByPhone(rows);

  return rows.flatMap((row) => {
    const resolvedAthleteKey = phoneResolutionByPhone.get(row.normalizedPhone);
    if (!resolvedAthleteKey || resolvedAthleteKey !== row.athleteKey) {
      return [];
    }

    const associatedContacts = associatedContactsForAthlete(
      rowsByAthleteKey.get(row.athleteKey) || [row],
      phoneResolutionByPhone,
    );
    return [{
      normalizedPhone: row.normalizedPhone,
      displayName: toDisplayName(row.contactName) || row.contactName,
      athleteKey: row.athleteKey,
      athleteId: row.athleteId,
      athleteMainId: row.athleteMainId,
      athleteName: toDisplayName(row.athleteName) || row.athleteName,
      contactId: row.contactId || row.athleteId,
      crmStage: row.crmStage,
      taskStatus: row.taskStatus,
      currentTaskId: row.currentTaskId,
      currentTaskTitle: row.currentTaskTitle,
      timezone: row.timezone,
      timezoneLabel: row.timezoneLabel,
      associatedContacts,
      ambiguity: 'none',
      source: 'athlete_contact_cache',
    } satisfies StudentAthleteMessageResolution];
  });
}

export async function resolveStudentAthleteMessagesForPhones(
  rawPhones: string[],
): Promise<StudentAthleteMessageResolution[]> {
  const { lookupActiveAthleteContactCacheForPhones } = await import('./athlete-contact-cache');
  const rows = await lookupActiveAthleteContactCacheForPhones(rawPhones);
  return buildStudentAthleteMessageResolutions(rows);
}
