const STORAGE_KEY = 'call-tracker:supabase-config';
const TIME_ZONE = 'America/New_York';
const COMMISSION_RATE = 0.175;

const labels = {
  meaningful: 'Meaningful',
  all_calls: 'All Calls',
  meetings: 'Meetings',
  closed_won: 'Won',
  closed_lost: 'Lost',
  spoke_follow_up: 'Spoke',
  unable_to_leave_vm: 'No VM',
  voicemail: 'VM',
  meeting_set: 'Set',
  reschedule_pending: 'RSP',
  rescheduled: 'Rescheduled',
  canceled: 'Canceled',
  no_show: 'No Show',
};

const tableFilters = ['meaningful', 'all_calls', 'meetings', 'closed_won', 'closed_lost', 'reschedule_pending', 'no_show', 'canceled'];
const meetingOutcomes = new Set([
  'meeting_set',
  'reschedule_pending',
  'rescheduled',
  'canceled',
  'closed_won',
  'closed_lost',
  'no_show',
]);
const hiddenDefaultOutcomes = new Set(['voicemail', 'spoke_follow_up', 'unable_to_leave_vm']);

const state = {
  rows: [],
  summary: null,
  activeFilter: 'meaningful',
  activePeriod: currentWeekPeriod(),
};

function $(id) {
  return document.getElementById(id);
}

