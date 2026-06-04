import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Grid,
  Icon,
  List,
  LaunchProps,
  LaunchType,
  Toast,
  Clipboard,
  open,
  launchCommand,
  clearSearchBar,
  showToast,
  useNavigation,
} from '@raycast/api';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { saveProspectContacts, searchContacts } from 'swift:../swift/contacts';
import SupabaseLifecycleStatusCommand from './supabase-lifecycle-status';
import { exportDailyCallBlocks, type TaskCounts } from './daily-call-blocks';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { ClientOutreachMessageForm } from './components/follow-up-message-forms';
import { HeadScoutSchedulesRoot } from './head-scout-schedules';
import type {
  MeetingSetSubmitResponse,
  MeetingSetTemplateResponse,
  RescheduleMeetingSubmitRequest,
  RescheduleMeetingSubmitResponse,
  SalesStageOption,
  ScoutAthleteTask,
  ScoutPortalTask,
  ScoutPrepContext,
} from './features/scout-prep/types';
import {
  buildMessagesComposeUrlForRecipients,
  buildMeetingSetCallNotesMarkdown,
  buildProspectContactAdminNote,
  buildProspectContactShortcutPayloadFromName,
  buildScoutPrepLeavingVoicemailBody,
  buildVoicemailFollowUpBody,
  getVoicemailFollowUpRecipients,
  getProspectContactShortcutCandidates,
  normalizePhoneForMessages,
  resolveProspectContactCreateFailureToast,
  resolveParentHonorificFromRelationship,
  hydrateMeetingSetTemplateForForm,
  type ProspectContactShortcutCandidate,
  selectScoutPrepContactNumbers,
} from './lib/scout-prep-contact';
import { resolveAthleteGenderWithRayAI, resolveParentHonorificWithRayAI } from './lib/raycast-ai';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepMetadata,
  buildScoutPrepValues,
  completeScoutPrepTaskAfterVoicemail,
  fetchScoutPortalTasks,
  fetchScoutPortalTaskBuckets,
  findNewestIncompleteFollowUpTask,
  findNewestIncompleteConfirmationTask,
  isScoutPrepContextCacheUsableForDisplay,
  loadScoutPrepContext,
  recordVoicemailFollowUpMessageSent,
  stripMoveThisTaskPrefix,
  updateScoutPrepTask,
} from './lib/scout-prep';
import {
  TASK_LIST_PAGE_SIZE,
  buildTaskBucketRows,
  getTaskSectionTitle,
  mapTaskListFilterToRange,
  type TaskListSort,
  type TaskListSortKey,
  type TaskListFilter,
  type ScoutTaskRange,
} from './lib/scout-task-filters';
import { syncCallNotesPageToNotion, syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
import {
  ensureProspectDetails,
  runProspectRawSearch,
  type ProspectResult,
} from './lib/prospect-search';
import {
  addPersonalFollowUp,
  listPersonalFollowUps,
  removePersonalFollowUp,
  type PersonalFollowUpEntry,
} from './lib/personal-follow-up-cache';
import {
  fetchCuratedSalesStageOptions,
  fetchMeetingSetTemplate,
  fetchRescheduleMeetingTemplate,
  submitMeetingSet,
  submitRescheduleMeeting,
  updateSalesStage,
} from './lib/sales-stage';
import { buildPostCallActionPlan } from './domain/post-call-action';
import {
  classifyMeetingSetStage,
  classifyPostMeetingOutcomeStage,
  isConfirmedRescheduleSchedulingStage,
  needsPostCallMeetingSchedulingFields,
  POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS,
} from './domain/sales-stage-contract';
import {
  isConfirmationCallTask,
  getTaskSpecificUpdateVariant,
  getTopmostIncompleteTask,
  getVoicemailLifecycleStageLabel,
  getVoicemailLifecycleTaskTitle,
  resolveVoicemailLifecycleTaskForCompletion,
} from './domain/scout-task-selection';
import {
  SCOUT_PREP_BATCH_OPERATIONS,
  buildScoutPrepBatchPreflightRows,
  collectFailedScoutPrepBatchTaskIdsFromLogText,
  getScoutPrepBatchGradYearOptions,
  getScoutPrepBatchTaskTitleOptions,
  isScoutPrepBatchTaskEligible,
  isScoutPrepConfirmationCleanupDue,
  normalizeScoutPrepBatchTaskId,
  resolveBatchVoicemailRecipient,
  runScoutPrepBatchRow,
  type ScoutPrepBatchOperation,
  type ScoutPrepBatchRow,
} from './domain/scout-batch-runner';
import { buildScoutPrepCommandContext } from './domain/scout-prep-command-pipeline';
import { searchLogger } from './lib/logger';
import { resolveTimezone } from './lib/scout-prep-ai';
import {
  easternLocalIsoToDate,
  fetchAthleteBookedMeetings,
  fetchHeadScoutSlots,
  fetchOpenMeetings,
  filterVisibleHeadScoutSlots,
  formatHeadScoutNaturalSlotLabel,
  formatHeadScoutSlotForTimezone,
  formatHeadScoutWeekLabel,
  HEAD_SCOUT_ORDER,
  type BookedMeetingEvent,
  type HeadScoutSlot,
  type OpenMeetingSlot,
} from './lib/head-scout-schedules';
import {
  resolveBookedMeetingDetailsForForm,
  selectCurrentBookedMeeting,
  type ResolvedBookedMeetingDetails,
} from './lib/booked-meeting-details-resolver';
import {
  cacheBookedMeetingDescription,
  getCachedBookedMeetingDescription,
} from './lib/booked-meeting-description-cache';
import { addAthleteNote } from './lib/npid-mcp-adapter';
import {
  resolveVoicemailFollowUpVariant,
  type VoicemailFollowUpVariant,
} from './lib/scout-follow-up-templates';
import {
  buildDefaultReminderDate,
  buildReminderAdminUrl,
  buildReminderDraft,
  createReminder,
  mapAssociatedContactsToReminderOptions,
  type ReminderContactOption,
  type ReminderMode,
} from './lib/reminders';
import {
  recordMeetingSet,
  recordRescheduled,
  recordVoicemailFollowUpSent,
} from './lib/supabase-lifecycle';
import {
  hasAthleteContactCacheForTask,
  syncAthleteContactCacheFromScoutPrepContext,
} from './lib/athlete-contact-cache';
import { syncMeetingSetConfirmationCacheFromScoutPrep } from './lib/set-meeting-confirmation-cache-sync';
import {
  sendClientMessage,
  sendVerifiedClientMessage,
  verifyRecentClientMessageSend,
} from './lib/client-message-sandbox';
import {
  buildMaxPrepsSearchLabel,
  resolveMaxPrepsScoutContext,
} from './lib/maxpreps-scout-context';
import {
  getCachedScoutPrepContext,
  getCachedScoutPrepMaxPrepsContext,
  setCachedDailyCallBlockTaskCounts,
  setCachedScoutPrepContext,
  setCachedScoutPrepMaxPrepsContext,
  type ScoutPrepMaxPrepsCacheInput,
  type ScoutPrepMaxPrepsContext,
} from './lib/scout-prep-cache';
import {
  isCallAttempt1PortalTask,
  runDuplicateProfileResolutionForTask,
} from './lib/scout-duplicate-profiles';
import {
  resolveIanaTimeZoneFromLegacyLabel,
  resolveLegacyTimezoneLabelFromIana,
} from './domain/outreach-time-wording';

const FEATURE = 'scout-prep';
const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';
const SCOUT_PREP_BATCH_LIMIT = 10;
const RAYCAST_LOG_DIR = '/Users/singleton23/raycast_logs';
const SCOUT_PREP_SEARCH_LOG_FILE = `${RAYCAST_LOG_DIR}/search.log`;
const SCOUT_PREP_BATCH_ATTEMPT_INDEX_FILE = `${RAYCAST_LOG_DIR}/scout-prep-batch-attempts.json`;
const STATE_NAMES_BY_ABBREVIATION: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

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

async function showLoadingToast(title: string, message?: string) {
  const compactTitle = String(title || '')
    .trim()
    .slice(0, 24);
  const compactMessage = String(message || '')
    .trim()
    .slice(0, 28);
  return showToast({
    style: Toast.Style.Animated,
    title: compactTitle,
    message: compactMessage || undefined,
  });
}

async function completeScoutPrepMutationSuccess(args: {
  toast?: Toast;
  title: string;
  message?: string;
  onReturnToRootList?: () => void | Promise<void>;
}) {
  if (args.toast) {
    args.toast.style = Toast.Style.Success;
    args.toast.title = args.title;
    args.toast.message = args.message;
  } else {
    await showToast({
      style: Toast.Style.Success,
      title: args.title,
      message: args.message,
    });
  }
  await args.onReturnToRootList?.();
}

async function popViews(pop: () => void, count: number) {
  for (let index = 0; index < count; index += 1) {
    pop();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function popViewsThenRefreshRoot(
  pop: () => void,
  count: number,
  refreshRoot?: () => void | Promise<void>,
) {
  await popViews(pop, count);
  await refreshRoot?.();
}

function formatTaskIdLabel(taskId?: string | number | null): string {
  const normalized = String(taskId || '').trim();
  return normalized ? `#${normalized}` : '';
}

async function copyToClipboardWithToast(content: string, label: string) {
  const toast = await showLoadingToast('Copying', label);
  await copyTextToPasteboard(content);
  toast.style = Toast.Style.Success;
  toast.title = `${label} copied`;
  toast.message = undefined;
}

async function copyTextToPasteboard(content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/pbcopy', []);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pbcopy exited with code ${code ?? 'unknown'}`));
    });
    child.stdin.end(content);
  });
}

async function triggerMaxPrepsSearch(searchLabel: string) {
  await open(
    `kmtrigger://macro=B4784B2F-FC2A-46C1-A8D3-24D1A5A97896&value=${encodeURIComponent(searchLabel)}`,
  );
  await showToast({
    style: Toast.Style.Success,
    title: 'MaxPreps Search Sent',
  });
}

function titleCaseWords(value?: string | null): string {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function firstWord(value?: string | null): string {
  return (
    String(value || '')
      .trim()
      .split(/\s+/)[0] || ''
  );
}

function formatStateForHighSchoolCopy(state?: string | null): string | null {
  const rawState = String(state || '').trim();
  if (!rawState) {
    return null;
  }

  const normalized = rawState.toUpperCase();
  return STATE_NAMES_BY_ABBREVIATION[normalized] || titleCaseWords(rawState);
}

function buildHighSchoolCopyLabel(context?: ScoutPrepContext | null): string | null {
  return buildMaxPrepsSearchLabel({
    highSchool: context?.resolved.high_school,
    state: context?.resolved.state,
    sport: context?.resolved.sport,
  });
}

function buildMaxPrepsCacheInput(
  context: ScoutPrepContext,
  task: ScoutPortalTask,
): ScoutPrepMaxPrepsCacheInput {
  return {
    athleteName: context.contactInfo.studentAthlete.name || task.athlete_name,
    highSchool: context.resolved.high_school,
    state: context.resolved.state,
    sport: context.resolved.sport,
  };
}

function mergeMaxPrepsContext(
  context: ScoutPrepContext,
  maxPreps: ScoutPrepMaxPrepsContext,
): ScoutPrepContext {
  return {
    ...context,
    resolved: {
      ...context.resolved,
      maxpreps_mascot: maxPreps.mascot,
      maxpreps_state_rank: maxPreps.state_rank,
      maxpreps_url: maxPreps.url,
      maxpreps: {
        mascot: maxPreps.mascot,
        state_rank: maxPreps.state_rank,
        url: maxPreps.url,
      },
    },
  };
}

function formatMaxPrepsToastMessage(maxPreps: ScoutPrepMaxPrepsContext): string {
  return [maxPreps.mascot, maxPreps.state_rank].filter(Boolean).join(' • ');
}

async function mergeCachedMaxPrepsContext(
  task: ScoutPortalTask,
  context: ScoutPrepContext,
): Promise<ScoutPrepContext> {
  const cachedMaxPreps = await getCachedScoutPrepMaxPrepsContext(
    buildMaxPrepsCacheInput(context, task),
  );
  return cachedMaxPreps?.isFresh ? mergeMaxPrepsContext(context, cachedMaxPreps.data) : context;
}

async function loadScoutPrepContextForDisplay(
  task: ScoutPortalTask,
  options: { forceLive?: boolean } = {},
): Promise<{ context: ScoutPrepContext; source: 'context-cache' | 'live' }> {
  if (!options.forceLive) {
    const cachedContext = await getCachedScoutPrepContext(task);
    if (cachedContext?.isFresh && isScoutPrepContextCacheUsableForDisplay(cachedContext.data)) {
      return {
        context: await mergeCachedMaxPrepsContext(task, cachedContext.data),
        source: 'context-cache',
      };
    }
  }

  const liveContext = await loadScoutPrepContext(task);
  const renderContext = await mergeCachedMaxPrepsContext(task, liveContext);
  await setCachedScoutPrepContext(task, renderContext);
  return {
    context: renderContext,
    source: 'live',
  };
}

function uniqueContactCacheSeedTasks(
  taskBuckets: Record<ScoutTaskRange, ScoutPortalTask[]>,
): ScoutPortalTask[] {
  const byAthleteKey = new Map<string, ScoutPortalTask>();
  for (const task of Object.values(taskBuckets).flat()) {
    const athleteId = String(task.athlete_id || task.contact_id || '').trim();
    const athleteMainId = String(task.athlete_main_id || '').trim();
    if (!athleteId || !athleteMainId) continue;
    const key = `${athleteId}:${athleteMainId}`;
    if (!byAthleteKey.has(key)) byAthleteKey.set(key, task);
  }
  return Array.from(byAthleteKey.values());
}

async function seedMissingAthleteContactCacheFromTasks(
  taskBuckets: Record<ScoutTaskRange, ScoutPortalTask[]>,
) {
  for (const task of uniqueContactCacheSeedTasks(taskBuckets)) {
    try {
      const cacheState = await hasAthleteContactCacheForTask(task);
      if (!cacheState.enabled || cacheState.cached) continue;

      const context = await loadScoutPrepContext(task);
      await syncAthleteContactCacheFromScoutPrepContext({
        context,
        crmStage: null,
        source: 'scout_prep_task_ingest',
        seenAt: new Date().toISOString(),
      });
    } catch (error) {
      logFailure(
        'SCOUT_PREP_CONTACT_CACHE_INGEST',
        'background-seed',
        error instanceof Error ? error.message : String(error),
        {
          contactId: task.contact_id,
          athleteId: task.athlete_id || task.contact_id,
          athleteMainId: task.athlete_main_id || null,
        },
      );
    }
  }
}

function buildMeetingSetStartsAt(
  selectedOpenMeeting?: {
    start_time?: string | null;
    date_time_label?: string | null;
  } | null,
): string | null {
  const rawStartTime = String(selectedOpenMeeting?.start_time || '').trim();
  if (!rawStartTime) {
    return null;
  }

  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawStartTime)) {
    return rawStartTime;
  }

  const dateLabel = String(selectedOpenMeeting?.date_time_label || '').trim();
  const match = dateLabel.match(/^[A-Za-z]{3}\s+(\d{2})\/(\d{2})\/(\d{2})/);
  if (!match) {
    return rawStartTime;
  }

  const [, month, day, year] = match;
  return `20${year}-${month}-${day}T${rawStartTime}`;
}

function buildEasternStartsAt(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00-04:00`;
  }
  return trimmed;
}

function normalizePersonName(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveBookedMeetingScout(meeting?: BookedMeetingEvent | null) {
  const assignedOwner = normalizePersonName(meeting?.assigned_owner);
  if (!assignedOwner) {
    return null;
  }
  return (
    HEAD_SCOUT_ORDER.find((scout) => normalizePersonName(scout.scout_name) === assignedOwner) ||
    null
  );
}

function buildOpenMeetingSlotFromBookedMeeting(
  meeting?: BookedMeetingEvent | null,
  startTimeOverride?: string | null,
): OpenMeetingSlot | null {
  if (!meeting?.event_id || !meeting.start) {
    return null;
  }
  return {
    open_event_id: meeting.event_id,
    date_time_label: formatBookedMeetingLaravelDateTimeLabel(meeting),
    title: meeting.title || '',
    assigned_owner: meeting.assigned_owner || '',
    start_time:
      String(startTimeOverride || '').trim() || meeting.start.split('T')[1]?.slice(0, 5) || '',
  };
}

function formatBookedMeetingLaravelDateTimeLabel(meeting: BookedMeetingEvent): string {
  const rawLabel = String(meeting.date_time_label || '').trim();
  if (rawLabel && !/^\d{4}-\d{2}-\d{2}T/.test(rawLabel)) {
    return rawLabel;
  }
  const start = easternLocalIsoToDate(String(meeting.start || '').trim());
  if (!start) {
    return rawLabel || meeting.start;
  }
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  })
    .format(start)
    .replace(/,/g, '');
}

function buildMeetingLengthFromBookedMeeting(meeting?: BookedMeetingEvent | null): string | null {
  if (!meeting?.start || !meeting.end) {
    return null;
  }
  const start = easternLocalIsoToDate(meeting.start);
  const end = easternLocalIsoToDate(meeting.end);
  if (!start || !end) {
    return null;
  }
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function toLaravelRecruitTimezone(value?: string | null): string {
  const raw = String(value || '').trim();
  return resolveLegacyTimezoneLabelFromIana(raw) || raw;
}

function selectMeetingForFromResolvedBookedMeeting(
  resolved?: ResolvedBookedMeetingDetails | null,
  bookedScout?: (typeof HEAD_SCOUT_ORDER)[number] | null,
): string | null {
  const candidates = [resolved?.assignedTo, bookedScout?.meeting_for]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (HEAD_SCOUT_ORDER.some((scout) => scout.meeting_for === candidate)) {
      return candidate;
    }
  }
  return candidates[0] || null;
}

function applyResolvedBookedMeetingPayloadToTemplate(
  template: MeetingSetTemplateResponse,
  resolved?: ResolvedBookedMeetingDetails | null,
): MeetingSetTemplateResponse {
  if (!resolved) {
    return template;
  }

  const selectedTimezone = toLaravelRecruitTimezone(resolved.meetingTimezone);
  const recruitTimezoneOptions = selectedTimezone
    ? (() => {
        let found = false;
        const nextOptions = (template.recruit_timezone_options || []).map((option) => {
          const optionValue = toLaravelRecruitTimezone(option.value || option.label);
          const optionLabel = toLaravelRecruitTimezone(option.label || option.value);
          const isSelected = optionValue === selectedTimezone || optionLabel === selectedTimezone;
          if (isSelected) found = true;
          return { ...option, value: optionValue, label: optionLabel, selected: isSelected };
        });
        if (!found) {
          nextOptions.unshift({
            value: selectedTimezone,
            label: selectedTimezone,
            selected: true,
          });
        }
        return nextOptions;
      })()
    : template.recruit_timezone_options;

  return {
    ...template,
    meeting_name: resolved.meetingName || resolved.title || template.meeting_name,
    selected_recruit_timezone: selectedTimezone || template.selected_recruit_timezone,
    recruit_timezone_options: recruitTimezoneOptions,
    details_template: resolved.description || template.details_template,
  };
}

function isMeetingSetStage(stageLabel?: string | null): boolean {
  return Boolean(classifyMeetingSetStage(String(stageLabel || '')));
}

function isConfirmedRescheduleMeetingStage(stageLabel?: string | null): boolean {
  return isConfirmedRescheduleSchedulingStage(String(stageLabel || ''));
}

function isReschedulePendingStage(stageLabel?: string | null): boolean {
  return (
    classifyPostMeetingOutcomeStage(String(stageLabel || ''))?.outcome === 'resolution_pending'
  );
}

function isCanceledPostMeetingStage(stageLabel?: string | null): boolean {
  return classifyPostMeetingOutcomeStage(String(stageLabel || ''))?.outcome === 'canceled';
}

function needsMeetingSchedulingFields(stageLabel?: string | null): boolean {
  return needsPostCallMeetingSchedulingFields(String(stageLabel || ''));
}

async function cacheMeetingDescriptionForReschedulePending(args: {
  athleteId: string;
  athleteMainId: string;
  initialBookedMeeting?: BookedMeetingEvent | null;
}): Promise<string | null> {
  const resolved = await resolveBookedMeetingDetailsForForm({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    initialBookedMeeting: args.initialBookedMeeting || null,
  });
  if (!resolved?.description) return null;

  await cacheBookedMeetingDescription({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
    eventId: resolved.openEventId || resolved.bookedMeeting.event_id,
    description: resolved.description,
  });
  return resolved.description;
}

function getPostMeetingOperatorNoteTitle(
  stageLabel?: string | null,
  value?: string | null,
): string {
  const provided = String(value || '').trim();
  if (provided) return provided;
  return isCanceledPostMeetingStage(stageLabel)
    ? 'Canceled Meeting Reason'
    : 'Reschedule Pending Reason';
}

function getPostMeetingScoutNotesTitle(stageLabel?: string | null): string {
  return isCanceledPostMeetingStage(stageLabel) ? 'CAN And Scout Notes' : 'RSP And Scout Notes';
}

function getTaskDisplayTitle(
  task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null,
): string {
  return (
    stripMoveThisTaskPrefix(task?.title) ||
    String(task?.description || '').trim() ||
    'Untitled Task'
  );
}

function isReschedulePendingTask(
  task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null,
): boolean {
  const title = stripMoveThisTaskPrefix(task?.title) || String(task?.title || '').trim();
  const normalizedTitle = title.toLowerCase();
  return (
    /^\s*\(rsp\)/i.test(String(task?.title || '')) ||
    normalizedTitle.includes('reschedule pending') ||
    normalizedTitle.includes('rescheduled pending') ||
    normalizedTitle.includes('rescheduled') ||
    normalizedTitle.includes('res pending') ||
    normalizedTitle.includes('res. pending')
  );
}

function isConfirmationCallTaskTitle(
  task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null,
): boolean {
  const title = stripMoveThisTaskPrefix(task?.title) || String(task?.title || '').trim();
  return title.toLowerCase().includes('confirmation call');
}

function isFollowUpTaskTitle(
  task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null,
): boolean {
  const title = stripMoveThisTaskPrefix(task?.title) || String(task?.title || '').trim();
  const normalizedTitle = title.toLowerCase();
  return normalizedTitle.includes('follow up') || normalizedTitle.includes('follow-up');
}

function canCompleteTaskFromActionPanel(
  task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null,
): boolean {
  return (
    isConfirmationCallTaskTitle(task) || isReschedulePendingTask(task) || isFollowUpTaskTitle(task)
  );
}

function resolveDirectCompletionTask(
  task: ScoutPortalTask,
  context?: ScoutPrepContext | null,
): ScoutAthleteTask | null {
  const selectedTaskId = String(task.task_id || '').trim();
  if (selectedTaskId) {
    return {
      task_id: selectedTaskId,
      title: task.title || null,
      assigned_owner: task.assigned_owner || null,
      due_date: task.due_date || null,
      completion_date: task.completion_date || null,
      description: task.description || task.title || null,
    };
  }

  return (
    getTopmostIncompleteTask((context?.tasks || []).filter(canCompleteTaskFromActionPanel)) || null
  );
}

async function completeScoutPrepTaskDirectly(args: {
  task: ScoutPortalTask;
  context?: ScoutPrepContext | null;
}): Promise<ScoutAthleteTask> {
  const selectedTask = resolveDirectCompletionTask(args.task, args.context);
  if (!selectedTask?.task_id) {
    throw new Error('No incomplete task found');
  }

  const athleteId = String(args.task.contact_id || args.context?.task.contact_id || '').trim();
  const athleteMainId = String(
    args.context?.resolved.athlete_main_id || args.task.athlete_main_id || '',
  ).trim();
  if (!athleteId || !athleteMainId) {
    throw new Error('Missing task IDs');
  }

  const taskTitle = getTaskDisplayTitle(selectedTask);
  await completeScoutPrepTaskAfterVoicemail({
    athleteId,
    athleteMainId,
    athleteName:
      args.context?.contactInfo.studentAthlete.name || args.task.athlete_name || athleteId,
    contactTask: athleteId,
    taskId: selectedTask.task_id,
    taskTitle,
    assignedOwner: selectedTask.assigned_owner || args.task.assigned_owner,
    description: selectedTask.description || taskTitle,
  });

  return selectedTask;
}

async function completeSentTextTask(args: {
  context: ScoutPrepContext;
  task: ScoutPortalTask;
  variant: VoicemailFollowUpVariant;
}): Promise<void> {
  const matchedTask = resolveVoicemailLifecycleTaskForCompletion(args.context.tasks, args.variant);
  const taskLabel = getVoicemailLifecycleTaskTitle(args.variant) || args.variant;
  if (!matchedTask?.task_id) {
    throw new Error(`Missing task list item for ${taskLabel}`);
  }

  const mustHavePreviousMeeting = args.requirePreviousMeeting !== false;
  const athleteId = String(args.task.contact_id || args.context.task.contact_id || '').trim();
  const athleteMainId = String(
    args.context.resolved.athlete_main_id || args.task.athlete_main_id || '',
  ).trim();
  if (!athleteId || !athleteMainId) {
    throw new Error('Missing athlete identifiers for sent-text completion');
  }

  await completeScoutPrepTaskAfterVoicemail({
    athleteId,
    athleteMainId,
    athleteName: args.context.contactInfo.studentAthlete.name || args.task.athlete_name,
    contactTask: args.task.contact_id,
    taskId: matchedTask.task_id,
    crmStage: getVoicemailLifecycleStageLabel(args.variant),
    taskTitle: getTaskDisplayTitle(matchedTask),
    assignedOwner: matchedTask.assigned_owner,
    description: matchedTask.description || getTaskDisplayTitle(matchedTask),
  });
}

function SupabaseLifecycleStatusAction() {
  return (
    <Action.Push
      title="Supabase Lifecycle Status"
      icon="💾"
      shortcut={{ modifiers: ['cmd', 'opt'], key: 's' }}
      target={<SupabaseLifecycleStatusCommand />}
    />
  );
}

function buildDailyCallBlockTaskCounts(tasks: ScoutPortalTask[]): TaskCounts {
  return {
    touch1Count: tasks.filter(isCallAttempt1PortalTask).length,
    remainingTaskCount: tasks.length,
  };
}

function getDailyCallBlocksActionTitle(counts: TaskCounts): string {
  return `Daily Call Blocks (${counts.touch1Count} T1 / ${counts.remainingTaskCount})`;
}

function buildTaskSearchKeywords(
  task: ScoutPortalTask,
  extraValues: Array<string | null | undefined> = [],
) {
  return [
    task.athlete_name,
    task.title,
    task.description,
    task.due_date,
    task.grad_year,
    task.contact_id,
    task.athlete_main_id,
    ...extraValues,
  ].filter((value): value is string => Boolean(value && value.trim()));
}

async function recordVoicemailFollowUpSentBestEffort(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  taskTitle: string;
  previousCrmStage?: string | null;
  previousTaskStatus?: string | null;
  crmStage: string;
  taskStatus: VoicemailFollowUpVariant;
}) {
  try {
    await recordVoicemailFollowUpSent({
      athleteId: args.athleteId,
      athleteMainId: args.athleteMainId,
      athleteName: args.athleteName,
      previousCrmStage: args.previousCrmStage,
      previousTaskStatus: args.previousTaskStatus,
      crmStage: args.crmStage,
      taskStatus: args.taskStatus,
      currentTaskId: args.taskId,
      currentTaskTitle: args.taskTitle,
      messageVariant: args.taskStatus,
    });
  } catch (error) {
    logFailure(
      'SCOUT_PREP_VOICEMAIL_SENT_SYNC',
      'supabase-write',
      error instanceof Error ? error.message : String(error),
      {
        contactId: args.athleteId,
        athleteMainId: args.athleteMainId,
        taskId: args.taskId,
      },
    );
  }
}

async function persistVoicemailFollowUpMessageSent(args: {
  context: ScoutPrepContext;
  task: ScoutPortalTask;
  variant: VoicemailFollowUpVariant;
  previousCrmStage?: string | null;
  previousTaskStatus?: string | null;
}) {
  if (
    args.variant === 'send_cal_link' ||
    args.variant === 'parent_contact_intro' ||
    args.variant === 'propose_times' ||
    isTaskOnlyVoicemailVariant(args.variant)
  ) {
    return;
  }

  const followUpTask = resolveVoicemailLifecycleTaskForCompletion(args.context.tasks, args.variant);
  const taskLabel = getVoicemailLifecycleTaskTitle(args.variant) || args.variant;
  if (!followUpTask?.task_id) {
    throw new Error(`Missing task list item for ${taskLabel}`);
  }

  const athleteId = String(args.task.contact_id || args.context.task.contact_id || '').trim();
  const athleteMainId = String(
    args.context.resolved.athlete_main_id || args.task.athlete_main_id || '',
  ).trim();
  if (!athleteId || !athleteMainId) {
    throw new Error('Missing athlete identifiers for voicemail follow-up');
  }

  const athleteName =
    args.context.contactInfo.studentAthlete.name || args.task.athlete_name || athleteId;
  const taskTitle = stripMoveThisTaskPrefix(followUpTask.title) || args.variant;
  const result = await recordVoicemailFollowUpMessageSent({
    athleteId,
    athleteMainId,
    athleteName,
    taskId: followUpTask.task_id,
    variant: args.variant,
    taskTitle: taskTitle || undefined,
    description: followUpTask.description || undefined,
  });

  await recordVoicemailFollowUpSentBestEffort({
    athleteId,
    athleteMainId,
    athleteName,
    taskId: followUpTask.task_id,
    taskTitle,
    previousCrmStage: args.previousCrmStage,
    previousTaskStatus: args.previousTaskStatus,
    crmStage: result.stage || getVoicemailLifecycleStageLabel(args.variant) || args.variant,
    taskStatus: args.variant,
  });
}

function buildFallbackMeetingDetails(): string {
  return [
    'Main Number:',
    'Backup Number:',
    'Spoke To:',
    'Other Parent:',
    '',
    'About The Athlete:',
    '',
    'Deficit:',
    '',
    'Other Details:',
  ].join('\n');
}

function buildFallbackMeetingTemplate(
  selectedTimezone: string = 'EST',
): MeetingSetTemplateResponse {
  return {
    success: true,
    meeting_name: '',
    selected_recruit_timezone: selectedTimezone,
    recruit_timezone_options: ['AST', 'EST', 'CST', 'MST', 'PST', 'AKST', 'HST'].map((zone) => ({
      value: zone,
      label: zone,
      selected: zone === selectedTimezone,
    })),
    details_template: buildFallbackMeetingDetails(),
  };
}

function buildScoutPrepAdminUrl(task: ScoutPortalTask, athleteMainId?: string | null): string {
  const resolvedAthleteMainId = String(athleteMainId || task.athlete_main_id || '').trim();
  return buildReminderAdminUrl(String(task.contact_id || '').trim(), resolvedAthleteMainId);
}

function buildScoutPrepTaskUrl(task: ScoutPortalTask, athleteMainId?: string | null): string {
  const url = new URL(buildScoutPrepAdminUrl(task, athleteMainId));
  url.searchParams.set('tasktab', '1');
  return url.toString();
}

function buildScoutPrepPlayerIdUrl(task: ScoutPortalTask, athleteId?: string | null): string {
  const resolvedAthleteId = String(athleteId || task.contact_id || '').trim();
  return `${DASHBOARD_BASE_URL}/athlete/profile/${encodeURIComponent(resolvedAthleteId)}`;
}

function buildScoutPrepContactMarkdown(context: ScoutPrepContext | null): string {
  if (!context) {
    return '# Loading...';
  }

  const { contactInfo } = context;
  const lines = ['# Contact Information', ''];

  if (contactInfo.parent1) {
    lines.push(
      `## 📲 ${contactInfo.parent1.name} (${contactInfo.parent1.relationship})`,
      `Phone: ${contactInfo.parent1.phone || 'N/A'}`,
      '',
    );
  }

  lines.push(
    `## ☎️ ${contactInfo.studentAthlete.name || context.task.athlete_name}`,
    `Phone: ${contactInfo.studentAthlete.phone || 'N/A'}`,
    '',
  );

  if (contactInfo.parent2) {
    lines.push(
      `## 📳 ${contactInfo.parent2.name} (${contactInfo.parent2.relationship})`,
      `Phone: ${contactInfo.parent2.phone || 'N/A'}`,
      '',
    );
  }

  return lines.join('\n');
}

