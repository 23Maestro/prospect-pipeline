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
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { HeadScoutSchedulesRoot } from './head-scout-schedules';
import { buildScoutPrepMarkdown } from './features/scout-prep/content';
import type {
  MeetingSetTemplateResponse,
  SalesStageOption,
  ScoutAthleteTask,
  ScoutPortalTask,
  ScoutPrepContext,
  ScoutPrepFormValues,
} from './features/scout-prep/types';
import {
  buildMeetingTemplateDefaults,
  buildProspectContactShortcutPayloadFromName,
  buildProspectContactShortcutUrl,
  buildMessagesComposeUrl,
  buildScoutPrepLeavingVoicemailBody,
  buildVoicemailFollowUpBody,
  getProspectContactShortcutCandidates,
  type ProspectContactShortcutCandidate,
  selectScoutPrepContactNumbers,
} from './lib/scout-prep-contact';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepMetadata,
  buildScoutPrepValues,
  completeScoutPrepTaskAfterVoicemail,
  fetchAthleteTasks,
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
import { ensureProspectDetails, runProspectRawSearch, type ProspectResult } from './lib/prospect-search';
import {
  fetchCuratedSalesStageOptions,
  fetchMeetingSetTemplate,
  updateSalesStage,
} from './lib/sales-stage';
import { searchLogger } from './lib/logger';

const FEATURE = 'scout-prep';
const MEETING_SET_LABEL = 'Meeting Set';
const LEFT_VOICE_MAIL_1_LABEL = 'Left Voice Mail 1';
const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';
const FOLLOW_UP_AUTO_REFRESH_LIMIT = 12;

const RATING_OPTIONS = [
  { value: '', title: 'Select rating' },
  { value: '1', title: '1 - Low' },
  { value: '2', title: '2' },
  { value: '3', title: '3 - Solid' },
  { value: '4', title: '4' },
  { value: '5', title: '5 - Strong' },
];

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

  const contactInfo = context?.contactInfo;

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

type ScoutPrepParentOption = {
  id: 'parent1' | 'parent2';
  name: string;
};

function getScoutPrepParentOptions(context: ScoutPrepContext): ScoutPrepParentOption[] {
  return [
    context.contactInfo.parent1?.name
      ? { id: 'parent1' as const, name: context.contactInfo.parent1.name }
      : null,
    context.contactInfo.parent2?.name
      ? { id: 'parent2' as const, name: context.contactInfo.parent2.name }
      : null,
  ].filter(Boolean) as ScoutPrepParentOption[];
}

