import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  Clipboard,
  open,
  popToRoot,
  showToast,
  useNavigation,
} from '@raycast/api';
import { useForm } from '@raycast/utils';
import { spawn } from 'child_process';
import { useEffect, useRef, useState } from 'react';
import SupabaseLifecycleStatusCommand from './supabase-lifecycle-status';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import {
  ConfirmationReminderMessageForm,
  VoicemailFollowUpMessageForm,
} from './components/follow-up-message-forms';
import { HeadScoutSchedulesRoot } from './head-scout-schedules';
import type {
  MeetingSetSubmitResponse,
  MeetingSetTemplateResponse,
  SalesStageOption,
  ScoutAthleteTask,
  ScoutRecentProfile,
  ScoutRecentProfileCheckStatus,
  ScoutPortalTask,
  ScoutPrepContext,
} from './features/scout-prep/types';
import {
  buildMeetingTemplateDefaults,
  buildMessagesComposeUrlForRecipients,
  buildTimeOfDayGreeting,
  buildProspectContactShortcutPayloadFromName,
  buildScoutPrepLeavingVoicemailBody,
  buildVoicemailFollowUpBody,
  getMeetingReminderRecipient,
  getVoicemailFollowUpRecipients,
  getProspectContactShortcutCandidates,
  normalizePhoneForMessages,
  type ProspectContactShortcutCandidate,
  selectScoutPrepContactNumbers,
} from './lib/scout-prep-contact';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepMetadata,
  buildScoutPrepValues,
  completeScoutPrepTaskAfterVoicemail,
  fetchAthleteTasks,
  fetchScoutPortalTaskBuckets,
  fetchScoutRecentProfiles,
  fetchScoutTaskPopup,
  findNewestIncompleteFollowUpTask,
  findNewestIncompleteConfirmationTask,
  loadScoutPrepContext,
  recordVoicemailFollowUpMessageSent,
  stripMoveThisTaskPrefix,
  updateScoutPrepTask,
} from './lib/scout-prep';
import {
  buildTaskBucketRows,
  getTaskSectionTitle,
  mapTaskListFilterToRange,
  type TaskListFilter,
} from './lib/scout-task-filters';
import { syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
import {
  ensureProspectDetails,
  runProspectRawSearch,
  type ProspectResult,
} from './lib/prospect-search';
import {
  fetchCuratedSalesStageOptions,
  fetchMeetingSetTemplate,
  submitMeetingSet,
  updateSalesStage,
} from './lib/sales-stage';
import { searchLogger } from './lib/logger';
import {
  fetchOpenMeetings,
  HEAD_SCOUT_ORDER,
  type OpenMeetingSlot,
} from './lib/head-scout-schedules';
import { prepareConfirmationFollowUp } from './lib/scout-follow-up-queue';
import {
  resolveConfirmationFollowUpVariant,
  resolveVoicemailFollowUpVariant,
  type ConfirmationFollowUpVariant,
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
  recordConfirmationSent,
  recordMeetingSet,
  recordRescheduled,
} from './lib/supabase-lifecycle';
import { buildAssociatedClientsFromContactInfo } from './lib/client-message-export';
import { sendClientMessage } from './lib/client-message-sandbox';

const FEATURE = 'scout-prep';
const MEETING_SET_LABEL = 'Meeting Set';
const LEFT_VOICE_MAIL_1_LABEL = 'Left Voice Mail 1';
const LEFT_VOICE_MAIL_2_LABEL = 'Left Voice Mail 2';
const NEVER_SPOKE_TO_LABEL = 'Never Spoke To';
const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

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

function formatTaskIdLabel(taskId?: string | number | null): string {
  const normalized = String(taskId || '').trim();
  return normalized ? `#${normalized}` : '';
}

async function copyToClipboardWithToast(content: string, title: string) {
  await Clipboard.copy(content);
  await showToast({
    style: Toast.Style.Success,
    title,
  });
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

function getTaskDisplayTitle(
  task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null,
): string {
  return (
    stripMoveThisTaskPrefix(task?.title) ||
    String(task?.description || '').trim() ||
    'Untitled Task'
  );
}

function shouldAutoCompletePostCallTask(
  stageLabel: string,
  task?: ScoutPortalTask | null,
): boolean {
  const normalizedStage = String(stageLabel || '').trim();
  const taskTitle = stripMoveThisTaskPrefix(task?.title) || '';

  if (normalizedStage === LEFT_VOICE_MAIL_1_LABEL) {
    return true;
  }

  if (normalizedStage === LEFT_VOICE_MAIL_2_LABEL && taskTitle === 'Call Attempt 2') {
    return true;
  }

  if (normalizedStage === NEVER_SPOKE_TO_LABEL && taskTitle === 'Call Attempt 3') {
    return true;
  }

  return false;
}

function getIncompleteAthleteTasks(tasks: ScoutPrepContext['tasks']): ScoutAthleteTask[] {
  return tasks
    .filter(
      (task) => !String(task.completion_date || '').trim() && String(task.task_id || '').trim(),
    )
    .map((task) => ({
      task_id: String(task.task_id || '').trim(),
      title: task.title,
      assigned_owner: task.assigned_owner,
      due_date: task.due_date,
      completion_date: task.completion_date,
      description: task.description,
      row_text: task.row_text,
    }))
    .sort((left, right) => {
      const leftId = Number.parseInt(String(left.task_id || '0'), 10);
      const rightId = Number.parseInt(String(right.task_id || '0'), 10);
      return rightId - leftId;
    });
}

function findNewestIncompleteTaskByTitle(
  tasks: ScoutPrepContext['tasks'],
  taskTitle: string,
): ScoutAthleteTask | null {
  const normalizedTarget = String(taskTitle || '')
    .trim()
    .toLowerCase();
  if (!normalizedTarget) {
    return null;
  }

  return (
    getIncompleteAthleteTasks(tasks).find(
      (candidate) =>
        (stripMoveThisTaskPrefix(candidate.title) || '').trim().toLowerCase() === normalizedTarget,
    ) || null
  );
}

function isVoicemailLifecycleTaskMatch(
  task: Pick<ScoutAthleteTask, 'title' | 'description'>,
  variant: VoicemailFollowUpVariant,
): boolean {
  const title = (stripMoveThisTaskPrefix(task.title) || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
  const description = String(task.description || '')
    .trim()
    .toLowerCase();

  if (variant === 'call_attempt_1') {
    return title === 'call attempt 1' || description.includes('first time');
  }
  if (variant === 'call_attempt_2') {
    return (
      title === 'call attempt 2' ||
      (title === 'scheduled follow up' && description.includes('second time')) ||
      description.includes('second time')
    );
  }
  if (variant === 'call_attempt_3') {
    return title === 'call attempt 3' || description.includes('third time');
  }

  return false;
}

function SupabaseLifecycleStatusAction() {
  return (
    <Action.Push
      title="Supabase Lifecycle Status"
      icon={Icon.HardDrive}
      shortcut={{ modifiers: ['cmd', 'opt'], key: 's' }}
      target={<SupabaseLifecycleStatusCommand />}
    />
  );
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

async function recordConfirmationSentBestEffort(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  currentTask: string;
  prepared: Awaited<ReturnType<typeof prepareConfirmationFollowUp>>;
  reminderVariant?: ConfirmationFollowUpVariant;
}) {
  try {
    await recordConfirmationSent({
      athleteId: args.athleteId,
      athleteMainId: args.athleteMainId,
      athleteName: args.athleteName,
      crmStage: args.prepared.resolvedAppointment.crmSalesStage,
      taskStatus: args.currentTask,
      headScout:
        args.prepared.headScoutName || args.prepared.resolvedAppointment.assignedScout || null,
      currentTaskId: args.taskId,
      currentTaskTitle: args.currentTask,
      appointmentId: args.prepared.resolvedAppointment.currentMeeting?.event_id || null,
      dueAt: args.prepared.dueAt.toISOString(),
      sentAt: new Date().toISOString(),
      messagePreview: args.prepared.canDraft
        ? args.prepared.message
        : args.prepared.resolvedAppointment.reason,
      reminderKind: args.reminderVariant || 'confirmation',
      messageVariant: args.reminderVariant || 'confirmation_1',
    });
  } catch (error) {
    logFailure(
      'SCOUT_PREP_CONFIRMATION_SENT_SYNC',
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

async function recordRescheduledBestEffort(args: {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  taskId: string;
  currentTask: string;
  prepared: Awaited<ReturnType<typeof prepareConfirmationFollowUp>>;
}) {
  try {
    await recordRescheduled({
      athleteId: args.athleteId,
      athleteMainId: args.athleteMainId,
      athleteName: args.athleteName,
      crmStage: args.prepared.resolvedAppointment.crmSalesStage || 'Rescheduled',
      taskStatus: args.currentTask,
      headScout:
        args.prepared.headScoutName || args.prepared.resolvedAppointment.assignedScout || null,
      currentTaskId: args.taskId,
      currentTaskTitle: args.currentTask,
      previousAppointmentId: args.prepared.resolvedAppointment.previousMeeting?.event_id || null,
      appointmentId: args.prepared.resolvedAppointment.currentMeeting?.event_id || null,
      startsAt: args.prepared.resolvedAppointment.currentMeeting?.start || null,
      dueAt: args.prepared.dueAt.toISOString(),
    });
  } catch (error) {
    logFailure(
      'SCOUT_PREP_RESCHEDULED_SYNC',
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

async function createProspectContact(
  candidate?: ProspectContactShortcutCandidate | null,
): Promise<ProspectContactCreateResult> {
  const activeCandidate = candidate || null;
  if (!activeCandidate) {
    throw new Error('No eligible contact found');
  }

  const payload = buildProspectContactShortcutPayloadFromName({
    fullName: activeCandidate.name,
    phone: activeCandidate.phone,
  });
  const [firstName, lastName, phone] = payload.split('\n');
  const result = await runOsaScript(
    [
      'on run argv',
      'set firstName to item 1 of argv',
      'set lastName to item 2 of argv',
      'set phoneValue to item 3 of argv',
      'tell application "Contacts"',
      'set matchingPeople to every person whose first name is firstName and last name is lastName',
      'set targetPerson to missing value',
      'set actionStatus to "created"',
      'repeat with matchingPerson in matchingPeople',
      'repeat with existingPhone in phones of matchingPerson',
      'if value of existingPhone is phoneValue then',
      'set targetPerson to matchingPerson',
      'set actionStatus to "exists"',
      'exit repeat',
      'end if',
      'end repeat',
      'if targetPerson is not missing value then exit repeat',
      'if targetPerson is missing value then set targetPerson to matchingPerson',
      'set actionStatus to "updated"',
      'end repeat',
      'if targetPerson is missing value then',
      'set targetPerson to make new person with properties {first name:firstName, last name:lastName}',
      'make new phone at end of phones of targetPerson with properties {label:"mobile", value:phoneValue}',
      'else if actionStatus is "updated" then',
      'make new phone at end of phones of targetPerson with properties {label:"mobile", value:phoneValue}',
      'end if',
      'set preferredGroup to missing value',
      'repeat with existingGroup in every group',
      'if (name of existingGroup) is "ID Contacts" then',
      'set preferredGroup to existingGroup',
      'exit repeat',
      'end if',
      'end repeat',
      'if preferredGroup is missing value then',
      'repeat with existingGroup in every group',
      'set groupNameText to name of existingGroup',
      'ignoring case',
      'if (groupNameText contains "prospect" and groupNameText contains "id") or groupNameText contains "id contacts" or (groupNameText contains "client" and groupNameText contains "id") then',
      'set preferredGroup to existingGroup',
      'exit repeat',
      'end if',
      'end ignoring',
      'end repeat',
      'end if',
      'set matchedGroupName to ""',
      'if preferredGroup is not missing value then',
      'set matchedGroupName to name of preferredGroup',
      'set targetPersonId to id of targetPerson',
      'set memberIds to id of every person of preferredGroup',
      'if memberIds does not contain targetPersonId then add targetPerson to preferredGroup',
      'end if',
      'save',
      'return actionStatus & "|" & matchedGroupName',
      'end tell',
      'end run',
    ],
    [firstName || '', lastName || '', phone || ''],
  );

  const [statusValue, groupNameValue] = result.split('|');
  const status =
    statusValue === 'exists' || statusValue === 'updated' || statusValue === 'created'
      ? statusValue
      : 'created';

  return {
    status,
    groupName: String(groupNameValue || '').trim() || null,
  };
}

async function createProspectContactsBatch(
  candidates: ProspectContactShortcutCandidate[],
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

  const output = await runOsaScript(
    [
      'on findPreferredGroup()',
      'tell application "Contacts"',
      'set preferredGroup to missing value',
      'repeat with existingGroup in every group',
      'if (name of existingGroup) is "ID Contacts" then',
      'set preferredGroup to existingGroup',
      'exit repeat',
      'end if',
      'end repeat',
      'if preferredGroup is missing value then',
      'repeat with existingGroup in every group',
      'set groupNameText to name of existingGroup',
      'ignoring case',
      'if (groupNameText contains "prospect" and groupNameText contains "id") or groupNameText contains "id contacts" or (groupNameText contains "client" and groupNameText contains "id") then',
      'set preferredGroup to existingGroup',
      'exit repeat',
      'end if',
      'end ignoring',
      'end repeat',
      'end if',
      'return preferredGroup',
      'end tell',
      'end findPreferredGroup',
      '',
      'on joinLines(values)',
      "set previousDelimiters to AppleScript's text item delimiters",
      "set AppleScript's text item delimiters to linefeed",
      'set joinedText to values as text',
      "set AppleScript's text item delimiters to previousDelimiters",
      'return joinedText',
      'end joinLines',
      '',
      'on run argv',
      'set resultLines to {}',
      'tell application "Contacts"',
      'set preferredGroup to my findPreferredGroup()',
      'repeat with index from 1 to (count of argv) by 3',
      'if index + 2 is greater than (count of argv) then exit repeat',
      'set firstName to item index of argv',
      'set lastName to item (index + 1) of argv',
      'set phoneValue to item (index + 2) of argv',
      'set matchingPeople to every person whose first name is firstName and last name is lastName',
      'set targetPerson to missing value',
      'set actionStatus to "created"',
      'repeat with matchingPerson in matchingPeople',
      'repeat with existingPhone in phones of matchingPerson',
      'if value of existingPhone is phoneValue then',
      'set targetPerson to matchingPerson',
      'set actionStatus to "exists"',
      'exit repeat',
      'end if',
      'end repeat',
      'if targetPerson is not missing value then exit repeat',
      'if targetPerson is missing value then set targetPerson to matchingPerson',
      'set actionStatus to "updated"',
      'end repeat',
      'if targetPerson is missing value then',
      'set targetPerson to make new person with properties {first name:firstName, last name:lastName}',
      'make new phone at end of phones of targetPerson with properties {label:"mobile", value:phoneValue}',
      'else if actionStatus is "updated" then',
      'make new phone at end of phones of targetPerson with properties {label:"mobile", value:phoneValue}',
      'end if',
      'set matchedGroupName to ""',
      'if preferredGroup is not missing value then',
      'set matchedGroupName to name of preferredGroup',
      'set targetPersonId to id of targetPerson',
      'set memberIds to id of every person of preferredGroup',
      'if memberIds does not contain targetPersonId then add targetPerson to preferredGroup',
      'end if',
      'end if',
      'set resultLine to actionStatus & "|" & matchedGroupName & "|" & firstName & " " & lastName & "|" & phoneValue',
      'copy resultLine to end of resultLines',
      'end repeat',
      'save',
      'return my joinLines(resultLines)',
      'end tell',
      'end run',
    ],
    args,
  );

  const candidateByKey = new Map(
    uniqueCandidates.map((candidate) => [`${candidate.name}|${candidate.phone}`, candidate]),
  );
  const results = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusValue, groupNameValue, nameValue, phoneValue] = line.split('|');
      const status =
        statusValue === 'exists' || statusValue === 'updated' || statusValue === 'created'
          ? statusValue
          : 'created';
      const candidate =
        candidateByKey.get(
          `${String(nameValue || '').trim()}|${String(phoneValue || '').trim()}`,
        ) || uniqueCandidates.find((item) => item.phone === String(phoneValue || '').trim());
      if (!candidate) {
        return null;
      }
      return {
        candidate,
        status,
        groupName: String(groupNameValue || '').trim() || null,
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

async function runOsaScript(lines: string[], args: string[] = []) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('osascript', [...lines.flatMap((line) => ['-e', line]), ...args], {
      shell: false,
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function collectBatchProspectContactCandidates(tasks: ScoutPortalTask[]): Promise<{
  candidates: ProspectContactShortcutCandidate[];
  failedTasks: Array<{ task: ScoutPortalTask; message: string }>;
}> {
  const uniqueCandidates = new Map<string, ProspectContactShortcutCandidate>();
  const failedTasks: Array<{ task: ScoutPortalTask; message: string }> = [];

  for (const task of tasks) {
    try {
      const context = await loadScoutPrepContext(task);
      const candidates = buildAssociatedClientsFromContactInfo({
        athleteName: context.contactInfo.studentAthlete.name || task.athlete_name,
        contactInfo: context.contactInfo,
      })
        .map((associate) => ({
          id: associate.role,
          label: associate.relationshipLabel,
          name:
            String(associate.name || '').trim() ||
            (associate.role === 'studentAthlete' ? task.athlete_name : associate.relationshipLabel),
          phone: associate.normalizedPhoneNumber.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3'),
        }))
        .sort(
          (left, right) =>
            ['parent1', 'studentAthlete', 'parent2'].indexOf(left.id) -
            ['parent1', 'studentAthlete', 'parent2'].indexOf(right.id),
        );
      for (const candidate of candidates) {
        const key = `${candidate.phone}|${candidate.name.toLowerCase()}`;
        if (!uniqueCandidates.has(key)) {
          uniqueCandidates.set(key, candidate);
        }
      }
    } catch (error) {
      failedTasks.push({
        task,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    candidates: Array.from(uniqueCandidates.values()),
    failedTasks,
  };
}

async function handleBatchCreateProspectContacts(tasks: ScoutPortalTask[]) {
  if (!tasks.length) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'No visible tasks found',
    });
    return;
  }

  const toast = await showLoadingToast(
    'Prep contacts',
    `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`,
  );

  try {
    const { candidates, failedTasks } = await collectBatchProspectContactCandidates(tasks);

    if (!candidates.length) {
      toast.style = Toast.Style.Failure;
      toast.title = 'No contacts ready';
      toast.message =
        failedTasks.length > 0
          ? `${failedTasks.length} ${failedTasks.length === 1 ? 'task failed to load' : 'tasks failed to load'}`
          : 'No contacts had both a name and phone number.';
      return;
    }

    toast.title = 'Creating';
    toast.message = `${candidates.length} unique contacts`;

    const summary = await createProspectContactsBatch(candidates);
    toast.style = Toast.Style.Success;
    toast.title = 'Contacts ready';

    const detailParts = [
      summary.createdCount ? `${summary.createdCount} created` : null,
      summary.updatedCount ? `${summary.updatedCount} updated` : null,
      summary.existingCount ? `${summary.existingCount} existing` : null,
      failedTasks.length
        ? `${failedTasks.length} ${failedTasks.length === 1 ? 'task failed' : 'tasks failed'}`
        : null,
    ].filter(Boolean);

    const groupLabel = summary.groupNames[0] || null;
    toast.message = groupLabel
      ? `${detailParts.join(' • ')} • ${groupLabel}`
      : detailParts.join(' • ');
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = 'Contact batch failed';
    toast.message = error instanceof Error ? error.message : String(error);
  }
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

  async function handleCreateProspectContact(candidate?: ProspectContactShortcutCandidate | null) {
    const activeContext = context;
    if (!activeContext) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Contact loading',
      });
      return;
    }

    const candidates = getProspectContactShortcutCandidates(activeContext);
    const activeCandidate = candidate || candidates[0] || null;
    if (!activeCandidate) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No contact ready',
        message: 'Need full name + phone.',
      });
      return;
    }

    setIsCreatingContact(true);
    const toast = await showLoadingToast(
      'Create contact',
      `${activeCandidate.name}${activeCandidate.phone ? ` • ${activeCandidate.phone}` : ''}`,
    );
    try {
      const result = await createProspectContact(activeCandidate);
      toast.style = Toast.Style.Success;
      toast.title =
        result.status === 'exists'
          ? 'Contact already exists'
          : result.status === 'updated'
            ? 'Contact updated'
            : 'Contact created';
      toast.message = result.groupName
        ? `${activeCandidate.label}: ${activeCandidate.name} • ${result.groupName}`
        : `${activeCandidate.label}: ${activeCandidate.name}`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Contact create failed';
      toast.message = error instanceof Error ? error.message : String(error);
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
                    void copyToClipboardWithToast(contactInfo.parent1.phone || '', 'P1 # Copied')
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
                  void copyToClipboardWithToast(
                    contactInfo.studentAthlete.phone || '',
                    'SA # Copied',
                  )
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
                    void copyToClipboardWithToast(contactInfo.parent2.phone || '', 'P2 # Copied')
                  }
                />
              ) : null}
            </ActionPanel.Section>
          ) : null}
          <ActionPanel.Section>
            {contactCandidates[0] ? (
              <Action
                title={`Create ${contactCandidates[0].label} Contact`}
                icon={Icon.Person}
                shortcut={{ modifiers: ['cmd'], key: '1' }}
                onAction={() => void handleCreateProspectContact(contactCandidates[0])}
              />
            ) : null}
            {contactCandidates[1] ? (
              <Action
                title={`Create ${contactCandidates[1].label} Contact`}
                icon={Icon.Person}
                shortcut={{ modifiers: ['cmd'], key: '2' }}
                onAction={() => void handleCreateProspectContact(contactCandidates[1])}
              />
            ) : null}
            {contactCandidates[2] ? (
              <Action
                title={`Create ${contactCandidates[2].label} Contact`}
                icon={Icon.Person}
                shortcut={{ modifiers: ['cmd'], key: '3' }}
                onAction={() => void handleCreateProspectContact(contactCandidates[2])}
              />
            ) : null}
            <Action
              title="Refresh Contact Info"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
              onAction={() => void loadContactInfo({ showToast: true })}
            />
            <Action.OpenInBrowser
              title="Open Contact Info on Admin"
              icon={Icon.Globe}
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

function SingleRecipientMessageForm({
  title,
  recipientName,
  phone,
  initialMessage,
  onMessageSent,
  onMessageSentLabel,
}: {
  title: string;
  recipientName: string;
  phone: string;
  initialMessage: string;
  onMessageSent?: () => Promise<void>;
  onMessageSentLabel?: string;
}) {
  const { itemProps, handleSubmit } = useForm<{ message: string }>({
    initialValues: { message: initialMessage },
    async onSubmit(values) {
      const result = await sendClientMessage({
        address: phone,
        text: values.message,
        serviceName: 'iMessage',
      });

      if (result !== 'Success') {
        throw new Error(result);
      }

      if (onMessageSent) {
        const toast = await showLoadingToast('Saving', onMessageSentLabel || 'Follow-up');
        try {
          await onMessageSent();
          toast.hide();
        } catch (error) {
          toast.style = Toast.Style.Failure;
          toast.title = 'Sent, save failed';
          toast.message = error instanceof Error ? error.message : String(error);
          return;
        }
      }

      await showToast({
        style: Toast.Style.Success,
        title: 'Sent',
        message: recipientName,
      });
      await popToRoot({ clearSearchBar: true });
    },
  });

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Message" icon={Icon.Message} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Client" text={`${recipientName} • ${phone}`} />
      <Form.TextArea {...itemProps.message} title="Message" />
    </Form>
  );
}

type ScoutPrepParentOption = {
  id: 'parent1' | 'parent2';
  name: string;
};

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
  const { handleSubmit, itemProps } = useForm<ReminderRecipientFormValues & { remindAt?: Date }>({
    initialValues: {
      recipientId: defaultRecipientId || options[0]?.id,
      remindAt: buildDefaultReminderDate(),
    },
    onSubmit,
  });

  return (
    <Form
      navigationTitle={navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={actionTitle} icon={Icon.Bell} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown {...itemProps.recipientId} title="Contact">
        {options.map((option) => (
          <Form.Dropdown.Item
            key={option.id}
            value={option.id}
            title={`${option.label}: ${option.name}`}
          />
        ))}
      </Form.Dropdown>
      <Form.DatePicker
        {...itemProps.remindAt}
        title={mode === 'call' ? 'Call Time' : 'Text Time'}
        type={Form.DatePicker.Type.DateTime}
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

function VoicemailFollowUpRecipientForm({
  task,
  context,
  crmStage,
  currentTask,
}: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  crmStage?: string | null;
  currentTask?: string | null;
}) {
  const { push } = useNavigation();
  const recipients = getVoicemailFollowUpRecipients(context);
  const defaultVariant = resolveVoicemailFollowUpVariant({
    crmStage,
    currentTask: currentTask || task.title || null,
  });

  function resolveLifecycleFollowUpTask(
    variant: VoicemailFollowUpVariant,
  ): ScoutAthleteTask | null {
    if (variant === 'no_show') {
      return null;
    }

    const expectedTaskTitle =
      variant === 'call_attempt_1'
        ? 'Call Attempt 1'
        : variant === 'call_attempt_2'
          ? 'Call Attempt 2'
          : 'Call Attempt 3';
    const directTaskTitle = stripMoveThisTaskPrefix(task.title) || '';
    const directTaskId = String(task.task_id || '').trim();

    if (directTaskId && isVoicemailLifecycleTaskMatch(task, variant)) {
      return {
        task_id: directTaskId,
        title: directTaskTitle || expectedTaskTitle,
        assigned_owner: task.assigned_owner || null,
        description: task.description || directTaskTitle,
      };
    }

    const exactTitleMatch = findNewestIncompleteTaskByTitle(context.tasks, expectedTaskTitle);
    if (exactTitleMatch) {
      return exactTitleMatch;
    }

    return (
      getIncompleteAthleteTasks(context.tasks).find((candidate) =>
        isVoicemailLifecycleTaskMatch(candidate, variant),
      ) || null
    );
  }

  async function openMessagesForRecipient(
    recipient?: (typeof recipients)[number],
    variant?: VoicemailFollowUpVariant,
  ) {
    if (!recipient || !recipient.phones.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No message contact',
        message: 'No Messages-safe number yet.',
      });
      return;
    }

    const body = buildVoicemailFollowUpBody(
      context,
      recipient.id,
      variant,
      crmStage,
      currentTask || task.title || null,
    );

    logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'start', {
      contactId: context.task.contact_id,
      recipientId: recipient.id,
      recipientName: recipient.name,
      recipientCount: recipient.phones.length,
      variant: variant || defaultVariant,
    });

    try {
      if (recipient.phones.length === 1 && recipient.id !== 'groupAll') {
        const selectedVariant = variant || defaultVariant;
        push(
          <SingleRecipientMessageForm
            title={`Send Message • ${recipient.name}`}
            recipientName={recipient.name}
            phone={recipient.phones[0]}
            initialMessage={body}
            onMessageSentLabel={selectedVariant.replace(/_/g, ' ')}
            onMessageSent={
              selectedVariant !== 'no_show'
                ? async () => {
                    const followUpTask = resolveLifecycleFollowUpTask(selectedVariant);
                    const athleteId = String(
                      task.contact_id || context.task.contact_id || '',
                    ).trim();
                    const athleteMainId = String(
                      context.resolved.athlete_main_id || task.athlete_main_id || '',
                    ).trim();

                    if (!followUpTask?.task_id || !athleteId || !athleteMainId) {
                      throw new Error('Missing voicemail follow-up identifiers');
                    }

                    await recordVoicemailFollowUpMessageSent({
                      athleteId,
                      athleteMainId,
                      taskId: followUpTask.task_id,
                      variant: selectedVariant,
                      taskTitle: stripMoveThisTaskPrefix(followUpTask.title) || undefined,
                      description: followUpTask.description || undefined,
                    });
                  }
                : undefined
            }
          />,
        );
        logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'success', {
          contactId: context.task.contact_id,
          recipientId: recipient.id,
          recipientName: recipient.name,
          recipientCount: recipient.phones.length,
          mode: 'raycast-ui',
          variant: variant || defaultVariant,
        });
        return;
      }

      const mode = await openMessagesDraftForRecipients(recipient.phones, body);
      logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'success', {
        contactId: context.task.contact_id,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientCount: recipient.phones.length,
        mode,
        variant: variant || defaultVariant,
      });
      await popToRoot({ clearSearchBar: true });
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
          variant: variant || defaultVariant,
        },
      );
      await showToast({
        style: Toast.Style.Success,
        title: 'Messages opened',
        message: 'Copied to clipboard.',
      });
      await popToRoot({ clearSearchBar: true });
    }
  }

  async function handleSubmit(values: VoicemailFollowUpFormValues) {
    const recipient =
      recipients.find((candidate) => candidate.id === values.recipientId) || recipients[0];
    await openMessagesForRecipient(recipient, values.variant || defaultVariant);
  }

  return (
    <VoicemailFollowUpMessageForm
      navigationTitle={`Voicemail Follow-Up • ${task.athlete_name}`}
      recipients={recipients}
      defaultRecipientId={recipients[0]?.id}
      defaultVariant={defaultVariant}
      onSubmit={async (values) =>
        handleSubmit({
          recipientId: values.recipientId,
          variant: values.variant,
        })
      }
    />
  );
}

