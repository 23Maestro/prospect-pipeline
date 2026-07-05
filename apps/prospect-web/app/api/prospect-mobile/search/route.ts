import { getRawSearchResults, getSearchRows } from '../../../../lib/prospect-demo-data';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

function looksLikePhone(value: string) {
  return value.replace(/\D/g, '').length >= 7 && !/\S+@\S+\.\S+/.test(value);
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const query = String(payload.query || payload.q || payload.phone || payload.email || '').trim();
  if (!query) {
    return jsonResponse({ success: true, mode: 'empty', count: 0, results: [], rows: [] });
  }

  const rows = getSearchRows(query);
  const results = getRawSearchResults(query);
  return jsonResponse({
    success: true,
    mode: looksLikePhone(query) ? 'contact_cache' : 'raw_text',
    count: rows.length || results.length,
    rows,
    results,
  });
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
