import { resolveSalesLifecycle } from './sales-lifecycle';
import {
  getConfirmationClockLabel as resolveConfirmationClockLabel,
  getConfirmationDatePhrase as resolveConfirmationDatePhrase,
  getConfirmationDayPhrase as resolveConfirmationDayPhrase,
  getConfirmationTimezoneLabel as resolveConfirmationTimezoneLabel,
  getMeetingReminderPhrase as resolveMeetingReminderPhrase,
  getTimeOfDayBucket,
  getReminderTimeLabel as resolveReminderTimeLabel,
} from '../domain/outreach-time-wording';

export const DEFAULT_FOLLOW_UP_SENDER_NAME = 'Jerami Singleton';
export const CAL_BOOKING_URL = 'https://cal.com/jsingleton-prospectid/prospect-id-call';

export type FollowUpMessageType = 'call_attempt_2' | 'confirmation';
export type VoicemailFollowUpVariant =
  | 'call_attempt_1'
  | 'call_attempt_2'
  | 'call_attempt_3'
  | 'no_show'
  | 'send_cal_link';
export type ConfirmationFollowUpVariant = 'confirmation_1' | 'confirmation_2';
export type FollowUpMessageVariant = VoicemailFollowUpVariant | ConfirmationFollowUpVariant;
export type AthleteGender = 'male' | 'female';

export type MinimalFollowUpQueueRecord = {
  title: string;
  status: 'Open' | 'Sent' | 'Canceled';
  messageType: FollowUpMessageType;
  dueAt: string;
  athlete: string;
  parent1: string | null;
  parent2: string | null;
  currentTask: string;
  raycastKey: string;
  crmStage?: string | null;
  workflowStatus?: string | null;
  lifecycleState?: string | null;
  reason?: string | null;
  messageVariant?: FollowUpMessageVariant | null;
};

function firstName(value?: string | null): string {
  return (
    String(value || '')
      .trim()
      .split(/\s+/)[0] || ''
  );
}

function formatConfirmationClockLabel(date: Date, timezoneLabel?: string | null): string {
  return resolveConfirmationClockLabel({ meetingStart: date, meetingTimezone: timezoneLabel });
}

function getConfirmationDatePhrase(args: {
  dueAt: Date;
  meetingTimezone?: string | null;
  now?: Date;
}): string {
  return resolveConfirmationDatePhrase({
    meetingStart: args.dueAt,
    meetingTimezone: args.meetingTimezone,
    now: args.now,
  });
}

function getConfirmationTimezoneLabel(timezoneLabel?: string | null): string {
  return resolveConfirmationTimezoneLabel(timezoneLabel);
}

function removeDayPeriod(timeLabel: string): string {
  return timeLabel.replace(/\s?[ap]m$/i, '');
}

function getConfirmationDayPhrase(args: {
  dueAt: Date;
  meetingTimezone?: string | null;
  now?: Date;
}): string {
  return resolveConfirmationDayPhrase({
    meetingStart: args.dueAt,
    meetingTimezone: args.meetingTimezone,
    now: args.now,
  });
}

function normalizeCurrentTask(value?: string | null): string {
  return String(value || '').trim() || 'Pending follow-up';
}

function normalizeText(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function sportScoutLabel(value?: string | null): string {
  const trimmed = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(men's|mens|women's|womens)\s+/i, '');
  return trimmed || 'football';
}

function normalizeSportKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function resolveAthleteGenderFromSport(sport?: string | null): AthleteGender | null {
  const normalized = normalizeSportKey(sport);
  if (!normalized) {
    return null;
  }

  if (/\b(womens|women|girls|female)\b/.test(normalized)) {
    return 'female';
  }

  if (/\b(mens|men|boys|male)\b/.test(normalized)) {
    return 'male';
  }

  if (/\b(softball|volleyball|field hockey|gymnastics|cheer|dance)\b/.test(normalized)) {
    return 'female';
  }

  if (/\b(football|baseball|wrestling)\b/.test(normalized)) {
    return 'male';
  }

  return null;
}

