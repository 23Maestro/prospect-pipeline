#!/usr/bin/env node

import { resolve } from 'node:path';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';
import {
  buildCallActivityEventFromLifecycle,
  classifyLifecycleActivityCandidate,
} from './lifecycle-call-tracker-backsync-core.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const credentials = resolveSupabaseCredentials(repoRoot);
const PAGE_SIZE = Number(process.env.CALL_TRACKER_BACKSYNC_PAGE_SIZE || 1000);
const dryRun = process.argv.includes('--dry-run') || process.env.CALL_TRACKER_BACKSYNC_DRY_RUN === '1';

if (!credentials.url || !credentials.serviceRoleKey) {
  throw new Error('Missing Supabase credentials for lifecycle call activity backsync.');
}

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: credentials.serviceRoleKey,
    Authorization: `Bearer ${credentials.serviceRoleKey}`,
    'Accept-Profile': credentials.schema,
    'Content-Profile': credentials.schema,
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${credentials.url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: headers(options.headers || {}),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getPaged(table, select, extra = '') {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = [
      `select=${encodeURIComponent(select)}`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
      extra,
    ].filter(Boolean).join('&');
    const page = await request(`${table}?${query}`, { method: 'GET' });
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function upsertCallActivityEvents(rows) {
  if (!rows.length || dryRun) return;
  await request('call_activity_events?on_conflict=task_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

export async function runBacksync() {
  const [lifecycleRows, callActivityRows] = await Promise.all([
    getPaged(
      'lifecycle_events',
      'id,athlete_key,athlete_id,athlete_main_id,event_type,dedupe_key,crm_stage,task_status,payload_json,created_at',
      'order=created_at.asc',
    ),
    getPaged('call_activity_events', 'task_id'),
  ]);
  const existingTaskIds = new Set(callActivityRows.map((row) => row.task_id).filter(Boolean));
  const excludedRowsByReason = {};
  const rowsToUpsert = [];

  for (const row of lifecycleRows) {
    const candidate = classifyLifecycleActivityCandidate(row);
    if (!candidate.eligible) {
      increment(excludedRowsByReason, candidate.reason);
      continue;
    }
    if (existingTaskIds.has(candidate.taskId)) continue;
    const activityRow = buildCallActivityEventFromLifecycle(row);
    if (!activityRow) continue;
    rowsToUpsert.push(activityRow);
    existingTaskIds.add(activityRow.task_id);
  }

  await upsertCallActivityEvents(rowsToUpsert);
  return {
    dryRun,
    promotedLifecycleRows: rowsToUpsert.length,
    promotedContacts: rowsToUpsert.filter((row) => row.payload_json.counts_as_contact === true).length,
    promotedDials: rowsToUpsert.filter((row) => row.payload_json.counts_as_dial === true).length,
    excludedRowsByReason,
    taskIds: rowsToUpsert.map((row) => row.task_id),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runBacksync(), null, 2));
}
