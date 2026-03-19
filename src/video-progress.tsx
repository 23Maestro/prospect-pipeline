import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useNavigation,
  getPreferenceValues,
  Clipboard,
} from '@raycast/api';
import { format } from 'date-fns';
import { useEffect, useState, useRef } from 'react';
import path from 'path';
import { apiFetch } from './lib/fastapi-client';
import { executePythonScript } from './lib/python-executor';
import { getPythonScriptPath, WORKSPACE_ROOT } from './lib/python-env';
import {
  getCachedTasks,
  upsertTasks,
  updateCachedTaskStatusStage,
  updateCachedTaskDueDate,
  updateCachedTaskAssignedEditor,
  getCachedContactInfo,
  upsertContactInfo,
} from './lib/video-progress-cache';
import { getAthleteMainId } from './lib/athlete-id-service';
import { resolveAndCacheJerseyNumber } from './lib/jersey-number-service';
import {
  fetchContactInfo,
  transformContactInfoToCache,
  transformCacheToContactInfo,
  type ContactInfo,
} from './lib/npid-mcp-adapter';
import { getInQueueReminderDefaultDate } from './lib/craft-reminder-date';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { craftLogger, logger, videoProgressLogger } from './lib/logger';
import EmailStudentAthletesCommand from './email-student-athletes';
import VideoUpdatesCommand from './video-updates';

interface Preferences {
  craftBaseUrl?: string;
  craftApiToken?: string;
  craftInQueueBlockId?: string;
  craftEmailFollowUpBlockId?: string;
  craftDropboxFoldersBlockId?: string;
  dropboxToken?: string;
  scoutApiKey?: string;
}

export interface VideoProgressTask {
  id?: number; // video_msg_id for updates
  athlete_id: number;
  athlete_main_id?: string;
  athletename: string;
  video_progress_status: string;
  stage: string;
  sport_name: string;
  grad_year: number;
  video_due_date: string;
  assignedvideoeditor: string;
  primaryposition: string;
  secondaryposition: string;
  thirdposition: string;
  high_school: string;
  high_school_city: string;
  high_school_state: string;
  updated_at?: string;
  cached_at?: string;
  date_completed?: string;
  raw_search?: boolean;
  jersey_number?: string;
  [key: string]: any;
}

interface AdminAthleteTableResponse {
  headers: string[];
  rows: string[][];
  count: number;
  status_code: number;
  html_length: number;
  table_found: boolean;
  endpoint: string;
  message?: string | null;
}

const CUTOFF_DAYS = 365;
const ASSIGNED_EDITOR = 'Jerami Singleton';
const ALLOWED_STAGES = new Set(['in queue', 'on hold', 'awaiting client', 'done']);
const STAGE_PRIORITY: Record<string, number> = {
  'in queue': 1,
  'awaiting client': 2,
  'on hold': 3,
  done: 4,
};
const CRAFT_ICON = 'Craft_Liquid_Glass.png';
const CRAFT_MCP_CLIENT_SCRIPT = getPythonScriptPath('craft_mcp_client.py');
const CRAFT_MCP_PYTHON_PATH = path.join(WORKSPACE_ROOT, 'src', 'python', 'venv', 'bin', 'python');

type ReminderType = 'inbox-follow-up' | 'in-queue' | 'dropbox-folder';

const CRAFT_TARGET_DOCUMENT_BY_TYPE: Record<ReminderType, string> = {
  'inbox-follow-up': 'Email Follow Up',
  'in-queue': 'In Queue',
  'dropbox-folder': 'Dropbox Folders',
};
const CRAFT_DEFAULT_DOC_BLOCK_IDS: Partial<Record<ReminderType, string>> = {
  'in-queue': 'B6A1A7FC-7A56-4C50-B621-5AA46FB68AFB',
  'inbox-follow-up': 'BBD4A1F5-E02D-41B6-9AC7-699E488FD8D1',
  'dropbox-folder': '19B66AEB-FDCA-4569-9FCD-F1906D67098E',
};

async function readResponseBody(response: any) {
  const contentType = response?.headers?.get?.('content-type') || '';
  const text = await response.text();
  let json: any = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { text, json, contentType };
}

function extractApiErrorMessage(statusCode: number, text: string, json: any): string {
  return json?.message || json?.detail || text.slice(0, 200) || `HTTP ${statusCode}`;
}

function isExplicitFailurePayload(json: any): boolean {
  return !!(json && typeof json === 'object' && 'success' in json && json.success === false);
}

function formatReminderDate(value: Date): string {
  return format(value, 'yyyy-MM-dd');
}

function buildMarker(markerType: string, athleteName: string, reminderDate: string): string {
  const athleteSlug = athleteName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const marker = `npid-${markerType}-${athleteSlug}-${reminderDate}`;
  return marker;
}

function getReminderMarkerTypes(reminderType: ReminderType): string[] {
  if (reminderType === 'inbox-follow-up') return ['inbox-follow-up', 'follow-up'];
  if (reminderType === 'in-queue') return ['in-queue', 'due-date'];
  return ['dropbox-folder'];
}

function buildReminderMarkdown(athleteName: string): string {
  const markdown = `- [ ] ${athleteName}`;
  craftLogger.debug('CRAFT_MARKDOWN_BUILD', {
    athleteName,
    markdownPreview: markdown.slice(0, 180),
  });
  return markdown;
}

function normalizeCraftBaseUrl(rawBaseUrl: string): string {
  const trimmed = (rawBaseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const isMcpUrl =
      url.hostname === 'mcp.craft.do' && /^\/links\/[^/]+\/mcp\/?$/i.test(url.pathname);
    if (isMcpUrl) {
      return trimmed;
    }
    craftLogger.error('CRAFT_MCP_URL_REQUIRED', {
      inputPreview: trimmed.slice(0, 140),
    });
    return '';
  } catch {
    craftLogger.error('CRAFT_MCP_URL_PARSE_FAILED', {
      inputPreview: trimmed.slice(0, 140),
    });
    return '';
  }
}

function extractCraftBlockId(rawValue?: string): string | undefined {
  const raw = (rawValue || '').trim();
  if (!raw) return undefined;
  if (/^[A-Za-z0-9-]{8,}$/.test(raw)) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    const blockId = parsed.searchParams.get('blockId')?.trim();
    if (blockId && /^[A-Za-z0-9-]{8,}$/.test(blockId)) {
      return blockId;
    }
  } catch {
    // ignore parse failures and fall through
  }
  return undefined;
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

function getCraftConfig(): { baseUrl: string; password?: string } {
  const prefs = getPreferenceValues<Preferences>();
  const baseUrl = normalizeCraftBaseUrl(prefs.craftBaseUrl || '');
  const password = extractCraftPassword(prefs.craftApiToken);
  craftLogger.info('CRAFT_CONFIG_READ', {
    hasBaseUrl: !!baseUrl,
    hasPassword: !!password,
    baseUrlPreview: baseUrl ? `${baseUrl.slice(0, 60)}...` : '',
  });
  if (!baseUrl) {
    craftLogger.error('CRAFT_CONFIG_MISSING', {
      hasBaseUrl: !!baseUrl,
      hasPassword: !!password,
    });
    throw new Error('Set Craft Base URL to an MCP link: https://mcp.craft.do/links/<id>/mcp');
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), password };
}

function getCraftDocumentOverrideId(reminderType: ReminderType): string | undefined {
  const prefs = getPreferenceValues<Preferences>();
  const rawOverride =
    reminderType === 'in-queue'
      ? prefs.craftInQueueBlockId
      : reminderType === 'inbox-follow-up'
        ? prefs.craftEmailFollowUpBlockId
        : prefs.craftDropboxFoldersBlockId;
  const parsed = extractCraftBlockId(rawOverride);
  if (rawOverride && !parsed) {
    craftLogger.warn('CRAFT_DOC_OVERRIDE_INVALID', {
      reminderType,
      rawOverridePreview: String(rawOverride).slice(0, 140),
    });
  }
  if (parsed) {
    craftLogger.info('CRAFT_DOC_OVERRIDE_RESOLVED', {
      reminderType,
      documentId: parsed,
      source: 'preference',
    });
    return parsed;
  }
  const defaultId = CRAFT_DEFAULT_DOC_BLOCK_IDS[reminderType];
  if (defaultId) {
    craftLogger.info('CRAFT_DOC_OVERRIDE_RESOLVED', {
      reminderType,
      documentId: defaultId,
      source: 'default',
    });
    return defaultId;
  }
  return undefined;
}

async function resolveTargetDocumentId(
  _baseUrl: string,
  _password: string | undefined,
  reminderType: ReminderType,
): Promise<string> {
  const overrideId = getCraftDocumentOverrideId(reminderType);
  if (overrideId) {
    craftLogger.info('CRAFT_DOCUMENT_RESOLVED', {
      strategy: 'block_id_override',
      reminderType,
      documentId: overrideId,
    });
    return overrideId;
  }
  throw new Error(
    `Missing block ID for ${CRAFT_TARGET_DOCUMENT_BY_TYPE[reminderType]}. Set the corresponding Craft block ID preference.`,
  );
}

type CraftMcpUpsertResponse = {
  success?: boolean;
  operation?: 'create' | 'update';
  document_id?: string;
  matched_block_id?: string;
  created_block_id?: string;
  error?: string;
};

