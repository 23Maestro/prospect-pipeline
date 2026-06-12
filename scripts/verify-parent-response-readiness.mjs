import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP_DIR = resolve(REPO_ROOT, 'apps/prospect-web');

const LOCAL_ENV_FILES = [
  '.env',
  '.overmind.env',
  'npid-api-layer/.env',
  'apps/prospect-web/.env.local',
];

const LOCAL_RAYCAST_REQUIREMENTS = [
  ['SUPABASE_URL'],
  ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  ['PARENT_RESPONSE_TOKEN_SECRET'],
  ['PARENT_RESPONSE_PUBLIC_BASE_URL'],
];

const N8N_SHELL_REQUIREMENTS = [
  ['SUPABASE_URL'],
  ['SUPABASE_SERVICE_ROLE_KEY'],
  ['PARENT_RESPONSE_NOTIFY_BASE_URL'],
  ['PARENT_RESPONSE_NOTIFY_SECRET'],
];

const VERCEL_PRODUCTION_REQUIREMENTS = [
  ['SUPABASE_URL'],
  ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  ['SUPABASE_SCHEMA'],
  ['FASTAPI_BASE_URL', 'TAILSCALE_FASTAPI_BASE_URL', 'PROSPECT_API_BASE'],
  ['PROSPECT_API_TOKEN', 'INTERNAL_API_SECRET', 'CALL_TRACKER_SYNC_SECRET'],
  ['PARENT_RESPONSE_TOKEN_SECRET'],
  ['PARENT_RESPONSE_NOTIFY_SECRET'],
  ['PARENT_RESPONSE_APPROVAL_SECRET'],
  ['RESEND_API_KEY'],
  ['PARENT_RESPONSE_NOTIFY_FROM'],
  ['PARENT_RESPONSE_NOTIFY_TO'],
];

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return new Map();
  const entries = new Map();
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) entries.set(key, value);
  }
  return entries;
}

export function collectLocalEnvKeys(rootDir = REPO_ROOT) {
  const keys = new Set();
  for (const relativePath of LOCAL_ENV_FILES) {
    const env = readEnvFile(resolve(rootDir, relativePath));
    for (const [key, value] of env.entries()) {
      if (String(value || '').trim()) keys.add(key);
    }
  }
  return keys;
}

export function collectProcessEnvKeys(env = process.env) {
  return new Set(
    Object.entries(env)
      .filter(([, value]) => String(value || '').trim())
      .map(([key]) => key),
  );
}

export function parseVercelEnvList(output, targetEnvironment = 'Production') {
  const keys = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Z][A-Z0-9_]+)\s+/);
    if (!match) continue;
    if (!trimmed.includes(targetEnvironment)) continue;
    keys.add(match[1]);
  }
  return keys;
}

function missingRequirementNames(requirements, availableKeys) {
  return requirements
    .filter((options) => !options.some((key) => availableKeys.has(key)))
    .map((options) => options.join(' or '));
}

function statusFor(name, requirements, availableKeys) {
  const missing = missingRequirementNames(requirements, availableKeys);
  return {
    name,
    ok: missing.length === 0,
    missing,
  };
}

function readVercelProductionKeys() {
  const output = execFileSync('npx', ['vercel', 'env', 'ls'], {
    cwd: APP_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseVercelEnvList(output, 'Production');
}

export function buildReadinessReport({ localKeys, n8nKeys, vercelProductionKeys }) {
  const workflowPath = resolve(REPO_ROOT, 'n8n/workflows/parent-response-review.json');
  const sections = [
    statusFor('local Raycast/root env', LOCAL_RAYCAST_REQUIREMENTS, localKeys),
    statusFor('current n8n shell env', N8N_SHELL_REQUIREMENTS, n8nKeys),
    statusFor('Vercel production env', VERCEL_PRODUCTION_REQUIREMENTS, vercelProductionKeys),
    {
      name: 'n8n workflow artifact',
      ok: existsSync(workflowPath),
      missing: existsSync(workflowPath) ? [] : ['n8n/workflows/parent-response-review.json'],
    },
  ];
  return {
    ok: sections.every((section) => section.ok),
    sections,
  };
}

function printReport(report) {
  for (const section of report.sections) {
    const prefix = section.ok ? 'PASS' : 'MISSING';
    console.log(`${prefix} ${section.name}`);
    for (const item of section.missing) {
      console.log(`  - ${item}`);
    }
  }
}

function main() {
  const skipVercel = process.argv.includes('--skip-vercel');
  let vercelProductionKeys = new Set();
  if (!skipVercel) {
    try {
      vercelProductionKeys = readVercelProductionKeys();
    } catch (error) {
      console.error(`Unable to read Vercel production env: ${error.message}`);
    }
  }

  const report = buildReadinessReport({
    localKeys: collectLocalEnvKeys(),
    n8nKeys: collectProcessEnvKeys(),
    vercelProductionKeys,
  });
  printReport(report);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
