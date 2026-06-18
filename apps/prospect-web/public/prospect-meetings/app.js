const CONTRACT_URL = '/api/meeting-readback-data';
const filterLabels = {
  all: 'All',
  set: 'Set',
  follow_up: 'Follow Up',
  no_show: 'No Show',
  rescheduled: 'Rescheduled',
  res_pending: 'Res. Pending',
  close_won: 'Won',
  close_lost: 'Lost',
  canceled: 'Canceled',
};
const tableFilters = ['all', 'set', 'follow_up', 'no_show', 'rescheduled', 'res_pending', 'close_won', 'close_lost', 'canceled'];

const state = {
  rows: [],
  summary: null,
  title: 'Enrollment Tracker',
  activeFilter: 'all',
};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents) {
  const value = Number(cents) || 0;
  if (!value) return '';
  const fractionDigits = Math.abs(value % 100) === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function filterKey(value) {
  const key = normalizeStatus(value);
  if (key === 'res._pending' || key === 'res_pending' || key === 'reschedule_pending') return 'res_pending';
  return key;
}

function statusClass(value) {
  const key = normalizeStatus(value);
  if (key === 'close_won') return 'status-chip won';
  if (key === 'close_lost' || key === 'no_show' || key === 'canceled') return 'status-chip bad';
  if (key === 'pending' || key === 'res._pending') return 'status-chip pending';
  if (key === 'follow_up') return 'status-chip review';
  if (key === 'rescheduled') return 'status-chip rescheduled';
  if (key === 'set') return 'status-chip set';
  return 'status-chip neutral';
}

function emptyRow(colspan, label) {
  return `<tr><td class="empty-cell" colspan="${colspan}">${escapeHtml(label)}</td></tr>`;
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function filterCounts() {
  return state.rows.reduce(
    (counts, row) => {
      const key = filterKey(row.status);
      counts.all += 1;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    },
    { all: 0 },
  );
}

function activeRows() {
  if (state.activeFilter === 'all') return state.rows;
  return state.rows.filter((row) => filterKey(row.status) === state.activeFilter);
}

function renderFilters() {
  const filters = $('meetingFilters');
  if (!filters) return;
  const counts = filterCounts();
  filters.innerHTML = tableFilters
    .filter((filter) => filter === 'all' || counts[filter])
    .map((filter) => {
      const count = counts[filter] || 0;
      const active = state.activeFilter === filter ? 'active' : '';
      return `<button type="button" class="${active}" data-filter="${filter}"><span>${escapeHtml(filterLabels[filter] || filter)}</span><b>${count}</b></button>`;
    })
    .join('');
}

function renderSummary() {
  const summary = state.summary || {};
  const rows = activeRows();
  setText('trackerTitle', state.title);
  setText('meetingsSet', summary.meetingsSet || 0);
  setText('enrollments', summary.enrollments || 0);
  setText('showRate', `${summary.showRate || 0}%`);
  const total = state.rows.length;
  const filtered = rows.length;
  const rowLabel = filtered === 1 ? 'row' : 'rows';
  setText('rowCount', state.activeFilter === 'all' ? `${total} ${total === 1 ? 'row' : 'rows'}` : `${filtered} of ${total} ${rowLabel}`);
}

function renderMeetings() {
  const body = $('meetingsBody');
  if (!body) return;
  const rows = activeRows();
  if (!state.rows.length) {
    body.innerHTML = emptyRow(5, 'No meetings set for the active month.');
    return;
  }
  if (!rows.length) {
    body.innerHTML = emptyRow(5, `No ${filterLabels[state.activeFilter] || 'matching'} meetings for the active month.`);
    return;
  }
  body.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.whenLabel || row.when || '')}</td>
          <td><strong>${escapeHtml(row.athleteName)}</strong></td>
          <td><span class="${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
          <td>${escapeHtml(row.headScout)}</td>
          <td class="money-cell">${escapeHtml(money(row.moneyCents))}</td>
        </tr>
      `,
    )
    .join('');
}

function render() {
  renderFilters();
  renderSummary();
  renderMeetings();
}

async function loadData() {
  setText('generatedAt', 'Loading live enrollment tracker');
  const response = await fetch(CONTRACT_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`enrollment tracker ${response.status}`);
  }
  const payload = await response.json();
  const data = payload.data || {};
  state.rows = Array.isArray(data.rows) ? data.rows : [];
  state.summary = data.summary || {};
  state.title = data.title || 'Enrollment Tracker';
  setText('generatedAt', data.generatedAtLabel ? `Updated ${data.generatedAtLabel}` : `Updated ${data.generatedAt || 'now'}`);
  render();
}

async function refreshAllData() {
  try {
    await loadData();
  } catch (error) {
    setText('generatedAt', error instanceof Error ? error.message : 'Unable to load enrollment tracker');
  }
}

document.addEventListener('click', (event) => {
  const refreshTarget = event.target.closest('#refreshButton');
  if (refreshTarget) {
    refreshAllData();
    return;
  }

  const filterTarget = event.target.closest('#meetingFilters button');
  if (!filterTarget) return;
  state.activeFilter = filterTarget.dataset.filter || 'all';
  render();
});

refreshAllData();