function athletePronouns(args: { sport?: string | null; athleteGender?: AthleteGender | null }) {
  const gender = args.athleteGender || resolveAthleteGenderFromSport(args.sport) || 'male';
  return gender === 'female'
    ? { subject: 'she', object: 'her', possessive: 'her', child: 'daughter' }
    : { subject: 'he', object: 'him', possessive: 'his', child: 'son' };
}

function buildNoShowNextBestDayLabel(now: Date): string {
  const candidate = new Date(now);
  candidate.setDate(candidate.getDate() + 2);

  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(candidate);
}

function getEasternTimeParts(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value || '', 10);
  const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value || '', 10);

  return {
    hour: Number.isNaN(hour) ? date.getHours() : hour,
    minute: Number.isNaN(minute) ? date.getMinutes() : minute,
  };
}

export function isPastTextTodayCutoff(now: Date): boolean {
  const { hour, minute } = getEasternTimeParts(now);
  return hour > 19 || (hour === 19 && minute >= 30);
}

export function buildFollowUpTitle(messageType: FollowUpMessageType, athleteName: string): string {
  return athleteName.trim();
}

export function buildFollowUpRaycastKey(args: {
  messageType: FollowUpMessageType;
  athleteId: string;
  taskId: string;
}): string {
  const prefix = args.messageType === 'call_attempt_2' ? 'call-attempt-2' : 'confirmation';
  return `${prefix}:${args.athleteId.trim()}:${args.taskId.trim()}`;
}

export function resolveVoicemailFollowUpVariant(args: {
  crmStage?: string | null;
  currentTask?: string | null;
}): VoicemailFollowUpVariant {
  const rawCandidates = [args.currentTask, args.crmStage]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (
    rawCandidates.some(
      (value) =>
        value.includes('left voice mail 3') ||
        value.includes('left voicemail 3') ||
        value.includes('call attempt 3'),
    )
  ) {
    return 'call_attempt_3';
  }

  if (
    rawCandidates.some(
      (value) =>
        value.includes('no show') ||
        value.includes('no-show') ||
        value.includes('left voice mail 2') ||
        value.includes('left voicemail 2') ||
        value.includes('call attempt 2') ||
        value.includes('second time') ||
        value.includes('second voicemail') ||
        value.includes('follow-up voicemail'),
    )
  ) {
    if (rawCandidates.some((value) => value.includes('no show') || value.includes('no-show'))) {
      return 'no_show';
    }
    return 'call_attempt_2';
  }

  return 'call_attempt_1';
}

export function resolveConfirmationFollowUpVariant(args: {
  crmStage?: string | null;
  currentTask?: string | null;
  lifecycleState?: string | null;
}): ConfirmationFollowUpVariant {
  const lifecycle = resolveSalesLifecycle(args.crmStage);
  const rawCandidates = [args.currentTask, args.crmStage, args.lifecycleState, lifecycle.reason]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (
    rawCandidates.some(
      (value) =>
        value.includes('confirmation 2') ||
        value.includes('confirm 2') ||
        value.includes('second confirmation') ||
        value.includes('reminder 2'),
    )
  ) {
    return 'confirmation_2';
  }

  return 'confirmation_1';
}

