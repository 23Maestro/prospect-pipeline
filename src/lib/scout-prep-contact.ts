import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types';
import { resolveTimezone } from './scout-prep-ai';

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

export type ScoutPrepContactSelection = {
  primaryNumber: string | null;
  backupNumber: string | null;
  spokeTo: string | null;
  otherParent: string | null;
  recipientName: string | null;
};

const LEGACY_RECRUIT_TIMEZONE_BY_IANA: Record<string, string> = {
  'America/New_York': 'EST',
  'America/Detroit': 'EST',
  'America/Indiana/Indianapolis': 'EST',
  'America/Kentucky/Louisville': 'EST',
  'America/Chicago': 'CST',
  'America/Indiana/Knox': 'CST',
  'America/Menominee': 'CST',
  'America/North_Dakota/Beulah': 'CST',
  'America/North_Dakota/Center': 'CST',
  'America/North_Dakota/New_Salem': 'CST',
  'America/Denver': 'MST',
  'America/Boise': 'MST',
  'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PST',
  'America/Anchorage': 'AKST',
  'Pacific/Honolulu': 'HST',
  'America/Halifax': 'AST',
};

function firstName(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.split(/\s+/)[0] || null;
}

function sportLabel(value?: string | null): string {
  const cleaned = String(value || '').trim();
  return cleaned || 'their sport';
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

function splitShortcutContactName(name: string): { firstName: string; lastName: string } | null {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

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
  return buildContactCandidates(context)
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
}

export function buildVoicemailFollowUpBody(context: ScoutPrepContext): string {
  const greetingName =
    firstName(context.contactInfo.parent1?.name) ||
    firstName(context.contactInfo.parent2?.name) ||
    'Peter';
  const athleteName = context.contactInfo.studentAthlete.name || context.task.athlete_name;

  return `Hi ${greetingName}, this is Jerami with Prospect ID. I just left you a voicemail regarding ${athleteName}'s recruiting process. When you have a minute, call me back here and I can help you with next steps.`;
}

export function buildScoutPrepLeavingVoicemailBody(args: {
  parentName: string;
  athleteName: string;
  sport?: string | null;
  relationship?: 'son' | 'daughter';
}): string {
  const parentFirstName = firstName(args.parentName) || args.parentName || 'Parent';
  const athleteFirstName = firstName(args.athleteName) || args.athleteName || 'your athlete';
  const sport = sportLabel(args.sport).toLowerCase();
  const relationship = args.relationship || 'son';

  return [
    `Hi ${parentFirstName}, this is Jerami Singleton, college ${sport} scout with National Prospect ID.`,
    '',
    `The reason why I’m calling is because I had some information come across my desk today about your ${relationship} ${athleteFirstName}.`,
    '',
    `I had some questions I wanted to ask you about his desire to play college ${sport}, and I wanted to learn more about his academics and ${sport} talent.`,
    '',
    'Please give me a call back today, my number here is 407-473-3637.',
    '',
    `Thanks ${parentFirstName}, talk to you soon. Bye, Bye.`,
  ].join('\n');
}

export function buildMessagesComposeUrl(phone: string, body: string): string {
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

export function buildProspectContactShortcutPayload(args: {
  firstName: string;
  lastName: string;
  phone: string;
}): string {
  const firstName = args.firstName.trim();
  const lastName = args.lastName.trim();
  const phone = normalizePhoneForMessages(args.phone);

  if (!firstName || !lastName || !phone) {
    throw new Error('First name, last name, and phone number are required');
  }

  return [firstName, lastName, phone].join('\n');
}

export function buildProspectContactShortcutPayloadFromName(args: {
  fullName: string;
  phone: string;
}): string {
  const parsedName = splitShortcutContactName(args.fullName.trim());
  if (!parsedName) {
    throw new Error('Selected contact must include first and last name');
  }

  return buildProspectContactShortcutPayload({
    firstName: parsedName.firstName,
    lastName: parsedName.lastName,
    phone: args.phone,
  });
}

export function buildProspectContactShortcutUrl(payload: string): string {
  if (!payload.trim()) {
    throw new Error('Shortcut payload is required');
  }

  return `shortcuts://run-shortcut?name=Create%20Prospect%20Contact&input=text&text=${encodeURIComponent(payload)}`;
}

export function mapTimezoneToLegacyRecruitZone(timezone?: string | null): string | null {
  if (!timezone) {
    return null;
  }
  return LEGACY_RECRUIT_TIMEZONE_BY_IANA[timezone] || null;
}

function setTemplateValue(template: string, label: string, value?: string | null): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replacement = value ? `${label}: ${value}` : `${label}:`;
  const pattern = new RegExp(`^${escaped}:.*$`, 'm');
  return pattern.test(template) ? template.replace(pattern, replacement) : template;
}

export function mergeMeetingDetailsTemplate(
  template: string,
  contactSelection: ScoutPrepContactSelection,
): string {
  let merged = template;
  merged = setTemplateValue(
    merged,
    'Main Number',
    formatPhoneForMeetingDetails(contactSelection.primaryNumber),
  );
  merged = setTemplateValue(
    merged,
    'Backup Number',
    formatPhoneForMeetingDetails(contactSelection.backupNumber),
  );
  merged = setTemplateValue(merged, 'Spoke To', contactSelection.spokeTo);
  merged = setTemplateValue(merged, 'Other Parent', contactSelection.otherParent);
  return merged;
}

export function buildMeetingTemplateDefaults(
  template: MeetingSetTemplateResponse,
  context?: ScoutPrepContext | null,
): MeetingSetTemplateResponse {
  if (!context) {
    return template;
  }

  const contactSelection = selectScoutPrepContactNumbers(context);
  const computedTimezone = mapTimezoneToLegacyRecruitZone(
    resolveTimezone(context.resolved.city, context.resolved.state),
  );
  const optionValues = new Set(
    (template.recruit_timezone_options || []).map((option) => option.value),
  );
  const selectedTimezone =
    computedTimezone && optionValues.has(computedTimezone)
      ? computedTimezone
      : template.selected_recruit_timezone || null;

  return {
    ...template,
    selected_recruit_timezone: selectedTimezone,
    details_template: mergeMeetingDetailsTemplate(
      template.details_template || '',
      contactSelection,
    ),
  };
}