function money(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function shortDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
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

function currentWeekdayDate(mondayOffset) {
  const today = new Date();
  const weekdayIndex = localWeekdayIndex(today);
  const daysSinceMonday = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  return offsetLocalDate(today, Number(mondayOffset) - daysSinceMonday);
}

function currentWeekPeriod() {
  const weekdayIndex = localWeekdayIndex(new Date());
  const mondayOffset = Math.min(4, Math.max(0, weekdayIndex - 1));
  return `week-${mondayOffset}`;
}

function activePeriodDate() {
  if (state.activePeriod === 'week-total') {
    return new Date();
  }
  if (state.activePeriod.startsWith('week-')) {
    return currentWeekdayDate(Number(state.activePeriod.replace('week-', '')) || 0);
  }
  return activePeriodDateForPeriod(currentWeekPeriod());
}

function activePeriodDateForPeriod(period) {
  if (period === 'week-total') {
    return new Date();
  }
  if (String(period || '').startsWith('week-')) {
    return currentWeekdayDate(Number(String(period).replace('week-', '')) || 0);
  }
  return activePeriodDateForPeriod(currentWeekPeriod());
}

function activePeriodLabel() {
  if (state.activePeriod === 'week-total') {
    return `This Week, ${currentWeekRangeLabel()}`;
  }
  return localDayDateLabel(activePeriodDate());
}

function currentWeekRangeLabel() {
  return `${localDateLabel(currentWeekdayDate(0))} - ${localDateLabel(currentWeekdayDate(6))}`;
}

function ymdToLocalNoon(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}

function addMonths(year, month, offset) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function getConfig() {
  const generated = window.CALL_TRACKER_CONFIG || {};
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  return {
    supabaseUrl: generated.supabaseUrl || stored.supabaseUrl || '',
    anonKey: generated.anonKey || stored.anonKey || '',
    schema: generated.schema || stored.schema || 'public',
    syncEndpoint: generated.syncEndpoint || stored.syncEndpoint || defaultSyncEndpoint(),
  };
}

function defaultSyncEndpoint() {
  return '/api/v1/call-tracker/sync';
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function supabaseGet(path) {
  const config = getConfig();
  if (!config.supabaseUrl || !config.anonKey) {
    throw new Error('missing_config');
  }

  const response = await fetch(`${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${path}`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Accept-Profile': config.schema,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function loadData() {
  $('statusText').textContent = 'Loading';
  const [summaryRows, eventRows] = await Promise.all([
    supabaseGet('call_tracker_summary?select=*'),
    supabaseGet(
      [
        'call_tracker_events_owner_context?select=athlete_name,occurred_at,event_at,tracker_outcome,raw_crm_stage,raw_task_status,raw_event_type,appointment_id,booked_event_title,revenue_cents,counts_as_dial,counts_as_contact,counts_as_meeting_set,counts_as_post_meeting_outcome,materialization_reason,resolved_owner_name',
        'order=event_at.desc',
        'limit=250',
      ].join('&'),
    ),
  ]);

  state.summary = summaryRows[0] || {};
  state.rows = Array.isArray(eventRows) ? eventRows : [];
  render();
}

async function syncSourceData() {
  const config = getConfig();
  if (!config.syncEndpoint) return null;
  $('statusText').textContent = 'Syncing';
  const response = await fetch(config.syncEndpoint, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.detail || payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  if (payload.status === 'started' || payload.status === 'already_running' || payload.running) {
    return pollSyncStatus(config.syncEndpoint);
  }
  return payload;
}

async function pollSyncStatus(syncEndpoint) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await fetch(syncEndpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.detail || payload.error || payload.message || `HTTP ${response.status}`;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    if (!payload.running && payload.status !== 'running' && payload.status !== 'started') {
      if (payload.success === false || payload.status === 'failed') {
        throw new Error(payload.message || 'Sync failed');
      }
      return payload;
    }
    $('statusText').textContent = 'Syncing';
  }
  throw new Error('Sync timed out');
}

async function refreshAllData() {
  await syncSourceData();
  await loadData();
}

function setText(id, value) {
  $(id).textContent = value;
}

function countsAsDial(row) {
  return row.counts_as_dial === true;
}

function countsAsContact(row) {
  return row.counts_as_contact === true;
}

function countsAsMeetingSet(row) {
  return row.counts_as_meeting_set === true;
}

function isMeaningfulEvent(row) {
  return !hiddenDefaultOutcomes.has(row.tracker_outcome);
}

function periodScopedRows(rows, dateKeyForRow = eventDateKey) {
  if (state.activePeriod === 'week-total') {
    const weekStart = localDateKey(currentWeekdayDate(0));
    const weekEnd = localDateKey(currentWeekdayDate(6));
    return rows.filter((row) => {
      const rowKey = dateKeyForRow(row);
      return rowKey >= weekStart && rowKey <= weekEnd;
    });
  }

  const periodKey = localDateKey(activePeriodDate());
  return rows.filter((row) => dateKeyForRow(row) === periodKey);
}

function scopedRows() {
  return periodScopedRows(displayRows());
}

function scopedActivityRows() {
  return periodScopedRows(displayRows(), (row) => localDateKey(row.occurred_at));
}

function eventDateKey(row) {
  if (row.tracker_outcome === 'meeting_set') {
    return localDateKey(row.occurred_at);
  }
  if (isPostMeetingResult(row) || (meetingOutcomes.has(row.tracker_outcome) && row.tracker_outcome !== 'meeting_set')) {
    return localDateKey(row.event_at || row.occurred_at);
  }
  return localDateKey(row.occurred_at);
}

function isPostMeetingResult(row) {
  const stage = normalizeKey(row.raw_crm_stage || row.raw_task_status);
  const title = normalizeKey(row.booked_event_title);
  return (
    stage.startsWith('actual meeting') ||
    stage.startsWith('meeting result') ||
    title.startsWith('(fu)') ||
    title.startsWith('(enr') ||
    title.startsWith('(rsp)') ||
    title.startsWith('(ns)') ||
    title.startsWith('(can)') ||
    title.startsWith('(cl)')
  );
}

function displayRows() {
  return dedupePipelineRows(state.rows).sort(
    (left, right) => new Date(right.event_at || right.occurred_at) - new Date(left.event_at || left.occurred_at),
  );
}

function dedupePipelineRows(rows) {
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

    const keepCurrent = rowQuality(row) > rowQuality(previous);
    if (keepCurrent) {
      const index = results.indexOf(previous);
      if (index >= 0) results[index] = row;
      byKey.set(key, row);
    }
  });

  return results;
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

function renderPeriod() {
  const rows = scopedActivityRows();
  const meetingsSet = rows.filter(countsAsMeetingSet).length;
  const calls = rows.filter(countsAsDial).length;
  const contacts = rows.filter(countsAsContact).length;
  const setRate = contacts ? Math.round((meetingsSet / contacts) * 100) : 0;

  setText('periodTitle', activePeriodLabel());
  setText('todayLabel', 'Local ET');
  setText('todayCalls', calls);
  setText('todayContacts', contacts);
  setText('todayMeetingsSet', meetingsSet);
  setText('todaySetRate', `${setRate}%`);

  document.querySelectorAll('[data-period]').forEach((button) => {
    button.classList.toggle('active', button.dataset.period === state.activePeriod);
  });
}

function nextPayDate(now = new Date()) {
  const parts = localParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const payDay = day <= 14 ? 14 : day <= 28 ? 28 : 14;
  const payMonth = day <= 28 ? month : month === 12 ? 1 : month + 1;
  const payYear = day <= 28 ? year : month === 12 ? year + 1 : year;
  return ymdToLocalNoon(payYear, payMonth, payDay);
}

function basePayForDate(payDate) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const bonusBaseActive = year === 2026 && month >= 5 && month <= 7 && day <= 28;
  return bonusBaseActive ? 100000 : 50000;
}

function firstSubscriptionBillDate(row) {
  const sourceDate = new Date(row.event_at || row.occurred_at || row.created_at);
  if (Number.isNaN(sourceDate.getTime())) return null;
  const parts = localParts(sourceDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);

  if (day <= 15) {
    return ymdToLocalNoon(year, month, 23);
  }

  const nextMonth = addMonths(year, month, 1);
  return ymdToLocalNoon(nextMonth.year, nextMonth.month, 8);
}

function monthlySubscriptionCommissionCents(payDate, now = new Date()) {
  return state.rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .reduce((total, row) => {
      const revenueCents = Number(row.revenue_cents) || 0;
      const firstBillDate = firstSubscriptionBillDate(row);
      if (!revenueCents || !firstBillDate) return total;
      if (firstBillDate.getTime() > now.getTime() || firstBillDate.getTime() > payDate.getTime()) {
        return total;
      }
      return total + Math.round(revenueCents * COMMISSION_RATE);
    }, 0);
}

function renderPaycheck() {
  const now = new Date();
  const payDate = nextPayDate();
  const baseCents = basePayForDate(payDate);
  const commissionCents = Math.round(monthlySubscriptionCommissionCents(payDate, now) / 2);
  const totalCents = baseCents + commissionCents;

  setText('payDateLabel', `Next check ${localDateLabel(payDate)}`);
  setText('nextPaycheck', money(totalCents));
  setText('basePayLine', `Base ${money(baseCents)}`);
  setText('commissionPayLine', `Commission ${money(commissionCents)}`);
}

function renderSummary() {
  const summary = state.summary || {};
  setText('moneyEarned', money(summary.money_earned_cents));
  setText('closedWon', summary.closed_won || 0);
  setText('spokeWith', summary.contacts || 0);
  setText('totalEvents', summary.dials || 0);
  setText('voicemailOnly', summary.voicemail_only || 0);
  setText('appointmentsTracked', summary.appointments_tracked || 0);

  setText('rangeLabel', currentWeekRangeLabel());

  const denominator = Number(summary.meeting_outcomes_total) || 0;
  const rate = denominator ? Math.round((Number(summary.closed_won || 0) / denominator) * 100) : 0;
  setText('closeRate', `${rate}%`);
}

function outcomeCounts() {
  return scopedRows().reduce((acc, row) => {
    acc[row.tracker_outcome] = (acc[row.tracker_outcome] || 0) + 1;
    return acc;
  }, {});
}

function renderBars() {
  const counts = outcomeCounts();
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));

  $('outcomeBars').innerHTML = entries
    .map(([outcome, count]) => {
      const width = Math.round((count / max) * 100);
      return `
        <div class="bar-row">
          <span>${labels[outcome] || outcome}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <b>${count}</b>
        </div>
      `;
    })
    .join('');
}

