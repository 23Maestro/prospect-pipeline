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
  showToast,
  useNavigation,
} from '@raycast/api';
import { spawn } from 'child_process';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import BackSyncScoutFollowUpsCommand from './back-sync-scout-follow-ups';
import SupabaseLifecycleStatusCommand from './supabase-lifecycle-status';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import {
  ConfirmationReminderMessageForm,
  VoicemailFollowUpMessageForm,
} from './components/follow-up-message-forms';
import { HeadScoutSchedulesRoot } from './head-scout-schedules';
import { buildScoutPrepMarkdown } from './features/scout-prep/content';
import type {
  MeetingSetSubmitResponse,
  MeetingSetTemplateResponse,
  SalesStageOption,
  ScoutAthleteTask,
  ScoutRecentProfile,
  ScoutRecentProfileCheckStatus,
  ScoutPortalTask,
  ScoutPrepContext,
  ScoutPrepFormValues,
} from './features/scout-prep/types';
import {
  buildMeetingTemplateDefaults,
  buildMessagesComposeUrlForRecipients,
  buildTimeOfDayGreeting,
  buildProspectContactShortcutPayloadFromName,
  buildProspectContactShortcutUrl,
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
  fetchScoutRecentProfiles,
  fetchScoutTaskPopup,
  fetchScoutPortalTasks,
  findNewestIncompleteFollowUpTask,
  findNewestIncompleteConfirmationTask,
  loadScoutPrepContext,
  stripMoveThisTaskPrefix,
  updateScoutPrepTask,
} from './lib/scout-prep';
import {
  addScoutPrepFollowUpPointer,
  getCachedScoutPrepFollowUpTask,
  listScoutPrepFollowUpPointers,
  removeScoutPrepFollowUpPointer,
  setCachedScoutPrepFollowUpTask,
  type ScoutPrepFollowUpPointer,
} from './lib/scout-prep-follow-up-index';
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
import {
  cacheMeetingSetQueueContext,
  inferHeadScoutNameFromText,
  prepareConfirmationFollowUp,
  queueConfirmationFollowUp,
} from './lib/scout-follow-up-queue';
import {
  resolveConfirmationFollowUpVariant,
  resolveVoicemailFollowUpVariant,
  type ConfirmationFollowUpVariant,
  type VoicemailFollowUpVariant,
} from './lib/scout-follow-up-templates';
import { syncScoutOutcomeToNotion } from './lib/scout-outcome-sync';
import {
  recordConfirmationSent,
  recordMeetingSet,
  recordRescheduled,
} from './lib/supabase-lifecycle';

const FEATURE = 'scout-prep';
const MEETING_SET_LABEL = 'Meeting Set';
const LEFT_VOICE_MAIL_1_LABEL = 'Left Voice Mail 1';
const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';
const FOLLOW_UP_AUTO_REFRESH_LIMIT = 12;

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
  return showToast({
    style: Toast.Style.Animated,
    title,
    message,
  });
}

function buildAthleteAdminUrl(athleteId: string, athleteMainId?: string | null): string {
  const params = new URLSearchParams({ contactid: String(athleteId || '').trim() });
  const mainId = String(athleteMainId || '').trim();
  if (mainId) {
    params.set('athlete_main_id', mainId);
  }
  return `${DASHBOARD_BASE_URL}/admin/athletes?${params.toString()}`;
}

function getTaskDisplayTitle(task?: Partial<ScoutAthleteTask> | Partial<ScoutPortalTask> | null): string {
  return (
    stripMoveThisTaskPrefix(task?.title) ||
    String(task?.description || '').trim() ||
    'Untitled Task'
  );
}

function getIncompleteAthleteTasks(tasks: ScoutPrepContext['tasks']): ScoutAthleteTask[] {
  return tasks
    .filter((task) => !String(task.completion_date || '').trim() && String(task.task_id || '').trim())
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

function BackSyncFollowUpsAction() {
  return (
    <Action.Push
      title="Back Sync Follow-Ups"
      icon={Icon.Upload}
      shortcut={{ modifiers: ['cmd', 'opt'], key: 'b' }}
      target={<BackSyncScoutFollowUpsCommand />}
    />
  );
}

function SupabaseLifecycleStatusAction() {
  return (
    <Action.Push
      title="Supabase Lifecycle Status"
      icon={Icon.Database}
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

function ManualScoutPrepResult({ values }: { values: ScoutPrepFormValues }) {
  return (
    <Detail
      navigationTitle={`Scout Prep • ${values.athleteName}`}
      markdown={buildScoutPrepMarkdown(values)}
    />
  );
}

function ManualScoutPrepForm() {
  const { push } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: ScoutPrepFormValues) {
    if (isSubmitting) {
      return;
    }

    const athleteName = values.athleteName.trim();
    const parent1Name = values.parent1Name.trim();
    const parent2Name = (values.parent2Name || '').trim();
    const sport = values.sport.trim();

    if (!athleteName || !parent1Name || !values.gradYear || !sport) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Student athlete, parent 1, grad year, and sport are required',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      logInfo('SCOUT_PREP_MANUAL_BUILD', 'submit', 'start', {
        athleteNamePreview: athleteName.slice(0, 80),
        hasParent2: Boolean(parent2Name),
        gradYear: values.gradYear,
        sportPreview: sport.slice(0, 80),
      });
      push(
        <ManualScoutPrepResult
          values={{
            athleteName,
            parent1Name,
            parent2Name,
            gradYear: values.gradYear,
            sport,
          }}
        />,
      );
      logInfo('SCOUT_PREP_MANUAL_BUILD', 'submit', 'success', {
        athleteNamePreview: athleteName.slice(0, 80),
      });
    } catch (error) {
      logFailure(
        'SCOUT_PREP_MANUAL_BUILD',
        'submit',
        error instanceof Error ? error.message : String(error),
        {
          athleteNamePreview: athleteName.slice(0, 80),
        },
      );
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle="Manual Scout Prep"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSubmitting ? 'Building…' : 'Build Scout Prep'}
            onSubmit={(values) => void handleSubmit(values as ScoutPrepFormValues)}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="athleteName" title="Student Athlete" placeholder="Student Athlete" />
      <Form.TextField id="parent1Name" title="Parent 1" placeholder="Parent 1" />
      <Form.TextField id="parent2Name" title="Parent 2" placeholder="Parent 2" />
      <Form.Dropdown id="gradYear" title="Grad Year" defaultValue="Junior">
        <Form.Dropdown.Item value="Freshman" title="Freshman" />
        <Form.Dropdown.Item value="Sophomore" title="Sophomore" />
        <Form.Dropdown.Item value="Junior" title="Junior" />
        <Form.Dropdown.Item value="Senior" title="Senior" />
      </Form.Dropdown>
      <Form.TextField id="sport" title="Sport" placeholder="Sport" />
    </Form>
  );
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
  const params = new URLSearchParams({
    contactid: String(task.contact_id),
  });
  const resolvedAthleteMainId = String(athleteMainId || task.athlete_main_id || '').trim();
  if (resolvedAthleteMainId) {
    params.set('athlete_main_id', resolvedAthleteMainId);
  }
  return `${DASHBOARD_BASE_URL}/admin/athletes?${params.toString()}`;
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

