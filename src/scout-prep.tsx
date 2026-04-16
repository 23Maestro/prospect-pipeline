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
import { useEffect, useRef, useState } from 'react';
import { AthleteNotesList, AddAthleteNoteForm } from './components/athlete-notes';
import { buildScoutPrepMarkdown } from './features/scout-prep/content';
import type {
  MeetingSetTemplateResponse,
  SalesStageOption,
  ScoutPortalTask,
  ScoutPrepContext,
  ScoutPrepFormValues,
} from './features/scout-prep/types';
import {
  buildMeetingTemplateDefaults,
  buildMessagesComposeUrl,
  buildScoutPrepLeavingVoicemailBody,
  buildVoicemailFollowUpBody,
  selectScoutPrepContactNumbers,
} from './lib/scout-prep-contact';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepMetadata,
  buildScoutPrepValues,
  completeScoutPrepTaskAfterVoicemail,
  fetchScoutPortalTasks,
  loadScoutPrepContext,
} from './lib/scout-prep';
import { syncCallScriptToggleToNotion } from './lib/notion-call-scripts';
import { generateScoutPrepLocalEnrichment } from './lib/scout-prep-ai';
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
  const lines = [
    '# Contact Information',
    '',
    `## ${contactInfo.studentAthlete.name || context.task.athlete_name}`,
    `Phone: ${contactInfo.studentAthlete.phone || 'N/A'}`,
    '',
  ];

  if (contactInfo.parent1) {
    lines.push(
      `## ${contactInfo.parent1.name} (${contactInfo.parent1.relationship})`,
      `Phone: ${contactInfo.parent1.phone || 'N/A'}`,
      '',
    );
  }

  if (contactInfo.parent2) {
    lines.push(
      `## ${contactInfo.parent2.name} (${contactInfo.parent2.relationship})`,
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
                shortcut={{ modifiers: ['cmd'], key: 'enter' }}
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
                  shortcut={{ modifiers: ['cmd', 'shift'], key: 'enter' }}
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

  lines.push(
    '',
    '> Official sales stage saved. Meeting Set detail save is still separate until that legacy POST is captured.',
  );

  return lines.join('\n');
}

function PostCallUpdatePreview({
  task,
  values,
}: {
  task: ScoutPortalTask;
  values: Record<string, string | undefined>;
}) {
  return (
    <Detail
      navigationTitle={`Post-Call Update • ${task.athlete_name}`}
      markdown={buildPostCallPreviewMarkdown(task, values)}
    />
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
      const athleteId = String(task.contact_id || context?.task.contact_id || '').trim();

      if (!athleteMainId || !athleteId) {
        throw new Error('Missing athlete_main_id or athlete_id for sales stage update');
      }

      await updateSalesStage({
        athleteMainId,
        athleteId,
        stage: stageLabel,
      });

      let taskCompletionMessage: string | null = null;
      if (stageLabel === LEFT_VOICE_MAIL_1_LABEL) {
        const result = await completeScoutPrepTaskAfterVoicemail({
          athleteId,
          athleteMainId,
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

      push(
        <PostCallUpdatePreview
          task={task}
          values={{
            ...values,
            officialStage: stageLabel,
          }}
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
  const [metadata, setMetadata] = useState<JSX.Element | undefined>(undefined);
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

  async function handleCopyMarkdownData() {
    await Clipboard.copy(formatScoutPrepMarkdownForClipboard(markdown));
    await showToast({
      style: Toast.Style.Success,
      title: 'Copied scout prep',
      message: 'Clean text copied to clipboard.',
    });
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

        void generateScoutPrepLocalEnrichment(values, context).then((enrichment) => {
          if (!active || !enrichment) {
            return;
          }
          setMarkdown(buildScoutPrepDetailMarkdown(values, context, enrichment));
          logInfo('SCOUT_PREP_DETAIL_LOAD', 'apply-local-enrichment', 'success', {
            contactId: task.contact_id,
            athleteMainId: task.athlete_main_id || null,
            athleteName: values.athleteName,
          });
        });
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
            shortcut={{ modifiers: ['cmd'], key: 'enter' }}
            onAction={() => void handleVoicemailFollowUp()}
          />
          <Action
            title="Leaving a Voice Mail"
            icon={Icon.Phone}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
            onAction={() => void handleLeavingVoicemail()}
          />
          <Action
            title="Copy Scout Prep Data"
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'd' }}
            onAction={() => void handleCopyMarkdownData()}
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
            title="Manual Scout Prep"
            icon={Icon.Wand}
            target={<ManualScoutPrepForm />}
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

function ScoutPrepTaskItem({ task }: { task: ScoutPortalTask }) {
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
            title="Manual Scout Prep"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
            target={<ManualScoutPrepForm />}
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

export default function ScoutPrepCommand() {
  const [tasks, setTasks] = useState<ScoutPortalTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadTasksPromiseRef = useRef<Promise<void> | null>(null);
  const initialLoadStartedRef = useRef(false);

  const loadTasks = async () => {
    if (loadTasksPromiseRef.current) {
      logInfo('SCOUT_PREP_TASK_LIST', 'reuse-inflight-load', 'start');
      return loadTasksPromiseRef.current;
    }

    const pendingLoad = (async () => {
      setIsLoading(true);
      try {
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'start');
        const data = await fetchScoutPortalTasks();
        const bottomUpTasks = [...data].reverse();
        setTasks(bottomUpTasks);
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'success', {
          count: bottomUpTasks.length,
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

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      navigationTitle="Scout Prep"
      searchBarPlaceholder="Filter scout tasks..."
      actions={
        <ActionPanel>
          <Action.Push
            title="Manual Scout Prep"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
            target={<ManualScoutPrepForm />}
          />
          <Action
            title="Reload Scout Tasks"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ['cmd'], key: 'r' }}
            onAction={() => void loadTasks()}
          />
        </ActionPanel>
      }
    >
      {tasks.length === 0 ? (
        <List.EmptyView
          title="No scout tasks found"
          description="The landing-page task list is empty."
          actions={
            <ActionPanel>
              <Action.Push title="Manual Scout Prep" target={<ManualScoutPrepForm />} />
              <Action title="Reload Scout Tasks" onAction={() => void loadTasks()} />
            </ActionPanel>
          }
        />
      ) : (
        tasks.map((task) => (
          <ScoutPrepTaskItem key={`${task.contact_id}-${task.title || 'task'}`} task={task} />
        ))
      )}
    </List>
  );
}
