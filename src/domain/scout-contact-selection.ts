import type { ScoutPrepContext } from '../features/scout-prep/types';

type ContactCandidate = {
  role: 'parent1' | 'parent2' | 'studentAthlete';
  name: string | null;
  rawPhone: string | null;
  normalizedPhone: string | null;
};

export type ProspectContactShortcutCandidate = {
  id: ContactCandidate['role'];
  label: string;
  name: string;
  phone: string;
};

export type VoicemailFollowUpRecipient = {
  id: ProspectContactShortcutCandidate['id'] | 'groupAll';
  label: string;
  name: string;
  phones: string[];
};

export type ScoutPrepContactSelection = {
  primaryNumber: string | null;
  backupNumber: string | null;
  spokeTo: string | null;
  otherParent: string | null;
  recipientName: string | null;
};

export type ParentHonorific = 'Mr.' | 'Ms.';

function buildContactCandidates(context: ScoutPrepContext): ContactCandidate[] {
  return [
    {
      role: 'parent1',
      name: context.contactInfo.parent1?.name || null,
      rawPhone: context.contactInfo.parent1?.phone || null,
      normalizedPhone: normalizePhoneForMessages(context.contactInfo.parent1?.phone),
    },
    {
      role: 'parent2',
      name: context.contactInfo.parent2?.name || null,
      rawPhone: context.contactInfo.parent2?.phone || null,
      normalizedPhone: normalizePhoneForMessages(context.contactInfo.parent2?.phone),
    },
    {
      role: 'studentAthlete',
      name: context.contactInfo.studentAthlete.name || null,
      rawPhone: context.contactInfo.studentAthlete.phone || null,
      normalizedPhone: normalizePhoneForMessages(context.contactInfo.studentAthlete.phone),
    },
  ];
}

function formatPhoneForMeetingDetails(raw?: string | null): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return null;
}

export function normalizePhoneForMessages(raw?: string | null): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return null;
}

export function resolveParentHonorificFromRelationship(
  relationship?: string | null,
): ParentHonorific | null {
  const normalized = String(relationship || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return null;
  }

  if (/\b(mother|mom|mum|mama|female|wife)\b/.test(normalized)) {
    return 'Ms.';
  }

  if (/\b(father|dad|papa|male|husband)\b/.test(normalized)) {
    return 'Mr.';
  }

  return null;
}

export function selectScoutPrepContactNumbers(
  context: ScoutPrepContext,
): ScoutPrepContactSelection {
  const uniqueByPhone = new Map<string, ContactCandidate>();
  for (const candidate of buildContactCandidates(context)) {
    if (candidate.normalizedPhone && !uniqueByPhone.has(candidate.normalizedPhone)) {
      uniqueByPhone.set(candidate.normalizedPhone, candidate);
    }
  }

  const ordered = Array.from(uniqueByPhone.values());
  const primary = ordered[0] || null;
  const backup = ordered[1] || null;
  const spokeTo =
    context.contactInfo.parent1?.name ||
    context.contactInfo.parent2?.name ||
    context.contactInfo.studentAthlete.name ||
    null;

  let otherParent: string | null = null;
  if (context.contactInfo.parent1?.name && context.contactInfo.parent2?.name) {
    otherParent =
      spokeTo === context.contactInfo.parent1.name
        ? context.contactInfo.parent2.name
        : context.contactInfo.parent1.name;
  }

  return {
    primaryNumber: primary?.normalizedPhone || null,
    backupNumber: backup?.normalizedPhone || null,
    spokeTo,
    otherParent,
    recipientName: primary?.role === 'studentAthlete' ? null : primary?.name || null,
  };
}

export function getProspectContactShortcutCandidates(
  context: ScoutPrepContext,
): ProspectContactShortcutCandidate[] {
  const candidates = buildContactCandidates(context)
    .filter(
      (candidate): candidate is ContactCandidate & { name: string; normalizedPhone: string } =>
        Boolean(candidate.name && candidate.normalizedPhone),
    )
    .map((candidate) => ({
      id: candidate.role,
      label:
        candidate.role === 'parent1'
          ? 'Parent 1'
          : candidate.role === 'parent2'
            ? 'Parent 2'
            : 'Student Athlete',
      name: candidate.name,
      phone: candidate.normalizedPhone,
    }));

  const uniqueByPhone = new Map<string, ProspectContactShortcutCandidate>();
  for (const candidate of candidates) {
    const existing = uniqueByPhone.get(candidate.phone);
    if (!existing || candidate.id === 'studentAthlete') {
      uniqueByPhone.set(candidate.phone, candidate);
    }
  }

  return Array.from(uniqueByPhone.values());
}

export function getVoicemailFollowUpRecipients(
  context: ScoutPrepContext,
): VoicemailFollowUpRecipient[] {
  const candidates = getProspectContactShortcutCandidates(context);
  const uniqueRecipients = new Map<string, VoicemailFollowUpRecipient>();
  for (const candidate of candidates) {
    if (uniqueRecipients.has(candidate.phone) && candidate.id !== 'studentAthlete') {
      continue;
    }
    uniqueRecipients.set(candidate.phone, {
      id: candidate.id,
      label: candidate.label,
      name: candidate.name,
      phones: [candidate.phone],
    });
  }

  const recipients = Array.from(uniqueRecipients.values());

  const groupPhones = Array.from(new Set(candidates.map((candidate) => candidate.phone)));
  if (groupPhones.length > 1) {
    recipients.push({
      id: 'groupAll',
      label: 'Group Text',
      name: 'All Associated Contacts',
      phones: groupPhones,
    });
  }

  if (!recipients.length && candidates[0]) {
    recipients.push({
      id: candidates[0].id,
      label: candidates[0].label,
      name: candidates[0].name,
      phones: [candidates[0].phone],
    });
  }

  return recipients;
}

export function getMeetingReminderRecipient(
  context: ScoutPrepContext,
): { phones: string[]; recipientNames: string[] } | null {
  const parent1Phone = normalizePhoneForMessages(context.contactInfo.parent1?.phone);
  const parent2Phone = normalizePhoneForMessages(context.contactInfo.parent2?.phone);
  const parent1Name = context.contactInfo.parent1?.name || null;
  const parent2Name = context.contactInfo.parent2?.name || null;

  if (parent1Phone) {
    return {
      phones: [parent1Phone],
      recipientNames: [parent1Name, parent2Name].filter((value): value is string =>
        Boolean(String(value || '').trim()),
      ),
    };
  }

  if (parent2Phone) {
    return {
      phones: [parent2Phone],
      recipientNames: [parent2Name].filter((value): value is string =>
        Boolean(String(value || '').trim()),
      ),
    };
  }

  const fallback = getProspectContactShortcutCandidates(context)[0];
  if (!fallback) {
    return null;
  }

  return {
    phones: [fallback.phone],
    recipientNames: [],
  };
}

export function buildMeetingDetailsContactSection(
  contactSelection: ScoutPrepContactSelection,
): {
  primaryNumber: string | null;
  backupNumber: string | null;
  spokeTo: string | null;
  otherParent: string | null;
} {
  return {
    primaryNumber: formatPhoneForMeetingDetails(contactSelection.primaryNumber),
    backupNumber: formatPhoneForMeetingDetails(contactSelection.backupNumber),
    spokeTo: contactSelection.spokeTo,
    otherParent: contactSelection.otherParent,
  };
}
