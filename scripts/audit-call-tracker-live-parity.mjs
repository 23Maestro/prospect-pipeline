#!/usr/bin/env node

import { resolve } from 'node:path';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';
import { summarizeLifecycleCandidates } from './lifecycle-call-tracker-backsync-core.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const credentials = resolveSupabaseCredentials(repoRoot);
const PAGE_SIZE = Number(process.env.CALL_TRACKER_AUDIT_PAGE_SIZE || 1000);
const summaryOnly = process.argv.includes('--summary');
const backfillSqlOnly = process.argv.includes('--backfill-sql');
const CANONICAL_CALL_LOG_SOURCE_FAMILIES = new Set([
  'call_activity_events',
  'lifecycle_events',
  'meeting_events',
]);

function headers() {
  if (!credentials.url || !credentials.serviceRoleKey) {
    throw new Error('Missing Supabase credentials for call tracker live parity audit.');
  }
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

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value, type = 'text') {
  if (value === null || value === undefined) return 'null';
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'integer') return Number.isFinite(Number(value)) ? String(Number(value)) : 'null';
  if (type === 'jsonb') return `${sqlString(JSON.stringify(value || {}))}::jsonb`;
  if (type === 'timestamptz') return `${sqlString(value)}::timestamptz`;
  return sqlString(value);
}

export function inferCallLogFactType(row) {
  if (bool(row.counts_as_meeting_set) || row.tracker_outcome === 'meeting_set') return 'meeting_set';
  if (bool(row.counts_as_post_meeting_outcome)) return 'post_meeting_outcome';
  return 'call_activity';
}

export function inferCallLogSourceFamily(row) {
  const rawEventType = String(row.raw_event_type || '').trim();
  const source = String(row.source || '').trim();
  if (rawEventType === 'call_activity' || row.source === 'call_activity') return 'call_activity_events';
  if (rawEventType === 'lifecycle_meeting_set' || rawEventType === 'meeting_set') return 'lifecycle_events';
  if (source === 'legacy_sales_stage_current') return 'meeting_events';
  if (rawEventType === 'post_meeting_outcome' || bool(row.counts_as_post_meeting_outcome)) return 'meeting_events';
  return firstText(row.source, rawEventType, 'unknown');
}

export function projectEventRowToCallLog(row) {
  const factType = inferCallLogFactType(row);
  const reportingAt = firstText(row.reporting_at, row.event_at, row.occurred_at);
  const dedupeKey = firstText(
    row.dedupe_key,
    row.live_event_id && `${factType}:event:${row.live_event_id}`,
    row.appointment_id && `${factType}:appointment:${row.appointment_id}`,
    row.id && `${factType}:row:${row.id}`,
  );

  return {
    fact_type: factType,
    tracker_outcome: firstText(row.tracker_outcome, 'needs_review'),
    occurred_at: firstText(row.occurred_at, reportingAt),
    event_at: firstText(row.event_at, row.occurred_at),
    reporting_at: reportingAt,
    athlete_key: firstText(row.athlete_key),
    athlete_id: firstText(row.athlete_id),
    athlete_main_id: firstText(row.athlete_main_id),
    athlete_name: firstText(row.athlete_name),
    appointment_id: firstText(row.appointment_id),
    live_event_id: firstText(row.live_event_id),
    booked_event_title: firstText(row.booked_event_title),
    raw_crm_stage: firstText(row.raw_crm_stage),
    raw_task_status: firstText(row.raw_task_status),
    raw_event_type: firstText(row.raw_event_type),
    source_family: inferCallLogSourceFamily(row),
    source_table: inferCallLogSourceFamily(row),
    source_row_id: firstText(row.id),
    source_system: firstText(row.source),
    source_owner: firstText(row.compatibility_source_owner, row.source_owner),
    owner_proof: firstText(row.compatibility_owner_proof, row.owner_proof, row.resolved_owner_source_field),
    active_operator_key: firstText(row.active_operator_key),
    active_operator_name: firstText(row.active_operator_name),
    task_assigned_owner: firstText(row.task_assigned_owner),
    resolved_owner_name: firstText(row.resolved_owner_name),
    resolved_owner_role: firstText(row.resolved_owner_role),
    resolved_owner_source_field: firstText(row.resolved_owner_source_field),
    resolved_owner_source_value: firstText(row.resolved_owner_source_value),
    materialization_status: firstText(row.materialization_status),
    materialization_reason: firstText(row.materialization_reason),
    can_materialize_for_active_operator: bool(row.can_materialize_for_active_operator),
    counts_as_dial: bool(row.counts_as_dial),
    counts_as_contact: bool(row.counts_as_contact),
    counts_as_meeting_set: bool(row.counts_as_meeting_set),
    counts_as_post_meeting_outcome: bool(row.counts_as_post_meeting_outcome),
    counts_as_enrollment: false,
    revenue_cents: row.revenue_cents === null || row.revenue_cents === undefined ? null : Number(row.revenue_cents),
    dedupe_key: dedupeKey,
    payload_json: row.payload_json || {},
  };
}

