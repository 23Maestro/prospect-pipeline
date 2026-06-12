import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildParentResponseN8nEnv,
  buildReadinessReport,
  parseVercelEnvList,
} from './verify-parent-response-readiness.mjs';

test('parseVercelEnvList returns production env names only', () => {
  const keys = parseVercelEnvList(`
    Vercel CLI 54.12.2
    SUPABASE_URL                       Encrypted           Production          41d ago
    PARENT_RESPONSE_TOKEN_SECRET       Encrypted           Preview             1d ago
    PARENT_RESPONSE_NOTIFY_SECRET      Encrypted           Production          1d ago
    Common next commands:
  `);

  assert.deepEqual([...keys].sort(), [
    'PARENT_RESPONSE_NOTIFY_SECRET',
    'SUPABASE_URL',
  ]);
});

test('buildReadinessReport reports missing parent response live env', () => {
  const localKeys = new Set([
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'PARENT_RESPONSE_TOKEN_SECRET',
    'PARENT_RESPONSE_PUBLIC_BASE_URL',
  ]);
  const n8nKeys = new Set([
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PARENT_RESPONSE_NOTIFY_BASE_URL',
    'PARENT_RESPONSE_NOTIFY_SECRET',
  ]);
  const vercelProductionKeys = new Set([
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SCHEMA',
    'FASTAPI_BASE_URL',
    'PROSPECT_API_TOKEN',
    'PARENT_RESPONSE_TOKEN_SECRET',
    'PARENT_RESPONSE_NOTIFY_SECRET',
    'PARENT_RESPONSE_APPROVAL_SECRET',
  ]);

  const report = buildReadinessReport({
    localKeys,
    n8nKeys,
    vercelProductionKeys,
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.sections.find((section) => section.name === 'Vercel production env')?.missing,
    ['RESEND_API_KEY', 'PARENT_RESPONSE_NOTIFY_FROM', 'PARENT_RESPONSE_NOTIFY_TO'],
  );
});

test('buildParentResponseN8nEnv maps secret key and preserves explicit service role key', () => {
  const fromSecret = buildParentResponseN8nEnv(
    {
      SUPABASE_SECRET_KEY: 'secret-key',
      PARENT_RESPONSE_NOTIFY_SECRET: 'notify-secret',
    },
    '/tmp/missing-parent-response-env-root',
  );
  assert.equal(fromSecret.SUPABASE_SERVICE_ROLE_KEY, 'secret-key');
  assert.equal(fromSecret.PARENT_RESPONSE_NOTIFY_SECRET, 'notify-secret');

  const explicit = buildParentResponseN8nEnv(
    {
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    '/tmp/missing-parent-response-env-root',
  );
  assert.equal(explicit.SUPABASE_SERVICE_ROLE_KEY, 'service-role-key');
});
