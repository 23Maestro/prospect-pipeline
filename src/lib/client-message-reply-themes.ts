export const MISSED_CLIENT_REPLY_FLAGS = ['reschedule_request', 'outreach_callback'] as const;

export type ClientMessageTheme = (typeof MISSED_CLIENT_REPLY_FLAGS)[number];
export type ClientMessageTemplateContext = 'confirmation' | 'outreach_attempt';

export type ClientReplyThemeReviewChatInput = {
  guid: string;
  displayName: string;
  lastMessageDate?: string | null;
  athleteName?: string | null;
  contactId?: string | null;
  athleteMainId?: string | null;
  timezone?: string | null;
  timezoneLabel?: string | null;
  taskTitle?: string | null;
  matchedPhones?: string[];
};

export type ClientReplyThemeReviewMessageInput = {
  guid: string;
  body?: string | null;
  date?: string | null;
  senderName?: string | null;
  sender?: string | null;
  isFromMe?: boolean;
};

export type ClientReplyThemeReviewRow = {
  id: string;
  chatGuid: string;
  messageGuid: string;
  theme: ClientMessageTheme;
  templateContext: ClientMessageTemplateContext;
  messageBody: string;
  messageDate: string | null;
  senderName: string | null;
  sender: string | null;
  displayName: string;
  athleteName: string | null;
  contactId: string | null;
  athleteMainId: string | null;
  timezone: string | null;
  timezoneLabel: string | null;
  taskTitle: string | null;
  matchedPhones: string[];
  followUpEvidence?: string[];
};

export type ClientReplyThemeNearMissReason = 'no_template_context' | 'wrong_template_context';
export type ClientReplyThemeReviewBucketKey = 'rows' | 'nearMisses' | 'ignoredHandled';
export type ClientReplyThemeReviewReason =
  | ClientReplyThemeNearMissReason
  | 'reschedule_pending'
  | 'no_operator_reply'
  | 'replied_after'
  | 'follow_up_evidence';
export type ClientReplyThemeReviewToneColor = 'red' | 'blue' | 'secondary';

export type ClientReplyThemeNearMissRow = ClientReplyThemeReviewRow & {
  reason: ClientReplyThemeNearMissReason;
};

export type ClientReplyThemeReviewSnapshot = {
  version: 1;
  generatedAt: string;
  totalChatsReviewed: number;
  totalMessagesReviewed: number;
  rows: ClientReplyThemeReviewRow[];
  nearMisses: ClientReplyThemeNearMissRow[];
  ignoredHandled: ClientReplyThemeReviewRow[];
};

export type ClientReplyThemeReviewStorage = {
  getItem: (key: string) => Promise<string | undefined | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export const CLIENT_REPLY_THEME_REVIEW_CACHE_KEY = 'client-message:reply-theme-review:v1';

export function clientReplyThemeReviewBucketLabel(
  bucket: ClientReplyThemeReviewBucketKey,
): 'Urgent' | 'Misses' | 'Triple-Check' {
  if (bucket === 'nearMisses') return 'Misses';
  if (bucket === 'ignoredHandled') return 'Triple-Check';
  return 'Urgent';
}

export function clientReplyThemeReviewToneLabel(
  bucket: ClientReplyThemeReviewBucketKey,
): 'Urgent' | 'Miss' | 'Triple-Check' {
  if (bucket === 'nearMisses') return 'Miss';
  if (bucket === 'ignoredHandled') return 'Triple-Check';
  return 'Urgent';
}

export function clientReplyThemeReviewReasonLabel(
  reason: ClientReplyThemeReviewReason,
): 'Needs Action' | 'Triple-Check' {
  if (reason === 'replied_after' || reason === 'follow_up_evidence') return 'Triple-Check';
  return 'Needs Action';
}

export function clientReplyThemeReviewToneTagColor(
  bucket: ClientReplyThemeReviewBucketKey,
): ClientReplyThemeReviewToneColor {
  if (bucket === 'nearMisses') return 'blue';
  if (bucket === 'ignoredHandled') return 'secondary';
  return 'red';
}

export function clientReplyThemeReviewReasonTagLabel(
  bucket: ClientReplyThemeReviewBucketKey,
  reason: ClientReplyThemeReviewReason,
): 'Needs Action' | 'Triple-Check' | null {
  const label = clientReplyThemeReviewReasonLabel(reason);
  return label === clientReplyThemeReviewToneLabel(bucket) ? null : label;
}

function looksLikePhone(value?: string | null): boolean {
  return /^\+?\d[\d\s().-]{6,}$/.test(String(value || '').trim());
}

export function clientReplyThemeReviewDisplayName(row: {
  displayName?: string | null;
  athleteName?: string | null;
  senderName?: string | null;
  sender?: string | null;
}): string {
  const displayName = normalizeText(row.displayName);
  const athleteName = normalizeText(row.athleteName);
  const senderName = normalizeText(row.senderName);
  const sender = normalizeText(row.sender);
  if (displayName && !looksLikePhone(displayName)) return displayName;
  if (senderName && senderName !== 'Me' && !looksLikePhone(senderName)) return senderName;
  if (athleteName) return athleteName;
  return displayName || sender || 'Client';
}

function markdownEscape(value?: string | null): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .trim();
}

