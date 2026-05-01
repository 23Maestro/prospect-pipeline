#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLinkedProjectRef, readLinkedSupabaseUrl } from './supabase-credentials.mjs';

const cwd = process.cwd();
const projectRef = readLinkedProjectRef(cwd);
const supabaseUrl = readLinkedSupabaseUrl(cwd);

if (!projectRef || !supabaseUrl) {
  console.error('Missing linked Supabase project. Run `supabase link` first.');
  process.exit(1);
}

let publicKey = '';
try {
  const output = execFileSync(
    'supabase',
    ['projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const keys = JSON.parse(output);
  const publishable = Array.isArray(keys)
    ? keys.find((entry) => String(entry?.api_key || '').startsWith('sb_publishable_'))
    : null;
  const anon = Array.isArray(keys)
    ? keys.find((entry) => entry?.id === 'anon' || entry?.name === 'anon')
    : null;
  publicKey = String(publishable?.api_key || anon?.api_key || '').trim();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
}

if (!publicKey) {
  console.error('Could not read a Supabase publishable or anon key from the linked project.');
  process.exit(1);
}

const target = path.join(cwd, 'npid-api-layer/app/static/call-tracker/config.js');
const contents = `window.CALL_TRACKER_CONFIG = ${JSON.stringify(
  {
    supabaseUrl,
    anonKey: publicKey,
    schema: 'public',
  },
  null,
  2,
)};\n`;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, contents, 'utf8');
console.log(target);
