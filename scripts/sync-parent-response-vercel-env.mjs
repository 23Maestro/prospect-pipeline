import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLocalEnvEntries } from './verify-parent-response-readiness.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_DIR = resolve(REPO_ROOT, 'apps/prospect-web');

const PARENT_RESPONSE_VERCEL_KEYS = [
  'PARENT_RESPONSE_TOKEN_SECRET',
  'PARENT_RESPONSE_NOTIFY_SECRET',
  'PARENT_RESPONSE_APPROVAL_SECRET',
  'RESEND_API_KEY',
  'PARENT_RESPONSE_NOTIFY_FROM',
  'PARENT_RESPONSE_NOTIFY_TO',
];

export function buildParentResponseVercelEnvPlan(entries) {
  const updates = PARENT_RESPONSE_VERCEL_KEYS
    .map((key) => [key, String(entries.get(key) || '').trim()])
    .filter(([, value]) => value);
  const present = new Set(updates.map(([key]) => key));
  return {
    ok: updates.length === PARENT_RESPONSE_VERCEL_KEYS.length,
    updates,
    missing: PARENT_RESPONSE_VERCEL_KEYS.filter((key) => !present.has(key)),
  };
}

function printPlan(plan) {
  if (plan.ok) {
    console.log(`PASS parent response Vercel env plan (${plan.updates.length} keys)`);
    return;
  }
  console.log('MISSING parent response Vercel env values');
  for (const key of plan.missing) {
    console.log(`  - ${key}`);
  }
}

export function syncParentResponseVercelEnv(plan, execFile = execFileSync) {
  for (const [key, value] of plan.updates) {
    execFile('npx', ['vercel', 'env', 'add', key, 'production', '--value', value, '--yes', '--force'], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    console.log(`Synced ${key} to Vercel production`);
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const plan = buildParentResponseVercelEnvPlan(collectLocalEnvEntries());
  printPlan(plan);
  if (!plan.ok) {
    process.exitCode = 1;
    return;
  }
  if (checkOnly) return;
  syncParentResponseVercelEnv(plan);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