function compactTimezoneLabel(value?: string | null): string {
  const raw = String(value || '').trim();
  if (raw === 'Eastern' || raw === 'EST' || raw === 'EDT') return 'ET';
  if (raw === 'Central' || raw === 'CST' || raw === 'CDT') return 'CT';
  if (raw === 'Mountain' || raw === 'MST' || raw === 'MDT') return 'MT';
  if (raw === 'Pacific' || raw === 'PST' || raw === 'PDT') return 'PT';
  return raw;
}

function compactClockLabel(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value || '';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value?.toUpperCase() || '';
  return minute === '00' ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
}

export function formatClientReplyThemeMessageDate(
  value?: string | null,
  timeZone?: string | null,
  timezoneLabel?: string | null,
): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const renderTimeZone = String(timeZone || '').trim() || 'America/New_York';
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: renderTimeZone,
  }).format(date);
  const zoneLabel =
    compactTimezoneLabel(timezoneLabel) ||
    compactTimezoneLabel(
      new Intl.DateTimeFormat('en-US', {
        timeZone: renderTimeZone,
        timeZoneName: 'short',
      })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')?.value,
    );
  return `${dateLabel} at ${compactClockLabel(date, renderTimeZone)}${zoneLabel ? ` ${zoneLabel}` : ''}`;
}

export function buildClientReplyThemeThreadMarkdown(args: {
  clientName: string;
  timeZone?: string | null;
  timezoneLabel?: string | null;
  messages: Array<
    Pick<ClientReplyThemeReviewMessageInput, 'body' | 'date' | 'senderName' | 'isFromMe'>
  >;
}): string {
  const lines = [`# ${markdownEscape(args.clientName) || 'Client Thread'}`];
  for (const message of args.messages) {
    const body = normalizeText(message.body);
    if (!body) continue;
    const sender = message.isFromMe ? 'Me' : normalizeText(message.senderName) || args.clientName;
    const date = formatClientReplyThemeMessageDate(message.date, args.timeZone, args.timezoneLabel);
    lines.push('');
    lines.push(`> **${markdownEscape(sender)}**`);
    if (date) {
      lines.push(`> ${markdownEscape(date)}`);
      lines.push('>');
    }
    for (const part of body.split(/\r?\n/)) {
      lines.push(`> ${markdownEscape(part)}`);
    }
  }
  return lines.join('\n');
}

const FLAG_PATTERNS: Record<ClientMessageTheme, RegExp> = {
  reschedule_request: /\b(reschedule|re-schedule|move\s+(the\s+)?meeting|different\s+time)\b/i,
  outreach_callback:
    /\b(tomorrow|tmrw|later\s+today|available\s+today|free\s+today|working|at\s+work|work\s+meeting|call\s+me|call\s+back|after\s+work)\b/i,
};

const TEMPLATE_PATTERNS: Record<ClientMessageTemplateContext, RegExp> = {
  confirmation:
    /\b(prospect\s+id\s+zoom\s+meeting|please\s+reply\s+yes|still\s+has\s+you\s+down\s+for|has\s+.+\s+down\s+for\s+the\s+meeting|coach\s+.+\s+meeting|meeting\s+(today|tomorrow|tonight)|zoom\s+meeting|confirm)\b/i,
  outreach_attempt:
    /\b(profile\s+came\s+through|college\s+.+\s+goals|would\s+later\s+today\s+or\s+tomorrow\s+work|last\s+follow-up|any\s+updates\s+or\s+questions|quick\s+(10\s+minute|ten\s+minute)?\s*call|wanted\s+to\s+connect|prospect\s+id.+call|call\s+about)\b/i,
};

function normalizeText(value?: string | null): string {
  return String(value || '').trim();
}

function isPendingRescheduleContext(value?: string | null): boolean {
  return /\breschedule\s+pending\b|\bpending\s+reschedule\b|\bres\.\s*pending\b/i.test(
    normalizeText(value),
  );
}

export function classifyClientMessageThemes(text?: string | null): ClientMessageTheme[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return MISSED_CLIENT_REPLY_FLAGS.filter((theme) => FLAG_PATTERNS[theme].test(normalized));
}

export function classifyClientMessageTheme(text?: string | null): ClientMessageTheme | null {
  return classifyClientMessageThemes(text)[0] || null;
}

function sortMessagesOldestFirst(
  messages: ClientReplyThemeReviewMessageInput[],
): ClientReplyThemeReviewMessageInput[] {
  return [...messages].sort((left, right) =>
    normalizeText(left.date).localeCompare(normalizeText(right.date)),
  );
}

function templateContextForOutbound(text?: string | null): ClientMessageTemplateContext | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (TEMPLATE_PATTERNS.confirmation.test(normalized)) return 'confirmation';
  if (TEMPLATE_PATTERNS.outreach_attempt.test(normalized)) return 'outreach_attempt';
  return null;
}

