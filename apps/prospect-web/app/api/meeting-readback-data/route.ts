import { NextResponse } from 'next/server';
import { getServerEnv } from '../../../lib/env';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EVENT_LIMIT = Number(process.env.MEETING_READBACK_EVENT_LIMIT || 1000);
const TIME_ZONE = 'America/New_York';
const PAYLOAD_FIELD = ['payload', 'json'].join('_');
const MATERIALIZATION_REASON_FIELD = ['materialization', 'reason'].join('_');

const meetingOutcomes = new Set([
  'meeting_set',
  'closed_won',
  'closed_lost',
  'no_show',
  'canceled',
  'reschedule_pending',
  'rescheduled',
]);

const callLogFields = [
  'athlete_name',
  'occurred_at',
  'event_at',
  'reporting_at',
  'tracker_outcome',
  'raw_crm_stage',
  'raw_task_status',
  'raw_event_type',
  'source_system',
  'appointment_id',
  'booked_event_title',
  'revenue_cents',
  'counts_as_meeting_set',
  'counts_as_post_meeting_outcome',
  'materialization_status',
  MATERIALIZATION_REASON_FIELD,
  'active_operator_name',
  'task_assigned_owner',
  'resolved_owner_name',
  'resolved_owner_source_field',
  'can_materialize_for_active_operator',
  PAYLOAD_FIELD,
  'created_at',
];

const lifecycleFields = [
  'id',
  'athlete_key',
  'athlete_id',
  'athlete_main_id',
  'event_type',
  'previous_crm_stage',
  'previous_task_status',
  'crm_stage',
  'task_status',
  PAYLOAD_FIELD,
  'created_at',
];

const appointmentFields = [
  'id',
  'athlete_key',
  'athlete_id',
  'athlete_main_id',
  'head_scout',
  'starts_at',
  'status',
  'source_event_id',
  'meeting_timezone',
  'meeting_timezone_label',
  'calendar_timezone',
  'previous_appointment_id',
  'original_appointment_id',
  'reschedule_sequence',
  'operator_owner',
  'operator_owner_key',
  'head_scout_key',
  'appointment_role',
  'status_reason',
  'source_system',
  'created_at',
  'updated_at',
];

const athleteFields = [
  'athlete_key',
  'athlete_name',
];

const activeAppointmentStatuses = new Set([
  'scheduled',
  'rescheduled',
  'reschedule_pending',
  'confirmation_queued',
  'confirmation_sent',
]);

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('cache-control', 'no-store, max-age=0');
  return response;
}

function getSupabaseConfig() {
  const url = getServerEnv('SUPABASE_URL') || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = getServerEnv('SUPABASE_SECRET_KEY') || getServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  const schema = getServerEnv('SUPABASE_SCHEMA') || 'public';
  if (!url || !key) {
    throw new Error('Missing Supabase server credentials for live meeting readback.');
  }
  return { url: url.replace(/\/+$/, ''), key, schema };
}

async function supabaseGet(path: string) {
  const { url, key, schema } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': schema,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function payload(row: Record<string, any>) {
  return row?.[PAYLOAD_FIELD] && typeof row[PAYLOAD_FIELD] === 'object' && !Array.isArray(row[PAYLOAD_FIELD]) ? row[PAYLOAD_FIELD] : {};
}

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getPath(source: any, path: string[]) {
  return path.reduce((current, key) => (!current || typeof current !== 'object' ? undefined : current[key]), source);
}