function renderClosedWon() {
  const closed = state.rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .sort((left, right) => Number(right.revenue_cents || 0) - Number(left.revenue_cents || 0));

  $('closedWonList').innerHTML = closed.length
    ? closed
        .map(
          (row) => `
            <div class="closed-item">
              <div>
                <strong>${row.athlete_name || 'Unknown'}</strong>
                <span>${row.booked_event_title || row.raw_crm_stage || ''}</span>
              </div>
              <b>${money(row.revenue_cents)}</b>
            </div>
          `,
        )
        .join('')
    : '<p class="empty">No closes yet.</p>';
}

function renderFilters() {
  const counts = outcomeCounts();
  const rows = scopedRows();
  $('filters').innerHTML = tableFilters
    .map((outcome) => {
      const count =
        outcome === 'all_calls'
          ? rows.length
          : outcome === 'meaningful'
            ? rows.filter(isMeaningfulEvent).length
          : outcome === 'meetings'
            ? rows.filter((row) => meetingOutcomes.has(row.tracker_outcome)).length
            : counts[outcome] || 0;
      const active = state.activeFilter === outcome ? 'active' : '';
      return `<button type="button" class="${active}" data-outcome="${outcome}">${labels[outcome] || outcome} ${count}</button>`;
    })
    .join('');

  $('filters').querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeFilter = button.dataset.outcome;
      render();
    });
  });
}

