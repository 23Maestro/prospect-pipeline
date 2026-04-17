import { getPreferenceValues, LocalStorage } from '@raycast/api';
import path from 'path';
import { craftLogger, searchLogger } from './logger';
import { executePythonScript } from './python-executor';
import { getPythonScriptPath, WORKSPACE_ROOT } from './python-env';
import {
  appendChildren,
  archiveBlock,
  listChildren,
  normalizeNotionId,
  notionRequest,
  scoutPrepMarkdownToNotionBlocks,
  type NotionBlock,
} from './notion-call-scripts';
import {
  buildCallAttempt2Message,
  buildConfirmationMessage,
  buildFollowUpQueuePageMarkdown,
  buildFollowUpRaycastKey,
  buildMinimalFollowUpQueueRecord,
  type FollowUpMessageType,
  type MinimalFollowUpQueueRecord,
} from './scout-follow-up-templates';

const FEATURE = 'scout-follow-up-queue';
const NOTION_FOLLOW_UP_DATABASE_ID = '3434c8bd-6c26-8022-a875-e8c99007628e';
const MEETING_CONTEXT_CACHE_PREFIX = 'scout-prep:meeting-set-context:';
const CRAFT_MCP_CLIENT_SCRIPT = getPythonScriptPath('craft_mcp_client.py');
const CRAFT_MCP_PYTHON_PATH = path.join(WORKSPACE_ROOT, 'src', 'python', 'venv', 'bin', 'python');
const CRAFT_FOLLOW_UP_BLOCK_ID = 'BBD4A1F5-E02D-41B6-9AC7-699E488FD8D1';

type Preferences = {
  notionToken?: string;
  craftBaseUrl?: string;
  craftApiToken?: string;
  craftEmailFollowUpBlockId?: string;
  followUpSenderName?: string;
};

type MeetingSetQueueContext = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  headScoutName: string;
  meetingTimezone: string;
  assignedTo: string;
  openEventId: string;
  meetingName: string;
};

type FollowUpNotionPage = {
  id: string;
  url?: string;
  properties?: Record<string, unknown>;
};

type CraftMcpUpsertResponse = {
  success?: boolean;
  operation?: 'create' | 'update';
  error?: string | null;
  matched_block_id?: string | null;
  created_block_id?: string | null;
};

function logInfo(event: string, step: string, status: 'start' | 'success', context?: Record<string, unknown>) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

