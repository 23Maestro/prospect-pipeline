export type ClientReplyTheme = 'reschedule_request' | 'outreach_callback';

export type ClientReplyTemplateContext = 'confirmation' | 'outreach_attempt';

export type ClientReplyThemeNearMissReason = 'no_template_context' | 'wrong_template_context';

export type ClientReplyReminderEvidence = {
  hasReminder: boolean;
  source: 'apple_calendar' | 'cal' | 'raycast_reminder' | 'unknown';
  label: string | null;
};

export type ClientReplyThemeReviewChatInput = {
  guid: string;
  displayName: string;
  lastMessageDate?: string | null;
  athleteName?: string | null;
  contactId?: string | null;
  athleteMainId?: string | null;
  taskTitle?: string | null;
  matchedPhones?: string[];
};

export type ClientReplyThemeReviewMessageInput = {
  guid: string;
  body: string;
  date: string;
  senderName?: string | null;
  sender?: string | null;
  isFromMe: boolean;
};

export type ClientReplyThemeReviewRow = {
  id: string;
  chatGuid: string;
  messageGuid: string;
  displayName: string;
  athleteName: string | null;
  contactId: string | null;
  athleteMainId: string | null;
  taskTitle: string | null;
  theme: ClientReplyTheme;
  templateContext: ClientReplyTemplateContext | null;
  messageBody: string;
  messageDate: string;
  latestOperatorReplyDate: string | null;
  latestClientReplyDate: string | null;
  reminderEvidence?: ClientReplyReminderEvidence;
};

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

export type BuildClientReplyThemeReviewSnapshotArgs = {
  generatedAt?: string;
  chats: ClientReplyThemeReviewChatInput[];
  messagesByChatGuid: Record<string, ClientReplyThemeReviewMessageInput[] | undefined>;
  reminderEvidenceByChatGuid?: Record<string, ClientReplyReminderEvidence | undefined>;
};

function normalizeText(value?: string | null): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

function dateValue(value?: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRowsByDate(left: Pick<ClientReplyThemeReviewRow, 'messageDate'>, right: Pick<ClientReplyThemeReviewRow, 'messageDate'>) {
  return dateValue(right.messageDate) - dateValue(left.messageDate);
}

function isRescheduleRequest(body: string): boolean {
  const text = normalizeText(body);
  if (!text) return false;

  return [
    /\breschedul(?:e|ed|ing)\b/,
    /\b(can|could|may|do)\s+(we|you|i)\s+(move|change|switch)\b.*\b(meeting|appt|appointment|call|time)\b/,
    /\b(i|we)\s+(can't|cannot|cant|won't|wont|am not|are not|unable)\s+(make|do|attend)\b.*\b(meeting|call|appointment|appt|today|tomorrow|\d{1,2})\b/,
    /\bneed\s+(a\s+)?(new|different|another)\s+(time|day)\b/,
    /\b(any|another|different)\s+(time|day)\s+(work|available|open)\b/,
  ].some((pattern) => pattern.test(text));
}

function isOutreachCallback(body: string): boolean {
  const text = normalizeText(body);
  if (!text) return false;

  return [
    /\b(call|text)\s+(me|us)\b/,
    /\b(give|shoot)\s+(me|us)\s+a\s+call\b/,
    /\byou\s+can\s+call\b/,
    /\bi'?m\s+(free|available|open)\b/,
    /\b(tomorrow|today|tonight|this afternoon|this evening|morning|afternoon|evening)\s+(works?|would work|is fine|is good)\b/,
    /\b(after|around|before)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/,
    /\b\d{1,2}(:\d{2})?\s*(am|pm)\s+(works?|is fine|is good)\b/,
    /\bwhat\s+time\s+(works?|is good|are you available)\b/,
  ].some((pattern) => pattern.test(text));
}

function classifyInboundTheme(message: ClientReplyThemeReviewMessageInput): ClientReplyTheme | null {
  if (message.isFromMe) return null;
  if (isRescheduleRequest(message.body)) return 'reschedule_request';
  if (isOutreachCallback(message.body)) return 'outreach_callback';
  return null;
}

function outboundTemplateContext(body: string): ClientReplyTemplateContext | null {
  const text = normalizeText(body);
  if (!text) return null;

  if (
    /\b(profile|film|video)\s+came\s+through\b/.test(text) ||
    /\bquick\s+(few\s+)?questions?\b/.test(text) ||
    /\bcollege\s+\w+\s+goals?\b/.test(text) ||
    /\b10[- ]?minute\s+call\b/.test(text) ||
    /\bleft\s+(you\s+)?a\s+voicemail\b/.test(text) ||
    /\bcall\s+attempt\b/.test(text)
  ) {
    return 'outreach_attempt';
  }

  if (
    /\bconfirmation\b/.test(text) ||
    /\bconfirm(?:ed|ing)?\b/.test(text) ||
    /\bhas\s+\w+\s+down\s+for\b/.test(text) ||
    /\bmeeting\s+(today|tomorrow|with|at|for)\b/.test(text) ||
    /\bappointment\s+(today|tomorrow|with|at|for)\b/.test(text) ||
    /\bcoach\s+\w+.*\bdown\s+for\b/.test(text)
  ) {
    return 'confirmation';
  }

  return null;
}

function taskTemplateContext(value?: string | null): ClientReplyTemplateContext | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/\b(call\s+attempt|left\s+voice\s+mail|voicemail)\b/.test(text)) return 'outreach_attempt';
  if (/\b(confirm|meeting\s+set|reschedule\s+pending|pending\s+reschedule|res\.\s*pending)\b/.test(text)) {
    return 'confirmation';
  }
  return null;
}