async function launchProspectContactShortcut(candidate?: ProspectContactShortcutCandidate | null) {
  const activeCandidate = candidate || null;
  if (!activeCandidate) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'No eligible contact found',
    });
    return;
  }

  try {
    const payload = buildProspectContactShortcutPayloadFromName({
      fullName: activeCandidate.name,
      phone: activeCandidate.phone,
    });
    const shortcutUrl = buildProspectContactShortcutUrl(payload);
    await open(shortcutUrl);
    await showToast({
      style: Toast.Style.Success,
      title: 'Shortcut launched',
      message: `${activeCandidate.label}: ${activeCandidate.name}`,
    });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Failed to create prospect contact',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runOsaScript(lines: string[], args: string[] = []) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('osascript', [...lines.flatMap((line) => ['-e', line]), ...args], {
      shell: false,
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function openMessagesDraftForRecipients(
  phones: string[],
  body: string,
): Promise<'url' | 'applescript'> {
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

  if (uniquePhones.length === 1) {
    await open(buildMessagesComposeUrlForRecipients(uniquePhones, body));
    return 'url';
  }

  await Clipboard.copy(body);
  await runOsaScript(
    [
      'on run argv',
      'set recipientList to items 1 thru -2 of argv',
      'set bodyText to item -1 of argv',
      'tell application "Messages" to activate',
      'delay 0.4',
      'tell application "System Events"',
      'tell process "Messages"',
      'keystroke "n" using command down',
      'delay 0.6',
      'repeat with recipientValue in recipientList',
      'keystroke contents of recipientValue',
      'delay 0.2',
      'key code 36',
      'delay 0.2',
      'end repeat',
      'key code 48',
      'delay 0.2',
      'keystroke "v" using command down',
      'end tell',
      'end tell',
      'end run',
    ],
    [...uniquePhones, body],
  );
  return 'applescript';
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

  async function loadContactInfo() {
    setIsLoading(true);
    try {
      const loadedContext = await loadScoutPrepContext(task);
      setContext(loadedContext);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to Load Contact Info',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
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
        title: 'Contact info still loading',
      });
      return;
    }

    const candidates = getProspectContactShortcutCandidates(activeContext);
    const activeCandidate = candidate || candidates[0] || null;
    if (!activeCandidate) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No eligible contact found',
        message: 'A first name, last name, and phone number are required.',
      });
      return;
    }

    await launchProspectContactShortcut(activeCandidate);
  }

  const contactInfo = context?.contactInfo;
  const contactCandidates = context ? getProspectContactShortcutCandidates(context) : [];

  return (
    <Detail
      navigationTitle={`Contact Info • ${task.athlete_name}`}
      markdown={buildScoutPrepContactMarkdown(context)}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          {contactInfo?.parent1 ? (
            <ActionPanel.Section title={`Parent 1 (${contactInfo.parent1.relationship})`}>
              {contactInfo.parent1.phone ? (
                <Action.CopyToClipboard
                  title="Copy Parent 1 Phone"
                  content={contactInfo.parent1.phone}
                  icon="📲"
                />
              ) : null}
            </ActionPanel.Section>
          ) : null}
          <ActionPanel.Section title="Student Athlete">
            {contactInfo?.studentAthlete.phone ? (
              <Action.CopyToClipboard
                title="Copy Student Athlete Phone"
                content={contactInfo.studentAthlete.phone}
                icon="☎️"
              />
            ) : null}
          </ActionPanel.Section>
          {contactInfo?.parent2 ? (
            <ActionPanel.Section title={`Parent 2 (${contactInfo.parent2.relationship})`}>
              {contactInfo.parent2.phone ? (
                <Action.CopyToClipboard
                  title="Copy Parent 2 Phone"
                  content={contactInfo.parent2.phone}
                  icon="📳"
                />
              ) : null}
            </ActionPanel.Section>
          ) : null}
          <ActionPanel.Section>
            {contactCandidates[0] ? (
              <Action
                title={`Create ${contactCandidates[0].label} Contact`}
                icon={Icon.Person}
                shortcut={{ modifiers: [], key: 'return' }}
                onAction={() => void handleCreateProspectContact(contactCandidates[0])}
              />
            ) : null}
            {contactCandidates[1] ? (
              <Action
                title={`Create ${contactCandidates[1].label} Contact`}
                icon={Icon.Person}
                shortcut={{ modifiers: ['cmd'], key: 'return' }}
                onAction={() => void handleCreateProspectContact(contactCandidates[1])}
              />
            ) : null}
            {contactCandidates[2] ? (
              <Action
                title={`Create ${contactCandidates[2].label} Contact`}
                icon={Icon.Person}
                shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
                onAction={() => void handleCreateProspectContact(contactCandidates[2])}
              />
            ) : null}
            <Action
              title="Refresh Contact Info"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ['cmd'], key: 'r' }}
              onAction={() => void loadContactInfo()}
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

