import { Action, ActionPanel, Detail, Form, Icon, List, Toast, showToast } from '@raycast/api';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './lib/fastapi-client';
import { ReconnectProspectIdAction } from './components/reconnect-prospect-id-action';
import { upsertTasks } from './lib/video-progress-cache';
import { resolveAndCacheAthleteMainId } from './lib/athlete-id-service';
import { logger, searchLogger } from './lib/logger';

interface ProspectResult {
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
}

interface ProspectSearchResponse {
  success: boolean;
  count: number;
  results: ProspectResult[];
  sources?: Array<Record<string, any>>;
}

const ASSIGNED_EDITOR = 'Jerami Singleton';
const STAGE_OPTIONS = ['In Queue', 'Awaiting Client', 'On Hold', 'Done'];
const STATUS_OPTIONS = ['', 'HUDL', 'Dropbox', 'Revisions', 'Not Approved', 'External Links'];
const MIN_GRAD_YEAR = 2026;

function formatLocation(result: ProspectResult): string {
  const parts = [result.city, result.state].filter(Boolean);
  return parts.join(', ');
}

function cleanPositions(positions?: string): string | null {
  if (!positions) return null;
  // Remove leading "Positions" prefix and normalize separators to " | "
  const withoutPrefix = positions
    .replace(/^Positions?/i, '')
    .replace(/^[:\-\s]+/, '')
    .trim();
  const tokens = withoutPrefix
    .split(/\||,|\/|•/)
    .map((token) => token.replace(/^Positions?/i, '').trim())
    .filter(Boolean);
  const cleaned = tokens.length ? tokens.join(' | ') : withoutPrefix;
  return cleaned || null;
}

function normalizePositionsWithLogging(rawPositions?: string, athleteId?: string): string | null {
  const feature = 'prospect-search.positions-normalization';
  searchLogger.info('PROSPECT_POSITIONS_NORMALIZE', {
    event: 'PROSPECT_POSITIONS_NORMALIZE',
    step: 'normalize_positions',
    status: 'start',
    feature,
    context: {
      athleteId: athleteId || null,
      hasPositions: !!rawPositions,
      rawPreview: rawPositions ? String(rawPositions).slice(0, 120) : null,
    },
  });

  try {
    const normalized = cleanPositions(rawPositions);
    searchLogger.info('PROSPECT_POSITIONS_NORMALIZE', {
      event: 'PROSPECT_POSITIONS_NORMALIZE',
      step: 'normalize_positions',
      status: 'success',
      feature,
      context: {
        athleteId: athleteId || null,
        normalizedPreview: normalized ? normalized.slice(0, 120) : null,
      },
    });
    return normalized;
  } catch (error) {
    searchLogger.error('PROSPECT_POSITIONS_NORMALIZE', {
      event: 'PROSPECT_POSITIONS_NORMALIZE',
      step: 'normalize_positions',
      status: 'failure',
      feature,
      error: error instanceof Error ? error.message : String(error),
      context: {
        athleteId: athleteId || null,
      },
    });
    return cleanPositions(rawPositions);
  }
}

