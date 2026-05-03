#!/usr/bin/env node

import { resolve } from 'node:path';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';
import { summarizeLifecycleCandidates } from './lifecycle-call-tracker-backsync-core.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const credentials = resolveSupabaseCredentials(repoRoot);
const PAGE_SIZE = Number(process.env.CALL_TRACKER_AUDIT_PAGE_SIZE || 1000);

if (!credentials.url || !credentials.serviceRoleKey) {
  throw new Error('Missing Supabase credentials for call tracker live parity audit.');
}

function headers() {
  return {
    apikey: credentials.serviceRoleKey,
    Authorization: `Bearer ${credentials.serviceRoleKey}`,
    'Accept-Profile': credentials.schema,
  };
}

async function get(path) {
  const response = await fetch(`${credentials.url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    headers: headers(),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
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
    const page = await get(`${table}?${query}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

function meetingSetMissingCandidates(lifecycleRows, trackerDedupeKeys) {
  return lifecycleRows
    .filter((row) => row.event_type === 'meeting_set')
    .filter((row) => !trackerDedupeKeys.has(row.dedupe_key))
    .map((row) => ({
      lifecycle_event_id: row.id,
      dedupe_key: row.dedupe_key,
      crm_stage: row.crm_stage,
      created_at: row.created_at,
    }));
}

function outcomeMissingCandidates(lifecycleRows, trackerIds) {
  const outcomeStages = new Set(['Close Won', 'ENR', 'Close Lost', 'CL', 'Reschedule Pending', 'RSP', 'No Show', 'NS', 'Canceled', 'CAN']);
  return lifecycleRows
    .filter((row) => outcomeStages.has(row.crm_stage) || outcomeStages.has(row.task_status))
    .filter((row) => !trackerIds.has(row.id))
    .map((row) => ({
      lifecycle_event_id: row.id,
      event_type: row.event_type,
      crm_stage: row.crm_stage,
      task_status: row.task_status,
      created_at: row.created_at,
    }));
}

export async function runAudit() {
  const [summaryRows, lifecycleRows, callActivityRows, meetingRows, trackerRows] = await Promise.all([
    get('call_tracker_summary?select=*'),
    getPaged(
      'lifecycle_events',
      'id,athlete_key,athlete_id,athlete_main_id,event_type,dedupe_key,crm_stage,task_status,payload_json,created_at',
      'order=created_at.desc',
    ),
    getPaged('call_activity_events', 'task_id,payload_json'),
    getPaged('meeting_events', 'dedupe_key,payload_json'),
    getPaged('call_tracker_events', 'id,dedupe_key,tracker_outcome,counts_as_dial,counts_as_contact,counts_as_meeting_set,counts_as_post_meeting_outcome'),
  ]);

  const callActivityTaskIds = new Set(callActivityRows.map((row) => row.task_id).filter(Boolean));
  const trackerDedupeKeys = new Set(trackerRows.map((row) => row.dedupe_key).filter(Boolean));
  const trackerIds = new Set(trackerRows.map((row) => row.id).filter(Boolean));
  const missingMeetingSetCandidates = meetingSetMissingCandidates(lifecycleRows, trackerDedupeKeys);
  const missingOutcomeCandidates = outcomeMissingCandidates(lifecycleRows, trackerIds);
  const summary = summaryRows[0] || {};
  const lifecycleSummary = summarizeLifecycleCandidates(lifecycleRows, {
    callActivityTaskIds,
    callTrackerDedupeKeys: trackerDedupeKeys,
    alreadyInMeetingEvents: countWhere(meetingRows, (row) => row.dedupe_key),
    missingMeetingSetCandidates,
    missingOutcomeCandidates,
  });

  return {
    allTimeSummary: {
      dials: Number(summary.dials || 0),
      contacts: Number(summary.contacts || 0),
      meetings_set: Number(summary.meetings_set || 0),
      meeting_outcomes_total: Number(summary.meeting_outcomes_total || 0),
    },
    ...lifecycleSummary,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await runAudit(), null, 2));
}