function isPendingRescheduleContext(value?: string | null): boolean {
  return /\breschedule\s+pending\b|\bpending\s+reschedule\b|\bres\.\s*pending\b/i.test(
    normalizeText(value),
  );
}

function acceptedContextForTheme(
  theme: ClientReplyTheme,
  context: ClientReplyTemplateContext | null,
): boolean {
  if (theme === 'reschedule_request') return context === 'confirmation';
  return context === 'outreach_attempt';
}

function latestTemplateContextBefore(
  messages: ClientReplyThemeReviewMessageInput[],
  message: ClientReplyThemeReviewMessageInput,
  taskTitle?: string | null,
): ClientReplyTemplateContext | null {
  const messageDate = dateValue(message.date);
  const outboundMessages = messages
    .filter((candidate) => candidate.isFromMe && dateValue(candidate.date) < messageDate)
    .sort((left, right) => dateValue(right.date) - dateValue(left.date));

  for (const outboundMessage of outboundMessages) {
    const context = outboundTemplateContext(outboundMessage.body);
    if (context) return context;
  }

  return taskTemplateContext(taskTitle);
}

function latestOperatorReplyDateAfter(
  messages: ClientReplyThemeReviewMessageInput[],
  message: ClientReplyThemeReviewMessageInput,
): string | null {
  const messageDate = dateValue(message.date);
  const latest = messages
    .filter((candidate) => candidate.isFromMe && dateValue(candidate.date) > messageDate)
    .sort((left, right) => dateValue(right.date) - dateValue(left.date))[0];
  return latest?.date || null;
}

function latestClientReplyDate(
  messages: ClientReplyThemeReviewMessageInput[],
): string | null {
  const latest = messages
    .filter((message) => !message.isFromMe)
    .sort((left, right) => dateValue(right.date) - dateValue(left.date))[0];
  return latest?.date || null;
}

function upsertLatest<Row extends ClientReplyThemeReviewRow>(rows: Row[], row: Row): void {
  const existingIndex = rows.findIndex(
    (existing) => existing.chatGuid === row.chatGuid && existing.theme === row.theme,
  );
  if (existingIndex === -1) {
    rows.push(row);
    return;
  }

  if (dateValue(row.messageDate) > dateValue(rows[existingIndex].messageDate)) {
    rows[existingIndex] = row;
  }
}