type ViewMode = 'tasks' | 'recent' | 'prospect';

type RecentProfileRow = {
  profile: ScoutRecentProfile;
  task: ScoutPortalTask;
  status: ScoutRecentProfileCheckStatus;
  followUpTask?: ScoutAthleteTask | null;
  error?: string | null;
};

function buildScoutPrepTaskFromProspect(result: ProspectResult): ScoutPortalTask | null {
  const athleteId = String(result.athlete_id || '').trim();
  const athleteMainId = String(result.athlete_main_id || '').trim();
  if (!athleteId || !athleteMainId) {
    return null;
  }

  return {
    contact_id: athleteId,
    athlete_id: athleteId,
    athlete_main_id: athleteMainId,
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

function buildDefaultConfirmationDate(
  dueDate?: string | null,
  dueTime?: string | null,
): Date | undefined {
  const rawDate = String(dueDate || '').trim();
  const dateMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!dateMatch) return undefined;

  const rawTime = String(dueTime || '').trim();
  const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  const month = Number.parseInt(dateMatch[1], 10) - 1;
  const day = Number.parseInt(dateMatch[2], 10);
  const year = Number.parseInt(dateMatch[3], 10);
  const hour = timeMatch ? Number.parseInt(timeMatch[1], 10) : 0;
  const minute = timeMatch ? Number.parseInt(timeMatch[2], 10) : 0;
  const date = new Date(year, month, day, hour, minute);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function RescheduleConfirmationCallForm({
  task,
  confirmationTask,
}: {
  task: ScoutPortalTask;
  confirmationTask: ScoutAthleteTask;
}) {
  const [popupData, setPopupData] = useState<Record<string, string> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const popup = await fetchScoutTaskPopup(confirmationTask.task_id);
        if (!active) return;
        setPopupData(popup.form_data || {});
      } catch (error) {
        if (!active) return;
        await showToast({
          style: Toast.Style.Failure,
          title: 'Confirmation load failed',
          message: error instanceof Error ? error.message : String(error),
        });
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
  }, [confirmationTask.task_id]);

  async function handleSubmit(values: { dueDate?: Date; taskTitle?: string }) {
    if (isSaving) return;

    const athleteMainId = String(task.athlete_main_id || '').trim();
    const contactTask = String(task.contact_id || '').trim();
    if (!athleteMainId || !contactTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing task IDs',
      });
      return;
    }

    setIsSaving(true);
    const toast = await showLoadingToast('Saving confirm', 'Task + lifecycle');
    try {
      const nextTaskTitle =
        String(values.taskTitle || '').trim() || stripMoveThisTaskPrefix(popupData?.tasktitle);
      const nextDueDate = values.dueDate
        ? formatDateForLegacyInput(values.dueDate)
        : popupData?.duedate;
      const nextDueTime = values.dueDate
        ? formatTimeForLegacyInput(values.dueDate)
        : String(popupData?.duetime || '').trim();

      await updateScoutPrepTask({
        taskId: confirmationTask.task_id,
        contactTask,
        athleteMainId,
        taskTitle: nextTaskTitle,
        description: popupData?.taskdescription || confirmationTask.description || '',
        dueDate: nextDueDate,
        dueTime: nextDueTime,
      });

      let syncError: string | null = null;
      try {
        const liveContext = await loadScoutPrepContext(task);
        const athleteId = String(task.contact_id || '').trim();
        const athleteName = liveContext.contactInfo.studentAthlete.name || task.athlete_name;
        const currentTask = nextTaskTitle || 'Confirmation Call';
        const prepared = await prepareConfirmationFollowUp({
          athleteId,
          athleteMainId,
          athleteName,
          sport: liveContext.resolved.sport || null,
          gradYear: task.grad_year || null,
          state: liveContext.resolved.state || null,
          dueDate: nextDueDate,
          dueTime: nextDueTime,
          headScoutName: liveContext.resolved.head_scout || null,
          greetingOverride: buildTimeOfDayGreeting(liveContext),
          fallbackText: popupData?.taskdescription || confirmationTask.description || '',
        });
        await recordRescheduledBestEffort({
          athleteId,
          athleteMainId,
          athleteName,
          taskId: confirmationTask.task_id,
          currentTask,
          prepared,
        });
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }

      toast.style = syncError ? Toast.Style.Failure : Toast.Style.Success;
      toast.title = syncError ? 'Confirm saved, sync failed' : 'Confirmation saved';
      toast.message = syncError || '';
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Confirmation save failed';
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      navigationTitle={`Reschedule Confirmation Call • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSaving ? 'Saving…' : 'Save Confirmation Call'}
            onSubmit={(values) =>
              void handleSubmit(values as { dueDate?: Date; taskTitle?: string })
            }
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="taskTitle"
        title="Task Title"
        defaultValue={stripMoveThisTaskPrefix(popupData?.tasktitle) || 'Confirmation Call'}
      />
      <Form.DatePicker
        id="dueDate"
        title="Task Due Date"
        defaultValue={buildDefaultConfirmationDate(popupData?.duedate, popupData?.duetime)}
      />
    </Form>
  );
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

function UpdateAthleteTaskForm({
  task,
  selectedTask,
  athleteMainId,
  contactTask,
  onUpdated,
}: {
  task: ScoutPortalTask;
  selectedTask: ScoutAthleteTask;
  athleteMainId: string;
  contactTask: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const { pop } = useNavigation();
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const currentTaskTitle = getTaskDisplayTitle(selectedTask);

  async function handleUpdate(values: { dueDate?: Date }) {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateScoutPrepTask({
        taskId: selectedTask.task_id,
        contactTask,
        athleteMainId,
        taskTitle: currentTaskTitle,
        description: selectedTask.description || currentTaskTitle,
        dueDate: values.dueDate ? formatDateForLegacyInput(values.dueDate) : null,
        dueTime: values.dueDate ? formatTimeForLegacyInput(values.dueDate) : null,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Task saved',
        message: currentTaskTitle,
      });
      await onUpdated?.();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Task save failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCompleteTask() {
    if (isCompleting) return;
    setIsCompleting(true);
    try {
      await completeScoutPrepTaskAfterVoicemail({
        athleteId: contactTask,
        athleteMainId,
        contactTask,
        taskTitle: currentTaskTitle,
        assignedOwner: selectedTask.assigned_owner,
        description: selectedTask.description || currentTaskTitle,
        taskId: selectedTask.task_id,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Completed',
        message: currentTaskTitle,
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Complete failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCompleting(false);
    }
  }

  async function handleSetScheduledFollowUp(values: { dueDate?: Date }) {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateScoutPrepTask({
        taskId: selectedTask.task_id,
        contactTask,
        athleteMainId,
        taskTitle: 'SCHEDULED FOLLOW-UP',
        description: selectedTask.description || currentTaskTitle,
        dueDate: values.dueDate ? formatDateForLegacyInput(values.dueDate) : null,
        dueTime: values.dueDate ? formatTimeForLegacyInput(values.dueDate) : null,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Task saved',
        message: 'SCHEDULED FOLLOW-UP',
      });
      await onUpdated?.();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Title save failed',
        message: error instanceof Error ? error.message : String(error),
      });
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
            onSubmit={(values) => void handleUpdate(values as { dueDate?: Date })}
          />
          <Action.SubmitForm
            title={isSaving ? 'Saving…' : 'Set SCHEDULED FOLLOW-UP'}
            icon={Icon.Pencil}
            onSubmit={(values) => void handleSetScheduledFollowUp(values as { dueDate?: Date })}
          />
          <Action
            title={isCompleting ? 'Completing…' : 'Complete Task'}
            icon={Icon.CheckCircle}
            onAction={() => void handleCompleteTask()}
          />
        </ActionPanel>
      }
    >
      <Form.DatePicker
        id="dueDate"
        title="Task Due Date"
        defaultValue={buildDefaultTaskDate(selectedTask.due_date)}
      />
    </Form>
  );
}

function UpdateAthleteTaskPicker({
  task,
  initialContext = null,
}: {
  task: ScoutPortalTask;
  initialContext?: ScoutPrepContext | null;
}) {
  const { push } = useNavigation();
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

  const incompleteTasks = context ? getIncompleteAthleteTasks(context.tasks) : [];

  async function handleOpenTaskUpdate(selectedTask: ScoutAthleteTask) {
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
        onUpdated={async () => {
          const loadedContext = await loadScoutPrepContext(task);
          setContext(loadedContext);
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
    try {
      await completeScoutPrepTaskAfterVoicemail({
        athleteId: contactTask,
        athleteMainId,
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

      await showToast({
        style: Toast.Style.Success,
        title: 'Completed',
        message: getTaskDisplayTitle(selectedTask),
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Complete failed',
        message: error instanceof Error ? error.message : String(error),
      });
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
              icon={Icon.CheckCircle}
              title={getTaskDisplayTitle(candidate)}
              subtitle={candidate.assigned_owner || 'No owner'}
              accessories={[
                ...(candidate.due_date ? [{ text: candidate.due_date }] : []),
                { text: `#${candidate.task_id}` },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title={completingTaskId === candidate.task_id ? 'Completing…' : 'Complete Task'}
                    icon={Icon.CheckCircle}
                    onAction={() => void handleCompleteTaskFromList(candidate)}
                  />
                  <Action
                    title="Update Task"
                    icon={Icon.Pencil}
                    onAction={() => void handleOpenTaskUpdate(candidate)}
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
          icon={Icon.CheckCircle}
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

function PostCallUpdateForm({ task }: { task: ScoutPortalTask }) {
  const [stageOptions, setStageOptions] = useState<SalesStageOption[]>([]);
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [meetingTemplate, setMeetingTemplate] = useState<MeetingSetTemplateResponse | null>(null);
  const [selectedMeetingFor, setSelectedMeetingFor] = useState<string>(
    HEAD_SCOUT_ORDER[0]?.meeting_for || '',
  );
  const [openMeetingSlots, setOpenMeetingSlots] = useState<OpenMeetingSlot[]>([]);
  const [selectedOpenMeetingId, setSelectedOpenMeetingId] = useState<string>('');
  const [isLoadingStages, setIsLoadingStages] = useState(true);
  const [isLoadingMeetingTemplate, setIsLoadingMeetingTemplate] = useState(false);
  const [isLoadingOpenMeetings, setIsLoadingOpenMeetings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoadingStages(true);
      try {
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-options', 'start', {
          athleteId: task.contact_id,
          athleteName: task.athlete_name,
        });
        const options = await fetchCuratedSalesStageOptions(String(task.contact_id));
        if (!active) {
          return;
        }
        setStageOptions(options);
        setSelectedStage(
          options.find((option) => option.selected)?.value || options[0]?.value || '',
        );
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-options', 'success', {
          athleteId: task.contact_id,
          count: options.length,
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
  }, [task]);

  const selectedStageLabel =
    stageOptions.find((option) => option.value === selectedStage)?.label || selectedStage;

  useEffect(() => {
    let active = true;
    if (selectedStageLabel !== MEETING_SET_LABEL) {
      setMeetingTemplate(null);
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
        });
        const [template, context] = await Promise.all([
          fetchMeetingSetTemplate(task),
          loadScoutPrepContext(task),
        ]);
        if (!active) {
          return;
        }
        setMeetingTemplate(
          buildMeetingTemplateDefaults(
            {
              ...template,
              details_template: template.details_template || buildFallbackMeetingDetails(),
            },
            context,
          ),
        );
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-meeting-template', 'success', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          timezoneCount: template.recruit_timezone_options.length,
          hasPrimaryPhone: Boolean(selectScoutPrepContactNumbers(context).primaryNumber),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!active) {
          return;
        }
        try {
          const context = await loadScoutPrepContext(task);
          if (!active) {
            return;
          }
          const fallbackTemplate = buildFallbackMeetingTemplate();
          fallbackTemplate.meeting_name = `${task.athlete_name} ${task.grad_year || ''}`.trim();
          setMeetingTemplate(buildMeetingTemplateDefaults(fallbackTemplate, context));
        } catch {
          if (!active) {
            return;
          }
          const fallbackTemplate = buildFallbackMeetingTemplate();
          fallbackTemplate.meeting_name = `${task.athlete_name} ${task.grad_year || ''}`.trim();
          setMeetingTemplate(fallbackTemplate);
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
  }, [selectedStage, selectedStageLabel, task]);

  const meetingTemplateKey = `${selectedStage}-${meetingTemplate?.meeting_name || 'meeting'}`;
  const meetingDetailsKey = `${meetingTemplateKey}-${meetingTemplate?.details_template || ''}`;
  const openMeetingsKey = `${selectedStage}-${selectedMeetingFor}-${selectedOpenMeetingId || 'open'}`;
  const canRenderStageFields =
    !isLoadingStages && stageOptions.length > 0 && Boolean(selectedStage);

  useEffect(() => {
    let active = true;
    if (selectedStageLabel !== MEETING_SET_LABEL || !selectedMeetingFor) {
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
        setSelectedOpenMeetingId(response.slots[0]?.open_event_id || '');
      } catch (error) {
        if (!active) {
          return;
        }
        setOpenMeetingSlots([]);
        setSelectedOpenMeetingId('');
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
  }, [selectedMeetingFor, selectedStageLabel]);

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
    const toast = await showLoadingToast('Saving stage', 'Web + Supabase');
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

      let meetingSetResult: MeetingSetSubmitResponse | null = null;
      let meetingSetAssignedTo: string | null = null;
      let meetingSetOpenEventId: string | null = null;
      let meetingSetName: string | null = null;
      let meetingSetTimezone: string | null = null;
      let meetingSetStartTime: string | null = null;
      let meetingSetAssignedOwner: string | null = null;
      if (stageLabel === MEETING_SET_LABEL) {
        const assignedTo = String(values.meetingFor || values.legacyAssignedTo || '').trim();
        const openEventId = String(values.openMeetingId || '').trim();
        const meetingLength = String(values.legacyMeetingLength || '01:00').trim() || '01:00';
        const meetingName = String(values.meetingName || '').trim();
        const meetingTimezone = String(values.recruitTimeZone || '').trim();
        const taskDescription = String(values.meetingDetails || '').trim();
        const selectedOpenMeeting =
          openMeetingSlots.find((slot) => slot.open_event_id === openEventId) || null;
        const startTime = selectedOpenMeeting?.start_time || '';
        const startsAt = buildMeetingSetStartsAt(selectedOpenMeeting);

        if (!meetingName || !meetingTimezone || !taskDescription) {
          throw new Error('Meeting Set requires meeting name, timezone, and details');
        }
        if (!assignedTo || !openEventId || !startTime) {
          throw new Error('Meeting Set requires scout and open meeting selection');
        }

        meetingSetResult = await submitMeetingSet({
          athlete_id: athleteId,
          athlete_main_id: athleteMainId,
          meeting_name: meetingName,
          meeting_timezone: meetingTimezone,
          assigned_to: assignedTo,
          open_event_id: openEventId,
          task_description: taskDescription,
          start_time: startTime,
          meeting_length: meetingLength,
        });
        meetingSetAssignedTo = assignedTo;
        meetingSetOpenEventId = openEventId;
        meetingSetName = meetingName;
        meetingSetTimezone = meetingTimezone;
        meetingSetStartTime = startsAt || startTime;
        meetingSetAssignedOwner = selectedOpenMeeting?.assigned_owner || null;
      }

      const salesStageResult = await updateSalesStage({
        athleteMainId,
        athleteId,
        stage: stageLabel,
      });

      const syncContext = context || (await loadScoutPrepContext(task));
      if (stageLabel === MEETING_SET_LABEL && meetingSetResult) {
        const selectedScout =
          HEAD_SCOUT_ORDER.find((scout) => scout.meeting_for === meetingSetResult.assigned_to) ||
          null;
        const currentTask =
          stripMoveThisTaskPrefix(
            meetingSetResult.created_task?.title || salesStageResult.created_task?.title || '',
          ) || 'Confirmation Call';
        await recordMeetingSet({
          athleteId,
          athleteMainId,
          athleteName: syncContext.contactInfo.studentAthlete.name || task.athlete_name,
          crmStage: stageLabel,
          taskStatus: currentTask,
          headScout:
            String(syncContext.resolved.head_scout || '').trim() ||
            meetingSetAssignedOwner ||
            selectedScout?.scout_name ||
            null,
          currentTaskId:
            String(
              meetingSetResult.created_task?.task_id ||
                salesStageResult.created_task?.task_id ||
                '',
            ).trim() || null,
          currentTaskTitle: currentTask,
          appointmentId: meetingSetResult.open_event_id || meetingSetOpenEventId,
          sourceEventId: meetingSetResult.open_event_id || meetingSetOpenEventId,
          startsAt: meetingSetStartTime,
          meetingTimezone: meetingSetTimezone,
          legacyAssignedTo: meetingSetResult.assigned_to || meetingSetAssignedTo,
          meetingName: meetingSetResult.meeting_name || meetingSetName,
          taskDueDate:
            String(
              meetingSetResult.created_task?.due_date ||
                salesStageResult.created_task?.due_date ||
                '',
            ).trim() || null,
        });
      }

      let taskCompletionMessage: string | null = null;
      if (shouldAutoCompletePostCallTask(stageLabel, task)) {
        const result = await completeScoutPrepTaskAfterVoicemail({
          athleteId,
          athleteMainId,
          contactTask: task.contact_id,
          taskId: task.task_id,
          taskTitle: task.title,
          assignedOwner: task.assigned_owner,
          description: task.description,
        });
        taskCompletionMessage = formatTaskIdLabel(result.task_id) || 'Task done';
      }

      toast.style = Toast.Style.Success;
      toast.title = taskCompletionMessage
        ? 'Stage saved + done'
        : stageLabel === MEETING_SET_LABEL
          ? 'Meeting Set saved'
          : 'Stage saved';
      toast.message =
        taskCompletionMessage ||
        (stageLabel === MEETING_SET_LABEL
          ? meetingSetResult?.email_sent
            ? 'Email sent'
            : 'Meeting Set saved'
          : stageLabel);

      await popToRoot({ clearSearchBar: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.style = Toast.Style.Failure;
      toast.title = 'Stage save failed';
      toast.message = message;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isLoadingStages}
      navigationTitle={`Post-Call Update • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSaving ? 'Saving Sales Stage…' : 'Save Sales Stage'}
            onSubmit={(values) => void handleSubmit(values as Record<string, string | undefined>)}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Saves the official sales stage through the captured legacy endpoint." />
      {canRenderStageFields ? (
        <Form.Dropdown
          id="officialStage"
          title="Official Sales Stage"
          defaultValue={selectedStage}
          onChange={setSelectedStage}
        >
          {stageOptions.map((option) => (
            <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
          ))}
        </Form.Dropdown>
      ) : null}

      {selectedStageLabel === MEETING_SET_LABEL ? (
        <>
          {isLoadingMeetingTemplate ? (
            <Form.Description text="Loading Meeting Set template…" />
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
                defaultValue={HEAD_SCOUT_ORDER[0]?.meeting_for}
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
                key={openMeetingsKey}
                id="openMeetingId"
                title="Open Meeting"
                defaultValue={selectedOpenMeetingId}
                onChange={setSelectedOpenMeetingId}
              >
                {openMeetingSlots.map((slot) => (
                  <Form.Dropdown.Item
                    key={slot.open_event_id}
                    value={slot.open_event_id}
                    title={`${slot.date_time_label} • ${slot.assigned_owner}`}
                  />
                ))}
              </Form.Dropdown>
              {isLoadingOpenMeetings ? <Form.Description text="Loading open meetings…" /> : null}
              {!isLoadingOpenMeetings && !openMeetingSlots.length ? (
                <Form.Description text="No open meetings found for selected scout." />
              ) : null}
              <Form.TextField
                id="legacyMeetingLength"
                title="Meeting Length"
                defaultValue="01:00"
              />
            </>
          )}
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
  const [context, setContext] = useState<Awaited<ReturnType<typeof loadScoutPrepContext>> | null>(
    null,
  );

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
      const loadedContext = await loadScoutPrepContext(task);
      setContext(loadedContext);
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
        await popToRoot({ clearSearchBar: true });
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

  async function handleVoicemailFollowUp() {
    const activeContext =
      context ||
      (await ensureContext('Voicemail', task.athlete_name, 'Failed to load contact data'));
    if (!activeContext) {
      return;
    }

    const toast = await showLoadingToast('Voicemail', 'Loading stage');
    const recipients = getVoicemailFollowUpRecipients(activeContext);
    if (!recipients.length) {
      toast.style = Toast.Style.Failure;
      toast.title = 'No usable number';
      toast.message = 'No Messages-safe number.';
      return;
    }

    try {
      const crmStage = await getSelectedCrmStageLabel(task.contact_id);
      toast.hide();
      let shouldReturnToRootList = false;
      push(
        <VoicemailFollowUpRecipientForm
          task={task}
          context={activeContext}
          crmStage={crmStage}
          currentTask={task.title || null}
        />,
        () => {
          if (!shouldReturnToRootList) {
            return;
          }
          shouldReturnToRootList = false;
          pop();
          onReturnToRootList?.();
        },
      );
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Stage load failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
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

  async function resolveConfirmationTask(): Promise<ScoutAthleteTask | null> {
    const activeContext =
      context || (await ensureContext('Loading task', task.athlete_name, 'Missing task context'));
    if (!activeContext) {
      return null;
    }

    return findNewestIncompleteConfirmationTask(activeContext.tasks);
  }

  async function handleRescheduleConfirmationTask() {
    const confirmationTask = await resolveConfirmationTask();
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation task',
      });
      return;
    }

    push(<RescheduleConfirmationCallForm task={task} confirmationTask={confirmationTask} />);
  }

  async function handleTextMeetingReminder() {
    const activeContext =
      context || (await ensureContext('Meeting reminder', task.athlete_name, 'Missing ID'));
    if (!activeContext) {
      return;
    }

    const reminderRecipient = getMeetingReminderRecipient(activeContext);
    if (!reminderRecipient?.phones.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No usable number',
        message: 'No parent or fallback number.',
      });
      return;
    }

    const confirmationTask = findNewestIncompleteConfirmationTask(activeContext.tasks);
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation task',
      });
      return;
    }

    const athleteMainId = String(
      activeContext.resolved.athlete_main_id || activeContext.task.athlete_main_id || '',
    ).trim();
    const crmStage = await getSelectedCrmStageLabel(task.contact_id);
    const defaultVariant = resolveConfirmationFollowUpVariant({
      crmStage,
      currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
    });

    push(
      <ConfirmationReminderMessageForm
        navigationTitle={`Meeting Reminder • ${task.athlete_name}`}
        defaultVariant={defaultVariant}
        onSubmit={async (values) => {
          const toast = await showLoadingToast('Reminder', 'Loading meeting');
          const prepared = await prepareConfirmationFollowUp({
            athleteId: String(task.contact_id || '').trim(),
            athleteMainId,
            athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
            sport: activeContext.resolved.sport || null,
            gradYear: task.grad_year || null,
            state: activeContext.resolved.state || null,
            dueDate: confirmationTask.due_date || task.due_date || null,
            dueTime: null,
            headScoutName: activeContext.resolved.head_scout || null,
            greetingOverride: buildTimeOfDayGreeting(activeContext),
            recipientNames: reminderRecipient.recipientNames,
            fallbackText: confirmationTask.description || '',
            reminderVariant: values.variant,
          });
          if (!prepared.canDraft) {
            toast.hide();
            throw new Error(prepared.resolvedAppointment.reason);
          }

          try {
            await openMessagesDraftForRecipients(reminderRecipient.phones, prepared.message);
            await recordConfirmationSentBestEffort({
              athleteId: String(task.contact_id || '').trim(),
              athleteMainId,
              athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
              taskId: confirmationTask.task_id,
              currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
              prepared,
              reminderVariant: values.variant,
            });
            toast.style = Toast.Style.Success;
            toast.title = 'Messages opened';
            toast.message = 'Draft ready.';
          } catch (error) {
            await Clipboard.copy(prepared.message);
            await open(`sms:${reminderRecipient.phones[0]}`);
            await recordConfirmationSentBestEffort({
              athleteId: String(task.contact_id || '').trim(),
              athleteMainId,
              athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
              taskId: confirmationTask.task_id,
              currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
              prepared,
              reminderVariant: values.variant,
            });
            toast.style = Toast.Style.Success;
            toast.title = 'Messages opened';
            toast.message = 'Copied to clipboard.';
            logFailure(
              'SCOUT_PREP_MEETING_REMINDER',
              'open-compose',
              error instanceof Error ? error.message : String(error),
              {
                contactId: activeContext.task.contact_id,
                athleteMainId,
                recipientCount: reminderRecipient.phones.length,
                mode: 'clipboard-fallback',
                variant: values.variant,
              },
            );
          }
        }}
      />,
    );
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
      const voicemail = buildScoutPrepLeavingVoicemailBody({
        parentName,
        athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
        sport: activeContext.resolved.sport,
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
      ]);

      toast.style = Toast.Style.Success;
      toast.title = 'Notion synced';
      toast.message = `${scriptResult.toggleTitle} + ${voicemailResult.toggleTitle}`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Notion sync failed';
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

        const context = await loadScoutPrepContext(task);
        const values = buildScoutPrepValues({
          athleteName: context.contactInfo.studentAthlete.name || task.athlete_name,
          parent1Name: context.contactInfo.parent1?.name || undefined,
          parent2Name: context.contactInfo.parent2?.name || undefined,
          gradYear: task.grad_year,
          sport: context.resolved.sport || undefined,
        });

        if (!active) {
          return;
        }

        setContext(context);
        setMetadata(buildScoutPrepMetadata(values, context));
        setMarkdown(buildScoutPrepDetailMarkdown(values, context));
        setIsLoading(false);
        logInfo('SCOUT_PREP_DETAIL_LOAD', 'load-detail', 'success', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          athleteName: values.athleteName,
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
            icon={Icon.Pencil}
            onAction={() => {
              let shouldReturnToRootList = false;
              push(<PostCallUpdateForm task={task} />, () => {
                if (!shouldReturnToRootList) {
                  return;
                }
                shouldReturnToRootList = false;
                pop();
                onReturnToRootList?.();
              });
            }}
          />
          <Action
            title="Voicemail Follow-Up"
            icon={Icon.Message}
            onAction={() => void handleVoicemailFollowUp()}
          />
          <Action
            title="Text Meeting Reminder"
            icon={Icon.Message}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
            onAction={() => void handleTextMeetingReminder()}
          />
          <Action
            title="Create Call Reminder"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd'], key: '3' }}
            onAction={() => void handleCreateReminder('call')}
          />
          <Action
            title="Create Text Reminder"
            icon={Icon.Bell}
            shortcut={{ modifiers: ['cmd'], key: '4' }}
            onAction={() => void handleCreateReminder('text')}
          />
          <Action
            title="Sync Notion Call Prep"
            icon={Icon.Upload}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
            onAction={() => void handleSyncCallPrepToNotion()}
          />
          <Action.Push
            title="Contact Info"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
            target={<ScoutPrepContactDetail task={task} initialContext={context} />}
          />
          <Action.Push
            title="Head Scout Schedules"
            icon={Icon.Calendar}
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
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
            url={buildScoutPrepAdminUrl(
              task,
              context?.resolved.athlete_main_id || context?.task.athlete_main_id,
            )}
          />
          <Action.OpenInBrowser
            title="Open Athlete Task Tab"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
            url={buildScoutPrepTaskUrl(
              task,
              context?.resolved.athlete_main_id || context?.task.athlete_main_id,
            )}
          />
          <Action.OpenInBrowser
            title="Open Player ID"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
            url={buildScoutPrepPlayerIdUrl(task, context?.resolved.athlete_id)}
          />
          <Action
            title="Reschedule Confirmation Call"
            icon={Icon.Calendar}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
            onAction={() => void handleRescheduleConfirmationTask()}
          />
          <Action.Push
            title="Update Task"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
            target={<UpdateAthleteTaskPicker task={task} initialContext={context} />}
          />
          <ActionPanel.Section title="Athlete Note">
            <Action
              title="View Notes"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ['cmd'], key: 'n' }}
              onAction={() => void handleViewNotes()}
            />
            <Action
              title="Add Note"
              icon={Icon.Plus}
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
  visibleTasks,
  onToggleProspectSearchMode,
  onToggleRecentMode,
  onSelectTaskListFilter,
  onReturnToRootList,
}: {
  task: ScoutPortalTask;
  visibleTasks: ScoutPortalTask[];
  onToggleProspectSearchMode: () => void;
  onToggleRecentMode: () => void;
  onSelectTaskListFilter: (filter: TaskListFilter) => void;
  onReturnToRootList: () => void;
}) {
  const { push, pop } = useNavigation();

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

  async function handleVoicemailFollowUp() {
    const context = await ensureTaskContext('Voicemail', 'Contact load failed');
    if (!context) {
      return;
    }

    const toast = await showLoadingToast('Voicemail', 'Loading stage');
    const recipients = getVoicemailFollowUpRecipients(context);
    if (!recipients.length) {
      toast.style = Toast.Style.Failure;
      toast.title = 'No usable number';
      return;
    }

    try {
      const crmStage = await getSelectedCrmStageLabel(task.contact_id);
      toast.hide();
      let shouldResetRootList = false;
      push(
        <VoicemailFollowUpRecipientForm
          task={task}
          context={context}
          crmStage={crmStage}
          currentTask={task.title || null}
        />,
        () => {
          if (!shouldResetRootList) {
            return;
          }
          shouldResetRootList = false;
          onReturnToRootList();
        },
      );
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Stage load failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
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

  async function resolveConfirmationTask(): Promise<ScoutAthleteTask | null> {
    const context = await ensureTaskContext('Loading task', 'Missing ID');
    if (!context) {
      return null;
    }
    return findNewestIncompleteConfirmationTask(context.tasks);
  }

  async function handleRescheduleConfirmationTask() {
    const confirmationTask = await resolveConfirmationTask();
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation task',
      });
      return;
    }
    push(<RescheduleConfirmationCallForm task={task} confirmationTask={confirmationTask} />);
  }

  async function handleTextMeetingReminder() {
    const activeContext = await loadTaskNotesContext();
    if (!activeContext) {
      return;
    }

    const reminderRecipient = getMeetingReminderRecipient(activeContext);
    if (!reminderRecipient?.phones.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No usable number',
      });
      return;
    }

    const confirmationTask = findNewestIncompleteConfirmationTask(activeContext.tasks);
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation task',
      });
      return;
    }

    const athleteMainId = String(
      activeContext.resolved.athlete_main_id || activeContext.task.athlete_main_id || '',
    ).trim();
    const crmStage = await getSelectedCrmStageLabel(task.contact_id);
    const defaultVariant = resolveConfirmationFollowUpVariant({
      crmStage,
      currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
    });

    push(
      <ConfirmationReminderMessageForm
        navigationTitle={`Meeting Reminder • ${task.athlete_name}`}
        defaultVariant={defaultVariant}
        onSubmit={async (values) => {
          const toast = await showLoadingToast('Reminder', 'Loading meeting');
          const prepared = await prepareConfirmationFollowUp({
            athleteId: String(task.contact_id || '').trim(),
            athleteMainId,
            athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
            sport: activeContext.resolved.sport || null,
            gradYear: task.grad_year || null,
            state: activeContext.resolved.state || null,
            dueDate: confirmationTask.due_date || task.due_date || null,
            dueTime: null,
            headScoutName: activeContext.resolved.head_scout || null,
            greetingOverride: buildTimeOfDayGreeting(activeContext),
            recipientNames: reminderRecipient.recipientNames,
            fallbackText: confirmationTask.description || '',
            reminderVariant: values.variant,
          });
          if (!prepared.canDraft) {
            toast.hide();
            throw new Error(prepared.resolvedAppointment.reason);
          }

          try {
            await openMessagesDraftForRecipients(reminderRecipient.phones, prepared.message);
            await recordConfirmationSentBestEffort({
              athleteId: String(task.contact_id || '').trim(),
              athleteMainId,
              athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
              taskId: confirmationTask.task_id,
              currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
              prepared,
              reminderVariant: values.variant,
            });
            toast.style = Toast.Style.Success;
            toast.title = 'Messages opened';
            toast.message = 'Draft ready.';
          } catch (error) {
            await Clipboard.copy(prepared.message);
            await open(`sms:${reminderRecipient.phones[0]}`);
            await recordConfirmationSentBestEffort({
              athleteId: String(task.contact_id || '').trim(),
              athleteMainId,
              athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
              taskId: confirmationTask.task_id,
              currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
              prepared,
              reminderVariant: values.variant,
            });
            toast.style = Toast.Style.Success;
            toast.title = 'Messages opened';
            toast.message = 'Copied to clipboard.';
            logFailure(
              'SCOUT_PREP_MEETING_REMINDER',
              'open-compose',
              error instanceof Error ? error.message : String(error),
              {
                contactId: activeContext.task.contact_id,
                athleteMainId,
                recipientCount: reminderRecipient.phones.length,
                mode: 'clipboard-fallback',
                variant: values.variant,
              },
            );
          }
        }}
      />,
    );
  }

  const { shortDate, taskTitle, taskColor, gradYearColor } = getTaskAccessoryMetadata(task);

  return (
    <List.Item
      key={`${task.contact_id}-${task.title || 'task'}`}
      icon={Icon.List}
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
            icon={Icon.Wand}
            target={<ScoutPrepDetail task={task} onReturnToRootList={onReturnToRootList} />}
          />
          <Action
            title="Voicemail Follow-Up"
            icon={Icon.Message}
            onAction={() => void handleVoicemailFollowUp()}
          />
          <Action
            title="Text Meeting Reminder"
            icon={Icon.Message}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
            onAction={() => void handleTextMeetingReminder()}
          />
          <Action
            title="Post-Call Update"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd'], key: 'u' }}
            onAction={() => {
              let shouldResetRootList = false;
              push(<PostCallUpdateForm task={task} />, () => {
                if (!shouldResetRootList) {
                  return;
                }
                shouldResetRootList = false;
                onReturnToRootList();
              });
            }}
          />
          <Action
            title="Copy Athlete Name"
            shortcut={{ modifiers: ['cmd'], key: 'c' }}
            onAction={() => void copyToClipboardWithToast(task.athlete_name, 'Athlete Copied')}
          />
          <Action.Push
            title="Contact Info"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
            target={<ScoutPrepContactDetail task={task} />}
          />
          <Action
            title={`Batch Contact Create (${visibleTasks.length})`}
            icon={Icon.Person}
            onAction={() => void handleBatchCreateProspectContacts(visibleTasks)}
          />
          <Action.Push
            title="Head Scout Schedules"
            icon={Icon.Calendar}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
            target={<HeadScoutSchedulesRoot />}
          />
          <Action.OpenInBrowser
            title="Open Athlete Admin Page"
            shortcut={{ modifiers: ['cmd'], key: 'o' }}
            url={buildScoutPrepAdminUrl(task)}
          />
          <Action.OpenInBrowser
            title="Open Athlete Task Tab"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
            url={buildScoutPrepTaskUrl(task)}
          />
          <Action.OpenInBrowser
            title="Open Player ID"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'p' }}
            url={buildScoutPrepPlayerIdUrl(task)}
          />
          <Action
            title="Reschedule Confirmation Call"
            icon={Icon.Calendar}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
            onAction={() => void handleRescheduleConfirmationTask()}
          />
          <Action.Push
            title="Update Task"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
            target={<UpdateAthleteTaskPicker task={task} />}
          />
          <ActionPanel.Section title="Athlete Note">
            <Action
              title="View Notes"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ['cmd'], key: 'n' }}
              onAction={() => void handleViewNotes()}
            />
            <Action
              title="Add Note"
              icon={Icon.Plus}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
              onAction={() => void handleAddNote()}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Navigation">
            <Action
              title="Show All Items"
              shortcut={{ modifiers: ['cmd'], key: '1' }}
              onAction={() => onSelectTaskListFilter('all')}
            />
            <Action
              title="Show Today"
              shortcut={{ modifiers: ['cmd'], key: '2' }}
              onAction={() => onSelectTaskListFilter('today')}
            />
            <Action
              title="Show Tomorrow"
              shortcut={{ modifiers: ['cmd'], key: '3' }}
              onAction={() => onSelectTaskListFilter('tomorrow')}
            />
            <Action
              title="Show Future"
              shortcut={{ modifiers: ['cmd'], key: '4' }}
              onAction={() => onSelectTaskListFilter('future')}
            />
            <Action
              title="Show Recent Items"
              icon={Icon.Clock}
              shortcut={{ modifiers: ['cmd'], key: 'f' }}
              onAction={onToggleRecentMode}
            />
            <Action
              title="Prospect Search"
              icon={Icon.MagnifyingGlass}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
              onAction={onToggleProspectSearchMode}
            />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function ProspectSearchListItem({
  result,
  onToggleProspectSearchMode,
  onReturnToRootList,
}: {
  result: ProspectResult;
  onToggleProspectSearchMode: () => void;
  onReturnToRootList: () => void;
}) {
  const scoutPrepTask = buildScoutPrepTaskFromProspect(result);
  const location = [result.city, result.state].filter(Boolean).join(', ');
  const markdown = [
    `# ${result.name || `Athlete ${result.athlete_id}`}`,
    '',
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
      icon={Icon.MagnifyingGlass}
      title={result.name || `Athlete ${result.athlete_id}`}
      subtitle={
        [result.grad_year ? `Class ${result.grad_year}` : null, result.sport, result.high_school]
          .filter(Boolean)
          .join(' • ') || result.athlete_id
      }
      detail={<List.Item.Detail markdown={markdown} />}
      actions={
        <ActionPanel>
          {scoutPrepTask ? (
            <Action.Push
              title="Build Scout Prep"
              icon={Icon.Wand}
              target={
                <ScoutPrepDetail task={scoutPrepTask} onReturnToRootList={onReturnToRootList} />
              }
            />
          ) : null}
          <Action.OpenInBrowser
            title="Open Prospect Profile"
            icon={Icon.Globe}
            url={`https://dashboard.nationalpid.com/athlete/profile/${result.athlete_id}`}
          />
          <ActionPanel.Section title="Navigation">
            <Action
              title="Exit Prospect Search"
              icon={Icon.MagnifyingGlass}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
              onAction={onToggleProspectSearchMode}
            />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function RecentProfileListItem({
  item,
  onToggleRecentMode,
  onReturnToRootList,
}: {
  item: RecentProfileRow;
  onShowProspectSearch: () => void;
  onToggleProspectSearchMode: () => void;
  onToggleRecentMode: () => void;
  onReturnToRootList: () => void;
}) {
  const { task, followUpTask, profile, status, error } = item;
  const statusLabel =
    status === 'matched'
      ? followUpTask?.title || 'Follow-Up Found'
      : status === 'not_found'
        ? 'Confirmation Call'
        : status === 'error'
          ? 'Task Check Failed'
          : 'Checking Tasks';
  const markdown = [
    `# ${task.athlete_name}`,
    '',
    `- Status: ${statusLabel}`,
    `- Task: ${followUpTask?.title || (status === 'not_found' ? 'Confirmation Call' : 'N/A')}`,
    `- Due Date: ${followUpTask?.due_date || 'N/A'}`,
    `- Description: ${followUpTask?.description || 'N/A'}`,
    `- Sport: ${profile.sport || 'N/A'}`,
    `- State: ${profile.state || 'N/A'}`,
    `- Grad Year: ${profile.grad_year || 'N/A'}`,
    `- Parents: ${profile.parent_names?.join(', ') || 'N/A'}`,
    ...(error ? ['', `- Error: ${error}`] : []),
  ].join('\n');

  return (
    <List.Item
      key={`recent-follow-up:${task.contact_id}:${task.athlete_main_id || 'missing-main-id'}`}
      icon={Icon.Clock}
      title={task.athlete_name}
      subtitle={statusLabel}
      detail={<List.Item.Detail markdown={markdown} />}
      actions={
        <ActionPanel>
          <Action.Push
            title="Build Scout Prep"
            icon={Icon.Wand}
            target={<ScoutPrepDetail task={task} onReturnToRootList={onReturnToRootList} />}
          />
          {followUpTask ? (
            <Action.OpenInBrowser
              title="Open Athlete Task Tab"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
              url={buildScoutPrepTaskUrl(task)}
            />
          ) : null}
          <ActionPanel.Section title="Navigation">
            <Action
              title="Exit Recent Items"
              icon={Icon.Clock}
              shortcut={{ modifiers: ['cmd'], key: 'f' }}
              onAction={onToggleRecentMode}
            />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function ScoutPrepCommand() {
  const [taskBuckets, setTaskBuckets] = useState<
    Record<'todayPastDue' | 'today' | 'tomorrow' | 'future', ScoutPortalTask[]>
  >({
    todayPastDue: [],
    today: [],
    tomorrow: [],
    future: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [taskListFilter, setTaskListFilter] = useState<TaskListFilter>('all');
  const [prospectSearchText, setProspectSearchText] = useState('');
  const [prospectResults, setProspectResults] = useState<ProspectResult[]>([]);
  const [isProspectSearching, setIsProspectSearching] = useState(false);
  const [recentProfiles, setRecentProfiles] = useState<RecentProfileRow[]>([]);
  const [isRecentFollowUpsLoading, setIsRecentFollowUpsLoading] = useState(false);
  const loadTasksPromiseRef = useRef<Promise<void> | null>(null);
  const initialLoadStartedRef = useRef(false);
  const prospectSearchRequestIdRef = useRef(0);

  const hasProspectSearchText = prospectSearchText.trim().length > 0;
  const selectedTaskRows =
    viewMode === 'tasks'
      ? buildTaskBucketRows({
          filter: taskListFilter,
          taskBuckets,
        })
      : [];
  const hasTaskModeResults = selectedTaskRows.length > 0;
  const selectedRange = mapTaskListFilterToRange(taskListFilter);
  const selectedSectionTitle = getTaskSectionTitle(taskListFilter);

  const loadTasks = async () => {
    if (loadTasksPromiseRef.current) {
      logInfo('SCOUT_PREP_TASK_LIST', 'reuse-inflight-load', 'start');
      return loadTasksPromiseRef.current;
    }

    const pendingLoad = (async () => {
      setIsLoading(true);
      try {
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'start');
        const taskBuckets = await fetchScoutPortalTaskBuckets([
          'todayPastDue',
          'today',
          'tomorrow',
          'future',
        ] as const);
        const nextTaskBuckets = {
          todayPastDue: [...taskBuckets.todayPastDue].reverse(),
          today: [...taskBuckets.today].reverse(),
          tomorrow: [...taskBuckets.tomorrow].reverse(),
          future: [...taskBuckets.future].reverse(),
        };
        setTaskBuckets(nextTaskBuckets);
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'success', {
          selectedRange,
          todayPastDueCount: nextTaskBuckets.todayPastDue.length,
          todayCount: nextTaskBuckets.today.length,
          tomorrowCount: nextTaskBuckets.tomorrow.length,
          futureCount: nextTaskBuckets.future.length,
          firstAthlete: nextTaskBuckets[selectedRange][0]?.athlete_name || null,
          lastAthlete:
            nextTaskBuckets[selectedRange][nextTaskBuckets[selectedRange].length - 1]
              ?.athlete_name || null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logFailure('SCOUT_PREP_TASK_LIST', 'load-list', message);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Scout load failed',
          message,
        });
      } finally {
        setIsLoading(false);
      }
    })().finally(() => {
      loadTasksPromiseRef.current = null;
    });

    loadTasksPromiseRef.current = pendingLoad;
    return pendingLoad;
  };

  useEffect(() => {
    if (initialLoadStartedRef.current) {
      return;
    }
    initialLoadStartedRef.current = true;
    void loadTasks();
  }, []);

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
          const results = await runProspectRawSearch(term);
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
  }, [viewMode, prospectSearchText]);

  useEffect(() => {
    if (viewMode !== 'recent') {
      return;
    }

    let active = true;
    setIsRecentFollowUpsLoading(true);

    void (async () => {
      try {
        const profiles = await fetchScoutRecentProfiles();
        logInfo('SCOUT_PREP_RECENT_PROFILES_ENRICH', 'profiles-loaded', 'success', {
          rawRecentCount: profiles.length,
        });

        const rows = profiles.map((profile) => ({
          profile,
          task: {
            contact_id: profile.athlete_id,
            athlete_id: profile.athlete_id,
            athlete_main_id: profile.athlete_main_id,
            athlete_name: profile.athlete_name,
            grad_year: profile.grad_year || null,
            title: null,
            description: null,
          } satisfies ScoutPortalTask,
          status: 'loading' as ScoutRecentProfileCheckStatus,
          followUpTask: null,
          error: null,
        }));

        if (!active) return;
        setRecentProfiles(rows);
        setIsRecentFollowUpsLoading(false);

        let matched = 0;
        let notFound = 0;
        let failures = 0;

        await Promise.all(
          rows.map(async (row) => {
            try {
              const athleteTasks = await fetchAthleteTasks(
                row.profile.athlete_id,
                row.profile.athlete_main_id,
              );
              const followUpTask = findNewestIncompleteFollowUpTask(athleteTasks);
              if (!active) return;

              if (followUpTask) {
                matched += 1;
                setRecentProfiles((current) =>
                  current.map((item) =>
                    item.profile.athlete_id === row.profile.athlete_id &&
                    item.profile.athlete_main_id === row.profile.athlete_main_id
                      ? {
                          ...item,
                          status: 'matched',
                          followUpTask,
                          task: {
                            ...item.task,
                            task_id: followUpTask.task_id,
                            due_date: followUpTask.due_date || null,
                            completion_date: followUpTask.completion_date || null,
                            assigned_owner: followUpTask.assigned_owner || null,
                            title: followUpTask.title || null,
                            description: followUpTask.description || null,
                          },
                        }
                      : item,
                  ),
                );
              } else {
                notFound += 1;
                setRecentProfiles((current) =>
                  current.map((item) =>
                    item.profile.athlete_id === row.profile.athlete_id &&
                    item.profile.athlete_main_id === row.profile.athlete_main_id
                      ? { ...item, status: 'not_found', followUpTask: null, error: null }
                      : item,
                  ),
                );
              }
            } catch (error) {
              failures += 1;
              if (!active) return;
              setRecentProfiles((current) =>
                current.map((item) =>
                  item.profile.athlete_id === row.profile.athlete_id &&
                  item.profile.athlete_main_id === row.profile.athlete_main_id
                    ? {
                        ...item,
                        status: 'error',
                        followUpTask: null,
                        error: error instanceof Error ? error.message : String(error),
                      }
                    : item,
                ),
              );
            }
          }),
        );

        logInfo('SCOUT_PREP_RECENT_PROFILES_ENRICH', 'task-checks', 'success', {
          rawRecentCount: rows.length,
          taskChecksAttempted: rows.length,
          matchedCount: matched,
          notFoundCount: notFound,
          failedCount: failures,
        });
      } finally {
        if (active) setIsRecentFollowUpsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [viewMode]);

  function toggleRecentMode() {
    setViewMode((current) => {
      if (current === 'recent') {
        // Exit recent → back to tasks
        setRecentProfiles([]);
        setIsRecentFollowUpsLoading(false);
        return 'tasks';
      }
      // Enter recent from anywhere
      setProspectSearchText('');
      setProspectResults([]);
      setIsProspectSearching(false);
      return 'recent';
    });
  }

  function toggleProspectSearchMode() {
    setViewMode((current) => {
      if (current === 'prospect') {
        // Exit prospect → back to tasks
        setProspectSearchText('');
        setProspectResults([]);
        setIsProspectSearching(false);
        return 'tasks';
      }
      // Enter prospect from anywhere
      setRecentProfiles([]);
      setIsRecentFollowUpsLoading(false);
      return 'prospect';
    });
  }

  return (
    <List
      isLoading={isLoading || isProspectSearching || isRecentFollowUpsLoading}
      navigationTitle={
        viewMode === 'recent'
          ? 'Scout Prep — Recent Items'
          : viewMode === 'prospect'
            ? 'Scout Prep Search'
            : 'Scout Prep'
      }
      searchBarAccessory={
        viewMode === 'tasks' ? (
          <List.Dropdown
            tooltip="Task List Filter"
            value={taskListFilter}
            onChange={(newValue) => setTaskListFilter(newValue as TaskListFilter)}
          >
            <List.Dropdown.Item title="All Items" value="all" />
            <List.Dropdown.Item title="Today" value="today" />
            <List.Dropdown.Item title="Tomorrow" value="tomorrow" />
            <List.Dropdown.Item title="Future" value="future" />
          </List.Dropdown>
        ) : undefined
      }
      filtering={true}
      searchBarPlaceholder={
        viewMode === 'recent'
          ? 'Recent Profiles'
          : viewMode === 'prospect'
            ? 'Prospect Search — Enter athlete name or email'
            : 'Search Task List'
      }
      searchText={viewMode === 'prospect' ? prospectSearchText : undefined}
      onSearchTextChange={viewMode === 'prospect' ? setProspectSearchText : undefined}
    >
      {viewMode === 'recent' ? (
        <List.Section title="Recent Profiles" subtitle={String(recentProfiles.length)}>
          {recentProfiles.length > 0 ? (
            recentProfiles.map((item) => (
              <RecentProfileListItem
                key={`recent:${item.profile.athlete_id}:${item.profile.athlete_main_id}`}
                item={item}
                onShowProspectSearch={toggleProspectSearchMode}
                onToggleProspectSearchMode={toggleProspectSearchMode}
                onToggleRecentMode={toggleRecentMode}
                onReturnToRootList={() => undefined}
              />
            ))
          ) : (
            <List.Item
              icon={Icon.Clock}
              title={isRecentFollowUpsLoading ? 'Loading Recent Profiles' : 'No Recent Profiles'}
              subtitle={
                isRecentFollowUpsLoading
                  ? 'Checking recent profiles for follow-up tasks'
                  : 'No recent profiles found'
              }
              actions={
                <ActionPanel>
                  <Action
                    title="Exit Recent Items"
                    icon={Icon.Clock}
                    shortcut={{ modifiers: ['cmd'], key: 'f' }}
                    onAction={toggleRecentMode}
                  />
                  <SupabaseLifecycleStatusAction />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      ) : viewMode === 'prospect' ? (
        <List.Section title={`Prospect Search`} subtitle={String(prospectResults.length)}>
          {prospectResults.length > 0 ? (
            prospectResults.map((result) => (
              <ProspectSearchListItem
                key={`search:${result.athlete_id}:${result.athlete_main_id || result.name || 'result'}`}
                result={result}
                onToggleProspectSearchMode={toggleProspectSearchMode}
                onReturnToRootList={() => undefined}
              />
            ))
          ) : (
            <List.Item
              icon={Icon.MagnifyingGlass}
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
                    title="Exit Prospect Search"
                    icon={Icon.MagnifyingGlass}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
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
            taskListFilter === 'all'
              ? 'No items found'
              : `No ${selectedSectionTitle.toLowerCase()} items found`
          }
          description={
            taskListFilter === 'all'
              ? 'There are no active Scout Prep tasks in any bucket.'
              : `The ${selectedSectionTitle.toLowerCase()} task bucket is empty.`
          }
          actions={
            <ActionPanel>
              <Action title="Reload Scout Tasks" onAction={() => void loadTasks()} />
              <ActionPanel.Section title="Navigation">
                <Action
                  title="Show All Items"
                  shortcut={{ modifiers: ['cmd'], key: '1' }}
                  onAction={() => setTaskListFilter('all')}
                />
                <Action
                  title="Show Today"
                  shortcut={{ modifiers: ['cmd'], key: '2' }}
                  onAction={() => setTaskListFilter('today')}
                />
                <Action
                  title="Show Tomorrow"
                  shortcut={{ modifiers: ['cmd'], key: '3' }}
                  onAction={() => setTaskListFilter('tomorrow')}
                />
                <Action
                  title="Show Future"
                  shortcut={{ modifiers: ['cmd'], key: '4' }}
                  onAction={() => setTaskListFilter('future')}
                />
                <Action
                  title="Show Recent Items"
                  icon={Icon.Clock}
                  shortcut={{ modifiers: ['cmd'], key: 'f' }}
                  onAction={toggleRecentMode}
                />
                <Action
                  title="Prospect Search"
                  icon={Icon.MagnifyingGlass}
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
                  onAction={toggleProspectSearchMode}
                />
                <SupabaseLifecycleStatusAction />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title={selectedSectionTitle} subtitle={String(selectedTaskRows.length)}>
          {selectedTaskRows.map((row) => (
            <ScoutPrepTaskItem
              key={`${row.task.contact_id}-${row.task.title || 'task'}-${row.task.due_date || 'due'}`}
              task={row.task}
              visibleTasks={selectedTaskRows.map((item) => item.task)}
              onToggleProspectSearchMode={toggleProspectSearchMode}
              onToggleRecentMode={toggleRecentMode}
              onSelectTaskListFilter={setTaskListFilter}
              onReturnToRootList={() => undefined}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
