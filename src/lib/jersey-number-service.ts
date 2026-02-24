import { apiFetch } from './python-server-client';
import { getCachedJerseyNumber, updateCachedJerseyNumber } from './video-progress-cache';

export interface JerseyResolveResult {
  athleteId: string;
  jerseyNumber: string | null;
  source: 'cache' | 'api' | 'missing' | 'invalid';
  endpoint: string;
  statusCode?: number;
  contentType?: string;
  forceRefresh: boolean;
  error?: string;
}

interface ResolveJerseyOptions {
  gradYear?: number;
  forceRefresh?: boolean;
}

const inFlightResolves = new Map<string, Promise<JerseyResolveResult>>();

export async function resolveAndCacheJerseyNumber(
  athleteId: string | number,
  options: ResolveJerseyOptions = {},
): Promise<JerseyResolveResult> {
  const id = String(athleteId);
  const numericId = parseInt(id, 10);
  const forceRefresh = Boolean(options.forceRefresh);
  const endpoint = `/athlete/${encodeURIComponent(id)}/resolve`;

  if (!id || Number.isNaN(numericId) || numericId <= 0) {
    return {
      athleteId: id,
      jerseyNumber: null,
      source: 'invalid',
      endpoint,
      forceRefresh,
      error: 'invalid_athlete_id',
    };
  }

  const cached = await getCachedJerseyNumber(numericId);
  if (cached) {
    return {
      athleteId: id,
      jerseyNumber: cached,
      source: 'cache',
      endpoint,
      forceRefresh,
    };
  }

  const requestKey = `${id}:${options.gradYear || ''}:${forceRefresh ? 'force' : 'normal'}`;
  const existingRequest = inFlightResolves.get(requestKey);
  if (existingRequest) {
    return await existingRequest;
  }

  const request = (async () => {
    try {
      const query = new URLSearchParams();
      if (options.gradYear) {
        query.set('grad_year', String(options.gradYear));
      }
      if (forceRefresh) {
        query.set('force_refresh', 'true');
      }
      const resolveUrl = query.toString() ? `${endpoint}?${query.toString()}` : endpoint;
      const response = await apiFetch(resolveUrl);
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }

      if (!response.ok || !json) {
        return {
          athleteId: id,
          jerseyNumber: null,
          source: 'missing',
          endpoint,
          statusCode: response.status,
          contentType,
          forceRefresh,
          error: json?.detail ? String(json.detail) : `HTTP ${response.status}`,
        };
      }

      const jersey = typeof json.jersey_number === 'string' ? json.jersey_number : '';
      if (jersey) {
        await updateCachedJerseyNumber(numericId, jersey);
        return {
          athleteId: id,
          jerseyNumber: jersey,
          source: 'api',
          endpoint,
          statusCode: response.status,
          contentType,
          forceRefresh,
        };
      }

      return {
        athleteId: id,
        jerseyNumber: null,
        source: 'missing',
        endpoint,
        statusCode: response.status,
        contentType,
        forceRefresh,
        error: 'resolve_response_missing_jersey',
      };
    } catch (error) {
      return {
        athleteId: id,
        jerseyNumber: null,
        source: 'missing',
        endpoint,
        forceRefresh,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  inFlightResolves.set(requestKey, request);
  try {
    return await request;
  } finally {
    inFlightResolves.delete(requestKey);
  }
}