function safePreview(value?: string | null, max = 120): string | null {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function getPrefs(): Preferences {
  return getPreferenceValues<Preferences>();
}

function getFollowUpSenderName(): string {
  return String(getPrefs().followUpSenderName || '').trim() || 'Jerami Singleton';
}

function getNotionToken(): string {
  const token = String(getPrefs().notionToken || '').trim();
  if (!token) {
    throw new Error('Set Notion API Token in Raycast preferences.');
  }
  return token;
}

function buildMeetingContextKey(athleteId: string, athleteMainId: string): string {
  return `${MEETING_CONTEXT_CACHE_PREFIX}${athleteId.trim()}:${athleteMainId.trim()}`;
}

function richTextProperty(value?: string | null) {
  const content = String(value || '').trim();
  return { rich_text: content ? [{ type: 'text', text: { content: content.slice(0, 2000) } }] : [] };
}

function titleProperty(value: string) {
  return {
    title: [{ type: 'text', text: { content: value.trim().slice(0, 2000) } }],
  };
}

function statusProperty(value: 'Open' | 'Sent' | 'Canceled') {
  return { select: { name: value } };
}

function selectProperty(value: string) {
  return { select: { name: value } };
}

function dateProperty(value: string) {
  return { date: { start: value } };
}

function buildQueueProperties(record: MinimalFollowUpQueueRecord) {
  return {
    Name: titleProperty(record.title),
    Status: statusProperty(record.status),
    'Message Type': selectProperty(record.messageType),
    'Due At': dateProperty(record.dueAt),
    Athlete: richTextProperty(record.athlete),
    'Parent 1': richTextProperty(record.parent1),
    'Parent 2': richTextProperty(record.parent2),
    'Current Task': richTextProperty(record.currentTask),
    'Raycast Key': richTextProperty(record.raycastKey),
  };
}

function normalizeCraftBaseUrl(rawBaseUrl: string): string {
  const trimmed = (rawBaseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const isMcpUrl = url.hostname === 'mcp.craft.do' && /^\/links\/[^/]+\/mcp\/?$/i.test(url.pathname);
    return isMcpUrl ? trimmed : '';
  } catch {
    return '';
  }
}

function extractCraftPassword(rawValue?: string): string | undefined {
  const raw = (rawValue || '').trim();
  if (!raw) return undefined;
  const match = raw.match(/^password\s*(?::|is)?\s*(.+)$/i);
  let value = (match?.[1] || raw).trim();
  value = value.replace(/^:+\s*/, '');
  if (/^bearer\s+/i.test(value) || /^authorization\s*:/i.test(raw)) {
    throw new Error('MCP mode expects a Craft password value, not an Authorization/Bearer token');
  }
  return value;
}

function extractCraftBlockId(rawValue?: string): string | undefined {
  const raw = (rawValue || '').trim();
  if (!raw) return undefined;
  if (/^[A-Za-z0-9-]{8,}$/.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const blockId = parsed.searchParams.get('blockId')?.trim();
    if (blockId && /^[A-Za-z0-9-]{8,}$/.test(blockId)) {
      return blockId;
    }
  } catch {
    // ignore parse failures
  }
  return undefined;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatCraftScheduleDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCraftMarker(messageType: FollowUpMessageType, athleteName: string, reminderDate: string): string {
  return `npid-scout-follow-up-${messageType}-${slugify(athleteName)}-${reminderDate}`;
}

function buildCraftReminderMarkdown(args: {
  title: string;
  marker: string;
  filledMessage: string;
}): string {
  return [
    args.title,
    `<!-- ${args.marker} -->`,
    '',
    args.filledMessage,
  ].join('\n');
}

function buildFollowUpQueueContent(record: MinimalFollowUpQueueRecord, filledMessage: string): NotionBlock[] {
  return scoutPrepMarkdownToNotionBlocks(
    buildFollowUpQueuePageMarkdown({
      record,
      filledMessage,
    }),
  );
}

function getPagePropertyText(page: FollowUpNotionPage, propertyName: string): string | null {
  const property = page.properties?.[propertyName] as
    | { rich_text?: Array<{ plain_text?: string }>; title?: Array<{ plain_text?: string }> }
    | undefined;
  const richText = property?.rich_text?.map((item) => item.plain_text || '').join('').trim();
  if (richText) return richText;
  const title = property?.title?.map((item) => item.plain_text || '').join('').trim();
  return title || null;
}

function parseLegacyDateAndTime(dueDate?: string | null, dueTime?: string | null): Date | null {
  const dateMatch = String(dueDate || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeMatch = String(dueTime || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    return null;
  }
  const month = Number.parseInt(dateMatch[1], 10) - 1;
  const day = Number.parseInt(dateMatch[2], 10);
  const year = Number.parseInt(dateMatch[3], 10);
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const date = new Date(year, month, day, hour, minute);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function cacheMeetingSetQueueContext(context: MeetingSetQueueContext): Promise<void> {
  const key = buildMeetingContextKey(context.athleteId, context.athleteMainId);
  await LocalStorage.setItem(key, JSON.stringify(context));
  logInfo('SCOUT_FOLLOW_UP_CONTEXT_CACHE', 'write', 'success', {
    athleteId: context.athleteId,
    athleteMainId: context.athleteMainId,
    headScoutName: safePreview(context.headScoutName),
    meetingTimezone: context.meetingTimezone,
  });
}

export async function getCachedMeetingSetQueueContext(args: {
  athleteId: string;
  athleteMainId: string;
}): Promise<MeetingSetQueueContext | null> {
  const key = buildMeetingContextKey(args.athleteId, args.athleteMainId);
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MeetingSetQueueContext;
  } catch {
    return null;
  }
}

async function findQueuePageByRaycastKey(token: string, raycastKey: string): Promise<FollowUpNotionPage | null> {
  logInfo('SCOUT_FOLLOW_UP_NOTION_QUERY', 'request', 'start', {
    raycastKey: safePreview(raycastKey),
  });
  const payload = await notionRequest<{ results?: FollowUpNotionPage[] }>(
    token,
    `/databases/${normalizeNotionId(NOTION_FOLLOW_UP_DATABASE_ID)}/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        page_size: 1,
        filter: {
          property: 'Raycast Key',
          rich_text: {
            equals: raycastKey,
          },
        },
      }),
    },
  );
  const page = Array.isArray(payload.results) ? payload.results[0] || null : null;
  logInfo('SCOUT_FOLLOW_UP_NOTION_QUERY', 'request', 'success', {
    raycastKey: safePreview(raycastKey),
    found: Boolean(page),
  });
  return page;
}

async function replacePageContent(token: string, pageId: string, blocks: NotionBlock[]): Promise<void> {
  const existingChildren = await listChildren(token, pageId);
  for (const child of existingChildren) {
    if (child.id) {
      await archiveBlock(token, child.id);
    }
  }
  await appendChildren(token, pageId, blocks);
}

export async function upsertFollowUpQueuePage(args: {
  record: MinimalFollowUpQueueRecord;
  filledMessage: string;
}): Promise<{ pageId: string; pageUrl: string }> {
  const token = getNotionToken();
  const blocks = buildFollowUpQueueContent(args.record, args.filledMessage);
  const properties = buildQueueProperties(args.record);
  const existingPage = await findQueuePageByRaycastKey(token, args.record.raycastKey);

  logInfo('SCOUT_FOLLOW_UP_NOTION_UPSERT', 'request', 'start', {
    raycastKey: safePreview(args.record.raycastKey),
    hasExistingPage: Boolean(existingPage),
    messageType: args.record.messageType,
  });

  try {
    if (existingPage?.id) {
      const updated = await notionRequest<FollowUpNotionPage>(token, `/pages/${existingPage.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      await replacePageContent(token, existingPage.id, blocks);
      logInfo('SCOUT_FOLLOW_UP_NOTION_UPSERT', 'request', 'success', {
        raycastKey: safePreview(args.record.raycastKey),
        operation: 'update',
        pageId: existingPage.id,
      });
      return { pageId: existingPage.id, pageUrl: String(updated.url || existingPage.url || '').trim() };
    }

    const created = await notionRequest<FollowUpNotionPage>(token, '/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: normalizeNotionId(NOTION_FOLLOW_UP_DATABASE_ID) },
        properties,
        children: blocks,
      }),
    });
    logInfo('SCOUT_FOLLOW_UP_NOTION_UPSERT', 'request', 'success', {
      raycastKey: safePreview(args.record.raycastKey),
      operation: 'create',
      pageId: created.id,
    });
    return { pageId: created.id, pageUrl: String(created.url || '').trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('SCOUT_FOLLOW_UP_NOTION_UPSERT', 'request', message, {
      raycastKey: safePreview(args.record.raycastKey),
      hasExistingPage: Boolean(existingPage),
    });
    throw error;
  }
}

export async function upsertCraftFollowUpReminder(args: {
  title: string;
  athleteName: string;
  messageType: FollowUpMessageType;
  dueAt: Date;
  filledMessage: string;
  notionUrl: string;
}): Promise<{ skipped: boolean; reason?: string | null; operation?: string | null }> {
  const prefs = getPrefs();
  const baseUrl = normalizeCraftBaseUrl(prefs.craftBaseUrl || '');
  const password = extractCraftPassword(prefs.craftApiToken);
  const documentId = extractCraftBlockId(prefs.craftEmailFollowUpBlockId) || CRAFT_FOLLOW_UP_BLOCK_ID;

  if (!baseUrl) {
    return { skipped: true, reason: 'craft_base_url_missing' };
  }
  if (!documentId) {
    return { skipped: true, reason: 'craft_document_missing' };
  }

  const reminderDate = formatCraftScheduleDate(args.dueAt);
  const marker = buildCraftMarker(args.messageType, args.athleteName, reminderDate);
  const markdown = buildCraftReminderMarkdown({
    title: args.title,
    marker,
    filledMessage: args.filledMessage,
  });

  craftLogger.info('SCOUT_FOLLOW_UP_CRAFT_UPSERT', {
    event: 'SCOUT_FOLLOW_UP_CRAFT_UPSERT',
    step: 'request',
    status: 'start',
    feature: FEATURE,
    context: {
      messageType: args.messageType,
      athleteName: safePreview(args.athleteName),
      reminderDate,
      documentId,
      hasPassword: Boolean(password),
    },
  });

  try {
    const result = await executePythonScript<CraftMcpUpsertResponse>(
      CRAFT_MCP_CLIENT_SCRIPT,
      'upsert_reminder',
      {
        mcp_url: baseUrl,
        password: password || '',
        document_id: documentId,
        markdown,
        schedule_date: reminderDate,
        athlete_name: args.athleteName,
        markers: [marker],
      },
      {
        contextName: 'Craft MCP Client',
        pythonPath: CRAFT_MCP_PYTHON_PATH,
        timeout: 45000,
      },
    );
    if (!result?.success) {
      throw new Error(result?.error || 'Craft MCP upsert failed');
    }
    craftLogger.info('SCOUT_FOLLOW_UP_CRAFT_UPSERT', {
      event: 'SCOUT_FOLLOW_UP_CRAFT_UPSERT',
      step: 'request',
      status: 'success',
      feature: FEATURE,
      context: {
        messageType: args.messageType,
        athleteName: safePreview(args.athleteName),
        reminderDate,
        operation: result.operation || 'create',
      },
    });
    return { skipped: false, operation: result.operation || 'create' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    craftLogger.error('SCOUT_FOLLOW_UP_CRAFT_UPSERT', {
      event: 'SCOUT_FOLLOW_UP_CRAFT_UPSERT',
      step: 'request',
      status: 'failure',
      feature: FEATURE,
      error: message,
      context: {
        messageType: args.messageType,
        athleteName: safePreview(args.athleteName),
        reminderDate,
      },
    });
    throw error;
  }
}

export async function queueConfirmationFollowUp(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  taskId: string;
  currentTask: string;
  dueDate?: string | null;
  dueTime?: string | null;
  fallbackText?: string | null;
}): Promise<{ pageId: string; pageUrl: string; craftSkipped: boolean }> {
  const dueAt = parseLegacyDateAndTime(args.dueDate, args.dueTime);
  if (!dueAt) {
    throw new Error('Confirmation queue requires a valid due date and time');
  }

  const cachedMeeting = await getCachedMeetingSetQueueContext({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
  });
  const headScoutName =
    String(cachedMeeting?.headScoutName || '').trim() || inferHeadScoutNameFromText(args.fallbackText) || '';
  const message = buildConfirmationMessage({
    headScoutName,
    dueAt,
    meetingTimezone: cachedMeeting?.meetingTimezone || 'EST',
  });
  const raycastKey = buildFollowUpRaycastKey({
    messageType: 'confirmation',
    athleteId: args.athleteId,
    taskId: args.taskId,
  });
  const record = buildMinimalFollowUpQueueRecord({
    messageType: 'confirmation',
    athleteName: args.athleteName,
    parent1Name: args.parent1Name,
    parent2Name: args.parent2Name,
    currentTask: args.currentTask,
    dueAt,
    raycastKey,
  });
  const notionPage = await upsertFollowUpQueuePage({
    record,
    filledMessage: message,
  });
  const craftResult = await upsertCraftFollowUpReminder({
    title: record.title,
    athleteName: args.athleteName,
    messageType: 'confirmation',
    dueAt,
    filledMessage: message,
    notionUrl: notionPage.pageUrl,
  });
  return { pageId: notionPage.pageId, pageUrl: notionPage.pageUrl, craftSkipped: craftResult.skipped };
}

export function buildCallAttempt2QueueDraft(args: {
  athleteId: string;
  taskId: string;
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  currentTask: string;
  dueAt: Date;
  recipientName: string;
}): {
  record: MinimalFollowUpQueueRecord;
  filledMessage: string;
} {
  const raycastKey = buildFollowUpRaycastKey({
    messageType: 'call_attempt_2',
    athleteId: args.athleteId,
    taskId: args.taskId,
  });
  const record = buildMinimalFollowUpQueueRecord({
    messageType: 'call_attempt_2',
    athleteName: args.athleteName,
    parent1Name: args.parent1Name,
    parent2Name: args.parent2Name,
    currentTask: args.currentTask,
    dueAt: args.dueAt,
    raycastKey,
  });
  return {
    record,
    filledMessage: buildCallAttempt2Message({
      recipientName: args.recipientName,
      athleteName: args.athleteName,
      senderName: getFollowUpSenderName(),
    }),
  };
}

export function inferHeadScoutNameFromText(text?: string | null): string | null {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const coachMatch = normalized.match(/coach\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  return coachMatch?.[1]?.trim() || null;
}

export function getExistingQueuePageKey(page: FollowUpNotionPage): string | null {
  return getPagePropertyText(page, 'Raycast Key');
}
