import { getPreferenceValues, LocalStorage } from '@raycast/api';
import { searchLogger } from './logger';
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
  type ConfirmationFollowUpVariant,
  type MinimalFollowUpQueueRecord,
} from './scout-follow-up-templates';
import { fetchCuratedSalesStageOptions } from './sales-stage';
import {
  hydrateResolvedAppointment,
  type AppointmentTaskSnapshot,
  type ResolvedAppointment,
} from './head-scout-appointment-lifecycle';
import { recordConfirmationQueued } from './supabase-lifecycle';

const FEATURE = 'scout-follow-up-queue';
const NOTION_FOLLOW_UP_DATABASE_ID = '3434c8bd-6c26-8022-a875-e8c99007628e';
const MEETING_CONTEXT_CACHE_PREFIX = 'scout-prep:meeting-set-context:';

type Preferences = {
  notionToken?: string;
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

export type PreparedConfirmationFollowUp = {
  dueAt: Date;
  message: string;
  headScoutName: string;
  canDraft: boolean;
  resolvedAppointment: ResolvedAppointment;
};

type FollowUpNotionPage = {
  id: string;
  url?: string;
  properties?: Record<string, unknown>;
};

type DatabaseProperty = {
  id?: string;
  name?: string;
  type?: string;
  select?: { options?: Array<{ name?: string }> };
  status?: { options?: Array<{ name?: string }> };
};

type DatabaseSchema = Record<string, DatabaseProperty>;

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
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
  return {
    rich_text: content ? [{ type: 'text', text: { content: content.slice(0, 2000) } }] : [],
  };
}

function titleProperty(value: string) {
  return {
    title: [{ type: 'text', text: { content: value.trim().slice(0, 2000) } }],
  };
}

function selectProperty(value: string) {
  return { select: { name: value } };
}

function dateProperty(value: string) {
  return { date: { start: value } };
}

function getProperty(schema: DatabaseSchema, name: string): DatabaseProperty | null {
  return schema[name] || null;
}

function getPropertyOptions(property: DatabaseProperty | null): string[] {
  if (!property) return [];
  const raw =
    property.type === 'status'
      ? property.status?.options || []
      : property.type === 'select'
        ? property.select?.options || []
        : [];
  return raw.map((option) => String(option?.name || '').trim()).filter(Boolean);
}

function assignSelectLikeProperty(
  properties: Record<string, unknown>,
  schema: DatabaseSchema,
  name: string,
  candidates: Array<string | null | undefined>,
): boolean {
  const property = getProperty(schema, name);
  if (!property?.type) return false;

  const normalizedCandidates = candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!normalizedCandidates.length) return false;

  if (property.type === 'select' || property.type === 'status') {
    const options = getPropertyOptions(property);
    const match = normalizedCandidates.find((candidate) => options.includes(candidate));
    if (!match) return false;
    properties[name] =
      property.type === 'status' ? { status: { name: match } } : selectProperty(match);
    return true;
  }

  if (property.type === 'text' || property.type === 'rich_text') {
    properties[name] = richTextProperty(normalizedCandidates[0]);
    return true;
  }

  return false;
}

async function fetchDatabaseSchema(token: string): Promise<DatabaseSchema> {
  const payload = await notionRequest<{ properties?: DatabaseSchema }>(
    token,
    `/databases/${normalizeNotionId(NOTION_FOLLOW_UP_DATABASE_ID)}`,
  );
  return payload.properties || {};
}

function buildQueueProperties(record: MinimalFollowUpQueueRecord, schema: DatabaseSchema) {
  const properties: Record<string, unknown> = {};
  const crmStageCandidates = [
    record.crmStage,
    record.messageType === 'confirmation' ? 'Meeting Set' : null,
    record.currentTask,
  ];
  const workflowStatusCandidates = [
    record.currentTask,
    record.workflowStatus,
    record.messageType === 'confirmation' ? 'Confirm' : 'Call Attempt 2',
  ];

  if (getProperty(schema, 'Name')) {
    properties.Name = titleProperty(record.title);
  }
  if (getProperty(schema, 'Due At')) {
    properties['Due At'] = dateProperty(record.dueAt);
  }
  if (getProperty(schema, 'Athlete')) {
    properties.Athlete = richTextProperty(record.athlete);
  }
  if (getProperty(schema, 'Parent 1')) {
    properties['Parent 1'] = richTextProperty(record.parent1);
  }
  if (getProperty(schema, 'Parent 2')) {
    properties['Parent 2'] = richTextProperty(record.parent2);
  }
  if (getProperty(schema, 'Current Task')) {
    properties['Current Task'] = richTextProperty(record.currentTask);
  }
  if (getProperty(schema, 'Raycast Key')) {
    properties['Raycast Key'] = richTextProperty(record.raycastKey);
  }
  if (getProperty(schema, 'Admin URL')) {
    properties['Admin URL'] = {
      url:
        String(
          (record as MinimalFollowUpQueueRecord & { adminUrl?: string | null }).adminUrl || '',
        ).trim() || null,
    };
  }

  assignSelectLikeProperty(properties, schema, 'Message Type', [
    record.messageType === 'confirmation' ? 'Confirmation' : 'Call Attempt 2',
  ]);
  const wroteStage = assignSelectLikeProperty(properties, schema, 'Stage', crmStageCandidates);
  const wroteStatus = assignSelectLikeProperty(
    properties,
    schema,
    'Status',
    workflowStatusCandidates,
  );
  if (!wroteStage && !wroteStatus) {
    assignSelectLikeProperty(properties, schema, 'Stage', workflowStatusCandidates);
  }

  return properties;
}