function buildProspectMarkdown(result: ProspectResult): string {
  const location = formatLocation(result) || 'N/A';
  const positions = cleanPositions(result.positions) || 'N/A';
  const jersey = result.jersey_number || '—';

  return `# ${result.name || `Athlete ${result.athlete_id}`}

| Field | Value |
|-------|-------|
| Athlete ID | ${result.athlete_id || 'N/A'} |
| Main ID | ${result.athlete_main_id || 'N/A'} |
| Grad Year | ${result.grad_year || 'N/A'} |
| Sport | ${result.sport || 'N/A'} |
| High School | ${result.high_school || 'N/A'} |
| Location | ${location} |
| Email | ${result.email || 'N/A'} |
| Positions | ${positions} |
| Jersey # | ${jersey} |
`;
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function fetchAthleteResolve(athleteId: string, gradYear?: string) {
  logger.info('Prospect resolve request', { athlete_id: athleteId, grad_year: gradYear || null });
  const params = gradYear ? `?grad_year=${encodeURIComponent(gradYear)}` : '';
  const response = await apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve${params}`);
  const { json, text } = await parseJsonResponse(response);
  if (!response.ok) {
    const errMessage =
      json?.detail || json?.message || text.slice(0, 200) || `HTTP ${response.status}`;
    throw new Error(errMessage);
  }
  const details = json as Record<string, any>;
  logger.info('Prospect resolve response', {
    athlete_id: details?.athlete_id || athleteId,
    athlete_main_id: details?.athlete_main_id,
    name: details?.name,
    grad_year: details?.grad_year,
    sport: details?.sport,
    high_school: details?.high_school,
    city: details?.city,
    state: details?.state,
    positions: details?.positions,
  });
  return details;
}

async function ensureProspectDetails(result: ProspectResult): Promise<ProspectResult> {
  const details = await fetchAthleteResolve(result.athlete_id, result.grad_year);
  const mergedPositions = result.positions || details.positions;
  const normalizedPositions = normalizePositionsWithLogging(mergedPositions, result.athlete_id);
  return {
    ...result,
    athlete_main_id: result.athlete_main_id || details.athlete_main_id,
    name: result.name || details.name,
    grad_year: result.grad_year || details.grad_year,
    sport: result.sport || details.sport,
    high_school: result.high_school || details.high_school,
    city: result.city || details.city,
    state: result.state || details.state,
    positions: normalizedPositions || mergedPositions,
    jersey_number: details.jersey_number,
  };
}

type MaterializePayload = {
  stage: string;
  status: string;
};

function ProspectDetail({
  result,
  onMaterialize,
}: {
  result: ProspectResult;
  onMaterialize: (payload: MaterializePayload) => void;
}) {
  const [markdown, setMarkdown] = useState(buildProspectMarkdown(result));
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isActive = true;
    const loadDetails = async () => {
      try {
        setIsLoading(true);
        const enriched = await ensureProspectDetails(result);
        if (!isActive) return;
        setMarkdown(buildProspectMarkdown(enriched));
      } catch (error) {
        if (!isActive) return;
        logger.error('Prospect detail fetch failed', {
          athlete_id: result.athlete_id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };
    void loadDetails();
    return () => {
      isActive = false;
    };
  }, [result]);

  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.Push
            title="Materialize Task"
            icon={Icon.Plus}
            target={<MaterializeTaskForm result={result} onSubmit={onMaterialize} />}
          />
          <Action.OpenInBrowser
            title="Open Prospect Profile"
            icon={Icon.Globe}
            url={`https://dashboard.nationalpid.com/athlete/profile/${result.athlete_id}`}
          />
          <ReconnectProspectIdAction />
        </ActionPanel>
      }
    />
  );
}