function formatScoutPrepMarkdownForClipboard(markdown: string): string {
  let inCodeFence = false;
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .split('\n')
    .map((rawLine) => {
      const trimmed = rawLine.trim();

      if (/^```/.test(trimmed)) {
        inCodeFence = !inCodeFence;
        return '';
      }

      if (inCodeFence) {
        return rawLine.trimEnd();
      }

      return trimmed
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*+]\s+/, '- ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/`([^`]+)`/g, '$1')
        .trimEnd();
    });

  const compacted: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (compacted.length && compacted[compacted.length - 1]) {
        compacted.push('');
      }
      continue;
    }
    compacted.push(line);
  }

  return compacted.join('\n').trim();
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
  const recipients = getVoicemailFollowUpRecipients(context);
  const defaultVariant = resolveVoicemailFollowUpVariant({
    crmStage,
    currentTask: currentTask || task.title || null,
  });

  async function openMessagesForRecipient(
    recipient?: (typeof recipients)[number],
    variant?: VoicemailFollowUpVariant,
  ) {
    if (!recipient || !recipient.phones.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No contact available',
        message: 'This athlete does not have a Messages-safe contact option yet.',
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
      const mode = await openMessagesDraftForRecipients(recipient.phones, body);
      logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'success', {
        contactId: context.task.contact_id,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientCount: recipient.phones.length,
        mode,
        variant: variant || defaultVariant,
      });
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
        message: 'Voicemail text copied to clipboard.',
      });
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

function buildPostCallPreviewMarkdown(
  task: ScoutPortalTask,
  values: Record<string, string | undefined>,
  createdTask?: ScoutAthleteTask | null,
  meetingSetResult?: MeetingSetSubmitResponse | null,
): string {
  const lines = [
    `# Post-Call Update`,
    '',
    `## ${task.athlete_name}`,
    '',
    `- **Official Sales Stage:** ${values.officialStage || 'Not selected'}`,
  ];

  if ((values.officialStage || '') === MEETING_SET_LABEL) {
    lines.push(
      `- **Meeting Name:** ${values.meetingName || 'Not provided'}`,
      `- **Recruit Time Zone:** ${values.recruitTimeZone || 'Not selected'}`,
      '',
      '## Meeting Set Details',
      '',
      values.meetingDetails || buildFallbackMeetingDetails(),
    );
  }

  if (createdTask) {
    lines.push(
      '',
      '## Next Task Created',
      '',
      `- **Task:** ${createdTask.title || 'Unknown task'}`,
      `- **Due Date:** ${createdTask.due_date || 'Not provided'}`,
      `- **Description:** ${createdTask.description || 'Not provided'}`,
    );
  }

  lines.push('');
  if ((values.officialStage || '') === MEETING_SET_LABEL) {
    lines.push(
      `> Meeting Set legacy flow submitted.${meetingSetResult?.email_sent ? ' Notification email sent.' : ' Notification email not confirmed.'}`,
    );
  } else {
    lines.push('> Official sales stage saved.');
  }

  return lines.join('\n');
}

