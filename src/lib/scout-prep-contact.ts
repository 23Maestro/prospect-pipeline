import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types';
import { formatCurrentLocalTime, resolveTimezone } from './scout-prep-ai';

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
  const cleaned = String(value || '').trim();
  return cleaned || 'their sport';
}

function lowerFirst(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function parentHonorific(
  context: ScoutPrepContext,
  recipientId?: ContactCandidate['role'],
): string {
  const relationship =
    recipientId === 'parent2'
      ? context.contactInfo.parent2?.relationship
      : context.contactInfo.parent1?.relationship;
  return String(relationship || '')
    .trim()
    .toLowerCase() === 'mother'
    ? 'Ms.'
    : 'Mr.';
}

function recipientGreeting(
  context: ScoutPrepContext,
  recipientId?: ContactCandidate['role'],
): string {
  const selectedName =
    recipientId === 'parent2'
      ? context.contactInfo.parent2?.name
      : context.contactInfo.parent1?.name || context.contactInfo.parent2?.name;
  const selectedLastName = lastName(selectedName);
  return selectedLastName
    ? `${parentHonorific(context, recipientId)} ${selectedLastName}`
    : 'there';
}

function buildGradYearSentence(gradYear?: string | null): string {
  const normalized = String(gradYear || '')
    .trim()
    .toLowerCase();

  switch (normalized) {
    case 'freshman':
      return 'As a freshman, this is a good time to learn more about his goals early in the recruiting process.';
    case 'sophomore':
      return 'As a sophomore, this is a good time to learn more about his goals as recruiting starts to take shape.';
    case 'junior':
      return `As a junior, this is a key stretch with recruiting picking up.`;
    case 'senior':
      return `As a senior, this is an important stage with recruiting decisions getting closer.`;
    default:
      return 'This is a good time to learn more about goals going forward.';
  }
}

function buildWeekClosing(now: Date): string {
  const day = now.getDay();
  if (day === 5 || day === 6 || day === 0) {
    return 'Enjoy the rest of your weekend.';
  }
  return 'Enjoy the rest of your week.';
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
  const parentRecipients = candidates.filter(
    (candidate) => candidate.id === 'parent1' || candidate.id === 'parent2',
  );
  const uniqueParentRecipients = new Map<string, VoicemailFollowUpRecipient>();
  for (const candidate of parentRecipients) {
    if (uniqueParentRecipients.has(candidate.phone)) {
      continue;
    }
    uniqueParentRecipients.set(candidate.phone, {
      id: candidate.id,
      label: candidate.label,
      name: candidate.name,
      phones: [candidate.phone],
    });
  }

  const recipients = Array.from(uniqueParentRecipients.values());

  const allPhones = Array.from(new Set(candidates.map((candidate) => candidate.phone)));
  if (allPhones.length > 1) {
    recipients.push({
      id: 'groupAll',
      label: 'Group Text',
      name: 'All Associated Contacts',
      phones: allPhones,
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
      recipientNames: [parent1Name, parent2Name].filter((value): value is string => Boolean(String(value || '').trim())),
    };
  }

  if (parent2Phone) {
    return {
      phones: [parent2Phone],
      recipientNames: [parent2Name].filter((value): value is string => Boolean(String(value || '').trim())),
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
  now: Date = new Date(),
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
  );
  const signOffTitle = `${sportLabel(context.resolved.sport)} Scouting Coordinator`;
  const dayGreeting = buildTimeOfDayGreeting(context, now);

  return [
    `${dayGreeting} ${greetingName}, this is Jerami with Prospect ID. I'm the college ${sport} scout here.`,
    '',
    `We received ${athleteFirstName}'s recruiting profile, and I wanted to learn a little more about him on the academic and athletic side. ${buildGradYearSentence(gradYear)}`,
    '',
    'I wanted to follow up by text so you can get back to me when you get a few minutes. This is my direct cell, so feel free to text or call me here anytime.',
    '',
    'When do you have a quick 10-minute window today or over the next few days? I can be flexible on time.',
    '',
    `${buildWeekClosing(now)}`,
    '',
    'Jerami Singleton',
    signOffTitle,
    'Prospect ID',
  ].join('\n');
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

  return `sms:${uniquePhones.join(',')}?body=${encodeURIComponent(body)}`;
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
