#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, '.env');
const targets = [
  path.join(root, '.overmind.env'),
  path.join(root, 'npid-api-layer/.env'),
];

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

const sourceEnv = parseEnv(readEnvFile(sourcePath));
const hasSecretKey = Boolean(String(sourceEnv.get('SUPABASE_SECRET_KEY') || '').trim());
const hasLegacyKey = Boolean(String(sourceEnv.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim());
const requiredKeys = ['SUPABASE_URL', 'SUPABASE_SCHEMA'];
const missing = requiredKeys.filter((key) => !String(sourceEnv.get(key) || '').trim());

if (!hasSecretKey && !hasLegacyKey) {
  missing.push('SUPABASE_SECRET_KEY');
}

if (missing.length) {
  console.error(
    `Missing ${missing.join(', ')} in ${sourcePath}. Update .env first, then rerun this script.`,
  );
  process.exit(1);
}

const updates = new Map(requiredKeys.map((key) => [key, String(sourceEnv.get(key) || '').trim()]));
if (hasSecretKey) {
  updates.set('SUPABASE_SECRET_KEY', String(sourceEnv.get('SUPABASE_SECRET_KEY') || '').trim());
} else if (hasLegacyKey) {
  updates.set('SUPABASE_SERVICE_ROLE_KEY', String(sourceEnv.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim());
}

for (const targetPath of targets) {
  const current = readEnvFile(targetPath);
  const stripped = stripEnvKeys(current, ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  const updated = upsertEnv(stripped, updates);
  fs.writeFileSync(targetPath, updated);
  console.log(`Updated ${targetPath}`);
}