function buildFollowUpQueueContent(
  record: MinimalFollowUpQueueRecord,
  filledMessage: string,
): NotionBlock[] {
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
  const richText = property?.rich_text
    ?.map((item) => item.plain_text || '')
    .join('')
    .trim();
  if (richText) return richText;
  const title = property?.title
    ?.map((item) => item.plain_text || '')
    .join('')
    .trim();
  return title || null;
}

function parseLegacyDateAndTime(dueDate?: string | null, dueTime?: string | null): Date | null {
  const rawDate = String(dueDate || '').trim();
  const rawTime = String(dueTime || '').trim();
  const dateMatch = rawDate.match(
    /^(?:[A-Za-z]{3}\s+)?(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?$/i,
  );
  if (!dateMatch) {
    return null;
  }
  const month = Number.parseInt(dateMatch[1], 10) - 1;
  const day = Number.parseInt(dateMatch[2], 10);
  const yearValue = Number.parseInt(dateMatch[3], 10);
  const year = dateMatch[3].length === 2 ? 2000 + yearValue : yearValue;

  let hour = 0;
  let minute = 0;
  const explicitTimeMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  if (explicitTimeMatch) {
    hour = Number.parseInt(explicitTimeMatch[1], 10);
    minute = Number.parseInt(explicitTimeMatch[2], 10);
  } else if (dateMatch[4] && dateMatch[5]) {
    hour = Number.parseInt(dateMatch[4], 10);
    minute = Number.parseInt(dateMatch[5], 10);
    const meridiem = String(dateMatch[6] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }

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

async function findQueuePageByRaycastKey(
  token: string,
  raycastKey: string,
): Promise<FollowUpNotionPage | null> {
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

async function findQueuePageByAnyRaycastKey(
  token: string,
  raycastKeys: Array<string | null | undefined>,
): Promise<FollowUpNotionPage | null> {
  for (const raycastKey of raycastKeys) {
    const normalized = String(raycastKey || '').trim();
    if (!normalized) continue;
    const page = await findQueuePageByRaycastKey(token, normalized);
    if (page) return page;
  }
  return null;
}

async function replacePageContent(
  token: string,
  pageId: string,
  blocks: NotionBlock[],
): Promise<void> {
  const existingChildren = await listChildren(token, pageId);
  for (const child of existingChildren) {
    if (child.id) {
      await archiveBlock(token, child.id);
    }
  }
  await appendChildren(token, pageId, blocks);
}

export async function upsertFollowUpQueuePage(args: {
  record: MinimalFollowUpQueueRecord & { adminUrl?: string | null };
  filledMessage: string;
  fallbackRaycastKeys?: string[];
}): Promise<{ pageId: string; pageUrl: string }> {
  const token = getNotionToken();
  const schema = await fetchDatabaseSchema(token);
  const blocks = buildFollowUpQueueContent(args.record, args.filledMessage);
  const properties = buildQueueProperties(args.record, schema);
  const existingPage = await findQueuePageByAnyRaycastKey(token, [
    args.record.raycastKey,
    ...(args.fallbackRaycastKeys || []),
  ]);

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
      return {
        pageId: existingPage.id,
        pageUrl: String(updated.url || existingPage.url || '').trim(),
      };
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
  headScoutName?: string | null;
  recipientNames?: string[] | null;
  greetingOverride?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  state?: string | null;
  reminderVariant?: ConfirmationFollowUpVariant;
}): Promise<{ pageId: string; pageUrl: string; craftSkipped: boolean }> {
  const prepared = await prepareConfirmationFollowUp({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    dueDate: args.dueDate,
    dueTime: args.dueTime,
    fallbackText: args.fallbackText,
    headScoutName: args.headScoutName,
    recipientNames: args.recipientNames,
    greetingOverride: args.greetingOverride,
    athleteName: args.athleteName,
    sport: args.sport,
    gradYear: args.gradYear,
    state: args.state,
    reminderVariant: args.reminderVariant,
  });
  const raycastKey = buildFollowUpRaycastKey({
    messageType: 'confirmation',
    athleteId: args.athleteId,
    taskId: args.athleteMainId,
  });
  const legacyBrokenTaskKey = buildFollowUpRaycastKey({
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
    dueAt: prepared.dueAt,
    raycastKey,
    crmStage: prepared.resolvedAppointment.crmSalesStage,
    workflowStatus: prepared.resolvedAppointment.operatorStatus,
    lifecycleState: prepared.resolvedAppointment.lifecycleState,
    reason: prepared.resolvedAppointment.reason,
    messageVariant: args.reminderVariant || 'confirmation_1',
  });
  const adminUrl = `https://dashboard.nationalpid.com/admin/athletes?contactid=${encodeURIComponent(args.athleteId.trim())}&athlete_main_id=${encodeURIComponent(args.athleteMainId.trim())}`;
  await recordConfirmationQueued({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: args.athleteName,
    crmStage: prepared.resolvedAppointment.crmSalesStage,
    taskStatus: args.currentTask,
    headScout: prepared.headScoutName || prepared.resolvedAppointment.assignedScout || null,
    currentTaskId: args.taskId,
    currentTaskTitle: args.currentTask,
    appointmentId: prepared.resolvedAppointment.currentMeeting?.event_id || null,
    startsAt: prepared.resolvedAppointment.currentMeeting?.start || null,
    dueAt: prepared.dueAt.toISOString(),
    messagePreview: prepared.canDraft ? prepared.message : prepared.resolvedAppointment.reason,
    lifecycleState: prepared.resolvedAppointment.lifecycleState,
    reminderKind: args.reminderVariant || 'confirmation',
    messageVariant: args.reminderVariant || 'confirmation_1',
  });
  const notionPage = await upsertFollowUpQueuePage({
    record: { ...record, adminUrl },
    filledMessage: prepared.canDraft ? prepared.message : prepared.resolvedAppointment.reason,
    fallbackRaycastKeys: [legacyBrokenTaskKey, `confirmation:${args.athleteId.trim()}:`],
  });
  return { pageId: notionPage.pageId, pageUrl: notionPage.pageUrl, craftSkipped: true };
}

export async function prepareConfirmationFollowUp(args: {
  athleteId: string;
  athleteMainId: string;
  dueDate?: string | null;
  dueTime?: string | null;
  fallbackText?: string | null;
  headScoutName?: string | null;
  recipientNames?: string[] | null;
  greetingOverride?: string | null;
  athleteName?: string | null;
  sport?: string | null;
  gradYear?: string | null;
  state?: string | null;
  reminderVariant?: ConfirmationFollowUpVariant;
}): Promise<PreparedConfirmationFollowUp> {
  const reminderDueAt = parseLegacyDateAndTime(args.dueDate, args.dueTime) || new Date();
  const followUpTask: AppointmentTaskSnapshot = {
    dueDate: args.dueDate,
    dueTime: args.dueTime,
    description: args.fallbackText || null,
    title: 'Confirmation Call',
  };
  const stageOptions = await fetchCuratedSalesStageOptions(args.athleteId).catch(() => []);
  const crmSalesStage =
    stageOptions.find((option) => option.selected)?.label ||
    stageOptions.find((option) => option.selected)?.value ||
    null;
  const resolvedAppointment = await hydrateResolvedAppointment({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    athleteName: String(args.athleteName || '').trim() || args.athleteId,
    crmSalesStage,
    followUpTask,
    headScoutName:
      String(args.headScoutName || '').trim() ||
      inferHeadScoutNameFromText(args.fallbackText) ||
      '',
    sport: args.sport,
    gradYear: args.gradYear,
    state: args.state,
  });
  const currentMeetingDate = resolvedAppointment.currentMeetingDate;
  const dueAt =
    currentMeetingDate && !Number.isNaN(currentMeetingDate.getTime())
      ? currentMeetingDate
      : reminderDueAt;
  const headScoutName =
    resolvedAppointment.assignedScout ||
    String(args.headScoutName || '').trim() ||
    inferHeadScoutNameFromText(args.fallbackText) ||
    '';

  if (!resolvedAppointment.currentMeeting || resolvedAppointment.needsManualReview) {
    return {
      dueAt,
      message: resolvedAppointment.reason,
      headScoutName,
      canDraft: false,
      resolvedAppointment,
    };
  }
  if (!resolvedAppointment.meetingTimezone) {
    return {
      dueAt,
      message: 'Missing appointment truth timezone for confirmation follow-up.',
      headScoutName,
      canDraft: false,
      resolvedAppointment,
    };
  }

  const message = buildConfirmationMessage({
    variant: args.reminderVariant || 'confirmation_1',
    headScoutName,
    dueAt,
    meetingTimezone: resolvedAppointment.meetingTimezone,
    recipientNames: args.recipientNames,
    greetingOverride: args.greetingOverride,
  });

  return {
    dueAt,
    message,
    headScoutName,
    canDraft: true,
    resolvedAppointment,
  };
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
      sport: null,
      gradYear: null,
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
