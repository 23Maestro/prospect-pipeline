#!/usr/bin/env node

// Legacy/materialization utility only for static browser contract snapshots.
// Live workflow facts should come from canonical Supabase fact tables.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALL_TRACKER_VERCEL_CONTRACT } from '../src/domain/call-tracker-vercel-contract.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(repoRoot, 'apps/prospect-web/public/prospect-call-tracker/data-contract.json');
const eventLimit = Number(process.env.CALL_TRACKER_CONTRACT_EVENT_LIMIT || 1000);
const TIME_ZONE = 'America/New_York';
const COMMISSION_RATE = 0.2;
const HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT = 13;
const paidCommissionSources = new Set(['stripe_commissions', 'stripe_commission_payroll']);
const hiddenDefaultOutcomes = new Set(['voicemail', 'spoke_follow_up', 'unable_to_leave_vm']);
const meetingOutcomes = new Set([
  'meeting_set',
  'reschedule_pending',
  'rescheduled',
  'canceled',
  'closed_won',
  'closed_lost',
  'no_show',
]);

const credentials = resolveSupabaseCredentials(repoRoot);

if (!credentials.url || !credentials.serviceRoleKey) {
  throw new Error('Missing Supabase credentials for call tracker contract materialization.');
}

function supabaseHeaders() {
  return {
    apikey: credentials.serviceRoleKey,
    Authorization: `Bearer ${credentials.serviceRoleKey}`,
    'Accept-Profile': credentials.schema,
  };
}

