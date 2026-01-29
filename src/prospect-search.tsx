import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  showToast,
} from '@raycast/api';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './lib/python-server-client';
import { upsertTasks } from './lib/video-progress-cache';
import { resolveAndCacheAthleteMainId } from './lib/athlete-id-service';
import { logger } from './lib/logger';

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

function formatLocation(result: ProspectResult): string {
  const parts = [result.city, result.state].filter(Boolean);
  return parts.join(', ');
}

function buildProspectMarkdown(result: ProspectResult): string {
  const lines = [
    `# ${result.name || `Athlete ${result.athlete_id}`}`,
    '',
    `**Athlete ID:** ${result.athlete_id || 'N/A'}`,
    `**Athlete Main ID:** ${result.athlete_main_id || 'N/A'}`,
    `**Grad Year:** ${result.grad_year || 'N/A'}`,
    `**Sport:** ${result.sport || 'N/A'}`,
    `**High School:** ${result.high_school || 'N/A'}`,
    `**Location:** ${formatLocation(result) || 'N/A'}`,
    `**Email:** ${result.email || 'N/A'}`,
    `**Positions:** ${result.positions || 'N/A'}`,
    `**Source:** ${result.source || 'N/A'}`,
  ];
  return lines.join('\n');
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
  return {
    ...result,
    athlete_main_id: result.athlete_main_id || details.athlete_main_id,
    name: result.name || details.name,
    grad_year: result.grad_year || details.grad_year,
    sport: result.sport || details.sport,
    high_school: result.high_school || details.high_school,
    city: result.city || details.city,
    state: result.state || details.state,
    positions: result.positions || details.positions,
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
          <Form.Dropdown.Item
            key={option || 'blank'}
            value={option}
            title={option || 'Blank'}
          />
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
          json?.detail ||
          json?.message ||
          text.slice(0, 200) ||
          `HTTP ${response.status}`;
        throw new Error(errMessage);
      }

      const payload = json as ProspectSearchResponse | null;
      if (!payload || !Array.isArray(payload.results)) {
        throw new Error('Invalid search response');
      }

      if (requestId === requestIdRef.current) {
        setResults(payload.results);
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
      let athleteMainId = enriched.athlete_main_id;
      if (!athleteMainId) {
        const resolved = await resolveAndCacheAthleteMainId(enriched.athlete_id);
        if (!resolved || resolved.source === 'fallback') {
          throw new Error('Unable to resolve athlete_main_id');
        }
        athleteMainId = resolved.athleteMainId;
      }
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
          assigned_editor: ASSIGNED_EDITOR,
          stage: payload.stage,
          status: payload.status,
          source: 'raycast:global_prospect_ingest',
        }),
      });

      const { json, text } = await parseJsonResponse(response);
      if (!response.ok) {
        const errMessage =
          json?.detail ||
          json?.message ||
          text.slice(0, 200) ||
          `HTTP ${response.status}`;
        throw new Error(errMessage);
      }

      const task = json?.task;
      if (!task) {
        throw new Error('Materialize response missing task');
      }

      await upsertTasks([task]);
      toast.style = Toast.Style.Success;
      toast.title = json?.existed ? 'Task already exists' : 'Task created';
      toast.message = enriched.name || `Athlete ${enriched.athlete_id}`;
    } catch (error) {
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
    >
      {results.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Search ProspectID"
          description="Type a name or email to search global athlete records."
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
              accessories={[
                result.email ? { icon: Icon.Envelope, text: result.email } : undefined,
                result.source ? { text: result.source } : undefined,
              ].filter(Boolean) as { icon?: Icon; text?: string }[]}
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
                  <Action.CopyToClipboard
                    title="Copy Athlete ID"
                    content={result.athlete_id}
                  />
                  {result.athlete_main_id ? (
                    <Action.CopyToClipboard
                      title="Copy Athlete Main ID"
                      content={result.athlete_main_id}
                    />
                  ) : null}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
