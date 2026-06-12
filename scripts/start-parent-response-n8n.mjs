import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildParentResponseN8nEnv,
  buildReadinessReport,
  collectLocalEnvKeys,
  collectProcessEnvKeys,
} from './verify-parent-response-readiness.mjs';

const REQUIRED_N8N_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PARENT_RESPONSE_NOTIFY_BASE_URL',
  'PARENT_RESPONSE_NOTIFY_SECRET',
];

function missingKeys(env) {
  return REQUIRED_N8N_KEYS.filter((key) => !String(env[key] || '').trim());
}

export function buildStartCheck(env = process.env, rootDir) {
  const n8nEnv = buildParentResponseN8nEnv(env, rootDir);
  const missing = missingKeys(n8nEnv);
  const report = buildReadinessReport({
    localKeys: collectLocalEnvKeys(rootDir),
    n8nKeys: collectProcessEnvKeys(n8nEnv),
    vercelProductionKeys: new Set(),
  });
  return {
    ok: missing.length === 0,
    missing,
    report,
  };
}

function printCheck(check) {
  if (check.ok) {
    console.log('PASS parent response n8n env');
    return;
  }
  console.log('MISSING parent response n8n env');
  for (const key of check.missing) {
    console.log(`  - ${key}`);
  }
}

function startN8n(env) {
  const child = spawn('n8n', [], {
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const n8nEnv = buildParentResponseN8nEnv();
  const check = buildStartCheck(n8nEnv);
  printCheck(check);
  if (!check.ok) {
    process.exitCode = 1;
    return;
  }
  if (checkOnly) return;
  startN8n(n8nEnv);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
