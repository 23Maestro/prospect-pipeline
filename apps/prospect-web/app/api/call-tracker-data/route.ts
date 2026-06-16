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
  'fact_type',
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
const callLogFields = [
  'id',
  'fact_type',
  'athlete_key',
  'athlete_id',
  'athlete_main_id',
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
  PAYLOAD_FIELD,
  'created_at',
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

function asText(value: unknown) {
  return String(value || '').trim();
}

function isIdentityText(value: unknown) {
  const text = asText(value);
  return /^\d+:\d+(?:\b|$)/.test(text);
}

function realText(value: unknown) {
  const text = asText(value);
  return text && !isIdentityText(text) ? text : '';
}

function quotePostgrestInValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowQuality(row: Record<string, any>) {
  return (
    (isCountableMeetingSet(row) ? 32 : 0) +
    (row.dedupe_key ? 8 : 0) +
    (row.booked_event_title ? 4 : 0) +
    (row.appointment_id ? 2 : 0) +
    (row.event_at ? 1 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function isScheduledConfirmationTaskMeetingArtifact(row: Record<string, any>) {
  return (
    row.tracker_outcome === 'meeting_set' &&
    normalizeKey(row.source) === 'scout_tasks_current_pipeline' &&
    normalizeKey(row.raw_task_status) === 'confirmation_call'
  );
}

function isCountableMeetingSet(row: Record<string, any>) {
  return row.counts_as_meeting_set === true && !isScheduledConfirmationTaskMeetingArtifact(row);
}

function normalizeDashboardTruth(row: Record<string, any>) {
  return {
    ...row,
    counts_as_meeting_set: isCountableMeetingSet(row),
  };
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
  return row.tracker_outcome !== 'meeting_set' || isCountableMeetingSet(row);
}

function isPaidClosedWon(row: Record<string, any>) {
  return row.tracker_outcome === 'closed_won' && paidCommissionSources.has(row.source) && Number(row.revenue_cents) > 0;
}

function paidCommissionIdentity(row: Record<string, any>) {
  const body = payload(row);
  return String(body.commission_duplicate_key || row.dedupe_key || '').trim();
}

function paidCommissionQuality(row: Record<string, any>) {
  return (
    (String(row.dedupe_key || '').startsWith('enrollment_payment:') ? 100 : 0) +
    (row.fact_type === 'enrollment_payment' ? 25 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function paidCommissionRows(rows: Array<Record<string, any>>) {
  const byIdentity = new Map<string, Record<string, any>>();
  rows.filter(isPaidClosedWon).forEach((row) => {
    const identity = paidCommissionIdentity(row);
    const previous = byIdentity.get(identity);
    if (!previous || paidCommissionQuality(row) > paidCommissionQuality(previous)) {
      byIdentity.set(identity, row);
    }
  });
  return Array.from(byIdentity.values());
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

function cleanTitleName(value: unknown) {
  const cleaned = asText(value)
    .replace(/^Follow Up -\s*/i, '')
    .replace(/^\([^)]+\)(?:\*\d+)?\s*/i, '')
    .trim();
  if (!cleaned || isIdentityText(cleaned)) return '';
  const match = cleaned.match(/^(.+?)\s+\S+\s+(?:19|20)\d{2}\s+[A-Z]{2}\b/i);
  return realText(match?.[1]) || realText(cleaned);
}

function payloadRealText(row: Record<string, any>, key: string) {
  return realText(payload(row)[key]);
}

function rowAthleteKey(row: Record<string, any>) {
  return asText(row.athlete_key) || [asText(row.athlete_id), asText(row.athlete_main_id)].filter(Boolean).join(':');
}

function addAthleteNames(target: Map<string, string>, rows: Array<Record<string, any>>) {
  for (const row of rows) {
    const key = rowAthleteKey(row);
    const name =
      realText(row.athlete_name) ||
      payloadRealText(row, 'athlete_name') ||
      cleanTitleName(row.booked_event_title) ||
      cleanTitleName(payload(row).meeting_title_base) ||
      cleanTitleName(payload(row).meeting_title_current);
    if (key && name && !target.has(key)) target.set(key, name);
  }
}

async function fetchAthleteNameRows(table: string, keys: string[]) {
  if (!keys.length) return [];
  const order =
    table === 'call_log'
      ? 'order=reporting_at.desc'
      : table === 'athletes'
        ? null
        : 'order=updated_at.desc';
  return supabaseGet(
    [
      `${table}?select=athlete_key,athlete_name`,
      `athlete_key=in.(${keys.map(quotePostgrestInValue).join(',')})`,
      order,
    ]
      .filter(Boolean)
      .join('&'),
  );
}

async function resolveAthleteNames(rows: Array<Record<string, any>>) {
  const names = new Map<string, string>();
  addAthleteNames(names, rows);
  const keysNeedingContext = Array.from(
    new Set(
      rows
        .filter((row) => {
          const key = rowAthleteKey(row);
          return key && !names.has(key) && (!realText(row.athlete_name) || isIdentityText(row.athlete_name));
        })
        .map(rowAthleteKey),
    ),
  );
  if (!keysNeedingContext.length) return names;

  const [athleteRows, contactRows, confirmationRows, callLogRows] = await Promise.all([
    fetchAthleteNameRows('athletes', keysNeedingContext),
    fetchAthleteNameRows('athlete_contact_cache', keysNeedingContext),
    fetchAthleteNameRows('set_meeting_confirmation_cache', keysNeedingContext),
    fetchAthleteNameRows('call_log', keysNeedingContext),
  ]);
  addAthleteNames(names, Array.isArray(athleteRows) ? athleteRows : []);
  addAthleteNames(names, Array.isArray(contactRows) ? contactRows : []);
  addAthleteNames(names, Array.isArray(confirmationRows) ? confirmationRows : []);
  addAthleteNames(names, Array.isArray(callLogRows) ? callLogRows : []);
  return names;
}

function repairAthleteName(row: Record<string, any>, athleteNames: Map<string, string>) {
  const key = rowAthleteKey(row);
  const athleteName =
    realText(row.athlete_name) ||
    athleteNames.get(key) ||
    payloadRealText(row, 'athlete_name') ||
    cleanTitleName(row.booked_event_title) ||
    cleanTitleName(payload(row).meeting_title_base) ||
    cleanTitleName(payload(row).meeting_title_current) ||
    'Unknown Athlete';
  return {
    ...row,
    athlete_name: athleteName,
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

function taskIdForRow(row: Record<string, any>) {
  const body = payload(row);
  return String(body.task_id || body.current_task_id || body.selected_task_id || row.source_row_id || '').trim();
}

function collapseMeetingSetCompanionCallActivity(rows: Array<Record<string, any>>) {
  const meetingSetTaskIds = new Set(
    rows
      .filter((row) => row.tracker_outcome === 'meeting_set' && isCountableMeetingSet(row))
      .map(taskIdForRow)
      .filter(Boolean),
  );
  if (!meetingSetTaskIds.size) return rows;
  return rows.filter((row) => {
    if (row.fact_type !== 'call_activity') return true;
    const taskId = taskIdForRow(row);
    return !taskId || !meetingSetTaskIds.has(taskId);
  });
}

function callLogRowToEvent(row: Record<string, any>) {
  const reportingAt = row.reporting_at || row.event_at || row.occurred_at;
  return {
    ...row,
    source: row.source_system || row.source || 'call_log',
    reporting_date_et: localDateKey(reportingAt),
    [PAYLOAD_FIELD]: row[PAYLOAD_FIELD] || {},
    [MATERIALIZATION_REASON_FIELD]: row[MATERIALIZATION_REASON_FIELD] || row[PAYLOAD_FIELD]?.[MATERIALIZATION_REASON_FIELD] || null,
  };
}

function summaryFromRows(rows: Array<Record<string, any>>) {
  return {
    total_events: rows.length,
    spoke_with: rows.filter((row) =>
      [
        'spoke_follow_up',
        'meeting_set',
        'reschedule_pending',
        'rescheduled',
        'canceled',
        'closed_won',
        'closed_lost',
        'not_interested',
      ].includes(row.tracker_outcome),
    ).length,
    voicemail_only: rows.filter((row) => row.tracker_outcome === 'voicemail').length,
    meetings_set: rows.filter(isCountableMeetingSet).length,
    reschedule_pending: rows.filter((row) => row.tracker_outcome === 'reschedule_pending').length,
    closed_won: rows.filter((row) => row.tracker_outcome === 'closed_won').length,
    money_earned_cents: rows
      .filter((row) => row.tracker_outcome === 'closed_won')
      .reduce((total, row) => total + (Number(row.revenue_cents) || 0), 0),
    first_event_at: rows.reduce<string | null>((earliest, row) => {
      const value = row.occurred_at || row.event_at || row.reporting_at;
      if (!value) return earliest;
      return !earliest || new Date(value).getTime() < new Date(earliest).getTime() ? value : earliest;
    }, null),
    last_event_at: rows.reduce<string | null>((latest, row) => {
      const value = row.occurred_at || row.event_at || row.reporting_at;
      if (!value) return latest;
      return !latest || new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
    }, null),
    appointments_tracked: new Set(rows.map((row) => row.appointment_id).filter(Boolean)).size,
    meeting_outcomes_total: rows.filter((row) => row.counts_as_post_meeting_outcome === true).length,
    rescheduled: rows.filter((row) => row.tracker_outcome === 'rescheduled').length,
    canceled: rows.filter((row) => row.tracker_outcome === 'canceled').length,
    no_show: rows.filter((row) => row.tracker_outcome === 'no_show').length,
    needs_review: rows.filter((row) => row.tracker_outcome === 'needs_review').length,
    dials: rows.filter((row) => row.counts_as_dial === true).length,
    contacts: rows.filter((row) => row.counts_as_contact === true).length,
  };
}

function resolveMeetingSetSummary(
  fallback: Record<string, any>,
  rawRows: Array<Record<string, any>>,
  resolvedRows: Array<Record<string, any>>,
) {
  const rawMeetingSets = rawRows.filter(isCountableMeetingSet).length;
  const resolvedMeetingSets = resolvedRows.filter(isCountableMeetingSet).length;
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

function commissionPeriodForPayDate(payDate: Date) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (day === 28) {
    return {
      start: ymdToLocalNoon(year, month, 1),
      end: ymdToLocalNoon(year, month, 15),
    };
  }
  const previousMonth = addMonths(year, month, -1);
  return {
    start: ymdToLocalNoon(previousMonth.year, previousMonth.month, 16),
    end: ymdToLocalNoon(previousMonth.year, previousMonth.month + 1, 0),
  };
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
  return paidCommissionRows(rows).reduce((total, row) => total + commissionCentsForRow(row), 0);
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

function commissionPeriodLabel(start: Date, end: Date) {
  const startParts = localParts(start);
  const endParts = localParts(end);
  const startMonth = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short' }).format(start);
  const endMonth = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short' }).format(end);
  const startDay = Number(startParts.day);
  const endDay = Number(endParts.day);
  return startMonth === endMonth ? `${startMonth} ${startDay}-${endDay}` : `${startMonth} ${startDay}-${endMonth} ${endDay}`;
}

function rowBelongsToCommissionPeriod(row: Record<string, any>, start: Date, end: Date) {
  const sourceDate = new Date(row.event_at || row.occurred_at || row.created_at);
  if (Number.isNaN(sourceDate.getTime())) return false;
  const sourceKey = localDateKey(sourceDate);
  return sourceKey >= localDateKey(start) && sourceKey <= localDateKey(end);
}

function paycheck(rows: Array<Record<string, any>>, now: Date) {
  const payDate = nextPayDate(now);
  const commissionPeriod = commissionPeriodForPayDate(payDate);
  const baseCents = basePayForDate(payDate);
  const commissionCents = paidCommissionRows(rows)
    .filter((row) => rowBelongsToCommissionPeriod(row, commissionPeriod.start, commissionPeriod.end))
    .reduce((total, row) => total + commissionCentsForRow(row), 0);
  return {
    payDate: payDate.toISOString(),
    payDateLabel: `Next check ${localDateLabel(payDate)}`,
    previousPayDate: commissionPeriod.start.toISOString(),
    commissionPeriodStart: commissionPeriod.start.toISOString(),
    commissionPeriodEnd: commissionPeriod.end.toISOString(),
    commissionPeriodLabel: commissionPeriodLabel(commissionPeriod.start, commissionPeriod.end),
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
    const meetingsSet = scoped.filter(isCountableMeetingSet).length;
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
  const canonicalEventTable = 'call_log';
  const callLogRows = await supabaseGet([`${canonicalEventTable}?select=${encodeURIComponent(callLogFields.join(','))}`, 'order=reporting_at.desc', `limit=${EVENT_LIMIT}`].join('&'));

  const generatedAt = new Date().toISOString();
  const viewEvents = (Array.isArray(callLogRows) ? callLogRows : []).map(callLogRowToEvent);
  const athleteNames = await resolveAthleteNames(viewEvents);
  const repairedEvents = viewEvents.map((row) => repairAthleteName(row, athleteNames));
  const materializedEvents = collapseMeetingSetCompanionCallActivity(mergeEventRows(repairedEvents, [])).map(
    normalizeDashboardTruth,
  );
  const summary = resolveMeetingSetSummary(
    summaryFromRows(materializedEvents),
    materializedEvents,
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
        canonicalEventTable,
        sourceMode: 'call_log_only',
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
