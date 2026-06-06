import { apiFetch } from './fastapi-client';
import { resolveAndCacheAthleteMainId } from './athlete-id-service';
import { logger, searchLogger } from './logger';
import { cleanPositions } from '../domain/position-text';
import { normalizeProspectSearchTerm } from './prospect-search-term';

export interface ProspectResult {
  athlete_id: string;
  athlete_main_id?: string;
  name?: string;
  grad_year?: string;
  sport?: string;
  state?: string;
  city?: string;
  high_school?: string;
  email?: string;
  phone?: string;
  parent_name?: string;
  parent_email?: string;
  parent_phone?: string;
  url?: string;
  positions?: string;
  source?: string;
  jersey_number?: string;
}

interface ProspectSearchResponse {
  success: boolean;
  count: number;
  results: ProspectResult[];
  sources?: Array<Record<string, unknown>>;
}

export { normalizeProspectSearchTerm } from './prospect-search-term';
export { cleanPositions } from '../domain/position-text';

const MIN_GRAD_YEAR = 2026;

export function normalizePositionsWithLogging(
  rawPositions?: string,
  athleteId?: string,
): string | null {
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

async function parseJsonResponse(response: { text(): Promise<string> }) {
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
      (json as Record<string, string> | null)?.detail ||
      (json as Record<string, string> | null)?.message ||
      text.slice(0, 200) ||
      `HTTP ${response.status}`;
    throw new Error(errMessage);
  }
  return (json || {}) as Record<string, string>;
}

export async function ensureProspectDetails(result: ProspectResult): Promise<ProspectResult> {
  const details = await fetchAthleteResolve(result.athlete_id, result.grad_year);
  const mergedPositions = result.positions || details.positions;
  const normalizedPositions = normalizePositionsWithLogging(mergedPositions, result.athlete_id);

  let athleteMainId = result.athlete_main_id || details.athlete_main_id;
  if (!athleteMainId) {
    const resolved = await resolveAndCacheAthleteMainId(result.athlete_id);
    athleteMainId = resolved?.athleteMainId;
  }

  return {
    ...result,
    athlete_main_id: athleteMainId,
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

export async function runProspectRawSearch(
  term: string,
  options?: { searchingFor?: 'Parent' },
): Promise<ProspectResult[]> {
  const normalizedTerm = normalizeProspectSearchTerm(term);
  const isEmail = normalizedTerm.includes('@');
  const response = await apiFetch('/athlete/raw-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      term: normalizedTerm,
      searching_for: options?.searchingFor,
      email: isEmail ? normalizedTerm : undefined,
      include_admin_search: options?.searchingFor === 'Parent' ? false : true,
      include_recent_search: false,
    }),
  });

  const { json, text } = await parseJsonResponse(response);
  if (!response.ok) {
    const errMessage =
      (json as Record<string, string> | null)?.detail ||
      (json as Record<string, string> | null)?.message ||
      text.slice(0, 200) ||
      `HTTP ${response.status}`;
    throw new Error(errMessage);
  }

  const payload = json as ProspectSearchResponse | null;
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error('Invalid search response');
  }

  return payload.results.filter((result) => {
    const year = parseInt(result.grad_year || '', 10);
    return Number.isNaN(year) || year >= MIN_GRAD_YEAR;
  });
}