type ProspectContactCreateResult = {
  status: 'created' | 'updated' | 'exists';
  groupName: string | null;
};

type ProspectContactBatchSummary = {
  results: Array<
    ProspectContactCreateResult & {
      candidate: ProspectContactShortcutCandidate;
    }
  >;
  createdCount: number;
  updatedCount: number;
  existingCount: number;
  groupNames: string[];
};

function prospectContactRoleLabel(candidate: ProspectContactShortcutCandidate): string {
  if (candidate.id === 'studentAthlete') {
    return 'SA';
  }
  if (candidate.id === 'parent1') {
    return 'P1';
  }
  if (candidate.id === 'parent2') {
    return 'P2';
  }
  return candidate.label;
}

function formatProspectContactRoles(candidates: ProspectContactShortcutCandidate[]): string {
  const roleOrder = ['studentAthlete', 'parent1', 'parent2'];
  return candidates
    .slice()
    .sort((left, right) => roleOrder.indexOf(left.id) - roleOrder.indexOf(right.id))
    .map(prospectContactRoleLabel)
    .join(' + ');
}

async function createProspectContactsBatch(
  candidates: ProspectContactShortcutCandidate[],
  adminUrl: string,
  contactNote: string,
): Promise<ProspectContactBatchSummary> {
  if (!candidates.length) {
    throw new Error('No eligible contacts found');
  }

  const uniqueCandidates = Array.from(
    new Map(
      candidates.map((candidate) => [
        `${candidate.phone}|${candidate.name.toLowerCase()}`,
        candidate,
      ]),
    ).values(),
  );
  const args = uniqueCandidates.flatMap((candidate) => {
    const payload = buildProspectContactShortcutPayloadFromName({
      fullName: candidate.name,
      phone: candidate.phone,
    });
    const [firstName, lastName, phone] = payload.split('\n');
    return [firstName || '', lastName || '', phone || ''];
  });

  const savedContacts = await saveProspectContacts(
    args.filter((_, index) => index % 3 === 0),
    args.filter((_, index) => index % 3 === 1),
    args.filter((_, index) => index % 3 === 2),
    uniqueCandidates.map(() => adminUrl),
    uniqueCandidates.map(() => contactNote),
  );

  const candidateByKey = new Map(
    uniqueCandidates.map((candidate) => [`${candidate.name}|${candidate.phone}`, candidate]),
  );
  const results = savedContacts
    .map((savedContact) => {
      const candidate =
        candidateByKey.get(`${savedContact.name}|${savedContact.phone}`) ||
        uniqueCandidates.find((item) => item.phone === savedContact.phone);
      if (!candidate) {
        return null;
      }
      return {
        candidate,
        status: savedContact.status,
        groupName: savedContact.groupName,
      };
    })
    .filter(
      (
        value,
      ): value is ProspectContactCreateResult & { candidate: ProspectContactShortcutCandidate } =>
        Boolean(value),
    );

  const groupNames = Array.from(
    new Set(
      results.map((result) => result.groupName).filter((value): value is string => Boolean(value)),
    ),
  );

  return {
    results,
    createdCount: results.filter((result) => result.status === 'created').length,
    updatedCount: results.filter((result) => result.status === 'updated').length,
    existingCount: results.filter((result) => result.status === 'exists').length,
    groupNames,
  };
}

async function openMessagesDraftForRecipients(phones: string[], body: string): Promise<'url'> {
  const uniquePhones = Array.from(
    new Set(
      phones
        .map((phone) => normalizePhoneForMessages(phone))
        .filter((phone): phone is string => Boolean(phone)),
    ),
  );

  if (!uniquePhones.length) {
    throw new Error('At least one valid phone number is required');
  }

  await open(buildMessagesComposeUrlForRecipients(uniquePhones, body));
  return 'url';
}

