import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildParentResponseVercelEnvPlan,
  syncParentResponseVercelEnv,
} from './sync-parent-response-vercel-env.mjs';

test('buildParentResponseVercelEnvPlan requires parent response and Resend env', () => {
  const plan = buildParentResponseVercelEnvPlan(new Map([
    ['PARENT_RESPONSE_TOKEN_SECRET', 'token'],
    ['PARENT_RESPONSE_NOTIFY_SECRET', 'notify'],
    ['PARENT_RESPONSE_APPROVAL_SECRET', 'approval'],
  ]));

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.missing, [
    'RESEND_API_KEY',
    'PARENT_RESPONSE_NOTIFY_FROM',
    'PARENT_RESPONSE_NOTIFY_TO',
  ]);
});

test('syncParentResponseVercelEnv writes production env without logging values', () => {
  const plan = buildParentResponseVercelEnvPlan(new Map([
    ['PARENT_RESPONSE_TOKEN_SECRET', 'token'],
    ['PARENT_RESPONSE_NOTIFY_SECRET', 'notify'],
    ['PARENT_RESPONSE_APPROVAL_SECRET', 'approval'],
    ['RESEND_API_KEY', 'resend'],
    ['PARENT_RESPONSE_NOTIFY_FROM', 'Scout Prep <updates@example.com>'],
    ['PARENT_RESPONSE_NOTIFY_TO', 'operator@example.com'],
  ]));
  const calls = [];

  syncParentResponseVercelEnv(plan, (bin, args, options) => {
    calls.push({ bin, args, cwd: options.cwd });
    return '';
  });

  assert.equal(plan.ok, true);
  assert.equal(calls.length, 6);
  assert.equal(calls[0].bin, 'npx');
  assert.deepEqual(calls[0].args.slice(0, 5), ['vercel', 'env', 'add', 'PARENT_RESPONSE_TOKEN_SECRET', 'production']);
  assert.deepEqual(calls[0].args.slice(-3), ['token', '--yes', '--force']);
  assert.match(calls[0].cwd, /apps\/prospect-web$/);
});