async function upsertReminderViaMcp(params: {
  mcpUrl: string;
  password?: string;
  reminderType: ReminderType;
  documentId: string;
  markdown: string;
  athleteName: string;
  reminderDate: string;
}): Promise<CraftMcpUpsertResponse> {
  const markerTypes = getReminderMarkerTypes(params.reminderType);
  const markers = markerTypes.map((t) => buildMarker(t, params.athleteName, params.reminderDate));
  craftLogger.info('CRAFT_MCP_UPSERT_START', {
    mcpUrl: params.mcpUrl,
    reminderType: params.reminderType,
    documentId: params.documentId,
    markers,
    scheduleDate: params.reminderDate,
    hasPassword: !!params.password,
  });
  const result = await executePythonScript<CraftMcpUpsertResponse>(
    CRAFT_MCP_CLIENT_SCRIPT,
    'upsert_reminder',
    {
      mcp_url: params.mcpUrl,
      password: params.password || '',
      document_id: params.documentId,
      markdown: params.markdown,
      schedule_date: params.reminderDate,
      athlete_name: params.athleteName,
      markers,
    },
    {
      contextName: 'Craft MCP Client',
      pythonPath: CRAFT_MCP_PYTHON_PATH,
      timeout: 45000,
    },
  );
  craftLogger.info('CRAFT_MCP_UPSERT_RESULT', result);
  return result;
}

function getDueReminderDefaultDate(videoDueDate?: string): Date {
  if (!videoDueDate) {
    craftLogger.info('CRAFT_DUE_DEFAULT_FALLBACK_TODAY', { reason: 'missing_video_due_date' });
    return getInQueueReminderDefaultDate(videoDueDate);
  }
  const parsed = new Date(videoDueDate);
  if (Number.isNaN(parsed.getTime())) {
    craftLogger.warn('CRAFT_DUE_DEFAULT_FALLBACK_TODAY', {
      reason: 'invalid_video_due_date',
      videoDueDate,
    });
    return getInQueueReminderDefaultDate(videoDueDate);
  }
  const d = getInQueueReminderDefaultDate(videoDueDate);
  craftLogger.info('CRAFT_DUE_DEFAULT_FROM_VIDEO_DUE_DATE', {
    videoDueDate,
    defaultReminderDate: formatReminderDate(d),
  });
  return d;
}

function getPositions(task: VideoProgressTask): string {
  const normalizePosition = (value?: string) =>
    (value || '')
      .replace(/^Positions?/i, '')
      .replace(/^[:\-\s]+/, '')
      .trim();

  return [task.primaryposition, task.secondaryposition, task.thirdposition]
    .map((pos) => normalizePosition(pos))
    .filter((pos) => pos && pos !== 'NA')
    .join(' | ');
}

function getStatusIcon(status: string): { source: string } | Icon {
  switch (status) {
    case 'Revise':
    case 'Revisions':
      return { source: 'revisions-icon.png' };
    case 'HUDL':
      return { source: 'hudl-logo.png' };
    case 'Dropbox':
      return { source: 'dropbox-ios.png' };
    case 'Not Approved':
      return Icon.XMarkCircle;
    case 'External Links':
      return { source: 'external-links.png' };
    default:
      return Icon.Circle;
  }
}

function getStageIcon(stage: string): { source: string } | Icon {
  switch (stage) {
    case 'In Queue':
      return { source: 'in-queue-stage.png' };
    case 'Awaiting Client':
      return { source: 'awaiting-client.png' };
    case 'On Hold':
      return { source: 'on-hold-stage.png' };
    case 'Done':
      return { source: 'done-stage.png' };
    default:
      return Icon.Circle;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'Revise':
    case 'Revisions':
      return '#AF52DE';
    case 'HUDL':
      return '#FF3B30';
    case 'Dropbox':
      return '#007AFF';
    case 'Not Approved':
      return '#FF9500';
    case 'Uploads':
      return '#FF2D92';
    case 'External Links':
      return '#34C759';
    default:
      return '#8E8E93';
  }
}

const getTaskStage = (task: VideoProgressTask) =>
  (task.video_progress_stage || task.stage || '').trim();

const normalizeStageValue = (stage?: string) => (stage || '').trim().toLowerCase();

function formatDate(dateString: string): string {
  if (!dateString) return 'No due date';
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return dateString;
  }
}

function isManualIngestTask(task: Pick<VideoProgressTask, 'id' | 'source'>): boolean {
  const source = (task.source || '').toLowerCase();
  const hasSyntheticId = typeof task.id === 'number' && task.id < 0;
  return hasSyntheticId || source.startsWith('raycast:');
}

function parseTaskTimestamp(task: VideoProgressTask): number {
  const ts = Date.parse(task.cached_at || task.updated_at || '');
  return Number.isNaN(ts) ? 0 : ts;
}

function preferTaskForSameAthlete(
  current: VideoProgressTask,
  incoming: VideoProgressTask,
): VideoProgressTask {
  const currentManual = isManualIngestTask(current);
  const incomingManual = isManualIngestTask(incoming);

  if (currentManual !== incomingManual) {
    return incomingManual ? current : incoming;
  }

  return parseTaskTimestamp(incoming) >= parseTaskTimestamp(current) ? incoming : current;
}

function dedupeTasksPreferNative(tasks: VideoProgressTask[]): VideoProgressTask[] {
  const byAthlete = new Map<string, VideoProgressTask>();

  for (const task of tasks) {
    const athleteKey = task.athlete_id
      ? `athlete:${task.athlete_id}`
      : `row:${task.id ?? task.athletename}`;
    const existing = byAthlete.get(athleteKey);
    if (!existing) {
      byAthlete.set(athleteKey, task);
      continue;
    }
    byAthlete.set(athleteKey, preferTaskForSameAthlete(existing, task));
  }

  return Array.from(byAthlete.values());
}

function normalizeStatus(
  displayStatus: string,
): 'revisions' | 'hudl' | 'dropbox' | 'external_links' | 'not_approved' {
  switch (displayStatus.toLowerCase()) {
    case 'revise':
    case 'revisions':
      return 'revisions';
    case 'hudl':
      return 'hudl';
    case 'dropbox':
      return 'dropbox';
    case 'external links':
    case 'external_links':
      return 'external_links';
    case 'not approved':
    case 'not_approved':
      return 'not_approved';
    default:
      return 'hudl';
  }
}

function normalizeStage(displayStage: string): 'on_hold' | 'awaiting_client' | 'in_queue' | 'done' {
  switch (displayStage.toLowerCase()) {
    case 'on hold':
    case 'on_hold':
      return 'on_hold';
    case 'awaiting client':
    case 'awaiting_client':
      return 'awaiting_client';
    case 'in queue':
    case 'in_queue':
      return 'in_queue';
    case 'done':
      return 'done';
    default:
      return 'in_queue';
  }
}

function getSeasonName(gradYear: number): string {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0 = January, 7 = August

  // Determine the school year (year it started in fall)
  // If we're before August, we're in the school year that started last fall
  // If we're in August or later, we're in the school year that started this fall
  const schoolYearStart = currentMonth >= 7 ? currentYear : currentYear - 1;

  // Calculate grade level based on years until graduation
  const yearsUntilGrad = gradYear - schoolYearStart;

  switch (yearsUntilGrad) {
    case 1:
      return 'Senior Season';
    case 2:
      return 'Junior Season';
    case 3:
      return 'Sophomore Season';
    case 4:
      return 'Freshman Season';
    case 5:
      return '8th Grade Season';
    case 6:
      return '7th Grade Season';
    default:
      return 'Highlights';
  }
}

function generateYouTubeTitle(task: VideoProgressTask): string {
  // Dynamic title: "Name Class of YEAR Season"
  const seasonName = getSeasonName(task.grad_year);
  const parts = [task.athletename, task.grad_year ? `Class of ${task.grad_year}` : '', seasonName]
    .filter(Boolean)
    .join(' ');
  return parts;
}

function normalizeSportName(sport: string): string {
  // Strip "Men's " or "Women's " prefix from sport names
  return sport.replace(/^(Men's|Women's)\s+/i, '');
}

function generateDropboxFolder(task: VideoProgressTask): string {
  // Format: PascalCaseName_YEAR_Sport_STATE
  const pascalName = task.athletename
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  return [pascalName, task.grad_year, normalizeSportName(task.sport_name), task.high_school_state]
    .filter(Boolean)
    .join('_');
}

function formatApprovedJerseyToken(raw?: string): string {
  if (!raw) return '';
  const match = raw.match(/\d+/);
  if (!match) return '';
  return `#${match[0]}`;
}

export function shouldIncludeTask(task: VideoProgressTask): boolean {
  if (!task.assignedvideoeditor || task.assignedvideoeditor.trim() !== ASSIGNED_EDITOR) {
    return false;
  }
  const stageValue = normalizeStageValue(getTaskStage(task));
  if (!ALLOWED_STAGES.has(stageValue)) {
    return false;
  }
  const cutoffMs = Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  const updatedAt = task.updated_at || task.cached_at;
  if (!updatedAt) {
    return false;
  }
  const updatedTs = Date.parse(updatedAt);
  if (Number.isNaN(updatedTs) || updatedTs < cutoffMs) {
    return false;
  }
  return true;
}

export function sortTasks(tasks: VideoProgressTask[]): VideoProgressTask[] {
  return [...tasks].sort((a, b) => {
    const aYear = Number(a.grad_year) || 9999;
    const bYear = Number(b.grad_year) || 9999;
    if (aYear !== bYear) return aYear - bYear;

    const aStage = getTaskStage(a).toLowerCase();
    const bStage = getTaskStage(b).toLowerCase();
    const aStageRank = STAGE_PRIORITY[aStage] ?? 99;
    const bStageRank = STAGE_PRIORITY[bStage] ?? 99;
    if (aStageRank !== bStageRank) return aStageRank - bStageRank;

    if (aStage === 'done' && bStage === 'done') {
      const aCompleted = a.date_completed
        ? new Date(a.date_completed).getTime()
        : Number.NEGATIVE_INFINITY;
      const bCompleted = b.date_completed
        ? new Date(b.date_completed).getTime()
        : Number.NEGATIVE_INFINITY;
      if (aCompleted !== bCompleted) return bCompleted - aCompleted;
    }

    const aDue = a.video_due_date ? new Date(a.video_due_date).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.video_due_date ? new Date(b.video_due_date).getTime() : Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });
}

