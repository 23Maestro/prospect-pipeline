import { NextResponse } from 'next/server';
import { getServerEnv } from '../../../lib/env';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EVENT_LIMIT = Number(process.env.CALL_TRACKER_CONTRACT_EVENT_LIMIT || 1000);
const TIME_ZONE = 'America/New_York';
const COMMISSION_RATE = 0.2;
const HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT = 13;
const PAYLOAD_FIELD = ['payload', 'json'].join('_');
const MATERIALIZATION_REASON_FIELD = ['materialization', 'reason'].join('_');
const hiddenDefaultOutcomes = new Set(['voicemail', 'spoke_follow_up', 'unable_to_leave_vm']);
const paidCommissionSources = new Set(['stripe_commissions', 'stripe_commission_payroll']);
const meetingOutcomes = new Set([
  'meeting_set',
  'reschedule_pending',
  'rescheduled',
  'canceled',
  'closed_won',
  'closed_lost',
  'no_show',
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
  'live_event_id',
  'booked_event_title',
  'revenue_cents',
  'dedupe_key',
  'active_operator_name',
  'task_assigned_owner',
  'counts_as_dial',
  'counts_as_contact',
  'counts_as_meeting_set',
  'counts_as_post_meeting_outcome',
  'materialization_status',
  MATERIALIZATION_REASON_FIELD,
  'resolved_owner_name',
  'resolved_owner_source_field',
  'can_materialize_for_active_operator',
  'created_at',
];

const internalEventFields = ['athlete_key', 'athlete_id', 'athlete_main_id', ...eventFields];
const internalIdentityFields = new Set(['athlete_key', 'athlete_id', 'athlete_main_id']);

const lifecycleFields = [
  'id',
  'athlete_key',
  'athlete_id',
  'athlete_main_id',
  'event_type',
  'dedupe_key',
  'crm_stage',
  'task_status',
  PAYLOAD_FIELD,
  'created_at',
];

const activityByStage = new Map<string, readonly [string, string, string, boolean, boolean]>([
  ['left voice mail 1', ['call_attempt_1', 'dial', 'voicemail', true, false]],
  ['left voicemail 1', ['call_attempt_1', 'dial', 'voicemail', true, false]],
  ['left voice mail 2', ['call_attempt_2', 'dial', 'voicemail', true, false]],
  ['left voicemail 2', ['call_attempt_2', 'dial', 'voicemail', true, false]],
  ['never spoke to', ['call_attempt_3', 'dial', 'voicemail', true, false]],
  ['called - unable to leave vm', ['unable_to_leave_vm', 'dial', 'unable_to_leave_vm', true, false]],
  ['spoke to - not interested', ['spoke_to_not_interested', 'contact', 'not_interested', true, true]],
  ['spoke to - athlete, not parent', ['spoke_to_athlete_not_parent', 'contact', 'spoke_follow_up', true, true]],
  ['spoke to - too young', ['spoke_to_too_young', 'contact', 'spoke_follow_up', true, true]],
  ['spoke to - follow up', ['spoke_to_follow_up', 'contact', 'spoke_follow_up', true, true]],
  ['spoke to - i need to follow up', ['spoke_to_follow_up', 'contact', 'spoke_follow_up', true, true]],
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
    throw new Error('Missing SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY for live call tracker reads.');
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

function localDateLabel(value: Date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' }).format(value);
}

function localDayDateLabel(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

function ymdToLocalNoon(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}

function offsetLocalDate(value: string | Date, dayOffset: number) {
  const parts = localParts(value);
  return ymdToLocalNoon(Number(parts.year), Number(parts.month), Number(parts.day) + dayOffset);
}

function localWeekdayIndex(value: string | Date) {
  const shortDay = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(
    value instanceof Date ? value : new Date(value),
  );
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(shortDay);
  return index >= 0 ? index : 0;
}

function currentWeekdayDate(now: Date, mondayOffset: number) {
  const weekdayIndex = localWeekdayIndex(now);
  const daysSinceMonday = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  return offsetLocalDate(now, mondayOffset - daysSinceMonday);
}

function currentWeekPeriod(now: Date) {
  const weekdayIndex = localWeekdayIndex(now);
  const mondayOffset = Math.min(4, Math.max(0, weekdayIndex - 1));
  return `week-${mondayOffset}`;
}

function periodDate(now: Date, period: string) {
  if (period === 'week-total') return now;
  return currentWeekdayDate(now, Number(period.replace('week-', '')) || 0);
}

function currentWeekRangeLabel(now: Date) {
  return `${localDateLabel(currentWeekdayDate(now, 0))} - ${localDateLabel(currentWeekdayDate(now, 6))}`;
}

function currentMonthResultLabel(now: Date) {
  return `${new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'long' }).format(now)} Results`;
}

function eventDateKey(row: Record<string, any>) {
  return row.reporting_date_et || localDateKey(row.reporting_at || row.occurred_at);
}

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowQuality(row: Record<string, any>) {
  return (
    (row.counts_as_meeting_set === true ? 32 : 0) +
    (row.dedupe_key ? 8 : 0) +
    (row.booked_event_title ? 4 : 0) +
    (row.appointment_id ? 2 : 0) +
    (row.event_at ? 1 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function displayRows(rows: Array<Record<string, any>>) {
  const byKey = new Map<string, Record<string, any>>();
  const results: Array<Record<string, any>> = [];
  rows.forEach((row) => {
    if (!meetingOutcomes.has(row.tracker_outcome) || row.tracker_outcome === 'meeting_set') {
      results.push(row);
      return;
    }
    const key = [
      normalizeKey(row.athlete_name),
      normalizeKey(row.tracker_outcome),
      normalizeKey(row.raw_crm_stage || row.raw_task_status),
      localDateKey(row.event_at || row.occurred_at),
    ].join('|');
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, row);
      results.push(row);
      return;
    }
    if (rowQuality(row) > rowQuality(previous)) {
      const index = results.indexOf(previous);
      if (index >= 0) results[index] = row;
      byKey.set(key, row);
    }
  });
  return results.sort((left, right) => new Date(right.event_at || right.occurred_at).getTime() - new Date(left.event_at || left.occurred_at).getTime());
}

function eventIdentityKey(row: Record<string, any>) {
  if (row.tracker_outcome === 'meeting_set') {
    const athleteIdentity =
      normalizeKey(row.athlete_key) ||
      [normalizeKey(row.athlete_id), normalizeKey(row.athlete_main_id)].filter(Boolean).join(':') ||
      normalizeKey(row.athlete_name);
    const meetingTitle = normalizeKey(row.booked_event_title);
    const appointmentId = normalizeKey(row.appointment_id);
    if (athleteIdentity && meetingTitle && appointmentId) {
      return `meeting_set:athlete:${athleteIdentity}:title:${meetingTitle}:appointment:${appointmentId}`;
    }
    if (athleteIdentity && meetingTitle) return `meeting_set:athlete:${athleteIdentity}:title:${meetingTitle}:date:${eventDateKey(row)}`;
    return [
      'meeting_set',
      normalizeKey(row.athlete_name),
      normalizeKey(row.booked_event_title),
      eventDateKey(row),
    ].join('|');
  }
  return row.dedupe_key || `${row.source}:${row.athlete_name}:${row.tracker_outcome}:${row.event_at || row.occurred_at}`;
}

function isDashboardVisibleEvent(row: Record<string, any>) {
  if (row.tracker_outcome === 'closed_won') return true;
  return row.tracker_outcome !== 'meeting_set' || row.counts_as_meeting_set === true;
}

function isPaidClosedWon(row: Record<string, any>) {
  return row.tracker_outcome === 'closed_won' && paidCommissionSources.has(row.source) && Number(row.revenue_cents) > 0;
}

function publicRow(row: Record<string, any>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !internalIdentityFields.has(key)));
}

function rowsForPeriod(rows: Array<Record<string, any>>, now: Date, period: string) {
  if (period === 'week-total') {
    const weekStart = localDateKey(currentWeekdayDate(now, 0));
    const weekEnd = localDateKey(currentWeekdayDate(now, 6));
    return rows.filter((row) => {
      const key = eventDateKey(row);
      return key >= weekStart && key <= weekEnd;
    });
  }
  const key = localDateKey(periodDate(now, period));
  return rows.filter((row) => eventDateKey(row) === key);
}

function periodLabel(now: Date, period: string) {
  return period === 'week-total' ? `This Week, ${currentWeekRangeLabel(now)}` : localDayDateLabel(periodDate(now, period));
}

function outcomeCounts(rows: Array<Record<string, any>>) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.tracker_outcome] = (acc[row.tracker_outcome] || 0) + 1;
    return acc;
  }, {});
}

