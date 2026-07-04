import type { MeetingSetTemplateResponse, ScoutPrepContext } from '../features/scout-prep/types';
import { cleanPositions } from '../domain/position-text';
import { formatCurrentLocalTime, getNaturalZoneLabel, resolveTimezone } from './scout-prep-ai';
import {
  buildVoicemailFollowUpMessage,
  resolveAthleteGenderFromSport,
  resolveVoicemailFollowUpVariant,
  type AthleteGender,
  type VoicemailFollowUpVariant,
} from './scout-follow-up-templates';
import {
  buildMeetingDetailsContactSection,
  getMeetingReminderRecipient,
  getProspectContactRoleShortcutCandidates,
  getProspectContactShortcutCandidates,
  getVoicemailFollowUpRecipients,
  normalizePhoneForMessages,
  resolveParentHonorificFromRelationship,
  selectScoutPrepContactNumbers,
  type ParentHonorific,
  type ProspectContactShortcutCandidate,
  type ScoutPrepContactSelection,
  type VoicemailFollowUpRecipient,
} from '../domain/scout-contact-selection';

export {
  getMeetingReminderRecipient,
  getProspectContactRoleShortcutCandidates,
  getProspectContactShortcutCandidates,
  getVoicemailFollowUpRecipients,
  normalizePhoneForMessages,
  resolveParentHonorificFromRelationship,
  selectScoutPrepContactNumbers,
  type ParentHonorific,
  type ProspectContactShortcutCandidate,
  type ScoutPrepContactSelection,
  type VoicemailFollowUpRecipient,
} from '../domain/scout-contact-selection';

type ScoutPrepContactRole = ProspectContactShortcutCandidate['id'];

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

function getParentRelationship(
  context: ScoutPrepContext,
  recipientId?: ScoutPrepContactRole,
): string | null {
  return recipientId === 'parent2'
    ? context.contactInfo.parent2?.relationship || null
    : context.contactInfo.parent1?.relationship || null;
}