function sortInQueueTasksByDueDate(tasks: VideoProgressTask[]): VideoProgressTask[] {
  const baseOrder = sortTasks(tasks);
  const baseIndex = new Map<number | string, number>();
  baseOrder.forEach((task, index) => {
    baseIndex.set(task.id ?? `athlete:${task.athlete_id}`, index);
  });

  const parseDue = (value?: string) => {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  };

  return [...tasks].sort((a, b) => {
    const aDue = parseDue(a.video_due_date);
    const bDue = parseDue(b.video_due_date);

    if (aDue === null && bDue === null) {
      return (baseIndex.get(a.id ?? `athlete:${a.athlete_id}`) ?? 0) -
        (baseIndex.get(b.id ?? `athlete:${b.athlete_id}`) ?? 0);
    }
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    if (aDue !== bDue) return aDue - bDue;

    return (baseIndex.get(a.id ?? `athlete:${a.athlete_id}`) ?? 0) -
      (baseIndex.get(b.id ?? `athlete:${b.athlete_id}`) ?? 0);
  });
}

function sortDoneTasks(tasks: VideoProgressTask[]): VideoProgressTask[] {
  const parseTs = (value?: string) => {
    if (!value) return null;
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  };

  return [...tasks].sort((a, b) => {
    const aCompleted = parseTs(a.date_completed);
    const bCompleted = parseTs(b.date_completed);

    if (aCompleted !== null || bCompleted !== null) {
      if (aCompleted === null) return 1;
      if (bCompleted === null) return -1;
      if (aCompleted !== bCompleted) return bCompleted - aCompleted;
    }

    const aFallback = parseTs(a.cached_at || a.updated_at) ?? 0;
    const bFallback = parseTs(b.cached_at || b.updated_at) ?? 0;
    return bFallback - aFallback;
  });
}

function ApprovedVideoDetail(task: VideoProgressTask, jerseyOverride?: string): string {
  const positions = getPositions(task);
  const jersey = formatApprovedJerseyToken(jerseyOverride || task.jersey_number || '');

  // Build name line with jersey number if available
  const nameLine = jersey
    ? `${task.athletename.toUpperCase()} ${jersey}`
    : task.athletename.toUpperCase();

  const lines = [
    nameLine,
    positions ? `Class of ${task.grad_year} - ${positions}` : `Class of ${task.grad_year}`,
    task.high_school,
    `${task.high_school_city}, ${task.high_school_state}`,
  ];
  return lines.join('\n');
}