export function buildVoicemailFollowUpMessage(args: {
  variant: VoicemailFollowUpVariant;
  greeting: string;
  athleteName: string;
  recipientType?: 'parent' | 'student_athlete';
  senderName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  athleteGender?: AthleteGender | null;
  signOffTitle?: string | null;
  closingLine?: string | null;
  now?: Date;
}): string {
  const greeting = String(args.greeting || '').trim() || 'Good morning there,';
  const senderName = String(args.senderName || '').trim() || DEFAULT_FOLLOW_UP_SENDER_NAME;
  const scoutLabel = sportScoutLabel(args.sport);
  const now = args.now || new Date();
  const recipientType = args.recipientType || 'parent';
  const pronouns = athletePronouns({
    sport: args.sport,
    athleteGender: args.athleteGender,
  });

  const lines =
    args.variant === 'send_cal_link'
      ? ['Great! Here’s the link to schedule a quick call:', CAL_BOOKING_URL]
      : recipientType === 'student_athlete' && args.variant === 'no_show'
        ? [
            `${greeting} this is ${senderName} with Prospect ID. Looks like we missed your meeting with our Head Scout.`,
            '',
            `If playing college ${scoutLabel} is still a serious goal for you, have one of your parents call or text me back so we can get it rescheduled.`,
          ]
        : recipientType === 'student_athlete' && args.variant === 'call_attempt_3'
          ? [
              `${greeting} this is ${senderName} with Prospect ID. Last follow-up on your college ${scoutLabel} profile.`,
              '',
              'If playing in college is still a real goal, have one of your parents reach out. If not, no worries.',
            ]
          : recipientType === 'student_athlete' && args.variant === 'call_attempt_2'
            ? [
                `${greeting} this is ${senderName} with Prospect ID. Any updates or questions on playing college ${scoutLabel}?`,
                '',
                'If this is still something you want, have one of your parents call or text me.',
              ]
            : recipientType === 'student_athlete'
              ? [
                  `${greeting} this is ${senderName} with Prospect ID. I received your info about playing college ${scoutLabel}.`,
                  '',
                  'If you’re serious about this, have one of your parents call or text me.',
                ]
              : args.variant === 'no_show'
                ? [
                    `${greeting} looks like we missed you for ${args.athleteName.trim() || 'your athlete'}’s meeting with our Head Scout.`,
                    '',
                    `No worries, things come up. If playing college ${scoutLabel} is still a serious goal for ${pronouns.object}, let’s get you back on the schedule while timing still matters.`,
                    '',
                    `Would tomorrow or ${buildNoShowNextBestDayLabel(now)} work better?`,
                  ]
                : args.variant === 'call_attempt_3'
                  ? [
                      `${greeting} choose what’s most relevant so I can be helpful:`,
                      '',
                      '1 - not interested whatsoever',
                      '2 - interested but bad timing',
                      '3 - interested and ready to learn about next steps',
                    ]
                  : args.variant === 'call_attempt_2'
                    ? [
                        `${greeting} any updates or questions on this?`,
                        '',
                        'If I send you a calendar link, would that be more convenient?',
                      ]
                    : [
                        `${greeting} this is ${senderName} with Prospect ID. ${args.athleteName.trim() || 'Your athlete'}’s profile came through and I wanted to ask a few quick questions about ${pronouns.possessive} college ${scoutLabel} goals.`,
                        '',
                        'Would later today or tomorrow work for a quick 10-minute call?',
                      ];

  return lines.join('\n');
}

export function buildCallAttempt2Message(args: {
  recipientName: string;
  athleteName: string;
  senderName: string;
  sport?: string | null;
  gradYear?: string | null;
  athleteGender?: AthleteGender | null;
}): string {
  return buildVoicemailFollowUpMessage({
    variant: 'call_attempt_2',
    greeting: `Good morning ${String(args.recipientName || '').trim() || 'there'},`,
    athleteName: args.athleteName,
    senderName: args.senderName,
    sport: args.sport,
    gradYear: args.gradYear,
    athleteGender: args.athleteGender,
  });
}

export function getTimeOfDayPhrase(
  date: Date,
  meetingTimezone?: string | null,
): 'this morning' | 'this afternoon' | 'this evening' {
  const bucket = getTimeOfDayBucket(date, meetingTimezone);
  if (bucket === 'morning') return 'this morning';
  if (bucket === 'afternoon') return 'this afternoon';
  return 'this evening';
}

export function getCoachReferenceName(headScoutName?: string | null): string {
  const normalized = String(headScoutName || '')
    .trim()
    .replace(/^coach\s+/i, '')
    .trim();
  return normalized || 'Coach';
}

export function getReminderTimeLabel(date: Date, meetingTimezone?: string | null): string {
  return resolveReminderTimeLabel({ meetingStart: date, meetingTimezone });
}