function flagMatchesTemplateContext(
  theme: ClientMessageTheme,
  templateContext: ClientMessageTemplateContext | null,
): templateContext is ClientMessageTemplateContext {
  if (theme === 'reschedule_request') return templateContext === 'confirmation';
  if (theme === 'outreach_callback') return templateContext === 'outreach_attempt';
  return false;
}

function contextForTheme(theme: ClientMessageTheme): ClientMessageTemplateContext {
  return theme === 'reschedule_request' ? 'confirmation' : 'outreach_attempt';
}

export function buildClientReplyThemeReviewSnapshot(args: {
  generatedAt?: string;
  chats: ClientReplyThemeReviewChatInput[];
  messagesByChatGuid: Record<string, ClientReplyThemeReviewMessageInput[] | undefined>;
}): ClientReplyThemeReviewSnapshot {
  const rows: ClientReplyThemeReviewRow[] = [];
  const nearMisses: ClientReplyThemeNearMissRow[] = [];
  const ignoredHandled: ClientReplyThemeReviewRow[] = [];
  let totalMessagesReviewed = 0;

  for (const chat of args.chats) {
    const messages = sortMessagesOldestFirst(args.messagesByChatGuid[chat.guid] || []);
    totalMessagesReviewed += messages.length;
    let latestTemplateContext: ClientMessageTemplateContext | null = null;
    for (const message of messages) {
      if (message.isFromMe) {
        const nextTemplateContext = templateContextForOutbound(message.body);
        if (nextTemplateContext) {
          latestTemplateContext = nextTemplateContext;
        }
        continue;
      }

      const body = normalizeText(message.body);
      const themes = classifyClientMessageThemes(body);
      if (!body || !themes.length) continue;
      const theme = themes.find((candidate) =>
        flagMatchesTemplateContext(candidate, latestTemplateContext),
      );
      const candidateTheme = theme || themes[0];

      const messageDate = normalizeText(message.date);
      const operatorRepliedAfter = messages.some(
        (candidate) =>
          candidate.isFromMe &&
          normalizeText(candidate.date) > messageDate &&
          normalizeText(candidate.body),
      );
      const keepPendingRescheduleVisible =
        candidateTheme === 'reschedule_request' && isPendingRescheduleContext(chat.taskTitle);

      const baseRow: ClientReplyThemeReviewRow = {
        id: `${chat.guid}:${message.guid}:${candidateTheme}`,
        chatGuid: chat.guid,
        messageGuid: message.guid,
        theme: candidateTheme,
        templateContext: latestTemplateContext || contextForTheme(candidateTheme),
        messageBody: body,
        messageDate: messageDate || null,
        senderName: normalizeText(message.senderName) || null,
        sender: normalizeText(message.sender) || null,
        displayName: normalizeText(chat.displayName),
        athleteName: normalizeText(chat.athleteName) || null,
        contactId: normalizeText(chat.contactId) || null,
        athleteMainId: normalizeText(chat.athleteMainId) || null,
        timezone: normalizeText(chat.timezone) || null,
        timezoneLabel: normalizeText(chat.timezoneLabel) || null,
        taskTitle: normalizeText(chat.taskTitle) || null,
        matchedPhones: chat.matchedPhones || [],
      };

      if (theme && latestTemplateContext) {
        if (operatorRepliedAfter && !keepPendingRescheduleVisible) {
          ignoredHandled.push(baseRow);
        } else {
          rows.push(baseRow);
        }
        continue;
      }

      if (!operatorRepliedAfter) {
        nearMisses.push({
          ...baseRow,
          reason: latestTemplateContext ? 'wrong_template_context' : 'no_template_context',
        });
      }
    }
  }

  return {
    version: 1,
    generatedAt: args.generatedAt || new Date().toISOString(),
    totalChatsReviewed: args.chats.length,
    totalMessagesReviewed,
    rows,
    nearMisses,
    ignoredHandled,
  };
}

function isClientReplyThemeReviewSnapshot(
  value: Partial<ClientReplyThemeReviewSnapshot>,
): value is ClientReplyThemeReviewSnapshot {
  return value.version === 1 && typeof value.generatedAt === 'string' && Array.isArray(value.rows);
}

export async function readCachedClientReplyThemeReviewSnapshot(
  storage: ClientReplyThemeReviewStorage,
): Promise<ClientReplyThemeReviewSnapshot | null> {
  const raw = await storage.getItem(CLIENT_REPLY_THEME_REVIEW_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ClientReplyThemeReviewSnapshot>;
    return isClientReplyThemeReviewSnapshot(parsed)
      ? {
          ...parsed,
          nearMisses: parsed.nearMisses || [],
          ignoredHandled: parsed.ignoredHandled || [],
        }
      : null;
  } catch {
    return null;
  }
}

export async function writeCachedClientReplyThemeReviewSnapshot(
  storage: ClientReplyThemeReviewStorage,
  snapshot: ClientReplyThemeReviewSnapshot,
): Promise<void> {
  await storage.setItem(CLIENT_REPLY_THEME_REVIEW_CACHE_KEY, JSON.stringify(snapshot));
}