function MaterializeTaskForm({
  result,
  onSubmit,
}: {
  result: ProspectResult;
  onSubmit: (payload: MaterializePayload) => void;
}) {
  const [stage, setStage] = useState<string>('In Queue');
  const [status, setStatus] = useState<string>('');

  return (
    <Form
      navigationTitle="Materialize Task"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Task" onSubmit={() => onSubmit({ stage, status })} />
          <ReconnectProspectIdAction />
        </ActionPanel>
      }
    >
      <Form.Description
        title={result.name || `Athlete ${result.athlete_id}`}
        text="Create a task in Video Progress."
      />
      <Form.Dropdown id="stage" title="Stage" value={stage} onChange={setStage}>
        {STAGE_OPTIONS.map((option) => (
          <Form.Dropdown.Item key={option} value={option} title={option} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="status" title="Status" value={status} onChange={setStatus}>
        {STATUS_OPTIONS.map((option) => (
          <Form.Dropdown.Item key={option || 'blank'} value={option} title={option || 'Blank'} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

export default function ProspectSearch() {
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const runSearch = async (term: string) => {
    const requestId = ++requestIdRef.current;
    const isEmail = term.includes('@');
    setIsLoading(true);
    logger.info('Prospect search start', { term, requestId, isEmail });

    try {
      const response = await apiFetch('/athlete/raw-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term,
          email: isEmail ? term : undefined,
          include_admin_search: true,
          include_recent_search: false,
        }),
      });

      const { json, text } = await parseJsonResponse(response);

      if (!response.ok) {
        const errMessage =
          json?.detail || json?.message || text.slice(0, 200) || `HTTP ${response.status}`;
        throw new Error(errMessage);
      }

      const payload = json as ProspectSearchResponse | null;
      if (!payload || !Array.isArray(payload.results)) {
        throw new Error('Invalid search response');
      }

      if (requestId === requestIdRef.current) {
        // Filter out old grad years (< 2026)
        const filteredResults = payload.results.filter((r) => {
          const year = parseInt(r.grad_year || '', 10);
          // Keep if no grad year (don't filter unknown) or if >= MIN_GRAD_YEAR
          return isNaN(year) || year >= MIN_GRAD_YEAR;
        });
        setResults(filteredResults);
      }

      logger.info('Prospect search results', {
        term,
        requestId,
        count: payload.results.length,
      });
    } catch (error) {
      logger.error('Prospect search failed', {
        term,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (requestId === requestIdRef.current) {
        setResults([]);
      }
      await showToast({
        style: Toast.Style.Failure,
        title: 'Prospect Search Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const materializeTask = async (result: ProspectResult, payload: MaterializePayload) => {
    if (!result.athlete_id) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Missing athlete ID',
        message: 'Select a result with a valid athlete ID.',
      });
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Materializing task…',
    });

    try {
      const enriched = await ensureProspectDetails(result);
      const normalizedPositions = normalizePositionsWithLogging(
        enriched.positions,
        enriched.athlete_id,
      );
      let athleteMainId = enriched.athlete_main_id;
      if (!athleteMainId) {
        const resolved = await resolveAndCacheAthleteMainId(enriched.athlete_id);
        if (!resolved || resolved.source === 'fallback') {
          throw new Error('Unable to resolve athlete_main_id');
        }
        athleteMainId = resolved.athleteMainId;
      }
      searchLogger.info('PROSPECT_MATERIALIZE_REQUEST', {
        event: 'PROSPECT_MATERIALIZE_REQUEST',
        step: 'materialize_request',
        status: 'start',
        feature: 'prospect-search.materialize-task',
        context: {
          athleteId: enriched.athlete_id,
          athleteMainId: athleteMainId || null,
          positions: normalizedPositions,
          assignedEditor: ASSIGNED_EDITOR,
          stage: payload.stage,
          statusValue: payload.status || '',
        },
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
          positions: normalizedPositions,
          jersey_number: enriched.jersey_number,
          assigned_editor: ASSIGNED_EDITOR,
          stage: payload.stage,
          status: payload.status,
          source: 'raycast:global_prospect_ingest',
        }),
      });

      const { json, text } = await parseJsonResponse(response);
      if (!response.ok) {
        const errMessage =
          json?.detail || json?.message || text.slice(0, 200) || `HTTP ${response.status}`;
        searchLogger.error('PROSPECT_MATERIALIZE_REQUEST', {
          event: 'PROSPECT_MATERIALIZE_REQUEST',
          step: 'materialize_request',
          status: 'failure',
          feature: 'prospect-search.materialize-task',
          error: errMessage,
          context: {
            athleteId: enriched.athlete_id,
            statusCode: response.status,
          },
        });
        throw new Error(errMessage);
      }

      const task = json?.task;
      if (!task) {
        throw new Error('Materialize response missing task');
      }

      searchLogger.info('PROSPECT_MATERIALIZE_REQUEST', {
        event: 'PROSPECT_MATERIALIZE_REQUEST',
        step: 'materialize_request',
        status: 'success',
        feature: 'prospect-search.materialize-task',
        context: {
          athleteId: enriched.athlete_id,
          taskId: task.id || null,
          existed: !!json?.existed,
        },
      });

      await upsertTasks([task]);
      searchLogger.info('PROSPECT_MATERIALIZE_UPSERT', {
        event: 'PROSPECT_MATERIALIZE_UPSERT',
        step: 'materialize_upsert',
        status: 'success',
        feature: 'prospect-search.materialize-task',
        context: {
          athleteId: enriched.athlete_id,
          taskId: task.id || null,
          existed: !!json?.existed,
        },
      });
      toast.style = Toast.Style.Success;
      toast.title = json?.existed ? 'Task already exists' : 'Task created';
      toast.message = enriched.name || `Athlete ${enriched.athlete_id}`;
    } catch (error) {
      searchLogger.error('PROSPECT_MATERIALIZE_UPSERT', {
        event: 'PROSPECT_MATERIALIZE_UPSERT',
        step: 'materialize_upsert',
        status: 'failure',
        feature: 'prospect-search.materialize-task',
        error: error instanceof Error ? error.message : 'Unknown error',
        context: {
          athleteId: result.athlete_id,
        },
      });
      toast.style = Toast.Style.Failure;
      toast.title = 'Materialize failed';
      toast.message = error instanceof Error ? error.message : 'Unknown error';
    }
  };

  useEffect(() => {
    const term = searchText.trim();
    if (!term) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      runSearch(term);
    }, 350);

    return () => clearTimeout(timer);
  }, [searchText]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Prospect Search"
      searchBarPlaceholder="Search by athlete name or email"
      searchText={searchText}
      onSearchTextChange={setSearchText}
      actions={
        <ActionPanel>
          <ReconnectProspectIdAction
            onReconnectSuccess={async () => {
              const term = searchText.trim();
              if (!term) return;
              await runSearch(term);
            }}
          />
        </ActionPanel>
      }
    >
      {results.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Search ProspectID"
          description="Type a name or email to search global athlete records."
          actions={
            <ActionPanel>
              <ReconnectProspectIdAction
                onReconnectSuccess={async () => {
                  const term = searchText.trim();
                  if (!term) return;
                  await runSearch(term);
                }}
              />
            </ActionPanel>
          }
        />
      ) : (
        <List.Section title={`Results (${results.length})`}>
          {results.map((result) => (
            <List.Item
              key={`${result.athlete_id}-${result.source || 'search'}`}
              title={result.name || `Athlete ${result.athlete_id}`}
              subtitle={[
                result.grad_year ? `Class of ${result.grad_year}` : null,
                result.sport,
                result.high_school,
              ]
                .filter(Boolean)
                .join(' • ')}
              accessories={
                [
                  result.email ? { icon: Icon.Envelope, text: result.email } : undefined,
                  result.source ? { text: result.source } : undefined,
                ].filter(Boolean) as { icon?: Icon; text?: string }[]
              }
              actions={
                <ActionPanel>
                  <Action.Push
                    title="View Details"
                    icon={Icon.Eye}
                    target={
                      <ProspectDetail
                        result={result}
                        onMaterialize={(payload) => materializeTask(result, payload)}
                      />
                    }
                  />
                  <Action.OpenInBrowser
                    title="Open Prospect Profile"
                    icon={Icon.Globe}
                    url={`https://dashboard.nationalpid.com/athlete/profile/${result.athlete_id}`}
                  />
                  {result.email ? (
                    <Action.CopyToClipboard title="Copy Email" content={result.email} />
                  ) : null}
                  <Action.CopyToClipboard title="Copy Athlete ID" content={result.athlete_id} />
                  {result.athlete_main_id ? (
                    <Action.CopyToClipboard
                      title="Copy Athlete Main ID"
                      content={result.athlete_main_id}
                    />
                  ) : null}
                  <ReconnectProspectIdAction
                    onReconnectSuccess={async () => {
                      const term = searchText.trim();
                      if (!term) return;
                      await runSearch(term);
                    }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
