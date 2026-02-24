import { Action, Tool } from '@raycast/api';
import { apiFetch } from '../lib/python-server-client';
import { resolveAndCacheAthleteMainId } from '../lib/athlete-id-service';
import { upsertTasks } from '../lib/video-progress-cache';
import { searchLogger } from '../lib/logger';

type Input = {
  term: string;
  athleteId?: string;
  action?: 'search' | 'materialize';
  stage?: 'In Queue' | 'Awaiting Client' | 'On Hold' | 'Done';
  status?: '' | 'HUDL' | 'Dropbox' | 'Revisions' | 'Not Approved' | 'External Links';
  includeAdminSearch?: boolean;
};

type ProspectResult = {
  athlete_id: string;
  athlete_main_id?: string;
  name?: string;
  grad_year?: string;
  sport?: string;
  state?: string;
  city?: string;
  high_school?: string;
  email?: string;
  positions?: string;
  source?: string;
  jersey_number?: string;
};

const FEATURE = 'tool.manual-sa-additions';
const ASSIGNED_EDITOR = 'Jerami Singleton';
const MIN_GRAD_YEAR = 2026;

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

async function parseResponse(response: Response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function normalizePositions(positions?: string): string | null {
  if (!positions) return null;
  const withoutPrefix = positions
    .replace(/^Positions?/i, '')
    .replace(/^[:\-\s]+/, '')
    .trim();
  const tokens = withoutPrefix
    .split(/\||,|\/|•/)
    .map((token) => token.replace(/^Positions?/i, '').trim())
    .filter(Boolean);
  return (tokens.length ? tokens.join(' | ') : withoutPrefix) || null;
}

function toSummary(result: ProspectResult): string {
  const location = [result.city, result.state].filter(Boolean).join(', ');
  const parts = [
    `${result.name || 'Unknown'} (athlete_id=${result.athlete_id})`,
    result.grad_year ? `Class ${result.grad_year}` : '',
    result.sport || '',
    normalizePositions(result.positions) || '',
    location || '',
    result.email || '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function formatSearchLine(result: ProspectResult): string {
  const name = result.name || 'Unknown';
  const athleteId = result.athlete_id;
  const grad = result.grad_year ? `Class ${result.grad_year}` : 'Class Unknown';
  const sport = result.sport || 'Unknown Sport';
  const state = result.state || 'Unknown';
  return `• ${name} (${athleteId}) - ${grad} ${sport} from ${state}`;
}

async function fetchRawSearch(
  term: string,
  includeAdminSearch: boolean,
): Promise<ProspectResult[]> {
  logInfo('TOOL_LOOSE_SEARCH', 'raw_search_request', 'start', {
    termPreview: term.slice(0, 120),
    includeAdminSearch,
  });

  const response = await apiFetch('/athlete/raw-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      term,
      email: term.includes('@') ? term : undefined,
      include_admin_search: includeAdminSearch,
      include_recent_search: false,
    }),
  });
  const { json, text } = await parseResponse(response);
  if (!response.ok) {
    const message =
      json?.detail || json?.message || text.slice(0, 300) || `HTTP ${response.status}`;
    logFailure('TOOL_LOOSE_SEARCH', 'raw_search_request', message, { statusCode: response.status });
    throw new Error(message);
  }
  const results: ProspectResult[] = Array.isArray(json?.results) ? json.results : [];
  const filtered = results.filter((r) => {
    const year = parseInt(r.grad_year || '', 10);
    return Number.isNaN(year) || year >= MIN_GRAD_YEAR;
  });
  logInfo('TOOL_LOOSE_SEARCH', 'raw_search_request', 'success', {
    total: results.length,
    kept: filtered.length,
  });
  return filtered;
}

async function resolveDetails(result: ProspectResult): Promise<ProspectResult> {
  logInfo('TOOL_LOOSE_RESOLVE', 'resolve_request', 'start', { athleteId: result.athlete_id });
  const response = await apiFetch(`/athlete/${encodeURIComponent(result.athlete_id)}/resolve`);
  const { json, text } = await parseResponse(response);
  if (!response.ok) {
    const message =
      json?.detail || json?.message || text.slice(0, 300) || `HTTP ${response.status}`;
    logFailure('TOOL_LOOSE_RESOLVE', 'resolve_request', message, {
      athleteId: result.athlete_id,
      statusCode: response.status,
    });
    throw new Error(message);
  }
  const details = (json || {}) as Record<string, unknown>;
  const merged: ProspectResult = {
    ...result,
    athlete_main_id: result.athlete_main_id || String(details.athlete_main_id || ''),
    name: result.name || String(details.name || ''),
    grad_year: result.grad_year || String(details.grad_year || ''),
    sport: result.sport || String(details.sport || ''),
    high_school: result.high_school || String(details.high_school || ''),
    city: result.city || String(details.city || ''),
    state: result.state || String(details.state || ''),
    positions: normalizePositions(result.positions || String(details.positions || '')) || undefined,
    jersey_number: String(details.jersey_number || ''),
  };
  logInfo('TOOL_LOOSE_RESOLVE', 'resolve_request', 'success', {
    athleteId: merged.athlete_id,
    athleteMainId: merged.athlete_main_id || null,
  });
  return merged;
}

