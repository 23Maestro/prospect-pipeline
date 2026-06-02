import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCallLogBackfillSql,
  inferCallLogFactType,
  inferCallLogSourceFamily,
  projectEventRowToCallLog,
  summarizeAuditResult,
  summarizeCallLogProjection,
  summarizeCallLogTargetParity,
} from './audit-call-tracker-live-parity.mjs';

const source = readFileSync(new URL('./audit-call-tracker-live-parity.mjs', import.meta.url), 'utf8');

test('call tracker live parity script stays read-only', () => {
  assert.match(source, /targetShape: 'call_log'/);
  assert.doesNotMatch(source, /call_tracker_events_owner_context/);
  assert.doesNotMatch(source, /call_tracker_summary/);
  assert.doesNotMatch(source, /call_tracker_events['"`]/);
  assert.doesNotMatch(source, /\bPOST\b/);
  assert.doesNotMatch(source, /\bPATCH\b/);
  assert.doesNotMatch(source, /\bDELETE\b/);
  assert.doesNotMatch(source, /\bupsert\w*\(/);
  assert.doesNotMatch(source, /\binsert\w*\(/);
  assert.doesNotMatch(source, /\bdeleteRows\(/);
});

test('call activity owner-context rows project into call_log shape', () => {
  const row = projectEventRowToCallLog({
    id: 'activity-row-1',
    raw_event_type: 'call_activity',
    source: 'call_activity',
    tracker_outcome: 'spoke_follow_up',
    occurred_at: '2026-06-01T14:00:00Z',
    reporting_at: '2026-06-01T14:00:00Z',
    athlete_key: 'athlete:1',
    athlete_name: 'Ryan Example',
    raw_task_status: 'spoke_to_follow_up',
    dedupe_key: 'activity:task-1',
    compatibility_source_owner: 'Jerami Singleton',
    compatibility_owner_proof: 'task_assigned_owner',
    active_operator_key: 'jerami_singleton',
    counts_as_dial: true,
    counts_as_contact: true,
    counts_as_meeting_set: false,
    counts_as_post_meeting_outcome: false,
  });

  assert.equal(row.fact_type, 'call_activity');
  assert.equal(row.source_family, 'call_activity_events');
  assert.equal(row.dedupe_key, 'activity:task-1');
  assert.equal(row.counts_as_dial, true);
  assert.equal(row.counts_as_contact, true);
  assert.equal(row.counts_as_meeting_set, false);
  assert.equal(row.counts_as_post_meeting_outcome, false);
});

test('meeting set rows project as lifecycle-backed call_log facts', () => {
  const input = {
    id: 'meeting-set-row-1',
    raw_event_type: 'lifecycle_meeting_set',
    tracker_outcome: 'meeting_set',
    occurred_at: '2026-06-01T15:00:00Z',
    event_at: '2026-06-02T23:00:00Z',
    reporting_at: '2026-06-01T15:00:00Z',
    appointment_id: 'appt-1',
    live_event_id: 'event-1',
    booked_event_title: 'Ryan Example - Meeting Set',
    counts_as_dial: true,
    counts_as_contact: true,
    counts_as_meeting_set: true,
    counts_as_post_meeting_outcome: false,
  };

  assert.equal(inferCallLogFactType(input), 'meeting_set');
  assert.equal(inferCallLogSourceFamily(input), 'lifecycle_events');

  const row = projectEventRowToCallLog(input);
  assert.equal(row.fact_type, 'meeting_set');
  assert.equal(row.source_family, 'lifecycle_events');
  assert.equal(row.dedupe_key, 'meeting_set:event:event-1');
  assert.equal(row.appointment_id, 'appt-1');
  assert.equal(row.live_event_id, 'event-1');
});

test('post-meeting rows project as meeting_events call_log facts', () => {
  const row = projectEventRowToCallLog({
    id: 'outcome-row-1',
    raw_event_type: 'post_meeting_outcome',
    source: 'legacy_sales_stage_current',
    tracker_outcome: 'closed_won',
    raw_crm_stage: 'Actual Meeting - Close Won',
    occurred_at: '2026-06-03T00:00:00Z',
    event_at: '2026-06-02T23:00:00Z',
    reporting_at: '2026-06-02T23:00:00Z',
    appointment_id: 'appt-1',
    revenue_cents: 500000,
    counts_as_dial: false,
    counts_as_contact: false,
    counts_as_meeting_set: false,
    counts_as_post_meeting_outcome: true,
  });

  assert.equal(row.fact_type, 'post_meeting_outcome');
  assert.equal(row.source_family, 'meeting_events');
  assert.equal(row.source_system, 'legacy_sales_stage_current');
  assert.equal(row.counts_as_post_meeting_outcome, true);
  assert.equal(row.revenue_cents, 500000);
  assert.equal(row.dedupe_key, 'post_meeting_outcome:appointment:appt-1');
});

test('call_log projection summary reports parity and required-field gaps', () => {
  const rows = [
    projectEventRowToCallLog({
      id: 'activity-row-1',
      raw_event_type: 'call_activity',
      tracker_outcome: 'spoke_follow_up',
      occurred_at: '2026-06-01T14:00:00Z',
      reporting_at: '2026-06-01T14:00:00Z',
      dedupe_key: 'activity:task-1',
      counts_as_dial: true,
      counts_as_contact: true,
    }),
    projectEventRowToCallLog({
      id: 'meeting-set-row-1',
      raw_event_type: 'lifecycle_meeting_set',
      tracker_outcome: 'meeting_set',
      occurred_at: '2026-06-01T15:00:00Z',
      reporting_at: '2026-06-01T15:00:00Z',
      counts_as_dial: true,
      counts_as_contact: true,
      counts_as_meeting_set: true,
    }),
    projectEventRowToCallLog({
      id: 'outcome-row-1',
      raw_event_type: 'post_meeting_outcome',
      tracker_outcome: 'closed_won',
      occurred_at: '2026-06-03T00:00:00Z',
      reporting_at: '2026-06-03T00:00:00Z',
      revenue_cents: 500000,
      counts_as_post_meeting_outcome: true,
    }),
  ];

  const summary = summarizeCallLogProjection(rows, {
    dials: 2,
    contacts: 2,
    meetings_set: 1,
    meeting_outcomes_total: 1,
    closed_won: 1,
    money_earned_cents: 500000,
  });

  assert.equal(summary.targetShape, 'call_log');
  assert.equal(summary.parity, true);
  assert.deepEqual(summary.deltas, {
    dials: 0,
    contacts: 0,
    meetings_set: 0,
    meeting_outcomes_total: 0,
    closed_won: 0,
    money_earned_cents: 0,
  });
  assert.equal(summary.missingRequiredFields.reporting_at, 0);
  assert.equal(summary.missingRequiredFields.dedupe_key, 0);
  assert.equal(summary.missingRequiredFields.invalid_source_family, 0);
  assert.equal(summary.missingRequiredFields.invalid_count_shape, 0);
  assert.deepEqual(summary.sourceFamilies, ['call_activity_events', 'lifecycle_events', 'meeting_events']);
});

test('summary output keeps live audit results compact without losing call_log parity', () => {
  const compact = summarizeAuditResult({
    allTimeSummary: { dials: 2, contacts: 2, meetings_set: 1, meeting_outcomes_total: 1 },
    callLogProjection: { parity: true, deltas: { dials: 0 } },
    callLogTarget: { available: true, parity: false },
    missingMeetingSetCandidates: [{ id: 'one' }, { id: 'two' }],
    missingOutcomeCandidates: [{ id: 'three' }],
    suspectedAllTimeContactGap: 0,
    suspectedAllTimeDialGap: 0,
    safeDialCandidates: 2,
    safeContactCandidates: 2,
    uniqueSafeActivityTaskCount: 2,
    uniqueSafeContactTaskCount: 2,
    uniqueSafeDialTaskCount: 2,
    uniqueMissingActivityTaskCount: 0,
    uniqueMissingContactTaskCount: 0,
    uniqueMissingDialTaskCount: 0,
    excludedRowsByReason: { missing_operator_proof: 1 },
  });

  assert.equal(compact.callLogProjection.parity, true);
  assert.equal(compact.callLogTarget.parity, false);
  assert.equal(compact.lifecycleCandidateSummary.missingMeetingSetCandidates, 2);
  assert.equal(compact.lifecycleCandidateSummary.missingOutcomeCandidates, 1);
  assert.equal(compact.missingMeetingSetCandidates, undefined);
  assert.equal(compact.missingOutcomeCandidates, undefined);
});

test('call_log target parity reports unavailable live target without throwing', () => {
  const target = summarizeCallLogTargetParity([], [], {
    available: false,
    error: 'call_log not found',
  });

  assert.equal(target.available, false);
  assert.equal(target.projectedRows, 0);
  assert.equal(target.targetRows, 0);
  assert.equal(target.parity, false);
  assert.match(target.error, /not found/);
});

test('call_log target parity detects missing and extra dedupe keys', () => {
  const projectedRows = [
    {
      fact_type: 'call_activity',
      dedupe_key: 'activity:one',
      tracker_outcome: 'left_voicemail_1',
      source_family: 'call_activity_events',
      reporting_at: '2026-06-02T00:00:00Z',
      counts_as_dial: true,
      counts_as_contact: false,
      counts_as_meeting_set: false,
      counts_as_post_meeting_outcome: false,
      revenue_cents: null,
    },
    {
      fact_type: 'post_meeting_outcome',
      dedupe_key: 'outcome:one',
      tracker_outcome: 'closed_won',
      source_family: 'meeting_events',
      reporting_at: '2026-06-02T00:00:00Z',
      counts_as_dial: false,
      counts_as_contact: false,
      counts_as_meeting_set: false,
      counts_as_post_meeting_outcome: true,
      revenue_cents: 9900,
    },
  ];
  const targetRows = [
    {
      dedupe_key: 'activity:one',
      tracker_outcome: 'left_voicemail_1',
      counts_as_dial: true,
      counts_as_contact: false,
      counts_as_meeting_set: false,
      counts_as_post_meeting_outcome: false,
      revenue_cents: null,
    },
    {
      dedupe_key: 'extra:one',
      tracker_outcome: 'meeting_set',
      counts_as_dial: true,
      counts_as_contact: true,
      counts_as_meeting_set: true,
      counts_as_post_meeting_outcome: false,
      revenue_cents: null,
    },
  ];

  const target = summarizeCallLogTargetParity(projectedRows, targetRows);

  assert.equal(target.available, true);
  assert.equal(target.projectedRows, 2);
  assert.equal(target.targetRows, 2);
  assert.equal(target.missingInTarget, 1);
  assert.equal(target.extraInTarget, 1);
  assert.equal(target.deltas.closed_won, -1);
  assert.equal(target.parity, false);
});

test('backfill SQL preserves raw provenance while inserting canonical source families', () => {
  const projectedRows = [
    projectEventRowToCallLog({
      id: 'outcome-row-1',
      raw_event_type: 'post_meeting_outcome',
      source: 'legacy_sales_stage_current',
      tracker_outcome: 'closed_won',
      raw_crm_stage: 'Actual Meeting - Close Won',
      occurred_at: '2026-06-03T00:00:00Z',
      reporting_at: '2026-06-03T00:00:00Z',
      appointment_id: 'appt-1',
      revenue_cents: 500000,
      counts_as_post_meeting_outcome: true,
      payload_json: { source: 'legacy_sales_stage_current' },
    }),
  ];

  const sql = buildCallLogBackfillSql(projectedRows, { generatedAt: '2026-06-02T00:00:00.000Z' });

  assert.match(sql, /insert into public\.call_log/i);
  assert.match(sql, /on conflict \(dedupe_key\) do update set/i);
  assert.match(sql, /'meeting_events'/);
  assert.match(sql, /'legacy_sales_stage_current'/);
  assert.match(sql, /-- insertable_rows: 1/);
  assert.match(sql, /-- skipped_rows_not_insertable: 0/);
});

test('backfill SQL skips projected rows missing required call_log fields', () => {
  const sql = buildCallLogBackfillSql([
    {
      fact_type: 'call_activity',
      tracker_outcome: 'needs_review',
      reporting_at: null,
      source_family: 'call_activity_events',
      dedupe_key: 'activity:missing-clock',
      payload_json: {},
    },
  ], { generatedAt: '2026-06-02T00:00:00.000Z' });

  assert.match(sql, /-- projected_rows: 1/);
  assert.match(sql, /-- insertable_rows: 0/);
  assert.match(sql, /-- skipped_rows_not_insertable: 1/);
});

test('backfill SQL skips projected rows with non-canonical source families', () => {
  const sql = buildCallLogBackfillSql([
    {
      fact_type: 'post_meeting_outcome',
      tracker_outcome: 'closed_won',
      occurred_at: '2026-06-03T00:00:00Z',
      reporting_at: '2026-06-03T00:00:00Z',
      source_family: 'legacy_sales_stage_current',
      dedupe_key: 'bad-family',
      payload_json: {},
    },
  ], { generatedAt: '2026-06-02T00:00:00.000Z' });

  assert.match(sql, /-- projected_rows: 1/);
  assert.match(sql, /-- insertable_rows: 0/);
  assert.match(sql, /-- skipped_rows_not_insertable: 1/);
  assert.doesNotMatch(sql, /insert into public\.call_log/i);
});

test('backfill SQL skips projected rows that would violate count-shape constraints', () => {
  const sql = buildCallLogBackfillSql([
    {
      fact_type: 'call_activity',
      tracker_outcome: 'spoke_follow_up',
      occurred_at: '2026-06-03T00:00:00Z',
      reporting_at: '2026-06-03T00:00:00Z',
      source_family: 'meeting_events',
      dedupe_key: 'bad-count-shape',
      counts_as_dial: false,
      counts_as_contact: false,
      counts_as_meeting_set: false,
      counts_as_post_meeting_outcome: false,
      counts_as_enrollment: false,
      payload_json: {},
    },
  ], { generatedAt: '2026-06-02T00:00:00.000Z' });

  assert.match(sql, /-- projected_rows: 1/);
  assert.match(sql, /-- insertable_rows: 0/);
  assert.match(sql, /-- skipped_rows_not_insertable: 1/);
  assert.doesNotMatch(sql, /insert into public\.call_log/i);
});