function firstValue(row: Record<string, any>, paths: string[][]) {
  const body = payload(row);
  for (const path of paths) {
    const value = path[0] === '$row' ? getPath(row, path.slice(1)) : getPath(body, path);
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function labelFor(value: unknown) {
  const key = normalizeKey(value).replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    meeting_set: 'Meeting Set',
    closed_won: 'Closed Won',
    closed_lost: 'Closed Lost',
    actual_meeting_follow_up: 'Follow Up',
    no_show: 'No Show',
    canceled: 'Canceled',
    cancelled: 'Canceled',
    reschedule_pending: 'Reschedule Needed',
    meeting_result_res_pending: 'Reschedule Needed',
    rescheduled: 'Rescheduled',
    scheduled: 'Meeting Set',
    confirmation_queued: 'Meeting Set',
    confirmation_sent: 'Meeting Set',
    operator_task: 'Verified For Me',
  };
  if (labels[key]) return labels[key];
  return String(value || '').trim() || 'Needs Review';
}

function normalizeLifecycleText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/[.,:]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function classifyLifecycleStage(row: Record<string, any>) {
  const body = payload(row);
  const text = normalizeLifecycleText(row.crm_stage || row.task_status || row.event_type);
  if (text === 'new opportunity') return 'new_opportunity';
  if (
    [
      'left voice mail 1',
      'left voicemail 1',
      'left voice mail 2',
      'left voicemail 2',
      'never spoke to',
      'called unable to leave vm',
      'unable to leave vm',
      'spoke to athlete not parent',
      'athlete not parent',
    ].includes(text)
  ) {
    return 'call_attempt';
  }
  if (text.includes('closed won') || text.includes('close won')) return 'closed_won';
  if (text.includes('closed lost') || text.includes('close lost')) return 'closed_lost';
  if (
    text.includes('inactive') ||
    text.includes('dead lead') ||
    text.includes('archived') ||
    text.includes('not interested') ||
    text.includes('too young')
  ) {
    return 'inactive';
  }
  if (text.includes('no show') || text.includes('noshow')) return 'no_show';
  if (
    text.includes('reschedule pending') ||
    text.includes('rescheduled pending') ||
    text.includes('meeting result res pending') ||
    text.includes('meeting result canceled') ||
    text.includes('actual meeting canceled')
  ) {
    return 'reschedule_pending';
  }
  if (text.includes('meeting result rescheduled') || text.includes('actual meeting rescheduled') || text === 'rescheduled') {
    return 'rescheduled';
  }
  if (text === 'meeting set') return 'meeting_set';
  if (
    text.includes('actual meeting follow up') ||
    text.includes('spoke to i need to follow up') ||
    text.includes('spoke to follow up') ||
    text.includes('meeting follow up') ||
    text.includes('follow up') ||
    text.includes('follow-up') ||
    text.includes('awaiting close') ||
    text.includes('close pending')
  ) {
    return 'meeting_follow_up';
  }
  const payloadOutcome = normalizeLifecycleText(body.tracker_outcome);
  if (payloadOutcome) return payloadOutcome.replace(/\s+/g, '_');
  return 'unknown';
}

function operatorStatusFor(normalizedStage: string) {
  if (['new_opportunity', 'call_attempt'].includes(normalizedStage)) return 'active_call_queue';
  if (['meeting_set', 'rescheduled'].includes(normalizedStage)) return 'active_meeting_queue';
  if (normalizedStage === 'reschedule_pending') return 'awaiting_reschedule';
  if (normalizedStage === 'meeting_follow_up') return 'awaiting_follow_up';
  if (normalizedStage === 'closed_won') return 'won';
  if (normalizedStage === 'closed_lost') return 'lost';
  if (normalizedStage === 'no_show') return 'no_show';
  if (normalizedStage === 'inactive') return 'inactive';
  return 'needs_manual_review';
}

function meetingLifecycleFor(normalizedStage: string) {
  const labels: Record<string, string> = {
    new_opportunity: 'not_set',
    call_attempt: 'not_set',
    meeting_set: 'scheduled',
    reschedule_pending: 'reschedule_pending',
    rescheduled: 'rescheduled',
    no_show: 'no_show',
    meeting_follow_up: 'follow_up_due',
    closed_won: 'closed_won',
    closed_lost: 'closed_lost',
    inactive: 'inactive',
  };
  return labels[normalizedStage] || 'needs_manual_review';
}

function pipelineBucketFor(normalizedStage: string) {
  const labels: Record<string, string> = {
    closed_won: 'enrolled',
    closed_lost: 'closed_lost',
    inactive: 'inactive',
    reschedule_pending: 'awaiting_reschedule',
    meeting_follow_up: 'awaiting_update',
    no_show: 'monitor_no_show',
    meeting_set: 'active_meeting',
    rescheduled: 'active_meeting',
    new_opportunity: 'active_calling',
    call_attempt: 'active_calling',
  };
  return labels[normalizedStage] || 'needs_manual_review';
}

function nextActionFor(normalizedStage: string) {
  const labels: Record<string, string> = {
    closed_won: 'tally_enrollment_revenue',
    closed_lost: 'drop_from_pipeline',
    inactive: 'archive_inactive',
    reschedule_pending: 'reschedule_client',
    meeting_follow_up: 'follow_up_for_result',
    no_show: 'monitor_or_reschedule',
    meeting_set: 'await_meeting_result',
    rescheduled: 'await_meeting_result',
    new_opportunity: 'continue_calling',
    call_attempt: 'continue_calling',
  };
  return labels[normalizedStage] || 'manual_review';
}

function proofLabel(row: Record<string, any>) {
  const status = firstValue(row, [
    ['$row', 'materialization_status'],
    ['materialization_status'],
    ['materialization_proof', 'materialization_status'],
    ['owner_context', 'materialization_status'],
  ]);
  if (normalizeKey(status) === 'operator_task') return 'Verified For Me';
  const owner = firstValue(row, [
    ['$row', 'task_assigned_owner'],
    ['task_assigned_owner'],
    ['assigned_owner'],
    ['owner_context', 'task_assigned_owner'],
  ]);
  const activeOperator = firstValue(row, [
    ['$row', 'active_operator_name'],
    ['active_operator_name'],
    ['owner_context', 'active_operator_name'],
  ]);
  if (owner && activeOperator && normalizeKey(owner) === normalizeKey(activeOperator)) return 'Verified For Me';
  return 'Needs Review';
}

function sourceLabel(source: string, kind?: string) {
  return [source, kind].filter(Boolean).join(' / ');
}

function sourceTime(row: Record<string, any>) {
  return row.reporting_at || row.event_at || row.occurred_at || row.created_at || null;
}

function etLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function localParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value instanceof Date ? value : new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateKey(value: string | Date | null | undefined) {
  if (!value) return '';
  const parts = localParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentMonthRange(value: string) {
  const parts = localParts(value);
  return {
    start: `${parts.year}-${parts.month}-01`,
    end: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isMeetingEvent(row: Record<string, any>) {
  if (meetingOutcomes.has(row.tracker_outcome)) return true;
  if (row.counts_as_meeting_set === true || row.counts_as_post_meeting_outcome === true) return true;
  return false;
}

function isLifecycleMeetingRow(row: Record<string, any>) {
  const body = payload(row);
  const normalizedStage = classifyLifecycleStage(row);
  const values = [
    row.event_type,
    row.crm_stage,
    row.task_status,
    normalizedStage,
    meetingLifecycleFor(normalizedStage),
    pipelineBucketFor(normalizedStage),
    body.tracker_outcome,
    body.appointment_id,
    body.booked_event_id,
    body.source_event_id,
    body.booked_event_title,
    body.meeting_name,
    body.task_title,
  ]
    .map(normalizeKey)
    .join(' ');
  if (values.includes('meeting')) return true;
  if (values.includes('closed_won') || values.includes('closed_lost')) return true;
  if (values.includes('no_show') || values.includes('canceled') || values.includes('cancelled')) return true;
  if (values.includes('reschedule')) return true;
  return Boolean(body.appointment_id || body.booked_event_id);
}

function isCurrentMeetingLifecycle(row: Record<string, any>) {
  return ['meeting_set', 'rescheduled', 'reschedule_pending'].includes(classifyLifecycleStage(row));
}

function lifecycleAppointmentId(row: Record<string, any>) {
  const body = payload(row);
  return String(body.appointment_id || body.booked_event_id || '').trim();
}

function callLogRowToEvent(row: Record<string, any>) {
  const reportingAt = row.reporting_at || row.event_at || row.occurred_at;
  return {
    ...row,
    source: row.source_system || 'call_log',
    reporting_date_et: localDateKey(reportingAt),
    [PAYLOAD_FIELD]: row[PAYLOAD_FIELD] || {},
    [MATERIALIZATION_REASON_FIELD]: row[MATERIALIZATION_REASON_FIELD] || row[PAYLOAD_FIELD]?.[MATERIALIZATION_REASON_FIELD] || null,
  };
}

function meetingRow(row: Record<string, any>) {
  const when = sourceTime(row);
  return {
    when,
    whenLabel: etLabel(when),
    athleteName: row.athlete_name || 'Unknown Athlete',
    meetingStatus: labelFor(row.tracker_outcome || row.raw_crm_stage || row.raw_task_status),
    meetingTitle: row.booked_event_title || row.raw_task_status || row.raw_crm_stage || '',
    appointmentId: row.appointment_id || '',
    proof: proofLabel(row),
    source: sourceLabel(row.source || 'call_log', row.raw_event_type || row.tracker_outcome),
    rawSource: row.source || null,
    rawCrmStage: row.raw_crm_stage || null,
    rawTaskStatus: row.raw_task_status || null,
    revenueCents: Number(row.revenue_cents) || 0,
    countsAsMeetingSet: row.counts_as_meeting_set === true,
    countsAsPostMeetingOutcome: row.counts_as_post_meeting_outcome === true,
    createdAt: row.created_at || null,
    createdAtLabel: etLabel(row.created_at || null),
    rawOutcome: row.tracker_outcome || null,
  };
}

function currentMeetingRow(row: Record<string, any>, athleteByKey: Map<string, string>, lifecycle?: Record<string, any>) {
  const lifecycleBody = lifecycle ? payload(lifecycle) : {};
  const lifecycleStage = lifecycle ? classifyLifecycleStage(lifecycle) : '';
  const when = row.starts_at || row.updated_at || lifecycle?.created_at || row.created_at || null;
  return {
    when,
    whenLabel: etLabel(when),
    athleteName: athleteByKey.get(row.athlete_key || lifecycle?.athlete_key) || 'Unknown Athlete',
    meetingStatus: labelFor(lifecycleStage || row.status),
    meetingTitle: row.head_scout ? `${row.head_scout} meeting` : row.appointment_role || lifecycleBody.booked_event_title || lifecycleBody.task_title || '',
    appointmentId: row.id || lifecycleAppointmentId(lifecycle || {}) || '',
    proof: row.id ? 'Verified For Me' : 'Needs Review',
    source: sourceLabel('appointments', lifecycleStage || row.status || 'current_meeting'),
    createdAt: row.updated_at || row.created_at || null,
    createdAtLabel: etLabel(row.updated_at || row.created_at || null),
    rawOutcome: row.status || null,
    meetingTimezone: row.meeting_timezone || row.calendar_timezone || null,
    meetingTimezoneLabel: row.meeting_timezone_label || null,
  };
}

function lifecycleRow(row: Record<string, any>, athleteByKey: Map<string, string>) {
  const body = payload(row);
  const normalizedStage = classifyLifecycleStage(row);
  const when = firstValue(row, [
    ['occurred_at'],
    ['event_at'],
    ['reporting_at'],
    ['$row', 'created_at'],
  ]) || row.event_at || row.created_at;
  return {
    when,
    whenLabel: etLabel(when),
    athleteName: athleteByKey.get(row.athlete_key) || firstValue(row, [['athlete_name'], ['name']]) || 'Unknown Athlete',
    lifecycleEvent: labelFor(normalizedStage || row.event_type || body.tracker_outcome || row.crm_stage || row.task_status),
    crmStage: labelFor(row.crm_stage),
    taskStatus: labelFor(row.task_status),
    proof: proofLabel(row),
    source: 'lifecycle_events',
    appointmentId: body.appointment_id || body.booked_event_id || body.source_event_id || '',
    meetingTitle: body.booked_event_title || body.meeting_name || body.task_title || '',
    createdAt: row.created_at || null,
    createdAtLabel: etLabel(row.created_at || null),
    rawEventType: row.event_type || null,
    normalizedStage,
    operatorStatus: operatorStatusFor(normalizedStage),
    meetingLifecycle: meetingLifecycleFor(normalizedStage),
    pipelineBucket: pipelineBucketFor(normalizedStage),
    nextAction: nextActionFor(normalizedStage),
    isActiveOrMonitoring: ['meeting_set', 'rescheduled', 'reschedule_pending', 'meeting_follow_up', 'no_show', 'new_opportunity', 'call_attempt'].includes(normalizedStage),
    isTerminal: ['closed_won', 'closed_lost', 'inactive'].includes(normalizedStage),
    indicatesShowed: ['closed_won', 'closed_lost', 'reschedule_pending', 'meeting_follow_up'].includes(normalizedStage),
    countsAsEnrollment: normalizedStage === 'closed_won',
  };
}

function summaryFor(
  sourceSummary: Record<string, any>,
  currentMeetings: Array<Record<string, any>>,
  meetings: Array<Record<string, any>>,
  generatedAt: string,
) {
  const statusText = (row: Record<string, any>) => normalizeKey(row.rawOutcome || row.rawEventType || row.meetingStatus || row.lifecycleEvent).replace(/\s+/g, '_');
  const isActualMeetingFollowUp = (row: Record<string, any>) =>
    [row.rawCrmStage, row.rawTaskStatus, row.rawOutcome, row.meetingStatus]
      .map((value) => normalizeKey(value).replace(/\s+/g, '_'))
      .includes('actual_meeting_follow_up');
  const monthRange = currentMonthRange(generatedAt);
  const monthlyRows = meetings.filter((row) => {
    const rowKey = localDateKey(row.when || row.createdAt);
    return rowKey >= monthRange.start && rowKey <= monthRange.end;
  });
  const reportedMeetingsSet = Number(sourceSummary.meetings_set);
  const trueMeetingsSet = Math.max(
    Number.isFinite(reportedMeetingsSet) ? reportedMeetingsSet : 0,
    meetings.filter((row) => row.countsAsMeetingSet === true).length,
    meetings.filter((row) => row.countsAsPostMeetingOutcome === true).length,
    currentMeetings.length,
  );
  const postMeetingRows = meetings.filter((row) => row.countsAsPostMeetingOutcome === true);
  const closedWon = postMeetingRows.filter((row) => statusText(row) === 'closed_won').length;
  const closedLost = postMeetingRows.filter((row) => statusText(row) === 'closed_lost').length;
  const followUp = postMeetingRows.filter(isActualMeetingFollowUp).length;
  const noShowCanceled = postMeetingRows.filter((row) =>
    ['no_show', 'canceled', 'cancelled'].includes(statusText(row)),
  ).length;
  const showedResulted = closedWon + closedLost + followUp;
  return {
    trueMeetingsSet,
    showedResulted,
    showRate: trueMeetingsSet ? Math.round((showedResulted / trueMeetingsSet) * 100) : 0,
    closedWon,
    closedLost,
    followUp,
    noShowCanceled,
    meetingsSet: trueMeetingsSet,
    upcomingPending: monthlyRows.filter((row) =>
      ['scheduled', 'meeting_set', 'rescheduled', 'reschedule_pending', 'confirmation_queued', 'confirmation_sent'].includes(statusText(row)),
    ).length,
    needsReview: currentMeetings.filter((row) => row.proof === 'Needs Review' || !row.appointmentId).length,
  };
}

function sourceSummaryFromEvents(rows: Array<Record<string, any>>) {
  return {
    meetings_set: rows.filter((row) => row.counts_as_meeting_set === true).length,
    meeting_outcomes_total: rows.filter((row) => row.counts_as_post_meeting_outcome === true).length,
    closed_won: rows.filter((row) => row.tracker_outcome === 'closed_won').length,
    money_earned_cents: rows
      .filter((row) => row.tracker_outcome === 'closed_won')
      .reduce((total, row) => total + (Number(row.revenue_cents) || 0), 0),
  };
}

async function buildMeetingReadback() {
  const canonicalEventTable = 'call_log';
  const activeMeetingTable = 'appointments';
  const lifecycleTable = 'lifecycle_events';
  const athleteTable = 'athletes';
  const [callLogRows, appointmentRows, lifecycleRows, athleteRows] = await Promise.all([
    supabaseGet([`${canonicalEventTable}?select=${encodeURIComponent(callLogFields.join(','))}`, 'order=reporting_at.desc', `limit=${EVENT_LIMIT}`].join('&')),
    supabaseGet([
      `${activeMeetingTable}?select=${encodeURIComponent(appointmentFields.join(','))}`,
      `status=in.(${[...activeAppointmentStatuses].join(',')})`,
      'order=updated_at.desc',
      `limit=${EVENT_LIMIT}`,
    ].join('&')),
    supabaseGet([`${lifecycleTable}?select=${encodeURIComponent(lifecycleFields.join(','))}`, 'order=created_at.desc', `limit=${EVENT_LIMIT}`].join('&')),
    supabaseGet([`${athleteTable}?select=${encodeURIComponent(athleteFields.join(','))}`, `limit=${EVENT_LIMIT}`].join('&')),
  ]);
  const athleteByKey = new Map(
    (Array.isArray(athleteRows) ? athleteRows : [])
      .map((row) => [String(row.athlete_key || '').trim(), String(row.athlete_name || '').trim()])
      .filter(([athleteKey, athleteName]) => athleteKey && athleteName) as Array<[string, string]>,
  );
  const appointmentById = new Map<string, Record<string, any>>();
  const latestAppointmentByAthlete = new Map<string, Record<string, any>>();
  for (const row of Array.isArray(appointmentRows) ? appointmentRows : []) {
    const appointmentId = String(row.id || '').trim();
    if (appointmentId) appointmentById.set(appointmentId, row);
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestAppointmentByAthlete.has(athleteKey)) continue;
    latestAppointmentByAthlete.set(athleteKey, row);
  }
  const latestLifecycleByAthlete = new Map<string, Record<string, any>>();
  for (const row of Array.isArray(lifecycleRows) ? lifecycleRows : []) {
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestLifecycleByAthlete.has(athleteKey)) continue;
    latestLifecycleByAthlete.set(athleteKey, row);
  }
  const currentMeetings = [...latestLifecycleByAthlete.values()]
    .filter(isCurrentMeetingLifecycle)
    .map((row) => {
      const appointmentId = lifecycleAppointmentId(row);
      return currentMeetingRow(
        appointmentById.get(appointmentId) || latestAppointmentByAthlete.get(String(row.athlete_key || '').trim()) || {
          id: appointmentId,
          athlete_key: row.athlete_key,
          status: classifyLifecycleStage(row),
          created_at: row.created_at,
        },
        athleteByKey,
        row,
      );
    })
    .sort((left, right) => new Date(left.when || 0).getTime() - new Date(right.when || 0).getTime());
  const eventRows = (Array.isArray(callLogRows) ? callLogRows : []).map(callLogRowToEvent);
  const meetings = eventRows
    .filter(isMeetingEvent)
    .map(meetingRow)
    .sort((left, right) => new Date(right.when || 0).getTime() - new Date(left.when || 0).getTime());
  const currentAppointmentIds = new Set(currentMeetings.map((row) => String(row.appointmentId || '').trim()).filter(Boolean));
  const mergedMeetings = [
    ...currentMeetings,
    ...meetings.filter((row) => !currentAppointmentIds.has(String(row.appointmentId || '').trim())),
  ];
  const lifecycle = (Array.isArray(lifecycleRows) ? lifecycleRows : [])
    .filter(isLifecycleMeetingRow)
    .map((row) => lifecycleRow(row, athleteByKey))
    .sort((left, right) => new Date(right.when || 0).getTime() - new Date(left.when || 0).getTime());
  const generatedAt = new Date().toISOString();
  const sourceSummary = sourceSummaryFromEvents(eventRows);
  return {
    contract: 'prospect-meetings-readback',
    version: 1,
    generatedFrom: 'apps/prospect-web/app/api/meeting-readback-data/route.ts',
    data: {
      generatedAt,
      generatedAtLabel: etLabel(generatedAt),
      eventLimit: EVENT_LIMIT,
      supabaseReads: {
        canonicalEventTable,
        activeMeetingTable,
        lifecycleTable,
        athleteTable,
      },
      summary: summaryFor(sourceSummary, currentMeetings, meetings, generatedAt),
      sourceSummary,
      meetings: mergedMeetings,
      lifecycle,
    },
  };
}

export async function GET() {
  try {
    return noStoreJson(await buildMeetingReadback());
  } catch (error) {
    return noStoreJson(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown meeting readback error',
      },
      { status: 500 },
    );
  }
}