function filterCounts(rows: Array<Record<string, any>>) {
  const counts = outcomeCounts(rows);
  const dashboardRows = rows.filter(isDashboardVisibleEvent);
  return {
    meaningful: dashboardRows.filter((row) => !hiddenDefaultOutcomes.has(row.tracker_outcome)).length,
    all_calls: dashboardRows.length,
    meetings: dashboardRows.filter((row) => row.tracker_outcome === 'meeting_set').length,
    closed_won: counts.closed_won || 0,
    closed_lost: counts.closed_lost || 0,
    reschedule_pending: counts.reschedule_pending || 0,
    no_show: counts.no_show || 0,
    canceled: counts.canceled || 0,
  };
}

function payload(row: Record<string, any>) {
  return row?.[PAYLOAD_FIELD] && typeof row[PAYLOAD_FIELD] === 'object' && !Array.isArray(row[PAYLOAD_FIELD]) ? row[PAYLOAD_FIELD] : {};
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

function classifyLifecycleActivity(row: Record<string, any>) {
  const stage = normalizeKey(row.crm_stage);
  const direct = activityByStage.get(stage);
  if (direct) return direct;
  const status = normalizeKey(row.task_status);
  if (status.includes('call attempt 2')) return activityByStage.get('left voice mail 2');
  if (status.includes('call attempt 3')) return activityByStage.get('never spoke to');
  if (status.includes('call attempt 1') || status === 'call attempt') return activityByStage.get('left voice mail 1');
  if (status.includes('unable') && status.includes('leave') && status.includes('vm')) return activityByStage.get('called - unable to leave vm');
  if (status.includes('not interested')) return activityByStage.get('spoke to - not interested');
  if (status.includes('athlete') && status.includes('not parent')) return activityByStage.get('spoke to - athlete, not parent');
  if (status.includes('too young')) return activityByStage.get('spoke to - too young');
  if (status.includes('spoke') && status.includes('follow')) return activityByStage.get('spoke to - follow up');
  const body = payload(row);
  if (body.tracker_outcome && (body.counts_as_dial === true || body.counts_as_contact === true)) {
    return [
      String(body.activity_subtype || body.tracker_outcome),
      String(body.activity_kind || (body.counts_as_contact ? 'contact' : 'dial')),
      String(body.tracker_outcome),
      body.counts_as_dial === true,
      body.counts_as_contact === true,
    ] as const;
  }
  return null;
}

function lifecycleActivityToEvent(row: Record<string, any>) {
  if (row.event_type === 'meeting_set') return null;
  if (!row.athlete_id || !row.athlete_main_id || !row.athlete_key) return null;
  const activity = classifyLifecycleActivity(row);
  if (!activity) return null;
  const [activitySubtype, , trackerOutcome, countsAsDial, countsAsContact] = activity;
  const body = payload(row);
  const status = firstValue(row, [
    ['materialization_status'],
    ['materialization_proof', 'materialization_status'],
    ['owner_context', 'materialization_status'],
  ]);
  const taskAssignedOwner = firstValue(row, [
    ['task_assigned_owner'],
    ['assigned_owner'],
    ['owner_context', 'task_assigned_owner'],
    ['materialization_proof', 'task_assigned_owner'],
  ]);
  const activeOperator = firstValue(row, [['active_operator_name'], ['owner_context', 'active_operator_name']]) || 'Jerami Singleton';
  if (status !== 'operator_task' && taskAssignedOwner !== activeOperator) return null;
  const occurredAt =
    firstValue(row, [
      ['completion_date'],
      ['completed_at'],
      ['occurred_at'],
      ['due_at'],
      ['due_date'],
      ['$row', 'created_at'],
    ]) || row.created_at;
  const taskId = firstValue(row, [
    ['task_id'],
    ['taskId'],
    ['current_task_id'],
    ['selected_task_id'],
    ['matched_weekly_task_id'],
    ['materialization_proof', 'task_id'],
    ['owner_context', 'task_id'],
  ]) || `lifecycle:${row.id}`;
  return {
    athlete_name: firstValue(row, [['athlete_name'], ['name'], ['$row', 'athlete_name']]) || null,
    occurred_at: occurredAt,
    event_at: occurredAt,
    reporting_at: occurredAt,
    reporting_date_et: localDateKey(occurredAt),
    tracker_outcome: trackerOutcome,
    raw_crm_stage: null,
    raw_task_status: activitySubtype,
    raw_event_type: 'lifecycle_call_activity',
    source: 'lifecycle_events',
    appointment_id: null,
    live_event_id: null,
    booked_event_title: firstValue(row, [['task_title'], ['taskTitle'], ['current_task_title']]) || row.task_status || row.crm_stage || activitySubtype,
    revenue_cents: null,
    dedupe_key: `activity:${taskId}`,
    active_operator_name: activeOperator,
    task_assigned_owner: taskAssignedOwner || activeOperator,
    counts_as_dial: countsAsDial,
    counts_as_contact: countsAsContact,
    counts_as_meeting_set: false,
    counts_as_post_meeting_outcome: false,
    materialization_status: status || 'operator_task',
    [MATERIALIZATION_REASON_FIELD]: body[MATERIALIZATION_REASON_FIELD] || body.materialization_proof?.reason || null,
    resolved_owner_name: body.source_owner || body.owner_context?.resolved_owner_name || activeOperator,
    resolved_owner_source_field: body.owner_proof || body.owner_context?.owner_proof || null,
    can_materialize_for_active_operator: true,
    created_at: row.created_at,
  };
}

function mergeEventRows(viewRows: Array<Record<string, any>>, lifecycleRows: Array<Record<string, any>>) {
  const byKey = new Map<string, Record<string, any>>();
  for (const row of [...viewRows, ...lifecycleRows]) {
    const key = eventIdentityKey(row);
    const previous = byKey.get(key);
    if (!previous || rowQuality(row) > rowQuality(previous)) byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) => new Date(right.event_at || right.occurred_at).getTime() - new Date(left.event_at || left.occurred_at).getTime());
}

