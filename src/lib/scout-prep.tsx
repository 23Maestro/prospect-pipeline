import { Color, Detail } from '@raycast/api';
import { apiFetch, apiRootFetch } from './fastapi-client';
import { fetchAthleteNotes, fetchContactInfo } from './npid-mcp-adapter';
import { buildScoutPrepCard } from '../features/scout-prep/content';
import { buildScoutPrepFallbackOutput } from './scout-prep-ai';
import type {
  ScoutPrepFormValues,
  ScoutPrepGrade,
  ScoutPortalTask,
  ScoutPrepContext,
} from '../features/scout-prep/types';
import type { AthleteTaskSummary } from '../types/athlete-workflows';
import { searchLogger } from './logger';

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

export async function fetchScoutPortalTasks(): Promise<ScoutPortalTask[]> {
  logInfo('SCOUT_PREP_TASKS_FETCH', 'request', 'start');
  const response = await apiFetch('/scout/tasks');
  if (!response.ok) {
    let message = `Failed to fetch scout tasks: ${response.status}`;
    if (response.status === 404) {
      try {
        const openapiResponse = await apiRootFetch('/openapi.json');
        const spec = (await openapiResponse.json()) as { paths?: Record<string, unknown> };
        const hasScoutRoute = Object.prototype.hasOwnProperty.call(
          spec.paths || {},
          '/api/v1/scout/tasks',
        );
        if (!hasScoutRoute) {
          message =
            'Scout route missing from FastAPI server. The server is stale and needs restart.';
        }
      } catch {
        message =
          'Scout route returned 404. The FastAPI server may be stale or not exposing /api/v1/scout/tasks.';
      }
    }
    logFailure('SCOUT_PREP_TASKS_FETCH', 'request', message, {
      statusCode: response.status,
    });
    throw new Error(message);
  }
  const data = (await response.json()) as { tasks?: ScoutPortalTask[] };
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  logInfo('SCOUT_PREP_TASKS_FETCH', 'parse', 'success', {
    count: tasks.length,
  });
  return tasks;
}

export async function fetchAthleteTasks(
  athleteId: string,
  athleteMainId: string,
): Promise<AthleteTaskSummary[]> {
  logInfo('SCOUT_PREP_ATHLETE_TASKS_FETCH', 'request', 'start', {
    athleteId,
    athleteMainId,
  });
  const response = await apiFetch('/tasks/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: String(athleteId),
      athlete_main_id: String(athleteMainId),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Tasks HTTP ${response.status}`;
    logFailure('SCOUT_PREP_ATHLETE_TASKS_FETCH', 'request', message, {
      athleteId,
      athleteMainId,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json().catch(() => ({}))) as { tasks?: AthleteTaskSummary[] };
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  logInfo('SCOUT_PREP_ATHLETE_TASKS_FETCH', 'parse', 'success', {
    athleteId,
    athleteMainId,
    count: tasks.length,
  });
  return tasks;
}

export function resolveGradeLabel(gradYear?: string | null): ScoutPrepGrade {
  const parsed = parseInt(String(gradYear || '').trim(), 10);
  if (Number.isNaN(parsed)) {
    return 'Junior';
  }

  const now = new Date();
  const graduatingClass = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  const offset = parsed - graduatingClass;

  if (offset <= 0) return 'Senior';
  if (offset === 1) return 'Junior';
  if (offset === 2) return 'Sophomore';
  return 'Freshman';
}

export function buildScoutPrepValues(args: {
  athleteName: string;
  parent1Name?: string | null;
  parent2Name?: string | null;
  gradYear?: string | null;
  sport?: string | null;
}): ScoutPrepFormValues {
  return {
    athleteName: args.athleteName,
    parent1Name: args.parent1Name?.trim() || 'Parent 1',
    parent2Name: args.parent2Name?.trim() || undefined,
    gradYear: resolveGradeLabel(args.gradYear),
    sport: args.sport?.trim() || 'Sport',
  };
}

export async function loadScoutPrepContext(task: ScoutPortalTask): Promise<ScoutPrepContext> {
  const athleteId = String(task.athlete_id || task.contact_id);
  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', 'start', {
    contactId: task.contact_id,
    athleteId,
    athleteMainIdHint: task.athlete_main_id || null,
  });
  const resolvedResponse = await apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve`);
  if (!resolvedResponse.ok) {
    const errorText = await resolvedResponse.text();
    const message = errorText.slice(0, 200) || `Resolve HTTP ${resolvedResponse.status}`;
    logFailure('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', message, {
      contactId: task.contact_id,
      athleteId,
      statusCode: resolvedResponse.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const resolved = (await resolvedResponse.json().catch(() => ({}))) as {
    athlete_main_id?: string;
    sport?: string | null;
    high_school?: string | null;
    city?: string | null;
    state?: string | null;
    positions?: string | null;
    gpa?: string | null;
    height?: string | null;
    weight?: string | null;
  };
  const athleteMainId = String(task.athlete_main_id || resolved.athlete_main_id || '').trim();

  if (!athleteMainId) {
    const message = 'Missing athlete_main_id for scout prep task';
    logFailure('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', message, {
      contactId: task.contact_id,
      athleteId,
    });
    throw new Error(message);
  }

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'resolve-athlete', 'success', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
    resolverFields: {
      hasSport: Boolean(String(resolved.sport || '').trim()),
      hasHighSchool: Boolean(String(resolved.high_school || '').trim()),
      hasCity: Boolean(String(resolved.city || '').trim()),
      hasState: Boolean(String(resolved.state || '').trim()),
      hasPositions: Boolean(String(resolved.positions || '').trim()),
      hasGpa: Boolean(String(resolved.gpa || '').trim()),
      hasHeight: Boolean(String(resolved.height || '').trim()),
      hasWeight: Boolean(String(resolved.weight || '').trim()),
    },
  });

  if (!resolved.state && !resolved.city && !resolved.high_school) {
    logFailure(
      'SCOUT_PREP_CONTEXT_LOAD',
      'resolve-athlete',
      'Resolver missing state, city, and high_school for rapport context',
      {
        contactId: task.contact_id,
        athleteId,
        athleteMainId,
      },
    );
  }

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'hydrate-context', 'start', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
  });
  const [contactInfo, notes, tasks] = await Promise.all([
    fetchContactInfo(String(task.contact_id), athleteMainId),
    fetchAthleteNotes(athleteId, athleteMainId),
    fetchAthleteTasks(athleteId, athleteMainId),
  ]);

  logInfo('SCOUT_PREP_CONTEXT_LOAD', 'hydrate-context', 'success', {
    contactId: task.contact_id,
    athleteId,
    athleteMainId,
    notesCount: notes.length,
    tasksCount: tasks.length,
    hasParent1: Boolean(contactInfo.parent1),
    hasParent2: Boolean(contactInfo.parent2),
  });

  if (!contactInfo.parent1) {
    logFailure(
      'SCOUT_PREP_CONTEXT_LOAD',
      'hydrate-context',
      'Primary parent contact missing for scout prep reminders',
      {
        contactId: task.contact_id,
        athleteId,
        athleteMainId,
      },
    );
  }

  return {
    task,
    resolved,
    contactInfo,
    notes,
    tasks,
  };
}

