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
  voicemail: 'VM',
  meeting_set: 'Set',
  reschedule_pending: 'RSP',
  rescheduled: 'Rescheduled',
  canceled: 'Canceled',
  no_show: 'No Show',
  needs_review: 'Review',
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
const hiddenDefaultOutcomes = new Set(['voicemail', 'spoke_follow_up']);
const callActivityOutcomes = new Set(['voicemail', 'spoke_follow_up', 'meeting_set', 'needs_review']);
const contactMadeOutcomes = new Set(['spoke_follow_up', 'meeting_set']);

const state = {
  rows: [],
  summary: null,
  activeFilter: 'meaningful',
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

function ymdToLocalNoon(year, month, day) {
  return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00-04:00`);
}

function getConfig() {
  const generated = window.CALL_TRACKER_CONFIG || {};
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  return {
    supabaseUrl: generated.supabaseUrl || stored.supabaseUrl || '',
    anonKey: generated.anonKey || stored.anonKey || '',
    schema: generated.schema || stored.schema || 'public',
  };
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
  $('statusText').textContent = 'Syncing';
  const [summaryRows, eventRows] = await Promise.all([
    supabaseGet('call_tracker_summary?select=*'),
    supabaseGet(
      [
        'call_tracker_events?select=athlete_name,occurred_at,event_at,tracker_outcome,raw_crm_stage,raw_task_status,appointment_id,booked_event_title,revenue_cents',
        'order=event_at.desc',
        'limit=250',
      ].join('&'),
    ),
  ]);

  state.summary = summaryRows[0] || {};
  state.rows = Array.isArray(eventRows) ? eventRows : [];
  render();
}

function setText(id, value) {
  $(id).textContent = value;
}

function isMeaningfulEvent(row) {
  return !hiddenDefaultOutcomes.has(row.tracker_outcome);
}

function todayRows() {
  const todayKey = localDateKey(new Date());
  return state.rows.filter((row) => localDateKey(row.occurred_at) === todayKey);
}

function renderToday() {
  const rows = todayRows();
  const calls = rows.filter((row) => callActivityOutcomes.has(row.tracker_outcome)).length;
  const contacts = rows.filter((row) => contactMadeOutcomes.has(row.tracker_outcome)).length;
  const meetingsSet = rows.filter((row) => row.tracker_outcome === 'meeting_set').length;
  const setRate = contacts ? Math.round((meetingsSet / contacts) * 100) : 0;

  setText('todayLabel', localDateLabel(new Date()));
  setText('todayCalls', calls);
  setText('todayContacts', contacts);
  setText('todayMeetingsSet', meetingsSet);
  setText('todaySetRate', `${setRate}%`);
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

function monthlySubscriptionCommissionCents() {
  return state.rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .reduce((total, row) => total + Math.round((Number(row.revenue_cents) || 0) * COMMISSION_RATE), 0);
}

function renderPaycheck() {
  const payDate = nextPayDate();
  const baseCents = basePayForDate(payDate);
  const commissionCents = Math.round(monthlySubscriptionCommissionCents() / 2);
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
  setText('spokeWith', summary.spoke_with || 0);
  setText('totalEvents', summary.total_events || 0);
  setText('voicemailOnly', summary.voicemail_only || 0);
  setText('appointmentsTracked', summary.appointments_tracked || 0);

  const start = summary.first_event_at ? shortDate(summary.first_event_at) : '';
  const end = summary.last_event_at ? shortDate(summary.last_event_at) : '';
  setText('rangeLabel', start && end ? `${start} - ${end}` : 'No events');

  const denominator = Number(summary.meeting_outcomes_total) || 0;
  const rate = denominator ? Math.round((Number(summary.closed_won || 0) / denominator) * 100) : 0;
  setText('closeRate', `${rate}%`);
}

function outcomeCounts() {
  return state.rows.reduce((acc, row) => {
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
  $('filters').innerHTML = tableFilters
    .map((outcome) => {
      const count =
        outcome === 'all_calls'
          ? state.rows.length
          : outcome === 'meaningful'
            ? state.rows.filter(isMeaningfulEvent).length
          : outcome === 'meetings'
            ? state.rows.filter((row) => meetingOutcomes.has(row.tracker_outcome)).length
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
  if (state.activeFilter === 'all_calls') return state.rows;
  if (state.activeFilter === 'meaningful') return state.rows.filter(isMeaningfulEvent);
  if (state.activeFilter === 'meetings') {
    return state.rows.filter((row) => meetingOutcomes.has(row.tracker_outcome));
  }
  return state.rows.filter((row) => row.tracker_outcome === state.activeFilter);
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
          <td class="event-title" title="${row.booked_event_title || ''}">${row.booked_event_title || row.appointment_id || ''}</td>
          <td class="money-cell">${Number(row.revenue_cents || 0) ? money(row.revenue_cents) : ''}</td>
        </tr>
      `,
    )
    .join('');
}

function render() {
  renderSummary();
  renderToday();
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
  wireConfigForm();
  $('refreshButton').addEventListener('click', () => loadData().catch(handleLoadError));
  loadData().catch(handleLoadError);
});
