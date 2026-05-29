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

const eventFields = [
  'athlete_name',
  'occurred_at',
  'event_at',
  'reporting_at',
  'reporting_date_et',
  'tracker_outcome',
  'raw_crm_stage',
  'raw_task_status',
  'raw_event_type',
  'source',
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
  'created_at',
];

const lifecycleFields = [
  'id',
  'event_type',
  'crm_stage',
  'task_status',
  PAYLOAD_FIELD,
  'created_at',
];

const activeMeetingFields = [
  'athlete_name',
  'crm_stage',
  'task_status',
  'operator_owner',
  'current_head_scout',
  'current_appointment_id',
  'resolved_appointment_id',
  'current_source_event_id',
  'current_starts_at',
  'current_meeting_timezone',
  'current_meeting_timezone_label',
  'current_appointment_status',
  'current_appointment_role',
  'resolution_source',
  'pipeline_updated_at',
  'appointment_updated_at',
];

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
  const values = [
    row.event_type,
    row.crm_stage,
    row.task_status,
    body.tracker_outcome,
    body.appointment_id,
    body.booked_event_title,
  ]
    .map(normalizeKey)
    .join(' ');
  if (values.includes('meeting')) return true;
  if (values.includes('closed_won') || values.includes('closed_lost')) return true;
  if (values.includes('no_show') || values.includes('canceled') || values.includes('cancelled')) return true;
  if (values.includes('reschedule')) return true;
  return Boolean(body.appointment_id || body.booked_event_id);
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
    source: sourceLabel(row.source || 'call_tracker_events_owner_context', row.raw_event_type || row.tracker_outcome),
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

function currentMeetingRow(row: Record<string, any>) {
  const when = row.current_starts_at || row.appointment_updated_at || row.pipeline_updated_at || null;
  const proof = row.resolution_source === 'current_appointment_pointer' ? 'Verified For Me' : 'Needs Review';
  return {
    when,
    whenLabel: etLabel(when),
    athleteName: row.athlete_name || 'Unknown Athlete',
    meetingStatus: labelFor(row.current_appointment_status || row.crm_stage || row.task_status),
    meetingTitle: row.current_head_scout ? `${row.current_head_scout} meeting` : row.current_appointment_role || '',
    appointmentId: row.resolved_appointment_id || row.current_appointment_id || '',
    proof,
    source: sourceLabel('active_athlete_meeting_truth', row.resolution_source || 'current_meeting'),
    createdAt: row.appointment_updated_at || row.pipeline_updated_at || null,
    createdAtLabel: etLabel(row.appointment_updated_at || row.pipeline_updated_at || null),
    rawOutcome: row.current_appointment_status || row.crm_stage || null,
    meetingTimezone: row.current_meeting_timezone || null,
    meetingTimezoneLabel: row.current_meeting_timezone_label || null,
  };
}

function lifecycleRow(row: Record<string, any>) {
  const body = payload(row);
  const when = firstValue(row, [
    ['occurred_at'],
    ['event_at'],
    ['reporting_at'],
    ['$row', 'created_at'],
  ]) || row.created_at;
  return {
    when,
    whenLabel: etLabel(when),
    athleteName: firstValue(row, [['athlete_name'], ['name']]) || 'Unknown Athlete',
    lifecycleEvent: labelFor(row.event_type || body.tracker_outcome || row.crm_stage || row.task_status),
    crmStage: labelFor(row.crm_stage),
    taskStatus: labelFor(row.task_status),
    proof: proofLabel(row),
    source: 'lifecycle_events',
    appointmentId: body.appointment_id || body.booked_event_id || '',
    meetingTitle: body.booked_event_title || body.task_title || '',
    createdAt: row.created_at || null,
    createdAtLabel: etLabel(row.created_at || null),
    rawEventType: row.event_type || null,
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
  const trueMeetingsSet = Number.isFinite(reportedMeetingsSet)
    ? reportedMeetingsSet
    : meetings.filter((row) => row.countsAsMeetingSet === true).length;
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

async function buildMeetingReadback() {
  const summaryView = 'call_tracker_summary';
  const eventView = 'call_tracker_events_owner_context';
  const activeMeetingView = 'active_athlete_meeting_truth';
  const [summaryRows, eventRows, activeMeetingRows, lifecycleRows] = await Promise.all([
    supabaseGet(`${summaryView}?select=*`),
    supabaseGet([`${eventView}?select=${encodeURIComponent(eventFields.join(','))}`, 'order=event_at.desc', `limit=${EVENT_LIMIT}`].join('&')),
    supabaseGet([`${activeMeetingView}?select=${encodeURIComponent(activeMeetingFields.join(','))}`, 'order=current_starts_at.asc', `limit=${EVENT_LIMIT}`].join('&')),
    supabaseGet([`lifecycle_events?select=${encodeURIComponent(lifecycleFields.join(','))}`, 'order=created_at.desc', `limit=${EVENT_LIMIT}`].join('&')),
  ]);
  const currentMeetings = (Array.isArray(activeMeetingRows) ? activeMeetingRows : [])
    .map(currentMeetingRow)
    .sort((left, right) => new Date(left.when || 0).getTime() - new Date(right.when || 0).getTime());
  const meetings = (Array.isArray(eventRows) ? eventRows : [])
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
    .map(lifecycleRow)
    .sort((left, right) => new Date(right.when || 0).getTime() - new Date(left.when || 0).getTime());
  const generatedAt = new Date().toISOString();
  const sourceSummary = (Array.isArray(summaryRows) ? summaryRows[0] : {}) || {};
  return {
    contract: 'prospect-meetings-readback',
    version: 1,
    generatedFrom: 'apps/prospect-web/app/api/meeting-readback-data/route.ts',
    data: {
      generatedAt,
      generatedAtLabel: etLabel(generatedAt),
      eventLimit: EVENT_LIMIT,
      supabaseReads: {
        summaryView,
        eventView,
        activeMeetingView,
        lifecycleSourceTable: 'lifecycle_events',
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
