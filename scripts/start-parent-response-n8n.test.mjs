import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStartCheck } from './start-parent-response-n8n.mjs';

test('buildStartCheck rejects missing n8n env', () => {
  const check = buildStartCheck({}, '/tmp/missing-parent-response-env-root');
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PARENT_RESPONSE_NOTIFY_BASE_URL',
    'PARENT_RESPONSE_NOTIFY_SECRET',
  ]);
});

test('buildStartCheck accepts complete n8n env', () => {
  const check = buildStartCheck({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    PARENT_RESPONSE_NOTIFY_BASE_URL: 'https://prospect-web.vercel.app',
    PARENT_RESPONSE_NOTIFY_SECRET: 'notify-secret',
  }, '/tmp/missing-parent-response-env-root');
  assert.equal(check.ok, true);
  assert.deepEqual(check.missing, []);
});
