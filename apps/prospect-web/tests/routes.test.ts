import assert from 'node:assert/strict';
import test from 'node:test';
import { DELETE, GET, POST } from '../app/api/call-tracker-sync/route';
import { GET as healthGET } from '../app/api/health/route';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test('/api/health returns expected adapter status', async () => {
  const response = healthGET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    status: 'ok',
    adapter: 'vercel-nextjs',
    surfaces: ['prospect-mobile', 'prospect-call-tracker'],
  });
});

test('/api/call-tracker-sync GET passes through old FastAPI sync status shape', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ success: true, status: 'idle', running: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, status: 'idle', running: false });
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/call-tracker/sync');
  assert.equal(calls[0].init?.headers?.['x-mobile-proxy' as keyof HeadersInit], 'vercel');
});

test('/api/call-tracker-sync POST starts old FastAPI async sync route', async () => {
  process.env.TAILSCALE_FASTAPI_BASE_URL = 'https://tailnet.example/';
  process.env.INTERNAL_API_SECRET = 'secret';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ success: true, status: 'started', running: true });
  };

  const response = await POST();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, status: 'started', running: true });
  assert.equal(calls[0].url, 'https://tailnet.example/api/v1/call-tracker/sync?wait=false');
  assert.equal(calls[0].init?.method, 'POST');
});

test('/api/call-tracker-sync preserves FastAPI error response shape', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  globalThis.fetch = async () =>
    Response.json({ success: false, status: 'failed', message: 'script failed', log_tail: ['boom'] }, { status: 500 });

  const response = await POST();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    success: false,
    status: 'failed',
    message: 'script failed',
    log_tail: ['boom'],
  });
});

test('/api/call-tracker-sync handles fetch failure with dashboard-compatible JSON', async () => {
  process.env.FASTAPI_BASE_URL = 'https://tailnet.example';
  process.env.PROSPECT_API_TOKEN = 'secret';
  globalThis.fetch = async () => {
    throw new Error('network unreachable');
  };

  const response = await POST();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    success: false,
    status: 'failed',
    error: 'network unreachable',
    message: 'network unreachable',
  });
});

test('/api/call-tracker-sync rejects unsupported methods with old shape', async () => {
  const response = DELETE(new Request('https://example.test/api/call-tracker-sync', { method: 'DELETE' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Method DELETE not allowed',
  });
});