function buildLeavingVoicemailMarkdown(body: string): string {
  return ['# Leaving a Voice Mail', '', '```text', body, '```'].join('\n');
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

function LeavingVoicemailDetail({
  task,
  context,
  parentName,
}: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  parentName: string;
}) {
  const body = buildScoutPrepLeavingVoicemailBody({
    parentName,
    athleteName: context.contactInfo.studentAthlete.name || task.athlete_name,
    sport: context.resolved.sport,
  });

  async function handleSyncVoicemailToNotion() {
    try {
      const result = await syncCallScriptToggleToNotion({
        target: 'voicemail',
        markdown: body,
      });
      await showToast({
        style: Toast.Style.Success,
        title: 'Notion voicemail updated',
        message: `Replaced ${result.toggleTitle}.`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Notion sync failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Detail
      navigationTitle={`Voice Mail • ${task.athlete_name}`}
      markdown={buildLeavingVoicemailMarkdown(body)}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy Voice Mail"
            icon={Icon.Clipboard}
            content={body}
            shortcut={{ modifiers: ['cmd'], key: 'c' }}
          />
          <Action
            title="Sync Notion Voice Mail"
            icon={Icon.Upload}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
            onAction={() => void handleSyncVoicemailToNotion()}
          />
          <Action.Push
            title="Contact Info"
            icon={Icon.Phone}
            target={<ScoutPrepContactDetail task={task} initialContext={context} />}
          />
        </ActionPanel>
      }
    />
  );
}

function LeavingVoicemailParentForm({
  task,
  context,
  parentOptions,
}: {
  task: ScoutPortalTask;
  context: ScoutPrepContext;
  parentOptions: ScoutPrepParentOption[];
}) {
  const { push } = useNavigation();

  return (
    <Form
      navigationTitle={`Voice Mail • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Generate Voice Mail"
            onSubmit={(values) => {
              const selected = String((values as { parentId?: string }).parentId || '');
              const parent =
                parentOptions.find((option) => option.id === selected) || parentOptions[0];
              if (!parent) {
                return;
              }
              push(
                <LeavingVoicemailDetail task={task} context={context} parentName={parent.name} />,
              );
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="parentId" title="Parent" defaultValue={parentOptions[0]?.id}>
        {parentOptions.map((parent) => (
          <Form.Dropdown.Item key={parent.id} value={parent.id} title={parent.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function buildPostCallPreviewMarkdown(
  task: ScoutPortalTask,
  values: Record<string, string | undefined>,
  createdTask?: ScoutAthleteTask | null,
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
      '## Self-Evaluation',
      '',
      `- **Rapport Rating:** ${values.rapportRating || 'Not rated'}`,
      `- **Urgency Rating:** ${values.urgencyRating || 'Not rated'}`,
      `- **Close Rating:** ${values.closeRating || 'Not rated'}`,
      `- **Optional Note:** ${values.coachingNote || 'None'}`,
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

  lines.push(
    '',
    '> Official sales stage saved. Meeting Set detail save is still separate until that legacy POST is captured.',
  );

  return lines.join('\n');
}

function PostCallUpdatePreview({
  task,
  values,
  createdTask,
}: {
  task: ScoutPortalTask;
  values: Record<string, string | undefined>;
  createdTask?: ScoutAthleteTask | null;
}) {
  return (
    <Detail
      navigationTitle={`Post-Call Update • ${task.athlete_name}`}
      markdown={buildPostCallPreviewMarkdown(task, values, createdTask)}
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
    description: [result.sport, result.high_school].filter(Boolean).join(' • ') || 'Prospect Search Result',
  };
}

function formatDateForLegacyInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function buildDefaultConfirmationDate(value?: string | null): Date | undefined {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return undefined;
  const month = Number.parseInt(match[1], 10) - 1;
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const date = new Date(year, month, day);
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

  async function handleSubmit(values: { dueDate?: Date; dueTime?: string; taskTitle?: string }) {
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
    try {
      await updateScoutPrepTask({
        taskId: confirmationTask.task_id,
        contactTask,
        athleteMainId,
        taskTitle:
          String(values.taskTitle || '').trim() || stripMoveThisTaskPrefix(popupData?.tasktitle),
        description: popupData?.taskdescription || confirmationTask.description || '',
        dueDate: values.dueDate ? formatDateForLegacyInput(values.dueDate) : popupData?.duedate,
        dueTime: String(values.dueTime || '').trim() || popupData?.duetime,
      });

      await showToast({
        style: Toast.Style.Success,
        title: 'Confirmation call updated',
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to update confirmation call',
        message: error instanceof Error ? error.message : String(error),
      });
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
              void handleSubmit(values as { dueDate?: Date; dueTime?: string; taskTitle?: string })
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
        defaultValue={buildDefaultConfirmationDate(popupData?.duedate)}
      />
      <Form.TextField
        id="dueTime"
        title="Time"
        defaultValue={popupData?.duetime || '13:00'}
        placeholder="13:00"
      />
    </Form>
  );
}

function CreateProspectContactForm({
  task,
  candidates,
}: {
  task: ScoutPortalTask;
  candidates: ProspectContactShortcutCandidate[];
}) {
  async function handleSubmit(values: { contactId?: string }) {
    const selectedId = String(values.contactId || '');
    const candidate = candidates.find((item) => item.id === selectedId) || candidates[0];

    if (!candidate) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No eligible contact selected',
      });
      return;
    }

    try {
      const payload = buildProspectContactShortcutPayloadFromName({
        fullName: candidate.name,
        phone: candidate.phone,
      });
      const shortcutUrl = buildProspectContactShortcutUrl(payload);
      await open(shortcutUrl);
      await showToast({
        style: Toast.Style.Success,
        title: 'Shortcut launched',
        message: `${candidate.label}: ${candidate.name}`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to create prospect contact',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <Form
      navigationTitle={`Create Prospect Contact • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Run Create Prospect Contact"
            onSubmit={(values) => void handleSubmit(values as { contactId?: string })}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Select the contact to send into the existing macOS Shortcut." />
      <Form.Dropdown id="contactId" title="Contact" defaultValue={candidates[0]?.id}>
        {candidates.map((candidate) => (
          <Form.Dropdown.Item
            key={candidate.id}
            value={candidate.id}
            title={`${candidate.label}: ${candidate.name} (${candidate.phone})`}
          />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function PostCallUpdateForm({ task }: { task: ScoutPortalTask }) {
  const { push } = useNavigation();
  const [stageOptions, setStageOptions] = useState<SalesStageOption[]>([]);
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [meetingTemplate, setMeetingTemplate] = useState<MeetingSetTemplateResponse | null>(null);
  const [isLoadingStages, setIsLoadingStages] = useState(true);
  const [isLoadingMeetingTemplate, setIsLoadingMeetingTemplate] = useState(false);
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
  const canRenderStageFields =
    !isLoadingStages && stageOptions.length > 0 && Boolean(selectedStage);

  async function handleCreateProspectContact() {
    try {
      const context = await loadScoutPrepContext(task);
      const candidates = getProspectContactShortcutCandidates(context);

      if (candidates.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'No eligible contact found',
          message: 'A first name, last name, and phone number are required.',
        });
        return;
      }

      push(<CreateProspectContactForm task={task} candidates={candidates} />);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to load contact data',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

      const salesStageResult = await updateSalesStage({
        athleteMainId,
        athleteId,
        stage: stageLabel,
      });

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

      await showToast({
        style: Toast.Style.Success,
        title: taskCompletionMessage ? 'Sales stage saved, task completed' : 'Sales stage saved',
        message: taskCompletionMessage || stageLabel,
      });

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
          createdTask={salesStageResult.created_task || null}
        />,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to save sales stage',
        message,
      });
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
          <Action
            title="Create Prospect Contact"
            icon={Icon.Person}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
            onAction={() => void handleCreateProspectContact()}
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
              <Form.Dropdown id="rapportRating" title="Rapport Rating">
                {RATING_OPTIONS.map((option) => (
                  <Form.Dropdown.Item
                    key={option.value}
                    value={option.value}
                    title={option.title}
                  />
                ))}
              </Form.Dropdown>
              <Form.Dropdown id="urgencyRating" title="Urgency Rating">
                {RATING_OPTIONS.map((option) => (
                  <Form.Dropdown.Item
                    key={option.value}
                    value={option.value}
                    title={option.title}
                  />
                ))}
              </Form.Dropdown>
              <Form.Dropdown id="closeRating" title="Close Rating">
                {RATING_OPTIONS.map((option) => (
                  <Form.Dropdown.Item
                    key={option.value}
                    value={option.value}
                    title={option.title}
                  />
                ))}
              </Form.Dropdown>
              <Form.TextArea
                id="coachingNote"
                title="Optional Note"
                placeholder="Optional coaching note"
              />
              <Form.TextArea
                key={`${meetingTemplateKey}-details`}
                id="meetingDetails"
                title="Meeting Set Details"
                defaultValue={meetingTemplate?.details_template || buildFallbackMeetingDetails()}
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

    const contactSelection = selectScoutPrepContactNumbers(context);
    if (!contactSelection.primaryNumber) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No usable contact number',
        message: 'Hydrated contact data did not include a Messages-safe number.',
      });
      return;
    }

    const body = buildVoicemailFollowUpBody(context);
    const url = buildMessagesComposeUrl(contactSelection.primaryNumber, body);
    logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'start', {
      contactId: context.task.contact_id,
      hasBackupNumber: Boolean(contactSelection.backupNumber),
      recipientName: contactSelection.recipientName,
    });
    try {
      await open(url);
      logInfo('SCOUT_PREP_MESSAGES_HANDOFF', 'open-compose', 'success', {
        contactId: context.task.contact_id,
        recipientName: contactSelection.recipientName,
        mode: 'prefilled',
      });
    } catch (error) {
      await Clipboard.copy(body);
      await open(`sms:${contactSelection.primaryNumber}`);
      logFailure(
        'SCOUT_PREP_MESSAGES_HANDOFF',
        'open-compose',
        error instanceof Error ? error.message : String(error),
        {
          contactId: context.task.contact_id,
          recipientName: contactSelection.recipientName,
          mode: 'clipboard-fallback',
        },
      );
      await showToast({
        style: Toast.Style.Success,
        title: 'Messages opened',
        message: 'Voicemail text copied to clipboard.',
      });
    }
  }

  async function handleLeavingVoicemail() {
    let activeContext = context;
    if (!activeContext) {
      try {
        activeContext = await loadScoutPrepContext(task);
        setContext(activeContext);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'Scout Prep still loading',
          message: error instanceof Error ? error.message : 'Wait for contact data.',
        });
        return;
      }
    }

    const parentOptions = getScoutPrepParentOptions(activeContext);
    if (parentOptions.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No parent contact available',
      });
      return;
    }

    if (parentOptions.length === 1) {
      push(
        <LeavingVoicemailDetail
          task={task}
          context={activeContext}
          parentName={parentOptions[0].name}
        />,
      );
      return;
    }

    push(
      <LeavingVoicemailParentForm
        task={task}
        context={activeContext}
        parentOptions={parentOptions}
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

      await showToast({
        style: Toast.Style.Success,
        title: 'Notion call prep updated',
        message: `Replaced ${scriptResult.toggleTitle} and ${voicemailResult.toggleTitle}.`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Notion sync failed',
        message: error instanceof Error ? error.message : String(error),
      });
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
      await showToast({
        style: Toast.Style.Success,
        title: 'Confirmation call completed',
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to complete confirmation call',
        message: error instanceof Error ? error.message : String(error),
      });
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
            title="Leaving a Voice Mail"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
            onAction={() => void handleLeavingVoicemail()}
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
          <Action
            title="Complete Confirmation Call"
            icon={Icon.CheckCircle}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'k' }}
            onAction={() => void handleCompleteConfirmationTask()}
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
}: {
  task: ScoutPortalTask;
  onToggleProspectSearchMode: () => void;
  isProspectSearchMode: boolean;
}) {
  const { push, pop } = useNavigation();

  async function handleLeavingVoicemail() {
    try {
      const context = await loadScoutPrepContext(task);
      const parentOptions = getScoutPrepParentOptions(context);
      if (parentOptions.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: 'No parent contact available',
        });
        return;
      }

      if (parentOptions.length === 1) {
        push(
          <LeavingVoicemailDetail
            task={task}
            context={context}
            parentName={parentOptions[0].name}
          />,
        );
        return;
      }

      push(
        <LeavingVoicemailParentForm task={task} context={context} parentOptions={parentOptions} />,
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

  async function handleCompleteConfirmationTask() {
    const confirmationTask = await resolveConfirmationTask();
    if (!confirmationTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'No confirmation call task found',
      });
      return;
    }

    const athleteMainId = String(task.athlete_main_id || '').trim();
    const contactTask = String(task.contact_id || '').trim();
    if (!athleteMainId || !contactTask) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing task identifiers',
      });
      return;
    }

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
      await showToast({
        style: Toast.Style.Success,
        title: 'Confirmation call completed',
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Failed to complete confirmation call',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <List.Item
      key={`${task.contact_id}-${task.title || 'task'}`}
      icon={Icon.List}
      title={task.athlete_name}
      detail={
        <List.Item.Detail
          markdown={[
            `# ${task.athlete_name}`,
            '',
            `- Task: ${task.title || 'N/A'}`,
            `- Description: ${task.description || 'N/A'}`,
            `- Due Date: ${task.due_date || 'N/A'}`,
          ].join('\n')}
          metadata={
            task.grad_year ? (
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.TagList title="Grad Year">
                  <List.Item.Detail.Metadata.TagList.Item
                    text={task.grad_year}
                    color={Color.Purple}
                  />
                </List.Item.Detail.Metadata.TagList>
              </List.Item.Detail.Metadata>
            ) : undefined
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
          <Action.Push
            title="Post-Call Update"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd'], key: 'u' }}
            target={<PostCallUpdateForm task={task} />}
          />
          <Action
            title="Leaving a Voice Mail"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
            onAction={() => void handleLeavingVoicemail()}
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
            title={isProspectSearchMode ? 'Exit Prospect Search' : 'Prospect Search Mode'}
            icon={Icon.MagnifyingGlass}
            shortcut={{ modifiers: ['cmd'], key: 'f' }}
            onAction={onToggleProspectSearchMode}
          />
          <Action
            title="Reschedule Confirmation Call"
            icon={Icon.Calendar}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
            onAction={() => void handleRescheduleConfirmationTask()}
          />
          <Action
            title="Complete Confirmation Call"
            icon={Icon.CheckCircle}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'k' }}
            onAction={() => void handleCompleteConfirmationTask()}
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

function TrackedFollowUpListItem({
  item,
  onRemove,
  onToggleProspectSearchMode,
  isProspectSearchMode,
}: {
  item: TrackedFollowUpItem;
  onRemove: (item: TrackedFollowUpItem) => Promise<void>;
  onToggleProspectSearchMode: () => void;
  isProspectSearchMode: boolean;
}) {
  const { task, createdTask } = item;

  return (
    <List.Item
      key={`follow-up:${task.contact_id}:${task.athlete_main_id || 'missing-main-id'}`}
      icon={Icon.Repeat}
      title={task.athlete_name}
      subtitle={createdTask.title || 'Follow-Up Task'}
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
                  <List.Item.Detail.Metadata.TagList.Item text={task.grad_year} color={Color.Purple} />
                </List.Item.Detail.Metadata.TagList>
              ) : null}
              <List.Item.Detail.Metadata.Label title="Athlete ID" text={task.contact_id} />
              {task.athlete_main_id ? (
                <List.Item.Detail.Metadata.Label title="Athlete Main ID" text={task.athlete_main_id} />
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
          <Action
            title={isProspectSearchMode ? 'Exit Prospect Search' : 'Prospect Search Mode'}
            icon={Icon.MagnifyingGlass}
            shortcut={{ modifiers: ['cmd'], key: 'f' }}
            onAction={onToggleProspectSearchMode}
          />
        </ActionPanel>
      }
    />
  );
}

function ProspectSearchListItem({
  result,
  onToggleProspectSearchMode,
  isProspectSearchMode,
}: {
  result: ProspectResult;
  onToggleProspectSearchMode: () => void;
  isProspectSearchMode: boolean;
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
          <Action
            title={isProspectSearchMode ? 'Exit Prospect Search' : 'Prospect Search Mode'}
            icon={Icon.MagnifyingGlass}
            shortcut={{ modifiers: ['cmd'], key: 'f' }}
            onAction={onToggleProspectSearchMode}
          />
        </ActionPanel>
      }
    />
  );
}

