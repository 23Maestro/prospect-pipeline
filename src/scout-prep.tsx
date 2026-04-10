import { Action, ActionPanel, Color, Detail, Form, Icon, List, Toast, showToast, useNavigation } from '@raycast/api';
import { useEffect, useRef, useState } from 'react';
import { buildScoutPrepMarkdown } from './features/scout-prep/content';
import type { ScoutPortalTask, ScoutPrepFormValues } from './features/scout-prep/types';
import {
  buildScoutPrepDetailMarkdown,
  buildScoutPrepMetadata,
  buildScoutPrepValues,
  fetchScoutPortalTasks,
  loadScoutPrepContext,
} from './lib/scout-prep';
import { searchLogger } from './lib/logger';

const FEATURE = 'scout-prep';

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