function visibleRows() {
  const rows = scopedRows();
  if (state.activeFilter === 'all_calls') return rows;
  if (state.activeFilter === 'meaningful') return rows.filter(isMeaningfulEvent);
  if (state.activeFilter === 'meetings') {
    return rows.filter((row) => meetingOutcomes.has(row.tracker_outcome));
  }
  return rows.filter((row) => row.tracker_outcome === state.activeFilter);
}

function renderTable() {
  $('eventsBody').innerHTML = visibleRows()
    .map(
      (row) => `
        <tr>
          <td>${shortDate(row.event_at || row.occurred_at)}</td>
          <td class="name-cell">${row.athlete_name || ''}</td>
          <td><span class="pill ${row.tracker_outcome}">${labels[row.tracker_outcome] || row.tracker_outcome}</span></td>
          <td>${row.raw_crm_stage || row.raw_task_status || ''}</td>
          <td class="event-title" title="${eventTitle(row)}">
            <span>${eventTitle(row)}</span>
            <small class="proof-line">${proofLine(row)}</small>
          </td>
          <td class="money-cell">${Number(row.revenue_cents || 0) ? money(row.revenue_cents) : ''}</td>
        </tr>
      `,
    )
    .join('');
}

function eventTitle(row) {
  if (row.tracker_outcome === 'meeting_set' && row.appointment_starts_at) {
    return `${row.booked_event_title || 'Meeting Set'} • ${shortDate(row.appointment_starts_at)}`;
  }
  return row.booked_event_title || row.appointment_id || '';
}

function proofLine(row) {
  const flags = [
    row.counts_as_dial === true ? 'dial' : null,
    row.counts_as_contact === true ? 'contact' : null,
    row.counts_as_meeting_set === true ? 'set' : null,
    row.counts_as_post_meeting_outcome === true ? 'post' : null,
  ].filter(Boolean);
  const owner = row.resolved_owner_name || row.materialization_reason || '';
  return [flags.join(' + '), owner].filter(Boolean).join(' | ');
}

function render() {
  renderSummary();
  renderPeriod();
  renderPaycheck();
  renderBars();
  renderClosedWon();
  renderFilters();
  renderTable();
  $('statusText').textContent = 'Live';
}

function openConfig() {
  const config = getConfig();
  $('supabaseUrlInput').value = config.supabaseUrl;
  $('anonKeyInput').value = config.anonKey;
  $('configDialog').showModal();
}

function wireConfigForm() {
  $('configForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    saveConfig({
      supabaseUrl: $('supabaseUrlInput').value.trim(),
      anonKey: $('anonKeyInput').value.trim(),
      schema: 'public',
    });
    $('configDialog').close();
    await loadData().catch(handleLoadError);
  });
}

function handleLoadError(error) {
  if (String(error?.message || '') === 'missing_config') {
    openConfig();
    $('statusText').textContent = 'Config';
    return;
  }
  $('statusText').textContent = 'Error';
  console.error(error);
}

document.addEventListener('DOMContentLoaded', () => {
  state.activePeriod = currentWeekPeriod();
  wireConfigForm();
  $('refreshButton').addEventListener('click', () => refreshAllData().catch(handleLoadError));
  document.querySelectorAll('[data-period]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activePeriod = button.dataset.period || currentWeekPeriod();
      render();
    });
  });
  loadData().catch(handleLoadError);
});