export function buildScoutPrepDetailMarkdown(
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
): string {
  try {
    const card = buildScoutPrepCard(values, context, buildScoutPrepFallbackOutput(values, context));
    logInfo('SCOUT_PREP_CARD_BUILD', 'assemble-card', 'success', {
      anchorCount: card.diagnostics.anchorCount,
      snapshotFieldCount: card.diagnostics.snapshotFieldCount,
      chosenDeficitGrade: card.diagnostics.deficitGrade,
      rapportSource: card.diagnostics.rapportSource,
      hasLocalTime: card.diagnostics.hasLocalTime,
      hasMascotCue: card.diagnostics.hasMascotCue,
      rapportInputs: {
        hasState: card.diagnostics.hasState,
        hasCity: card.diagnostics.hasCity,
        hasSchool: card.diagnostics.hasSchool,
        hasSport: card.diagnostics.hasSport,
        hasParent1: card.diagnostics.hasParent1,
      },
    });
    return card.markdown;
  } catch (error) {
    logFailure(
      'SCOUT_PREP_CARD_BUILD',
      'assemble-card',
      error instanceof Error ? error.message : String(error),
      {
        athleteName: values.athleteName,
        contactId: context.task.contact_id,
      },
    );
    throw error;
  }
}

export function buildScoutPrepMetadata(values: ScoutPrepFormValues, context: ScoutPrepContext) {
  const { task, resolved } = context;

  return (
    <Detail.Metadata>
      <Detail.Metadata.TagList title="Student Athlete">
        <Detail.Metadata.TagList.Item text={values.athleteName} color={Color.Blue} />
      </Detail.Metadata.TagList>
      <Detail.Metadata.TagList title="Parent 1">
        <Detail.Metadata.TagList.Item text={values.parent1Name} color={Color.Green} />
      </Detail.Metadata.TagList>
      {values.parent2Name ? (
        <Detail.Metadata.TagList title="Parent 2">
          <Detail.Metadata.TagList.Item text={values.parent2Name} color={Color.Magenta} />
        </Detail.Metadata.TagList>
      ) : null}
      <Detail.Metadata.TagList title="Sport">
        <Detail.Metadata.TagList.Item text={values.sport} color={Color.Orange} />
      </Detail.Metadata.TagList>
      <Detail.Metadata.TagList title="Grade">
        <Detail.Metadata.TagList.Item text={values.gradYear} color={Color.Purple} />
      </Detail.Metadata.TagList>
      {resolved.high_school ? (
        <Detail.Metadata.TagList title="School">
          <Detail.Metadata.TagList.Item text={resolved.high_school} color={Color.Red} />
        </Detail.Metadata.TagList>
      ) : null}
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Task" text={task.title || 'N/A'} />
      <Detail.Metadata.Label title="Description" text={task.description || 'N/A'} />
      <Detail.Metadata.Label title="Due Date" text={task.due_date || 'N/A'} />
    </Detail.Metadata>
  );
}
