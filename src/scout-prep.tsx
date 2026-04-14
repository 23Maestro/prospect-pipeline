import { Action, ActionPanel, Color, Detail, Form, Icon, List, Toast, showToast, useNavigation } from '@raycast/api';
import { useEffect, useRef, useState } from 'react';
import { buildScoutPrepMarkdown } from './features/scout-prep/content';
import type {
  MeetingSetTemplateResponse,
  SalesStageOption,
  ScoutPortalTask,
  ScoutPrepFormValues,
} from './features/scout-prep/types';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepMetadata,
  buildScoutPrepValues,
  fetchScoutPortalTasks,
  loadScoutPrepContext,
} from './lib/scout-prep';
import { generateScoutPrepLocalEnrichment } from './lib/scout-prep-ai';
import { fetchCuratedSalesStageOptions, fetchMeetingSetTemplate } from './lib/sales-stage';
import { searchLogger } from './lib/logger';

const FEATURE = 'scout-prep';
const MEETING_SET_LABEL = 'Meeting Set';

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

function buildPostCallPreviewMarkdown(task: ScoutPortalTask, values: Record<string, string | undefined>): string {
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
    '> Save path is intentionally blocked until the real legacy POST capture is available.',
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
        setSelectedStage(options.find((option) => option.selected)?.value || options[0]?.value || '');
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

  const selectedStageLabel = stageOptions.find((option) => option.value === selectedStage)?.label || selectedStage;

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
        const template = await fetchMeetingSetTemplate(task);
        if (!active) {
          return;
        }
        setMeetingTemplate(template);
        logInfo('SCOUT_PREP_SALES_STAGE', 'load-meeting-template', 'success', {
          contactId: task.contact_id,
          athleteMainId: task.athlete_main_id || null,
          timezoneCount: template.recruit_timezone_options.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!active) {
          return;
        }
        setMeetingTemplate({
          success: true,
          meeting_name: `${task.athlete_name} ${task.grad_year || ''}`.trim(),
          selected_recruit_timezone: 'EST',
          recruit_timezone_options: ['AST', 'EST', 'CST', 'MST', 'PST', 'AKST', 'HST'].map((zone) => ({
            value: zone,
            label: zone,
            selected: zone === 'EST',
          })),
          details_template: buildFallbackMeetingDetails(),
        });
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
  const canRenderStageFields = !isLoadingStages && stageOptions.length > 0 && Boolean(selectedStage);

  return (
    <Form
      isLoading={isLoadingStages}
      navigationTitle={`Post-Call Update • ${task.athlete_name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Preview Post-Call Update"
            onSubmit={(values) => {
              const submittedValues = values as Record<string, string | undefined>;
              const stageValue = submittedValues.officialStage || '';
              const stageLabel = stageOptions.find((option) => option.value === stageValue)?.label || stageValue;
              push(
                <PostCallUpdatePreview
                  task={task}
                  values={{
                    ...submittedValues,
                    officialStage: stageLabel,
                  }}
                />,
              );
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        text={`Official sales stage stays primary. Save is blocked until we capture the live legacy POST.`}
      />
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
                  meetingTemplate?.recruit_timezone_options.find((option) => option.selected)?.value ||
                  'EST'
                }
              >
                {(meetingTemplate?.recruit_timezone_options || []).map((option) => (
                  <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
                ))}
              </Form.Dropdown>
              <Form.Dropdown id="rapportRating" title="Rapport Rating">
                {RATING_OPTIONS.map((option) => (
                  <Form.Dropdown.Item key={option.value} value={option.value} title={option.title} />
                ))}
              </Form.Dropdown>
              <Form.Dropdown id="urgencyRating" title="Urgency Rating">
                {RATING_OPTIONS.map((option) => (
                  <Form.Dropdown.Item key={option.value} value={option.value} title={option.title} />
                ))}
              </Form.Dropdown>
              <Form.Dropdown id="closeRating" title="Close Rating">
                {RATING_OPTIONS.map((option) => (
                  <Form.Dropdown.Item key={option.value} value={option.value} title={option.title} />
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
  const [markdown, setMarkdown] = useState<string>('Loading scout prep...');
  const [metadata, setMetadata] = useState<JSX.Element | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

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
          <Action.Push title="Post-Call Update" icon={Icon.Pencil} target={<PostCallUpdateForm task={task} />} />
          <Action.Push title="Manual Scout Prep" icon={Icon.Wand} target={<ManualScoutPrepForm />} />
          {task.athlete_admin_url ? <Action.OpenInBrowser title="Open Athlete Admin Page" url={task.athlete_admin_url} /> : null}
          {task.athlete_task_url ? <Action.OpenInBrowser title="Open Athlete Task Tab" url={task.athlete_task_url} /> : null}
        </ActionPanel>
      }
    />
  );
}

function ScoutPrepTaskItem({ task }: { task: ScoutPortalTask }) {
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
            shortcut={{ modifiers: ['cmd'], key: 'enter' }}
            target={<ScoutPrepDetail task={task} />}
          />
          <Action.Push
            title="Post-Call Update"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd'], key: 'u' }}
            target={<PostCallUpdateForm task={task} />}
          />
          <Action.Push
            title="Manual Scout Prep"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'n' }}
            target={<ManualScoutPrepForm />}
          />
          {task.athlete_admin_url ? (
            <Action.OpenInBrowser
              title="Open Athlete Admin Page"
              shortcut={{ modifiers: ['cmd'], key: 'o' }}
              url={task.athlete_admin_url}
            />
          ) : null}
          {task.athlete_task_url ? (
            <Action.OpenInBrowser
              title="Open Athlete Task Tab"
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'o' }}
              url={task.athlete_task_url}
            />
          ) : null}
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
        setTasks(data);
        logInfo('SCOUT_PREP_TASK_LIST', 'load-list', 'success', {
          count: data.length,
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