function addLifecycleDeltasToSummary(fallback: Record<string, any>, lifecycleRows: Array<Record<string, any>>) {
  return {
    ...fallback,
    dials: (Number(fallback.dials) || 0) + lifecycleRows.filter((row) => row.counts_as_dial === true).length,
    contacts: (Number(fallback.contacts) || 0) + lifecycleRows.filter((row) => row.counts_as_contact === true).length,
    meetings_set: Number(fallback.meetings_set) || 0,
    meeting_outcomes_total: Number(fallback.meeting_outcomes_total) || 0,
    closed_won: Number(fallback.closed_won) || 0,
    money_earned_cents: Number(fallback.money_earned_cents) || 0,
    voicemail_only: (Number(fallback.voicemail_only) || 0) + lifecycleRows.filter((row) => row.tracker_outcome === 'voicemail').length,
    appointments_tracked: Number(fallback.appointments_tracked) || 0,
  };
}

function resolveMeetingSetSummary(
  fallback: Record<string, any>,
  rawRows: Array<Record<string, any>>,
  resolvedRows: Array<Record<string, any>>,
) {
  const rawMeetingSets = rawRows.filter((row) => row.counts_as_meeting_set === true).length;
  const resolvedMeetingSets = resolvedRows.filter((row) => row.counts_as_meeting_set === true).length;
  const removedDuplicates = Math.max(0, rawMeetingSets - resolvedMeetingSets);
  return {
    ...fallback,
    total_events: Math.max(0, (Number(fallback.total_events) || 0) - removedDuplicates),
    spoke_with: Math.max(0, (Number(fallback.spoke_with) || 0) - removedDuplicates),
    meetings_set: resolvedMeetingSets,
    appointments_tracked: resolvedMeetingSets,
  };
}