function ScoutPrepContactDetail({
  task,
  initialContext,
}: {
  task: ScoutPortalTask;
  initialContext?: ScoutPrepContext | null;
}) {
  const [context, setContext] = useState<ScoutPrepContext | null>(initialContext || null);
  const [isLoading, setIsLoading] = useState(!initialContext);
  const [isCreatingContact, setIsCreatingContact] = useState(false);

  async function loadContactInfo(options?: { showToast?: boolean }) {
    const refreshToast = options?.showToast
      ? await showLoadingToast('Refreshing', task.athlete_name)
      : null;
    setIsLoading(true);
    try {
      const loadedContext = await loadScoutPrepContext(task);
      setContext(loadedContext);
      refreshToast?.hide();
    } catch (error) {
      if (refreshToast) {
        refreshToast.style = Toast.Style.Failure;
        refreshToast.title = 'Contact load failed';
        refreshToast.message = error instanceof Error ? error.message : 'Unknown error';
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Contact load failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!initialContext) {
      void loadContactInfo();
    }
  }, [task.contact_id]);

  async function handleCreateAllProspectContacts() {
    if (!contactCandidates.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No contact ready',
        message: 'Need full name + phone.',
      });
      return;
    }

    const roleLabel = formatProspectContactRoles(contactCandidates);
    setIsCreatingContact(true);
    const toast = await showLoadingToast('Create all contacts', roleLabel);
    try {
      const summary = await createProspectContactsBatch(
        contactCandidates,
        buildScoutPrepAdminUrl(
          task,
          context.resolved.athlete_main_id || context.task.athlete_main_id,
        ),
        buildProspectContactAdminNote(context),
      );
      toast.style = Toast.Style.Success;
      toast.title = 'Contacts ready';

      const detailParts = [
        roleLabel,
        summary.createdCount ? `${summary.createdCount} created` : null,
        summary.updatedCount ? `${summary.updatedCount} updated` : null,
        summary.existingCount ? `${summary.existingCount} existing` : null,
      ].filter(Boolean);

      toast.message = detailParts.join(' • ');
    } catch (error) {
      const failureToast = resolveProspectContactCreateFailureToast(error);
      toast.style = failureToast.duplicateLike ? Toast.Style.Success : Toast.Style.Failure;
      toast.title = failureToast.title;
      toast.message = failureToast.message;
    } finally {
      setIsCreatingContact(false);
    }
  }

  const contactInfo = context?.contactInfo;
  const contactCandidates = context
    ? getProspectContactShortcutCandidates(context).sort(
        (left, right) =>
          ['parent1', 'studentAthlete', 'parent2'].indexOf(left.id) -
          ['parent1', 'studentAthlete', 'parent2'].indexOf(right.id),
      )
    : [];

  return (
    <Detail
      navigationTitle={`Contact Info • ${task.athlete_name}`}
      markdown={buildScoutPrepContactMarkdown(context)}
      isLoading={isLoading || isCreatingContact}
      actions={
        <ActionPanel>
          {contactInfo?.parent1 ? (
            <ActionPanel.Section title={`Parent 1 (${contactInfo.parent1.relationship})`}>
              {contactInfo.parent1.phone ? (
                <Action
                  title="Copy Parent 1 Phone"
                  icon="📲"
                  onAction={() =>
                    void copyToClipboardWithToast(contactInfo.parent1.phone || '', 'P1')
                  }
                />
              ) : null}
            </ActionPanel.Section>
          ) : null}
          <ActionPanel.Section title="Student Athlete">
            {contactInfo?.studentAthlete.phone ? (
              <Action
                title="Copy Student Athlete Phone"
                icon="☎️"
                shortcut={{ modifiers: ['cmd'], key: 'return' }}
                onAction={() =>
                  void copyToClipboardWithToast(contactInfo.studentAthlete.phone || '', 'SA')
                }
              />
            ) : null}
          </ActionPanel.Section>
          {contactInfo?.parent2 ? (
            <ActionPanel.Section title={`Parent 2 (${contactInfo.parent2.relationship})`}>
              {contactInfo.parent2.phone ? (
                <Action
                  title="Copy Parent 2 Phone"
                  icon="📳"
                  shortcut={{ modifiers: ['cmd'], key: 's' }}
                  onAction={() =>
                    void copyToClipboardWithToast(contactInfo.parent2.phone || '', 'P2')
                  }
                />
              ) : null}
            </ActionPanel.Section>
          ) : null}
          <ActionPanel.Section>
            {contactCandidates.length ? (
              <Action
                title="Create All Contacts"
                icon="👤"
                shortcut={{ modifiers: ['cmd'], key: '1' }}
                onAction={() => void handleCreateAllProspectContacts()}
              />
            ) : null}
            <Action
              title="Refresh Contact Info"
              icon="🔄"
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
              onAction={() => void loadContactInfo({ showToast: true })}
            />
            <Action.OpenInBrowser
              title="Open Contact Info on Admin"
              icon="🌏"
              url={buildScoutPrepAdminUrl(
                task,
                context?.resolved.athlete_main_id || context?.task.athlete_main_id,
              )}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'o' }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

type VoicemailFollowUpFormValues = {
  recipientId?: string;
  variant?: VoicemailFollowUpVariant;
};

type MessageContactOption = {
  id: string;
  label: string;
  name: string;
  phone: string;
};

function SingleRecipientMessageForm({
  title,
  recipientName,
  phone,
  contactOptions,
  defaultContactId,
  initialMessage,
  searchAllContactsOnly = false,
  onMessageSent,
  onMessageSentLabel,
  onMessageSentToastTitle,
  onMessageSentFailureTitle,
  onMessageSentComplete,
}: {
  title: string;
  recipientName: string;
  phone: string;
  contactOptions?: MessageContactOption[];
  defaultContactId?: string;
  initialMessage: string;
  searchAllContactsOnly?: boolean;
  onMessageSent?: () => Promise<void>;
  onMessageSentLabel?: string;
  onMessageSentToastTitle?: string;
  onMessageSentFailureTitle?: string;
  onMessageSentComplete?: () => Promise<void> | void;
}) {
  const fallbackContact = useMemo(
    () => ({
      id: 'default',
      label: recipientName,
      name: recipientName,
      phone,
    }),
    [phone, recipientName],
  );
  const messageContacts = useMemo(() => {
    if (searchAllContactsOnly) return [];
    return contactOptions?.length ? contactOptions : [fallbackContact];
  }, [contactOptions, fallbackContact, searchAllContactsOnly]);
  const initialContactId =
    defaultContactId && messageContacts.some((contact) => contact.id === defaultContactId)
      ? defaultContactId
      : messageContacts[0]?.id || '';
  const [contactId, setContactId] = useState(initialContactId);
  const [message, setMessage] = useState(initialMessage);
  const [searchText, setSearchText] = useState('');
  const [searchedContacts, setSearchedContacts] = useState<MessageContactOption[]>([]);
  const [isSearchingContacts, setIsSearchingContacts] = useState(false);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    const query = searchText.trim();
    if (query.length < 2) {
      setIsSearchingContacts(false);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    setIsSearchingContacts(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const contacts = await searchContacts(query, 20);
          if (requestId !== searchRequestIdRef.current) return;
          const existingPhones = new Set(messageContacts.map((contact) => contact.phone));
          const nextContacts: MessageContactOption[] = [];
          const seenPhones = new Set<string>();

          for (const contact of contacts) {
            const name = [contact.givenName, contact.familyName].filter(Boolean).join(' ').trim();
            for (const phone of contact.phoneNumbers || []) {
              const normalizedPhone = normalizePhoneForMessages(phone.number);
              if (
                !normalizedPhone ||
                existingPhones.has(normalizedPhone) ||
                seenPhones.has(normalizedPhone)
              ) {
                continue;
              }
              seenPhones.add(normalizedPhone);
              nextContacts.push({
                id: `contact:${contact.id}:${normalizedPhone}`,
                label: name || 'Contact',
                name: name || 'Contact',
                phone: normalizedPhone,
              });
            }
          }

          setSearchedContacts(nextContacts);
        } catch (error) {
          if (requestId !== searchRequestIdRef.current) return;
          setSearchedContacts([]);
        } finally {
          if (requestId === searchRequestIdRef.current) {
            setIsSearchingContacts(false);
          }
        }
      })();
    }, 250);

    return () => clearTimeout(timer);
  }, [messageContacts, searchText]);

  const contactChoices = searchedContacts.length
    ? [...messageContacts, ...searchedContacts]
    : messageContacts;

  function handleContactChange(value: string) {
    setContactId(value);
    const selectedContact = [...messageContacts, ...searchedContacts].find(
      (contact) => contact.id === value,
    );
    if (selectedContact?.name && message.includes('[ParentFirst]')) {
      setMessage(
        message.replace(
          /\[ParentFirst\]/g,
          firstWord(selectedContact.name) || selectedContact.name,
        ),
      );
    }
  }

  async function handleSubmit() {
    try {
      const selectedContact = [...messageContacts, ...searchedContacts].find(
        (contact) => contact.id === contactId,
      );
      if (!selectedContact?.phone) {
        throw new Error('Search and select a contact first.');
      }
      await sendVerifiedClientMessage({
        address: selectedContact.phone,
        text: message,
        serviceName: 'iMessage',
      });

      if (onMessageSent) {
        const toast = await showLoadingToast(
          onMessageSentToastTitle || 'Saving',
          onMessageSentLabel || 'Follow-up',
        );
        try {
          await onMessageSent();
          toast.hide();
        } catch (error) {
          toast.style = Toast.Style.Failure;
          toast.title = onMessageSentFailureTitle || 'Sent, save failed';
          toast.message = error instanceof Error ? error.message : String(error);
          return;
        }
      }

      if (onMessageSentComplete) {
        await onMessageSentComplete();
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: 'Sent',
          message: selectedContact.name,
        });
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Message not sent',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Message" icon="💬" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="contactId"
        title={searchAllContactsOnly ? 'Search Contacts' : 'Client'}
        value={contactId}
        onChange={handleContactChange}
        filtering
        isLoading={isSearchingContacts}
        onSearchTextChange={setSearchText}
      >
        {contactChoices.map((contact) => (
          <Form.Dropdown.Item
            key={contact.id}
            value={contact.id}
            title={`${contact.label} • ${contact.phone}`}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea id="message" title="Message" value={message} onChange={setMessage} />
    </Form>
  );
}

type ScoutPrepParentOption = {
  id: 'parent1' | 'parent2';
  name: string;
};

type ScoutPrepTranslateNameOption = {
  id: 'studentAthlete' | 'parent1' | 'parent2';
  label: string;
  name: string;
};

const RAYCAST_TRANSLATE_DEEPLINK = 'raycast://extensions/raycast/translator/translate';

function getScoutPrepParentOptions(context: ScoutPrepContext) {
  return [
    context.contactInfo.parent1?.name
      ? { id: 'parent1' as const, name: context.contactInfo.parent1.name }
      : null,
    context.contactInfo.parent2?.name
      ? { id: 'parent2' as const, name: context.contactInfo.parent2.name }
      : null,
  ].filter(Boolean) as ScoutPrepParentOption[];
}

function getScoutPrepTranslateNameOptions(
  context: ScoutPrepContext,
): ScoutPrepTranslateNameOption[] {
  return [
    context.contactInfo.studentAthlete.name
      ? {
          id: 'studentAthlete' as const,
          label: 'Student Athlete',
          name: context.contactInfo.studentAthlete.name,
        }
      : null,
    context.contactInfo.parent1?.name
      ? { id: 'parent1' as const, label: 'Parent 1', name: context.contactInfo.parent1.name }
      : null,
    context.contactInfo.parent2?.name
      ? { id: 'parent2' as const, label: 'Parent 2', name: context.contactInfo.parent2.name }
      : null,
  ].filter(Boolean) as ScoutPrepTranslateNameOption[];
}

async function openRaycastTranslateWithText(text: string) {
  const value = text.trim().split(/\s+/)[0] || '';
  if (!value) {
    throw new Error('No text selected');
  }

  await Clipboard.copy(value);
  const url = new URL(RAYCAST_TRANSLATE_DEEPLINK);
  url.searchParams.set('fallbackText', value);
  await open(url.toString());
}

function ScoutPrepTranslateNameForm({
  options,
  defaultOptionId,
}: {
  options: ScoutPrepTranslateNameOption[];
  defaultOptionId?: ScoutPrepTranslateNameOption['id'];
}) {
  const [selectedOptionId, setSelectedOptionId] = useState(defaultOptionId || options[0]?.id || '');

  async function handleSubmit() {
    const selected = options.find((option) => option.id === selectedOptionId) || options[0] || null;
    if (!selected) {
      await showToast({ style: Toast.Style.Failure, title: 'No contact' });
      return;
    }

    try {
      await openRaycastTranslateWithText(selected.name);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Translate failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Form
      navigationTitle="Translate Name"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Open Translate"
            icon="🌐"
            onSubmit={() => void handleSubmit()}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="contactName"
        title="Contact"
        value={selectedOptionId}
        onChange={setSelectedOptionId}
      >
        {options.map((option) => (
          <Form.Dropdown.Item
            key={option.id}
            value={option.id}
            title={`${option.label}: ${option.name}`}
          />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function buildMessageContactOptions(
  recipients: ReturnType<typeof getVoicemailFollowUpRecipients>,
): MessageContactOption[] {
  const seenPhones = new Set<string>();
  const options: MessageContactOption[] = [];

  for (const recipient of recipients) {
    if (recipient.id === 'groupAll') continue;
    for (const phone of recipient.phones) {
      const normalizedPhone = normalizePhoneForMessages(phone);
      if (!normalizedPhone || seenPhones.has(normalizedPhone)) continue;
      seenPhones.add(normalizedPhone);
      options.push({
        id: `${recipient.id}:${normalizedPhone}`,
        label: recipient.label || recipient.name,
        name: recipient.name,
        phone: normalizedPhone,
      });
    }
  }

  return options;
}

type RescheduleVoicemailSlotOption = {
  id: string;
  title: string;
  subtitle?: string | null;
  scoutName: string;
  messageLabel: string;
  isPreviousScout: boolean;
  dateLabel: string;
  timeLabel: string;
  zoneLabel: string;
  weekLabel: string;
  start: string;
};

function normalizeNameKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^coach\s+/i, '')
    .replace(/\s+/g, ' ');
}

const RESCHEDULE_TIME_TAG_COLORS = [
  Color.Blue,
  Color.Green,
  Color.Orange,
  Color.Purple,
  Color.Red,
  Color.Magenta,
  Color.Yellow,
];

function rescheduleTimeTagColorFor(value?: string | null): Color {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const timeKey = normalized.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/)?.[0] || normalized;
  const total = timeKey.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return RESCHEDULE_TIME_TAG_COLORS[total % RESCHEDULE_TIME_TAG_COLORS.length];
}

function buildPreviousMeetingTextForReschedule(
  resolved: ResolvedBookedMeetingDetails | null,
  context: ScoutPrepContext,
): string | null {
  const meeting = resolved?.bookedMeeting;
  if (!meeting) {
    return null;
  }

  const athleteTimezone =
    resolved.meetingTimezone || resolveTimezone(context.resolved.city, context.resolved.state);
  if (!athleteTimezone) {
    throw new Error('Missing client timezone for Reschedule Pending');
  }
  const slotLabel =
    meeting.start && meeting.end
      ? formatHeadScoutNaturalSlotLabel(meeting.start, meeting.end, athleteTimezone).messageLabel
      : String(meeting.date_time_label || '').trim();
  const scoutName = String(meeting.assigned_owner || '').trim();

  return [slotLabel, scoutName].filter(Boolean).join(' • ') || null;
}

function isRescheduleVoicemailVariant(variant?: VoicemailFollowUpVariant | null): boolean {
  return variant === 'reschedule_1' || variant === 'reschedule_2';
}

function usesHeadScoutSlotPicker(variant?: VoicemailFollowUpVariant | null): boolean {
  return isRescheduleVoicemailVariant(variant) || variant === 'propose_times';
}

function isTaskOnlyVoicemailVariant(variant?: VoicemailFollowUpVariant | null): boolean {
  return variant === 'no_show' || isRescheduleVoicemailVariant(variant);
}

type ReminderRecipientFormValues = {
  recipientId?: string;
};

function ReminderRecipientForm({
  navigationTitle,
  options,
  defaultRecipientId,
  actionTitle,
  mode,
  onSubmit,
}: {
  navigationTitle: string;
  options: ReminderContactOption[];
  defaultRecipientId?: string;
  actionTitle: string;
  mode: ReminderMode;
  onSubmit: (values: ReminderRecipientFormValues & { remindAt?: Date }) => Promise<void>;
}) {
  const [recipientId, setRecipientId] = useState(defaultRecipientId || options[0]?.id);
  const [remindAt, setRemindAt] = useState<Date | null>(buildDefaultReminderDate());

  return (
    <Form
      navigationTitle={navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={actionTitle}
            icon="🔔"
            onSubmit={() => onSubmit({ recipientId, remindAt: remindAt ?? undefined })}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="recipientId" title="Contact" value={recipientId} onChange={setRecipientId}>
        {options.map((option) => (
          <Form.Dropdown.Item
            key={option.id}
            value={option.id}
            title={`${option.label}: ${option.name}`}
          />
        ))}
      </Form.Dropdown>
      <Form.DatePicker
        id="remindAt"
        title={mode === 'call' ? 'Call Time' : 'Text Time'}
        type={Form.DatePicker.Type.DateTime}
        value={remindAt}
        onChange={setRemindAt}
      />
    </Form>
  );
}

async function getSelectedCrmStageLabel(athleteId?: string | null): Promise<string | null> {
  const normalizedAthleteId = String(athleteId || '').trim();
  if (!normalizedAthleteId) {
    return null;
  }
  const stageOptions = await fetchCuratedSalesStageOptions(normalizedAthleteId).catch(() => []);
  return (
    stageOptions.find((option) => option.selected)?.label ||
    stageOptions.find((option) => option.selected)?.value ||
    null
  );
}

function RescheduleSlotSelectionList({
  task,
  context,
  requirePreviousMeeting = true,
  onSlotsSelected,
}: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  requirePreviousMeeting?: boolean;
  onSlotsSelected: (slots: RescheduleVoicemailSlotOption[]) => Promise<void> | void;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previousHeadScoutName, setPreviousHeadScoutName] = useState<string | null>(
    String(context.resolved.head_scout || '').trim() || null,
  );
  const [slotOptions, setSlotOptions] = useState<RescheduleVoicemailSlotOption[]>([]);
  const [suggestedSlots, setSuggestedSlots] = useState<RescheduleVoicemailSlotOption[]>([]);
  const [slot1, setSlot1] = useState<RescheduleVoicemailSlotOption | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekLabel, setWeekLabel] = useState<string | null>(null);
  const [previousMeetingText, setPreviousMeetingText] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const athleteId = String(task.contact_id || context.task.contact_id || '').trim();
    const athleteMainId = String(
      context.resolved.athlete_main_id || task.athlete_main_id || '',
    ).trim();
    async function loadSlots() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        if (requirePreviousMeeting && (!athleteId || !athleteMainId)) {
          throw new Error('Missing athlete IDs for Reschedule Pending');
        }
        const plan = await buildRankedRescheduleSlotPlan({
          task,
          context,
          requirePreviousMeeting,
          weekOffsets: weekOffset > 0 ? [weekOffset] : [0, 1],
        });
        if (!isMounted) return;

        setPreviousHeadScoutName(plan.previousHeadScoutName);
        setPreviousMeetingText(plan.previousMeetingText);
        setSlotOptions(plan.slots);
        setSuggestedSlots(plan.suggestedSlots);
        setWeekLabel(plan.weekLabel);
      } catch (error) {
        if (!isMounted) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setPreviousMeetingText(null);
        setSlotOptions([]);
        setSuggestedSlots([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSlots();
    return () => {
      isMounted = false;
    };
  }, [context, reloadKey, task, weekOffset]);

  const navigationTitle = slot1
    ? `Pick Slot 2 • ${task.athlete_name}`
    : `Pick Slot 1 • ${task.athlete_name}`;
  const sectionTitle = slot1
    ? `Slot 1: ${slot1.messageLabel}`
    : previousHeadScoutName
      ? `${previousHeadScoutName} first`
      : 'Openings';
  const sectionSubtitle = [
    weekLabel,
    previousMeetingText ? `Previous: ${previousMeetingText}` : null,
  ]
    .filter(Boolean)
    .join(' • ');
  const canGoBack = weekOffset > 0;
  const suggestedIds = new Set(suggestedSlots.map((slot) => slot.id));
  const suggestedSlotNumberById = new Map(
    suggestedSlots.slice(0, 2).map((slot, index) => [slot.id, index + 1]),
  );

  function getSlotIcon(slot: RescheduleVoicemailSlotOption): string {
    const suggestedNumber = suggestedSlotNumberById.get(slot.id);
    if (suggestedNumber === 1) return '1️⃣';
    if (suggestedNumber === 2) return '2️⃣';
    return slot.isPreviousScout ? '⭐' : '🗓️';
  }

  function showPreviousWeek() {
    if (!canGoBack) return;
    setSlot1(null);
    setWeekOffset((value) => Math.max(0, value - 1));
  }

  function showNextWeek() {
    setSlot1(null);
    setWeekOffset((value) => value + 1);
  }

  function selectSuggestedSlots() {
    if (suggestedSlots.length < 2) return;
    void onSlotsSelected(suggestedSlots.slice(0, 2));
  }

  function selectSlotsManually() {
    setSuggestedSlots([]);
    setSlot1(null);
  }

  const weekActions = (
    <>
      <Action
        title="Next Week"
        icon="➡️"
        shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
        onAction={showNextWeek}
      />
      {canGoBack ? (
        <Action
          title="This Week"
          icon="⬅️"
          shortcut={{ modifiers: ['cmd', 'shift'], key: 'arrowLeft' }}
          onAction={showPreviousWeek}
        />
      ) : null}
    </>
  );

  return (
    <List
      navigationTitle={navigationTitle}
      isLoading={isLoading}
      searchBarPlaceholder="Filter openings"
    >
      {!slot1 && suggestedSlots.length >= 2 ? (
        <List.Section
          title="Suggested Slots"
          subtitle={previousHeadScoutName ? `${previousHeadScoutName} prioritized` : undefined}
        >
          <List.Item
            icon={Icon.Star}
            title="Use Suggested Slots"
            subtitle={suggestedSlots.map((slot) => slot.messageLabel).join(' • ')}
            accessories={
              previousHeadScoutName
                ? [{ tag: { value: previousHeadScoutName, color: Color.Green } }]
                : []
            }
            actions={
              <ActionPanel>
                <Action
                  title="Use Suggested Slots"
                  icon={Icon.CheckCircle}
                  onAction={selectSuggestedSlots}
                />
                <Action title="Select New Slots" icon={Icon.List} onAction={selectSlotsManually} />
                <Action
                  title="Refresh Openings"
                  icon="🔄"
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={() => setReloadKey((value) => value + 1)}
                />
                {weekActions}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      <List.Section title={sectionTitle} subtitle={sectionSubtitle || undefined}>
        {slotOptions.map((slot, index) => (
          <List.Item
            key={`${slot.id}:${index}`}
            icon={getSlotIcon(slot)}
            title={`${index + 1}. ${slot.dateLabel}`}
            subtitle={slot.scoutName}
            keywords={[slot.scoutName, slot.messageLabel]}
            accessories={[
              ...(suggestedIds.has(slot.id)
                ? [{ tag: { value: 'Suggested', color: Color.Green } }]
                : []),
              { tag: { value: slot.timeLabel, color: rescheduleTimeTagColorFor(slot.timeLabel) } },
            ]}
            actions={
              <ActionPanel>
                {!slot1 && suggestedSlots.length >= 2 ? (
                  <Action
                    title="Use Suggested Slots"
                    icon={Icon.CheckCircle}
                    onAction={selectSuggestedSlots}
                  />
                ) : null}
                {!slot1 ? (
                  <Action title="Use as Slot 1" icon="1️⃣" onAction={() => setSlot1(slot)} />
                ) : (
                  <Action
                    title="Use as Slot 2"
                    icon="2️⃣"
                    onAction={() => void onSlotsSelected([slot1, slot])}
                  />
                )}
                {slot1 ? (
                  <Action title="Change Slot 1" icon="↩️" onAction={() => setSlot1(null)} />
                ) : null}
                <Action
                  title="Refresh Openings"
                  icon="🔄"
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={() => setReloadKey((value) => value + 1)}
                />
                {weekActions}
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      {!isLoading && !slotOptions.length ? (
        <List.EmptyView
          title="No openings"
          description={errorMessage || `No openings found${weekLabel ? ` for ${weekLabel}` : ''}.`}
          actions={
            <ActionPanel>
              <Action
                title="Refresh Openings"
                icon="🔄"
                onAction={() => setReloadKey((value) => value + 1)}
              />
              {weekActions}
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}

export function VoicemailFollowUpRecipientForm({
  task,
  context,
  currentTask,
  onComplete,
  closeAfterCompleteViews = 1,
}: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  currentTask?: string | null;
  onComplete?: () => Promise<void> | void;
  closeAfterCompleteViews?: number;
}) {
  const { push, pop } = useNavigation();
  const recipients = getVoicemailFollowUpRecipients(context);
  const defaultVariant = resolveVoicemailFollowUpVariant({
    currentTask: currentTask || task.title || null,
  });
  const [previousMeetingText, setPreviousMeetingText] = useState<string | null>(null);
  const [isLoadingPreviousMeeting, setIsLoadingPreviousMeeting] = useState(false);

  useEffect(() => {
    let active = true;
    const athleteId = String(task.contact_id || context.task.contact_id || '').trim();
    const athleteMainId = String(
      context.resolved.athlete_main_id || task.athlete_main_id || '',
    ).trim();

    async function loadPreviousMeeting() {
      if (!athleteId || !athleteMainId) {
        setPreviousMeetingText(null);
        return;
      }

      setIsLoadingPreviousMeeting(true);
      try {
        const resolved = await resolveBookedMeetingDetailsForForm(
          {
            athleteId,
            athleteMainId,
            source: 'latest_appointment_truth',
          },
          {
            getCachedMeetingDescription: getCachedBookedMeetingDescription,
          },
        );
        if (!active) return;
        setPreviousMeetingText(buildPreviousMeetingTextForReschedule(resolved, context));
      } catch {
        if (!active) return;
        setPreviousMeetingText(null);
      } finally {
        if (active) {
          setIsLoadingPreviousMeeting(false);
        }
      }
    }

    void loadPreviousMeeting();
    return () => {
      active = false;
    };
  }, [context, task]);

  async function openMessagesForRecipient(
    recipient?: (typeof recipients)[number],
    variant?: VoicemailFollowUpVariant,
    selectedRescheduleSlots: RescheduleVoicemailSlotOption[] = [],
  ) {
    const selectedVariant = variant || defaultVariant;
    if (selectedVariant !== 'parent_contact_intro' && (!recipient || !recipient.phones.length)) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No message contact',
        message: 'No Messages-safe number yet.',
      });
      return;
    }

    async function finishFollowUpFlow(
      toastTitle: string,
      toastMessage?: string,
      extraChildViews = 0,
    ) {
      await completeScoutPrepMutationSuccess({
        title: toastTitle,
        message: toastMessage,
      });
      await popViewsThenRefreshRoot(pop, closeAfterCompleteViews + extraChildViews, onComplete);
    }

    if (selectedVariant === 'parent_contact_intro') {
      const body = buildVoicemailFollowUpBody(
        context,
        undefined,
        selectedVariant,
        null,
        currentTask || task.title || null,
      );

      push(
        <SingleRecipientMessageForm
          title={`Parent Intro • ${context.contactInfo.studentAthlete.name || task.athlete_name}`}
          recipientName="Parent"
          phone=""
          contactOptions={[]}
          initialMessage={body}
          searchAllContactsOnly
          onMessageSentComplete={async () => {
            await finishFollowUpFlow('Sent', 'No Laravel update', 1);
          }}
        />,
      );
      return;
    }

    const selectedParent =
      recipient?.id === 'parent2' ? context.contactInfo.parent2 : context.contactInfo.parent1;
    if (usesHeadScoutSlotPicker(selectedVariant) && selectedRescheduleSlots.length < 2) {
      push(
        <RescheduleSlotSelectionList
          task={task}
          context={context}
          requirePreviousMeeting={isRescheduleVoicemailVariant(selectedVariant)}
          onSlotsSelected={(slots) => openMessagesForRecipient(recipient, selectedVariant, slots)}
        />,
      );
      return;
    }

    const deterministicHonorific = resolveParentHonorificFromRelationship(
      selectedParent?.relationship,
    );
    const aiHonorific =
      !deterministicHonorific && recipient.id !== 'studentAthlete'
        ? await resolveParentHonorificWithRayAI({
            parentName: selectedParent?.name || recipient.name,
            relationship: selectedParent?.relationship || null,
          }).catch(() => null)
        : null;
    const athleteGender = await resolveAthleteGenderWithRayAI({
      athleteName: context.contactInfo.studentAthlete.name || task.athlete_name,
      sport: context.resolved.sport,
    }).catch(() => null);

    const body = buildVoicemailFollowUpBody(
      context,
      recipient?.id,
      selectedVariant,
      null,
      currentTask || task.title || null,
      undefined,
      deterministicHonorific || aiHonorific,
      athleteGender,
      usesHeadScoutSlotPicker(selectedVariant)
        ? {
            previousHeadScoutName:
              selectedRescheduleSlots[0]?.scoutName ||
              String(context.resolved.head_scout || '').trim() ||
              null,
            slots: selectedRescheduleSlots.map((slot) => slot.messageLabel),
            weekLabel: selectedRescheduleSlots[0]?.weekLabel || null,
          }
        : undefined,
    );

    logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'start', {
      contactId: context.task.contact_id,
      recipientId: recipient.id,
      recipientName: recipient.name,
      recipientCount: recipient.phones.length,
      variant: selectedVariant,
    });

    try {
      const mode = await openMessagesDraftForRecipients(recipient.phones, body);
      logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'success', {
        contactId: context.task.contact_id,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientCount: recipient.phones.length,
        mode,
        variant: selectedVariant,
      });
      try {
        if (isTaskOnlyVoicemailVariant(selectedVariant)) {
          await completeSentTextTask({
            context,
            task,
            variant: selectedVariant,
          });
        } else {
          await persistVoicemailFollowUpMessageSent({
            context,
            task,
            variant: selectedVariant,
            previousCrmStage: null,
            previousTaskStatus: currentTask || task.title || null,
          });
        }
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: isTaskOnlyVoicemailVariant(selectedVariant)
            ? 'Draft open, task not completed'
            : 'Draft open, save failed',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      await finishFollowUpFlow(
        isTaskOnlyVoicemailVariant(selectedVariant) ? 'Completed' : 'Sent',
        recipient.name,
        usesHeadScoutSlotPicker(selectedVariant) ? 1 : 0,
      );
    } catch (error) {
      await Clipboard.copy(body);
      await open(`sms:${recipient.phones[0]}`);
      logFailure(
        'SCOUT_PREP_MESSAGES_HANDOFF',
        'open-compose',
        error instanceof Error ? error.message : String(error),
        {
          contactId: context.task.contact_id,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientCount: recipient.phones.length,
          mode: 'clipboard-fallback',
          variant: selectedVariant,
        },
      );
      await completeScoutPrepMutationSuccess({
        title: 'Sent',
        message: 'Copied to clipboard.',
      });
      await popViewsThenRefreshRoot(pop, closeAfterCompleteViews, onComplete);
    }
  }

  async function handleSubmit(values: VoicemailFollowUpFormValues) {
    const recipient =
      recipients.find((candidate) => candidate.id === values.recipientId) || recipients[0];
    await openMessagesForRecipient(
      values.variant === 'parent_contact_intro' ? undefined : recipient,
      values.variant || defaultVariant,
    );
  }

  return (
    <ClientOutreachMessageForm
      navigationTitle={`Client Outreach • ${task.athlete_name}`}
      recipients={recipients}
      defaultRecipientId={recipients[0]?.id}
      defaultVariant={defaultVariant}
      previousMeetingText={
        isLoadingPreviousMeeting ? 'Loading...' : previousMeetingText || 'No booked meeting found'
      }
      onSubmit={async (values) =>
        handleSubmit({
          recipientId: values.recipientId,
          variant: values.variant,
        })
      }
    />
  );
}

type ViewMode = 'tasks' | 'prospect';

const DEFAULT_TASK_LIST_FILTER: TaskListFilter = 'todayPastDue';
const DEFAULT_TASK_LIST_SORT: TaskListSort = [
  { key: 'callAttempt', direction: 'asc' },
  { key: 'gradYear', direction: 'asc' },
];

function cycleTaskListSort(current: TaskListSort, key: TaskListSortKey): TaskListSort {
  const currentRules = !current ? [] : Array.isArray(current) ? current : [current];
  const existingIndex = currentRules.findIndex((rule) => rule.key === key);
  if (existingIndex === -1) {
    return [...currentRules, { key, direction: 'asc' }];
  }

  const existingRule = currentRules[existingIndex];
  if (existingRule.direction === 'asc') {
    return currentRules.map((rule, index) =>
      index === existingIndex ? { ...rule, direction: 'desc' } : rule,
    );
  }

  const nextRules = currentRules.filter((rule) => rule.key !== key);
  return nextRules.length ? nextRules : null;
}

function getSortActionTitle(sort: TaskListSort, key: TaskListSortKey): string {
  const label = key === 'gradYear' ? 'Grad Year' : 'Call Attempt';
  const sortRules = !sort ? [] : Array.isArray(sort) ? sort : [sort];
  const existingRule = sortRules.find((rule) => rule.key === key);
  if (!existingRule) {
    return `Sort ${label} Ascending`;
  }
  if (existingRule.direction === 'asc') {
    return `Sort ${label} Descending`;
  }
  return `Turn Off ${label} Sort`;
}

function buildScoutPrepTaskItemId(task: ScoutPortalTask): string {
  return `task:${task.contact_id}:${task.title || 'task'}:${task.due_date || 'due'}`;
}

type ProspectSearchMode = 'athlete' | 'parent';

type ScoutPrepLaunchContext = {
  initialFilter?: TaskListFilter;
  searchText?: string;
  source?: string;
};

function buildClientMessageSearchTextFromScoutPrepTask(task: ScoutPortalTask): string {
  return String(task.athlete_name || task.title || '').trim();
}

async function openClientMessagesFromScoutPrepTask(task: ScoutPortalTask) {
  await launchCommand({
    name: 'client-message-inbox',
    type: LaunchType.UserInitiated,
    context: {
      searchText: buildClientMessageSearchTextFromScoutPrepTask(task),
      source: 'scout-prep',
    },
  });
}

function resolveInitialTaskListFilter(value?: string | null): TaskListFilter {
  return value === 'all' || value === 'tomorrow' || value === 'future' ? value : 'todayPastDue';
}

function buildScoutPrepTaskFromProspect(result: ProspectResult): ScoutPortalTask | null {
  const athleteId = String(result.athlete_id || '').trim();
  const athleteMainId = String(result.athlete_main_id || '').trim();
  if (!athleteId) {
    return null;
  }

  return {
    contact_id: athleteId,
    athlete_id: athleteId,
    athlete_main_id: athleteMainId || null,
    athlete_name: result.name || `Athlete ${athleteId}`,
    sport: result.sport || null,
    high_school: result.high_school || null,
    city: result.city || null,
    state: result.state || null,
    grad_year: result.grad_year || null,
    title: 'Prospect Search Result',
    description:
      [result.sport, result.high_school].filter(Boolean).join(' • ') || 'Prospect Search Result',
  };
}

function buildPersonalFollowUpResultFromTask(
  task: ScoutPortalTask,
): PersonalFollowUpEntry['result'] | null {
  const athleteId = String(task.athlete_id || task.contact_id || '').trim();
  if (!athleteId) {
    return null;
  }

  return {
    athlete_id: athleteId,
    athlete_main_id: String(task.athlete_main_id || '').trim() || undefined,
    name: task.athlete_name,
    grad_year: task.grad_year || undefined,
    sport: task.sport || undefined,
    state: task.state || undefined,
    city: task.city || undefined,
    high_school: task.high_school || undefined,
    url:
      task.athlete_profile_url ||
      task.athlete_admin_url ||
      `${DASHBOARD_BASE_URL}/athlete/profile/${encodeURIComponent(athleteId)}`,
  };
}

function formatDateForLegacyInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function formatTimeForLegacyInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildMorningConfirmationDate(meetingDate: Date): Date {
  return new Date(
    meetingDate.getFullYear(),
    meetingDate.getMonth(),
    meetingDate.getDate(),
    9,
    0,
    0,
    0,
  );
}

function resolveConfirmationTaskForMorningAction(
  selectedTask: ScoutPortalTask,
  activeContext: ScoutPrepContext,
): ScoutAthleteTask | null {
  const selectedTaskId = String(selectedTask.task_id || '').trim();
  const selectedTaskComplete = Boolean(String(selectedTask.completion_date || '').trim());
  if (selectedTaskId && !selectedTaskComplete && isConfirmationCallTask(selectedTask)) {
    return {
      task_id: selectedTaskId,
      title: selectedTask.title || null,
      assigned_owner: selectedTask.assigned_owner || null,
      due_date: selectedTask.due_date || null,
      completion_date: selectedTask.completion_date || null,
      description: selectedTask.description || null,
    };
  }

  return findNewestIncompleteConfirmationTask(activeContext.tasks);
}

async function resolveCurrentMeetingDateForTask(args: {
  athleteId: string;
  athleteMainId: string;
}): Promise<Date> {
  const payload = await fetchAthleteBookedMeetings({
    athleteId: args.athleteId,
    athleteMainId: args.athleteMainId,
  });
  const meeting = selectCurrentBookedMeeting(Array.isArray(payload.events) ? payload.events : []);
  const meetingDate = easternLocalIsoToDate(String(meeting?.start || '').trim());
  if (!meeting || !meetingDate) {
    throw new Error('No active booked meeting found');
  }
  return meetingDate;
}

async function updateConfirmationTaskToMeetingMorning(args: {
  task: ScoutPortalTask;
  activeContext: ScoutPrepContext;
  confirmationTask: ScoutAthleteTask;
}): Promise<Date> {
  const athleteId = String(args.activeContext.task.contact_id || args.task.contact_id || '').trim();
  const athleteMainId = String(
    args.activeContext.resolved.athlete_main_id ||
      args.activeContext.task.athlete_main_id ||
      args.task.athlete_main_id ||
      '',
  ).trim();

  if (!athleteId || !athleteMainId) {
    throw new Error('Missing athlete IDs');
  }

  const meetingDate = await resolveCurrentMeetingDateForTask({
    athleteId,
    athleteMainId,
  });

  const nextDueAt = buildMorningConfirmationDate(meetingDate);
  await updateScoutPrepTask({
    taskId: args.confirmationTask.task_id,
    contactTask: athleteId,
    athleteMainId,
    athleteName: args.activeContext.contactInfo.studentAthlete.name || args.task.athlete_name,
    dueDate: formatDateForLegacyInput(nextDueAt),
    dueTime: formatTimeForLegacyInput(nextDueAt),
  });

  return nextDueAt;
}

function buildDefaultTaskDate(dueDate?: string | null): Date | undefined {
  const rawDate = String(dueDate || '').trim();
  const dateMatch = rawDate.match(/(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!dateMatch) return undefined;

  const month = Number.parseInt(dateMatch[1], 10) - 1;
  const day = Number.parseInt(dateMatch[2], 10);
  const yearValue = Number.parseInt(dateMatch[3], 10);
  const year = dateMatch[3].length === 2 ? 2000 + yearValue : yearValue;
  let hour = Number.parseInt(dateMatch[4], 10);
  const minute = Number.parseInt(dateMatch[5], 10);
  const meridiem = dateMatch[6].toUpperCase();

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const parsed = new Date(year, month, day, hour, minute);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatShortDueDate(dueDate?: string | null): string | null {
  const parsed = buildDefaultTaskDate(dueDate);
  if (!parsed) return null;
  const day = SHORT_DAYS[parsed.getDay()];
  return `${day} ${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function getTaskAccessoryMetadata(task: ScoutPortalTask) {
  const shortDate = formatShortDueDate(task.due_date);
  const taskTitle = stripMoveThisTaskPrefix(task.title);

  const taskColor = (() => {
    const t = (taskTitle || '').toLowerCase();
    if (t.startsWith('call attempt 3')) return Color.Red;
    if (t.startsWith('call attempt 2')) return Color.Orange;
    if (t.startsWith('call attempt')) return Color.Blue;
    if (t.includes('confirmation')) return Color.Green;
    if (t.includes('meeting set')) return Color.Orange;
    if (t.includes('follow up') || t.includes('follow-up')) return Color.Yellow;
    if (t.includes('voicemail') || t.includes('voice mail')) return Color.Magenta;
    return Color.SecondaryText;
  })();

  const gradYearColor = (() => {
    switch (task.grad_year) {
      case '2026':
        return Color.Red;
      case '2027':
        return Color.Purple;
      case '2028':
        return Color.Blue;
      case '2029':
        return Color.Green;
      case '2030':
        return Color.Magenta;
      default:
        return Color.SecondaryText;
    }
  })();

  return {
    shortDate,
    taskTitle,
    taskColor,
    gradYearColor,
  };
}

const SCHEDULED_FOLLOW_UP_TASK_TITLE = 'SCHEDULED FOLLOW-UP';

function UpdateAthleteTaskForm({
  task,
  selectedTask,
  athleteMainId,
  contactTask,
  initialTaskTitle,
  onUpdated,
}: {
  task: ScoutPortalTask;
  selectedTask: ScoutAthleteTask;
  athleteMainId: string;
  contactTask: string;
  initialTaskTitle?: string | null;
  onUpdated?: () => void | Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const currentTaskTitle = String(initialTaskTitle || getTaskDisplayTitle(selectedTask)).trim();
  const defaultTaskDescription = String(selectedTask.description || '').trim();
  const taskUpdateVariant = getTaskSpecificUpdateVariant(selectedTask);
  const taskTitleInputPlaceholder =
    taskUpdateVariant === 'scheduled_follow_up'
      ? SCHEDULED_FOLLOW_UP_TASK_TITLE
      : 'Spoke to - Need to Follow Up';

  function buildTaskFormValues(values: {
    taskTitle?: string;
    dueDate?: Date;
    description?: string;
    completeTask?: boolean;
  }) {
    const taskTitle = String(values.taskTitle || currentTaskTitle || '').trim();
    const description = String(values.description || '').trim();
    return {
      taskTitle: taskTitle || currentTaskTitle,
      description,
      dueDate: values.dueDate,
      completeTask: Boolean(values.completeTask),
    };
  }

  async function handleUpdate(values: {
    taskTitle?: string;
    dueDate?: Date;
    description?: string;
    completeTask?: boolean;
  }) {
    if (isSaving) return;
    setIsSaving(true);
    const toast = await showLoadingToast('Saving', currentTaskTitle);
    const formValues = buildTaskFormValues(values);
    try {
      await updateScoutPrepTask({
        taskId: selectedTask.task_id,
        contactTask,
        athleteMainId,
        athleteName: task.athlete_name,
        taskTitle: formValues.taskTitle,
        description: formValues.description,
        dueDate: formValues.dueDate ? formatDateForLegacyInput(formValues.dueDate) : null,
        dueTime: formValues.dueDate ? formatTimeForLegacyInput(formValues.dueDate) : null,
      });

      if (formValues.completeTask) {
        await completeScoutPrepTaskAfterVoicemail({
          athleteId: contactTask,
          athleteMainId,
          athleteName: task.athlete_name,
          contactTask,
          taskTitle: formValues.taskTitle || currentTaskTitle,
          assignedOwner: selectedTask.assigned_owner,
          description: formValues.description || formValues.taskTitle || currentTaskTitle,
          taskId: selectedTask.task_id,
        });
      }

      await completeScoutPrepMutationSuccess({
        toast,
        title: formValues.completeTask ? 'Saved and completed' : 'Saved',
        message: formValues.taskTitle || currentTaskTitle,
      });
      await onUpdated?.();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteTask() {
    if (isCompleting) return;
    setIsCompleting(true);
    const toast = await showLoadingToast('Saving', currentTaskTitle);
    try {
      await completeScoutPrepTaskAfterVoicemail({
        athleteId: contactTask,
        athleteMainId,
        athleteName: task.athlete_name,
        contactTask,
        taskTitle: currentTaskTitle,
        assignedOwner: selectedTask.assigned_owner,
        description: selectedTask.description || currentTaskTitle,
        taskId: selectedTask.task_id,
      });
      await completeScoutPrepMutationSuccess({
        toast,
        title: 'Completed',
        message: currentTaskTitle,
      });
      await onUpdated?.();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Complete failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsCompleting(false);
    }
  }

  async function handleSetScheduledFollowUp(values: {
    taskTitle?: string;
    dueDate?: Date;
    description?: string;
    completeTask?: boolean;
  }) {
    if (isSaving) return;
    setIsSaving(true);
    const toast = await showLoadingToast('Saving', 'Follow-up');
    const formValues = buildTaskFormValues({
      ...values,
      taskTitle: SCHEDULED_FOLLOW_UP_TASK_TITLE,
    });
    try {
      await updateScoutPrepTask({
        taskId: selectedTask.task_id,
        contactTask,
        athleteMainId,
        athleteName: task.athlete_name,
        taskTitle: formValues.taskTitle,
        description: formValues.description,
        dueDate: formValues.dueDate ? formatDateForLegacyInput(formValues.dueDate) : null,
        dueTime: formValues.dueDate ? formatTimeForLegacyInput(formValues.dueDate) : null,
      });

      if (formValues.completeTask) {
        await completeScoutPrepTaskAfterVoicemail({
          athleteId: contactTask,
          athleteMainId,
          athleteName: task.athlete_name,
          contactTask,
          taskTitle: formValues.taskTitle || currentTaskTitle,
          assignedOwner: selectedTask.assigned_owner,
          description: formValues.description || formValues.taskTitle || currentTaskTitle,
          taskId: selectedTask.task_id,
        });
      }

      await completeScoutPrepMutationSuccess({
        toast,
        title: formValues.completeTask ? 'Saved and completed' : 'Saved',
        message: formValues.taskTitle || currentTaskTitle,
      });
      await onUpdated?.();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      navigationTitle={`Update Task • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSaving ? 'Saving…' : 'Save Task Update'}
            icon={Icon.Calendar}
            onSubmit={(values) =>
              void handleUpdate(
                values as {
                  taskTitle?: string;
                  dueDate?: Date;
                  description?: string;
                  completeTask?: boolean;
                },
              )
            }
          />
          <Action.SubmitForm
            title={isSaving ? 'Saving…' : 'Set Scheduled Follow-Up'}
            icon={Icon.Calendar}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
            onSubmit={(values) =>
              void handleSetScheduledFollowUp(
                values as {
                  taskTitle?: string;
                  dueDate?: Date;
                  description?: string;
                  completeTask?: boolean;
                },
              )
            }
          />
          <Action
            title={isCompleting ? 'Completing…' : 'Complete Task'}
            icon={Icon.CheckCircle}
            onAction={() => void handleCompleteTask()}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="taskTitle"
        title="Task Title"
        placeholder={taskTitleInputPlaceholder}
        defaultValue={currentTaskTitle}
      />
      <Form.TextArea
        id="description"
        title="Description"
        placeholder="Describe what changed and what should happen next."
        defaultValue={defaultTaskDescription}
        autoFocus
      />
      <Form.DatePicker
        id="dueDate"
        title="Task Due Date"
        defaultValue={buildDefaultTaskDate(selectedTask.due_date)}
      />
      <Form.Checkbox
        id="completeTask"
        label="Complete this task after saving"
        defaultValue={false}
      />
    </Form>
  );
}

function UpdateAthleteTaskPicker({
  task,
  initialContext = null,
  onTaskMutationComplete,
  closeAfterMutationViews = 1,
}: {
  task: ScoutPortalTask;
  initialContext?: ScoutPrepContext | null;
  onTaskMutationComplete?: () => void | Promise<void>;
  closeAfterMutationViews?: number;
}) {
  const { push, pop } = useNavigation();
  const [context, setContext] = useState<ScoutPrepContext | null>(initialContext);
  const [isLoading, setIsLoading] = useState(!initialContext);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (initialContext) {
      setContext(initialContext);
      setIsLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const loadedContext = await loadScoutPrepContext(task);
        if (active) {
          setContext(loadedContext);
        }
      } catch (error) {
        if (active) {
          await showToast({
            style: Toast.Style.Failure,
            title: 'Task load failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [initialContext, task]);

  const commandContext = context ? buildScoutPrepCommandContext({ context }) : null;
  const incompleteTasks = commandContext?.tasks || [];

  async function handleOpenTaskUpdate(
    selectedTask: ScoutAthleteTask,
    options: { initialTaskTitle?: string | null } = {},
  ) {
    const athleteMainId = String(
      context?.resolved.athlete_main_id || task.athlete_main_id || '',
    ).trim();
    const contactTask = String(task.contact_id || '').trim();
    if (!athleteMainId || !contactTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing task IDs',
      });
      return;
    }
    push(
      <UpdateAthleteTaskForm
        task={task}
        selectedTask={selectedTask}
        athleteMainId={athleteMainId}
        contactTask={contactTask}
        initialTaskTitle={options.initialTaskTitle}
        onUpdated={async () => {
          await popViewsThenRefreshRoot(
            pop,
            closeAfterMutationViews + 1,
            onTaskMutationComplete,
          );
        }}
      />,
    );
  }

  async function handleCompleteTaskFromList(selectedTask: ScoutAthleteTask) {
    if (completingTaskId) return;

    const athleteMainId = String(
      context?.resolved.athlete_main_id || task.athlete_main_id || '',
    ).trim();
    const contactTask = String(task.contact_id || '').trim();
    if (!athleteMainId || !contactTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing task IDs',
      });
      return;
    }

    setCompletingTaskId(selectedTask.task_id);
    const toast = await showLoadingToast('Saving', getTaskDisplayTitle(selectedTask));
    try {
      await completeScoutPrepTaskAfterVoicemail({
        athleteId: contactTask,
        athleteMainId,
        athleteName: task.athlete_name,
        contactTask,
        taskTitle: getTaskDisplayTitle(selectedTask),
        assignedOwner: selectedTask.assigned_owner,
        description: selectedTask.description || getTaskDisplayTitle(selectedTask),
        taskId: selectedTask.task_id,
      });

      setContext((current) =>
        current
          ? {
              ...current,
              tasks: current.tasks.filter(
                (candidate) => candidate.task_id !== selectedTask.task_id,
              ),
            }
          : current,
      );

      await completeScoutPrepMutationSuccess({
        toast,
        title: 'Completed',
        message: getTaskDisplayTitle(selectedTask),
        onReturnToRootList: async () => {
          await popViewsThenRefreshRoot(pop, closeAfterMutationViews, onTaskMutationComplete);
        },
      });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Complete failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setCompletingTaskId(null);
    }
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Update Task • ${task.athlete_name}`}
      searchBarPlaceholder="Filter incomplete athlete tasks"
    >
      {incompleteTasks.length > 0 ? (
        <List.Section title="Incomplete Tasks" subtitle={String(incompleteTasks.length)}>
          {incompleteTasks.map((candidate) => (
            <List.Item
              key={candidate.task_id}
              icon="✅"
              title={getTaskDisplayTitle(candidate)}
              subtitle={candidate.assigned_owner || 'No owner'}
              accessories={[
                ...(candidate.due_date ? [{ text: candidate.due_date }] : []),
                { text: `#${candidate.task_id}` },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title="Update Task"
                    icon={Icon.Pencil}
                    onAction={() => void handleOpenTaskUpdate(candidate)}
                  />
                  <Action
                    title="Set Scheduled Follow-Up"
                    icon={Icon.Calendar}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
                    onAction={() =>
                      void handleOpenTaskUpdate(candidate, {
                        initialTaskTitle: SCHEDULED_FOLLOW_UP_TASK_TITLE,
                      })
                    }
                  />
                  <Action
                    title={completingTaskId === candidate.task_id ? 'Completing…' : 'Complete Task'}
                    icon={Icon.CheckCircle}
                    onAction={() => void handleCompleteTaskFromList(candidate)}
                  />
                  {candidate.description ? (
                    <Action.CopyToClipboard
                      title="Copy Task Description"
                      content={candidate.description}
                    />
                  ) : null}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : (
        <List.Item
          icon="✅"
          title={isLoading ? 'Loading tasks' : 'No incomplete tasks found'}
          subtitle={
            isLoading
              ? 'Loading athlete task list'
              : 'This athlete has no incomplete tasks available to complete'
          }
        />
      )}
    </List>
  );
}

export function PostCallUpdateForm({
  task,
  onSaved,
  initialStageLabel,
  initialBookedMeeting,
  closeAfterSaveViews = 1,
}: {
  task: ScoutPortalTask;
  onSaved?: () => void | Promise<void>;
  initialStageLabel?: string;
  initialBookedMeeting?: BookedMeetingEvent | null;
  closeAfterSaveViews?: number;
}) {
  const { pop } = useNavigation();
  const [stageOptions, setStageOptions] = useState<SalesStageOption[]>([]);
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [meetingTemplate, setMeetingTemplate] = useState<MeetingSetTemplateResponse | null>(null);
  const [selectedMeetingFor, setSelectedMeetingFor] = useState<string>(
    HEAD_SCOUT_ORDER[0]?.meeting_for || '',
  );
  const [currentBookedMeeting, setCurrentBookedMeeting] = useState<BookedMeetingEvent | null>(null);
  const [currentBookedMeetingStartTime, setCurrentBookedMeetingStartTime] = useState<string>('');
  const [currentBookedMeetingFor, setCurrentBookedMeetingFor] = useState<string>('');
  const [openMeetingSlots, setOpenMeetingSlots] = useState<OpenMeetingSlot[]>([]);
  const [selectedOpenMeetingId, setSelectedOpenMeetingId] = useState<string>('');
  const [meetingLength, setMeetingLength] = useState<string>('01:00');
  const [isLoadingStages, setIsLoadingStages] = useState(true);
  const [isLoadingMeetingTemplate, setIsLoadingMeetingTemplate] = useState(false);
  const [isLoadingOpenMeetings, setIsLoadingOpenMeetings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoadingStages(true);
      try {
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-options', 'start', {
          athleteId: task.contact_id,
          athleteName: task.athlete_name,
        });
        const options = await fetchCuratedSalesStageOptions(String(task.contact_id), {
          excludeLabels: [...POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS],
        });
        if (!active) {
          return;
        }
        const filteredOptions = options.filter(
          (option) =>
            !POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS.includes(
              option.label as (typeof POST_CALL_UPDATE_EXCLUDED_STAGE_LABELS)[number],
            ),
        );
        const initialStage = initialStageLabel
          ? filteredOptions.find((option) => option.label === initialStageLabel)
          : null;
        setStageOptions(filteredOptions);
        setSelectedStage(
          initialStage?.value ||
            filteredOptions.find((option) => option.selected)?.value ||
            filteredOptions[0]?.value ||
            '',
        );
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-options', 'success', {
          athleteId: task.contact_id,
          count: filteredOptions.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!active) {
          return;
        }
        logFailure('SCOUT_PREP_SALES_STAGE', 'load-options', message, {
          athleteId: task.contact_id,
        });
        await showToast({
          style: Toast.Style.Failure,
          title: 'Stage load failed',
          message,
        });
      } finally {
        if (active) {
          setIsLoadingStages(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [initialStageLabel, task]);

  const selectedStageLabel =
    stageOptions.find((option) => option.value === selectedStage)?.label || selectedStage;
  const selectedCurrentStageLabel =
    stageOptions.find((option) => option.selected)?.label ||
    stageOptions.find((option) => option.selected)?.value ||
    null;

  useEffect(() => {
    let active = true;
    if (!needsMeetingSchedulingFields(selectedStageLabel)) {
      setMeetingTemplate(null);
      setCurrentBookedMeeting(null);
      setCurrentBookedMeetingStartTime('');
      setCurrentBookedMeetingFor('');
      setMeetingLength('01:00');
      setIsLoadingMeetingTemplate(false);
      return () => {
        active = false;
      };
    }

    const loadTemplate = async () => {
      setIsLoadingMeetingTemplate(true);
      try {
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-meeting-template', 'start', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          stage: selectedStageLabel,
        });
        const [template, displayContext] = await Promise.all([
          isConfirmedRescheduleMeetingStage(selectedStageLabel)
            ? fetchRescheduleMeetingTemplate(task)
            : fetchMeetingSetTemplate(task),
          loadScoutPrepContextForDisplay(task),
        ]);
        const context = displayContext.context;
        const athleteId = String(
          task.athlete_id ||
            task.contact_id ||
            context.task.athlete_id ||
            context.task.contact_id ||
            '',
        ).trim();
        const athleteMainId = String(
          task.athlete_main_id || context.resolved.athlete_main_id || '',
        ).trim();
        const meetingDetailsSource = isConfirmedRescheduleMeetingStage(selectedStageLabel)
          ? 'appointment_truth'
          : 'booked_meetings';
        const resolvedBookedMeeting = await resolveBookedMeetingDetailsForForm(
          {
            athleteId,
            athleteMainId,
            initialBookedMeeting,
            source: meetingDetailsSource,
          },
          {
            getCachedMeetingDescription: getCachedBookedMeetingDescription,
          },
        );
        const bookedMeeting = resolvedBookedMeeting?.bookedMeeting || null;
        if (!active) {
          return;
        }
        const hydratedTemplate = hydrateMeetingSetTemplateForForm(template, context, {
          athleteName: task.athlete_name,
          gradYear: task.grad_year,
        });
        setMeetingTemplate(
          applyResolvedBookedMeetingPayloadToTemplate(hydratedTemplate, resolvedBookedMeeting),
        );
        setCurrentBookedMeeting(bookedMeeting);
        setCurrentBookedMeetingStartTime(resolvedBookedMeeting?.startTime || '');
        const bookedScout = resolveBookedMeetingScout(bookedMeeting);
        const resolvedMeetingFor = selectMeetingForFromResolvedBookedMeeting(
          resolvedBookedMeeting,
          bookedScout,
        );
        setCurrentBookedMeetingFor(resolvedMeetingFor || '');
        if (resolvedMeetingFor) {
          setSelectedMeetingFor(resolvedMeetingFor);
        }
        const resolvedOpenEventId =
          resolvedBookedMeeting?.openEventId || bookedMeeting?.event_id || '';
        if (resolvedOpenEventId) {
          setSelectedOpenMeetingId(resolvedOpenEventId);
        }
        setMeetingLength(
          resolvedBookedMeeting?.meetingLength ||
            buildMeetingLengthFromBookedMeeting(bookedMeeting) ||
            '01:00',
        );
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-meeting-template', 'success', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          timezoneCount: template.recruit_timezone_options.length,
          hasPrimaryPhone: Boolean(selectScoutPrepContactNumbers(context).primaryNumber),
          currentBookedMeetingId: bookedMeeting?.event_id || null,
          currentBookedMeetingScout: bookedMeeting?.assigned_owner || null,
          stage: selectedStageLabel,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!active) {
          return;
        }
        try {
          const { context } = await loadScoutPrepContextForDisplay(task);
          if (!active) {
            return;
          }
          const fallbackTemplate = buildFallbackMeetingTemplate();
          setMeetingTemplate(
            hydrateMeetingSetTemplateForForm(fallbackTemplate, context, {
              athleteName: task.athlete_name,
              gradYear: task.grad_year,
            }),
          );
          setCurrentBookedMeeting(null);
          setCurrentBookedMeetingStartTime('');
          setCurrentBookedMeetingFor('');
        } catch {
          if (!active) {
            return;
          }
          const fallbackTemplate = buildFallbackMeetingTemplate();
          setMeetingTemplate(
            hydrateMeetingSetTemplateForForm(fallbackTemplate, null, {
              athleteName: task.athlete_name,
              gradYear: task.grad_year,
            }),
          );
          setCurrentBookedMeeting(null);
          setCurrentBookedMeetingStartTime('');
          setCurrentBookedMeetingFor('');
        }
        logFailure('SCOUT_PREP_SALES_STAGE', 'load-meeting-template', message, {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
        });
      } finally {
        if (active) {
          setIsLoadingMeetingTemplate(false);
        }
      }
    };

    void loadTemplate();
    return () => {
      active = false;
    };
  }, [initialBookedMeeting, selectedStage, selectedStageLabel, task]);

  const meetingTemplateKey = `${selectedStage}-${meetingTemplate?.meeting_name || 'meeting'}`;
  const meetingDetailsKey = `${meetingTemplateKey}-${meetingTemplate?.details_template || ''}`;
  const canRenderStageFields =
    !isLoadingStages && stageOptions.length > 0 && Boolean(selectedStage);
  const selectedBookedMeetingScout = useMemo(
    () => resolveBookedMeetingScout(currentBookedMeeting),
    [currentBookedMeeting],
  );
  const selectedBookedMeetingSlot = useMemo(
    () =>
      buildOpenMeetingSlotFromBookedMeeting(currentBookedMeeting, currentBookedMeetingStartTime),
    [currentBookedMeeting, currentBookedMeetingStartTime],
  );
  const meetingSlotsForDropdown = useMemo(() => {
    const slots = [...openMeetingSlots];
    if (
      selectedBookedMeetingSlot &&
      (currentBookedMeetingFor === selectedMeetingFor ||
        selectedBookedMeetingSlot.open_event_id === selectedOpenMeetingId) &&
      !slots.some((slot) => slot.open_event_id === selectedBookedMeetingSlot.open_event_id)
    ) {
      return [selectedBookedMeetingSlot, ...slots];
    }
    return slots;
  }, [
    openMeetingSlots,
    currentBookedMeetingFor,
    selectedOpenMeetingId,
    selectedBookedMeetingSlot,
    selectedMeetingFor,
  ]);

  useEffect(() => {
    let active = true;
    if (!needsMeetingSchedulingFields(selectedStageLabel) || !selectedMeetingFor) {
      setOpenMeetingSlots([]);
      setSelectedOpenMeetingId('');
      setIsLoadingOpenMeetings(false);
      return () => {
        active = false;
      };
    }

    const loadOpenMeetings = async () => {
      setIsLoadingOpenMeetings(true);
      try {
        const response = await fetchOpenMeetings(selectedMeetingFor);
        if (!active) {
          return;
        }
        setOpenMeetingSlots(response.slots);
        const currentMeetingId =
          currentBookedMeetingFor === selectedMeetingFor
            ? currentBookedMeeting?.event_id || ''
            : '';
        setSelectedOpenMeetingId(currentMeetingId || response.slots[0]?.open_event_id || '');
      } catch (error) {
        if (!active) {
          return;
        }
        setOpenMeetingSlots([]);
        setSelectedOpenMeetingId(
          currentBookedMeetingFor === selectedMeetingFor
            ? currentBookedMeeting?.event_id || ''
            : '',
        );
        await showToast({
          style: Toast.Style.Failure,
          title: 'Meetings load failed',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (active) {
          setIsLoadingOpenMeetings(false);
        }
      }
    };

    void loadOpenMeetings();
    return () => {
      active = false;
    };
  }, [
    currentBookedMeeting?.event_id,
    currentBookedMeetingFor,
    selectedMeetingFor,
    selectedStageLabel,
  ]);

  async function handleSubmit(values: Record<string, string | undefined>) {
    if (isSaving) {
      return;
    }

    const stageValue = values.officialStage || selectedStage || '';
    const stageLabel =
      stageOptions.find((option) => option.value === stageValue)?.label || stageValue;
    if (!stageLabel) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Pick a stage',
      });
      return;
    }

    setIsSaving(true);
    const toast = await showLoadingToast('Saving', 'Laravel + Supabase');
    try {
      const context = task.athlete_main_id ? null : await loadScoutPrepContext(task);
      const athleteMainId = String(
        task.athlete_main_id || context?.resolved.athlete_main_id || '',
      ).trim();
      const athleteId = String(
        task.athlete_id ||
          task.contact_id ||
          context?.task.athlete_id ||
          context?.task.contact_id ||
          '',
      ).trim();

      if (!athleteMainId || !athleteId) {
        throw new Error('Missing athlete_main_id or athlete_id for sales stage update');
      }

      let preUpdateContext = context;
      async function getPreUpdateContext(): Promise<ScoutPrepContext> {
        if (!preUpdateContext) {
          preUpdateContext = await loadScoutPrepContext(task);
        }
        return preUpdateContext;
      }
      let reschedulePendingMeetingDescription: string | null = null;
      const isReschedulePendingUpdate = isReschedulePendingStage(stageLabel);
      const isCanceledPostMeetingUpdate = isCanceledPostMeetingStage(stageLabel);
      const requiresPostMeetingOperatorNote =
        isReschedulePendingUpdate || isCanceledPostMeetingUpdate;
      const reschedulePendingOperatorNoteTitle = getPostMeetingOperatorNoteTitle(
        stageLabel,
        values.reschedulePendingNoteTitle,
      );
      const reschedulePendingOperatorNoteDescription = String(
        values.reschedulePendingNoteDescription || '',
      ).trim();

      if (requiresPostMeetingOperatorNote) {
        if (!reschedulePendingOperatorNoteDescription) {
          throw new Error(
            `${stageLabel} requires a note description for why it needs operator follow-up`,
          );
        }
      }
      if (isReschedulePendingUpdate) {
        reschedulePendingMeetingDescription = await cacheMeetingDescriptionForReschedulePending({
          athleteId,
          athleteMainId,
          initialBookedMeeting,
        });
        if (!reschedulePendingMeetingDescription) {
          throw new Error('Missing saved meeting description for RSP And Scout Notes');
        }
      }
      if (isCanceledPostMeetingUpdate) {
        reschedulePendingMeetingDescription = await cacheMeetingDescriptionForReschedulePending({
          athleteId,
          athleteMainId,
          initialBookedMeeting,
        });
        if (!reschedulePendingMeetingDescription) {
          throw new Error('Missing saved meeting description for CAN And Scout Notes');
        }
      }
      if (isReschedulePendingUpdate) {
        if (!isReschedulePendingStage(selectedCurrentStageLabel)) {
          const stageContext = await getPreUpdateContext();
          await updateSalesStage({
            athleteMainId,
            athleteId,
            athleteName: stageContext.contactInfo.studentAthlete.name || task.athlete_name,
            stage: stageLabel,
            appointmentId: initialBookedMeeting?.event_id || null,
          });
        }
        await addAthleteNote({
          athleteId,
          athleteMainId,
          title: getPostMeetingScoutNotesTitle(stageLabel),
          description: reschedulePendingMeetingDescription || '',
        });
        await addAthleteNote({
          athleteId,
          athleteMainId,
          title: reschedulePendingOperatorNoteTitle,
          description: reschedulePendingOperatorNoteDescription,
        });
        await completeScoutPrepMutationSuccess({
          toast,
          title: 'Saved',
          message: stageLabel,
        });
        await popViewsThenRefreshRoot(pop, closeAfterSaveViews, onSaved);
        return;
      }

      let meetingSetResult: MeetingSetSubmitResponse | null = null;
      let meetingSetInput: Parameters<typeof buildPostCallActionPlan>[0]['meetingSet'] = undefined;
      let rescheduleMeetingResult: RescheduleMeetingSubmitResponse | null = null;
      let rescheduleMeetingPayload: RescheduleMeetingSubmitRequest | null = null;
      let rescheduleStartsAt: string | null = null;
      let rescheduleHeadScout: string | null = null;
      const preUpdateContextForStage = await getPreUpdateContext();
      if (needsMeetingSchedulingFields(stageLabel)) {
        const assignedTo = String(
          values.meetingFor || selectedMeetingFor || values.legacyAssignedTo || '',
        ).trim();
        const openEventId = String(values.openMeetingId || selectedOpenMeetingId || '').trim();
        const selectedMeetingLength =
          String(values.legacyMeetingLength || meetingLength || '01:00').trim() || '01:00';
        const meetingName = String(values.meetingName || '').trim();
        const meetingTimezone = String(values.recruitTimeZone || '').trim();
        const taskDescription = String(values.meetingDetails || '').trim();
        const selectedOpenMeeting =
          meetingSlotsForDropdown.find((slot) => slot.open_event_id === openEventId) || null;
        const selectedScout =
          HEAD_SCOUT_ORDER.find((scout) => scout.meeting_for === assignedTo) || null;
        const startTime = selectedOpenMeeting?.start_time || '';
        const startsAt = buildMeetingSetStartsAt(selectedOpenMeeting);

        if (!meetingName || !meetingTimezone || !taskDescription) {
          throw new Error('Meeting update requires meeting name, timezone, and details');
        }
        if (!assignedTo || !openEventId || !startTime) {
          throw new Error('Meeting update requires scout and open meeting selection');
        }

        const meetingInput = {
          athleteId,
          athleteMainId,
          meetingName,
          meetingTimezone,
          assignedToLegacyUserId: assignedTo,
          meetingForLegacyUserId: selectedScout?.meeting_for || assignedTo,
          openEventId,
          calendarOwnerId: selectedScout?.calendar_owner_id || null,
          bookedMeetingAssignedOwner: selectedOpenMeeting?.assigned_owner || null,
          taskDescription,
          startTime,
          startsAt: startsAt || startTime,
          meetingLength: selectedMeetingLength,
          headScout: String(preUpdateContextForStage.resolved.head_scout || '').trim() || null,
        };
        rescheduleStartsAt = buildEasternStartsAt(startsAt) || startTime;
        rescheduleHeadScout =
          String(preUpdateContextForStage.resolved.head_scout || '').trim() ||
          selectedOpenMeeting?.assigned_owner ||
          selectedScout?.scout_name ||
          null;

        if (isMeetingSetStage(stageLabel)) {
          meetingSetInput = meetingInput;
          const initialPlan = buildPostCallActionPlan({
            athleteId,
            athleteMainId,
            athleteName:
              preUpdateContextForStage.contactInfo.studentAthlete.name || task.athlete_name,
            stageLabel,
            tasks: preUpdateContextForStage.tasks,
            selectedTaskId: task.task_id,
            meetingSet: meetingSetInput,
          });
          if (!initialPlan.laravelMeetingSetSubmit) {
            throw new Error('Meeting Set submit plan was not built');
          }
          meetingSetResult = await submitMeetingSet(initialPlan.laravelMeetingSetSubmit);
        } else if (isConfirmedRescheduleMeetingStage(stageLabel)) {
          rescheduleMeetingPayload = {
            athlete_id: athleteId,
            athlete_main_id: athleteMainId,
            meeting_name: meetingName,
            meeting_timezone: meetingTimezone,
            assigned_to: assignedTo,
            open_event_id: openEventId,
            task_description: taskDescription,
            start_time: startTime,
            meeting_length: selectedMeetingLength,
            openmeetings_list_length: '-1',
            template_id: '210',
            keep_as_open_slot: 'yes',
          };
          rescheduleMeetingResult = await submitRescheduleMeeting(rescheduleMeetingPayload);
        }
      }

      const basePlan = buildPostCallActionPlan({
        athleteId,
        athleteMainId,
        athleteName: preUpdateContextForStage.contactInfo.studentAthlete.name || task.athlete_name,
        stageLabel,
        tasks: preUpdateContextForStage.tasks,
        selectedTaskId: task.task_id,
        meetingSet: meetingSetInput,
      });

      const salesStageResult = await updateSalesStage({
        athleteMainId,
        athleteId,
        athleteName: preUpdateContextForStage.contactInfo.studentAthlete.name || task.athlete_name,
        stage: basePlan.laravelSalesStageUpdate?.stage || stageLabel,
        appointmentId: initialBookedMeeting?.event_id || currentBookedMeeting?.event_id || null,
      });
      if (isReschedulePendingUpdate) {
        await addAthleteNote({
          athleteId,
          athleteMainId,
          title: getPostMeetingScoutNotesTitle(stageLabel),
          description: reschedulePendingMeetingDescription || '',
        });
      }
      if (isCanceledPostMeetingUpdate) {
        await addAthleteNote({
          athleteId,
          athleteMainId,
          title: getPostMeetingScoutNotesTitle(stageLabel),
          description: reschedulePendingMeetingDescription || '',
        });
      }
      if (requiresPostMeetingOperatorNote) {
        await addAthleteNote({
          athleteId,
          athleteMainId,
          title: reschedulePendingOperatorNoteTitle,
          description: reschedulePendingOperatorNoteDescription,
        });
      }
      try {
        await syncAthleteContactCacheFromScoutPrepContext({
          context: preUpdateContext,
          crmStage: salesStageResult.stage || stageLabel,
          source: 'scout_prep_post_call',
          seenAt: new Date().toISOString(),
        });
      } catch (error) {
        logFailure(
          'SCOUT_PREP_CONTACT_CACHE_SYNC',
          'supabase-write',
          error instanceof Error ? error.message : String(error),
          {
            contactId: athleteId,
            athleteMainId,
            stageLabel,
          },
        );
      }

      const syncContext = preUpdateContext;
      const actionPlan = buildPostCallActionPlan({
        athleteId,
        athleteMainId,
        athleteName: syncContext.contactInfo.studentAthlete.name || task.athlete_name,
        stageLabel,
        tasks: syncContext.tasks,
        selectedTaskId: task.task_id,
        meetingSet: meetingSetInput,
        meetingSetResult,
        salesStageCreatedTask: salesStageResult.created_task || null,
      });

      if (actionPlan.supabaseLifecycleWrite) {
        try {
          await recordMeetingSet(actionPlan.supabaseLifecycleWrite.args);
        } catch (error) {
          logFailure(
            'SCOUT_PREP_MEETING_SET_SYNC',
            'supabase-write',
            error instanceof Error ? error.message : String(error),
            {
              contactId: athleteId,
              athleteMainId,
              stageLabel,
              materializationStatus: actionPlan.ownerContext.materializationStatus,
              ownerProof: actionPlan.ownerContext.ownerProof,
            },
          );
        }
      }
      if (meetingSetInput && meetingSetResult) {
        try {
          await syncMeetingSetConfirmationCacheFromScoutPrep({
            athleteId,
            athleteMainId,
            athleteName: syncContext.contactInfo.studentAthlete.name || task.athlete_name,
            context: syncContext,
            meetingSet: {
              openEventId: meetingSetInput.openEventId,
              startsAt: meetingSetInput.startsAt,
              startTime: meetingSetInput.startTime,
              meetingTimezone: meetingSetInput.meetingTimezone,
              meetingLength: meetingSetInput.meetingLength,
              bookedMeetingAssignedOwner: meetingSetInput.bookedMeetingAssignedOwner,
              headScout: meetingSetInput.headScout,
            },
            meetingSetResult,
          });
        } catch (error) {
          logFailure(
            'SCOUT_PREP_SET_MEETING_REMINDER_CACHE_SYNC',
            'supabase-write',
            error instanceof Error ? error.message : String(error),
            {
              contactId: athleteId,
              athleteMainId,
              stageLabel,
              appointmentId: meetingSetInput.openEventId,
            },
          );
        }
      }
      if (rescheduleMeetingPayload && rescheduleMeetingResult) {
        try {
          await recordRescheduled({
            athleteId,
            athleteMainId,
            athleteName: syncContext.contactInfo.studentAthlete.name || task.athlete_name,
            crmStage: salesStageResult.stage || stageLabel,
            taskStatus: rescheduleMeetingResult.created_task?.title || 'Confirmation Call',
            headScout: rescheduleHeadScout,
            currentTaskId: rescheduleMeetingResult.created_task?.task_id || null,
            currentTaskTitle: rescheduleMeetingResult.created_task?.title || null,
            previousAppointmentId: initialBookedMeeting?.event_id || null,
            appointmentId: rescheduleMeetingPayload.open_event_id,
            sourceEventId: rescheduleMeetingPayload.open_event_id,
            startsAt: rescheduleStartsAt,
            dueAt: rescheduleStartsAt,
            payload: {
              meeting_timezone: rescheduleMeetingPayload.meeting_timezone,
              previous_appointment_id: initialBookedMeeting?.event_id || null,
              operator_owner: actionPlan.ownerContext.activeOperator.personName,
              operator_owner_key: actionPlan.ownerContext.activeOperator.operatorKey,
              owner_proof: actionPlan.ownerContext.ownerProof || 'raycast_operator_context',
            },
          });
        } catch (error) {
          logFailure(
            'SCOUT_PREP_RESCHEDULE_SYNC',
            'supabase-write',
            error instanceof Error ? error.message : String(error),
            {
              contactId: athleteId,
              athleteMainId,
              stageLabel,
              appointmentId: rescheduleMeetingPayload.open_event_id,
            },
          );
        }
      }

      let taskCompletionMessage: string | null = null;
      const taskCompletion = actionPlan.laravelTaskCompletion;
      if (taskCompletion) {
        try {
          const result = await completeScoutPrepTaskAfterVoicemail({
            athleteId: taskCompletion.athleteId,
            athleteMainId: taskCompletion.athleteMainId,
            athleteName: syncContext.contactInfo.studentAthlete.name || task.athlete_name,
            contactTask: taskCompletion.contactTask,
            taskId: taskCompletion.taskId,
            crmStage: taskCompletion.crmStage,
            taskTitle: taskCompletion.taskTitle,
            assignedOwner: taskCompletion.assignedOwner,
            description: taskCompletion.description,
          });
          taskCompletionMessage = formatTaskIdLabel(result.task_id) || 'Task done';
        } catch (error) {
          logFailure(
            'SCOUT_PREP_POST_CALL_TASK_COMPLETE',
            'best-effort',
            error instanceof Error ? error.message : String(error),
            {
              contactId: athleteId,
              athleteMainId,
              stageLabel,
              taskId: taskCompletion.taskId,
            },
          );
        }
      }

      await completeScoutPrepMutationSuccess({
        toast,
        title: taskCompletionMessage
          ? 'Saved'
          : isMeetingSetStage(stageLabel)
            ? 'Meeting Set'
            : isConfirmedRescheduleMeetingStage(stageLabel)
              ? 'Rescheduled'
              : 'Saved',
        message:
          taskCompletionMessage ||
          (isMeetingSetStage(stageLabel)
            ? meetingSetResult?.email_sent
              ? 'Email sent'
              : 'Saved'
            : isConfirmedRescheduleMeetingStage(stageLabel)
              ? rescheduleMeetingResult?.email_sent
                ? 'Email sent'
                : 'Saved'
              : stageLabel),
      });
      await popViewsThenRefreshRoot(pop, closeAfterSaveViews, onSaved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.style = Toast.Style.Failure;
      toast.title = 'Save failed';
      toast.message = message;
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  return (
    <Form
      isLoading={isLoadingStages || isSaving}
      navigationTitle={`Post-Call Update • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSaving ? 'Saving…' : 'Save'}
            onSubmit={(values) => void handleSubmit(values as Record<string, string | undefined>)}
          />
        </ActionPanel>
      }
    >
      {canRenderStageFields ? (
        <Form.Dropdown
          id="officialStage"
          title="Official Sales Stage"
          value={selectedStage}
          onChange={setSelectedStage}
        >
          {stageOptions.map((option) => (
            <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
          ))}
        </Form.Dropdown>
      ) : null}

      {needsMeetingSchedulingFields(selectedStageLabel) ? (
        <>
          {isLoadingMeetingTemplate ? (
            <Form.Description text="Loading meeting template…" />
          ) : (
            <>
              <Form.TextField
                key={`${meetingTemplateKey}-meeting-name`}
                id="meetingName"
                title="Meeting Name"
                defaultValue={meetingTemplate?.meeting_name || ''}
              />
              <Form.Dropdown
                key={`${meetingTemplateKey}-timezone`}
                id="recruitTimeZone"
                title="Recruit Time Zone"
                defaultValue={
                  meetingTemplate?.selected_recruit_timezone ||
                  meetingTemplate?.recruit_timezone_options.find((option) => option.selected)
                    ?.value ||
                  'EST'
                }
              >
                {(meetingTemplate?.recruit_timezone_options || []).map((option) => (
                  <Form.Dropdown.Item
                    key={option.value}
                    value={option.value}
                    title={option.label}
                  />
                ))}
              </Form.Dropdown>
              <Form.TextArea
                key={`${meetingDetailsKey}-details`}
                id="meetingDetails"
                title="Meeting Set Details"
                defaultValue={meetingTemplate?.details_template || buildFallbackMeetingDetails()}
              />
              <Form.Dropdown
                id="meetingFor"
                title="Head Scout"
                value={selectedMeetingFor}
                onChange={setSelectedMeetingFor}
              >
                {HEAD_SCOUT_ORDER.map((scout) => (
                  <Form.Dropdown.Item
                    key={scout.meeting_for}
                    value={scout.meeting_for}
                    title={`${scout.scout_name} • ${scout.city}, ${scout.state}`}
                  />
                ))}
              </Form.Dropdown>
              <Form.Dropdown
                key={`${selectedStage}-${selectedMeetingFor}-open-meetings`}
                id="openMeetingId"
                title="Open Meeting"
                value={selectedOpenMeetingId}
                onChange={setSelectedOpenMeetingId}
              >
                {meetingSlotsForDropdown.map((slot) => (
                  <Form.Dropdown.Item
                    key={slot.open_event_id}
                    value={slot.open_event_id}
                    title={`${slot.date_time_label} • ${slot.assigned_owner}`}
                  />
                ))}
              </Form.Dropdown>
              {isLoadingOpenMeetings ? <Form.Description text="Loading open meetings…" /> : null}
              {!isLoadingOpenMeetings && !meetingSlotsForDropdown.length ? (
                <Form.Description text="No open meetings found for selected scout." />
              ) : null}
              <Form.TextField
                id="legacyMeetingLength"
                title="Meeting Length"
                value={meetingLength}
                onChange={setMeetingLength}
              />
            </>
          )}
        </>
      ) : null}

      {isReschedulePendingStage(selectedStageLabel) ||
      isCanceledPostMeetingStage(selectedStageLabel) ? (
        <>
          <Form.Separator />
          <Form.TextField
            id="reschedulePendingNoteTitle"
            title="Note Title"
            defaultValue={getPostMeetingOperatorNoteTitle(selectedStageLabel)}
          />
          <Form.TextArea
            id="reschedulePendingNoteDescription"
            title={
              isCanceledPostMeetingStage(selectedStageLabel)
                ? 'Why It Was Canceled'
                : 'Why They Rescheduled'
            }
          />
        </>
      ) : null}
    </Form>
  );
}

function ScoutPrepDetail({
  task,
  onReturnToRootList,
}: {
  task: ScoutPortalTask;
  onReturnToRootList?: () => void;
}) {
  const { push, pop } = useNavigation();
  const [markdown, setMarkdown] = useState<string>('Loading scout prep...');
  const [metadata, setMetadata] = useState<any>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompletingTask, setIsCompletingTask] = useState(false);
  const [context, setContext] = useState<Awaited<ReturnType<typeof loadScoutPrepContext>> | null>(
    null,
  );
  const highSchoolCopyLabel = buildHighSchoolCopyLabel(context);
  const showDirectCompleteAction = canCompleteTaskFromActionPanel(task);

  async function returnToRootListAndCloseDetail() {
    await popViewsThenRefreshRoot(pop, 1, onReturnToRootList);
  }

  async function syncContactCacheBestEffort(
    activeContext: ScoutPrepContext,
    crmStage: string | null,
    source: string,
  ) {
    try {
      await syncAthleteContactCacheFromScoutPrepContext({
        context: activeContext,
        crmStage,
        source,
        seenAt: new Date().toISOString(),
      });
    } catch (error) {
      logFailure(
        'SCOUT_PREP_CONTACT_CACHE_SYNC',
        'supabase-write',
        error instanceof Error ? error.message : String(error),
        {
          contactId: activeContext.task.contact_id,
          athleteMainId:
            activeContext.resolved.athlete_main_id || activeContext.task.athlete_main_id,
          source,
        },
      );
    }
  }

  function queueContactCacheSync(
    activeContext: ScoutPrepContext,
    crmStage: string | null,
    source: string,
  ) {
    setTimeout(() => {
      void syncContactCacheBestEffort(activeContext, crmStage, source);
    }, 0);
  }

  function renderScoutPrepContext(activeContext: ScoutPrepContext) {
    const values = buildScoutPrepValues({
      athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
      parent1Name: activeContext.contactInfo.parent1?.name || undefined,
      parent2Name: activeContext.contactInfo.parent2?.name || undefined,
      gradYear: task.grad_year,
      sport: activeContext.resolved.sport || undefined,
    });

    setContext(activeContext);
    setMetadata(buildScoutPrepMetadata(values, activeContext));
    setMarkdown(buildScoutPrepDetailMarkdown(values, activeContext));
  }

  async function loadLiveScoutPrepContextForDetail() {
    const { context: renderContext } = await loadScoutPrepContextForDisplay(task, {
      forceLive: true,
    });
    return renderContext;
  }

  async function handleRefreshScoutPrep() {
    const toast = await showLoadingToast('Refreshing', task.athlete_name);
    try {
      const refreshedContext = await loadLiveScoutPrepContextForDetail();
      renderScoutPrepContext(refreshedContext);
      setIsLoading(false);
      queueContactCacheSync(refreshedContext, null, 'scout_prep_manual_refresh');
      toast.style = Toast.Style.Success;
      toast.title = 'Scout Prep refreshed';
      toast.message = undefined;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Refresh failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function ensureContext(
    loadingTitle: string,
    loadingMessage: string,
    failureTitle: string,
  ): Promise<ScoutPrepContext | null> {
    if (context) {
      return context;
    }

    const toast = await showLoadingToast(loadingTitle, loadingMessage);
    try {
      const loadedContext = await loadLiveScoutPrepContextForDetail();
      setContext(loadedContext);
      queueContactCacheSync(loadedContext, null, 'scout_prep_context_load');
      toast.hide();
      return loadedContext;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = failureTitle;
      toast.message = error instanceof Error ? error.message : 'Unknown error';
      return null;
    }
  }

  async function handleCreateReminder(mode: ReminderMode) {
    const activeContext =
      context ||
      (await ensureContext(
        mode === 'call' ? 'Call reminder' : 'Text reminder',
        task.athlete_name,
        'Failed to load contact data',
      ));
    if (!activeContext) {
      return;
    }

    const options = mapAssociatedContactsToReminderOptions(
      getProspectContactShortcutCandidates(activeContext),
    );
    if (!options.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No reminder contact',
      });
      return;
    }

    const createForOption = async (option: ReminderContactOption, remindAt?: Date) => {
      const toast = await showLoadingToast(
        mode === 'call' ? 'Call reminder' : 'Text reminder',
        option.name,
      );
      try {
        await createReminder(
          buildReminderDraft({
            mode,
            athleteName: activeContext?.contactInfo.studentAthlete.name || task.athlete_name,
            contactName: option.name,
            phone: option.phone,
            contactId: String(task.contact_id || '').trim(),
            athleteMainId: String(
              activeContext?.resolved.athlete_main_id || task.athlete_main_id || '',
            ).trim(),
            remindAt,
          }),
        );
        toast.hide();
        await showToast({
          style: Toast.Style.Success,
          title: mode === 'call' ? 'Call reminder set' : 'Text reminder set',
          message: option.name,
        });
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Reminder failed';
        toast.message = error instanceof Error ? error.message : String(error);
      }
    };

    push(
      <ReminderRecipientForm
        navigationTitle={`${mode === 'call' ? 'Call' : 'Text'} Reminder • ${task.athlete_name}`}
        options={options}
        defaultRecipientId={options[0]?.id}
        actionTitle={mode === 'call' ? 'Create Call Reminder' : 'Create Text Reminder'}
        mode={mode}
        onSubmit={async (values) => {
          const selected =
            options.find((option) => option.id === values.recipientId) || options[0] || null;
          if (!selected) {
            throw new Error('No reminder contact selected');
          }
          await createForOption(selected, values.remindAt);
        }}
      />,
    );
  }

  async function handleTranslateName() {
    const activeContext =
      context ||
      (await ensureContext('Translate name', task.athlete_name, 'Failed to load contact data'));
    if (!activeContext) {
      return;
    }

    const options = getScoutPrepTranslateNameOptions(activeContext);
    if (!options.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No contact',
      });
      return;
    }

    push(
      <ScoutPrepTranslateNameForm
        options={options}
        defaultOptionId={options.find((option) => option.id === 'parent1')?.id || options[0]?.id}
      />,
    );
  }

  async function handleClientOutreach() {
    const activeContext =
      context ||
      (await ensureContext('Client Outreach', task.athlete_name, 'Failed to load contact data'));
    if (!activeContext) {
      return;
    }

    const toast = await showLoadingToast('Outreach', 'Loading contacts');
    const recipients = getVoicemailFollowUpRecipients(activeContext);
    if (!recipients.length) {
      toast.style = Toast.Style.Failure;
      toast.title = 'No usable number';
      toast.message = 'No Messages-safe number.';
      return;
    }

    toast.hide();
    push(
      <VoicemailFollowUpRecipientForm
        task={task}
        context={activeContext}
        currentTask={task.title || null}
        onComplete={onReturnToRootList}
        closeAfterCompleteViews={2}
      />,
    );
  }

  async function resolveNotesContext(options?: {
    loadingTitle?: string;
  }): Promise<ScoutPrepContext | null> {
    return ensureContext(options?.loadingTitle || 'Loading notes', task.athlete_name, 'Missing ID');
  }

  async function handleViewNotes() {
    const notesContext = await resolveNotesContext({ loadingTitle: 'Loading notes' });
    if (!notesContext) {
      return;
    }
    push(
      <AthleteNotesList
        athleteId={String(notesContext.task.contact_id)}
        athleteMainId={String(
          notesContext.resolved.athlete_main_id || notesContext.task.athlete_main_id,
        )}
        athleteName={notesContext.contactInfo.studentAthlete.name || task.athlete_name}
      />,
    );
  }

  async function handleAddNote() {
    const notesContext = await resolveNotesContext({ loadingTitle: 'Add note' });
    if (!notesContext) {
      return;
    }
    push(
      <AddAthleteNoteForm
        athleteId={String(notesContext.task.contact_id)}
        athleteMainId={String(
          notesContext.resolved.athlete_main_id || notesContext.task.athlete_main_id,
        )}
        athleteName={notesContext.contactInfo.studentAthlete.name || task.athlete_name}
        onComplete={() => pop()}
      />,
    );
  }

  async function handleSetConfirmationMorning() {
    const activeContext =
      context ||
      (await ensureContext('Loading meeting', task.athlete_name, 'Missing task context'));
    if (!activeContext) {
      return;
    }

    const confirmationTask = resolveConfirmationTaskForMorningAction(task, activeContext);
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation task',
      });
      return;
    }

    const toast = await showLoadingToast('Saving', 'Meeting morning');
    try {
      const nextDueAt = await updateConfirmationTaskToMeetingMorning({
        task,
        activeContext,
        confirmationTask,
      });
      await completeScoutPrepMutationSuccess({
        toast,
        title: 'Completed',
        message: `${formatDateForLegacyInput(nextDueAt)} 09:00`,
        onReturnToRootList: returnToRootListAndCloseDetail,
      });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Complete failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function handleCompleteTask() {
    if (isCompletingTask) return;

    setIsCompletingTask(true);
    const toast = await showLoadingToast('Completing', getTaskDisplayTitle(task));
    try {
      const needsContext = !task.task_id || !task.athlete_main_id;
      let activeContext = context;
      if (!activeContext && needsContext) {
        activeContext = await loadLiveScoutPrepContextForDetail();
        setContext(activeContext);
      }
      const completedTask = await completeScoutPrepTaskDirectly({
        task,
        context: activeContext,
      });
      await completeScoutPrepMutationSuccess({
        toast,
        title: 'Completed',
        message: getTaskDisplayTitle(completedTask),
        onReturnToRootList: returnToRootListAndCloseDetail,
      });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Complete failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsCompletingTask(false);
    }
  }

  async function handleSyncCallPrepToNotion() {
    if (isLoading || /^Loading scout prep/i.test(markdown.trim())) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Scout Prep loading',
        message: 'Wait for script.',
      });
      return;
    }

    const toast = await showLoadingToast('Syncing Notion', 'Toggles');

    try {
      let activeContext = context;
      if (!activeContext) {
        activeContext = await loadScoutPrepContext(task);
        setContext(activeContext);
      }

      const parentName = getScoutPrepParentOptions(activeContext)[0]?.name || 'Parent';
      const selectedCrmStage = await getSelectedCrmStageLabel(task.contact_id).catch(() => null);
      const followUpTask = findNewestIncompleteFollowUpTask(activeContext.tasks);
      const currentVoicemailTask = [
        stripMoveThisTaskPrefix(followUpTask?.title) || task.title || null,
        followUpTask?.description || task.description || null,
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
      const athleteGender = await resolveAthleteGenderWithRayAI({
        athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
        sport: activeContext.resolved.sport,
      }).catch(() => null);
      const voicemail = buildScoutPrepLeavingVoicemailBody({
        parentName,
        athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
        sport: activeContext.resolved.sport,
        athleteGender,
        crmStage: selectedCrmStage,
        currentTask: currentVoicemailTask || task.title || null,
      });
      const fallbackTemplate = hydrateMeetingSetTemplateForForm(
        buildFallbackMeetingTemplate(),
        activeContext,
        {
          athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
          gradYear: task.grad_year,
        },
      );
      const callNotes = buildMeetingSetCallNotesMarkdown({
        meetingDetails: fallbackTemplate.details_template || buildFallbackMeetingDetails(),
      });

      const [scriptResult, voicemailResult] = await Promise.all([
        syncCallScriptToggleToNotion({
          target: 'script',
          markdown,
        }),
        syncCallScriptToggleToNotion({
          target: 'voicemail',
          markdown: voicemail,
        }),
        syncCallNotesPageToNotion({
          markdown: callNotes,
          toggleTitle: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
        }),
      ]);

      toast.style = Toast.Style.Success;
      toast.title = 'Notion synced';
      toast.message = `${scriptResult.toggleTitle} + ${voicemailResult.toggleTitle} + Call Notes`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Notion sync failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function handleResolveMaxPrepsContext() {
    const activeContext =
      context || (await ensureContext('MaxPreps', task.athlete_name, 'Missing Scout Prep context'));
    if (!activeContext) {
      return;
    }

    if (
      !activeContext.resolved.high_school ||
      !activeContext.resolved.state ||
      !activeContext.resolved.sport
    ) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing school context',
        message: 'Needs school, state, and sport.',
      });
      return;
    }

    const toast = await showLoadingToast('MaxPreps', activeContext.resolved.high_school);
    try {
      const cacheInput = buildMaxPrepsCacheInput(activeContext, task);
      const cached = await getCachedScoutPrepMaxPrepsContext(cacheInput);
      if (cached?.isFresh) {
        const nextContext = mergeMaxPrepsContext(activeContext, cached.data);
        const values = buildScoutPrepValues({
          athleteName: nextContext.contactInfo.studentAthlete.name || task.athlete_name,
          parent1Name: nextContext.contactInfo.parent1?.name || undefined,
          parent2Name: nextContext.contactInfo.parent2?.name || undefined,
          gradYear: task.grad_year,
          sport: nextContext.resolved.sport || undefined,
        });

        setContext(nextContext);
        setMetadata(buildScoutPrepMetadata(values, nextContext));
        setMarkdown(buildScoutPrepDetailMarkdown(values, nextContext));
        await setCachedScoutPrepContext(task, nextContext);
        toast.style = Toast.Style.Success;
        toast.title = 'MaxPreps cached';
        toast.message = formatMaxPrepsToastMessage(cached.data);
        return;
      }

      const result = await resolveMaxPrepsScoutContext({
        ...cacheInput,
        city: activeContext.resolved.city,
        state: formatStateForHighSchoolCopy(activeContext.resolved.state),
        maxPrepsUrl: activeContext.resolved.maxpreps?.url || activeContext.resolved.maxpreps_url,
        searchLabel: buildMaxPrepsSearchLabel({
          highSchool: activeContext.resolved.high_school,
          state: activeContext.resolved.state,
          sport: activeContext.resolved.sport,
        }),
      });
      if (!result) {
        toast.style = Toast.Style.Failure;
        toast.title = 'No MaxPreps match';
        toast.message = 'No confirmed team page.';
        return;
      }

      await setCachedScoutPrepMaxPrepsContext(cacheInput, result);
      const nextContext = mergeMaxPrepsContext(activeContext, result);
      const values = buildScoutPrepValues({
        athleteName: nextContext.contactInfo.studentAthlete.name || task.athlete_name,
        parent1Name: nextContext.contactInfo.parent1?.name || undefined,
        parent2Name: nextContext.contactInfo.parent2?.name || undefined,
        gradYear: task.grad_year,
        sport: nextContext.resolved.sport || undefined,
      });

      setContext(nextContext);
      setMetadata(buildScoutPrepMetadata(values, nextContext));
      setMarkdown(buildScoutPrepDetailMarkdown(values, nextContext));
      await setCachedScoutPrepContext(task, nextContext);
      toast.style = Toast.Style.Success;
      toast.title = 'MaxPreps resolved';
      toast.message = formatMaxPrepsToastMessage(result);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'MaxPreps failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      try {
        logInfo('SCOUT_PREP_DETAIL_LOAD', 'load-detail', 'start', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          athleteName: task.athlete_name,
        });

        const { context: renderContext, source } = await loadScoutPrepContextForDisplay(task);

        if (!active) {
          return;
        }

        renderScoutPrepContext(renderContext);
        setIsLoading(false);
        if (source === 'live') {
          queueContactCacheSync(renderContext, null, 'scout_prep_detail_load');
        }
        logInfo('SCOUT_PREP_DETAIL_LOAD', 'load-detail', 'success', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          athleteName: renderContext.contactInfo.studentAthlete.name || task.athlete_name,
          source,
        });

        // Local transformer-based enrichment is intentionally disabled for now.
        // Scout Prep should stay deterministic until the optional model path is restored.
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setMarkdown(`# Scout Prep\n\nFailed to load live scout prep.\n\n${message}`);
        logFailure('SCOUT_PREP_DETAIL_LOAD', 'load-detail', message, {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
        });
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [task]);

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={`Scout Prep • ${task.athlete_name}`}
      markdown={markdown}
      metadata={metadata}
      actions={
        <ActionPanel>
          <Action
            title="Post-Call Update"
            icon="🚀"
            onAction={() =>
              push(
                <PostCallUpdateForm
                  task={task}
                  onSaved={onReturnToRootList}
                  closeAfterSaveViews={2}
                />,
              )
            }
          />
          <Action title="Client Outreach" icon="💬" onAction={() => void handleClientOutreach()} />
          <ActionPanel.Section title="Workflow">
            <Action
              title="Create Call Reminder"
              icon="☎️"
              shortcut={{ modifiers: ['cmd'], key: '3' }}
              onAction={() => void handleCreateReminder('call')}
            />
            <Action
              title="Create Text Reminder"
              icon="🔔"
              shortcut={{ modifiers: ['cmd'], key: '4' }}
              onAction={() => void handleCreateReminder('text')}
            />
            <Action
              title="Sync Notion Call Prep"
              icon="⬆️"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
              onAction={() => void handleSyncCallPrepToNotion()}
            />
            <Action
              title="Refresh Scout Prep"
              icon="🔄"
              shortcut={{ modifiers: ['cmd', 'opt'], key: 'r' }}
              onAction={() => void handleRefreshScoutPrep()}
            />
            <Action
              title="Move CF Task"
              icon="🕘"
              shortcut={{ modifiers: ['cmd'], key: 's' }}
              onAction={() => void handleSetConfirmationMorning()}
            />
            {showDirectCompleteAction ? (
              <Action
                title={isCompletingTask ? 'Completing…' : 'Complete Task'}
                icon="✅"
                shortcut={{ modifiers: ['cmd'], key: 'j' }}
                onAction={() => void handleCompleteTask()}
              />
            ) : null}
            <Action.Push
              title="Update Task"
              icon="✏️"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
              target={
                <UpdateAthleteTaskPicker
                  task={task}
                  initialContext={context}
                  onTaskMutationComplete={onReturnToRootList}
                  closeAfterMutationViews={2}
                />
              }
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Athlete Info">
            <Action.Push
              title="Contact Info"
              icon="☎️"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
              target={<ScoutPrepContactDetail task={task} initialContext={context} />}
            />
            <Action
              title="Open Client Messages"
              icon="💬"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
              onAction={() => void openClientMessagesFromScoutPrepTask(task)}
            />
            <Action
              title="Translate Name"
              icon="🌐"
              shortcut={{ modifiers: ['cmd'], key: 'l' }}
              onAction={() => void handleTranslateName()}
            />
            <Action.Push
              title="Head Scout Schedules"
              icon="📅"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
              target={
                context ? (
                  <HeadScoutSchedulesRoot
                    syncContext={{
                      task,
                      context,
                      markdown,
                    }}
                  />
                ) : (
                  <HeadScoutSchedulesRoot />
                )
              }
            />
            <Action.OpenInBrowser
              title="Open Athlete Admin Page"
              icon="🌏"
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
              url={buildScoutPrepAdminUrl(
                task,
                context?.resolved.athlete_main_id || context?.task.athlete_main_id,
              )}
            />
            <Action.OpenInBrowser
              title="Open Athlete Task Tab"
              icon="🌏"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
              url={buildScoutPrepTaskUrl(
                task,
                context?.resolved.athlete_main_id || context?.task.athlete_main_id,
              )}
            />
            <Action.OpenInBrowser
              title="Open Player ID"
              icon="🌏"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
              url={buildScoutPrepPlayerIdUrl(task, context?.resolved.athlete_id)}
            />
            {highSchoolCopyLabel ? (
              <Action
                title="Open MaxPreps Search"
                icon="🔎"
                shortcut={{ modifiers: ['cmd'], key: 'h' }}
                onAction={() => void triggerMaxPrepsSearch(highSchoolCopyLabel)}
              />
            ) : null}
            {highSchoolCopyLabel ? (
              <Action
                title="Resolve MaxPreps Context"
                icon="🏈"
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                onAction={() => void handleResolveMaxPrepsContext()}
              />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section title="Athlete Note">
            <Action
              title="View Notes"
              icon="📋"
              shortcut={{ modifiers: ['cmd'], key: 'n' }}
              onAction={() => void handleViewNotes()}
            />
            <Action
              title="Add Note"
              icon="➕"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
              onAction={() => void handleAddNote()}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ScoutPrepTaskItem({
  task,
  taskListFilter,
  taskListSort,
  dailyCallBlocksActionTitle,
  batchVoicemailTarget,
  onExportDailyCallBlocks,
  onToggleProspectSearchMode,
  personalFollowUpsTarget,
  onAddPersonalFollowUpFromTask,
  onSelectTaskListFilter,
  onCycleTaskListSort,
  onReturnToRootList,
}: {
  task: ScoutPortalTask;
  taskListFilter: TaskListFilter;
  taskListSort: TaskListSort;
  dailyCallBlocksActionTitle: string;
  batchVoicemailTarget: ReactNode;
  onExportDailyCallBlocks: () => void;
  onToggleProspectSearchMode: () => void;
  personalFollowUpsTarget: ReactNode;
  onAddPersonalFollowUpFromTask: (task: ScoutPortalTask) => void;
  onSelectTaskListFilter: (filter: TaskListFilter) => void;
  onCycleTaskListSort: (key: TaskListSortKey) => void;
  onReturnToRootList: () => void;
}) {
  const { push, pop } = useNavigation();
  const [isCompletingTask, setIsCompletingTask] = useState(false);

  async function returnToRootListAndCloseCurrentView() {
    await popViewsThenRefreshRoot(pop, 1, onReturnToRootList);
  }

  async function ensureTaskContext(
    loadingTitle: string,
    failureTitle: string,
  ): Promise<ScoutPrepContext | null> {
    const toast = await showLoadingToast(loadingTitle, task.athlete_name);
    try {
      const context = await loadScoutPrepContext(task);
      toast.hide();
      return context;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = failureTitle;
      toast.message = error instanceof Error ? error.message : 'Unknown error';
      return null;
    }
  }

  async function handleCompleteTask() {
    if (isCompletingTask) return;

    setIsCompletingTask(true);
    const toast = await showLoadingToast('Completing', getTaskDisplayTitle(task));
    try {
      const needsContext = !task.task_id || !task.athlete_main_id;
      const context = needsContext ? await loadScoutPrepContext(task) : null;
      const completedTask = await completeScoutPrepTaskDirectly({ task, context });
      await completeScoutPrepMutationSuccess({
        toast,
        title: 'Completed',
        message: getTaskDisplayTitle(completedTask),
        onReturnToRootList,
      });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Complete failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsCompletingTask(false);
    }
  }

  async function handleClientOutreach() {
    const context = await ensureTaskContext('Client Outreach', 'Contact load failed');
    if (!context) {
      return;
    }

    const toast = await showLoadingToast('Outreach', 'Loading contacts');
    const recipients = getVoicemailFollowUpRecipients(context);
    if (!recipients.length) {
      toast.style = Toast.Style.Failure;
      toast.title = 'No usable number';
      return;
    }

    toast.hide();
    push(
      <VoicemailFollowUpRecipientForm
        task={task}
        context={context}
        currentTask={task.title || null}
        onComplete={onReturnToRootList}
        closeAfterCompleteViews={1}
      />,
    );
  }

  async function handleResolveMaxPrepsContextFromTask() {
    const toast = await showLoadingToast('MaxPreps', task.athlete_name);
    try {
      const { context } = await loadScoutPrepContextForDisplay(task);
      const highSchool = context.resolved.high_school || task.high_school;
      const state = context.resolved.state || task.state;
      const sport = context.resolved.sport || task.sport;
      if (!highSchool || !state || !sport) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Missing school context';
        return;
      }

      const cacheInput = buildMaxPrepsCacheInput(context, task);
      const cached = await getCachedScoutPrepMaxPrepsContext(cacheInput);
      if (cached?.isFresh) {
        const nextContext = mergeMaxPrepsContext(context, cached.data);
        await setCachedScoutPrepContext(task, nextContext);
        toast.style = Toast.Style.Success;
        toast.title = 'MaxPreps cached';
        toast.message = formatMaxPrepsToastMessage(cached.data);
        return;
      }

      const result = await resolveMaxPrepsScoutContext({
        athleteName: context.contactInfo.studentAthlete.name || task.athlete_name,
        highSchool,
        city: context.resolved.city,
        state: formatStateForHighSchoolCopy(state),
        sport,
        maxPrepsUrl: context.resolved.maxpreps?.url || context.resolved.maxpreps_url,
        searchLabel: buildMaxPrepsSearchLabel({
          highSchool,
          state,
          sport,
        }),
      });
      if (!result) {
        toast.style = Toast.Style.Failure;
        toast.title = 'No MaxPreps match';
        return;
      }

      await setCachedScoutPrepMaxPrepsContext(cacheInput, result);
      const nextContext = mergeMaxPrepsContext(context, result);
      await setCachedScoutPrepContext(task, nextContext);
      setTimeout(() => {
        void syncAthleteContactCacheFromScoutPrepContext({
          context: nextContext,
          crmStage: null,
          source: 'scout_prep_maxpreps_resolve',
          seenAt: new Date().toISOString(),
        }).catch((error) => {
          logFailure(
            'SCOUT_PREP_CONTACT_CACHE_SYNC',
            'supabase-write',
            error instanceof Error ? error.message : String(error),
            {
              contactId: nextContext.task.contact_id,
              athleteMainId:
                nextContext.resolved.athlete_main_id || nextContext.task.athlete_main_id,
              source: 'scout_prep_maxpreps_resolve',
            },
          );
        });
      }, 0);
      toast.style = Toast.Style.Success;
      toast.title = 'MaxPreps resolved';
      toast.message = formatMaxPrepsToastMessage(result);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'MaxPreps failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadTaskNotesContext(): Promise<ScoutPrepContext | null> {
    return ensureTaskContext('Loading notes', 'Missing ID');
  }

  async function handleViewNotes() {
    const context = await loadTaskNotesContext();
    if (!context) {
      return;
    }
    push(
      <AthleteNotesList
        athleteId={String(context.task.contact_id)}
        athleteMainId={String(context.resolved.athlete_main_id || context.task.athlete_main_id)}
        athleteName={context.contactInfo.studentAthlete.name || task.athlete_name}
      />,
    );
  }

  async function handleAddNote() {
    const context = await ensureTaskContext('Add note', 'Missing ID');
    if (!context) {
      return;
    }
    push(
      <AddAthleteNoteForm
        athleteId={String(context.task.contact_id)}
        athleteMainId={String(context.resolved.athlete_main_id || context.task.athlete_main_id)}
        athleteName={context.contactInfo.studentAthlete.name || task.athlete_name}
        onComplete={() => pop()}
      />,
    );
  }

  async function handleSetConfirmationMorning() {
    const activeContext = await ensureTaskContext('Loading meeting', 'Missing ID');
    if (!activeContext) {
      return;
    }

    const confirmationTask = resolveConfirmationTaskForMorningAction(task, activeContext);
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation task',
      });
      return;
    }

    const toast = await showLoadingToast('Saving', 'Meeting morning');
    try {
      const nextDueAt = await updateConfirmationTaskToMeetingMorning({
        task,
        activeContext,
        confirmationTask,
      });
      await completeScoutPrepMutationSuccess({
        toast,
        title: 'Completed',
        message: `${formatDateForLegacyInput(nextDueAt)} 09:00`,
        onReturnToRootList,
      });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Complete failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function handleDuplicateProfileCheck() {
    if (!isCallAttempt1PortalTask(task)) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Call Attempt 1 only',
      });
      return;
    }

    const toast = await showLoadingToast('Dup Check', task.athlete_name);
    try {
      const result = await runDuplicateProfileResolutionForTask(task);
      if (!result.completed.length && !result.skipped.length) {
        toast.style = Toast.Style.Success;
        toast.title = 'No duplicate';
        toast.message = task.athlete_name;
        return;
      }

      if (!result.completed.length && result.skipped.length) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Review duplicate';
        toast.message = result.skipped[0]?.reason || 'No duplicate task updated';
        return;
      }

      toast.style = result.skipped.length ? Toast.Style.Failure : Toast.Style.Success;
      toast.title = result.skipped.length ? 'Partial repeat' : 'Repeat marked';
      toast.message = result.skipped.length
        ? `${result.completed.length} marked, ${result.skipped.length} review`
        : `${result.completed.length} marked`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Check failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  const { shortDate, taskTitle, taskColor, gradYearColor } = getTaskAccessoryMetadata(task);
  const showDirectCompleteAction = canCompleteTaskFromActionPanel(task);
  const taskMaxPrepsSearchLabel = buildMaxPrepsSearchLabel({
    highSchool: task.high_school,
    state: task.state,
    sport: task.sport,
  });

  return (
    <List.Item
      id={buildScoutPrepTaskItemId(task)}
      key={buildScoutPrepTaskItemId(task)}
      icon="⭐"
      title={task.athlete_name}
      keywords={buildTaskSearchKeywords(task)}
      accessories={[
        ...(shortDate ? [{ text: shortDate }] : []),
        ...(taskTitle ? [{ tag: { value: taskTitle, color: taskColor } }] : []),
        ...(task.grad_year ? [{ tag: { value: task.grad_year, color: gradYearColor } }] : []),
      ]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Build Scout Prep"
            icon="❇️"
            target={<ScoutPrepDetail task={task} onReturnToRootList={onReturnToRootList} />}
          />
          <Action title="Client Outreach" icon="💬" onAction={() => void handleClientOutreach()} />
          <ActionPanel.Section title="Workflow">
            <Action
              title="Post-Call Update"
              icon="🚀"
              shortcut={{ modifiers: ['cmd'], key: 'u' }}
              onAction={() =>
                push(
                  <PostCallUpdateForm
                    task={task}
                    onSaved={returnToRootListAndCloseCurrentView}
                    closeAfterSaveViews={0}
                  />,
                )
              }
            />
            <Action
              title={dailyCallBlocksActionTitle}
              icon="📅"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
              onAction={onExportDailyCallBlocks}
            />
            <Action.Push
              title="Batch Operations"
              icon="💬"
              shortcut={{ modifiers: ['cmd', 'shift'], key: '0' }}
              target={batchVoicemailTarget}
            />
            <Action
              title="Move CF Task"
              icon="🕘"
              shortcut={{ modifiers: ['cmd'], key: 's' }}
              onAction={() => void handleSetConfirmationMorning()}
            />
            {showDirectCompleteAction ? (
              <Action
                title={isCompletingTask ? 'Completing…' : 'Complete Task'}
                icon="✅"
                shortcut={{ modifiers: ['cmd'], key: 'j' }}
                onAction={() => void handleCompleteTask()}
              />
            ) : null}
            <Action.Push
              title="Update Task"
              icon="✏️"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
              target={
                <UpdateAthleteTaskPicker task={task} onTaskMutationComplete={onReturnToRootList} />
              }
            />
            <Action
              title="Duplicate Profile Check"
              icon="👤"
              shortcut={{ modifiers: ['cmd'], key: 'd' }}
              onAction={() => void handleDuplicateProfileCheck()}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Follow-Ups">
            <Action
              title="Save Follow-Up"
              icon="🕘"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
              onAction={() => onAddPersonalFollowUpFromTask(task)}
            />
            <Action.Push
              title="Personal Follow-Ups"
              icon="🕘"
              shortcut={{ modifiers: ['cmd'], key: 'f' }}
              target={personalFollowUpsTarget}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Athlete Info">
            <Action
              title="Copy Athlete Name"
              icon="🖇️"
              shortcut={{ modifiers: ['cmd'], key: 'c' }}
              onAction={() => void copyToClipboardWithToast(task.athlete_name, 'Athlete')}
            />
            <Action.Push
              title="Contact Info"
              icon="☎️"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
              target={<ScoutPrepContactDetail task={task} />}
            />
            <Action
              title="Open Client Messages"
              icon="💬"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
              onAction={() => void openClientMessagesFromScoutPrepTask(task)}
            />
            <Action.Push
              title="Head Scout Schedules"
              icon="📅"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
              target={<HeadScoutSchedulesRoot />}
            />
            <Action.OpenInBrowser
              title="Open Athlete Admin Page"
              icon="🌏"
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
              url={buildScoutPrepAdminUrl(task)}
            />
            <Action.OpenInBrowser
              title="Open Athlete Task Tab"
              icon="🌏"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
              url={buildScoutPrepTaskUrl(task)}
            />
            <Action.OpenInBrowser
              title="Open Player ID"
              icon="🌏"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
              url={buildScoutPrepPlayerIdUrl(task)}
            />
            {taskMaxPrepsSearchLabel ? (
              <Action
                title="Open MaxPreps Search"
                icon="🔎"
                shortcut={{ modifiers: ['cmd'], key: 'h' }}
                onAction={() => void triggerMaxPrepsSearch(taskMaxPrepsSearchLabel)}
              />
            ) : null}
            {taskMaxPrepsSearchLabel ? (
              <Action
                title="Resolve MaxPreps Context"
                icon="🏈"
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
                onAction={() => void handleResolveMaxPrepsContextFromTask()}
              />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section title="Athlete Note">
            <Action
              title="View Notes"
              icon="📋"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
              onAction={() => void handleViewNotes()}
            />
            <Action
              title="Add Note"
              icon="➕"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
              onAction={() => void handleAddNote()}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Navigation">
            <Action
              title="Show Today/PastDue"
              shortcut={{ modifiers: ['opt'], key: '1' }}
              onAction={() => onSelectTaskListFilter('todayPastDue')}
            />
            <Action
              title="Show Tomorrow"
              shortcut={{ modifiers: ['opt'], key: '2' }}
              onAction={() => onSelectTaskListFilter('tomorrow')}
            />
            <Action
              title="Show Future"
              shortcut={{ modifiers: ['opt'], key: '3' }}
              onAction={() => onSelectTaskListFilter('future')}
            />
            <Action
              title="Show All"
              shortcut={{ modifiers: ['opt'], key: '4' }}
              onAction={() => onSelectTaskListFilter('all')}
            />
            <Action
              title="Prospect Search"
              icon="🔎"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
              onAction={onToggleProspectSearchMode}
            />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
          <ActionPanel.Section title="Sort">
            <Action
              title={getSortActionTitle(taskListSort, 'gradYear')}
              icon="↕️"
              shortcut={{ modifiers: ['cmd'], key: 'n' }}
              onAction={() => onCycleTaskListSort('gradYear')}
            />
            <Action
              title={getSortActionTitle(taskListSort, 'callAttempt')}
              icon="↕️"
              shortcut={{ modifiers: ['cmd'], key: 'm' }}
              onAction={() => onCycleTaskListSort('callAttempt')}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ProspectSearchListItem({
  result,
  index,
  searchMode,
  onToggleProspectSearchModeType,
  onToggleProspectSearchMode,
  onAddPersonalFollowUp,
  onReturnToRootList,
}: {
  result: ProspectResult;
  index: number;
  searchMode: ProspectSearchMode;
  onToggleProspectSearchModeType: () => void;
  onToggleProspectSearchMode: () => void;
  onAddPersonalFollowUp: (result: ProspectResult, searchMode: ProspectSearchMode) => void;
  onReturnToRootList: () => void;
}) {
  const scoutPrepTask = buildScoutPrepTaskFromProspect(result);
  const location = [result.city, result.state].filter(Boolean).join(', ');
  const isParentMode = searchMode === 'parent';
  const parentName = result.parent_name || (isParentMode ? result.name : null);
  const parentEmail = result.parent_email || (isParentMode ? result.email : null);
  const parentPhone = result.parent_phone || (isParentMode ? result.phone : null);
  const parentPhoneColor = [Color.Red, Color.Green, Color.Blue][index % 3];
  const markdown = [
    `# ${result.name || `Athlete ${result.athlete_id}`}`,
    '',
    ...(isParentMode
      ? [
          `- Parent: ${parentName || 'N/A'}`,
          `- Parent Email: ${parentEmail || 'N/A'}`,
          `- Parent Phone: ${parentPhone || 'N/A'}`,
        ]
      : []),
    `- Athlete ID: ${result.athlete_id || 'N/A'}`,
    `- Athlete Main ID: ${result.athlete_main_id || 'N/A'}`,
    `- Grad Year: ${result.grad_year || 'N/A'}`,
    `- Sport: ${result.sport || 'N/A'}`,
    `- High School: ${result.high_school || 'N/A'}`,
    `- Location: ${location || 'N/A'}`,
    `- Email: ${result.email || 'N/A'}`,
  ].join('\n');

  return (
    <List.Item
      key={`prospect:${result.athlete_id}:${result.athlete_main_id || 'missing-main-id'}`}
      icon={isParentMode ? '👤' : '🔎'}
      title={
        isParentMode
          ? parentName || result.name || `Parent ${result.athlete_id}`
          : result.name || `Athlete ${result.athlete_id}`
      }
      subtitle={
        isParentMode
          ? [result.name, parentEmail].filter(Boolean).join(' • ') || result.athlete_id
          : [
              result.grad_year ? `Class ${result.grad_year}` : null,
              result.sport,
              result.high_school,
            ]
              .filter(Boolean)
              .join(' • ') || result.athlete_id
      }
      accessories={
        isParentMode && parentPhone
          ? [{ tag: { value: parentPhone, color: parentPhoneColor } }]
          : undefined
      }
      detail={<List.Item.Detail markdown={markdown} />}
      actions={
        <ActionPanel>
          {scoutPrepTask ? (
            <Action.Push
              title="Build Scout Prep"
              icon="❇️"
              target={
                <ScoutPrepDetail task={scoutPrepTask} onReturnToRootList={onReturnToRootList} />
              }
            />
          ) : null}
          <Action.OpenInBrowser
            title="Open Prospect Profile"
            icon="🌏"
            url={
              result.url?.startsWith('http')
                ? result.url
                : result.url
                  ? `https://dashboard.nationalpid.com${result.url}`
                  : `https://dashboard.nationalpid.com/athlete/profile/${result.athlete_id}`
            }
          />
          <Action
            title="Save Follow-Up"
            icon="🕘"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
            onAction={() => onAddPersonalFollowUp(result, searchMode)}
          />
          <ActionPanel.Section title="Navigation">
            <Action
              title={isParentMode ? 'Switch to Athlete Search' : 'Switch to Parent Search'}
              icon="👤"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
              onAction={onToggleProspectSearchModeType}
            />
            <Action title="Exit Prospect Search" icon="🔎" onAction={onToggleProspectSearchMode} />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function PersonalFollowUpListItem({
  entry,
  onRemove,
  onExit,
  onReturnToRootList,
}: {
  entry: PersonalFollowUpEntry;
  onRemove: (entry: PersonalFollowUpEntry) => void;
  onExit: () => void;
  onReturnToRootList: () => void;
}) {
  const { push } = useNavigation();
  const { result, searchMode } = entry;
  const scoutPrepTask = buildScoutPrepTaskFromProspect(result);
  const isParentMode = searchMode === 'parent';
  const parentName = result.parent_name || (isParentMode ? result.name : null);
  const parentEmail = result.parent_email || (isParentMode ? result.email : null);
  const parentPhone = result.parent_phone || (isParentMode ? result.phone : null);
  const location = [result.city, result.state].filter(Boolean).join(', ');
  const addedAt = new Date(entry.addedAt);
  const addedLabel = Number.isNaN(addedAt.getTime())
    ? null
    : addedAt.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  const markdown = [
    `# ${isParentMode ? parentName || result.name : result.name || `Athlete ${result.athlete_id}`}`,
    '',
    `- Saved: ${addedLabel || 'N/A'}`,
    `- Search Type: ${isParentMode ? 'Parent' : 'Athlete'}`,
    ...(isParentMode
      ? [
          `- Parent: ${parentName || 'N/A'}`,
          `- Parent Email: ${parentEmail || 'N/A'}`,
          `- Parent Phone: ${parentPhone || 'N/A'}`,
        ]
      : []),
    `- Athlete: ${result.name || 'N/A'}`,
    `- Athlete ID: ${result.athlete_id || 'N/A'}`,
    `- Athlete Main ID: ${result.athlete_main_id || 'N/A'}`,
    `- Grad Year: ${result.grad_year || 'N/A'}`,
    `- Sport: ${result.sport || 'N/A'}`,
    `- High School: ${result.high_school || 'N/A'}`,
    `- Location: ${location || 'N/A'}`,
  ].join('\n');

  async function handleCreateCallReminder() {
    if (!scoutPrepTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete ID',
      });
      return;
    }

    const toast = await showLoadingToast('Call reminder', scoutPrepTask.athlete_name);
    try {
      const context = await loadScoutPrepContext(scoutPrepTask);
      const options = mapAssociatedContactsToReminderOptions(
        getProspectContactShortcutCandidates(context),
      );
      if (!options.length) {
        toast.style = Toast.Style.Failure;
        toast.title = 'No reminder contact';
        return;
      }

      toast.hide();
      push(
        <ReminderRecipientForm
          navigationTitle={`Call Reminder • ${scoutPrepTask.athlete_name}`}
          options={options}
          defaultRecipientId={options[0]?.id}
          actionTitle="Create Call Reminder"
          mode="call"
          onSubmit={async (values) => {
            const selected =
              options.find((option) => option.id === values.recipientId) || options[0] || null;
            if (!selected) {
              throw new Error('No reminder contact selected');
            }

            const reminderToast = await showLoadingToast('Call reminder', selected.name);
            try {
              await createReminder(
                buildReminderDraft({
                  mode: 'call',
                  athleteName:
                    context.contactInfo.studentAthlete.name || scoutPrepTask.athlete_name,
                  contactName: selected.name,
                  phone: selected.phone,
                  contactId: String(scoutPrepTask.contact_id || '').trim(),
                  athleteMainId: String(
                    context.resolved.athlete_main_id || scoutPrepTask.athlete_main_id || '',
                  ).trim(),
                  remindAt: values.remindAt,
                }),
              );
              reminderToast.hide();
              await showToast({
                style: Toast.Style.Success,
                title: 'Call reminder set',
                message: selected.name,
              });
            } catch (error) {
              reminderToast.style = Toast.Style.Failure;
              reminderToast.title = 'Reminder failed';
              reminderToast.message = error instanceof Error ? error.message : String(error);
            }
          }}
        />,
      );
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Reminder failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <List.Item
      key={entry.id}
      icon={isParentMode ? '👤' : '🕘'}
      title={
        isParentMode
          ? parentName || result.name || `Parent ${result.athlete_id}`
          : result.name || `Athlete ${result.athlete_id}`
      }
      subtitle={
        isParentMode
          ? [result.name, parentPhone].filter(Boolean).join(' • ') || 'Personal follow-up'
          : [
              result.grad_year ? `Class ${result.grad_year}` : null,
              result.sport,
              result.high_school,
            ]
              .filter(Boolean)
              .join(' • ') || 'Personal follow-up'
      }
      accessories={addedLabel ? [{ text: addedLabel }] : undefined}
      detail={<List.Item.Detail markdown={markdown} />}
      actions={
        <ActionPanel>
          {scoutPrepTask ? (
            <Action.Push
              title="Build Scout Prep"
              icon="❇️"
              target={
                <ScoutPrepDetail task={scoutPrepTask} onReturnToRootList={onReturnToRootList} />
              }
            />
          ) : null}
          <Action.OpenInBrowser
            title="Open Prospect Profile"
            icon="🌏"
            shortcut={{ modifiers: ['cmd'], key: 'o' }}
            url={
              result.url?.startsWith('http')
                ? result.url
                : result.url
                  ? `${DASHBOARD_BASE_URL}${result.url}`
                  : `${DASHBOARD_BASE_URL}/athlete/profile/${result.athlete_id}`
            }
          />
          {scoutPrepTask ? (
            <Action
              title="Create Call Reminder"
              icon="☎️"
              onAction={() => void handleCreateCallReminder()}
            />
          ) : null}
          {parentPhone ? (
            <Action.CopyToClipboard title="Copy Phone" icon="☎️" content={parentPhone} />
          ) : null}
          {parentEmail ? (
            <Action.CopyToClipboard title="Copy Email" icon="✉️" content={parentEmail} />
          ) : null}
          <Action
            title="Remove Follow-Up"
            icon="🗑️"
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ['ctrl'], key: 'x' }}
            onAction={() => onRemove(entry)}
          />
          <ActionPanel.Section title="Navigation">
            <Action
              title="Exit Personal Follow-Ups"
              icon="🕘"
              shortcut={{ modifiers: ['cmd'], key: 'f' }}
              onAction={onExit}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function PersonalFollowUpsList({
  onReturnToRootList,
}: {
  onReturnToRootList: () => void | Promise<void>;
}) {
  const { pop } = useNavigation();
  const [searchText, setSearchText] = useState('');
  const [personalFollowUps, setPersonalFollowUps] = useState<PersonalFollowUpEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function loadPersonalFollowUps() {
    setIsLoading(true);
    try {
      setPersonalFollowUps(await listPersonalFollowUps());
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Follow-ups failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRemovePersonalFollowUp(entry: PersonalFollowUpEntry) {
    await removePersonalFollowUp(entry.id);
    setPersonalFollowUps(await listPersonalFollowUps());
    await showToast({
      style: Toast.Style.Success,
      title: 'Removed',
    });
  }

  useEffect(() => {
    void loadPersonalFollowUps();
  }, []);

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Scout Prep — Personal Follow-Ups"
      filtering
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Personal Follow-Ups"
    >
      <List.Section title="Personal Follow-Ups" subtitle={String(personalFollowUps.length)}>
        {personalFollowUps.length > 0 ? (
          personalFollowUps.map((entry) => (
            <PersonalFollowUpListItem
              key={entry.id}
              entry={entry}
              onRemove={handleRemovePersonalFollowUp}
              onExit={pop}
              onReturnToRootList={onReturnToRootList}
            />
          ))
        ) : (
          <List.Item
            icon="🕘"
            title={isLoading ? 'Loading Follow-Ups' : 'No Personal Follow-Ups'}
            subtitle={
              isLoading ? 'Loading' : 'Save a prospect search result when you need to call back'
            }
            actions={
              <ActionPanel>
                <Action title="Back to Scout Prep" icon="↩️" onAction={pop} />
                <SupabaseLifecycleStatusAction />
              </ActionPanel>
            }
          />
        )}
      </List.Section>
    </List>
  );
}

function getBatchRowStatusText(
  row: ScoutPrepBatchRow,
  operation?: ScoutPrepBatchOperation,
): string {
  switch (row.status) {
    case 'pending':
      return 'Ready';
    case 'sending':
      return 'Sending';
    case 'sent':
      return operation?.kind === 'confirmation_cleanup'
        ? 'Cleaned'
        : operation?.kind === 'sales_stage_task_completion'
        ? 'Completed'
        : 'Sent';
    case 'failed':
      return 'Failed';
    case 'skipped':
    default:
      return 'Skipped';
  }
}

function getBatchPrimaryActionTitle(args: {
  operation: ScoutPrepBatchOperation;
  pendingCount: number;
  isChecking: boolean;
  isRunning: boolean;
}): string {
  if (args.isChecking) return 'Checking Batch';
  if (args.isRunning) return 'Batch Running';
  const verb =
    args.operation.kind === 'confirmation_cleanup'
      ? 'Clean Up'
      : args.operation.kind === 'sales_stage_task_completion'
      ? 'Complete'
      : 'Send';
  return `${verb} ${args.pendingCount} Pending`;
}

function getBatchRowStatusColor(row: ScoutPrepBatchRow): Color {
  switch (row.status) {
    case 'sent':
      return Color.Green;
    case 'sending':
      return Color.Blue;
    case 'failed':
      return Color.Red;
    case 'pending':
      return Color.Yellow;
    case 'skipped':
    default:
      return Color.SecondaryText;
  }
}

function getBatchRowSubtitle(row: ScoutPrepBatchRow, operation: ScoutPrepBatchOperation): string {
  if (operation.kind === 'confirmation_cleanup') {
    if (row.status === 'sent') return row.message || 'Cleaned';
    if (row.status === 'failed') return row.message || 'Failed';
    if (row.review?.cleanupAction === 'complete') return 'Awaiting Completed';
    if (row.review?.cleanupAction === 'move') return 'Awaiting Moved';
    return row.message || getTaskDisplayTitle(row.task);
  }
  if (operation.kind === 'reschedule_voicemail') {
    return '';
  }
  return row.recipient?.name || row.message || getTaskDisplayTitle(row.task);
}

function formatBatchReviewMarkdownLine(value?: string | null): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();
}

function extractRescheduleMessageParts(message?: string | null): {
  opener: string;
  slots: string[];
  close: string;
} {
  const lines = String(message || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const slots = lines.filter((line) => /^([12])\s*-/.test(line));
  const firstSlotIndex = slots.length ? lines.findIndex((line) => line === slots[0]) : -1;
  const opener =
    firstSlotIndex > 0
      ? lines.slice(0, firstSlotIndex).join(' ')
      : lines.find((line) => !/^([12])\s*-/.test(line)) || '';
  const close =
    firstSlotIndex >= 0
      ? lines.slice(firstSlotIndex + slots.length).join(' ')
      : lines.slice(1).join(' ');
  return { opener, slots, close };
}

function buildBatchRowDetailMarkdown(
  row: ScoutPrepBatchRow,
  operation: ScoutPrepBatchOperation,
): string {
  if (operation.kind !== 'reschedule_voicemail') {
    return row.message || getTaskDisplayTitle(row.task);
  }

  const recipient = row.recipient?.name || 'Recipient unresolved';
  const previousMeeting = row.review?.previousMeetingLabel || 'Previous meeting unavailable';
  const messageParts = extractRescheduleMessageParts(row.message);
  const slots = row.review?.slotLabels?.length ? row.review.slotLabels : messageParts.slots;
  const opener = messageParts.opener || 'Message still loading.';
  const close = messageParts.close || 'Which one works best?';

  return [
    `## ${formatBatchReviewMarkdownLine(row.task.athlete_name || 'Unknown athlete')}`,
    '',
    `**Recipient:** ${formatBatchReviewMarkdownLine(recipient)}`,
    '',
    '### <u>Previous Booked Meeting</u>',
    '',
    `**_${formatBatchReviewMarkdownLine(previousMeeting)}_**`,
    '',
    '### <u>Outgoing Message</u>',
    '',
    `> ${formatBatchReviewMarkdownLine(opener)}`,
    '>',
    ...slots.map(
      (slot, index) =>
        `> **${index + 1} -** ${formatBatchReviewMarkdownLine(slot.replace(/^([12])\s*-\s*/, ''))}  `,
    ),
    '>',
    `> ${formatBatchReviewMarkdownLine(close)}`,
  ]
    .join('\n')
    .trim();
}

function isFatalScoutPrepBatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /401|403|419|5\d\d|unauthorized|forbidden|session|csrf|login|laravel|service unavailable|bad gateway|gateway timeout|fetch failed|econnrefused|network/i.test(
    message,
  );
}

type RescheduleBatchPlan = {
  previousMeeting: ResolvedBookedMeetingDetails;
  previousMeetingText: string;
  slots: RescheduleVoicemailSlotOption[];
};

type RankedRescheduleSlotPlan = {
  previousMeeting: ResolvedBookedMeetingDetails | null;
  previousMeetingText: string;
  previousHeadScoutName: string | null;
  slots: RescheduleVoicemailSlotOption[];
  suggestedSlots: RescheduleVoicemailSlotOption[];
  weekLabel: string | null;
};

const RESCHEDULE_SLOT_DIFFERENT_SCOUT_PENALTY = 2_500;
const RESCHEDULE_SLOT_SHORT_NOTICE_HOURS = 24;
const RESCHEDULE_SLOT_SHORT_NOTICE_PENALTY = 8_000;
const RESCHEDULE_SLOT_SAME_WEEKEND_ON_LATE_WEEK_PENALTY = 1_500;
const RESCHEDULE_SLOT_EARLIER_THAN_PREVIOUS_TIME_PENALTY = 45;

function localMinutesForEasternStamp(start: string, timeZone?: string | null): number | null {
  const parsed = easternLocalIsoToDate(start);
  if (!parsed) return null;
  const renderTimeZone = resolveIanaTimeZoneFromLegacyLabel(timeZone || 'America/New_York');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: renderTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed);
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value || '', 10);
  const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value || '', 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

function localWeekdayForDate(date: Date, timeZone?: string | null): number | null {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/New_York',
    weekday: 'short',
  }).format(date);
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return weekdays[weekday] ?? null;
}

function hoursUntilDate(date: Date, now = new Date()): number {
  return (date.getTime() - now.getTime()) / (60 * 60 * 1000);
}

function scoreRescheduleSlot(args: {
  slot: HeadScoutSlot & { scout_name: string };
  previousHeadScoutName: string | null;
  targetMinutes: number | null;
  clientTimezone: string | null;
  weekOffset: number;
  now?: Date;
}): number {
  const sameScout =
    args.previousHeadScoutName &&
    normalizeNameKey(args.slot.scout_name) === normalizeNameKey(args.previousHeadScoutName)
      ? 0
      : RESCHEDULE_SLOT_DIFFERENT_SCOUT_PENALTY;
  const slotMinutes = localMinutesForEasternStamp(args.slot.start, args.clientTimezone);
  const timeDistance =
    slotMinutes !== null && args.targetMinutes !== null
      ? Math.abs(slotMinutes - args.targetMinutes)
      : 1_000;
  const earlierThanPreviousTime =
    slotMinutes !== null && args.targetMinutes !== null && slotMinutes < args.targetMinutes
      ? RESCHEDULE_SLOT_EARLIER_THAN_PREVIOUS_TIME_PENALTY
      : 0;
  const slotDate = easternLocalIsoToDate(args.slot.start);
  const noticeHours = slotDate ? hoursUntilDate(slotDate, args.now) : null;
  const shortNotice =
    noticeHours !== null && noticeHours < RESCHEDULE_SLOT_SHORT_NOTICE_HOURS
      ? RESCHEDULE_SLOT_SHORT_NOTICE_PENALTY
      : 0;
  const currentWeekday = localWeekdayForDate(args.now || new Date(), args.clientTimezone);
  const slotWeekday = slotDate ? localWeekdayForDate(slotDate, args.clientTimezone) : null;
  const rushedWeekend =
    args.weekOffset === 0 &&
    currentWeekday !== null &&
    currentWeekday >= 5 &&
    (slotWeekday === 0 || slotWeekday === 6)
      ? RESCHEDULE_SLOT_SAME_WEEKEND_ON_LATE_WEEK_PENALTY
      : 0;
  return (
    sameScout +
    args.weekOffset * 100 +
    timeDistance +
    earlierThanPreviousTime +
    shortNotice +
    rushedWeekend
  );
}

async function buildRankedRescheduleSlotPlan(args: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  requirePreviousMeeting?: boolean;
  weekOffsets?: number[];
}): Promise<RankedRescheduleSlotPlan> {
  const mustHavePreviousMeeting = args.requirePreviousMeeting !== false;
  const athleteId = String(args.task.contact_id || args.context.task.contact_id || '').trim();
  const athleteMainId = String(
    args.context.resolved.athlete_main_id || args.task.athlete_main_id || '',
  ).trim();
  const previousMeeting =
    mustHavePreviousMeeting && athleteId && athleteMainId
      ? await resolveBookedMeetingDetailsForForm(
          { athleteId, athleteMainId, source: 'latest_appointment_truth' },
          {
            getCachedMeetingDescription: getCachedBookedMeetingDescription,
          },
        )
      : null;
  if (mustHavePreviousMeeting && !previousMeeting) {
    throw new Error('Missing booked meeting for Reschedule Pending');
  }

  const clientTimezone =
    previousMeeting?.meetingTimezone ||
    resolveTimezone(args.context.resolved.city, args.context.resolved.state) ||
    null;
  const previousHeadScoutName =
    String(previousMeeting?.bookedMeeting.assigned_owner || '').trim() ||
    String(args.context.resolved.head_scout || '').trim() ||
    null;
  const targetMinutes = previousMeeting?.bookedMeeting.start
    ? localMinutesForEasternStamp(previousMeeting.bookedMeeting.start, clientTimezone)
    : null;
  const previousMeetingText =
    (mustHavePreviousMeeting && previousMeeting
      ? buildPreviousMeetingTextForReschedule(previousMeeting, args.context)
      : null) ||
    [previousHeadScoutName, previousMeeting?.bookedMeeting.start].filter(Boolean).join(' • ');
  const now = new Date();
  const weekOffsets = args.weekOffsets?.length ? args.weekOffsets : [0, 1];

  const slotPayloads = await Promise.all(
    weekOffsets.map((weekOffset) => fetchHeadScoutSlots(weekOffset)),
  );
  const payloadWeekLabels = slotPayloads
    .map((payload) => formatHeadScoutWeekLabel(payload.week_start, payload.week_end))
    .filter(Boolean);
  const scoredSlots = slotPayloads.flatMap((payload, payloadIndex) => {
    const weekOffset = weekOffsets[payloadIndex] ?? payloadIndex;
    const rawSlots = (payload.scouts || []).flatMap((schedule) =>
      (schedule.slots || []).map((slot) => ({
        ...slot,
        scout_name: slot.scout_name || schedule.scout_name,
      })),
    );
    return filterVisibleHeadScoutSlots(rawSlots).map((slot) => ({ slot, weekOffset }));
  });

  const slots = scoredSlots
    .sort((left, right) => {
      const leftScore = scoreRescheduleSlot({
        slot: left.slot,
        previousHeadScoutName,
        targetMinutes,
        clientTimezone,
        weekOffset: left.weekOffset,
        now,
      });
      const rightScore = scoreRescheduleSlot({
        slot: right.slot,
        previousHeadScoutName,
        targetMinutes,
        clientTimezone,
        weekOffset: right.weekOffset,
        now,
      });
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.slot.start.localeCompare(right.slot.start);
    })
    .map(({ slot, weekOffset }) => {
      const display = formatHeadScoutNaturalSlotLabel(slot.start, slot.end, clientTimezone);
      const isPreviousScout = Boolean(
        previousHeadScoutName &&
        normalizeNameKey(slot.scout_name) === normalizeNameKey(previousHeadScoutName),
      );
      return {
        id: `${slot.scout_name}:${slot.id}`,
        title: display.messageLabel,
        subtitle: slot.scout_name,
        scoutName: slot.scout_name,
        messageLabel: display.messageLabel,
        isPreviousScout,
        dateLabel: display.dateLabel,
        timeLabel: display.timeLabel,
        zoneLabel: display.zoneLabel,
        weekLabel: weekOffset > 0 ? 'next week' : 'this week',
        start: slot.start,
      };
    });

  const suggestedSlots = slots
    .slice(0, 2)
    .sort((left, right) => left.start.localeCompare(right.start));

  if (suggestedSlots.length < 2) {
    throw new Error('Missing two reschedule slot options');
  }

  return {
    previousMeeting,
    previousMeetingText,
    previousHeadScoutName,
    slots,
    suggestedSlots,
    weekLabel:
      payloadWeekLabels.length > 1
        ? `${payloadWeekLabels[0]} / ${payloadWeekLabels[payloadWeekLabels.length - 1]}`
        : payloadWeekLabels[0] || null,
  };
}

async function buildRescheduleBatchPlan(args: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
}): Promise<RescheduleBatchPlan> {
  const plan = await buildRankedRescheduleSlotPlan(args);

  if (plan.suggestedSlots.length < 2) {
    throw new Error('Missing two reschedule slot options');
  }
  if (!plan.previousMeeting) {
    throw new Error('Missing booked meeting for Reschedule Pending');
  }

  return {
    previousMeeting: plan.previousMeeting,
    previousMeetingText: plan.previousMeetingText,
    slots: plan.suggestedSlots,
  };
}

async function runScoutPrepStageCompletionBatchRow(args: {
  row: ScoutPrepBatchRow;
  context: ScoutPrepContext;
  stageLabel: string;
}): Promise<ScoutPrepBatchRow> {
  if (args.row.status === 'skipped') {
    return args.row;
  }

  try {
    const athleteMainId = String(
      args.row.task.athlete_main_id || args.context.resolved.athlete_main_id || '',
    ).trim();
    const athleteId = String(
      args.row.task.athlete_id ||
        args.row.task.contact_id ||
        args.context.task.athlete_id ||
        args.context.task.contact_id ||
        '',
    ).trim();
    if (!athleteMainId || !athleteId) {
      throw new Error('Missing athlete IDs');
    }

    const actionPlan = buildPostCallActionPlan({
      athleteId,
      athleteMainId,
      athleteName: args.context.contactInfo.studentAthlete.name || args.row.task.athlete_name,
      stageLabel: args.stageLabel,
      tasks: args.context.tasks,
      selectedTaskId: args.row.task.task_id,
    });

    await updateSalesStage({
      athleteMainId,
      athleteId,
      athleteName: args.context.contactInfo.studentAthlete.name || args.row.task.athlete_name,
      stage: actionPlan.laravelSalesStageUpdate?.stage || args.stageLabel,
    });

    const taskCompletion = actionPlan.laravelTaskCompletion;
    if (!taskCompletion) {
      throw new Error('No matching task to complete');
    }

    await completeScoutPrepTaskAfterVoicemail({
      athleteId: taskCompletion.athleteId,
      athleteMainId: taskCompletion.athleteMainId,
      athleteName: args.context.contactInfo.studentAthlete.name || args.row.task.athlete_name,
      contactTask: taskCompletion.contactTask,
      taskId: taskCompletion.taskId,
      crmStage: taskCompletion.crmStage,
      taskTitle: taskCompletion.taskTitle,
      assignedOwner: taskCompletion.assignedOwner,
      description: taskCompletion.description,
    });

    return {
      ...args.row,
      status: 'sent',
      message: args.stageLabel,
    };
  } catch (error) {
    return {
      ...args.row,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function getScoutPrepBatchOperationById(operationId: string): ScoutPrepBatchOperation {
  return (
    Object.values(SCOUT_PREP_BATCH_OPERATIONS).find((candidate) => candidate.id === operationId) ||
    SCOUT_PREP_BATCH_OPERATIONS.callAttempt3Voicemail
  );
}

function formatBatchMeetingStartLabel(meetingStart: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
    .format(meetingStart)
    .replace(/,/g, '');
}

function resolveConfirmationCleanupPlanFromTask(
  task: ScoutPortalTask,
  now = new Date(),
): { action: 'complete' | 'move'; label: string; dueAt: Date } | null {
  const dueAt = buildDefaultTaskDate(task.due_date);
  if (!dueAt) return null;
  const label = formatBatchMeetingStartLabel(dueAt);
  return {
    action: isScoutPrepConfirmationCleanupDue({ taskDueAt: dueAt, now }) ? 'complete' : 'move',
    label,
    dueAt,
  };
}

function applyConfirmationCleanupPlanToRow(
  row: ScoutPrepBatchRow,
  now = new Date(),
): ScoutPrepBatchRow {
  const plan = resolveConfirmationCleanupPlanFromTask(row.task, now);
  if (!plan) {
    return {
      ...row,
      status: 'failed',
      message: 'Missing task due date',
      review: {
        ...(row.review || {}),
        cleanupAction: undefined,
        cleanupLabel: null,
      },
    };
  }
  return {
    ...row,
    status: 'pending',
    message: plan.action === 'complete' ? 'Awaiting Completed' : 'Awaiting Moved',
    review: {
      ...(row.review || {}),
      cleanupAction: plan.action,
      cleanupLabel: plan.label,
    },
  };
}

async function runScoutPrepConfirmationCleanupBatchRow(args: {
  row: ScoutPrepBatchRow;
  context: ScoutPrepContext;
}): Promise<ScoutPrepBatchRow> {
  if (args.row.status === 'skipped') {
    return args.row;
  }

  try {
    const plan = args.row.review?.cleanupAction
      ? {
          action: args.row.review.cleanupAction,
          label: args.row.review.cleanupLabel || '',
        }
      : resolveConfirmationCleanupPlanFromTask(args.row.task);
    if (!plan) {
      throw new Error('Missing task due date');
    }

    if (plan.action === 'move') {
      const confirmationTask = resolveConfirmationTaskForMorningAction(args.row.task, args.context);
      if (!confirmationTask) {
        throw new Error('No confirmation task');
      }
      const nextDueAt = await updateConfirmationTaskToMeetingMorning({
        task: args.row.task,
        activeContext: args.context,
        confirmationTask,
      });
      return {
        ...args.row,
        status: 'sent',
        message: `Moved to ${formatDateForLegacyInput(nextDueAt)} 09:00`,
        review: {
          ...(args.row.review || {}),
          cleanupAction: 'move',
          cleanupLabel: plan.label,
        },
      };
    }

    const completedTask = await completeScoutPrepTaskDirectly({
      task: args.row.task,
      context: args.context,
    });
    return {
      ...args.row,
      status: 'sent',
      message: getTaskDisplayTitle(completedTask),
      review: {
        ...(args.row.review || {}),
        cleanupAction: 'complete',
        cleanupLabel: plan.label,
      },
    };
  } catch (error) {
    return {
      ...args.row,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

type ScoutPrepBatchAttemptRecord = {
  taskId: string;
  operationId: string;
  operationLabel: string;
  resultStatus: ScoutPrepBatchRow['status'];
  contactId: string | null;
  athleteMainId: string | null;
  taskTitle: string | null;
  gradYear: string | null;
  occurredAt: string;
  error?: string;
};

type ScoutPrepBatchAttemptIndex = {
  version: 1;
  updatedAt: string;
  failedTaskIds: string[];
  attempts: ScoutPrepBatchAttemptRecord[];
};

function createEmptyScoutPrepBatchAttemptIndex(): ScoutPrepBatchAttemptIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    failedTaskIds: [],
    attempts: [],
  };
}

function normalizeBatchAttemptIndex(value: unknown): ScoutPrepBatchAttemptIndex {
  const raw = (value || {}) as Partial<ScoutPrepBatchAttemptIndex>;
  const failedTaskIds = new Set(
    (Array.isArray(raw.failedTaskIds) ? raw.failedTaskIds : [])
      .map((taskId) => normalizeScoutPrepBatchTaskId(taskId))
      .filter(Boolean),
  );
  const attempts = (Array.isArray(raw.attempts) ? raw.attempts : [])
    .map((attempt) => {
      const taskId = normalizeScoutPrepBatchTaskId(attempt?.taskId);
      if (!taskId) return null;
      return {
        taskId,
        operationId: String(attempt?.operationId || '').trim(),
        operationLabel: String(attempt?.operationLabel || '').trim(),
        resultStatus: attempt?.resultStatus || 'failed',
        contactId: String(attempt?.contactId || '').trim() || null,
        athleteMainId: String(attempt?.athleteMainId || '').trim() || null,
        taskTitle: String(attempt?.taskTitle || '').trim() || null,
        gradYear: String(attempt?.gradYear || '').trim() || null,
        occurredAt: String(attempt?.occurredAt || '').trim() || new Date().toISOString(),
        error: String(attempt?.error || '').trim() || undefined,
      } satisfies ScoutPrepBatchAttemptRecord;
    })
    .filter((attempt): attempt is ScoutPrepBatchAttemptRecord => Boolean(attempt));

  return {
    version: 1,
    updatedAt: String(raw.updatedAt || '').trim() || new Date().toISOString(),
    failedTaskIds: Array.from(failedTaskIds),
    attempts,
  };
}

function writeScoutPrepBatchAttemptIndex(index: ScoutPrepBatchAttemptIndex) {
  try {
    fs.mkdirSync(RAYCAST_LOG_DIR, { recursive: true });
    fs.writeFileSync(
      SCOUT_PREP_BATCH_ATTEMPT_INDEX_FILE,
      `${JSON.stringify(index, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    logFailure(
      'SCOUT_PREP_BATCH_INDEX',
      'write-index',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function readScoutPrepBatchAttemptIndex(): ScoutPrepBatchAttemptIndex {
  try {
    if (fs.existsSync(SCOUT_PREP_BATCH_ATTEMPT_INDEX_FILE)) {
      return normalizeBatchAttemptIndex(
        JSON.parse(fs.readFileSync(SCOUT_PREP_BATCH_ATTEMPT_INDEX_FILE, 'utf8')),
      );
    }
  } catch (error) {
    logFailure(
      'SCOUT_PREP_BATCH_INDEX',
      'read-index',
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    if (!fs.existsSync(SCOUT_PREP_SEARCH_LOG_FILE)) {
      return createEmptyScoutPrepBatchAttemptIndex();
    }
    const failedTaskIds = Array.from(
      collectFailedScoutPrepBatchTaskIdsFromLogText(
        fs.readFileSync(SCOUT_PREP_SEARCH_LOG_FILE, 'utf8'),
      ),
    );
    const index: ScoutPrepBatchAttemptIndex = {
      version: 1,
      updatedAt: new Date().toISOString(),
      failedTaskIds,
      attempts: failedTaskIds.map((taskId) => ({
        taskId,
        operationId: '',
        operationLabel: '',
        resultStatus: 'failed',
        contactId: null,
        athleteMainId: null,
        taskTitle: null,
        gradYear: null,
        occurredAt: new Date().toISOString(),
        error: 'Recovered from search.log',
      })),
    };
    writeScoutPrepBatchAttemptIndex(index);
    return index;
  } catch (error) {
    logFailure(
      'SCOUT_PREP_BATCH_INDEX',
      'parse-search-log',
      error instanceof Error ? error.message : String(error),
    );
    return createEmptyScoutPrepBatchAttemptIndex();
  }
}

function getFailedScoutPrepBatchTaskIdsForReview(): Set<string> {
  return new Set(readScoutPrepBatchAttemptIndex().failedTaskIds.map(normalizeScoutPrepBatchTaskId));
}

function buildScoutPrepBatchAttemptRecord(
  row: ScoutPrepBatchRow,
  operation: ScoutPrepBatchOperation,
): ScoutPrepBatchAttemptRecord {
  return {
    taskId: normalizeScoutPrepBatchTaskId(row.task.task_id),
    operationId: operation.id,
    operationLabel: operation.label,
    resultStatus: row.status,
    contactId: String(row.task.contact_id || '').trim() || null,
    athleteMainId: String(row.task.athlete_main_id || '').trim() || null,
    taskTitle: String(row.task.title || '').trim() || null,
    gradYear: String(row.task.grad_year || '').trim() || null,
    occurredAt: new Date().toISOString(),
    error: row.status === 'failed' ? String(row.message || '').trim() || undefined : undefined,
  };
}

function recordScoutPrepBatchAttempt(row: ScoutPrepBatchRow, operation: ScoutPrepBatchOperation) {
  const record = buildScoutPrepBatchAttemptRecord(row, operation);
  if (!record.taskId) return;

  const index = readScoutPrepBatchAttemptIndex();
  const failedTaskIds = new Set(index.failedTaskIds.map(normalizeScoutPrepBatchTaskId));
  if (record.resultStatus === 'failed') {
    failedTaskIds.add(record.taskId);
  } else if (record.resultStatus === 'sent') {
    failedTaskIds.delete(record.taskId);
  }
  const attempts = [
    record,
    ...index.attempts.filter((attempt) => normalizeScoutPrepBatchTaskId(attempt.taskId) !== record.taskId),
  ].slice(0, 500);
  writeScoutPrepBatchAttemptIndex({
    version: 1,
    updatedAt: record.occurredAt,
    failedTaskIds: Array.from(failedTaskIds),
    attempts,
  });
}

function logScoutPrepBatchRowRun(
  row: ScoutPrepBatchRow,
  operation: ScoutPrepBatchOperation,
  rowIndex: number,
) {
  const context = {
    operationId: operation.id,
    operationLabel: operation.label,
    rowIndex,
    taskId: normalizeScoutPrepBatchTaskId(row.task.task_id) || null,
    contactId: String(row.task.contact_id || '').trim() || null,
    athleteMainId: String(row.task.athlete_main_id || '').trim() || null,
    taskTitle: String(row.task.title || '').trim() || null,
    gradYear: String(row.task.grad_year || '').trim() || null,
    resultStatus: row.status,
  };
  if (row.status === 'failed') {
    logFailure(
      'SCOUT_PREP_BATCH_ROW_RUN',
      'run-row',
      String(row.message || 'Batch row failed'),
      context,
    );
    return;
  }
  logInfo('SCOUT_PREP_BATCH_ROW_RUN', 'run-row', 'success', context);
}

function ScoutPrepBatchSetupForm({
  tasks,
  operationId,
  onOperationChange,
  onConfirm,
}: {
  tasks: ScoutPortalTask[];
  operationId: string;
  onOperationChange: (operationId: string) => void;
  onConfirm: (args: { operationId: string; gradYear?: string | null; taskTitle?: string | null }) => void;
}) {
  const operation = getScoutPrepBatchOperationById(operationId);
  const setupOptionTasks =
    operation.kind === 'sales_stage_task_completion'
      ? tasks.filter((task) => isScoutPrepBatchTaskEligible(task, operation))
      : tasks;
  const gradYearOptions = getScoutPrepBatchGradYearOptions(setupOptionTasks);
  const taskTitleOptions = getScoutPrepBatchTaskTitleOptions(setupOptionTasks);
  const [selectedNoInterestFilter, setSelectedNoInterestFilter] = useState<'gradYear' | 'taskTitle'>(
    gradYearOptions.length ? 'gradYear' : 'taskTitle',
  );
  const [selectedGradYear, setSelectedGradYear] = useState(gradYearOptions[0] || '');
  const [selectedTaskTitle, setSelectedTaskTitle] = useState(taskTitleOptions[0] || '');

  useEffect(() => {
    setSelectedNoInterestFilter(gradYearOptions.length ? 'gradYear' : 'taskTitle');
    setSelectedGradYear(gradYearOptions[0] || '');
    setSelectedTaskTitle(taskTitleOptions[0] || '');
  }, [operationId, gradYearOptions.join('|'), taskTitleOptions.join('|')]);

  return (
    <Form
      navigationTitle="Batch Operations"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Review Batch"
            icon="🔎"
            onSubmit={() =>
              onConfirm({
                operationId,
                gradYear:
                  operation.kind === 'sales_stage_task_completion' &&
                  selectedNoInterestFilter === 'gradYear'
                    ? selectedGradYear
                    : null,
                taskTitle:
                  operation.kind === 'sales_stage_task_completion' &&
                  selectedNoInterestFilter === 'taskTitle'
                    ? selectedTaskTitle
                    : null,
              })
            }
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="operationId"
        title="Batch Operation"
        value={operationId}
        onChange={onOperationChange}
      >
        {Object.values(SCOUT_PREP_BATCH_OPERATIONS).map((candidate) => (
          <Form.Dropdown.Item key={candidate.id} title={candidate.label} value={candidate.id} />
        ))}
      </Form.Dropdown>
      {operation.kind === 'sales_stage_task_completion' ? (
        <Form.Dropdown
          id="noInterestFilter"
          title="Filter"
          value={selectedNoInterestFilter}
          onChange={(value) => setSelectedNoInterestFilter(value as 'gradYear' | 'taskTitle')}
        >
          {gradYearOptions.length ? (
            <Form.Dropdown.Item title="Grad Year" value="gradYear" />
          ) : null}
          {taskTitleOptions.length ? (
            <Form.Dropdown.Item title="Task" value="taskTitle" />
          ) : null}
        </Form.Dropdown>
      ) : null}
      {operation.kind === 'sales_stage_task_completion' &&
      selectedNoInterestFilter === 'gradYear' ? (
        gradYearOptions.length ? (
          <Form.Dropdown
            id="gradYear"
            title="Grad Year"
            value={selectedGradYear}
            onChange={setSelectedGradYear}
          >
            {gradYearOptions.map((gradYear) => (
              <Form.Dropdown.Item key={gradYear} title={gradYear} value={gradYear} />
            ))}
          </Form.Dropdown>
        ) : (
          <Form.Description text="No grad years found in the current Scout Prep task list." />
        )
      ) : null}
      {operation.kind === 'sales_stage_task_completion' &&
      selectedNoInterestFilter === 'taskTitle' ? (
        taskTitleOptions.length ? (
          <Form.Dropdown
            id="taskTitle"
            title="Task"
            value={selectedTaskTitle}
            onChange={setSelectedTaskTitle}
          >
            {taskTitleOptions.map((taskTitle) => (
              <Form.Dropdown.Item key={taskTitle} title={taskTitle} value={taskTitle} />
            ))}
          </Form.Dropdown>
        ) : (
          <Form.Description text="No Call Attempt 2 or 3 tasks found in the current Scout Prep task list." />
        )
      ) : null}
    </Form>
  );
}

function ScoutPrepBatchPreflightList({
  tasks,
  initialOperationId,
  selectedGradYear,
  selectedTaskTitle,
  onComplete,
}: {
  tasks: ScoutPortalTask[];
  initialOperationId: string;
  selectedGradYear?: string | null;
  selectedTaskTitle?: string | null;
  onComplete: () => Promise<void> | void;
}) {
  const { push, pop } = useNavigation();
  const operation = getScoutPrepBatchOperationById(initialOperationId);
  const failedTaskIds = useMemo(() => getFailedScoutPrepBatchTaskIdsForReview(), [initialOperationId]);
  const initialRows = useMemo(
    () => {
      const rows = buildScoutPrepBatchPreflightRows({
        operation,
        tasks: tasks.filter((task) => isScoutPrepBatchTaskEligible(task, operation)),
        gradYear: selectedGradYear,
        taskTitle: selectedTaskTitle,
        excludedTaskIds: operation.kind === 'confirmation_cleanup' ? [] : failedTaskIds,
        limit: operation.kind === 'confirmation_cleanup' ? tasks.length : SCOUT_PREP_BATCH_LIMIT,
      });
      const reviewStartedAt = new Date();
      return operation.kind === 'confirmation_cleanup'
        ? rows.map((row) => applyConfirmationCleanupPlanToRow(row, reviewStartedAt))
        : rows;
    },
    [operation, selectedGradYear, selectedTaskTitle, failedTaskIds, tasks],
  );
  const [rows, setRows] = useState<ScoutPrepBatchRow[]>(initialRows);
  const [isRunning, setIsRunning] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const pendingCount = rows.filter((row) => row.status === 'pending').length;
  const sentCount = rows.filter((row) => row.status === 'sent').length;
  const skippedCount = rows.filter((row) => row.status === 'skipped').length;
  const failedCount = rows.filter((row) => row.status === 'failed').length;

  useEffect(() => {
    let active = true;

    async function checkRows() {
      setRows(initialRows);
      if (!initialRows.length) {
        return;
      }

      setIsChecking(true);
      try {
        for (const row of initialRows) {
          if (!active || row.status !== 'pending') {
            continue;
          }

          try {
            if (operation.kind === 'confirmation_cleanup') {
              updateRow(row.task, () => applyConfirmationCleanupPlanToRow(row));
              continue;
            }

            const context = await loadScoutPrepContext(row.task);
            if (!active) {
              return;
            }

            if (operation.kind === 'sales_stage_task_completion') {
              updateRow(row.task, () => ({
                ...row,
                message: operation.stageLabel || 'Spoke to - Not Interested',
              }));
              continue;
            }

            const recipientResolution = resolveBatchVoicemailRecipient(context);
            if (recipientResolution.status === 'skipped') {
              updateRow(row.task, () => ({
                ...row,
                status: 'skipped',
                recipient: null,
                message: recipientResolution.message,
              }));
            } else if (operation.kind === 'reschedule_voicemail') {
              const plan = await buildRescheduleBatchPlan({ task: row.task, context });
              const message = buildVoicemailFollowUpBody(
                context,
                recipientResolution.recipient.id,
                operation.variant,
                null,
                row.task.title || null,
                undefined,
                null,
                null,
                {
                  previousHeadScoutName: plan.previousMeeting.bookedMeeting.assigned_owner,
                  slots: plan.slots.map((slot) => slot.messageLabel),
                  weekLabel: plan.slots[0]?.weekLabel || null,
                },
              );
              updateRow(row.task, () => ({
                ...row,
                recipient: recipientResolution.recipient,
                message,
                review: {
                  previousMeetingLabel: plan.previousMeetingText,
                  previousCoachName: plan.previousMeeting.bookedMeeting.assigned_owner,
                  slotLabels: plan.slots.map((slot) => slot.messageLabel),
                },
              }));
            } else {
              updateRow(row.task, () => ({
                ...row,
                recipient: recipientResolution.recipient,
                message: recipientResolution.message || recipientResolution.recipient.name,
              }));
            }
          } catch (error) {
            if (!active) {
              return;
            }
            updateRow(row.task, () => ({
              ...row,
              status: 'failed',
              message: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      } finally {
        if (active) {
          setIsChecking(false);
        }
      }
    }

    void checkRows();
    return () => {
      active = false;
    };
  }, [initialRows]);

  function updateRow(
    task: ScoutPortalTask,
    updater: (row: ScoutPrepBatchRow) => ScoutPrepBatchRow,
  ) {
    const rowId = buildScoutPrepTaskItemId(task);
    setRows((current) =>
      current.map((row) => (buildScoutPrepTaskItemId(row.task) === rowId ? updater(row) : row)),
    );
  }

  async function runBatch() {
    if (isRunning || isChecking || pendingCount === 0) {
      return;
    }

    setIsRunning(true);
    const toast = await showLoadingToast('Batch sending', `${pendingCount} pending`);
    let fatalMessage: string | null = null;

    try {
      for (const currentRow of rows) {
        if (currentRow.status !== 'pending') {
          continue;
        }
        const rowIndex = rows.findIndex(
          (row) => buildScoutPrepTaskItemId(row.task) === buildScoutPrepTaskItemId(currentRow.task),
        );
        logInfo('SCOUT_PREP_BATCH_ROW_RUN', 'run-row', 'start', {
          operationId: operation.id,
          operationLabel: operation.label,
          rowIndex,
          taskId: normalizeScoutPrepBatchTaskId(currentRow.task.task_id) || null,
          contactId: String(currentRow.task.contact_id || '').trim() || null,
          athleteMainId: String(currentRow.task.athlete_main_id || '').trim() || null,
          taskTitle: String(currentRow.task.title || '').trim() || null,
          gradYear: String(currentRow.task.grad_year || '').trim() || null,
        });

        updateRow(currentRow.task, (row) => ({
          ...row,
          status: 'sending',
          message: 'Loading Scout Prep',
        }));

        let context: ScoutPrepContext;
        try {
          context = await loadScoutPrepContext(currentRow.task);
        } catch (error) {
          const failedRow: ScoutPrepBatchRow = {
            ...currentRow,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          };
          updateRow(currentRow.task, () => failedRow);
          recordScoutPrepBatchAttempt(failedRow, operation);
          logScoutPrepBatchRowRun(failedRow, operation, rowIndex);
          if (isFatalScoutPrepBatchError(error)) {
            fatalMessage = failedRow.message || 'Scout Prep load failed';
            break;
          }
          continue;
        }

        const resultRow =
          operation.kind === 'confirmation_cleanup'
            ? await runScoutPrepConfirmationCleanupBatchRow({
                row: currentRow,
                context,
              })
            : operation.kind === 'sales_stage_task_completion'
            ? await runScoutPrepStageCompletionBatchRow({
                row: currentRow,
                context,
                stageLabel: operation.stageLabel || 'Spoke to - Not Interested',
              })
            : await runScoutPrepBatchRow({
                row: currentRow,
                context,
                resolveRecipient:
                  operation.kind === 'reschedule_voicemail' && currentRow.recipient
                    ? () => ({ status: 'eligible', recipient: currentRow.recipient! })
                    : undefined,
                buildMessage: async (recipient) => {
                  if (operation.kind === 'reschedule_voicemail' && currentRow.message) {
                    return currentRow.message;
                  }
                  const reschedulePlan =
                    operation.kind === 'reschedule_voicemail'
                      ? await buildRescheduleBatchPlan({ task: currentRow.task, context })
                      : null;
                  const selectedParent =
                    recipient.id === 'parent2'
                      ? context.contactInfo.parent2
                      : context.contactInfo.parent1;
                  const deterministicHonorific = resolveParentHonorificFromRelationship(
                    selectedParent?.relationship,
                  );
                  const aiHonorific =
                    !deterministicHonorific && recipient.id !== 'studentAthlete'
                      ? await resolveParentHonorificWithRayAI({
                          parentName: selectedParent?.name || recipient.name,
                          relationship: selectedParent?.relationship || null,
                        }).catch(() => null)
                      : null;
                  const athleteGender = await resolveAthleteGenderWithRayAI({
                    athleteName:
                      context.contactInfo.studentAthlete.name || currentRow.task.athlete_name,
                    sport: context.resolved.sport,
                  }).catch(() => null);
                  return buildVoicemailFollowUpBody(
                    context,
                    recipient.id,
                    operation.variant,
                    null,
                    currentRow.task.title || null,
                    undefined,
                    deterministicHonorific || aiHonorific,
                    athleteGender,
                    reschedulePlan
                      ? {
                          previousHeadScoutName:
                            reschedulePlan.previousMeeting.bookedMeeting.assigned_owner,
                          slots: reschedulePlan.slots.map((slot) => slot.messageLabel),
                          weekLabel: reschedulePlan.slots[0]?.weekLabel || null,
                        }
                      : undefined,
                  );
                },
                sendMessage: async (recipient, message) => {
                  const sentAfterMs = Date.now();
                  const result = await sendClientMessage({
                    address: recipient.phones[0],
                    text: message,
                    serviceName: 'iMessage',
                  });
                  if (result !== 'Success') {
                    throw new Error(result);
                  }
                  const verification = await verifyRecentClientMessageSend({
                    address: recipient.phones[0],
                    text: message,
                    sentAfterMs,
                    serviceName: 'iMessage',
                  });
                  if (!verification.ok) {
                    throw new Error(verification.error || 'Messages send verification failed.');
                  }
                },
                persistMessageSent: async () => {
                  if (!operation.variant) {
                    throw new Error('Missing voicemail variant');
                  }
                  if (operation.kind === 'reschedule_voicemail') {
                    await completeSentTextTask({
                      context,
                      task: currentRow.task,
                      variant: operation.variant,
                    });
                  } else {
                    await persistVoicemailFollowUpMessageSent({
                      context,
                      task: currentRow.task,
                      variant: operation.variant,
                      previousCrmStage: null,
                      previousTaskStatus: currentRow.task.title || null,
                    });
                  }
                },
              });

        updateRow(currentRow.task, () => resultRow);
        recordScoutPrepBatchAttempt(resultRow, operation);
        logScoutPrepBatchRowRun(resultRow, operation, rowIndex);
        if (resultRow.status === 'failed' && isFatalScoutPrepBatchError(resultRow.message)) {
          fatalMessage = resultRow.message || 'Batch stopped';
          break;
        }
      }

      if (fatalMessage) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Batch stopped';
        toast.message = fatalMessage;
        return;
      }

      toast.style = Toast.Style.Success;
      toast.title = 'Batch complete';
      toast.message = operation.label;
      pop();
      await onComplete();
    } finally {
      setIsRunning(false);
    }
  }

  function removeBatchRow(row: ScoutPrepBatchRow) {
    const rowId = buildScoutPrepTaskItemId(row.task);
    if (isRunning || isChecking) {
      return;
    }

    setRows((current) =>
      current.filter((candidate) => buildScoutPrepTaskItemId(candidate.task) !== rowId),
    );
  }

  async function reselectBatchRowSlots(row: ScoutPrepBatchRow) {
    if (operation.kind !== 'reschedule_voicemail' || isRunning || isChecking) {
      return;
    }

    const toast = await showLoadingToast('Loading slots', row.task.athlete_name || 'Reschedule');
    try {
      const context = await loadScoutPrepContext(row.task);
      const recipientResolution = row.recipient
        ? { status: 'eligible' as const, recipient: row.recipient }
        : resolveBatchVoicemailRecipient(context);
      if (recipientResolution.status === 'skipped') {
        throw new Error(recipientResolution.message);
      }

      const plan = row.review?.previousMeetingLabel
        ? null
        : await buildRescheduleBatchPlan({ task: row.task, context });
      const previousMeetingLabel =
        row.review?.previousMeetingLabel || plan?.previousMeetingText || null;
      const previousCoachName =
        row.review?.previousCoachName ||
        plan?.previousMeeting.bookedMeeting.assigned_owner ||
        String(context.resolved.head_scout || '').trim() ||
        null;

      toast.style = Toast.Style.Success;
      toast.title = 'Pick slots';
      toast.message = row.task.athlete_name || undefined;
      push(
        <RescheduleSlotSelectionList
          task={row.task}
          context={context}
          onSlotsSelected={(slots) => {
            const message = buildVoicemailFollowUpBody(
              context,
              recipientResolution.recipient.id,
              operation.variant,
              null,
              row.task.title || null,
              undefined,
              null,
              null,
              {
                previousHeadScoutName: previousCoachName,
                slots: slots.map((slot) => slot.messageLabel),
                weekLabel: slots[0]?.weekLabel || null,
              },
            );
            updateRow(row.task, (current) => ({
              ...current,
              status: 'pending',
              recipient: recipientResolution.recipient,
              message,
              review: {
                previousMeetingLabel,
                previousCoachName,
                slotLabels: slots.map((slot) => slot.messageLabel),
              },
            }));
            pop();
          }}
        />,
      );
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Slot load failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  const confirmationCompleteRows = rows.filter((row) => row.review?.cleanupAction === 'complete');
  const confirmationMoveRows = rows.filter((row) => row.review?.cleanupAction === 'move');
  const confirmationOtherRows = rows.filter(
    (row) => operation.kind === 'confirmation_cleanup' && !row.review?.cleanupAction,
  );

  function renderBatchRow(row: ScoutPrepBatchRow) {
    return (
      <List.Item
        key={`${row.task.task_id || row.task.contact_id}:batch`}
        title={row.task.athlete_name || 'Unknown athlete'}
        subtitle={getBatchRowSubtitle(row, operation) || undefined}
        accessories={[
          {
            tag: {
              value: getBatchRowStatusText(row, operation),
              color: getBatchRowStatusColor(row),
            },
          },
        ]}
        detail={<List.Item.Detail markdown={buildBatchRowDetailMarkdown(row, operation)} />}
        actions={
          <ActionPanel>
            {pendingCount > 0 ? (
              <Action
                title={getBatchPrimaryActionTitle({
                  operation,
                  pendingCount,
                  isChecking,
                  isRunning,
                })}
                icon="💬"
                onAction={() => void runBatch()}
              />
            ) : null}
            {operation.kind === 'reschedule_voicemail' && row.status === 'pending' ? (
              <Action
                title="Reselect Slots"
                icon="🗓️"
                shortcut={{ modifiers: ['cmd'], key: 'r' }}
                onAction={() => void reselectBatchRowSlots(row)}
              />
            ) : null}
            <Action
              title="Remove Selection"
              icon="🗑️"
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ['ctrl'], key: 'x' }}
              onAction={() => removeBatchRow(row)}
            />
            <Action title="Refresh Scout Tasks" icon="🔄" onAction={() => void onComplete()} />
          </ActionPanel>
        }
      />
    );
  }

  function renderNoBatchRowsItem() {
    return (
      <List.Item
        title={`No ${operation.label} Rows`}
        subtitle={`Current task bucket has no incomplete ${operation.label} tasks.`}
        actions={
          <ActionPanel>
            <Action title="Refresh Scout Tasks" icon="🔄" onAction={() => void onComplete()} />
          </ActionPanel>
        }
      />
    );
  }

  if (operation.kind === 'confirmation_cleanup') {
    return (
      <List
        isLoading={isRunning || isChecking}
        navigationTitle="Batch Operations"
        searchBarPlaceholder={`Review ${operation.label}`}
      >
        {rows.length ? (
          <>
            <List.Section title="Need to Complete" subtitle={`${confirmationCompleteRows.length}`}>
              {confirmationCompleteRows.map(renderBatchRow)}
            </List.Section>
            <List.Section title="Need to Move" subtitle={`${confirmationMoveRows.length}`}>
              {confirmationMoveRows.map(renderBatchRow)}
            </List.Section>
            {confirmationOtherRows.length ? (
              <List.Section title="Needs Review" subtitle={`${confirmationOtherRows.length}`}>
                {confirmationOtherRows.map(renderBatchRow)}
              </List.Section>
            ) : null}
          </>
        ) : (
          <List.Section>{renderNoBatchRowsItem()}</List.Section>
        )}
      </List>
    );
  }

  return (
    <List
      isLoading={isRunning || isChecking}
      isShowingDetail={operation.kind === 'reschedule_voicemail'}
      navigationTitle="Batch Operations"
      searchBarPlaceholder={`Review ${operation.label}`}
    >
      <List.Section
        title={`${pendingCount} Ready / ${failedCount} Failed`}
        subtitle={
          sentCount || skippedCount ? `${sentCount} Sent / ${skippedCount} Skipped` : undefined
        }
      >
        {rows.length ? (
          rows.map(renderBatchRow)
        ) : (
          renderNoBatchRowsItem()
        )}
      </List.Section>
    </List>
  );
}

function ScoutPrepBatchRoot({
  tasks,
  onComplete,
}: {
  tasks: ScoutPortalTask[];
  onComplete: () => Promise<void> | void;
}) {
  const [operationId, setOperationId] = useState(
    SCOUT_PREP_BATCH_OPERATIONS.callAttempt3Voicemail.id,
  );
  const [confirmedBatch, setConfirmedBatch] = useState<{
    operationId: string;
    gradYear?: string | null;
    taskTitle?: string | null;
  } | null>(null);

  if (!confirmedBatch) {
    return (
      <ScoutPrepBatchSetupForm
        tasks={tasks}
        operationId={operationId}
        onOperationChange={setOperationId}
        onConfirm={setConfirmedBatch}
      />
    );
  }

  return (
    <ScoutPrepBatchPreflightList
      tasks={tasks}
      initialOperationId={confirmedBatch.operationId}
      selectedGradYear={confirmedBatch.gradYear}
      selectedTaskTitle={confirmedBatch.taskTitle}
      onComplete={onComplete}
    />
  );
}

export default function ScoutPrepCommand(
  props: LaunchProps<{ launchContext?: ScoutPrepLaunchContext }> = {} as LaunchProps<{
    launchContext?: ScoutPrepLaunchContext;
  }>,
) {
  const launchContext = props.launchContext;
  const initialTaskListFilter = launchContext?.initialFilter
    ? resolveInitialTaskListFilter(launchContext.initialFilter)
    : DEFAULT_TASK_LIST_FILTER;
  const initialTaskSearchText = String(launchContext?.searchText || '').trim();
  const [taskBuckets, setTaskBuckets] = useState<Record<ScoutTaskRange, ScoutPortalTask[]>>({
    todayPastDue: [],
    all: [],
    tomorrow: [],
    future: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [taskListFilter, setTaskListFilter] = useState<TaskListFilter>(initialTaskListFilter);
  const [taskSearchText, setTaskSearchText] = useState(initialTaskSearchText);
  const [taskListSort, setTaskListSort] = useState<TaskListSort>(DEFAULT_TASK_LIST_SORT);
  const [prospectSearchMode, setProspectSearchMode] = useState<ProspectSearchMode>('athlete');
  const [prospectSearchText, setProspectSearchText] = useState('');
  const [prospectResults, setProspectResults] = useState<ProspectResult[]>([]);
  const [isProspectSearching, setIsProspectSearching] = useState(false);
  const [selectedTaskItemId, setSelectedTaskItemId] = useState<string | undefined>();
  const loadTasksPromiseRef = useRef<Promise<void> | null>(null);
  const initialLoadStartedRef = useRef(false);
  const loadTasksRequestIdRef = useRef(0);
  const prospectSearchRequestIdRef = useRef(0);
  const allTaskSearchRequestIdRef = useRef(0);

  const isAllTaskSearchFirst = taskListFilter === 'all';
  const allTaskSearchText = taskSearchText.trim();
  const hasProspectSearchText = prospectSearchText.trim().length > 0;
  const listSearchText = viewMode === 'prospect' ? prospectSearchText : taskSearchText;
  const selectedTaskRows =
    viewMode === 'tasks'
      ? buildTaskBucketRows({
          filter: taskListFilter,
          taskBuckets,
          sort: taskListSort,
        })
      : [];
  const hasTaskModeResults = selectedTaskRows.length > 0;
  const selectedRange = mapTaskListFilterToRange(taskListFilter);
  const selectedSectionTitle = getTaskSectionTitle(taskListFilter);
  const selectedTaskTitleBase = selectedSectionTitle;
  const callAttempt1Count = selectedTaskRows
    .map((row) => row.task)
    .filter(isCallAttempt1PortalTask).length;
  const selectedTaskTitle = selectedTaskTitleBase;
  const selectedTaskSectionTitle = `${selectedTaskTitle} • Total Tasks: ${selectedTaskRows.length} | T1: ${callAttempt1Count} •`;
  const dailyCallBlockCounts = useMemo(
    () => buildDailyCallBlockTaskCounts(taskBuckets.todayPastDue),
    [taskBuckets.todayPastDue],
  );
  const dailyCallBlocksActionTitle = getDailyCallBlocksActionTitle(dailyCallBlockCounts);

  useEffect(() => {
    if (!selectedTaskItemId) {
      return;
    }

    const timer = setTimeout(() => setSelectedTaskItemId(undefined), 0);
    return () => clearTimeout(timer);
  }, [selectedTaskItemId]);

  const loadTasks = async (options: { force?: boolean } = {}) => {
    if (loadTasksPromiseRef.current && !options.force) {
      logInfo('SCOUT_PREP_TASK_LIST', 'reuse-inflight-load', 'start');
      return loadTasksPromiseRef.current;
    }

    const requestId = ++loadTasksRequestIdRef.current;
    const pendingLoad = (async () => {
      setIsLoading(true);
      try {
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'start');
        const taskBuckets = await fetchScoutPortalTaskBuckets([
          'todayPastDue',
          'tomorrow',
          'future',
        ] as const);
        const nextTaskBuckets = {
          todayPastDue: [...taskBuckets.todayPastDue].reverse(),
          tomorrow: [...taskBuckets.tomorrow].reverse(),
          future: [...taskBuckets.future].reverse(),
        };
        if (requestId !== loadTasksRequestIdRef.current) {
          return;
        }
        const dailyCallBlockTasks = nextTaskBuckets.todayPastDue;
        await setCachedDailyCallBlockTaskCounts(buildDailyCallBlockTaskCounts(dailyCallBlockTasks));
        setTaskBuckets((current) => ({
          ...current,
          ...nextTaskBuckets,
        }));
        setTimeout(() => {
          void seedMissingAthleteContactCacheFromTasks({
            ...nextTaskBuckets,
            all: [],
          });
        }, 0);
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'success', {
          selectedRange,
          todayPastDueCount: nextTaskBuckets.todayPastDue.length,
          tomorrowCount: nextTaskBuckets.tomorrow.length,
          futureCount: nextTaskBuckets.future.length,
          firstAthlete:
            selectedRange === 'all'
              ? null
              : nextTaskBuckets[selectedRange][0]?.athlete_name || null,
          lastAthlete:
            selectedRange === 'all'
              ? null
              : nextTaskBuckets[selectedRange][nextTaskBuckets[selectedRange].length - 1]
                  ?.athlete_name || null,
        });
      } catch (error) {
        if (requestId !== loadTasksRequestIdRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        logFailure('SCOUT_PREP_TASK_LIST', 'load-list', message);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Scout load failed',
          message,
        });
      } finally {
        if (requestId === loadTasksRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    })().finally(() => {
      if (requestId === loadTasksRequestIdRef.current) {
        loadTasksPromiseRef.current = null;
      }
    });

    loadTasksPromiseRef.current = pendingLoad;
    return pendingLoad;
  };

  const loadAllTaskSearch = async (searchText: string) => {
    const requestId = ++allTaskSearchRequestIdRef.current;
    setIsLoading(true);
    try {
      logInfo('SCOUT_PREP_TASK_LIST', 'load-all-search', 'start', {
        searchText,
      });
      const allTasks = await fetchScoutPortalTasks('all', {
        start: 0,
        length: TASK_LIST_PAGE_SIZE,
        searchText,
      });
      if (requestId !== allTaskSearchRequestIdRef.current) {
        return;
      }
      setTaskBuckets((current) => ({
        ...current,
        all: [...allTasks],
      }));
      setTimeout(() => {
        void seedMissingAthleteContactCacheFromTasks({
          todayPastDue: [],
          all: allTasks,
          tomorrow: [],
          future: [],
        });
      }, 0);
      logInfo('SCOUT_PREP_TASK_LIST', 'load-all-search', 'success', {
        allCount: allTasks.length,
        searchText,
      });
    } catch (error) {
      if (requestId !== allTaskSearchRequestIdRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setTaskBuckets((current) => ({
        ...current,
        all: [],
      }));
      logFailure('SCOUT_PREP_TASK_LIST', 'load-all-search', message, {
        searchText,
      });
      await showToast({
        style: Toast.Style.Failure,
        title: 'Scout search failed',
        message,
      });
    } finally {
      if (requestId === allTaskSearchRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (initialLoadStartedRef.current) {
      return;
    }
    initialLoadStartedRef.current = true;
    void loadTasks();
  }, []);

  useEffect(() => {
    if (!isAllTaskSearchFirst) {
      return;
    }

    if (!allTaskSearchText) {
      allTaskSearchRequestIdRef.current += 1;
      setTaskBuckets((current) => ({
        ...current,
        all: [],
      }));
      setIsLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      void loadAllTaskSearch(allTaskSearchText);
    }, 350);

    return () => clearTimeout(timer);
  }, [isAllTaskSearchFirst, allTaskSearchText]);

  const handleExportDailyCallBlocks = async () => {
    await exportDailyCallBlocks(dailyCallBlockCounts);
  };

  useEffect(() => {
    if (viewMode !== 'prospect') {
      setProspectResults([]);
      setIsProspectSearching(false);
      return;
    }

    const term = prospectSearchText.trim();
    if (!term) {
      setProspectResults([]);
      setIsProspectSearching(false);
      return;
    }

    const requestId = ++prospectSearchRequestIdRef.current;
    setIsProspectSearching(true);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const results = await runProspectRawSearch(
            term,
            prospectSearchMode === 'parent' ? { searchingFor: 'Parent' } : undefined,
          );
          if (requestId !== prospectSearchRequestIdRef.current) {
            return;
          }
          const enrichedResults =
            results.length === 1 ? [await ensureProspectDetails(results[0])] : results;
          if (requestId !== prospectSearchRequestIdRef.current) {
            return;
          }
          setProspectResults(enrichedResults);
        } catch (error) {
          if (requestId !== prospectSearchRequestIdRef.current) {
            return;
          }
          setProspectResults([]);
          await showToast({
            style: Toast.Style.Failure,
            title: 'Search failed',
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (requestId === prospectSearchRequestIdRef.current) {
            setIsProspectSearching(false);
          }
        }
      })();
    }, 350);

    return () => clearTimeout(timer);
  }, [viewMode, prospectSearchText, prospectSearchMode]);

  function toggleProspectSearchMode() {
    setViewMode((current) => {
      if (current === 'prospect') {
        // Exit prospect → back to tasks
        setProspectSearchMode('athlete');
        setProspectSearchText('');
        setProspectResults([]);
        setIsProspectSearching(false);
        return 'tasks';
      }
      return 'prospect';
    });
  }

  function toggleProspectSearchModeType() {
    setProspectSearchMode((current) => (current === 'parent' ? 'athlete' : 'parent'));
    setProspectResults([]);
    setIsProspectSearching(false);
  }

  async function handleAddPersonalFollowUp(result: ProspectResult, searchMode: ProspectSearchMode) {
    const saved = await addPersonalFollowUp(result, searchMode);
    if (!saved) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete ID',
      });
      return;
    }

    await showToast({
      style: Toast.Style.Success,
      title: 'Saved',
      message:
        searchMode === 'parent'
          ? result.parent_name || result.name || 'Personal follow-up'
          : result.name || 'Personal follow-up',
    });
  }

  async function handleAddPersonalFollowUpFromTask(task: ScoutPortalTask) {
    const result = buildPersonalFollowUpResultFromTask(task);
    if (!result) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete ID',
      });
      return;
    }

    const saved = await addPersonalFollowUp(result, 'athlete');
    if (!saved) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete ID',
      });
      return;
    }

    await showToast({
      style: Toast.Style.Success,
      title: 'Saved',
      message: result.name || 'Personal follow-up',
    });
  }

  function selectFirstTaskRow(rows: typeof selectedTaskRows) {
    setSelectedTaskItemId(rows[0] ? buildScoutPrepTaskItemId(rows[0].task) : undefined);
  }

  function selectTaskListFilter(filter: TaskListFilter) {
    setTaskListFilter(filter);
    if (filter === 'all') {
      setSelectedTaskItemId(undefined);
      return;
    }
    setTaskBuckets((current) => ({
      ...current,
      all: [],
    }));
    selectFirstTaskRow(
      buildTaskBucketRows({
        filter,
        taskBuckets,
        sort: taskListSort,
      }),
    );
  }

  function cycleSort(key: TaskListSortKey) {
    const nextSort = cycleTaskListSort(taskListSort, key);
    setTaskListSort(nextSort);
    selectFirstTaskRow(
      buildTaskBucketRows({
        filter: taskListFilter,
        taskBuckets,
        sort: nextSort,
      }),
    );
  }

  function handleListSearchTextChange(text: string) {
    if (viewMode === 'prospect') {
      setProspectSearchText(text);
      return;
    }
    setTaskSearchText(text);
  }

  function buildPersonalFollowUpsTarget() {
    return <PersonalFollowUpsList onReturnToRootList={returnToRootTaskList} />;
  }

  function buildBatchSourceTasks(): ScoutPortalTask[] {
    const seen = new Set<string>();
    return [
      ...taskBuckets.todayPastDue,
      ...taskBuckets.all,
      ...taskBuckets.tomorrow,
      ...taskBuckets.future,
    ].filter((task) => {
      const key = buildScoutPrepTaskItemId(task);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function buildBatchVoicemailTarget() {
    return <ScoutPrepBatchRoot tasks={buildBatchSourceTasks()} onComplete={returnToRootTaskList} />;
  }

  async function returnToRootTaskList() {
    allTaskSearchRequestIdRef.current += 1;
    setViewMode('tasks');
    setTaskListFilter(DEFAULT_TASK_LIST_FILTER);
    setTaskSearchText('');
    setTaskListSort(DEFAULT_TASK_LIST_SORT);
    setSelectedTaskItemId(undefined);
    setProspectSearchText('');
    setProspectResults([]);
    setIsProspectSearching(false);
    setTaskBuckets((current) => ({
      ...current,
      all: [],
    }));
    await clearSearchBar({ forceScrollToTop: true });
    await loadTasks({ force: true });
  }

  return (
    <List
      isLoading={isLoading || isProspectSearching}
      navigationTitle={viewMode === 'prospect' ? 'Scout Prep Search' : 'Scout Prep'}
      searchBarAccessory={
        viewMode === 'tasks' ? (
          <List.Dropdown
            tooltip="Task List Filter"
            value={taskListFilter}
            onChange={(newValue) => selectTaskListFilter(newValue as TaskListFilter)}
          >
            <List.Dropdown.Item title="Today/PastDue" value="todayPastDue" />
            <List.Dropdown.Item title="Tomorrow" value="tomorrow" />
            <List.Dropdown.Item title="Future" value="future" />
            <List.Dropdown.Item title="All" value="all" />
          </List.Dropdown>
        ) : undefined
      }
      filtering={viewMode !== 'prospect'}
      searchBarPlaceholder={
        viewMode === 'prospect'
          ? prospectSearchMode === 'parent'
            ? 'Parent Search — Enter parent name, email, or phone'
            : 'Prospect Search — Enter athlete name or email'
          : 'Search Task List'
      }
      searchText={listSearchText}
      onSearchTextChange={handleListSearchTextChange}
      selectedItemId={viewMode === 'tasks' ? selectedTaskItemId : undefined}
    >
      {viewMode === 'prospect' ? (
        <List.Section title={`Prospect Search`} subtitle={String(prospectResults.length)}>
          {prospectResults.length > 0 ? (
            prospectResults.map((result, index) => (
              <ProspectSearchListItem
                key={`search:${result.athlete_id}:${result.athlete_main_id || result.name || 'result'}`}
                result={result}
                index={index}
                searchMode={prospectSearchMode}
                onToggleProspectSearchModeType={toggleProspectSearchModeType}
                onToggleProspectSearchMode={toggleProspectSearchMode}
                onAddPersonalFollowUp={handleAddPersonalFollowUp}
                onReturnToRootList={returnToRootTaskList}
              />
            ))
          ) : (
            <List.Item
              icon="🔎"
              title={
                isProspectSearching
                  ? 'Searching ProspectID'
                  : hasProspectSearchText
                    ? 'No Prospect Matches'
                    : 'Prospect Search'
              }
              subtitle={
                isProspectSearching
                  ? 'Searching…'
                  : hasProspectSearchText
                    ? 'No matches found'
                    : 'Enter athlete name or email'
              }
              actions={
                <ActionPanel>
                  <Action
                    title={
                      prospectSearchMode === 'parent'
                        ? 'Switch to Athlete Search'
                        : 'Switch to Parent Search'
                    }
                    icon="👤"
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
                    onAction={toggleProspectSearchModeType}
                  />
                  <Action.Push
                    title="Personal Follow-Ups"
                    icon="🕘"
                    shortcut={{ modifiers: ['cmd'], key: 'f' }}
                    target={buildPersonalFollowUpsTarget()}
                  />
                  <Action
                    title="Exit Prospect Search"
                    icon="🔎"
                    onAction={toggleProspectSearchMode}
                  />
                  <SupabaseLifecycleStatusAction />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      ) : !hasTaskModeResults ? (
        <List.EmptyView
          title={
            taskListFilter === 'all' && !allTaskSearchText
              ? 'Search all assigned tasks'
              : taskListFilter === 'todayPastDue'
                ? 'No items found'
                : `No ${selectedSectionTitle.toLowerCase()} items found`
          }
          description={
            taskListFilter === 'all' && !allTaskSearchText
              ? 'Type an athlete, task, school, sport, or related text to search Laravel assigned tasks.'
              : taskListFilter === 'all'
                ? 'No assigned tasks matched that search.'
                : taskListFilter === 'todayPastDue'
                  ? 'There are no active Scout Prep tasks due today or past due.'
                  : `The ${selectedSectionTitle.toLowerCase()} task bucket is empty.`
          }
          actions={
            <ActionPanel>
              <Action title="Reload Scout Tasks" onAction={() => void loadTasks()} />
              <Action
                title={dailyCallBlocksActionTitle}
                icon="📅"
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
                onAction={() => void handleExportDailyCallBlocks()}
              />
              <ActionPanel.Section title="Navigation">
                <Action
                  title="Show Today/PastDue"
                  shortcut={{ modifiers: ['opt'], key: '1' }}
                  onAction={() => selectTaskListFilter('todayPastDue')}
                />
                <Action
                  title="Show Tomorrow"
                  shortcut={{ modifiers: ['opt'], key: '2' }}
                  onAction={() => selectTaskListFilter('tomorrow')}
                />
                <Action
                  title="Show Future"
                  shortcut={{ modifiers: ['opt'], key: '3' }}
                  onAction={() => selectTaskListFilter('future')}
                />
                <Action
                  title="Show All"
                  shortcut={{ modifiers: ['opt'], key: '4' }}
                  onAction={() => selectTaskListFilter('all')}
                />
                <Action.Push
                  title="Batch Operations"
                  icon="💬"
                  shortcut={{ modifiers: ['cmd', 'shift'], key: '0' }}
                  target={buildBatchVoicemailTarget()}
                />
                <Action.Push
                  title="Personal Follow-Ups"
                  icon="🕘"
                  shortcut={{ modifiers: ['cmd'], key: 'f' }}
                  target={buildPersonalFollowUpsTarget()}
                />
                <Action
                  title="Prospect Search"
                  icon="🔎"
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
                  onAction={toggleProspectSearchMode}
                />
                <SupabaseLifecycleStatusAction />
              </ActionPanel.Section>
              <ActionPanel.Section title="Sort">
                <Action
                  title={getSortActionTitle(taskListSort, 'gradYear')}
                  icon="↕️"
                  shortcut={{ modifiers: ['cmd'], key: 'n' }}
                  onAction={() => cycleSort('gradYear')}
                />
                <Action
                  title={getSortActionTitle(taskListSort, 'callAttempt')}
                  icon="↕️"
                  shortcut={{ modifiers: ['cmd'], key: 'm' }}
                  onAction={() => cycleSort('callAttempt')}
                />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title={selectedTaskSectionTitle}>
          {selectedTaskRows.map((row) => (
            <ScoutPrepTaskItem
              key={buildScoutPrepTaskItemId(row.task)}
              task={row.task}
              taskListFilter={taskListFilter}
              taskListSort={taskListSort}
              dailyCallBlocksActionTitle={dailyCallBlocksActionTitle}
              batchVoicemailTarget={buildBatchVoicemailTarget()}
              onExportDailyCallBlocks={() => void handleExportDailyCallBlocks()}
              onToggleProspectSearchMode={toggleProspectSearchMode}
              personalFollowUpsTarget={buildPersonalFollowUpsTarget()}
              onAddPersonalFollowUpFromTask={(task) => void handleAddPersonalFollowUpFromTask(task)}
              onSelectTaskListFilter={selectTaskListFilter}
              onCycleTaskListSort={cycleSort}
              onReturnToRootList={returnToRootTaskList}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