function buildRow(args: {
  chat: ClientReplyThemeReviewChatInput;
  message: ClientReplyThemeReviewMessageInput;
  messages: ClientReplyThemeReviewMessageInput[];
  theme: ClientReplyTheme;
  templateContext: ClientReplyTemplateContext | null;
  reminderEvidence?: ClientReplyReminderEvidence;
}): ClientReplyThemeReviewRow {
  return {
    id: `${args.chat.guid}:${args.message.guid}:${args.theme}`,
    chatGuid: args.chat.guid,
    messageGuid: args.message.guid,
    displayName: clean(args.chat.displayName) || clean(args.message.senderName) || 'Client',
    athleteName: clean(args.chat.athleteName),
    contactId: clean(args.chat.contactId),
    athleteMainId: clean(args.chat.athleteMainId),
    taskTitle: clean(args.chat.taskTitle),
    theme: args.theme,
    templateContext: args.templateContext,
    messageBody: args.message.body,
    messageDate: args.message.date,
    latestOperatorReplyDate: latestOperatorReplyDateAfter(args.messages, args.message),
    latestClientReplyDate: latestClientReplyDate(args.messages),
    ...(args.reminderEvidence ? { reminderEvidence: args.reminderEvidence } : {}),
  };
}

export function buildClientReplyThemeReviewSnapshot(
  args: BuildClientReplyThemeReviewSnapshotArgs,
): ClientReplyThemeReviewSnapshot {
  const rows: ClientReplyThemeReviewRow[] = [];
  const nearMisses: ClientReplyThemeNearMissRow[] = [];
  const ignoredHandled: ClientReplyThemeReviewRow[] = [];
  let totalMessagesReviewed = 0;

  for (const chat of args.chats) {
    const messages = (args.messagesByChatGuid[chat.guid] || [])
      .filter((message) => clean(message.body))
      .sort((left, right) => dateValue(left.date) - dateValue(right.date));
    totalMessagesReviewed += messages.length;

    for (const message of messages) {
      const theme = classifyInboundTheme(message);
      if (!theme) continue;

      const templateContext = latestTemplateContextBefore(messages, message, chat.taskTitle);
      const baseRow = buildRow({
        chat,
        message,
        messages,
        theme,
        templateContext,
        reminderEvidence: args.reminderEvidenceByChatGuid?.[chat.guid],
      });
      const operatorRepliedAfter = Boolean(baseRow.latestOperatorReplyDate);
      const hasAcceptedContext = acceptedContextForTheme(theme, templateContext);
      const keepPendingRescheduleVisible =
        theme === 'reschedule_request' && isPendingRescheduleContext(chat.taskTitle);

      if (!hasAcceptedContext) {
        if (!operatorRepliedAfter) {
          upsertLatest(nearMisses, {
            ...baseRow,
            reason: templateContext ? 'wrong_template_context' : 'no_template_context',
          });
        }
        continue;
      }

      if (operatorRepliedAfter && !keepPendingRescheduleVisible) {
        upsertLatest(ignoredHandled, baseRow);
      } else {
        upsertLatest(rows, baseRow);
      }
    }
  }

  return {
    version: 1,
    generatedAt: args.generatedAt || new Date().toISOString(),
    totalChatsReviewed: args.chats.length,
    totalMessagesReviewed,
    rows: rows.sort(compareRowsByDate),
    nearMisses: nearMisses.sort(compareRowsByDate),
    ignoredHandled: ignoredHandled.sort(compareRowsByDate),
  };
}

export function createEmptyClientReplyThemeReviewSnapshot(
  generatedAt = new Date().toISOString(),
): ClientReplyThemeReviewSnapshot {
  return {
    version: 1,
    generatedAt,
    totalChatsReviewed: 0,
    totalMessagesReviewed: 0,
    rows: [],
    nearMisses: [],
    ignoredHandled: [],
  };
}
