import type { AthleteContactCacheClientMatch } from './athlete-contact-cache';

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
  currentTaskTitle: string | null;
  primaryContact: StudentAthleteMessageAssociatedContact | null;
  associatedContacts: StudentAthleteMessageAssociatedContact[];
  ambiguity: 'none' | 'multiple_athletes';
  source: 'athlete_contact_cache';
};

const CONTACT_ROLE_PRIORITY = ['parent1', 'parent2', 'studentAthlete'] as const;

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
): StudentAthleteMessageAssociatedContact[] {
  const contactsByPhone = new Map<string, StudentAthleteMessageAssociatedContact>();
  for (const row of rows) {
    const contact = {
      role: relationshipRole(row),
      name: toDisplayName(row.contactName) || row.contactName,
      relationshipLabel: row.relationshipLabel,
      normalizedPhoneNumber: row.normalizedPhone,
    } satisfies StudentAthleteMessageAssociatedContact;
    const existing = contactsByPhone.get(contact.normalizedPhoneNumber);
    if (shouldReplaceContactForPhone(existing, contact)) {
      contactsByPhone.set(contact.normalizedPhoneNumber, contact);
    }
  }

  return Array.from(contactsByPhone.values()).sort((left, right) => {
    const leftIndex = CONTACT_ROLE_PRIORITY.indexOf(
      left.role as (typeof CONTACT_ROLE_PRIORITY)[number],
    );
    const rightIndex = CONTACT_ROLE_PRIORITY.indexOf(
      right.role as (typeof CONTACT_ROLE_PRIORITY)[number],
    );
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight;
  });
}

function shouldReplaceContactForPhone(
  existing: StudentAthleteMessageAssociatedContact | undefined,
  incoming: StudentAthleteMessageAssociatedContact,
): boolean {
  if (!existing) return true;
  return incoming.role === 'studentAthlete';
}

export function buildStudentAthleteMessageResolutions(
  rows: AthleteContactCacheClientMatch[],
): StudentAthleteMessageResolution[] {
  const rowsByAthleteKey = new Map<string, AthleteContactCacheClientMatch[]>();
  const athleteKeysByPhone = new Map<string, Set<string>>();

  for (const row of rows) {
    rowsByAthleteKey.set(row.athleteKey, [...(rowsByAthleteKey.get(row.athleteKey) || []), row]);
    athleteKeysByPhone.set(
      row.normalizedPhone,
      new Set([...(athleteKeysByPhone.get(row.normalizedPhone) || []), row.athleteKey]),
    );
  }

  return Array.from(
    new Map(rows.map((row) => [`${row.athleteKey}:${row.normalizedPhone}`, row])).values(),
  ).map((row) => {
    const associatedContacts = associatedContactsForAthlete(
      rowsByAthleteKey.get(row.athleteKey) || [row],
    );
    const primaryContact =
      associatedContacts.find((contact) => contact.normalizedPhoneNumber === row.normalizedPhone) ||
      null;
    return {
      normalizedPhone: row.normalizedPhone,
      displayName: primaryContact?.name || toDisplayName(row.contactName) || row.contactName,
      athleteKey: row.athleteKey,
      athleteId: row.athleteId,
      athleteMainId: row.athleteMainId,
      athleteName: toDisplayName(row.athleteName) || row.athleteName,
      contactId: row.contactId || row.athleteId,
      crmStage: row.crmStage,
      taskStatus: row.taskStatus,
      currentTaskTitle: row.currentTaskTitle,
      primaryContact,
      associatedContacts,
      ambiguity:
        (athleteKeysByPhone.get(row.normalizedPhone)?.size || 0) > 1 ? 'multiple_athletes' : 'none',
      source: 'athlete_contact_cache',
    } satisfies StudentAthleteMessageResolution;
  });
}

export async function resolveStudentAthleteMessagesForPhones(
  rawPhones: string[],
): Promise<StudentAthleteMessageResolution[]> {
  const { lookupActiveAthleteContactCacheForPhones } = await import('./athlete-contact-cache');
  const rows = await lookupActiveAthleteContactCacheForPhones(rawPhones);
  return buildStudentAthleteMessageResolutions(rows);
}