export function summarizeCallLogProjection(projectedRows, summary = {}) {
  const projected = {
    dials: countWhere(projectedRows, (row) => row.counts_as_dial),
    contacts: countWhere(projectedRows, (row) => row.counts_as_contact),
    meetings_set: countWhere(projectedRows, (row) => row.counts_as_meeting_set),
    meeting_outcomes_total: countWhere(projectedRows, (row) => row.counts_as_post_meeting_outcome),
    closed_won: countWhere(projectedRows, (row) => row.tracker_outcome === 'closed_won'),
    money_earned_cents: projectedRows
      .filter((row) => row.tracker_outcome === 'closed_won')
      .reduce((total, row) => total + (Number(row.revenue_cents) || 0), 0),
  };
  const current = {
    dials: Number(summary.dials || 0),
    contacts: Number(summary.contacts || 0),
    meetings_set: Number(summary.meetings_set || 0),
    meeting_outcomes_total: Number(summary.meeting_outcomes_total || 0),
    closed_won: Number(summary.closed_won || 0),
    money_earned_cents: Number(summary.money_earned_cents || 0),
  };

  const deltas = Object.fromEntries(
    Object.keys(projected).map((key) => [key, projected[key] - current[key]]),
  );

  return {
    projectionSource: 'call_tracker_events_owner_context',
    targetShape: 'call_log',
    rows: projectedRows.length,
    sourceFamilies: [...new Set(projectedRows.map((row) => row.source_family).filter(Boolean))].sort(),
    projected,
    current,
    deltas,
    parity: Object.values(deltas).every((value) => value === 0),
    missingRequiredFields: {
      dedupe_key: countWhere(projectedRows, (row) => !row.dedupe_key),
      reporting_at: countWhere(projectedRows, (row) => !row.reporting_at),
      tracker_outcome: countWhere(projectedRows, (row) => !row.tracker_outcome),
      source_family: countWhere(projectedRows, (row) => !row.source_family),
      invalid_source_family: countWhere(
        projectedRows,
        (row) => row.source_family && !CANONICAL_CALL_LOG_SOURCE_FAMILIES.has(row.source_family),
      ),
    },
  };
}