function addMonths(year: number, month: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function nextPayDate(now: Date) {
  const parts = localParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const payMonth = day <= 28 ? month : month === 12 ? 1 : month + 1;
  const payYear = day <= 28 ? year : month === 12 ? year + 1 : year;
  return ymdToLocalNoon(payYear, payMonth, day <= 14 ? 14 : day <= 28 ? 28 : 14);
}

function previousPayDate(payDate: Date) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (day === 28) return ymdToLocalNoon(year, month, 14);
  const previousMonth = addMonths(year, month, -1);
  return ymdToLocalNoon(previousMonth.year, previousMonth.month, 28);
}

function basePayForDate(payDate: Date) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return year === 2026 && month >= 5 && month <= 7 && day <= 28 ? 100000 : 50000;
}

function commissionCentsForRow(row: Record<string, any>) {
  return Math.round((Number(row.revenue_cents) || 0) * COMMISSION_RATE);
}

function commissionCentsForRows(rows: Array<Record<string, any>>) {
  return rows
    .filter(isPaidClosedWon)
    .reduce((total, row) => total + commissionCentsForRow(row), 0);
}

function closedWonIdentity(row: Record<string, any>) {
  return [
    row.athlete_key,
    row.athlete_main_id,
    row.athlete_id,
    normalizeKey(row.athlete_name),
  ].find((value) => String(value || '').trim()) || normalizeKey(row.booked_event_title);
}

