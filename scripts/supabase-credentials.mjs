#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function readEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!key) continue;
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function readRepoEnv(cwd = process.cwd()) {
  return {
    ...readEnvFile(path.join(cwd, 'npid-api-layer/.env')),
    ...readEnvFile(path.join(cwd, '.env')),
    ...readEnvFile(path.join(cwd, '.overmind.env')),
  };
}

export function readLinkedProjectRef(cwd = process.cwd()) {
  const refPath = path.join(cwd, 'supabase/.temp/project-ref');
  try {
    return fs.readFileSync(refPath, 'utf8').trim();
  } catch {
    return '';
  }
}

export function readLinkedSupabaseUrl(cwd = process.cwd()) {
  const ref = readLinkedProjectRef(cwd);
  return ref ? `https://${ref}.supabase.co` : '';
}

export function readLinkedServiceRoleKey(cwd = process.cwd()) {
  const ref = readLinkedProjectRef(cwd);
  if (!ref) {
    return '';
  }

  try {
    const output = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const keys = JSON.parse(output);
    const serviceRole = Array.isArray(keys)
      ? keys.find((entry) => entry?.id === 'service_role' || entry?.name === 'service_role')
      : null;
    return String(serviceRole?.api_key || '').trim();
  } catch {
    return '';
  }
}

export function resolveSupabaseCredentials(cwd = process.cwd()) {
  const projectRef = readLinkedProjectRef(cwd);
  const repoEnv = readRepoEnv(cwd);
  const url =
    String(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || '').trim().replace(/\/+$/, '') ||
    readLinkedSupabaseUrl(cwd);
  const serviceRoleKey =
    String(
      process.env.SUPABASE_SECRET_KEY ||
        repoEnv.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
        '',
    ).trim() ||
    readLinkedServiceRoleKey(cwd);

  return {
    projectRef,
    url,
    serviceRoleKey,
    schema:
      String(process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || 'public').trim() || 'public',
  };
}