function toMarkdownTable(headers: string[], rows: string[][]): string {
  if (!headers.length) return '';
  const escapeCell = (value: string) => (value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const headerLine = `| ${headers.map(escapeCell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => {
    const normalized = headers.map((_, idx) => escapeCell(row[idx] || ''));
    return `| ${normalized.join(' | ')} |`;
  });
  return [headerLine, separatorLine, ...rowLines].join('\n');
}

function buildAdminMarkdown(
  title: string,
  athleteName: string,
  payload: AdminAthleteTableResponse | null,
): string {
  const headerBlock = `# ${athleteName}\n\n## ${title}`;
  if (!payload) {
    return `${headerBlock}\n\nLoading...`;
  }
  if (!payload.rows.length) {
    return `${headerBlock}\n\nNo data returned from endpoint.`;
  }
  const rows = title === 'Payments' ? convertRowsTo12HourTime(payload.rows) : payload.rows;
  return `${headerBlock}\n\n${toMarkdownTable(payload.headers, rows)}`;
}

function convertRowsTo12HourTime(rows: string[][]): string[][] {
  return rows.map((row) =>
    row.map((cell) =>
      cell.replace(
        /\b(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{2}):(\d{2}):(\d{2})\b/g,
        (_match, datePart: string, hourStr: string, minute: string, second: string) => {
          const hour = Number(hourStr);
          const normalizedHour = Number.isNaN(hour) ? hourStr : String(((hour + 11) % 12) + 1);
          const suffix = Number.isNaN(hour) || hour < 12 ? 'AM' : 'PM';
          return `${datePart} ${normalizedHour}:${minute}:${second} ${suffix}`;
        },
      ),
    ),
  );
}

function getAdminSectionUrl(
  athleteId: number,
  section: 'contact' | 'payments' | 'emails' | 'campaigns',
): string {
  const base = `https://dashboard.nationalpid.com/admin/athletes?contactid=${athleteId}`;
  if (section === 'payments') {
    return `${base}#:~:text=Payments-,Campaigns,-Campaigns`;
  }
  if (section === 'emails') {
    return `${base}#:~:text=Email-,Payments,-Campaigns`;
  }
  if (section === 'campaigns') {
    return `${base}#:~:text=Campaigns`;
  }
  return `${base}#:~:text=General,-Progress`;
}

function AdminAthleteTableDetail({
  task,
  title,
  endpoint,
}: {
  task: VideoProgressTask;
  title: string;
  endpoint: string;
}) {
  const { push, pop } = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [payload, setPayload] = useState<AdminAthleteTableResponse | null>(null);

  const resolveMainId = async () => {
    return task.athlete_main_id || (await getAthleteMainId(task.athlete_id));
  };

  const openView = async (target: 'main' | 'contact' | 'payments' | 'emails' | 'campaigns') => {
    const feature = 'VIDEO_PROGRESS_DETAIL_VIEW_SWITCH';
    videoProgressLogger.info(feature, {
      event: feature,
      step: 'request',
      status: 'start',
      feature,
      context: { athleteId: task.athlete_id, from: title, to: target },
    });
    try {
      if (target === 'main') {
        pop();
      } else if (target === 'contact') {
        const mainId = await resolveMainId();
        if (!mainId) throw new Error('missing_athlete_main_id');
        push(
          <ContactInfoDetail
            task={task}
            contactId={String(task.athlete_id)}
            athleteMainId={mainId}
            athleteName={task.athletename}
            onBack={pop}
          />,
        );
      } else if (target === 'payments') {
        const mainId = await resolveMainId();
        if (!mainId) throw new Error('missing_athlete_main_id');
        push(
          <AdminAthleteTableDetail
            task={task}
            title="Payments"
            endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/payments?athlete_main_id=${encodeURIComponent(mainId)}`}
          />,
        );
      } else if (target === 'emails') {
        push(
          <AdminAthleteTableDetail
            task={task}
            title="Email List"
            endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/emails`}
          />,
        );
      } else {
        const mainId = await resolveMainId();
        if (!mainId) throw new Error('missing_athlete_main_id');
        push(
          <AdminAthleteTableDetail
            task={task}
            title="Campaigns"
            endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/campaigns?athlete_main_id=${encodeURIComponent(mainId)}`}
          />,
        );
      }
      videoProgressLogger.info(feature, {
        event: feature,
        step: 'request',
        status: 'success',
        feature,
        context: { athleteId: task.athlete_id, from: title, to: target },
      });
    } catch (error) {
      videoProgressLogger.error(feature, {
        event: feature,
        step: 'request',
        status: 'failure',
        feature,
        error: error instanceof Error ? error.message : String(error),
        context: { athleteId: task.athlete_id, from: title, to: target },
      });
    }
  };

  useEffect(() => {
    let active = true;
    const featureMap: Record<string, string> = {
      Payments: 'VIDEO_PROGRESS_ADMIN_PAYMENTS_FETCH',
      'Email List': 'VIDEO_PROGRESS_ADMIN_EMAILS_FETCH',
      Campaigns: 'VIDEO_PROGRESS_ADMIN_CAMPAIGNS_FETCH',
    };
    const feature = featureMap[title] || 'VIDEO_PROGRESS_ADMIN_TABLE_PARSE';

    const load = async () => {
      videoProgressLogger.info(feature, {
        event: feature,
        step: 'request',
        status: 'start',
        feature,
        context: {
          athleteId: task.athlete_id,
          endpoint,
        },
      });
      try {
        const response = await apiFetch(endpoint);
        const { text, json, contentType } = await readResponseBody(response);
        if (!response.ok || !json) {
          throw new Error(extractApiErrorMessage(response.status, text, json));
        }
        if (!active) return;
        const data = json as AdminAthleteTableResponse;
        setPayload(data);
        videoProgressLogger.info(feature, {
          event: feature,
          step: 'parse',
          status: 'success',
          feature,
          context: {
            athleteId: task.athlete_id,
            endpoint,
            statusCode: response.status,
            contentType,
            tableFound: data.table_found,
            rowCount: data.count,
            htmlLength: data.html_length,
          },
        });
      } catch (error) {
        videoProgressLogger.error(feature, {
          event: feature,
          step: 'request',
          status: 'failure',
          feature,
          error: error instanceof Error ? error.message : String(error),
          context: {
            athleteId: task.athlete_id,
            endpoint,
          },
        });
        if (!active) return;
        setPayload({
          headers: [],
          rows: [],
          count: 0,
          status_code: 0,
          html_length: 0,
          table_found: false,
          endpoint,
          message: 'No data returned from endpoint.',
        });
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [endpoint, task.athlete_id, title]);

  return (
    <Detail
      navigationTitle={`${task.athletename} • ${title}`}
      markdown={buildAdminMarkdown(title, task.athletename, payload)}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Views">
            <Action
              title="Main"
              icon={Icon.House}
              shortcut={{ modifiers: ['cmd'], key: '1' }}
              onAction={() => openView('main')}
            />
            <Action
              title="Contact Info"
              icon="☎️"
              shortcut={{ modifiers: ['cmd'], key: '2' }}
              onAction={() => openView('contact')}
            />
            <Action
              title="Payments"
              icon="💳"
              shortcut={{ modifiers: ['cmd'], key: '3' }}
              onAction={() => openView('payments')}
            />
            <Action
              title="Email List"
              icon={Icon.Envelope}
              shortcut={{ modifiers: ['cmd'], key: '4' }}
              onAction={() => openView('emails')}
            />
            <Action
              title="Campaigns"
              icon="📣"
              shortcut={{ modifiers: ['cmd'], key: '5' }}
              onAction={() => openView('campaigns')}
            />
          </ActionPanel.Section>
          <Action.OpenInBrowser
            title={
              title === 'Payments'
                ? 'Open Payments on Admin'
                : title === 'Email List'
                  ? 'Open Email on Admin'
                  : 'Open Campaigns on Admin'
            }
            icon={Icon.Globe}
            url={getAdminSectionUrl(
              task.athlete_id,
              title === 'Payments' ? 'payments' : title === 'Email List' ? 'emails' : 'campaigns',
            )}
          />
        </ActionPanel>
      }
    />
  );
}

interface DetailProps {
  task: VideoProgressTask;
  onBack: () => void;
  onStatusUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

export function VideoProgressDetail({ task, onBack, onStatusUpdate }: DetailProps) {
  const { push, pop } = useNavigation();
  const [isUpdating, setIsUpdating] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [dropboxFolder, setDropboxFolder] = useState('');
  const [approvedDetail, setApprovedDetail] = useState('');
  const [resolvedJersey, setResolvedJersey] = useState<string | undefined>(task.jersey_number);

  const resolveMainId = async () => {
    // Use central service - handles cache check, API fetch, and write-back
    return await getAthleteMainId(task.athlete_id);
  };

  const resolveJerseyOnEncounter = async () => {
    const feature = 'VIDEO_PROGRESS_JERSEY_RESOLVE';
    videoProgressLogger.info(feature, {
      event: feature,
      step: 'request',
      status: 'start',
      feature,
      context: {
        athleteId: task.athlete_id,
        endpoint: `/athlete/${task.athlete_id}/resolve`,
      },
    });
    try {
      const shouldForceRefresh = false;
      const result = await resolveAndCacheJerseyNumber(task.athlete_id, {
        gradYear: task.grad_year,
        forceRefresh: shouldForceRefresh,
      });
      if (result.jerseyNumber) {
        setResolvedJersey(result.jerseyNumber);
      }
      videoProgressLogger.info(feature, {
        event: feature,
        step: 'parse',
        status: result.jerseyNumber ? 'success' : 'failure',
        feature,
        error: result.jerseyNumber ? undefined : result.error || 'resolve_response_missing_jersey',
        context: {
          athleteId: task.athlete_id,
          endpoint: result.endpoint,
          statusCode: result.statusCode || null,
          contentType: result.contentType || null,
          source: result.source,
          forceRefresh: result.forceRefresh,
          extractedValue: result.jerseyNumber || null,
        },
      });
    } catch (error) {
      videoProgressLogger.error(feature, {
        event: feature,
        step: 'request',
        status: 'failure',
        feature,
        error: error instanceof Error ? error.message : String(error),
        context: {
          athleteId: task.athlete_id,
          endpoint: `/athlete/${task.athlete_id}/resolve`,
        },
      });
    }
  };

  useEffect(() => {
    setYoutubeTitle(generateYouTubeTitle(task));
    setDropboxFolder(generateDropboxFolder(task));
    setResolvedJersey(task.jersey_number);
    setApprovedDetail(ApprovedVideoDetail(task, task.jersey_number));
    void resolveJerseyOnEncounter();
  }, [task]);

  useEffect(() => {
    setApprovedDetail(ApprovedVideoDetail(task, resolvedJersey));
  }, [resolvedJersey, task]);

  const handleStatusChange = async (newStatus: string) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsUpdating(true);
    try {
      const feature = 'video-progress.detail.status-update';
      const normalizedStatus = normalizeStatus(newStatus);
      videoProgressLogger.info('VIDEO_PROGRESS_STATUS_UPDATE', {
        event: 'VIDEO_PROGRESS_STATUS_UPDATE',
        step: 'request',
        status: 'start',
        feature,
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          statusDisplay: newStatus,
          statusNormalized: normalizedStatus,
        },
      });
      const response = await apiFetch(`/video/${task.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), status: normalizedStatus }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      if (!response.ok || isExplicitFailurePayload(json)) {
        throw new Error(extractApiErrorMessage(response.status, text, json));
      }
      // Update cache for instant UI feedback
      await updateCachedTaskStatusStage(task.id, { status: newStatus });
      videoProgressLogger.info('VIDEO_PROGRESS_STATUS_UPDATE', {
        event: 'VIDEO_PROGRESS_STATUS_UPDATE',
        step: 'request',
        status: 'success',
        feature,
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          statusCode: response.status,
          contentType,
          bodyPreview: text.slice(0, 200),
          statusDisplay: newStatus,
          statusNormalized: normalizedStatus,
        },
      });

      await showToast({
        style: Toast.Style.Success,
        title: 'Status Updated',
        message: `Updated to ${newStatus}`,
      });

      // Get fresh data from cache and pass to parent
      const allTasks = await getCachedTasks();
      const filtered = sortTasks(allTasks.filter(shouldIncludeTask));
      onStatusUpdate(filtered);
      onBack();
    } catch (error) {
      videoProgressLogger.error('VIDEO_PROGRESS_STATUS_UPDATE', {
        event: 'VIDEO_PROGRESS_STATUS_UPDATE',
        step: 'request',
        status: 'failure',
        feature: 'video-progress.detail.status-update',
        error: error instanceof Error ? error.message : String(error),
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          statusDisplay: newStatus,
        },
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStageChange = async (newStage: string) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsUpdating(true);
    try {
      const normalizedStage = normalizeStage(newStage);
      logger.info('Stage update request', {
        videoMsgId: task.id,
        athleteId: task.athlete_id,
        stage: newStage,
        normalizedStage,
      });
      const response = await apiFetch(`/video/${task.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), stage: normalizedStage }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      logger.info('Stage update response', {
        videoMsgId: task.id,
        status: response.status,
        contentType,
        bodyPreview: text.slice(0, 500),
      });
      if (!response.ok) {
        const errMessage =
          json?.message || json?.detail || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(errMessage);
      }
      // Update cache for instant UI feedback
      await updateCachedTaskStatusStage(task.id, { stage: newStage });

      await showToast({
        style: Toast.Style.Success,
        title: 'Stage Updated',
        message: `Updated to ${newStage}`,
      });

      // Get fresh data from cache and pass to parent
      const allTasks = await getCachedTasks();
      const filtered = sortTasks(allTasks.filter(shouldIncludeTask));
      onStatusUpdate(filtered);
      onBack();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const metadata = `
${normalizeSportName(task.sport_name)} | ${task.grad_year} | ${getPositions(task)} | ${task.high_school} | ${task.high_school_city}, ${task.high_school_state} | ${formatDate(task.video_due_date)} | ${getTaskStage(task)} | ${task.video_progress_status}

---

### YouTube Title
\`\`\`
${youtubeTitle}
\`\`\`

### Dropbox Folder
\`\`\`
${dropboxFolder}
\`\`\`

### Approved Video Title
\`\`\`
${approvedDetail}
\`\`\`
`;

  return (
    <Detail
      navigationTitle={`${task.athletename} • ${task.video_progress_status}`}
      markdown={`# ${task.athletename}\n\n${metadata}`}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Athlete Note">
            <Action
              title="View Notes"
              icon={Icon.Clipboard}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing ID',
                    message: 'Could not resolve athlete_main_id',
                  });
                  return;
                }
                push(
                  <AthleteNotesList
                    athleteId={String(task.athlete_id)}
                    athleteMainId={mainId}
                    athleteName={task.athletename}
                  />,
                );
              }}
            />
            <Action
              title="Add Note"
              icon={Icon.Plus}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing ID',
                    message: 'Could not resolve athlete_main_id',
                  });
                  return;
                }
                push(
                  <AddAthleteNoteForm
                    athleteId={String(task.athlete_id)}
                    athleteMainId={mainId}
                    athleteName={task.athletename}
                    onComplete={() => pop()}
                  />,
                );
              }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Web Actions">
            <Action
              title="Main View"
              icon={Icon.House}
              shortcut={{ modifiers: ['cmd'], key: '1' }}
              onAction={async () => {
                await showToast({
                  style: Toast.Style.Success,
                  title: 'Main View',
                  message: 'Already on main view',
                });
              }}
            />
            <Action
              title="Contact Info"
              icon="☎️"
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: 'Missing ID',
                    message: 'Could not resolve athlete_main_id',
                  });
                  return;
                }
                push(
                  <ContactInfoDetail
                    task={task}
                    contactId={String(task.athlete_id)}
                    athleteMainId={mainId}
                    athleteName={task.athletename}
                    onBack={pop}
                  />,
                );
              }}
              shortcut={{ modifiers: ['cmd'], key: '2' }}
            />
            <Action
              title="Payments"
              icon="💳"
              shortcut={{ modifiers: ['cmd'], key: '3' }}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  return;
                }
                push(
                  <AdminAthleteTableDetail
                    task={task}
                    title="Payments"
                    endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/payments?athlete_main_id=${encodeURIComponent(mainId)}`}
                  />,
                );
              }}
            />
            <Action
              title="Email List"
              icon={Icon.Envelope}
              shortcut={{ modifiers: ['cmd'], key: '4' }}
              onAction={async () => {
                push(
                  <AdminAthleteTableDetail
                    task={task}
                    title="Email List"
                    endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/emails`}
                  />,
                );
              }}
            />
            <Action
              title="Campaigns"
              icon="📣"
              shortcut={{ modifiers: ['cmd'], key: '5' }}
              onAction={async () => {
                const mainId = await resolveMainId();
                if (!mainId) {
                  return;
                }
                push(
                  <AdminAthleteTableDetail
                    task={task}
                    title="Campaigns"
                    endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/campaigns?athlete_main_id=${encodeURIComponent(mainId)}`}
                  />,
                );
              }}
            />
            <Action.OpenInBrowser
              title="General Info"
              url={`https://dashboard.nationalpid.com/admin/athletes?contactid=${task.athlete_id}`}
              icon="👤"
              shortcut={{ modifiers: ['shift', 'cmd'], key: 'o' }}
            />
            <Action.OpenInBrowser
              title="View PlayerID"
              url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
              icon="🌍"
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
            />
            <Action.OpenInBrowser
              title="Task: Video Progress ID"
              url={`https://dashboard.nationalpid.com/videoteammsg/videomailprogress?contactid=${task.athlete_id}`}
              icon={Icon.Globe}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Update Task">
            <Action.Push
              title="Video Updates"
              icon={Icon.Pencil}
              target={
                <VideoUpdatesCommand
                  draftValues={{ athleteName: task.athletename, youtubeLink: '', season: '', videoType: '' }}
                />
              }
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
            />
            <Action.Push
              title="Update Status"
              icon="📊"
              target={<UpdateStatusForm task={task} onUpdate={onStatusUpdate} />}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'x' }}
            />
            <Action.Push
              title="Update Stage"
              icon="🔄"
              target={<UpdateStageForm task={task} onUpdate={onStatusUpdate} />}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Update Due Date">
            <Action.Push
              title="Edit Due Date"
              icon="🗓️"
              target={<EditDueDateForm task={task} onUpdate={onStatusUpdate} />}
              shortcut={{ modifiers: ['cmd'], key: 'd' }}
            />
          </ActionPanel.Section>

          <ActionPanel.Section title="Quick Actions">
            <Action
              title="Copy YouTube Title"
              icon="📺"
              onAction={() => {
                Clipboard.copy(youtubeTitle);
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: youtubeTitle,
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'y' }}
            />
            <Action
              title="Copy Approved Video Title"
              icon="✅" // Approved video title icon
              onAction={() => {
                Clipboard.copy(approvedDetail); // Approved video title
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: 'Approved video title',
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
            />
            <Action
              title="Copy Dropbox Folder"
              icon="📂"
              onAction={() => {
                Clipboard.copy(dropboxFolder);
                showToast({
                  style: Toast.Style.Success,
                  title: 'Copied to clipboard',
                  message: dropboxFolder,
                });
              }}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
            />
            <Action title="Back" icon="⬅️" onAction={onBack} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

interface EditDueDateFormProps {
  task: VideoProgressTask;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

interface CraftReminderFormProps {
  task: VideoProgressTask;
  reminderType: ReminderType;
}

function CraftReminderForm({ task, reminderType }: CraftReminderFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const reminderTitle =
    reminderType === 'inbox-follow-up'
      ? 'Inbox Follow Ups'
      : reminderType === 'in-queue'
        ? 'In Queue Reminders'
        : 'Dropbox Folder Reminders';
  const defaultDate =
    reminderType === 'in-queue' ? getDueReminderDefaultDate(task.video_due_date) : new Date();
  craftLogger.info('CRAFT_FORM_OPEN', {
    athleteId: task.athlete_id,
    athleteName: task.athletename,
    reminderType,
    defaultReminderDate: formatReminderDate(defaultDate),
    videoDueDate: task.video_due_date || null,
  });

  const handleSubmit = async (values: { reminderDate: Date }) => {
    setIsSubmitting(true);
    try {
      craftLogger.info('CRAFT_SUBMIT_START', {
        athleteId: task.athlete_id,
        athleteName: task.athletename,
        reminderType,
        inputReminderDate: values?.reminderDate ? formatReminderDate(values.reminderDate) : null,
      });
      const { baseUrl, password } = getCraftConfig();
      const reminderDate = formatReminderDate(values.reminderDate);
      const markdown = buildReminderMarkdown(task.athletename);
      craftLogger.debug('CRAFT_SUBMIT_PREPARED', {
        reminderDate,
        markdownPreview: markdown.slice(0, 200),
      });
      const documentId = await resolveTargetDocumentId(baseUrl, password, reminderType);
      const result = await upsertReminderViaMcp({
        mcpUrl: baseUrl,
        password,
        reminderType,
        documentId,
        markdown,
        athleteName: task.athletename,
        reminderDate,
      });
      if (!result?.success) {
        throw new Error(result?.error || 'Craft MCP upsert failed');
      }
      craftLogger.info('CRAFT_SUBMIT_DONE', {
        operation: result.operation || 'create',
        blockId: result.matched_block_id || result.created_block_id || null,
        documentId,
        athleteName: task.athletename,
        reminderType,
        reminderDate,
      });
      await showToast({
        style: Toast.Style.Success,
        title: result.operation === 'update' ? 'Updated Craft reminder' : 'Created Craft reminder',
        message: task.athletename,
      });
      pop();
    } catch (error) {
      craftLogger.error('CRAFT_SUBMIT_FAILED', {
        athleteId: task.athlete_id,
        athleteName: task.athletename,
        reminderType,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Craft reminder failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Craft • ${reminderTitle}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={
              reminderType === 'inbox-follow-up'
                ? 'Save Inbox Follow up'
                : reminderType === 'in-queue'
                  ? 'Save In Queue Reminder'
                  : 'Save Dropbox Folder Reminder'
            }
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={`Athlete: ${task.athletename}`} />
      <Form.Description text={`Type: ${reminderTitle}`} />
      <Form.DatePicker id="reminderDate" title="Reminder Date" defaultValue={defaultDate} />
    </Form>
  );
}

function EditDueDateForm({ task, onUpdate }: EditDueDateFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: { dueDate: Date }) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Format date as MM/DD/YYYY (Laravel format)
      const formattedDate = format(values.dueDate, 'MM/dd/yyyy');

      const response = await apiFetch(`/video/${task.id}/duedate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_msg_id: String(task.id),
          due_date: formattedDate,
        }),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as any;
        throw new Error(err?.message || err?.detail || `HTTP ${response.status}`);
      }

      await updateCachedTaskDueDate(task.id, formattedDate);

      await showToast({
        style: Toast.Style.Success,
        title: 'Due Date Updated',
        message: `Updated to ${formattedDate}`,
      });

      onUpdate();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Parse current due date or default to today
  const currentDate = task.video_due_date ? new Date(task.video_due_date) : new Date();

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Due Date" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.DatePicker id="dueDate" title="Due Date" defaultValue={currentDate} />
      <Form.Description text={`Editing due date for: ${task.athletename}`} />
    </Form>
  );
}

interface UpdateCompletionDateFormProps {
  task: VideoProgressTask;
  onBack: () => void;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function UpdateCompletionDateForm({ task, onBack, onUpdate }: UpdateCompletionDateFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (values: { completionDate: Date }) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing task ID',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const formattedDate = values.completionDate.toISOString();

      // LOCAL ONLY: Update SQLite cache, no API call
      const { updateCachedCompletionDate } = await import('./lib/video-progress-cache');
      await updateCachedCompletionDate(task.id, formattedDate);

      await showToast({
        style: Toast.Style.Success,
        title: 'Completion Date Updated',
        message: `Updated to ${format(values.completionDate, 'MM/dd/yyyy')}`,
      });

      onUpdate();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentDate = task.date_completed ? new Date(task.date_completed) : new Date();

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Completion Date" onSubmit={handleSubmit} />
          <Action title="Cancel" icon={Icon.XMarkCircle} onAction={onBack} />
        </ActionPanel>
      }
    >
      <Form.DatePicker id="completionDate" title="Completion Date" defaultValue={currentDate} />
      <Form.Description text={`Editing completion date for: ${task.athletename}`} />
    </Form>
  );
}

const STATUS_OPTIONS = [
  { value: 'Revisions', label: 'Revisions' },
  { value: 'HUDL', label: 'HUDL' },
  { value: 'Dropbox', label: 'Dropbox' },
  { value: 'Not Approved', label: 'Not Approved' },
  { value: 'External Links', label: 'External Links' },
];

const STAGE_OPTIONS = [
  { value: 'In Queue', label: 'In Queue' },
  { value: 'Awaiting Client', label: 'Awaiting Client' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Done', label: 'Done' },
];

interface UpdateStatusFormProps {
  task: VideoProgressTask;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function UpdateStatusForm({ task, onUpdate }: UpdateStatusFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(task.video_progress_status || 'Revisions');

  const handleSubmit = async () => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const feature = 'video-progress.form.status-update';
      const normalizedStatus = normalizeStatus(selectedStatus);
      videoProgressLogger.info('VIDEO_PROGRESS_STATUS_UPDATE', {
        event: 'VIDEO_PROGRESS_STATUS_UPDATE',
        step: 'request',
        status: 'start',
        feature,
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          statusDisplay: selectedStatus,
          statusNormalized: normalizedStatus,
        },
      });
      const response = await apiFetch(`/video/${task.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), status: normalizedStatus }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      if (!response.ok || isExplicitFailurePayload(json)) {
        throw new Error(extractApiErrorMessage(response.status, text, json));
      }

      await updateCachedTaskStatusStage(task.id, { status: selectedStatus });
      videoProgressLogger.info('VIDEO_PROGRESS_STATUS_UPDATE', {
        event: 'VIDEO_PROGRESS_STATUS_UPDATE',
        step: 'request',
        status: 'success',
        feature,
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          statusCode: response.status,
          contentType,
          bodyPreview: text.slice(0, 200),
          statusDisplay: selectedStatus,
          statusNormalized: normalizedStatus,
        },
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Status Updated',
        message: `Updated to ${selectedStatus}`,
      });

      const allTasks = await getCachedTasks();
      const filtered = sortTasks(
        allTasks.filter(
          (t) =>
            shouldIncludeTask(t) &&
            ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
              t.video_progress_status,
            ),
        ),
      );
      onUpdate(filtered);
      pop();
    } catch (error) {
      videoProgressLogger.error('VIDEO_PROGRESS_STATUS_UPDATE', {
        event: 'VIDEO_PROGRESS_STATUS_UPDATE',
        step: 'request',
        status: 'failure',
        feature: 'video-progress.form.status-update',
        error: error instanceof Error ? error.message : String(error),
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          statusDisplay: selectedStatus,
        },
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Update Status • ${task.athletename}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Status" icon={Icon.Checkmark} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Updating status for: ${task.athletename}`} />
      <Form.Dropdown
        id="status"
        title="Video Status"
        value={selectedStatus}
        onChange={setSelectedStatus}
      >
        {STATUS_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.label} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

interface UpdateStageFormProps {
  task: VideoProgressTask;
  onUpdate: (updatedTasks?: VideoProgressTask[]) => void;
}

function UpdateStageForm({ task, onUpdate }: UpdateStageFormProps) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStage, setSelectedStage] = useState(getTaskStage(task) || 'In Queue');

  const handleSubmit = async () => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot Update',
        message: 'Missing video message ID',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedStage = normalizeStage(selectedStage);
      logger.info('Stage update request', {
        videoMsgId: task.id,
        athleteId: task.athlete_id,
        stage: selectedStage,
        normalizedStage,
      });
      const response = await apiFetch(`/video/${task.id}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_msg_id: String(task.id), stage: normalizedStage }),
      });
      const { text, json, contentType } = await readResponseBody(response);
      logger.info('Stage update response', {
        videoMsgId: task.id,
        status: response.status,
        contentType,
        bodyPreview: text.slice(0, 500),
      });
      if (!response.ok) {
        const errMessage =
          json?.message || json?.detail || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(errMessage);
      }

      await updateCachedTaskStatusStage(task.id, { stage: selectedStage });
      await showToast({
        style: Toast.Style.Success,
        title: 'Stage Updated',
        message: `Updated to ${selectedStage}`,
      });

      const allTasks = await getCachedTasks();
      const filtered = sortTasks(
        allTasks.filter(
          (t) =>
            shouldIncludeTask(t) &&
            ['Revisions', 'Revise', 'HUDL', 'Dropbox', 'Not Approved', 'External Links'].includes(
              t.video_progress_status,
            ),
        ),
      );
      onUpdate(filtered);
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Update Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      isLoading={isSubmitting}
      navigationTitle={`Update Stage • ${task.athletename}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Stage" icon={Icon.Checkmark} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text={`Updating stage for: ${task.athletename}`} />
      <Form.Dropdown
        id="stage"
        title="Video Stage"
        value={selectedStage}
        onChange={setSelectedStage}
      >
        {STAGE_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.label} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

interface ContactInfoDetailProps {
  task: VideoProgressTask;
  contactId: string;
  athleteMainId: string;
  athleteName: string;
  onBack: () => void;
}

function ContactInfoDetail({
  task,
  contactId,
  athleteMainId,
  athleteName,
  onBack,
}: ContactInfoDetailProps) {
  const { push } = useNavigation();
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const resolveMainId = async () => {
    return task.athlete_main_id || athleteMainId || (await getAthleteMainId(task.athlete_id));
  };

  const openView = async (target: 'main' | 'payments' | 'emails' | 'campaigns') => {
    const feature = 'VIDEO_PROGRESS_DETAIL_VIEW_SWITCH';
    videoProgressLogger.info(feature, {
      event: feature,
      step: 'request',
      status: 'start',
      feature,
      context: { athleteId: task.athlete_id, from: 'Contact Info', to: target },
    });
    try {
      if (target === 'main') {
        onBack();
      } else if (target === 'payments') {
        const mainId = await resolveMainId();
        if (!mainId) throw new Error('missing_athlete_main_id');
        push(
          <AdminAthleteTableDetail
            task={task}
            title="Payments"
            endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/payments?athlete_main_id=${encodeURIComponent(mainId)}`}
          />,
        );
      } else if (target === 'emails') {
        push(
          <AdminAthleteTableDetail
            task={task}
            title="Email List"
            endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/emails`}
          />,
        );
      } else {
        const mainId = await resolveMainId();
        if (!mainId) throw new Error('missing_athlete_main_id');
        push(
          <AdminAthleteTableDetail
            task={task}
            title="Campaigns"
            endpoint={`/athlete/${encodeURIComponent(String(task.athlete_id))}/admin/campaigns?athlete_main_id=${encodeURIComponent(mainId)}`}
          />,
        );
      }
      videoProgressLogger.info(feature, {
        event: feature,
        step: 'request',
        status: 'success',
        feature,
        context: { athleteId: task.athlete_id, from: 'Contact Info', to: target },
      });
    } catch (error) {
      videoProgressLogger.error(feature, {
        event: feature,
        step: 'request',
        status: 'failure',
        feature,
        error: error instanceof Error ? error.message : String(error),
        context: { athleteId: task.athlete_id, from: 'Contact Info', to: target },
      });
    }
  };

  useEffect(() => {
    loadContactInfo();
  }, [contactId]);

  const loadContactInfo = async () => {
    try {
      setIsLoading(true);
      logger.info(`📞 CONTACT_INFO: Starting load for athlete ${contactId}`, {
        athleteName,
        athleteMainId,
      });

      // Cache-first: check SQLite cache
      const cached = await getCachedContactInfo(Number(contactId));
      if (cached) {
        const transformed = transformCacheToContactInfo(cached);
        setContactInfo(transformed);
        setIsLoading(false);
        logger.info(`✅ CONTACT_INFO: Loaded from cache for ${contactId}`, {
          studentName: cached.studentName,
          hasParent1: !!cached.parent1Name,
          hasParent2: !!cached.parent2Name,
        });
      }

      // Background fetch: get fresh data from API
      logger.info(`🌐 CONTACT_INFO: Fetching from API for ${contactId}`);
      const fresh = await fetchContactInfo(contactId, athleteMainId);
      logger.info(`✅ CONTACT_INFO: Fetched from API for ${contactId}`, {
        studentName: fresh.studentAthlete.name,
        hasParent1: !!fresh.parent1,
        hasParent2: !!fresh.parent2,
      });

      // Cache the fresh data
      const cacheData = transformContactInfoToCache(fresh);
      await upsertContactInfo(cacheData);
      logger.info(`💾 CONTACT_INFO: Cached data for ${contactId}`, { cacheData });

      // Update UI with fresh data
      setContactInfo(fresh);
      logger.info(`✅ CONTACT_INFO: UI updated with fresh data for ${contactId}`);
    } catch (error) {
      logger.error(`❌ CONTACT_INFO: Failed to load for ${contactId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to Load Contact Info',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const markdown = generateContactMarkdown(contactInfo);

  return (
    <Detail
      navigationTitle={`Contact Info • ${athleteName}`}
      markdown={markdown}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Views">
            <Action
              title="Main"
              icon={Icon.House}
              shortcut={{ modifiers: ['cmd'], key: '1' }}
              onAction={() => openView('main')}
            />
            <Action
              title="Contact Info"
              icon="☎️"
              shortcut={{ modifiers: ['cmd'], key: '2' }}
              onAction={loadContactInfo}
            />
            <Action
              title="Payments"
              icon="💳"
              shortcut={{ modifiers: ['cmd'], key: '3' }}
              onAction={() => openView('payments')}
            />
            <Action
              title="Email List"
              icon={Icon.Envelope}
              shortcut={{ modifiers: ['cmd'], key: '4' }}
              onAction={() => openView('emails')}
            />
            <Action
              title="Campaigns"
              icon="📣"
              shortcut={{ modifiers: ['cmd'], key: '5' }}
              onAction={() => openView('campaigns')}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Student Athlete">
            {contactInfo?.studentAthlete.email && (
              <Action.CopyToClipboard
                title="Copy Student Email"
                content={contactInfo.studentAthlete.email}
                icon={Icon.Envelope}
                shortcut={{ modifiers: ['cmd'], key: 'e' }}
              />
            )}
            {contactInfo?.studentAthlete.phone && (
              <Action.CopyToClipboard
                title="Copy Student Phone"
                content={contactInfo.studentAthlete.phone}
                icon={Icon.Phone}
                shortcut={{ modifiers: ['cmd'], key: 't' }}
              />
            )}
          </ActionPanel.Section>

          {contactInfo?.parent1 && (
            <ActionPanel.Section title={`Parent 1 (${contactInfo.parent1.relationship})`}>
              {contactInfo.parent1.email && (
                <Action.CopyToClipboard
                  title="Copy Parent 1 Email"
                  content={contactInfo.parent1.email}
                  icon={Icon.Envelope}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
                />
              )}
              {contactInfo.parent1.phone && (
                <Action.CopyToClipboard
                  title="Copy Parent 1 Phone"
                  content={contactInfo.parent1.phone}
                  icon={Icon.Phone}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
                />
              )}
            </ActionPanel.Section>
          )}

          {contactInfo?.parent2 && (
            <ActionPanel.Section title={`Parent 2 (${contactInfo.parent2.relationship})`}>
              {contactInfo.parent2.email && (
                <Action.CopyToClipboard
                  title="Copy Parent 2 Email"
                  content={contactInfo.parent2.email}
                  icon={Icon.Envelope}
                  shortcut={{ modifiers: ['cmd', 'opt'], key: 'e' }}
                />
              )}
              {contactInfo.parent2.phone && (
                <Action.CopyToClipboard
                  title="Copy Parent 2 Phone"
                  content={contactInfo.parent2.phone}
                  icon={Icon.Phone}
                  shortcut={{ modifiers: ['cmd', 'opt'], key: 't' }}
                />
              )}
            </ActionPanel.Section>
          )}

          <ActionPanel.Section>
            <Action.OpenInBrowser
              title="Open Contact Info on Admin"
              icon={Icon.Globe}
              url={getAdminSectionUrl(task.athlete_id, 'contact')}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'o' }}
            />
            <Action
              title="Refresh Contact Info"
              icon={Icon.ArrowClockwise}
              onAction={loadContactInfo}
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
            />
            <Action title="Back" icon={Icon.ArrowLeft} onAction={onBack} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function generateContactMarkdown(info: ContactInfo | null): string {
  if (!info) return '# Loading...';

  const lines = [
    `# Contact Information`,
    '',
    `## ${info.studentAthlete.name}`,
    `☎️ ${info.studentAthlete.phone || 'N/A'}`,
    `📧 ${info.studentAthlete.email || 'N/A'}`,
    '',
  ];

  if (info.parent1) {
    lines.push(
      `## ${info.parent1.name} (${info.parent1.relationship})`,
      `☎️ ${info.parent1.phone || 'N/A'}`,
      `📧 ${info.parent1.email || 'N/A'}`,
      '',
    );
  }

  if (info.parent2) {
    lines.push(
      `## ${info.parent2.name} (${info.parent2.relationship})`,
      `☎️ ${info.parent2.phone || 'N/A'}`,
      `📧 ${info.parent2.email || 'N/A'}`,
      '',
    );
  }

  return lines.join('\n');
}

export default function VideoProgress() {
  const [tasks, setTasks] = useState<VideoProgressTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>('In Queue');
  const [rawSearchEnabled, setRawSearchEnabled] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [rawSearchResults, setRawSearchResults] = useState<VideoProgressTask[]>([]);
  const [isRawSearchLoading, setIsRawSearchLoading] = useState(false);
  const rawSearchRequestId = useRef(0);
  const { push, pop } = useNavigation();

  useEffect(() => {
    loadTasks();
  }, []);

  const reloadFromCache = async (updatedTasks?: VideoProgressTask[]) => {
    if (updatedTasks) {
      setTasks(dedupeTasksPreferNative(updatedTasks));
      return;
    }
    // Reload from cache only (instant, no API call)
    const cached = await getCachedTasks();
    const filtered = dedupeTasksPreferNative(cached.filter(shouldIncludeTask));
    const sorted = sortTasks(filtered);
    setTasks(sorted);
  };

  const loadTasks = async () => {
    let hadCache = false;
    try {
      setIsLoading(true);

      // Try cache first
      const cached = await getCachedTasks();
      if (cached.length > 0) {
        hadCache = true;
        const filtered = dedupeTasksPreferNative(cached.filter(shouldIncludeTask));
        setTasks(sortTasks(filtered));
        setIsLoading(false);
      }

      // Fetch from API in background
      const response = await apiFetch('/video/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: '',
          last_name: '',
          email: '',
          sport: '0',
          states: '0',
          athlete_school: '0',
          editorassigneddatefrom: '',
          editorassigneddateto: '',
          grad_year: '',
          video_progress: '',
          video_progress_stage: '',
          video_progress_status: '',
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to load tasks (HTTP ${response.status})`);
      }
      const result = (await response.json()) as any;
      const data = result.tasks || [];

      if (!Array.isArray(data)) {
        throw new Error('Invalid data format');
      }

      // Update cache
      await upsertTasks(data);

      // Reload from cache to get date_completed preservation
      const updatedCache = await getCachedTasks();
      const filtered = dedupeTasksPreferNative(updatedCache.filter(shouldIncludeTask));
      setTasks(sortTasks(filtered));

      await showToast({
        style: Toast.Style.Success,
        title: `Found ${filtered.length} active tasks`,
        message: filtered.length === 0 ? 'No active tasks right now' : 'Ready to work',
      });
    } catch (error) {
      if (!hadCache) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to load tasks',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const runRawSearch = async (term: string) => {
    const requestId = ++rawSearchRequestId.current;
    logger.info('Raw search start (cache)', { term, requestId });
    setIsRawSearchLoading(true);
    try {
      const cached = await getCachedTasks();
      const normalizedTerm = term.trim().toLowerCase();
      const matches = cached.filter((task) => {
        const name = (task.athletename || '').toLowerCase();
        return name.includes(normalizedTerm);
      });
      const mapped = dedupeTasksPreferNative(matches).map((task) => ({
        ...task,
        raw_search: true,
      }));

      logger.info('Raw search cache results', {
        term,
        requestId,
        count: mapped.length,
        sample: mapped[0]
          ? { athlete_id: mapped[0].athlete_id, name: mapped[0].athletename }
          : null,
      });

      if (requestId === rawSearchRequestId.current) {
        setRawSearchResults(mapped);
      } else {
        logger.warn('Raw search result discarded (stale request)', { term, requestId });
      }

      if (mapped.length === 0) {
        logger.warn('Raw search returned zero results', { term, requestId });
      }
    } catch (error) {
      logger.error('Raw search failed', {
        term,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (requestId === rawSearchRequestId.current) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Raw Search Failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        setRawSearchResults([]);
      }
    } finally {
      if (requestId === rawSearchRequestId.current) {
        setIsRawSearchLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!rawSearchEnabled) {
      rawSearchRequestId.current += 1;
      if (rawSearchResults.length > 0) {
        logger.info('Raw search disabled, clearing results');
      }
      setRawSearchResults([]);
      setIsRawSearchLoading(false);
      return;
    }

    const term = searchText.trim();
    if (!term) {
      rawSearchRequestId.current += 1;
      logger.info('Raw search term empty, clearing results');
      setRawSearchResults([]);
      setIsRawSearchLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      runRawSearch(term);
    }, 350);

    return () => clearTimeout(timer);
  }, [rawSearchEnabled, searchText]);

  const toggleRawSearch = async () => {
    const next = !rawSearchEnabled;
    setRawSearchEnabled(next);
    if (!next) {
      logger.info('Raw search turned off, reloading cache');
      await reloadFromCache();
    } else {
      logger.info('Raw search turned on');
    }
  };

  const normalizedSearch = searchText.trim().toLowerCase();
  const shouldBypassFilters = rawSearchEnabled && normalizedSearch.length > 0;
  const activeTasks = shouldBypassFilters ? rawSearchResults : tasks;
  const doneCutoffTs = Date.parse('2025-06-01T00:00:00Z');

  const refreshViewsFromCache = async () => {
    const cached = await getCachedTasks();
    const filtered = dedupeTasksPreferNative(cached.filter(shouldIncludeTask));
    setTasks(sortTasks(filtered));

    if (rawSearchEnabled && normalizedSearch.length > 0) {
      const matches = cached.filter((task) => {
        const name = (task.athletename || '').toLowerCase();
        return name.includes(normalizedSearch);
      });
      setRawSearchResults(
        dedupeTasksPreferNative(matches).map((task) => ({
          ...task,
          raw_search: true,
        })),
      );
    }
  };

  const assignTaskToMeFromCache = async (task: VideoProgressTask) => {
    if (!task.id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Cannot assign owner',
        message: 'Missing task id in cache row',
      });
      return;
    }

    const feature = 'video-progress.assign-editor-cache';
    videoProgressLogger.info('VIDEO_PROGRESS_ASSIGN_EDITOR', {
      event: 'VIDEO_PROGRESS_ASSIGN_EDITOR',
      step: 'assign_editor',
      status: 'start',
      feature,
      context: {
        taskId: task.id,
        athleteId: task.athlete_id,
        athleteName: task.athletename,
        fromEditor: task.assignedvideoeditor || '',
        toEditor: ASSIGNED_EDITOR,
      },
    });

    try {
      await updateCachedTaskAssignedEditor(task.id, ASSIGNED_EDITOR);
      await refreshViewsFromCache();

      videoProgressLogger.info('VIDEO_PROGRESS_ASSIGN_EDITOR', {
        event: 'VIDEO_PROGRESS_ASSIGN_EDITOR',
        step: 'assign_editor',
        status: 'success',
        feature,
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          athleteName: task.athletename,
          toEditor: ASSIGNED_EDITOR,
        },
      });

      await showToast({
        style: Toast.Style.Success,
        title: 'Assigned to Jerami Singleton',
        message: task.athletename,
      });
    } catch (error) {
      videoProgressLogger.error('VIDEO_PROGRESS_ASSIGN_EDITOR', {
        event: 'VIDEO_PROGRESS_ASSIGN_EDITOR',
        step: 'assign_editor',
        status: 'failure',
        feature,
        error: error instanceof Error ? error.message : String(error),
        context: {
          taskId: task.id,
          athleteId: task.athlete_id,
          athleteName: task.athletename,
          toEditor: ASSIGNED_EDITOR,
        },
      });

      await showToast({
        style: Toast.Style.Failure,
        title: 'Assign owner failed',
        message: error instanceof Error ? error.message : 'Unknown cache error',
      });
    }
  };

  const matchesSearch = (task: VideoProgressTask) => {
    if (!normalizedSearch) return true;
    const haystack = [
      task.athletename,
      task.high_school,
      task.high_school_city,
      task.high_school_state,
      String(task.athlete_id || ''),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  };

  // Apply stage filter (unless raw search is active)
  const filteredTasks = activeTasks.filter((task) => {
    if (shouldBypassFilters) {
      return true;
    }
    if (!shouldIncludeTask(task)) {
      return false;
    }
    if (!matchesSearch(task)) {
      return false;
    }
    // When stageFilter is 'all', show only 'In Queue' stage (truly active work)
    // When stageFilter is explicitly set, show ONLY that stage
    const stageValue = getTaskStage(task);
    const stageMatch =
      stageFilter === 'all'
        ? true
        : normalizeStageValue(stageValue) === normalizeStageValue(stageFilter);
    if (!stageMatch) {
      return false;
    }
    if (stageFilter === 'Done') {
      const completedAt = task.date_completed ? Date.parse(task.date_completed) : NaN;
      // Done view should only show entries with an explicit completion timestamp (green tag source).
      if (!task.date_completed || Number.isNaN(completedAt)) {
        return false;
      }
      if (!Number.isNaN(doneCutoffTs) && completedAt < doneCutoffTs) {
        return false;
      }
    }
    return true;
  });
  const visibleTasks = shouldBypassFilters
    ? filteredTasks
    : stageFilter === 'Done'
      ? sortDoneTasks(filteredTasks)
      : stageFilter === 'In Queue'
        ? sortInQueueTasksByDueDate(filteredTasks)
        : filteredTasks;

  const jumpToStageFilter = async (stage: string) => {
    setStageFilter(stage);
    if (stage === 'Done') {
      await reloadFromCache();
    }
  };

  const renderStageViewActions = () => (
    <ActionPanel.Section title="Stage Views">
      <Action
        title="🔎 All"
        onAction={() => jumpToStageFilter('all')}
        shortcut={{ modifiers: ['cmd'], key: '1' }}
      />
      <Action
        title="🔎 In Queue"
        onAction={() => jumpToStageFilter('In Queue')}
        shortcut={{ modifiers: ['cmd'], key: '2' }}
      />
      <Action
        title="🔎 Awaiting"
        onAction={() => jumpToStageFilter('Awaiting Client')}
        shortcut={{ modifiers: ['cmd'], key: '3' }}
      />
      <Action
        title="🔎 On Hold"
        onAction={() => jumpToStageFilter('On Hold')}
        shortcut={{ modifiers: ['cmd'], key: '4' }}
      />
      <Action
        title="🔎 Done"
        onAction={() => jumpToStageFilter('Done')}
        shortcut={{ modifiers: ['cmd'], key: '5' }}
      />
    </ActionPanel.Section>
  );

  const renderRawSearchToggleAction = () => (
    <Action
      title={`Raw Search Mode: ${rawSearchEnabled ? 'On' : 'Off'}`}
      icon={rawSearchEnabled ? Icon.CheckCircle : Icon.Circle}
      onAction={toggleRawSearch}
      shortcut={{ modifiers: ['cmd'], key: 'f' }}
    />
  );

  // Handle combined filter change
  const handleFilterChange = async (value: string) => {
    if (value.startsWith('stage:')) {
      const stage = value.replace('stage:', '');
      await jumpToStageFilter(stage);
    }
  };

  // Build current filter value for display
  const currentFilterValue = `stage:${stageFilter}`;

  return (
    <List
      isLoading={isLoading || isRawSearchLoading}
      navigationTitle="Video Progress (ProspectID)"
      searchBarPlaceholder="Search athletes..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      actions={
        <ActionPanel>
          {renderRawSearchToggleAction()}
          {renderStageViewActions()}
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Stage (⌘P)"
          value={currentFilterValue}
          onChange={handleFilterChange}
        >
          <List.Dropdown.Section title="🎬 Stage">
            <List.Dropdown.Item title="All Stages" value="stage:all" />
            <List.Dropdown.Item title="In Queue" value="stage:In Queue" />
            <List.Dropdown.Item title="Awaiting Client" value="stage:Awaiting Client" />
            <List.Dropdown.Item title="On Hold" value="stage:On Hold" />
            <List.Dropdown.Item title="Done" value="stage:Done" />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {visibleTasks.length === 0 ? (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title={shouldBypassFilters ? 'No Raw Search Results' : 'No Active Tasks'}
          description={shouldBypassFilters ? 'Try a different search' : 'All done!'}
          actions={
            <ActionPanel>
              {renderRawSearchToggleAction()}
              {renderStageViewActions()}
            </ActionPanel>
          }
        />
      ) : (
        <List.Section
          title={`In Progress (${visibleTasks.length})`}
          subtitle={rawSearchEnabled ? 'Raw Search' : undefined}
        >
          {visibleTasks.map((task) => (
            <List.Item
              key={task.id ?? task.athlete_id}
              icon={getStageIcon(getTaskStage(task))}
              title={task.athletename}
              subtitle={`${task.grad_year} • ${normalizeSportName(task.sport_name)} • ${getPositions(task)}`}
              accessories={
                [
                  getTaskStage(task) === 'Done' && task.date_completed
                    ? { tag: { value: formatDate(task.date_completed), color: Color.Green } }
                    : { text: formatDate(task.video_due_date) },
                  isManualIngestTask(task)
                    ? { tag: { value: 'Manual', color: Color.Orange } }
                    : undefined,
                  {
                    icon: getStatusIcon(task.video_progress_status),
                    text: task.video_progress_status,
                  },
                ].filter(Boolean) as List.Item.Accessory[]
              }
              actions={
                <ActionPanel>
                  <Action
                    title="View Details"
                    icon={Icon.Eye}
                    onAction={() =>
                      push(
                        <VideoProgressDetail
                          task={task}
                          onBack={pop}
                          onStatusUpdate={reloadFromCache}
                        />,
                      )
                    }
                    shortcut={{ modifiers: ['cmd'], key: 'return' }}
                  />
                  <Action.Push
                    title="Email Student Athlete"
                    icon={Icon.Envelope}
                    target={
                      <EmailStudentAthletesCommand
                        draftValues={{ athleteName: task.athletename, emailTemplate: '' }}
                      />
                    }
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
                  />
                  <Action.Push
                    title="Video Updates"
                    icon={Icon.Pencil}
                    target={
                      <VideoUpdatesCommand
                        draftValues={{ athleteName: task.athletename, youtubeLink: '', season: '', videoType: '' }}
                      />
                    }
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
                  />
                  <Action.Push
                    title="Inbox Follow Ups"
                    icon={CRAFT_ICON}
                    target={<CraftReminderForm task={task} reminderType="inbox-follow-up" />}
                  />
                  <Action.Push
                    title="In Queue Reminders"
                    icon={CRAFT_ICON}
                    target={<CraftReminderForm task={task} reminderType="in-queue" />}
                  />
                  <Action.Push
                    title="Dropbox Folder Reminders"
                    icon={CRAFT_ICON}
                    target={<CraftReminderForm task={task} reminderType="dropbox-folder" />}
                  />
                  <Action
                    title="Assign to Jerami Singleton (Cache)"
                    icon={Icon.Person}
                    onAction={() => assignTaskToMeFromCache(task)}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
                  />
                  {renderRawSearchToggleAction()}
                  {stageFilter === 'Done' && (
                    <Action
                      title="Set Completion Date"
                      icon={Icon.Calendar}
                      onAction={() =>
                        push(
                          <UpdateCompletionDateForm
                            task={task}
                            onBack={pop}
                            onUpdate={reloadFromCache}
                          />,
                        )
                      }
                      shortcut={{ modifiers: ['cmd'], key: 'd' }}
                    />
                  )}
                  <Action.OpenInBrowser
                    title="View PlayerID"
                    url={`https://dashboard.nationalpid.com/athlete/profile/${task.athlete_id}`}
                    icon={Icon.Globe}
                    shortcut={{ modifiers: ['cmd'], key: 'o' }}
                  />
                  <Action.OpenInBrowser
                    title="Task: Video Progress ID"
                    url={`https://dashboard.nationalpid.com/videoteammsg/videomailprogress?contactid=${task.athlete_id}`}
                    icon={Icon.Globe}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
                  />
                  <Action.CopyToClipboard
                    title="Copy Athlete Name"
                    content={task.athletename}
                    icon={Icon.CopyClipboard}
                    shortcut={{ modifiers: ['cmd'], key: 'c' }}
                  />
                  <Action
                    title="Reload Tasks"
                    icon={Icon.ArrowClockwise}
                    onAction={async () => {
                      if (shouldBypassFilters) {
                        const term = searchText.trim();
                        if (!term) {
                          logger.warn('Raw search reload skipped (empty term)');
                          return;
                        }
                        await runRawSearch(term);
                        return;
                      }
                      await loadTasks();
                    }}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                  />
                  {renderStageViewActions()}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