function closedWonQuality(row: Record<string, any>) {
  return (
    (isPaidClosedWon(row) ? 100 : 0) +
    (Number(row.revenue_cents) > 0 ? 25 : 0) +
    (row.source === 'stripe_commissions' ? 10 : 0) +
    (row.appointment_id ? 2 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function definitiveClosedWonRows(rows: Array<Record<string, any>>) {
  const byIdentity = new Map<string, Record<string, any>>();
  rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .forEach((row) => {
      const identity = closedWonIdentity(row);
      const previous = byIdentity.get(identity);
      if (!previous || closedWonQuality(row) > closedWonQuality(previous)) {
        byIdentity.set(identity, row);
      }
    });
  return Array.from(byIdentity.values());
}

function rowBelongsToPaycheck(row: Record<string, any>, previousPay: Date, payDate: Date) {
  const sourceDate = new Date(row.event_at || row.occurred_at || row.created_at);
  if (Number.isNaN(sourceDate.getTime())) return false;
  return sourceDate.getTime() > previousPay.getTime() && sourceDate.getTime() <= payDate.getTime();
}

function paycheck(rows: Array<Record<string, any>>, now: Date) {
  const payDate = nextPayDate(now);
  const previousPay = previousPayDate(payDate);
  const baseCents = basePayForDate(payDate);
  const commissionCents = rows
    .filter((row) => isPaidClosedWon(row) && rowBelongsToPaycheck(row, previousPay, payDate))
    .reduce((total, row) => total + commissionCentsForRow(row), 0);
  return {
    payDate: payDate.toISOString(),
    payDateLabel: `Next check ${localDateLabel(payDate)}`,
    previousPayDate: previousPay.toISOString(),
    baseCents,
    commissionCents,
    totalCents: baseCents + commissionCents,
  };
}

function buildUiData(summary: Record<string, any>, events: Array<Record<string, any>>, generatedAt: string) {
  const now = new Date(generatedAt);
  const rows = displayRows(events).filter(isDashboardVisibleEvent);
  const rawAllTimeContacts = Number(summary.contacts) || 0;
  const correctedAllTimeContacts = rawAllTimeContacts + HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT;
  const periods: Record<string, any> = {};
  for (const period of ['week-0', 'week-1', 'week-2', 'week-3', 'week-4', 'week-total']) {
    const scoped = rowsForPeriod(rows, now, period);
    const dials = scoped.filter((row) => row.counts_as_dial === true).length;
    const contacts = scoped.filter((row) => row.counts_as_contact === true).length;
    const meetingsSet = scoped.filter((row) => row.counts_as_meeting_set === true).length;
    periods[period] = {
      label: periodLabel(now, period),
      localDateKey: period === 'week-total' ? null : localDateKey(periodDate(now, period)),
      dials,
      contacts,
      meetingsSet,
      setRate: contacts ? Math.round((meetingsSet / contacts) * 100) : 0,
      outcomeCounts: outcomeCounts(scoped),
      filterCounts: filterCounts(scoped),
    };
  }
  const meetingOutcomesTotal = Number(summary.meeting_outcomes_total) || 0;
  const closedWonRows = definitiveClosedWonRows(rows);
  return {
    activePeriod: currentWeekPeriod(now),
    rangeLabel: currentWeekRangeLabel(now),
    monthResultLabel: currentMonthResultLabel(now),
    summaryCards: {
      moneyEarnedCents: commissionCentsForRows(rows),
      closedWon: closedWonRows.length,
      contacts: correctedAllTimeContacts,
      rawContacts: rawAllTimeContacts,
      historicalContactsAdjustment: HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT,
      dials: Number(summary.dials) || 0,
      voicemailOnly: Number(summary.voicemail_only) || 0,
      appointmentsTracked: Number(summary.appointments_tracked) || 0,
      closeRate: meetingOutcomesTotal ? Math.round((closedWonRows.length / meetingOutcomesTotal) * 100) : 0,
    },
    manualCorrections: {
      allTimeContactsAdjustment: HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT,
      rawAllTimeContacts,
      correctedAllTimeContacts,
      reason: 'Historical manual correction for contacts lost during mid-tracking implementation. Supabase facts remain strict; this adjusts all-time Vercel UI contacts/set-rate only.',
    },
    paycheck: paycheck(rows, now),
    periods,
    closedWonRows: closedWonRows.sort((left, right) => Number(right.revenue_cents || 0) - Number(left.revenue_cents || 0)),
  };
}

async function buildLiveContract() {
  const summaryView = 'call_tracker_summary';
  const eventView = 'call_tracker_events_owner_context';
  const canonicalEventTable = 'call_events';
  const [summaryRows, events, lifecycleRows] = await Promise.all([
    supabaseGet(`${summaryView}?select=*`),
    supabaseGet([`${eventView}?select=${encodeURIComponent(internalEventFields.join(','))}`, 'order=event_at.desc', `limit=${EVENT_LIMIT}`].join('&')),
    supabaseGet([`lifecycle_events?select=${encodeURIComponent(lifecycleFields.join(','))}`, 'order=created_at.desc', `limit=${EVENT_LIMIT}`].join('&')),
  ]);

  const generatedAt = new Date().toISOString();
  const viewEvents = Array.isArray(events) ? events : [];
  const lifecycleEvents = (Array.isArray(lifecycleRows) ? lifecycleRows : []).map(lifecycleActivityToEvent).filter(Boolean) as Array<Record<string, any>>;
  const viewDedupeKeys = new Set(viewEvents.map((row: Record<string, any>) => row.dedupe_key).filter(Boolean));
  const lifecycleDeltaEvents = lifecycleEvents.filter((row) => !viewDedupeKeys.has(row.dedupe_key));
  const materializedEvents = mergeEventRows(viewEvents, lifecycleEvents);
  const summary = resolveMeetingSetSummary(
    addLifecycleDeltasToSummary((Array.isArray(summaryRows) ? summaryRows[0] : {}) || {}, lifecycleDeltaEvents),
    [...viewEvents, ...lifecycleDeltaEvents],
    materializedEvents,
  );
  const publicEvents = materializedEvents.filter(isDashboardVisibleEvent).map(publicRow);
  const ui = buildUiData(summary, materializedEvents, generatedAt);
  if (Array.isArray(ui.closedWonRows)) {
    ui.closedWonRows = ui.closedWonRows.map(publicRow);
  }
  return {
    contract: 'prospect-call-tracker',
    version: 4,
    generatedFrom: 'apps/prospect-web/app/api/call-tracker-data/route.ts',
    data: {
      generatedAt,
      eventLimit: EVENT_LIMIT,
      supabaseReads: {
        summaryView,
        eventView,
        canonicalEventTable,
        compatibilityViews: {
          summaryView,
          eventView,
        },
        lifecycleSourceTable: 'lifecycle_events',
      },
      summary,
      events: publicEvents,
      ui,
    },
  };
}

export async function GET() {
  try {
    return noStoreJson(await buildLiveContract());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return noStoreJson({ success: false, status: 'failed', message }, { status: 500 });
  }
}