function PostCallUpdatePreview({
  task,
  values,
  createdTask,
  meetingSetResult,
}: {
  task: ScoutPortalTask;
  values: Record<string, string | undefined>;
  createdTask?: ScoutAthleteTask | null;
  meetingSetResult?: MeetingSetSubmitResponse | null;
}) {
  return (
    <Detail
      navigationTitle={`Post-Call Update • ${task.athlete_name}`}
      markdown={buildPostCallPreviewMarkdown(task, values, createdTask, meetingSetResult)}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open Athlete Task Tab"
            icon={Icon.Globe}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
            url={buildScoutPrepTaskUrl(task, task.athlete_main_id)}
          />
          {createdTask ? (
            <Action.Push
              title="Build Scout Prep for Follow-Up"
              icon={Icon.Wand}
              target={
                <ScoutPrepDetail
                  task={{
                    ...task,
                    due_date: createdTask.due_date || task.due_date,
                    title: createdTask.title || task.title,
                    description: createdTask.description || task.description,
                  }}
                />
              }
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

type TrackedFollowUpItem = {
  pointer: ScoutPrepFollowUpPointer;
  task: ScoutPortalTask;
  createdTask: ScoutAthleteTask;
};

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
          title: 'Failed to load confirmation task',
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
        title: 'Missing task identifiers',
      });
      return;
    }

    setIsSaving(true);
    const toast = await showLoadingToast(
      'Saving confirmation call',
      'Updating task and follow-up queue',
    );
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

      let queueError: string | null = null;
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
          fallbackText:
            inferHeadScoutNameFromText(popupData?.taskdescription) ||
            inferHeadScoutNameFromText(confirmationTask.description) ||
            '',
        });
        await queueConfirmationFollowUp({
          athleteId,
          athleteMainId,
          athleteName,
          sport: liveContext.resolved.sport || null,
          gradYear: task.grad_year || null,
          state: liveContext.resolved.state || null,
          parent1Name: liveContext.contactInfo.parent1?.name || null,
          parent2Name: liveContext.contactInfo.parent2?.name || null,
          taskId: confirmationTask.task_id,
          currentTask,
          dueDate: nextDueDate,
          dueTime: nextDueTime,
          headScoutName: liveContext.resolved.head_scout || null,
          greetingOverride: buildTimeOfDayGreeting(liveContext),
          fallbackText:
            inferHeadScoutNameFromText(popupData?.taskdescription) ||
            inferHeadScoutNameFromText(confirmationTask.description) ||
            '',
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
        queueError = error instanceof Error ? error.message : String(error);
      }

      toast.style = queueError ? Toast.Style.Failure : Toast.Style.Success;
      toast.title = queueError
        ? 'Confirmation updated, queue failed'
        : 'Confirmation call updated + queued';
      toast.message = queueError || '';
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Failed to update confirmation call';
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

function UpdateAthleteTaskForm({
  task,
  selectedTask,
  athleteMainId,
  contactTask,
}: {
  task: ScoutPortalTask;
  selectedTask: ScoutAthleteTask;
  athleteMainId: string;
  contactTask: string;
}) {
  const { pop } = useNavigation();
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  async function handleUpdate(values: { dueDate?: Date }) {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateScoutPrepTask({
        taskId: selectedTask.task_id,
        contactTask,
        athleteMainId,
        taskTitle: getTaskDisplayTitle(selectedTask),
        description: selectedTask.description || getTaskDisplayTitle(selectedTask),
        dueDate: values.dueDate ? formatDateForLegacyInput(values.dueDate) : null,
        dueTime: values.dueDate ? formatTimeForLegacyInput(values.dueDate) : null,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Task updated',
        message: getTaskDisplayTitle(selectedTask),
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to update task',
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
        taskTitle: getTaskDisplayTitle(selectedTask),
        assignedOwner: selectedTask.assigned_owner,
        description: selectedTask.description || getTaskDisplayTitle(selectedTask),
        taskId: selectedTask.task_id,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Task completed',
        message: getTaskDisplayTitle(selectedTask),
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to complete task',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCompleting(false);
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
          <Action
            title={isCompleting ? 'Completing…' : 'Complete Task'}
            icon={Icon.CheckCircle}
            onAction={() => void handleCompleteTask()}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Task"
        text={`${getTaskDisplayTitle(selectedTask)}${selectedTask.assigned_owner ? ` • ${selectedTask.assigned_owner}` : ''}`}
      />
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
            title: 'Failed to load athlete tasks',
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
    const athleteMainId = String(context?.resolved.athlete_main_id || task.athlete_main_id || '').trim();
    const contactTask = String(task.contact_id || '').trim();
    if (!athleteMainId || !contactTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing task identifiers',
      });
      return;
    }
    push(
      <UpdateAthleteTaskForm
        task={task}
        selectedTask={selectedTask}
        athleteMainId={athleteMainId}
        contactTask={contactTask}
      />,
    );
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
  const { push } = useNavigation();
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
          title: 'Failed to load sales stages',
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
          title: 'Failed to load open meetings',
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
        title: 'Select a sales stage',
      });
      return;
    }

    setIsSaving(true);
    const toast = await showLoadingToast('Saving sales stage', 'Updating website, Supabase, and Notion');
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
        meetingSetStartTime = startTime;
        meetingSetAssignedOwner = selectedOpenMeeting?.assigned_owner || null;

        const selectedScout =
          HEAD_SCOUT_ORDER.find((scout) => scout.meeting_for === assignedTo) || null;
        const contextForCoach = context || (await loadScoutPrepContext(task));
        await cacheMeetingSetQueueContext({
          athleteId,
          athleteMainId,
          athleteName: task.athlete_name,
          headScoutName:
            String(contextForCoach.resolved.head_scout || '').trim() ||
            meetingSetAssignedOwner ||
            selectedScout?.scout_name ||
            '',
          meetingTimezone,
          assignedTo,
          openEventId,
          meetingName,
        });
      }

      const salesStageResult = await updateSalesStage({
        athleteMainId,
        athleteId,
        stage: stageLabel,
      });

      const syncContext = context || (await loadScoutPrepContext(task));
      if (stageLabel === MEETING_SET_LABEL && meetingSetResult) {
        const selectedScout =
          HEAD_SCOUT_ORDER.find((scout) => scout.meeting_for === meetingSetResult.assigned_to) || null;
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
      if (stageLabel === LEFT_VOICE_MAIL_1_LABEL) {
        const result = await completeScoutPrepTaskAfterVoicemail({
          athleteId,
          athleteMainId,
          contactTask: task.contact_id,
          taskId: task.task_id,
          taskTitle: task.title,
          assignedOwner: task.assigned_owner,
          description: task.description,
        });
        taskCompletionMessage = result.task_id
          ? `Task ${result.task_id} completed.`
          : 'Task completed.';
      }

      let notionSyncError: string | null = null;
      try {
        const notionTaskId =
          String(
            meetingSetResult?.created_task?.task_id ||
              salesStageResult.created_task?.task_id ||
              task.task_id ||
              '',
          ).trim() || null;
        const notionDueDate =
          String(
            meetingSetResult?.created_task?.due_date ||
              salesStageResult.created_task?.due_date ||
              task.due_date ||
              '',
          ).trim() || null;
        const notionCurrentTask =
          stripMoveThisTaskPrefix(
            meetingSetResult?.created_task?.title ||
              salesStageResult.created_task?.title ||
              task.title ||
              '',
          ) ||
          (stageLabel === MEETING_SET_LABEL ? 'Confirmation Call' : 'Follow Up');

        await syncScoutOutcomeToNotion({
          athleteId,
          athleteMainId,
          athleteName: syncContext.contactInfo.studentAthlete.name || task.athlete_name,
          parent1Name: syncContext.contactInfo.parent1?.name || null,
          parent2Name: syncContext.contactInfo.parent2?.name || null,
          stage: stageLabel,
          currentTask: notionCurrentTask,
          dueDate: notionDueDate,
          adminUrl: buildAthleteAdminUrl(athleteId, athleteMainId),
          taskId: notionTaskId,
        });
      } catch (error) {
        notionSyncError = error instanceof Error ? error.message : String(error);
      }

      toast.style = notionSyncError ? Toast.Style.Failure : Toast.Style.Success;
      toast.title = notionSyncError
        ? 'Website saved, Notion sync failed'
        : taskCompletionMessage
          ? 'Sales stage saved, task completed'
          : stageLabel === MEETING_SET_LABEL
            ? 'Meeting Set + sales stage saved'
            : 'Sales stage saved';
      toast.message =
        notionSyncError ||
        taskCompletionMessage ||
        (stageLabel === MEETING_SET_LABEL
          ? meetingSetResult?.email_sent
            ? 'Meeting Set email sent'
            : 'Meeting Set saved'
          : stageLabel);

      if (salesStageResult.created_task) {
        await addScoutPrepFollowUpPointer({
          athleteId,
          athleteMainId,
          athleteName: task.athlete_name,
          gradYear: task.grad_year,
        });
      }

      push(
        <PostCallUpdatePreview
          task={task}
          values={{
            ...values,
            officialStage: stageLabel,
          }}
          createdTask={meetingSetResult?.created_task || salesStageResult.created_task || null}
          meetingSetResult={meetingSetResult}
        />,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.style = Toast.Style.Failure;
      toast.title = 'Failed to save sales stage';
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
                key={`${meetingTemplateKey}-details`}
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

function ScoutPrepDetail({ task }: { task: ScoutPortalTask }) {
  const { push, pop } = useNavigation();
  const [markdown, setMarkdown] = useState<string>('Loading scout prep...');
  const [metadata, setMetadata] = useState<ReactElement | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [context, setContext] = useState<Awaited<ReturnType<typeof loadScoutPrepContext>> | null>(
    null,
  );

  async function handleVoicemailFollowUp() {
    if (!context) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Scout Prep still loading',
        message: 'Wait for contact data before opening Messages.',
      });
      return;
    }

    const recipients = getVoicemailFollowUpRecipients(context);
    if (!recipients.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No usable contact number',
        message: 'Hydrated contact data did not include a Messages-safe number.',
      });
      return;
    }
    const crmStage = await getSelectedCrmStageLabel(task.contact_id);
    push(
      <VoicemailFollowUpRecipientForm
        task={task}
        context={context}
        crmStage={crmStage}
        currentTask={task.title || null}
      />,
    );
  }

  async function handleSyncCallPrepToNotion() {
    if (isLoading || /^Loading scout prep/i.test(markdown.trim())) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Scout Prep still loading',
        message: 'Wait for the script before syncing Notion.',
      });
      return;
    }

    const toast = await showLoadingToast(
      'Syncing Notion call prep',
      'Updating script and voicemail toggles',
    );

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
      toast.title = 'Notion call prep updated';
      toast.message = `Replaced ${scriptResult.toggleTitle} and ${voicemailResult.toggleTitle}.`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Notion sync failed';
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function resolveNotesContext(): Promise<ScoutPrepContext | null> {
    if (context) {
      return context;
    }

    try {
      const loadedContext = await loadScoutPrepContext(task);
      setContext(loadedContext);
      return loadedContext;
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing ID',
        message: error instanceof Error ? error.message : 'Could not resolve athlete_main_id',
      });
      return null;
    }
  }

  async function handleViewNotes() {
    const notesContext = await resolveNotesContext();
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
    const notesContext = await resolveNotesContext();
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
    let activeContext = context;
    if (!activeContext) {
      try {
        activeContext = await loadScoutPrepContext(task);
        setContext(activeContext);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Missing task context',
          message: error instanceof Error ? error.message : 'Could not load athlete tasks',
        });
        return null;
      }
    }

    return findNewestIncompleteConfirmationTask(activeContext.tasks);
  }

  async function handleRescheduleConfirmationTask() {
    const confirmationTask = await resolveConfirmationTask();
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation call task found',
      });
      return;
    }

    push(<RescheduleConfirmationCallForm task={task} confirmationTask={confirmationTask} />);
  }

  async function handleTextMeetingReminder() {
    let activeContext = context;
    if (!activeContext) {
      activeContext = await loadScoutPrepContext(task);
      setContext(activeContext);
    }

    const reminderRecipient = getMeetingReminderRecipient(activeContext);
    if (!reminderRecipient?.phones.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No usable contact number',
        message: 'No parent or fallback number available for reminder text.',
      });
      return;
    }

    const confirmationTask = findNewestIncompleteConfirmationTask(activeContext.tasks);
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation call task found',
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
          const toast = await showLoadingToast(
            'Preparing meeting reminder',
            'Resolving confirmation task and current meeting',
          );
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
            await queueConfirmationFollowUp({
              athleteId: String(task.contact_id || '').trim(),
              athleteMainId,
              athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
              sport: activeContext.resolved.sport || null,
              gradYear: task.grad_year || null,
              state: activeContext.resolved.state || null,
              parent1Name: activeContext.contactInfo.parent1?.name || null,
              parent2Name: activeContext.contactInfo.parent2?.name || null,
              taskId: confirmationTask.task_id,
              currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
              dueDate: confirmationTask.due_date || task.due_date || null,
              dueTime: null,
              headScoutName: activeContext.resolved.head_scout || null,
              greetingOverride: buildTimeOfDayGreeting(activeContext),
              recipientNames: reminderRecipient.recipientNames,
              fallbackText: confirmationTask.description || '',
              reminderVariant: values.variant,
            });
          } catch {
            // Notion failure should not block message draft.
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
            toast.message = 'Meeting reminder draft ready.';
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
            toast.message = 'Meeting reminder copied to clipboard.';
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

  async function handleCompleteConfirmationTask() {
    const confirmationTask = await resolveConfirmationTask();
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation call task found',
      });
      return;
    }

    const athleteMainId = String(
      task.athlete_main_id || context?.resolved.athlete_main_id || '',
    ).trim();
    const contactTask = String(task.contact_id || '').trim();
    if (!athleteMainId || !contactTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing task identifiers',
      });
      return;
    }

    const toast = await showLoadingToast(
      'Completing confirmation call',
      'Saving task completion',
    );

    try {
      await completeScoutPrepTaskAfterVoicemail({
        athleteId: contactTask,
        athleteMainId,
        contactTask,
        taskTitle: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
        assignedOwner: confirmationTask.assigned_owner,
        description: confirmationTask.description || 'Confirmation Call',
        taskId: confirmationTask.task_id,
      });
      toast.style = Toast.Style.Success;
      toast.title = 'Confirmation call completed';
      toast.message = '';
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = 'Failed to complete confirmation call';
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
          <Action.Push
            title="Post-Call Update"
            icon={Icon.Pencil}
            target={<PostCallUpdateForm task={task} />}
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
  onToggleProspectSearchMode,
  isProspectSearchMode,
  onToggleRecentMode,
}: {
  task: ScoutPortalTask;
  onToggleProspectSearchMode: () => void;
  isProspectSearchMode: boolean;
  onToggleRecentMode: () => void;
}) {
  const { push, pop } = useNavigation();

  async function handleVoicemailFollowUp() {
    try {
      const context = await loadScoutPrepContext(task);
      const recipients = getVoicemailFollowUpRecipients(context);
      if (!recipients.length) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'No usable contact number',
        });
        return;
      }
      const crmStage = await getSelectedCrmStageLabel(task.contact_id);
      push(
        <VoicemailFollowUpRecipientForm
          task={task}
          context={context}
          crmStage={crmStage}
          currentTask={task.title || null}
        />,
      );
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load contact data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async function loadTaskNotesContext(): Promise<ScoutPrepContext | null> {
    try {
      return await loadScoutPrepContext(task);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing ID',
        message: error instanceof Error ? error.message : 'Could not resolve athlete_main_id',
      });
      return null;
    }
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
    const context = await loadTaskNotesContext();
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
    const context = await loadTaskNotesContext();
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
        title: 'No confirmation call task found',
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
        title: 'No usable contact number',
      });
      return;
    }

    const confirmationTask = findNewestIncompleteConfirmationTask(activeContext.tasks);
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation call task found',
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
          const toast = await showLoadingToast(
            'Preparing meeting reminder',
            'Resolving confirmation task and current meeting',
          );
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
            await queueConfirmationFollowUp({
              athleteId: String(task.contact_id || '').trim(),
              athleteMainId,
              athleteName: activeContext.contactInfo.studentAthlete.name || task.athlete_name,
              sport: activeContext.resolved.sport || null,
              gradYear: task.grad_year || null,
              state: activeContext.resolved.state || null,
              parent1Name: activeContext.contactInfo.parent1?.name || null,
              parent2Name: activeContext.contactInfo.parent2?.name || null,
              taskId: confirmationTask.task_id,
              currentTask: stripMoveThisTaskPrefix(confirmationTask.title) || 'Confirmation Call',
              dueDate: confirmationTask.due_date || task.due_date || null,
              dueTime: null,
              headScoutName: activeContext.resolved.head_scout || null,
              greetingOverride: buildTimeOfDayGreeting(activeContext),
              recipientNames: reminderRecipient.recipientNames,
              fallbackText: confirmationTask.description || '',
              reminderVariant: values.variant,
            });
          } catch {
            // Notion failure should not block message draft.
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
            toast.message = 'Meeting reminder draft ready.';
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
            toast.message = 'Meeting reminder copied to clipboard.';
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

  const shortDate = formatShortDueDate(task.due_date);
  const taskTitle = stripMoveThisTaskPrefix(task.title);

  const taskColor = (() => {
    const t = (taskTitle || '').toLowerCase();
    if (t.startsWith('call attempt')) return Color.Blue;
    if (t.includes('confirmation')) return Color.Green;
    if (t.includes('meeting set')) return Color.Orange;
    if (t.includes('follow up') || t.includes('follow-up')) return Color.Yellow;
    if (t.includes('voicemail') || t.includes('voice mail')) return Color.Magenta;
    return Color.SecondaryText;
  })();

  const gradYearColor = (() => {
    switch (task.grad_year) {
      case '2026': return Color.Red;
      case '2027': return Color.Purple;
      case '2028': return Color.Blue;
      case '2029': return Color.Green;
      case '2030': return Color.Magenta;
      default: return Color.SecondaryText;
    }
  })();

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
            target={<ScoutPrepDetail task={task} />}
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
          <Action.Push
            title="Post-Call Update"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd'], key: 'u' }}
            target={<PostCallUpdateForm task={task} />}
          />
          <Action.Push
            title="Contact Info"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
            target={<ScoutPrepContactDetail task={task} />}
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
            <BackSyncFollowUpsAction />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function TrackedFollowUpListItem({
  item,
  onRemove,
  onToggleProspectSearchMode,
  isProspectSearchMode,
  onToggleRecentMode,
}: {
  item: TrackedFollowUpItem;
  onRemove: (item: TrackedFollowUpItem) => Promise<void>;
  onToggleProspectSearchMode: () => void;
  isProspectSearchMode: boolean;
  onToggleRecentMode: () => void;
}) {
  const { task, createdTask } = item;

  return (
    <List.Item
      key={`follow-up:${task.contact_id}:${task.athlete_main_id || 'missing-main-id'}`}
      icon={Icon.Repeat}
      title={task.athlete_name}
      subtitle={createdTask.title || 'Follow-Up Task'}
      keywords={buildTaskSearchKeywords(task, [
        createdTask.title,
        createdTask.description,
        createdTask.due_date,
      ])}
      detail={
        <List.Item.Detail
          markdown={[
            `# ${task.athlete_name}`,
            '',
            `- Task: ${createdTask.title || 'N/A'}`,
            `- Due Date: ${createdTask.due_date || 'N/A'}`,
            `- Description: ${createdTask.description || 'N/A'}`,
          ].join('\n')}
          metadata={
            <List.Item.Detail.Metadata>
              {task.grad_year ? (
                <List.Item.Detail.Metadata.TagList title="Grad Year">
                  <List.Item.Detail.Metadata.TagList.Item
                    text={task.grad_year}
                    color={Color.Purple}
                  />
                </List.Item.Detail.Metadata.TagList>
              ) : null}
              <List.Item.Detail.Metadata.Label title="Athlete ID" text={task.contact_id} />
              {task.athlete_main_id ? (
                <List.Item.Detail.Metadata.Label
                  title="Athlete Main ID"
                  text={task.athlete_main_id}
                />
              ) : null}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Build Scout Prep"
            icon={Icon.Wand}
            target={<ScoutPrepDetail task={task} />}
          />
          <Action.OpenInBrowser
            title="Open Athlete Task Tab"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
            url={buildScoutPrepTaskUrl(task)}
          />
          <Action
            title="Remove From Follow-Up List"
            icon={Icon.Trash}
            shortcut={{ modifiers: ['cmd'], key: 'backspace' }}
            onAction={() => void onRemove(item)}
          />
          <ActionPanel.Section title="Navigation">
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
            <BackSyncFollowUpsAction />
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
}: {
  result: ProspectResult;
  onToggleProspectSearchMode: () => void;
  isProspectSearchMode: boolean;
  onShowRecentProfiles: () => void;
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
              target={<ScoutPrepDetail task={scoutPrepTask} />}
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
            <BackSyncFollowUpsAction />
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
}: {
  item: RecentProfileRow;
  onShowProspectSearch: () => void;
  onToggleProspectSearchMode: () => void;
  onToggleRecentMode: () => void;
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
            target={<ScoutPrepDetail task={task} />}
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
            <BackSyncFollowUpsAction />
            <SupabaseLifecycleStatusAction />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function ScoutPrepCommand() {
  const [tasks, setTasks] = useState<ScoutPortalTask[]>([]);
  const [trackedFollowUps, setTrackedFollowUps] = useState<TrackedFollowUpItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [taskSearchText, setTaskSearchText] = useState('');
  const [prospectSearchText, setProspectSearchText] = useState('');
  const [prospectResults, setProspectResults] = useState<ProspectResult[]>([]);
  const [isProspectSearching, setIsProspectSearching] = useState(false);
  const [recentProfiles, setRecentProfiles] = useState<RecentProfileRow[]>([]);
  const [isRecentFollowUpsLoading, setIsRecentFollowUpsLoading] = useState(false);
  const loadTasksPromiseRef = useRef<Promise<void> | null>(null);
  const initialLoadStartedRef = useRef(false);
  const prospectSearchRequestIdRef = useRef(0);

  const isProspectSearchMode = viewMode === 'prospect';
  const isRecentViewMode = viewMode === 'recent';
  const isSearchModeActive = viewMode === 'prospect' || viewMode === 'recent';
  const hasProspectSearchText = prospectSearchText.trim().length > 0;

  const loadTasks = async (options?: { forceRefreshFollowUps?: boolean }) => {
    if (loadTasksPromiseRef.current) {
      logInfo('SCOUT_PREP_TASK_LIST', 'reuse-inflight-load', 'start');
      return loadTasksPromiseRef.current;
    }

    const forceRefreshFollowUps = Boolean(options?.forceRefreshFollowUps);

    const pendingLoad = (async () => {
      setIsLoading(true);
      try {
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'start');
        const data = await fetchScoutPortalTasks();
        const bottomUpTasks = [...data].reverse();
        const pointers = await listScoutPrepFollowUpPointers();
        const autoRefreshSet = new Set(
          pointers
            .slice(0, FOLLOW_UP_AUTO_REFRESH_LIMIT)
            .map((pointer) => `${pointer.athleteId}:${pointer.athleteMainId}`),
        );
        const resolvedFollowUps = (
          await Promise.all(
            pointers.map(async (pointer) => {
              try {
                const pointerKey = `${pointer.athleteId}:${pointer.athleteMainId}`;
                const shouldRefresh = forceRefreshFollowUps || autoRefreshSet.has(pointerKey);

                let followUpTask = !shouldRefresh
                  ? await getCachedScoutPrepFollowUpTask(pointer.athleteId, pointer.athleteMainId)
                  : undefined;

                if (followUpTask === undefined) {
                  const athleteTasks = await fetchAthleteTasks(
                    pointer.athleteId,
                    pointer.athleteMainId,
                  );
                  followUpTask = findNewestIncompleteFollowUpTask(athleteTasks);
                  await setCachedScoutPrepFollowUpTask(
                    pointer.athleteId,
                    pointer.athleteMainId,
                    followUpTask,
                  );
                }

                if (!followUpTask) {
                  if (shouldRefresh) {
                    await removeScoutPrepFollowUpPointer(pointer.athleteId, pointer.athleteMainId);
                  }
                  return null;
                }

                const matchingGlobalTask =
                  bottomUpTasks.find(
                    (candidate) =>
                      String(candidate.contact_id) === pointer.athleteId &&
                      String(candidate.athlete_main_id || '').trim() === pointer.athleteMainId,
                  ) || null;

                const task: ScoutPortalTask = {
                  task_id: followUpTask.task_id,
                  contact_id: pointer.athleteId,
                  athlete_id: pointer.athleteId,
                  athlete_main_id: pointer.athleteMainId,
                  athlete_name: matchingGlobalTask?.athlete_name || pointer.athleteName,
                  grad_year: matchingGlobalTask?.grad_year || pointer.gradYear || null,
                  due_date: followUpTask.due_date || matchingGlobalTask?.due_date || null,
                  completion_date: followUpTask.completion_date || null,
                  assigned_owner:
                    followUpTask.assigned_owner || matchingGlobalTask?.assigned_owner || null,
                  title: followUpTask.title || matchingGlobalTask?.title || null,
                  description: followUpTask.description || matchingGlobalTask?.description || null,
                };

                return {
                  pointer,
                  task,
                  createdTask: followUpTask,
                } satisfies TrackedFollowUpItem;
              } catch {
                return null;
              }
            }),
          )
        ).filter((item): item is TrackedFollowUpItem => Boolean(item));

        setTasks(bottomUpTasks);
        setTrackedFollowUps(resolvedFollowUps);
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'success', {
          count: bottomUpTasks.length,
          followUpCount: resolvedFollowUps.length,
          followUpForceRefresh: forceRefreshFollowUps,
          followUpAutoRefreshLimit: FOLLOW_UP_AUTO_REFRESH_LIMIT,
          firstAthlete: bottomUpTasks[0]?.athlete_name || null,
          lastAthlete: bottomUpTasks[bottomUpTasks.length - 1]?.athlete_name || null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logFailure('SCOUT_PREP_TASK_LIST', 'load-list', message);
        await showToast({
          style: Toast.Style.Failure,
          title: 'Failed to load scout tasks',
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
            title: 'Prospect Search Failed',
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

  async function handleRemoveTrackedFollowUp(item: TrackedFollowUpItem) {
    await removeScoutPrepFollowUpPointer(item.pointer.athleteId, item.pointer.athleteMainId);
    setTrackedFollowUps((current) =>
      current.filter(
        (entry) =>
          !(
            entry.pointer.athleteId === item.pointer.athleteId &&
            entry.pointer.athleteMainId === item.pointer.athleteMainId
          ),
      ),
    );
    await showToast({
      style: Toast.Style.Success,
      title: 'Removed from follow-up list',
      message: item.task.athlete_name,
    });
  }

  function toggleRecentMode() {
    setViewMode((current) => {
      if (current === 'recent') {
        // Exit recent → back to tasks
        setRecentProfiles([]);
        setIsRecentFollowUpsLoading(false);
        return 'tasks';
      }
      // Enter recent from anywhere
      setTaskSearchText('');
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
      setTaskSearchText('');
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
      filtering={true}
      searchBarPlaceholder={
        viewMode === 'recent'
          ? 'Recent Profiles'
          : viewMode === 'prospect'
            ? 'Prospect Search — Enter athlete name or email'
            : 'Search Task List'
      }
      searchText={viewMode !== 'tasks' ? (viewMode === 'recent' ? '' : prospectSearchText) : undefined}
      onSearchTextChange={
        viewMode === 'recent'
          ? undefined
          : viewMode === 'prospect'
            ? setProspectSearchText
            : undefined
      }
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
                <BackSyncFollowUpsAction />
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
                isProspectSearchMode={isProspectSearchMode}
                onShowRecentProfiles={toggleRecentMode}
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
                <BackSyncFollowUpsAction />
                <SupabaseLifecycleStatusAction />
              </ActionPanel>
            }
          />
          )}
        </List.Section>
      ) : trackedFollowUps.length > 0 ? (
        <List.Section title="Follow-Up List" subtitle={String(trackedFollowUps.length)}>
          {trackedFollowUps.map((item) => (
            <TrackedFollowUpListItem
              key={`tracked:${item.pointer.athleteId}:${item.pointer.athleteMainId}`}
              item={item}
              onRemove={handleRemoveTrackedFollowUp}
              onToggleProspectSearchMode={toggleProspectSearchMode}
              isProspectSearchMode={isSearchModeActive}
              onToggleRecentMode={toggleRecentMode}
            />
          ))}
        </List.Section>
      ) : tasks.length === 0 && trackedFollowUps.length === 0 ? (
        <List.EmptyView
          title="No scout tasks found"
          description="The landing-page task list is empty."
          actions={
            <ActionPanel>
              <Action title="Reload Scout Tasks" onAction={() => void loadTasks()} />
              <Action
                title="Refresh Follow-Up List"
                onAction={() => void loadTasks({ forceRefreshFollowUps: true })}
              />
              <ActionPanel.Section title="Navigation">
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
                <BackSyncFollowUpsAction />
                <SupabaseLifecycleStatusAction />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title="Today / Past Due" subtitle={String(tasks.length)}>
          {tasks.map((task) => (
            <ScoutPrepTaskItem
              key={`${task.contact_id}-${task.title || 'task'}`}
              task={task}
              onToggleProspectSearchMode={toggleProspectSearchMode}
              isProspectSearchMode={isSearchModeActive}
              onToggleRecentMode={toggleRecentMode}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
