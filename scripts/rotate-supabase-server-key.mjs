#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readLinkedProjectRef, readLinkedSupabaseUrl } from './supabase-credentials.mjs';

const root = process.cwd();
const apiBase = 'https://api.supabase.com/v1';
const projectRef = readLinkedProjectRef(root);
const supabaseUrl = readLinkedSupabaseUrl(root);
const keyName = buildKeyName();
const disableLegacy = process.argv.includes('--disable-legacy');

if (!projectRef || !supabaseUrl) {
  console.error('Supabase project is not linked. Run `supabase link` first.');
  process.exit(1);
}

const accessToken = readCliAccessToken();
if (!accessToken) {
  console.error('Could not read Supabase CLI token from macOS Keychain.');
  process.exit(1);
}

const createdKey = await createSecretKey({
  accessToken,
  projectRef,
  keyName,
});

const revealedKey = await readProjectSecretKey({
  accessToken,
  projectRef,
  keyId: createdKey?.id,
  keyName,
});

if (!revealedKey || !String(revealedKey.api_key || '').startsWith('sb_secret_') || isMaskedKey(revealedKey.api_key)) {
  console.error('Supabase did not return a usable secret key.');
  process.exit(1);
}

const schema = readExistingSchema(root);
const targets = [
  path.join(root, '.env'),
  path.join(root, '.overmind.env'),
  path.join(root, 'npid-api-layer/.env'),
];

for (const filePath of targets) {
  const current = readEnvFile(filePath);
  const stripped = stripEnvKeys(current, ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  const updated = upsertEnv(
    stripped,
    new Map([
      ['SUPABASE_URL', supabaseUrl],
      ['SUPABASE_SECRET_KEY', String(revealedKey.api_key || '').trim()],
      ['SUPABASE_SCHEMA', schema],
    ]),
  );
  fs.writeFileSync(filePath, updated);
}

if (disableLegacy) {
  await setLegacyKeysEnabled({
    accessToken,
    projectRef,
    enabled: false,
  });
}

await verifyRestAccess({
  url: supabaseUrl,
  key: String(revealedKey.api_key || '').trim(),
  schema,
});

const prefix = String(revealedKey.api_key || '').slice(0, 18);
console.log(`Created Supabase secret key ${prefix}...`);
console.log('Updated .env, .overmind.env, and npid-api-layer/.env');
if (disableLegacy) {
  console.log('Disabled legacy API keys for the linked project');
} else {
  console.log('Legacy API keys left enabled; rerun with --disable-legacy once all consumers are verified');
}

function buildKeyName() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
  return `prospect_pipeline_${stamp}`.toLowerCase();
}

function readCliAccessToken() {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Supabase CLI', '-w', 'login.keychain-db'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    if (!raw) return '';
    const encodedPrefix = 'go-keyring-base64:';
    if (raw.startsWith(encodedPrefix)) {
      return Buffer.from(raw.slice(encodedPrefix.length), 'base64').toString('utf8').trim();
    }
    return raw;
  } catch {
    return '';
  }
}

async function createSecretKey({ accessToken, projectRef, keyName }) {
  const response = await fetch(`${apiBase}/projects/${projectRef}/api-keys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: keyName,
      type: 'secret',
      description: 'Managed by scripts/rotate-supabase-server-key.mjs',
      secret_jwt_template: {
        role: 'service_role',
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create Supabase secret key (${response.status}): ${body}`);
  }

  return response.json();
}

async function readProjectSecretKey({ accessToken, projectRef, keyId, keyName }) {
  const response = await fetch(`${apiBase}/projects/${projectRef}/api-keys?reveal=true`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to reveal Supabase API keys (${response.status}): ${body}`);
  }

  const keys = await response.json();
  if (!Array.isArray(keys)) return null;
  return (
    keys.find((entry) => String(entry?.id || '').trim() === String(keyId || '').trim()) ||
    keys.find((entry) => String(entry?.name || '').trim() === String(keyName || '').trim()) ||
    null
  );
}

async function setLegacyKeysEnabled({ accessToken, projectRef, enabled }) {
  const response = await fetch(
    `${apiBase}/projects/${projectRef}/api-keys/legacy?enabled=${enabled ? 'true' : 'false'}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update legacy API keys (${response.status}): ${body}`);
  }
}

async function verifyRestAccess({ url, key, schema }) {
  const response = await fetch(`${url}/rest/v1/lifecycle_events?select=athlete_id&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': schema,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Secret key verification failed (${response.status}): ${body}`);
  }
}

function readEnvFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseEnv(raw) {
  const values = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    values.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
  }
  return values;
}

function readExistingSchema(cwd) {
  const env = parseEnv(readEnvFile(path.join(cwd, '.env')));
  return String(env.get('SUPABASE_SCHEMA') || 'public').trim() || 'public';
}

function stripEnvKeys(raw, keys) {
  const blocked = new Set(keys);
  const lines = raw ? raw.split(/\r?\n/) : [];
  return `${lines
    .filter((line) => {
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) return true;
      return !blocked.has(line.slice(0, eqIndex).trim());
    })
    .join('\n')
    .replace(/\n+$/, '')}\n`;
}

function upsertEnv(raw, updates) {
  const lines = raw ? raw.split(/\r?\n/) : [];
  const next = [...lines];
  for (const [key, value] of updates.entries()) {
    const idx = next.findIndex((line) => line.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) {
      next[idx] = line;
    } else {
      if (next.length && next[next.length - 1].trim() !== '') {
        next.push('');
      }
      next.push(line);
    }
  }
  return `${next.join('\n').replace(/\n+$/, '')}\n`;
}

function isMaskedKey(value) {
  return String(value || '').includes('····');
}
