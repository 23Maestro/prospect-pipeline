#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALL_TRACKER_VERCEL_CONTRACT } from '../src/domain/call-tracker-vercel-contract.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(repoRoot, 'apps/prospect-web/public/prospect-call-tracker/data-contract.json');
const eventLimit = Number(process.env.CALL_TRACKER_CONTRACT_EVENT_LIMIT || 1000);
const TIME_ZONE = 'America/New_York';
const COMMISSION_RATE = 0.175;
const HISTORICAL_ALL_TIME_CONTACTS_ADJUSTMENT = 13;
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
  return [...new Set(CALL_TRACKER_VERCEL_CONTRACT.browserContract.eventFeed.requiredFields)].join(',');
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
    meetings: rows.filter((row) => meetingOutcomes.has(row.tracker_outcome)).length,
    closed_won: counts.closed_won || 0,
    closed_lost: counts.closed_lost || 0,
    reschedule_pending: counts.reschedule_pending || 0,
    no_show: counts.no_show || 0,
    canceled: counts.canceled || 0,
  };
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

function basePayForDate(payDate) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return year === 2026 && month >= 5 && month <= 7 && day <= 28 ? 100000 : 50000;
}

function firstSubscriptionBillDate(row) {
  const sourceDate = new Date(row.event_at || row.occurred_at || row.created_at);
  if (Number.isNaN(sourceDate.getTime())) return null;
  const parts = localParts(sourceDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (day <= 15) return ymdToLocalNoon(year, month, 23);
  const nextMonth = addMonths(year, month, 1);
  return ymdToLocalNoon(nextMonth.year, nextMonth.month, 8);
}

function paycheck(rows, now) {
  const payDate = nextPayDate(now);
  const baseCents = basePayForDate(payDate);
  const commissionCents = Math.round(rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .reduce((total, row) => {
      const revenueCents = Number(row.revenue_cents) || 0;
      const firstBillDate = firstSubscriptionBillDate(row);
      if (!revenueCents || !firstBillDate) return total;
      if (firstBillDate.getTime() > now.getTime() || firstBillDate.getTime() > payDate.getTime()) return total;
      return total + Math.round(revenueCents * COMMISSION_RATE);
    }, 0) / 2);
  return {
    payDate: payDate.toISOString(),
    payDateLabel: `Next check ${localDateLabel(payDate)}`,
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
  const closeRate = meetingOutcomesTotal ? Math.round((Number(summary.closed_won || 0) / meetingOutcomesTotal) * 100) : 0;
  return {
    activePeriod: currentWeekPeriod(now),
    rangeLabel: currentWeekRangeLabel(now),
    summaryCards: {
      moneyEarnedCents: Number(summary.money_earned_cents) || 0,
      closedWon: Number(summary.closed_won) || 0,
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
    closedWonRows: rows
      .filter((row) => row.tracker_outcome === 'closed_won')
      .sort((left, right) => Number(right.revenue_cents || 0) - Number(left.revenue_cents || 0)),
  };
}

async function materialize() {
  const summaryView = CALL_TRACKER_VERCEL_CONTRACT.browserContract.summaryHelper.supabaseView;
  const eventView = CALL_TRACKER_VERCEL_CONTRACT.browserContract.eventFeed.supabaseView;
  const [summaryRows, events] = await Promise.all([
    supabaseGet(`${summaryView}?select=*`),
    supabaseGet(
      [
        `${eventView}?select=${encodeURIComponent(eventSelect())}`,
        'order=event_at.desc',
        `limit=${eventLimit}`,
      ].join('&'),
    ),
  ]);

  const generatedAt = new Date().toISOString();
  const summary = summaryRows[0] || {};
  const materializedEvents = Array.isArray(events) ? events : [];
  return {
    ...CALL_TRACKER_VERCEL_CONTRACT,
    data: {
      generatedAt,
      eventLimit,
      supabaseReads: {
        summaryView,
        eventView,
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
