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
  | 'reschedule_1'
  | 'reschedule_2'
  | 'no_show'
  | 'send_cal_link'
  | 'parent_contact_intro';
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
  const currentTask = normalizeText(args.currentTask);
  const currentTaskTitle = currentTask
    .replace(/^\(?sc move this task\)?\s*/i, '')
    .replace(/[-_–—]+/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    currentTask.includes('left voice mail 3') ||
    currentTask.includes('left voicemail 3') ||
    currentTask.includes('call attempt 3')
  ) {
    return 'call_attempt_3';
  }

  if (currentTaskTitle === 'reschedule pending') {
    return 'reschedule_1';
  }

  if (
    currentTask.includes('no show') ||
    currentTask.includes('no-show') ||
    currentTask.includes('left voice mail 2') ||
    currentTask.includes('left voicemail 2') ||
    currentTask.includes('call attempt 2') ||
    currentTask.includes('second time') ||
    currentTask.includes('second voicemail') ||
    currentTask.includes('follow-up voicemail')
  ) {
    if (currentTask.includes('no show') || currentTask.includes('no-show')) {
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
  previousHeadScoutName?: string | null;
  rescheduleSlots?: string[] | null;
  rescheduleWeekLabel?: string | null;
  now?: Date;
}): string {
  const greeting = String(args.greeting || '').trim() || 'Good morning there,';
  const senderName = String(args.senderName || '').trim() || DEFAULT_FOLLOW_UP_SENDER_NAME;
  const scoutLabel = sportScoutLabel(args.sport);
  const recipientType = args.recipientType || 'parent';
  const athleteFirstName = firstName(args.athleteName) || args.athleteName.trim() || 'your athlete';
  const previousHeadScoutName =
    String(args.previousHeadScoutName || '')
      .trim()
      .replace(/^coach\s+/i, '') || 'the scout';
  const rescheduleSlots = (args.rescheduleSlots || [])
    .map((slot) => String(slot || '').trim())
    .filter(Boolean)
    .slice(0, 2);
  const rescheduleWeekLabel = String(args.rescheduleWeekLabel || '').trim() || 'this week';

  const lines =
    args.variant === 'send_cal_link'
      ? [
          'Here is the link to schedule a quick call:',
          '',
          CAL_BOOKING_URL,
          '',
          'Pick the time that works best.',
        ]
      : args.variant === 'parent_contact_intro'
        ? [
            `${greeting} this is ${firstName(senderName) || senderName} with Prospect ID.`,
            '',
            `${athleteFirstName}’s recruiting info came through.`,
            '',
            'Would today or tomorrow work for a quick call?',
          ]
        : args.variant === 'reschedule_2'
          ? [
              'Which one works best?',
              '',
              `1 - ${rescheduleSlots[0] || '[Slot 1]'}`,
              `2 - ${rescheduleSlots[1] || '[Slot 2]'}`,
            ]
          : args.variant === 'reschedule_1'
            ? [
                `${greeting} no worries.`,
                '',
                `Coach ${previousHeadScoutName} still has time set aside ${rescheduleWeekLabel} for ${athleteFirstName}:`,
                '',
                `1 - ${rescheduleSlots[0] || '[Slot 1]'}`,
                `2 - ${rescheduleSlots[1] || '[Slot 2]'}`,
                '',
                'Which one works best?',
              ]
            : recipientType === 'student_athlete' && args.variant === 'no_show'
              ? [
                  `${greeting} looks like we missed you for your meeting with our Head Scout.`,
                  '',
                  'Reply with the best fit:',
                  '',
                  '1 - still interested, need to reschedule',
                  '2 - interested, timing is bad',
                  '3 - no longer interested',
                ]
              : recipientType === 'student_athlete' && args.variant === 'call_attempt_3'
                ? [
                    `${greeting} last quick follow-up on your college ${scoutLabel} profile.`,
                    '',
                    `If college ${scoutLabel} is still a real goal, have a parent call or text me. If not, no response needed.`,
                  ]
                : recipientType === 'student_athlete' && args.variant === 'call_attempt_2'
                  ? [
                      `${greeting} quick follow-up on your college ${scoutLabel} profile.`,
                      '',
                      'If you still want help with next steps, have a parent call or text me.',
                    ]
                  : recipientType === 'student_athlete'
                    ? [
                        `${greeting} this is ${senderName} with Prospect ID. I received your info about playing college ${scoutLabel}.`,
                        '',
                        'If this is still a real goal, have a parent call or text me back.',
                      ]
                    : args.variant === 'no_show'
                      ? [
                          `${greeting} looks like we missed you for ${args.athleteName.trim() || 'your athlete'}’s meeting with our Head Scout.`,
                          '',
                          'Reply with the best fit:',
                          '',
                          '1 - still interested, need to reschedule',
                          '2 - interested, timing is bad',
                          '3 - no longer interested',
                        ]
                      : args.variant === 'call_attempt_3'
                        ? [
                            `${greeting} last quick follow-up on ${athleteFirstName}’s college ${scoutLabel} profile.`,
                            '',
                            'Reply with the best fit:',
                            '',
                            '1 - interested, ready for next steps',
                            '2 - interested, bad timing',
                            '3 - not interested',
                          ]
                        : args.variant === 'call_attempt_2'
                          ? [
                              `${greeting} quick follow-up on ${athleteFirstName}’s ${scoutLabel} profile.`,
                              '',
                              'Would a calendar link be easier, or should I try you later today?',
                            ]
                          : [
                              `${greeting} this is ${senderName} with Prospect ID. ${athleteFirstName}’s ${scoutLabel} profile came through and I had a few quick questions about college goals.`,
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
    return 'Please reply YES you can attend.';
  }

  return [
    `${greeting.replace(/,$/, '!')} Prospect ID Zoom Meeting ${confirmationDatePhrase} at ${confirmationClockLabel}${confirmationTimezoneLabel ? ` ${confirmationTimezoneLabel}` : ''} with Coach ${coachName}.`,
    '',
    `He’ll call your cell at ${removeDayPeriod(confirmationClockLabel)} with the Zoom code. Be on a laptop or tablet so he can share his screen.`,
    '',
    'CONTACT CARD:',
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
