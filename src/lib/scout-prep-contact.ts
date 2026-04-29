import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types';
import { formatCurrentLocalTime, resolveTimezone } from './scout-prep-ai';
import { cleanPositions } from './prospect-search';
import {
  buildVoicemailFollowUpMessage,
  resolveAthleteGenderFromSport,
  resolveVoicemailFollowUpVariant,
  type AthleteGender,
  type VoicemailFollowUpVariant,
} from './scout-follow-up-templates';

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

function lastName(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || null;
}

function sportLabel(value?: string | null): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/^(men's|mens|women's|womens)\s+/i, '');
  return cleaned || 'their sport';
}

function lowerFirst(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
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

function getParentRelationship(
  context: ScoutPrepContext,
  recipientId?: ContactCandidate['role'],
): string | null {
  return recipientId === 'parent2'
    ? context.contactInfo.parent2?.relationship || null
    : context.contactInfo.parent1?.relationship || null;
}

function parentHonorific(
  context: ScoutPrepContext,
  recipientId?: ContactCandidate['role'],
  honorificOverride?: ParentHonorific | null,
): ParentHonorific {
  return (
    honorificOverride ||
    resolveParentHonorificFromRelationship(getParentRelationship(context, recipientId)) ||
    'Mr.'
  );
}

function recipientGreeting(
  context: ScoutPrepContext,
  recipientId?: ContactCandidate['role'],
  honorificOverride?: ParentHonorific | null,
): string {
  const selectedName =
    recipientId === 'parent2'
      ? context.contactInfo.parent2?.name
      : context.contactInfo.parent1?.name || context.contactInfo.parent2?.name;
  const selectedLastName = lastName(selectedName);
  return selectedLastName
    ? `${parentHonorific(context, recipientId, honorificOverride)} ${selectedLastName}`
    : 'there';
}

export function buildTimeOfDayGreeting(context: ScoutPrepContext, now: Date = new Date()): string {
  const timezone = resolveTimezone(context.resolved.city, context.resolved.state);
  if (!timezone) {
    return 'Good morning';
  }

  const formattedHour = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  const hour = Number.parseInt(formattedHour, 10);

  if (Number.isNaN(hour)) {
    const fallbackTime = formatCurrentLocalTime(timezone, now).toLowerCase();
    if (fallbackTime.includes('pm')) {
      return 'Good afternoon';
    }
    return 'Good morning';
  }

  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
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

export function buildVoicemailFollowUpBody(
  context: ScoutPrepContext,
  recipientId?: ContactCandidate['role'] | 'groupAll',
  variant?: VoicemailFollowUpVariant,
  crmStage?: string | null,
  currentTask?: string | null,
  now: Date = new Date(),
  honorificOverride?: ParentHonorific | null,
  athleteGender?: AthleteGender | null,
): string {
  const recipients = getVoicemailFollowUpRecipients(context);
  const recipient =
    recipients.find((candidate) => candidate.id === recipientId) || recipients[0] || null;
  const athleteName = context.contactInfo.studentAthlete.name || context.task.athlete_name;
  const athleteFirstName = firstName(athleteName) || athleteName || 'your athlete';
  const sport = lowerFirst(sportLabel(context.resolved.sport));
  const gradYear = String(context.task.grad_year || '').trim();
  const greetingName = recipientGreeting(
    context,
    recipient?.id === 'parent2' ? 'parent2' : 'parent1',
    honorificOverride,
  );
  const signOffTitle = `${sportLabel(context.resolved.sport)} Scouting Coordinator`;
  const dayGreeting = buildTimeOfDayGreeting(context, now);
  const selectedVariant =
    variant ||
    resolveVoicemailFollowUpVariant({
      crmStage,
      currentTask: currentTask || context.task.title || null,
    });
  const noShowFirstName =
    firstName(
      recipient?.id === 'parent2'
        ? context.contactInfo.parent2?.name
        : context.contactInfo.parent1?.name || context.contactInfo.parent2?.name,
    ) || 'there';
  const greeting =
    selectedVariant === 'no_show'
      ? `Hi ${noShowFirstName},`
      : recipient?.id === 'studentAthlete'
        ? `${dayGreeting} ${athleteFirstName},`
        : `${dayGreeting} ${greetingName},`;
  const recipientType = recipient?.id === 'studentAthlete' ? 'student_athlete' : 'parent';

  return buildVoicemailFollowUpMessage({
    variant: selectedVariant,
    greeting,
    athleteName: athleteFirstName || athleteName || 'your athlete',
    recipientType,
    sport,
    gradYear,
    athleteGender,
    signOffTitle,
    now,
  });
}

export function buildScoutPrepLeavingVoicemailBody(args: {
  parentName: string;
  athleteName: string;
  sport?: string | null;
  athleteGender?: AthleteGender | null;
}): string {
  const parentFirstName = firstName(args.parentName) || args.parentName || 'Parent';
  const athleteFirstName = firstName(args.athleteName) || args.athleteName || 'your athlete';
  const sport = sportLabel(args.sport).toLowerCase();
  const gender = args.athleteGender || resolveAthleteGenderFromSport(args.sport) || 'male';
  const childLabel = gender === 'female' ? 'daughter' : 'son';
  const possessive = gender === 'female' ? 'her' : 'his';

  return [
    `Hi ${parentFirstName}, this is Jerami Singleton, college ${sport} scout with National Prospect ID.`,
    '',
    `The reason why I’m calling is because I had some information come across my desk today about your ${childLabel} ${athleteFirstName}.`,
    '',
    `I had some questions I wanted to ask you about ${possessive} desire to play college ${sport}, and I wanted to learn more about ${possessive} academics and ${sport} talent.`,
    '',
    'Please give me a call back today, my number here is 407-473-3637.',
    '',
    `Thanks ${parentFirstName}, talk to you soon. Bye, Bye.`,
  ].join('\n');
}

export function buildMessagesComposeUrl(phone: string, body: string): string {
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

export function buildMessagesComposeUrlForRecipients(phones: string[], body: string): string {
  const uniquePhones = Array.from(
    new Set(
      phones
        .map((phone) => normalizePhoneForMessages(phone))
        .filter((phone): phone is string => Boolean(phone)),
    ),
  );

  if (!uniquePhones.length) {
    throw new Error('At least one valid phone number is required');
  }

  if (uniquePhones.length === 1) {
    return `sms:${uniquePhones[0]}?body=${encodeURIComponent(body)}`;
  }

  return `sms:/open?addresses=${encodeURIComponent(uniquePhones.join(','))}&body=${encodeURIComponent(body)}`;
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

function buildAthleteDetailsLines(context: ScoutPrepContext): string[] {
  const lines: string[] = [];
  const positions = cleanPositions(context.resolved.positions || undefined);
  const heightWeight = [context.resolved.height, context.resolved.weight]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' | ');
  const highSchool = String(context.resolved.high_school || '').trim();

  if (positions) {
    lines.push(positions);
  }
  if (heightWeight) {
    lines.push(heightWeight);
  }
  if (highSchool) {
    lines.push(highSchool);
  }

  return lines;
}

function replaceSectionBody(template: string, label: string, lines: string[]): string {
  if (!lines.length) {
    return template;
  }

  const normalized = template.replace(/\r\n?/g, '\n');
  const sectionHeader = `${label}:`;
  const nextSectionHeaders = new Set(['Deficit:', 'Other Details:']);
  const sourceLines = normalized.split('\n');
  const startIndex = sourceLines.findIndex((line) => line.trim() === sectionHeader);

  if (startIndex === -1) {
    return template;
  }

  let endIndex = sourceLines.length;
  for (let index = startIndex + 1; index < sourceLines.length; index += 1) {
    if (nextSectionHeaders.has(sourceLines[index].trim())) {
      endIndex = index;
      break;
    }
  }

  const rebuilt = [
    ...sourceLines.slice(0, startIndex + 1),
    ...lines,
    ...sourceLines.slice(endIndex),
  ].join('\n');

  return rebuilt;
}

function upsertGpaLine(template: string, gpa?: string | null): string {
  const normalizedGpa = String(gpa || '').trim();
  const pattern = /^GPA .*$/m;

  if (!normalizedGpa) {
    return template.replace(pattern, '').replace(/\n{3,}/g, '\n\n');
  }

  const nextLine = `GPA ${normalizedGpa}`;
  if (pattern.test(template)) {
    return template.replace(pattern, nextLine);
  }

  const deficitIndex = template.indexOf('\nDeficit:');
  if (deficitIndex >= 0) {
    return `${template.slice(0, deficitIndex).trimEnd()}\n\n${nextLine}${template.slice(deficitIndex)}`;
  }

  return `${template.trimEnd()}\n\n${nextLine}`;
}

export function mergeMeetingDetailsTemplate(
  template: string,
  contactSelection: ScoutPrepContactSelection,
  context?: ScoutPrepContext | null,
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

  if (context) {
    merged = replaceSectionBody(merged, 'About The Athlete', buildAthleteDetailsLines(context));
    merged = upsertGpaLine(merged, context.resolved.gpa);
  }

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
      context,
    ),
  };
}