const CALL_LOG_BACKFILL_COLUMNS = [
  ['fact_type', 'text'],
  ['tracker_outcome', 'text'],
  ['occurred_at', 'timestamptz'],
  ['event_at', 'timestamptz'],
  ['reporting_at', 'timestamptz'],
  ['athlete_key', 'text'],
  ['athlete_id', 'text'],
  ['athlete_main_id', 'text'],
  ['athlete_name', 'text'],
  ['appointment_id', 'text'],
  ['live_event_id', 'text'],
  ['booked_event_title', 'text'],
  ['raw_crm_stage', 'text'],
  ['raw_task_status', 'text'],
  ['raw_event_type', 'text'],
  ['source_family', 'text'],
  ['source_table', 'text'],
  ['source_row_id', 'text'],
  ['source_system', 'text'],
  ['source_owner', 'text'],
  ['owner_proof', 'text'],
  ['active_operator_key', 'text'],
  ['active_operator_name', 'text'],
  ['task_assigned_owner', 'text'],
  ['resolved_owner_name', 'text'],
  ['resolved_owner_role', 'text'],
  ['resolved_owner_source_field', 'text'],
  ['resolved_owner_source_value', 'text'],
  ['materialization_status', 'text'],
  ['materialization_reason', 'text'],
  ['can_materialize_for_active_operator', 'boolean'],
  ['counts_as_dial', 'boolean'],
  ['counts_as_contact', 'boolean'],
  ['counts_as_meeting_set', 'boolean'],
  ['counts_as_post_meeting_outcome', 'boolean'],
  ['counts_as_enrollment', 'boolean'],
  ['revenue_cents', 'integer'],
  ['dedupe_key', 'text'],
  ['payload_json', 'jsonb'],
];

export function buildCallLogBackfillSql(projectedRows, { generatedAt = new Date().toISOString() } = {}) {
  const columns = CALL_LOG_BACKFILL_COLUMNS.map(([column]) => column);
  const rows = projectedRows.filter((row) =>
    row.dedupe_key &&
    row.reporting_at &&
    row.tracker_outcome &&
    CANONICAL_CALL_LOG_SOURCE_FAMILIES.has(row.source_family)
  );
  const skippedRows = projectedRows.length - rows.length;
  const updateColumns = columns.filter((column) => !['dedupe_key'].includes(column));

  if (!rows.length) {
    return [
      '-- Generated by scripts/audit-call-tracker-live-parity.mjs --backfill-sql',
      '-- Review before applying. This script only prints SQL; it does not execute writes.',
      `-- generated_at: ${generatedAt}`,
      `-- projected_rows: ${projectedRows.length}`,
      '-- insertable_rows: 0',
      `-- skipped_rows_not_insertable: ${skippedRows}`,
      '-- No insertable rows met the call_log required-field and source-family contract.',
      '',
    ].join('\n');
  }

  const valuesSql = rows.map((row) => {
    const values = CALL_LOG_BACKFILL_COLUMNS.map(([column, type]) => sqlValue(row[column], type));
    return `  (${values.join(', ')})`;
  });

  return [
    '-- Generated by scripts/audit-call-tracker-live-parity.mjs --backfill-sql',
    '-- Review before applying. This script only prints SQL; it does not execute writes.',
    `-- generated_at: ${generatedAt}`,
    `-- projected_rows: ${projectedRows.length}`,
    `-- insertable_rows: ${rows.length}`,
    `-- skipped_rows_not_insertable: ${skippedRows}`,
    'begin;',
    '',
    `insert into public.call_log (${columns.join(', ')})`,
    valuesSql.length ? `values\n${valuesSql.join(',\n')}` : 'values',
    'on conflict (dedupe_key) do update set',
    updateColumns.map((column) => `  ${column} = excluded.${column}`).join(',\n') + ',',
    '  updated_at = now();',
    '',
    'commit;',
    '',
  ].join('\n');
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

export async function runAudit({ includeProjectedRows = false } = {}) {
  if (!credentials.url || !credentials.serviceRoleKey) {
    throw new Error('Missing Supabase credentials for call tracker live parity audit.');
  }

  const [summaryRows, lifecycleRows, callActivityRows, meetingRows, trackerRows, ownerContextRows] = await Promise.all([
    get('call_tracker_summary?select=*'),
    getPaged(
      'lifecycle_events',
      'id,athlete_key,athlete_id,athlete_main_id,event_type,dedupe_key,crm_stage,task_status,payload_json,created_at',
      'order=created_at.desc',
    ),
    getPaged('call_activity_events', 'task_id,payload_json'),
    getPaged('meeting_events', 'dedupe_key,payload_json'),
    getPaged('call_tracker_events', 'id,dedupe_key,tracker_outcome,counts_as_dial,counts_as_contact,counts_as_meeting_set,counts_as_post_meeting_outcome'),
    getPaged(
      'call_tracker_events_owner_context',
      [
        'id',
        'athlete_key',
        'athlete_id',
        'athlete_main_id',
        'athlete_name',
        'occurred_at',
        'event_at',
        'reporting_at',
        'source',
        'tracker_outcome',
        'raw_crm_stage',
        'raw_task_status',
        'raw_event_type',
        'appointment_id',
        'live_event_id',
        'booked_event_title',
        'revenue_cents',
        'dedupe_key',
        'active_operator_key',
        'active_operator_name',
        'task_assigned_owner',
        'resolved_owner_name',
        'resolved_owner_role',
        'resolved_owner_source_field',
        'resolved_owner_source_value',
        'materialization_status',
        'materialization_reason',
        'compatibility_source_owner',
        'compatibility_owner_proof',
        'can_materialize_for_active_operator',
        'counts_as_dial',
        'counts_as_contact',
        'counts_as_meeting_set',
        'counts_as_post_meeting_outcome',
        'payload_json',
      ].join(','),
    ),
  ]);

  const callActivityTaskIds = new Set(callActivityRows.map((row) => row.task_id).filter(Boolean));
  const trackerDedupeKeys = new Set(trackerRows.map((row) => row.dedupe_key).filter(Boolean));
  const trackerIds = new Set(trackerRows.map((row) => row.id).filter(Boolean));
  const missingMeetingSetCandidates = meetingSetMissingCandidates(lifecycleRows, trackerDedupeKeys);
  const missingOutcomeCandidates = outcomeMissingCandidates(lifecycleRows, trackerIds);
  const summary = summaryRows[0] || {};
  const projectedCallLogRows = ownerContextRows.map(projectEventRowToCallLog);
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
    ...(includeProjectedRows ? { projectedCallLogRows } : {}),
    callLogProjection: summarizeCallLogProjection(projectedCallLogRows, summary),
    ...lifecycleSummary,
  };
}

