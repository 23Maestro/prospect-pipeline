const CONTRACT_URL = '/api/meeting-readback-data';

const state = {
  rows: [],
  summary: null,
  title: 'Enrollment Tracker',
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

function statusClass(value) {
  const key = normalizeStatus(value);
  if (key === 'close_won') return 'status-chip won';
  if (key === 'close_lost' || key === 'no_show') return 'status-chip bad';
  if (key === 'pending') return 'status-chip pending';
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

function renderSummary() {
  const summary = state.summary || {};
  setText('trackerTitle', state.title);
  setText('meetingsSet', summary.meetingsSet || 0);
  setText('enrollments', summary.enrollments || 0);
  setText('showRate', `${summary.showRate || 0}%`);
  setText('rowCount', `${state.rows.length} ${state.rows.length === 1 ? 'row' : 'rows'}`);
}

function renderMeetings() {
  const body = $('meetingsBody');
  if (!body) return;
  if (!state.rows.length) {
    body.innerHTML = emptyRow(5, 'No meetings set for the active month.');
    return;
  }
  body.innerHTML = state.rows
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
  const target = event.target.closest('#refreshButton');
  if (!target) return;
  refreshAllData();
});

refreshAllData();