function selectCandidate(results: ProspectResult[], athleteId?: string): ProspectResult | null {
  if (!results.length) return null;
  if (athleteId) {
    return results.find((r) => String(r.athlete_id) === String(athleteId)) || null;
  }
  if (results.length === 1) return results[0];
  return null;
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const action = input.action || 'materialize';
  const term = (input.term || '').trim();
  const stageProvided = Object.prototype.hasOwnProperty.call(input, 'stage');
  const statusProvided = Object.prototype.hasOwnProperty.call(input, 'status');
  const stage = input.stage || 'In Queue';
  const status = input.status || '';
  const includeAdminSearch = input.includeAdminSearch ?? true;

  logInfo('TOOL_LOOSE_CONFIRMATION', 'confirmation', 'start', {
    action,
    termPreview: term.slice(0, 120),
    athleteId: input.athleteId || null,
  });

  try {
    if (!term) {
      const message = 'Missing term; cannot run ingest';
      logFailure('TOOL_LOOSE_CONFIRMATION', 'confirmation', message);
      return {
        style: Action.Style.Destructive,
        message,
      };
    }

    if (action === 'search') {
      logInfo('TOOL_LOOSE_CONFIRMATION', 'confirmation', 'success', { action });
      return {
        message: `Run loose-athlete search for "${term}"?`,
        info: [
          { name: 'Action', value: 'Search' },
          { name: 'Term', value: term.slice(0, 140) },
        ],
      };
    }

    const results = await fetchRawSearch(term, includeAdminSearch);
    const candidate = selectCandidate(results, input.athleteId);
    const candidateLabel = candidate
      ? `${candidate.name || 'Unknown'} (${candidate.athlete_id})`
      : 'Multiple candidates found (provide athleteId)';

    logInfo('TOOL_LOOSE_CONFIRMATION', 'confirmation', 'success', {
      action,
      count: results.length,
      candidate: candidate?.athlete_id || null,
    });

    return {
      style:
        candidate && stageProvided && statusProvided
          ? Action.Style.Regular
          : Action.Style.Destructive,
      message: !candidate
        ? `Multiple athletes matched. Confirm only if you're passing athleteId.`
        : !stageProvided || !statusProvided
          ? `Athlete confirmed. Next step: provide explicit stage + status, then re-run materialize.`
          : `Materialize this athlete into Video Progress?`,
      info: [
        { name: 'Action', value: 'Materialize' },
        { name: 'Term', value: term.slice(0, 140) },
        {
          name: 'Selected Athlete',
          value: candidate ? candidate.name || 'Unknown' : candidateLabel,
        },
        {
          name: 'Athlete ID',
          value: candidate ? candidate.athlete_id : input.athleteId || 'Not provided',
        },
        { name: 'Stage', value: stageProvided ? stage : 'Not provided' },
        { name: 'Status', value: statusProvided ? status || 'Blank' : 'Not provided' },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('TOOL_LOOSE_CONFIRMATION', 'confirmation', message, {
      action,
      termPreview: term.slice(0, 120),
    });
    return {
      style: Action.Style.Destructive,
      message: `Confirmation lookup failed: ${message}`,
    };
  }
};

export default async function tool(input: Input): Promise<string> {
  const term = (input.term || '').trim();
  const action = input.action || 'search';
  const stageProvided = Object.prototype.hasOwnProperty.call(input, 'stage');
  const statusProvided = Object.prototype.hasOwnProperty.call(input, 'status');
  const stage = input.stage || 'In Queue';
  const status = input.status || '';
  const includeAdminSearch = input.includeAdminSearch ?? true;

  if (!term) {
    return JSON.stringify({ success: false, error: 'term is required' });
  }

  logInfo('TOOL_LOOSE_INGEST', 'execute', 'start', {
    termPreview: term.slice(0, 120),
    action,
    athleteId: input.athleteId || null,
  });

  try {
    const results = await fetchRawSearch(term, includeAdminSearch);
    if (action === 'search') {
      const top = results.slice(0, 15);
      const payload = {
        success: true,
        action: 'search',
        lines: top.map((r) => formatSearchLine(r)),
      };
      logInfo('TOOL_LOOSE_INGEST', 'execute', 'success', {
        action: 'search',
        count: results.length,
      });
      return JSON.stringify(payload, null, 2);
    }

    const candidate = selectCandidate(results, input.athleteId);
    if (!candidate) {
      const disambiguation = {
        success: false,
        error: input.athleteId
          ? `No result found for athlete_id=${input.athleteId}`
          : 'Multiple athletes found; provide athleteId',
        action: 'materialize',
        count: results.length,
        candidates: results.slice(0, 10).map((r) => ({
          athlete_id: r.athlete_id,
          name: r.name || null,
          grad_year: r.grad_year || null,
          sport: r.sport || null,
          summary: toSummary(r),
        })),
      };
      logFailure('TOOL_LOOSE_INGEST', 'select_candidate', disambiguation.error, {
        count: results.length,
        athleteId: input.athleteId || null,
      });
      return JSON.stringify(disambiguation, null, 2);
    }

    if (!stageProvided || !statusProvided) {
      const message = 'Selected athlete confirmed; provide explicit stage and status to continue';
      logFailure('TOOL_LOOSE_INGEST', 'validate_materialize_inputs', message, {
        athleteId: candidate.athlete_id,
        athleteName: candidate.name || null,
        hasStage: stageProvided,
        hasStatus: statusProvided,
      });
      return JSON.stringify(
        {
          success: false,
          action: 'materialize',
          error: message,
          next_step: 'set_stage_and_status',
          selected_athlete: {
            athlete_id: candidate.athlete_id,
            name: candidate.name || null,
            summary: toSummary(candidate),
          },
          required: ['athleteId', 'stage', 'status'],
          stageOptions: ['In Queue', 'Awaiting Client', 'On Hold', 'Done'],
          statusOptions: ['', 'HUDL', 'Dropbox', 'Revisions', 'Not Approved', 'External Links'],
        },
        null,
        2,
      );
    }

    const enriched = await resolveDetails(candidate);
    let athleteMainId = (enriched.athlete_main_id || '').trim();
    if (!athleteMainId) {
      const resolved = await resolveAndCacheAthleteMainId(enriched.athlete_id);
      if (!resolved || resolved.source === 'fallback') {
        const message = 'Unable to resolve athlete_main_id';
        logFailure('TOOL_LOOSE_INGEST', 'resolve_main_id', message, {
          athleteId: enriched.athlete_id,
        });
        return JSON.stringify({ success: false, error: message });
      }
      athleteMainId = resolved.athleteMainId;
    }

    logInfo('TOOL_LOOSE_MATERIALIZE', 'materialize_request', 'start', {
      athleteId: enriched.athlete_id,
      athleteMainId,
      stage,
      statusValue: status,
    });

    const response = await apiFetch('/video/materialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: enriched.athlete_id,
        athlete_main_id: athleteMainId,
        athlete_name: enriched.name,
        sport_name: enriched.sport,
        grad_year: enriched.grad_year,
        high_school: enriched.high_school,
        city: enriched.city,
        state: enriched.state,
        positions: normalizePositions(enriched.positions),
        jersey_number: enriched.jersey_number,
        assigned_editor: ASSIGNED_EDITOR,
        stage,
        status,
        source: 'raycast:tool_loose_ingest',
      }),
    });

    const { json, text } = await parseResponse(response);
    if (!response.ok) {
      const message =
        json?.detail || json?.message || text.slice(0, 300) || `HTTP ${response.status}`;
      logFailure('TOOL_LOOSE_MATERIALIZE', 'materialize_request', message, {
        athleteId: enriched.athlete_id,
        statusCode: response.status,
      });
      return JSON.stringify({ success: false, error: message });
    }

    const task = json?.task;
    if (!task) {
      const message = 'Materialize response missing task';
      logFailure('TOOL_LOOSE_MATERIALIZE', 'materialize_request', message, {
        athleteId: enriched.athlete_id,
      });
      return JSON.stringify({ success: false, error: message });
    }

    await upsertTasks([task]);
    logInfo('TOOL_LOOSE_MATERIALIZE', 'materialize_upsert', 'success', {
      athleteId: enriched.athlete_id,
      taskId: task.id || null,
      existed: !!json?.existed,
    });
    logInfo('TOOL_LOOSE_INGEST', 'execute', 'success', {
      action: 'materialize',
      athleteId: enriched.athlete_id,
      taskId: task.id || null,
    });

    return JSON.stringify(
      {
        success: true,
        action: 'materialize',
        existed: !!json?.existed,
        athlete: {
          athlete_id: enriched.athlete_id,
          athlete_main_id: athleteMainId,
          name: enriched.name || null,
          positions: normalizePositions(enriched.positions),
        },
        task: {
          id: task.id || null,
          stage: task.stage || stage,
          status: task.video_progress_status || status,
          assignedvideoeditor: task.assignedvideoeditor || ASSIGNED_EDITOR,
        },
      },
      null,
      2,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logFailure('TOOL_LOOSE_INGEST', 'execute', message, {
      action,
      athleteId: input.athleteId || null,
    });
    return JSON.stringify({ success: false, error: message });
  }
}