export function summarizeAuditResult(result) {
  return {
    allTimeSummary: result.allTimeSummary,
    callLogProjection: result.callLogProjection,
    lifecycleCandidateSummary: {
      suspectedAllTimeContactGap: result.suspectedAllTimeContactGap,
      suspectedAllTimeDialGap: result.suspectedAllTimeDialGap,
      safeDialCandidates: result.safeDialCandidates,
      safeContactCandidates: result.safeContactCandidates,
      uniqueSafeActivityTaskCount: result.uniqueSafeActivityTaskCount,
      uniqueSafeContactTaskCount: result.uniqueSafeContactTaskCount,
      uniqueSafeDialTaskCount: result.uniqueSafeDialTaskCount,
      uniqueMissingActivityTaskCount: result.uniqueMissingActivityTaskCount,
      uniqueMissingContactTaskCount: result.uniqueMissingContactTaskCount,
      uniqueMissingDialTaskCount: result.uniqueMissingDialTaskCount,
      excludedRowsByReason: result.excludedRowsByReason,
      missingMeetingSetCandidates: result.missingMeetingSetCandidates?.length || 0,
      missingOutcomeCandidates: result.missingOutcomeCandidates?.length || 0,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runAudit({ includeProjectedRows: backfillSqlOnly });
  if (backfillSqlOnly) {
    console.log(buildCallLogBackfillSql(result.projectedCallLogRows));
  } else {
    console.log(JSON.stringify(summaryOnly ? summarizeAuditResult(result) : result, null, 2));
  }
}
