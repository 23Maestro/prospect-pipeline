import { resolveSalesLifecycle } from './sales-lifecycle';

export const DEFAULT_FOLLOW_UP_SENDER_NAME = 'Jerami Singleton';

export type FollowUpMessageType = 'call_attempt_2' | 'confirmation';
export type VoicemailFollowUpVariant = 'call_attempt_1' | 'call_attempt_2' | 'no_show';
export type ConfirmationFollowUpVariant = 'confirmation_1' | 'confirmation_2';
export type FollowUpMessageVariant = VoicemailFollowUpVariant | ConfirmationFollowUpVariant;

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

const TIMEZONE_LABEL_TO_WORD: Record<string, string> = {
  EST: 'eastern',
  CST: 'central',
  MST: 'mountain',
  PST: 'pacific',
  AKST: 'alaska',
  HST: 'hawaii',
  AST: 'atlantic',
};

function firstName(value?: string | null): string {
  return (
    String(value || '')
      .trim()
      .split(/\s+/)[0] || ''
  );
}

function formatTimeLabel(date: Date): string {
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  return `${hours12}:${minutes}${suffix}`;
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
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed || 'football';
}

function buildAttempt2TimingSentence(gradYear?: string | null): string {
  const trimmed = String(gradYear || '').trim();
  if (!trimmed) {
    return 'Timing matters in the recruiting process, so I wanted to follow up by text as well.';
  }
  return `With ${trimmed ? `him being a ${trimmed}` : 'timing matters'}, timing matters in the recruiting process, so I wanted to follow up by text as well.`;
}

function buildAthleteProfileLabel(athleteName: string): string {
  const trimmed = athleteName.trim() || 'your athlete';
  return `${trimmed}'s recruiting profile`;
}

function buildNoShowNextBestDayLabel(now: Date): string {
  const candidate = new Date(now);
  candidate.setDate(candidate.getDate() + 2);

  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(candidate);
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
        value.includes('no show') ||
        value.includes('no-show') ||
        value.includes('left voice mail 2') ||
        value.includes('left voicemail 2') ||
        value.includes('call attempt 2'),
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
  senderName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  signOffTitle?: string | null;
  closingLine?: string | null;
  now?: Date;
}): string {
  const greeting = String(args.greeting || '').trim() || 'Good morning there,';
  const athleteProfile = buildAthleteProfileLabel(args.athleteName);
  const senderName = String(args.senderName || '').trim() || DEFAULT_FOLLOW_UP_SENDER_NAME;
  const scoutLabel = sportScoutLabel(args.sport);
  const signOffTitle = String(args.signOffTitle || '').trim() || `${scoutLabel} scouting coordinator`;
  const closingLine = String(args.closingLine || '').trim();
  const now = args.now || new Date();

  const lines =
    args.variant === 'no_show'
      ? [
          `${greeting} looks like we missed you for ${args.athleteName.trim() || 'your athlete'}’s meeting with our Head Scout. No worries, things come up. If playing college ${scoutLabel} is still a real goal for him, I’d like to get you rescheduled so we can keep the process moving.`,
          '',
          `Would tomorrow or ${buildNoShowNextBestDayLabel(now)} work better?`,
        ]
      : args.variant === 'call_attempt_2'
      ? [
          `${greeting} this is ${senderName} with Prospect ID. I left you another voicemail about ${athleteProfile}.`,
          '',
          `We received his info and I’m trying to get a better feel for where he’s at academically, athletically, and what his goals are for playing college ${scoutLabel}. ${buildAttempt2TimingSentence(args.gradYear)}`,
          '',
          'When would you have a 10 min gap today or in the next few days? I can be flexible on time.',
        ]
      : [
          `${greeting} this is ${senderName}, ${scoutLabel} scout with Prospect ID. Following up about ${athleteProfile.replace(/'s recruiting profile$/, "'s recruiting plan")}. I’m looking to learn a little more about his academics, ${scoutLabel} background, and college goals.`,
          '',
          'When would you have a 10 min gap today or tomorrow? This is my cell, so you can text me back here.',
        ];

  if (closingLine) {
    lines.push('', closingLine);
  }

  if (args.variant === 'no_show') {
    lines.push('', senderName);
  } else {
    lines.push('', senderName, signOffTitle, 'Prospect ID');
  }
  return lines.join('\n');
}

export function buildCallAttempt2Message(args: {
  recipientName: string;
  athleteName: string;
  senderName: string;
  sport?: string | null;
  gradYear?: string | null;
}): string {
  return buildVoicemailFollowUpMessage({
    variant: 'call_attempt_2',
    greeting: `Good morning ${String(args.recipientName || '').trim() || 'there'},`,
    athleteName: args.athleteName,
    senderName: args.senderName,
    sport: args.sport,
    gradYear: args.gradYear,
  });
}

export function getTimeOfDayPhrase(date: Date): 'this morning' | 'this afternoon' | 'this evening' {
  const hour = date.getHours();
  if (hour < 12) return 'this morning';
  if (hour < 17) return 'this afternoon';
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
  const timeLabel = formatTimeLabel(date);
  const zoneWord =
    TIMEZONE_LABEL_TO_WORD[
      String(meetingTimezone || '')
        .trim()
        .toUpperCase()
    ] || '';
  return zoneWord ? `${timeLabel} ${zoneWord}` : timeLabel;
}

export function buildConfirmationMessage(args: {
  variant?: ConfirmationFollowUpVariant;
  headScoutName?: string | null;
  dueAt: Date;
  meetingTimezone?: string | null;
  recipientNames?: string[] | null;
  greetingOverride?: string | null;
}): string {
  const coachName = getCoachReferenceName(args.headScoutName);
  const timePhrase = getTimeOfDayPhrase(args.dueAt);
  const meetingTimeLabel = getReminderTimeLabel(args.dueAt, args.meetingTimezone);
  const callTimeLabel = formatTimeLabel(args.dueAt);
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
      `Coach ${coachName} still has you down for ${meetingTimeLabel} ${timePhrase}.`,
      '',
      'Please reply YES to confirm you’ll be able to attend',
    ].join('\n');
  }

  return [
    `${greeting} we have our zoom interview with Coach ${coachName} ${timePhrase} at ${meetingTimeLabel}. Coach will call your cell at ${callTimeLabel}, throw him on speakerphone so he can give you all the zoom code to login.`,
    '',
    'Make sure you are in front of a laptop or tablet so he can share his screen.',
    '',
    `Save his contact card so you know it is him giving you a call. Have a wonderful day and take advantage of your time with Coach ${coachName}. I’m excited for him to meet your family!`,
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
