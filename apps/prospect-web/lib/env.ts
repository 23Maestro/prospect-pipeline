import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverOnlyEnvNames = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'FASTAPI_BASE_URL',
  'TAILSCALE_FASTAPI_BASE_URL',
  'PROSPECT_API_BASE',
  'PROSPECT_API_TOKEN',
  'INTERNAL_API_SECRET',
  'CALL_TRACKER_SYNC_SECRET',
  'TIM_LITE_ACCESS_TOKEN',
] as const;

let loadedRootEnv = false;

function loadRootEnvFallback() {
  if (loadedRootEnv) return;
  loadedRootEnv = true;
  const rootEnvPath = resolve(process.cwd(), '..', '..', '.env');
  if (!existsSync(rootEnvPath)) return;
  const lines = readFileSync(rootEnvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (process.env[key]) continue;
    const rawValue = trimmed.slice(separator + 1).trim();
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

export function getServerEnv(name: (typeof serverOnlyEnvNames)[number] | 'SUPABASE_URL' | 'SUPABASE_SCHEMA') {
  loadRootEnvFallback();
  return String(process.env[name] || '').trim();
}

export function getFastApiBaseUrl() {
  return (
    getServerEnv('TAILSCALE_FASTAPI_BASE_URL') ||
    getServerEnv('FASTAPI_BASE_URL') ||
    getServerEnv('PROSPECT_API_BASE')
  ).replace(/\/+$/, '');
}

export function getFastApiToken() {
  return getServerEnv('PROSPECT_API_TOKEN') || getServerEnv('INTERNAL_API_SECRET') || getServerEnv('CALL_TRACKER_SYNC_SECRET');
}

export function getMissingFastApiEnvMessage() {
  const baseUrl = getFastApiBaseUrl();
  const token = getFastApiToken();
  if (baseUrl && token) return '';
  return 'Vercel is missing FASTAPI_BASE_URL/TAILSCALE_FASTAPI_BASE_URL or PROSPECT_API_TOKEN/INTERNAL_API_SECRET';
}