export default function ScoutPrepCommand() {
  const [tasks, setTasks] = useState<ScoutPortalTask[]>([]);
  const [trackedFollowUps, setTrackedFollowUps] = useState<TrackedFollowUpItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProspectSearchMode, setIsProspectSearchMode] = useState(false);
  const [taskSearchText, setTaskSearchText] = useState('');
  const [prospectSearchText, setProspectSearchText] = useState('');
  const [prospectResults, setProspectResults] = useState<ProspectResult[]>([]);
  const [isProspectSearching, setIsProspectSearching] = useState(false);
  const loadTasksPromiseRef = useRef<Promise<void> | null>(null);
  const initialLoadStartedRef = useRef(false);
  const prospectSearchRequestIdRef = useRef(0);

  const hasProspectSearchText = prospectSearchText.trim().length > 0;
  const isSearchModeActive = isProspectSearchMode;

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

                let followUpTask =
                  !shouldRefresh
                    ? await getCachedScoutPrepFollowUpTask(pointer.athleteId, pointer.athleteMainId)
                    : undefined;

                if (followUpTask === undefined) {
                  const athleteTasks = await fetchAthleteTasks(pointer.athleteId, pointer.athleteMainId);
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
                  assigned_owner: followUpTask.assigned_owner || matchingGlobalTask?.assigned_owner || null,
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
    if (!isProspectSearchMode) {
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
  }, [isProspectSearchMode, prospectSearchText]);

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

  function toggleProspectSearchMode() {
    setIsProspectSearchMode((current) => {
      const next = !current;
      if (next) {
        setTaskSearchText('');
      } else {
        setProspectSearchText('');
        setProspectResults([]);
        setIsProspectSearching(false);
      }
      return next;
    });
  }

  return (
    <List
      isLoading={isLoading || isProspectSearching}
      isShowingDetail={!isSearchModeActive}
      navigationTitle={isSearchModeActive ? 'Scout Prep Search' : 'Scout Prep'}
      filtering={isSearchModeActive ? false : true}
      throttle
      searchBarPlaceholder={
        isSearchModeActive
          ? 'Prospect Search'
          : 'Search Task List'
      }
      searchText={isSearchModeActive ? prospectSearchText : taskSearchText}
      onSearchTextChange={isSearchModeActive ? setProspectSearchText : setTaskSearchText}
    >
      {isSearchModeActive ? (
        <List.Section title={`Prospect Search`} subtitle={String(prospectResults.length)}>
          {prospectResults.length > 0 ? (
            prospectResults.map((result) => (
              <ProspectSearchListItem
                key={`search:${result.athlete_id}:${result.athlete_main_id || result.name || 'result'}`}
                result={result}
                onToggleProspectSearchMode={toggleProspectSearchMode}
                isProspectSearchMode={isSearchModeActive}
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
                    title={isSearchModeActive ? 'Exit Prospect Search' : 'Prospect Search Mode'}
                    icon={Icon.MagnifyingGlass}
                    shortcut={{ modifiers: ['cmd'], key: 'f' }}
                    onAction={toggleProspectSearchMode}
                  />
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
            />
          ))}
        </List.Section>
      ) : tasks.length === 0 && trackedFollowUps.length === 0 ? (
        <List.EmptyView
          title="No scout tasks found"
          description="The landing-page task list is empty."
          actions={
            <ActionPanel>
              <Action
                title={isSearchModeActive ? 'Exit Prospect Search' : 'Prospect Search Mode'}
                icon={Icon.MagnifyingGlass}
                shortcut={{ modifiers: ['cmd'], key: 'f' }}
                onAction={toggleProspectSearchMode}
              />
              <Action title="Reload Scout Tasks" onAction={() => void loadTasks()} />
              <Action
                title="Refresh Follow-Up List"
                onAction={() => void loadTasks({ forceRefreshFollowUps: true })}
              />
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
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
