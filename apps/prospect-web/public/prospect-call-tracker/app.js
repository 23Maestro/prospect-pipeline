const CONTRACT_URL = '/api/call-tracker-data';
const WEEKLY_INDEX_URL = '/prospect-call-tracker/weekly-results/index.json';
const TIME_ZONE = 'America/New_York';
const COMMISSION_RATE = 0.2;

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
  ui: null,
  contract: null,
  weeklyArchiveIndex: null,
  weeklyArchiveDetails: new Map(),
  activeView: 'live-week',
  activeFilter: 'meaningful',
  activePeriod: currentWeekPeriod(),
};

function $(id) {
  return document.getElementById(id);
}

function money(cents) {
  const value = Number(cents) || 0;
  const fractionDigits = Math.abs(value % 100) === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanClosedWonTitle(row) {
  const athleteName = String(row.athlete_name || '').trim();
  const rawTitle = String(row.booked_event_title || row.raw_crm_stage || athleteName || 'Closed Won').trim();
  const withoutOutcome = rawTitle.replace(/^\((?:ENR|FU|CL|RSP|NS|CAN)(?:\s+\$?\d+(?:\.\d{1,2})?)?(?:\s*-[^)]+)?\)\s*/i, '').trim();
  if (!athleteName) return withoutOutcome || rawTitle;
  const duplicated = `${athleteName} ${athleteName}`;
  if (withoutOutcome.toLowerCase().startsWith(duplicated.toLowerCase())) {
    return `${athleteName}${withoutOutcome.slice(duplicated.length)}`.trim();
  }
  return withoutOutcome || athleteName;
}

function closedWonDisplay(row) {
  const title = cleanClosedWonTitle(row);
  const athleteName = String(row.athlete_name || '').trim();
  if (!athleteName) return { name: title, subtitle: '' };
  const normalizedTitle = title.toLowerCase();
  const normalizedName = athleteName.toLowerCase();
  if (!normalizedTitle.startsWith(normalizedName)) {
    return { name: athleteName, subtitle: title };
  }
  return {
    name: athleteName,
    subtitle: title.slice(athleteName.length).trim(),
  };
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

function monthName(value = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'long',
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
    return currentWeekRangeLabel();
  }
  return localDayDateLabel(activePeriodDate());
}

function currentWeekRangeLabel() {
  return `${localDateLabel(currentWeekdayDate(0))} - ${localDateLabel(currentWeekdayDate(6))}`;
}

function archivePeriodDate(period) {
  const week = selectedArchiveWeek();
  if (!week?.startDate || period === 'week-total' || !String(period || '').startsWith('week-')) {
    return null;
  }
  const start = ymdToLocalNoon(...week.startDate.split('-').map(Number));
  return offsetLocalDate(start, Number(String(period).replace('week-', '')) || 0);
}

function archivePeriodLabel(period) {
  const week = selectedArchiveWeek();
  if (period === 'week-total') {
    return dateRangeOptionLabel(week?.startDate, week?.endDate) || week?.label || 'Archived Week';
  }
  const date = archivePeriodDate(period);
  return date ? localDayDateLabel(date) : 'Archived Day';
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

async function getDataContract() {
  if (state.contract) return state.contract;
  const response = await fetch(CONTRACT_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`contract ${response.status}`);
  }
  state.contract = await response.json();
  return state.contract;
}

async function getWeeklyArchiveIndex() {
  if (state.weeklyArchiveIndex) return state.weeklyArchiveIndex;
  const response = await fetch(WEEKLY_INDEX_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    state.weeklyArchiveIndex = { weeks: [] };
    return state.weeklyArchiveIndex;
  }
  state.weeklyArchiveIndex = await response.json();
  return state.weeklyArchiveIndex;
}