async function supabaseGet(path) {
  const response = await fetch(`${credentials.url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function eventSelect() {
  return [
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
    'materialization_reason',
    'resolved_owner_name',
    'resolved_owner_source_field',
    'can_materialize_for_active_operator',
    'payload_json',
    'created_at',
  ].join(',');
}

function localParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value instanceof Date ? value : new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateKey(value) {
  if (!value) return '';
  const parts = localParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateLabel(value) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
  }).format(value);
}

function localDayDateLabel(value) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

function ymdToLocalNoon(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}

function offsetLocalDate(value, dayOffset) {
  const parts = localParts(value);
  return ymdToLocalNoon(Number(parts.year), Number(parts.month), Number(parts.day) + dayOffset);
}

function localWeekdayIndex(value) {
  const shortDay = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
  }).format(value instanceof Date ? value : new Date(value));
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(shortDay);
  return index >= 0 ? index : 0;
}

function currentWeekdayDate(now, mondayOffset) {
  const weekdayIndex = localWeekdayIndex(now);
  const daysSinceMonday = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  return offsetLocalDate(now, Number(mondayOffset) - daysSinceMonday);
}

function currentWeekPeriod(now) {
  const weekdayIndex = localWeekdayIndex(now);
  const mondayOffset = Math.min(4, Math.max(0, weekdayIndex - 1));
  return `week-${mondayOffset}`;
}

function periodDate(now, period) {
  if (period === 'week-total') return now;
  return currentWeekdayDate(now, Number(String(period).replace('week-', '')) || 0);
}

function currentWeekRangeLabel(now) {
  return `${localDateLabel(currentWeekdayDate(now, 0))} - ${localDateLabel(currentWeekdayDate(now, 6))}`;
}

function eventDateKey(row) {
  if (row.tracker_outcome === 'meeting_set') return localDateKey(row.occurred_at);
  if (row.counts_as_post_meeting_outcome === true || (meetingOutcomes.has(row.tracker_outcome) && row.tracker_outcome !== 'meeting_set')) {
    return localDateKey(row.event_at || row.occurred_at);
  }
  return localDateKey(row.occurred_at);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowQuality(row) {
  return (
    (row.booked_event_title ? 4 : 0) +
    (row.appointment_id ? 2 : 0) +
    (row.event_at ? 1 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function displayRows(rows) {
  const byKey = new Map();
  const results = [];
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
  return results.sort((left, right) => new Date(right.event_at || right.occurred_at) - new Date(left.event_at || left.occurred_at));
}

function rowsForPeriod(rows, now, period) {
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

function periodLabel(now, period) {
  return period === 'week-total' ? `This Week, ${currentWeekRangeLabel(now)}` : localDayDateLabel(periodDate(now, period));
}

function outcomeCounts(rows) {
  return rows.reduce((acc, row) => {
    acc[row.tracker_outcome] = (acc[row.tracker_outcome] || 0) + 1;
    return acc;
  }, {});
}

function filterCounts(rows) {
  const counts = outcomeCounts(rows);
  return {
    meaningful: rows.filter((row) => !hiddenDefaultOutcomes.has(row.tracker_outcome)).length,
    all_calls: rows.length,
    meetings: rows.filter((row) => row.tracker_outcome === 'meeting_set').length,
    closed_won: counts.closed_won || 0,
    closed_lost: counts.closed_lost || 0,
    reschedule_pending: counts.reschedule_pending || 0,
    no_show: counts.no_show || 0,
    canceled: counts.canceled || 0,
  };
}

function mergeEventRows(viewRows) {
  const byKey = new Map();
  for (const row of viewRows) {
    const key = row.dedupe_key || `${row.source}:${row.athlete_name}:${row.tracker_outcome}:${row.event_at || row.occurred_at}`;
    const previous = byKey.get(key);
    if (!previous || rowQuality(row) > rowQuality(previous)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    new Date(right.event_at || right.occurred_at) - new Date(left.event_at || left.occurred_at),
  );
}

function addMonths(year, month, offset) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function nextPayDate(now) {
  const parts = localParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const payMonth = day <= 28 ? month : month === 12 ? 1 : month + 1;
  const payYear = day <= 28 ? year : month === 12 ? year + 1 : year;
  return ymdToLocalNoon(payYear, payMonth, day <= 14 ? 14 : day <= 28 ? 28 : 14);
}

function commissionPeriodForPayDate(payDate) {
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

function basePayForDate(payDate) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return year === 2026 && month >= 5 && month <= 7 && day <= 28 ? 100000 : 50000;
}

function commissionCentsForRow(row) {
  return Math.round((Number(row.revenue_cents) || 0) * COMMISSION_RATE);
}

function isPaidClosedWon(row) {
  return row.tracker_outcome === 'closed_won' && paidCommissionSources.has(row.source) && Number(row.revenue_cents) > 0;
}

function paidCommissionIdentity(row) {
  return String(row.payload_json?.commission_duplicate_key || row.dedupe_key || '').trim();
}

function paidCommissionQuality(row) {
  return (
    (String(row.dedupe_key || '').startsWith('enrollment_payment:') ? 100 : 0) +
    (row.fact_type === 'enrollment_payment' ? 25 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function paidCommissionRows(rows) {
  const byIdentity = new Map();
  rows.filter(isPaidClosedWon).forEach((row) => {
    const identity = paidCommissionIdentity(row);
    const previous = byIdentity.get(identity);
    if (!previous || paidCommissionQuality(row) > paidCommissionQuality(previous)) {
      byIdentity.set(identity, row);
    }
  });
  return Array.from(byIdentity.values());
}

function commissionCentsForRows(rows) {
  return paidCommissionRows(rows).reduce((total, row) => total + commissionCentsForRow(row), 0);
}

function closedWonIdentity(row) {
  return [
    row.athlete_key,
    row.athlete_main_id,
    row.athlete_id,
    normalizeKey(row.athlete_name),
  ].find((value) => String(value || '').trim()) || normalizeKey(row.booked_event_title);
}

function closedWonQuality(row) {
  return (
    (isPaidClosedWon(row) ? 100 : 0) +
    (Number(row.revenue_cents) > 0 ? 25 : 0) +
    (row.source === 'stripe_commissions' ? 10 : 0) +
    (String(row.dedupe_key || '').startsWith('enrollment_payment:') ? 4 : 0) +
    (row.appointment_id ? 2 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function definitiveClosedWonRows(rows) {
  const byIdentity = new Map();
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

function commissionPeriodLabel(start, end) {
  const startParts = localParts(start);
  const endParts = localParts(end);
  const startMonth = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short' }).format(start);
  const endMonth = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'short' }).format(end);
  const startDay = Number(startParts.day);
  const endDay = Number(endParts.day);
  return startMonth === endMonth ? `${startMonth} ${startDay}-${endDay}` : `${startMonth} ${startDay}-${endMonth} ${endDay}`;
}

function rowBelongsToCommissionPeriod(row, start, end) {
  const sourceDate = new Date(row.event_at || row.occurred_at || row.created_at);
  if (Number.isNaN(sourceDate.getTime())) return false;
  const sourceKey = localDateKey(sourceDate);
  return sourceKey >= localDateKey(start) && sourceKey <= localDateKey(end);
}

function paycheck(rows, now) {
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

function buildUiData(summary, events, generatedAt) {
  const now = new Date(generatedAt);
  const rows = displayRows(events);
  const rawAllTimeContacts = Number(summary.contacts) || 0;
  const correctedAllTimeContacts = rawAllTimeContacts + HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT;
  const periods = {};
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
  const closeRate = meetingOutcomesTotal ? Math.round((closedWonRows.length / meetingOutcomesTotal) * 100) : 0;
  return {
    activePeriod: currentWeekPeriod(now),
    rangeLabel: currentWeekRangeLabel(now),
    summaryCards: {
      moneyEarnedCents: commissionCentsForRows(rows),
      closedWon: closedWonRows.length,
      contacts: correctedAllTimeContacts,
      rawContacts: rawAllTimeContacts,
      historicalContactsAdjustment: HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT,
      dials: Number(summary.dials) || 0,
      voicemailOnly: Number(summary.voicemail_only) || 0,
      appointmentsTracked: Number(summary.appointments_tracked) || 0,
      closeRate,
    },
    manualCorrections: {
      allTimeContactsAdjustment: HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT,
      rawAllTimeContacts,
      correctedAllTimeContacts,
      reason:
        'Historical manual correction for contacts lost during mid-tracking implementation. Supabase facts remain strict; this adjusts all-time Vercel UI contacts/set-rate only.',
    },
    paycheck: paycheck(rows, now),
    periods,
    closedWonRows: closedWonRows.sort((left, right) => Number(right.revenue_cents || 0) - Number(left.revenue_cents || 0)),
  };
}

function callLogRowToEvent(row) {
  const reportingAt = row.reporting_at || row.event_at || row.occurred_at;
  return {
    ...row,
    source: row.source_system || row.source || 'call_log',
    reporting_date_et: localDateKey(reportingAt),
    materialization_reason: row.materialization_reason || row.payload_json?.materialization_reason || null,
  };
}

function taskIdForRow(row) {
  const payload = row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json) ? row.payload_json : {};
  return String(payload.task_id || payload.current_task_id || payload.selected_task_id || row.source_row_id || '').trim();
}

function collapseMeetingSetCompanionCallActivity(rows) {
  const meetingSetTaskIds = new Set(
    rows
      .filter((row) => row.tracker_outcome === 'meeting_set' && row.counts_as_meeting_set === true)
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

function summaryFromRows(rows) {
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
    meetings_set: rows.filter((row) => row.counts_as_meeting_set === true).length,
    meeting_outcomes_total: rows.filter((row) => row.counts_as_post_meeting_outcome === true).length,
    closed_won: rows.filter((row) => row.tracker_outcome === 'closed_won').length,
    money_earned_cents: rows
      .filter((row) => row.tracker_outcome === 'closed_won')
      .reduce((total, row) => total + (Number(row.revenue_cents) || 0), 0),
    dials: rows.filter((row) => row.counts_as_dial === true).length,
    contacts: rows.filter((row) => row.counts_as_contact === true).length,
    appointments_tracked: new Set(rows.map((row) => row.appointment_id).filter(Boolean)).size,
  };
}

async function materialize() {
  const canonicalEventTable = CALL_TRACKER_VERCEL_CONTRACT.liveSupabaseApi.canonicalEventTable;
  const events = await supabaseGet(
    [
      `${canonicalEventTable}?select=${encodeURIComponent(eventSelect())}`,
      'order=reporting_at.desc',
      `limit=${eventLimit}`,
    ].join('&'),
  );

  const generatedAt = new Date().toISOString();
  const viewEvents = (Array.isArray(events) ? events : []).map(callLogRowToEvent);
  const materializedEvents = collapseMeetingSetCompanionCallActivity(mergeEventRows(viewEvents));
  const summary = summaryFromRows(materializedEvents);
  return {
    ...CALL_TRACKER_VERCEL_CONTRACT,
    data: {
      generatedAt,
      eventLimit,
      supabaseReads: {
        canonicalEventTable,
        sourceMode: 'call_log_only',
      },
      summary,
      events: materializedEvents,
      ui: buildUiData(summary, materializedEvents, generatedAt),
    },
  };
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(await materialize(), null, 2)}\n`);
console.log(`materialized ${target}`);
