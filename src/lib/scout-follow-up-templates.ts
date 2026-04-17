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
  return String(value || '')
    .trim()
    .split(/\s+/)[0] || '';
}

function lastName(value?: string | null): string {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[parts.length - 1] || '';
}

function formatTimeLabel(date: Date): string {
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  return `${hours12}:${minutes}${suffix}`;
}

function formatQueueDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function normalizeCurrentTask(value?: string | null): string {
  return String(value || '').trim() || 'Pending follow-up';
}

export function buildFollowUpTitle(messageType: FollowUpMessageType, athleteName: string): string {
  const prefix = messageType === 'call_attempt_2' ? 'Text: Call Attempt 2' : 'Text: Confirmation';
  return `${prefix} | ${athleteName.trim()}`;
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
  return lastName(headScoutName) || 'Coach';
}

export function getReminderTimeLabel(date: Date, meetingTimezone?: string | null): string {
  const timeLabel = formatTimeLabel(date);
  const zoneWord = TIMEZONE_LABEL_TO_WORD[String(meetingTimezone || '').trim().toUpperCase()] || '';
  return zoneWord ? `${timeLabel} ${zoneWord}` : timeLabel;
}

export function buildConfirmationMessage(args: {
  headScoutName?: string | null;
  dueAt: Date;
  meetingTimezone?: string | null;
}): string {
  const coachName = getCoachReferenceName(args.headScoutName);
  const timePhrase = getTimeOfDayPhrase(args.dueAt);
  const meetingTimeLabel = getReminderTimeLabel(args.dueAt, args.meetingTimezone);
  const callTimeLabel = formatTimeLabel(args.dueAt);

  return [
    `Good morning, we have our zoom interview with Coach ${coachName} ${timePhrase} at ${meetingTimeLabel}. Coach will call your cell at ${callTimeLabel}, throw him on speakerphone so he can give you three the zoom code to login.`,
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
  };
}

export function buildFollowUpQueuePageMarkdown(args: {
  record: MinimalFollowUpQueueRecord;
  filledMessage: string;
}): string {
  return [
    `# ${args.record.title}`,
    '',
    `- Status: ${args.record.status}`,
    `- Due At: ${formatQueueDateLabel(new Date(args.record.dueAt))}`,
    `- Athlete: ${args.record.athlete}`,
    `- Parent 1: ${args.record.parent1 || 'N/A'}`,
    `- Parent 2: ${args.record.parent2 || 'N/A'}`,
    `- Current Task: ${args.record.currentTask}`,
    '',
    '## Message',
    '',
    '```text',
    args.filledMessage,
    '```',
  ].join('\n');
}