function parentHonorific(
  context: ScoutPrepContext,
  recipientId?: ScoutPrepContactRole,
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
  recipientId?: ScoutPrepContactRole,
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

export function buildVoicemailFollowUpBody(
  context: ScoutPrepContext,
  recipientId?: ScoutPrepContactRole | 'groupAll',
  variant?: VoicemailFollowUpVariant,
  crmStage?: string | null,
  currentTask?: string | null,
  now: Date = new Date(),
  honorificOverride?: ParentHonorific | null,
  athleteGender?: AthleteGender | null,
  rescheduleContext?: {
    previousHeadScoutName?: string | null;
    slots?: string[] | null;
    weekLabel?: string | null;
  },
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
    selectedVariant === 'parent_contact_intro'
      ? 'Hi [ParentFirst],'
      : selectedVariant === 'propose_times'
        ? `Hi ${firstName(recipient?.name) || greetingName},`
        : selectedVariant === 'no_show'
          ? `Hi ${noShowFirstName},`
          : recipient?.id === 'studentAthlete'
            ? `${dayGreeting} ${athleteFirstName},`
            : `${dayGreeting} ${greetingName},`;
  const recipientType = recipient?.id === 'studentAthlete' ? 'student_athlete' : 'parent';
  const contextHeadScoutName =
    String(context.resolved.head_scout || '')
      .trim()
      .replace(/^coach\s+/i, '') || null;

  return buildVoicemailFollowUpMessage({
    variant: selectedVariant,
    greeting,
    athleteName: athleteFirstName || athleteName || 'your athlete',
    recipientType,
    sport,
    gradYear,
    athleteGender,
    signOffTitle,
    previousHeadScoutName: rescheduleContext?.previousHeadScoutName || contextHeadScoutName,
    rescheduleSlots: rescheduleContext?.slots,
    rescheduleWeekLabel: rescheduleContext?.weekLabel,
    now,
  });
}

export function buildScoutPrepLeavingVoicemailBody(args: {
  parentName: string;
  athleteName: string;
  sport?: string | null;
  athleteGender?: AthleteGender | null;
  crmStage?: string | null;
  currentTask?: string | null;
}): string {
  const parentFirstName = firstName(args.parentName) || args.parentName || 'Parent';
  const athleteFirstName = firstName(args.athleteName) || args.athleteName || 'your athlete';
  const sportName = sportLabel(args.sport);
  const coordinatorSport = sportName.charAt(0).toUpperCase() + sportName.slice(1);
  const sport = sportName.toLowerCase();
  const selectedVariant = resolveVoicemailFollowUpVariant({
    crmStage: args.crmStage,
    currentTask: args.currentTask,
  });

  if (selectedVariant === 'call_attempt_2' || selectedVariant === 'call_attempt_3') {
    return [
      `Hi ${parentFirstName}, this is Scouting Coordinator with Prospect ID.`,
      '',
      `Checking back on ${athleteFirstName}’s college ${sport} profile.`,
      '',
      'If this is still worth a conversation, call or text me back at 555-0100.',
    ].join('\n');
  }

  return [
    `Hi ${parentFirstName}, this is Scouting Coordinator ${coordinatorSport} Scouting Coordinator with Prospect ID.`,
    '',
    `I’m reaching out on ${athleteFirstName}’s college ${sport} profile.`,
    '',
    'If playing at the next level is still a real goal, call or text me back at 555-0100.',
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

export function resolveProspectContactCreateFailureToast(error: unknown): {
  title: string;
  message: string;
  duplicateLike: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/NSCocoaErrorDomain[\s\S]*Code=134092|Code=134092|Unhandled error occurred during faulting/i.test(message)) {
    return {
      title: 'Already exists',
      message: '',
      duplicateLike: true,
    };
  }

  return {
    title: 'Contact create failed',
    message,
    duplicateLike: false,
  };
}

export function mapTimezoneToLegacyRecruitZone(timezone?: string | null): string | null {
  if (!timezone) {
    return null;
  }
  return LEGACY_RECRUIT_TIMEZONE_BY_IANA[timezone] || null;
}

export function buildProspectContactAdminNote(context: ScoutPrepContext): string {
  const timezone =
    String(context.resolved.timezone || '').trim() ||
    resolveTimezone(context.resolved.city, context.resolved.state);
  const athleteName =
    context.contactInfo.studentAthlete.name || context.task.athlete_name || 'Student Athlete';

  if (!timezone) {
    return athleteName;
  }

  const zoneLabel = getNaturalZoneLabel(timezone);
  return [`Timezone: ${zoneLabel}`, '', athleteName].join('\n');
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

export function buildMeetingSetCallNotesMarkdown(args: { meetingDetails: string }): string {
  return args.meetingDetails.trim();
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

function formatMaxPrepsTopSlot(template: string, url?: string | null): string {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    if (template.startsWith('\n\n')) {
      return template;
    }

    return `\n\n${template.trimStart()}`;
  }

  const trimmed = template.trimStart();
  if (trimmed.startsWith(normalizedUrl)) {
    return template;
  }

  return `${normalizedUrl}\n\n${template}`;
}

export function mergeMeetingDetailsTemplate(
  template: string,
  contactSelection: ScoutPrepContactSelection,
  context?: ScoutPrepContext | null,
): string {
  let merged = template;
  const details = buildMeetingDetailsContactSection(contactSelection);
  merged = setTemplateValue(merged, 'Main Number', details.primaryNumber);
  merged = setTemplateValue(merged, 'Backup Number', details.backupNumber);
  merged = setTemplateValue(merged, 'Spoke To', details.spokeTo);
  merged = setTemplateValue(merged, 'Other Parent', details.otherParent);

  if (context) {
    merged = replaceSectionBody(merged, 'About The Athlete', buildAthleteDetailsLines(context));
    merged = upsertGpaLine(merged, context.resolved.gpa);
    merged = formatMaxPrepsTopSlot(
      merged,
      context.resolved.maxpreps?.url || context.resolved.maxpreps_url,
    );
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

function buildFallbackMeetingDetailsTemplate(): string {
  return [
    'Main Number:',
    'Backup Number:',
    'Spoke To:',
    'Other Parent:',
    '',
    'About The Athlete:',
    '',
    'Deficit:',
    '',
    'Other Details:',
  ].join('\n');
}

const DEFAULT_RECRUIT_TIMEZONES = ['AST', 'EST', 'CST', 'MST', 'PST', 'AKST', 'HST'];

export function hydrateMeetingSetTemplateForForm(
  template: MeetingSetTemplateResponse,
  context?: ScoutPrepContext | null,
  defaults: {
    athleteName?: string | null;
    gradYear?: string | number | null;
    fallbackTimezone?: string | null;
  } = {},
): MeetingSetTemplateResponse {
  const fallbackTimezone =
    String(defaults.fallbackTimezone || template.selected_recruit_timezone || '').trim() || 'EST';
  const meetingName =
    String(template.meeting_name || '').trim() ||
    `${String(defaults.athleteName || '').trim()} ${String(defaults.gradYear || '').trim()}`.trim();
  const recruitTimezoneOptions = template.recruit_timezone_options?.length
    ? template.recruit_timezone_options
    : DEFAULT_RECRUIT_TIMEZONES.map((zone) => ({
        value: zone,
        label: zone,
        selected: zone === fallbackTimezone,
      }));

  return buildMeetingTemplateDefaults(
    {
      ...template,
      meeting_name: meetingName,
      selected_recruit_timezone: fallbackTimezone,
      recruit_timezone_options: recruitTimezoneOptions,
      details_template:
        String(template.details_template || '').trim() || buildFallbackMeetingDetailsTemplate(),
    },
    context,
  );
}
