import {
  getSupabaseRestConfig,
  supabaseHeaders,
  verifyTimLiteAccess,
} from '../access';
import { jsonResponse, methodNotAllowed } from '../../../../lib/response-shapes';

export async function POST(request: Request) {
  const accessError = verifyTimLiteAccess(request);
  if (accessError) return accessError;

  const payload = await request.json().catch(() => ({}));
  const query = String(payload.query || payload.input_query || '').trim();
  if (!query) {
    return jsonResponse({ success: true, count: 0, results: [] });
  }

  try {
    const config = getSupabaseRestConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/search_tim_lite_confirmation_cache`, {
      method: 'POST',
      cache: 'no-store',
      headers: supabaseHeaders(config, { 'content-type': 'application/json' }),
      body: JSON.stringify({ input_query: query }),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
    }
    const results = Array.isArray(rows) ? rows : [];
    return jsonResponse({
      success: true,
      count: results.length,
      results,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export function GET(request: Request) {
  return methodNotAllowed(request.method, ['POST']);
}