async function getWeeklyArchiveDetails(file) {
  if (!file) return null;
  if (state.weeklyArchiveDetails.has(file)) return state.weeklyArchiveDetails.get(file);
  const response = await fetch(`/prospect-call-tracker/weekly-results/${encodeURIComponent(file)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const details = await response.json();
  state.weeklyArchiveDetails.set(file, details);
  return details;
}

async function loadData() {
  $('statusText').textContent = 'Loading';
  const [contract] = await Promise.all([getDataContract(), getWeeklyArchiveIndex()]);
  const data = contract?.data || {};
  state.summary = data.summary || {};
  state.rows = Array.isArray(data.events) ? data.events : [];
  state.ui = data.ui || null;
  if (state.activeView === 'live-week' && state.ui?.activePeriod) state.activePeriod = state.ui.activePeriod;
  render();
}

async function refreshAllData() {
  state.contract = null;
  await loadData();
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
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

function isDashboardVisibleEvent(row) {
  return row.tracker_outcome !== 'meeting_set' || countsAsMeetingSet(row);
}

function isMeaningfulEvent(row) {
  return isDashboardVisibleEvent(row) && !hiddenDefaultOutcomes.has(row.tracker_outcome);
}

function archiveWeeks() {
  return Array.isArray(state.weeklyArchiveIndex?.weeks)
    ? [...state.weeklyArchiveIndex.weeks].sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || '')))
    : [];
}

function selectedArchiveFile() {
  return state.activeView.startsWith('archive:') ? state.activeView.slice('archive:'.length) : '';
}

function selectedArchiveWeek() {
  const file = selectedArchiveFile();
  return archiveWeeks().find((week) => week.file === file) || null;
}

function selectedArchiveDetails() {
  const file = selectedArchiveFile();
  return file ? state.weeklyArchiveDetails.get(file) || null : null;
}

function isArchiveView() {
  return Boolean(selectedArchiveFile());
}

function isMonthView() {
  return state.activeView === 'live-month';
}

function isWeekTotalView() {
  return state.activePeriod === 'week-total';
}

function dateKeyInRange(key, start, end) {
  return Boolean(key && key >= start && key <= end);
}

function currentMonthRange() {
  const now = new Date();
  const parts = localParts(now);
  const year = Number(parts.year);
  const month = Number(parts.month);
  return {
    start: `${parts.year}-${parts.month}-01`,
    end: `${parts.year}-${parts.month}-${parts.day}`,
    label: `${monthName(now)} Results`,
  };
}

function periodScopedRows(rows, dateKeyForRow = eventDateKey) {
  if (isArchiveView()) {
    const archiveRows = Array.isArray(selectedArchiveDetails()?.events) ? selectedArchiveDetails().events : [];
    if (isWeekTotalView()) return archiveRows;
    const date = archivePeriodDate(state.activePeriod);
    const periodKey = date ? localDateKey(date) : '';
    return archiveRows.filter((row) => dateKeyForRow(row) === periodKey);
  }

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
  if (isArchiveView()) return periodScopedRows((selectedArchiveDetails()?.events || []).filter(isDashboardVisibleEvent));
  return periodScopedRows(displayRows());
}

function scopedActivityRows() {
  if (isArchiveView()) {
    return periodScopedRows((selectedArchiveDetails()?.events || []).filter(isDashboardVisibleEvent), reportingDateKey);
  }
  return periodScopedRows(displayRows(), reportingDateKey);
}

function eventDateKey(row) {
  return reportingDateKey(row);
}

function reportingDateKey(row) {
  return row.reporting_date_et || localDateKey(row.reporting_at || row.occurred_at);
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
  return dedupePipelineRows(state.rows).filter(isDashboardVisibleEvent).sort(
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
    (row.counts_as_meeting_set === true ? 32 : 0) +
    (row.booked_event_title ? 4 : 0) +
    (row.appointment_id ? 2 : 0) +
    (row.event_at ? 1 : 0) +
    Math.floor(new Date(row.event_at || row.occurred_at || 0).getTime() / 100000000000)
  );
}

function metricsFromRows(rows) {
  const meetingsSet = rows.filter(countsAsMeetingSet).length;
  const dials = rows.filter(countsAsDial).length;
  const contacts = rows.filter(countsAsContact).length;
  return {
    dials,
    contacts,
    meetingsSet,
    setRate: contacts ? Math.round((meetingsSet / contacts) * 100) : 0,
    outcomeCounts: outcomeCountsForRows(rows),
    filterCounts: filterCountsForRows(rows),
  };
}

function activeTopCardMetrics() {
  if (isArchiveView()) {
    const details = selectedArchiveDetails();
    const week = selectedArchiveWeek();
    const summary = details?.summary || week || {};
    const label =
      dateRangeOptionLabel(details?.week?.startDate || week?.startDate, details?.week?.endDate || week?.endDate) ||
      details?.week?.label ||
      week?.label ||
      'Archived Week';
    if (!isWeekTotalView() && details) {
      return {
        label: archivePeriodLabel(state.activePeriod),
        ...metricsFromRows(scopedActivityRows()),
      };
    }
    return {
      label,
      dials: Number(summary.dials) || 0,
      contacts: Number(summary.contacts) || 0,
      meetingsSet: Number(summary.meetingsSet) || 0,
      setRate: Number(summary.setRate) || 0,
      outcomeCounts: summary.outcomeCounts || {},
      filterCounts: summary.filterCounts || null,
    };
  }

  if (isMonthView()) {
    const range = currentMonthRange();
    return {
      label: range.label,
      ...metricsFromRows(
        displayRows().filter((row) => dateKeyInRange(reportingDateKey(row), range.start, range.end)),
      ),
    };
  }

  return state.ui?.periods?.[state.activePeriod] || null;
}

function renderPeriod() {
  const materializedPeriod = activeTopCardMetrics();
  if (materializedPeriod) {
    setText('periodTitle', materializedPeriod.label);
    setText('todayLabel', 'Local ET');
    setText('todayCalls', materializedPeriod.dials);
    setText('todayContacts', materializedPeriod.contacts);
    setText('todayMeetingsSet', materializedPeriod.meetingsSet);
    setText('todaySetRate', `${materializedPeriod.setRate}%`);
    // Soft-disabled for now. Re-enable when show rate belongs back in the top-card flow.
    // setRateText('todayShowRate', outcomeRates.showRate, true);
    document.querySelectorAll('[data-period]').forEach((button) => {
      button.classList.toggle('active', !isMonthView() && button.dataset.period === state.activePeriod);
      button.disabled = isMonthView();
    });
    return;
  }

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
  // Soft-disabled for now. Re-enable when show rate belongs back in the top-card flow.
  // setRateText('todayShowRate', outcomeRates.showRate, true);

  document.querySelectorAll('[data-period]').forEach((button) => {
    button.classList.toggle('active', button.dataset.period === state.activePeriod);
    button.disabled = false;
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

function previousPayDate(payDate) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (day === 28) return ymdToLocalNoon(year, month, 14);
  const previousMonth = addMonths(year, month, -1);
  return ymdToLocalNoon(previousMonth.year, previousMonth.month, 28);
}

function basePayForDate(payDate) {
  const parts = localParts(payDate);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const bonusBaseActive = year === 2026 && month >= 5 && month <= 7 && day <= 28;
  return bonusBaseActive ? 100000 : 50000;
}

function commissionCentsForRow(row) {
  return Math.round((Number(row.revenue_cents) || 0) * COMMISSION_RATE);
}

function allTimeCommissionCents() {
  return state.rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .reduce((total, row) => total + commissionCentsForRow(row), 0);
}

function rowBelongsToPaycheck(row, previousPay, payDate) {
  const sourceDate = new Date(row.event_at || row.occurred_at || row.created_at);
  if (Number.isNaN(sourceDate.getTime())) return false;
  return sourceDate.getTime() > previousPay.getTime() && sourceDate.getTime() <= payDate.getTime();
}

function paycheckCommissionCents(payDate) {
  const previousPay = previousPayDate(payDate);
  return state.rows
    .filter((row) => row.tracker_outcome === 'closed_won' && rowBelongsToPaycheck(row, previousPay, payDate))
    .reduce((total, row) => total + commissionCentsForRow(row), 0);
}

function renderPaycheck() {
  if (state.ui?.paycheck) {
    setText('payDateLabel', state.ui.paycheck.payDateLabel);
    setText('nextPaycheck', money(state.ui.paycheck.totalCents));
    setText('basePayLine', `Base ${money(state.ui.paycheck.baseCents)}`);
    setText('commissionPayLine', `Commission ${money(state.ui.paycheck.commissionCents)}`);
    return;
  }

  const payDate = nextPayDate();
  const baseCents = basePayForDate(payDate);
  const commissionCents = paycheckCommissionCents(payDate);
  const totalCents = baseCents + commissionCents;

  setText('payDateLabel', `Next check ${localDateLabel(payDate)}`);
  setText('nextPaycheck', money(totalCents));
  setText('basePayLine', `Base ${money(baseCents)}`);
  setText('commissionPayLine', `Commission ${money(commissionCents)}`);
}

function renderSummary() {
  const summary = state.summary || {};
  const cards = state.ui?.summaryCards;
  const fallbackCommissionCents = allTimeCommissionCents() || Math.round((Number(summary.money_earned_cents) || 0) * COMMISSION_RATE);
  setText('moneyEarned', money(cards?.moneyEarnedCents ?? fallbackCommissionCents));
  setText('closedWon', cards?.closedWon ?? summary.closed_won ?? 0);
  setText('spokeWith', cards?.contacts ?? summary.contacts ?? 0);
  setText('totalEvents', cards?.dials ?? summary.dials ?? 0);
  setText('voicemailOnly', cards?.voicemailOnly ?? summary.voicemail_only ?? 0);
  setText('appointmentsTracked', cards?.appointmentsTracked ?? summary.appointments_tracked ?? 0);
  setText('rangeLabel', activeTopCardMetrics()?.label || state.ui?.rangeLabel || currentWeekRangeLabel());
  const fallbackDenominator = Number(summary.meeting_outcomes_total) || 0;
  const fallbackRate = fallbackDenominator ? Math.round((Number(summary.closed_won || 0) / fallbackDenominator) * 100) : 0;
  setRateText('closeRate', cards?.closeRate ?? fallbackRate, true);
}

function gradientRateColor(rate, goodHigh = true) {
  const score = goodHigh ? Number(rate) || 0 : 100 - (Number(rate) || 0);
  if (score >= 67) return 'var(--green)';
  if (score >= 40) return 'var(--amber)';
  return 'var(--red)';
}

function setRateText(id, rate, goodHigh = true) {
  const element = $(id);
  if (!element) return;
  const value = Number(rate) || 0;
  element.textContent = `${value}%`;
  element.style.color = gradientRateColor(value, goodHigh);
}

function outcomeCountsForRows(rows) {
  return rows.reduce((acc, row) => {
    acc[row.tracker_outcome] = (acc[row.tracker_outcome] || 0) + 1;
    return acc;
  }, {});
}

function filterCountsForRows(rows) {
  const counts = outcomeCountsForRows(rows);
  return {
    meaningful: rows.filter(isMeaningfulEvent).length,
    all_calls: rows.length,
    meetings: rows.filter((row) => meetingOutcomes.has(row.tracker_outcome)).length,
    closed_won: counts.closed_won || 0,
    closed_lost: counts.closed_lost || 0,
    reschedule_pending: counts.reschedule_pending || 0,
    no_show: counts.no_show || 0,
    canceled: counts.canceled || 0,
  };
}

function outcomeCounts() {
  return outcomeCountsForRows(scopedRows());
}

function renderBars() {
  const cards = state.ui?.summaryCards || {};
  const contacts = Number(cards.contacts ?? state.summary?.contacts ?? 0);
  const meetingsSet = Number(state.summary?.meetings_set ?? 0);
  const closedWon = Number(cards.closedWon ?? state.summary?.closed_won ?? 0);
  const setRate = contacts ? Math.round((meetingsSet / contacts) * 100) : 0;
  const entries = [
    ['Dials', Number(cards.dials ?? state.summary?.dials ?? 0), 'blue'],
    ['Spoke With', contacts, 'green'],
    ['Meetings Set', meetingsSet, 'amber'],
    ['Closed Won', closedWon, 'green'],
  ];
  const maxCount = Math.max(1, ...entries.map(([, count]) => Number(count) || 0));

  $('outcomeBars').innerHTML = `
    <div class="flow-chart">
      <div class="flow-rate">
        <span>All-Time Set Rate</span>
        <strong style="color:${gradientRateColor(setRate, true)}">${setRate}%</strong>
      </div>
      <div class="flow-rows">
        ${entries
          .map(([label, count, color]) => {
            const width = Math.max(4, Math.round(((Number(count) || 0) / maxCount) * 100));
            return `
              <div class="flow-row ${color}">
                <div class="flow-label">
                  <span>${label}</span>
                  <b>${count}</b>
                </div>
                <div class="flow-track">
                  <i style="width:${width}%"></i>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function renderClosedWon() {
  const closed = state.ui?.closedWonRows || state.rows
    .filter((row) => row.tracker_outcome === 'closed_won')
    .sort((left, right) => Number(right.revenue_cents || 0) - Number(left.revenue_cents || 0));

  $('closedWonList').innerHTML = closed.length
    ? closed
        .map((row) => {
          const display = closedWonDisplay(row);
          return `
            <div class="closed-item">
              <span class="closed-copy">
                <strong>${escapeHtml(display.name)}</strong>
                ${display.subtitle ? `<em>${escapeHtml(display.subtitle)}</em>` : ''}
              </span>
              <b>- ${money(row.revenue_cents)}</b>
            </div>
          `;
        })
        .join('')
    : '<p class="empty">No closes yet.</p>';
}

function renderFilters() {
  const activeMetrics = activeTopCardMetrics();
  const counts = activeMetrics?.outcomeCounts || state.ui?.periods?.[state.activePeriod]?.outcomeCounts || outcomeCounts();
  const materializedFilterCounts = activeMetrics?.filterCounts || state.ui?.periods?.[state.activePeriod]?.filterCounts || null;
  const rows = scopedRows();
  $('filters').innerHTML = tableFilters
    .map((outcome) => {
      const count =
        materializedFilterCounts?.[outcome] ?? (outcome === 'all_calls'
          ? rows.length
          : outcome === 'meaningful'
            ? rows.filter(isMeaningfulEvent).length
          : outcome === 'meetings'
            ? rows.filter((row) => meetingOutcomes.has(row.tracker_outcome)).length
            : counts[outcome] || 0);
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
      (row) => {
        const outcome = displayOutcome(row);
        return `
        <tr>
          <td>${shortDate(row.event_at || row.occurred_at)}</td>
          <td class="name-cell">${row.athlete_name || ''}</td>
          <td><span class="pill ${outcome}">${labels[outcome] || outcome}</span></td>
          <td>${displayStage(row)}</td>
          <td class="event-title" title="${eventTitle(row)}">
            <span>${eventTitle(row)}</span>
          </td>
          <td class="money-cell">${Number(row.revenue_cents || 0) ? money(row.revenue_cents) : ''}</td>
        </tr>
      `;
      },
    )
    .join('');
}

function renderWeekViewSelector() {
  const select = $('weekViewSelect');
  if (!select) return;
  const selected = state.activeView;
  const archivedOptions = archiveWeeks()
    .map((week) => {
      const label = dateRangeOptionLabel(week.startDate, week.endDate) || week.label || `${week.startDate} - ${week.endDate}`;
      return `<option value="archive:${escapeHtml(week.file)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  select.innerHTML = `
    <option value="live-week">Live</option>
    ${archivedOptions}
    <option value="live-month">${escapeHtml(state.ui?.monthResultLabel || `${monthName()} Results`)}</option>
  `;
  select.value = selected;
}

function dateRangeOptionLabel(startDate, endDate) {
  if (!startDate || !endDate) return '';
  const start = ymdToLocalNoon(...startDate.split('-').map(Number));
  const end = ymdToLocalNoon(...endDate.split('-').map(Number));
  return `${localDateLabel(start)} - ${localDateLabel(end)}`;
}

function titleCaseLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayStage(row) {
  return titleCaseLabel(row.raw_crm_stage || row.raw_task_status || row.raw_event_type || '');
}

function displayOutcome(row) {
  if (row.tracker_outcome === 'voicemail' && displayStage(row) === 'Meeting Set') {
    return 'spoke_follow_up';
  }
  return row.tracker_outcome;
}

function eventTitle(row) {
  if (row.tracker_outcome === 'meeting_set' && row.appointment_starts_at) {
    return `${row.booked_event_title || 'Meeting Set'} • ${shortDate(row.appointment_starts_at)}`;
  }
  return row.booked_event_title || row.appointment_id || '';
}

function render() {
  renderWeekViewSelector();
  renderSummary();
  renderPeriod();
  renderPaycheck();
  renderBars();
  renderClosedWon();
  renderFilters();
  renderTable();
  $('statusText').textContent = 'Live';
}

function handleLoadError(error) {
  $('statusText').textContent = 'Error';
  console.error(error);
}

function bootCallTracker() {
  state.activePeriod = currentWeekPeriod();
  $('refreshButton').addEventListener('click', () => refreshAllData().catch(handleLoadError));
  $('weekViewSelect').addEventListener('change', async (event) => {
    state.activeView = event.target.value || 'live-week';
    state.activeFilter = 'meaningful';
    if (state.activeView === 'live-week') {
      state.activePeriod = currentWeekPeriod();
    } else if (selectedArchiveFile()) {
      state.activePeriod = 'week-total';
    }
    const file = selectedArchiveFile();
    if (file) {
      $('statusText').textContent = 'Loading archive';
      await getWeeklyArchiveDetails(file);
    }
    render();
  });
  document.querySelectorAll('[data-period]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activePeriod = button.dataset.period || currentWeekPeriod();
      render();
    });
  });
  loadData().catch(handleLoadError);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCallTracker);
} else {
  bootCallTracker();
}