export function buildConfirmationMessage(args: {
  variant?: ConfirmationFollowUpVariant;
  headScoutName?: string | null;
  dueAt: Date;
  meetingTimezone?: string | null;
  recipientNames?: string[] | null;
  greetingOverride?: string | null;
  now?: Date;
}): string {
  const coachName = getCoachReferenceName(args.headScoutName);
  const meetingReminderPhrase = resolveMeetingReminderPhrase({
    meetingStart: args.dueAt,
    meetingTimezone: args.meetingTimezone,
    now: args.now,
  });
  const confirmationDatePhrase = getConfirmationDatePhrase({
    dueAt: args.dueAt,
    meetingTimezone: args.meetingTimezone,
    now: args.now,
  });
  const confirmationClockLabel = formatConfirmationClockLabel(args.dueAt, args.meetingTimezone);
  const confirmationTimezoneLabel = getConfirmationTimezoneLabel(args.meetingTimezone);
  const currentGreeting = String(args.greetingOverride || '').trim() || 'Good morning';
  const names = Array.from(
    new Set(
      (args.recipientNames || [])
        .map((value) => firstName(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const greeting =
    names.length > 1
      ? `${currentGreeting} ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]},`
      : names[0]
        ? `${currentGreeting} ${names[0]},`
        : `${currentGreeting},`;

  if ((args.variant || 'confirmation_1') === 'confirmation_2') {
    return [
      `Coach ${coachName} still has you down for ${meetingReminderPhrase}.`,
      '',
      'Please reply YES to confirm you’ll be able to attend',
    ].join('\n');
  }

  return [
    `${greeting.replace(/,$/, '!')} Prospect ID Zoom Meeting ${confirmationDatePhrase} at ${confirmationClockLabel}${confirmationTimezoneLabel ? ` ${confirmationTimezoneLabel}` : ''} with Coach ${coachName}.`,
    '',
    `He’ll call your cell at ${removeDayPeriod(confirmationClockLabel)} with the Zoom code. Be on a laptop or tablet so he can share his screen.`,
    '',
    'Save his contact so you know it’s him calling.',
  ].join('\n');
}

export function buildMinimalFollowUpQueueRecord(args: {
  messageType: FollowUpMessageType;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  currentTask?: string | null;
  dueAt: Date;
  raycastKey: string;
  crmStage?: string | null;
  workflowStatus?: string | null;
  lifecycleState?: string | null;
  reason?: string | null;
  messageVariant?: FollowUpMessageVariant | null;
}): MinimalFollowUpQueueRecord {
  return {
    title: buildFollowUpTitle(args.messageType, args.athleteName),
    status: 'Open',
    messageType: args.messageType,
    dueAt: args.dueAt.toISOString(),
    athlete: args.athleteName.trim(),
    parent1: String(args.parent1Name || '').trim() || null,
    parent2: String(args.parent2Name || '').trim() || null,
    currentTask: normalizeCurrentTask(args.currentTask),
    raycastKey: args.raycastKey.trim(),
    crmStage: String(args.crmStage || '').trim() || null,
    workflowStatus: String(args.workflowStatus || '').trim() || null,
    lifecycleState: String(args.lifecycleState || '').trim() || null,
    reason: String(args.reason || '').trim() || null,
    messageVariant: (args.messageVariant || null) as FollowUpMessageVariant | null,
  };
}

export function buildFollowUpQueuePageMarkdown(args: {
  record: MinimalFollowUpQueueRecord;
  filledMessage: string;
}): string {
  const lines: string[] = [];
  if (args.record.crmStage) {
    lines.push(`CRM Stage: ${args.record.crmStage}`);
  }
  if (args.record.workflowStatus) {
    lines.push(`Status: ${args.record.workflowStatus}`);
  }
  if (args.record.lifecycleState) {
    lines.push(`Lifecycle: ${args.record.lifecycleState}`);
  }
  if (args.record.reason) {
    lines.push(`Reason: ${args.record.reason}`);
  }
  if (args.filledMessage.trim()) {
    if (lines.length) {
      lines.push('');
    }
    lines.push(args.filledMessage);
  }
  return lines.join('\n');
}
