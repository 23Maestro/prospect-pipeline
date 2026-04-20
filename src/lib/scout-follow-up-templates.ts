export type FollowUpMessageType = 'call_attempt_2' | 'confirmation';

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

export function buildCallAttempt2Message(args: {
  recipientName: string;
  athleteName: string;
  senderName: string;
}): string {
  const recipient = String(args.recipientName || '').trim() || 'there';
  const athleteFirstName = firstName(args.athleteName) || 'your athlete';
  const senderName = String(args.senderName || '').trim() || 'Jerami Singleton';
  return [
    `Good morning ${recipient}, any chance to chat today or in the next few days? I can be flexible on time. We would love to learn more about ${athleteFirstName}. Hope you’ve had a wonderful start to the week!`,
    '',
    senderName,
  ].join('\n');
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
