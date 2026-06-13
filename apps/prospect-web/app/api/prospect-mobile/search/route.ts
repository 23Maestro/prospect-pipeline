import { getFastApiBaseUrl, getFastApiToken, getMissingFastApiEnvMessage } from '../../../../lib/env';
import { jsonResponse, methodNotAllowed, upstreamUnavailable } from '../../../../lib/response-shapes';
import { getSupabaseRestConfig, supabaseHeaders } from '../../tim-lite/access';

type RawProspectResult = {
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  name?: string | null;
  grad_year?: string | null;
  sport?: string | null;
  state?: string | null;
  city?: string | null;
  high_school?: string | null;
  email?: string | null;
  phone?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  parent_phone?: string | null;
  url?: string | null;
  source?: string | null;
};

const MAX_RESULTS = 5;

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const query = String(payload.query || payload.q || payload.phone || payload.email || '').trim();
  if (!query) {
    return jsonResponse({ success: true, mode: 'empty', count: 0, results: [], rows: [] });
  }

  try {
    if (looksLikePhone(query)) {
      const rows = await searchContactCache(query);
      if (rows.length) {
        return jsonResponse({
          success: true,
          mode: 'contact_cache',
          count: rows.length,
          rows,
          results: [],
        });
      }
    }

    const results = await searchRawProspects(query);
    return jsonResponse({
      success: true,
      mode: looksLikeEmail(query) ? 'raw_email' : looksLikePhone(query) ? 'raw_phone_fallback' : 'raw_text',
      count: results.length,
      rows: [],
      results,
    });
  } catch (error) {
    return upstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}

async function searchContactCache(query: string) {
  const config = getSupabaseRestConfig();
  const response = await fetch(`${config.url}/rest/v1/rpc/search_athlete_contact_cache`, {
    method: 'POST',
    cache: 'no-store',
    headers: supabaseHeaders(config, { 'content-type': 'application/json' }),
    body: JSON.stringify({ input_query: query }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
  }
  return Array.isArray(rows) ? rows : [];
}

async function searchRawProspects(query: string) {
  const missingMessage = getMissingFastApiEnvMessage();
  if (missingMessage) throw new Error(missingMessage);

  const searches = [
    fetchRawProspects(query, undefined),
    fetchRawProspects(query, 'Parent'),
  ];
  const payloads = await Promise.all(searches);
  const merged = new Map<string, RawProspectResult>();
  for (const result of payloads.flat()) {
    const athleteId = String(result.athlete_id || '').trim();
    if (!athleteId) continue;
    const key = `${athleteId}:${String(result.athlete_main_id || '').trim()}`;
    if (!merged.has(key)) merged.set(key, result);
  }
  return Array.from(merged.values()).slice(0, MAX_RESULTS);
}

async function fetchRawProspects(query: string, searchingFor?: 'Parent') {
  const normalizedTerm = normalizeSearchTerm(query);
  const response = await fetch(`${getFastApiBaseUrl()}/api/v1/athlete/raw-search`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${getFastApiToken()}`,
      'x-mobile-proxy': 'vercel',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      term: normalizedTerm,
      searching_for: searchingFor,
      email: looksLikeEmail(normalizedTerm) ? normalizedTerm : undefined,
      include_admin_search: searchingFor === 'Parent' ? false : true,
      include_recent_search: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || payload.error || `FastAPI ${response.status}`);
  }
  return Array.isArray(payload.results) ? payload.results as RawProspectResult[] : [];
}

function looksLikeEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value);
}

function looksLikePhone(value: string) {
  return value.replace(/\D/g, '').length >= 7 && !looksLikeEmail(value);
}

function normalizeSearchTerm(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return formatUsPhone(digits.slice(1));
  }
  if (digits.length === 10 && /^[\d\s()+.-]+$/.test(trimmed)) {
    return formatUsPhone(digits);
  }
  return trimmed;
}

function formatUsPhone(digits: string) {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
