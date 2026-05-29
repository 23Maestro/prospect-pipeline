const CONTRACT_URL = '/api/meeting-readback-data';

const state = {
  rows: [],
  lifecycle: [],
  summary: null,
  activeMode: 'meetings',
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

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function statusClass(value) {
  const key = normalizeKey(value);
  if (['closed_won'].includes(key)) return 'status-chip won';
  if (['no_show', 'canceled', 'cancelled', 'closed_lost'].includes(key)) return 'status-chip bad';
  if (['actual_meeting_follow_up', 'follow_up', 'reschedule_needed', 'reschedule_pending', 'rescheduled'].includes(key)) return 'status-chip pending';
  if (['meeting_set', 'scheduled'].includes(key)) return 'status-chip set';
  if (['needs_review'].includes(key)) return 'status-chip review';
  return 'status-chip neutral';
}

function sourceText(row) {
  const source = String(row.source || '').split('/')[0].trim();
  const labels = {
    active_athlete_meeting_truth: 'Current Meeting Truth',
    call_tracker_events_owner_context: 'Call Tracker Reporting',
    weekly_booked_meetings_with_operator_confirmation_task: 'Booked Meeting Confirmation',
    athlete_lifecycle_timeline: 'Athlete Lifecycle Timeline',
    lifecycle_events: 'Lifecycle Events',
    meeting_events: 'Meeting Events',
    stripe_commissions: 'Paid Close',
    stripe_commission_payroll: 'Paid Close',
  };
  return labels[source] || source.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Meeting Source';
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
  setText('trueMeetingsSet', summary.trueMeetingsSet || summary.meetingsSet || 0);
  setText('showRate', `${summary.showRate || 0}%`);
  setText('closedWon', summary.closedWon || 0);
  setText('closedLost', summary.closedLost || 0);
  setText('followUp', summary.followUp || 0);
  setText('noShowCanceled', summary.noShowCanceled || 0);
}

function renderMeetings() {
  const body = $('meetingsBody');
  if (!body) return;
  if (!state.rows.length) {
    body.innerHTML = emptyRow(6, 'No meeting rows returned.');
    return;
  }
  body.innerHTML = state.rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.whenLabel || row.when || '')}</td>
          <td><strong>${escapeHtml(row.athleteName)}</strong></td>
          <td><span class="${statusClass(row.meetingStatus)}">${escapeHtml(row.meetingStatus)}</span></td>
          <td>${escapeHtml(row.meetingTitle)}</td>
          <td><code>${escapeHtml(row.appointmentId || 'Missing')}</code></td>
          <td class="source-cell">${escapeHtml(sourceText(row))}</td>
        </tr>
      `,
    )
    .join('');
}

function renderLifecycle() {
  const body = $('lifecycleBody');
  if (!body) return;
  if (!state.lifecycle.length) {
    body.innerHTML = emptyRow(6, 'No lifecycle meeting rows returned.');
    return;
  }
  body.innerHTML = state.lifecycle
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.whenLabel || row.when || '')}</td>
          <td><strong>${escapeHtml(row.athleteName)}</strong></td>
          <td><span class="${statusClass(row.lifecycleEvent)}">${escapeHtml(row.lifecycleEvent)}</span></td>
          <td>${escapeHtml(row.crmStage)}</td>
          <td>${escapeHtml(row.taskStatus)}</td>
          <td class="source-cell">${escapeHtml(sourceText(row))}</td>
        </tr>
      `,
    )
    .join('');
}

function renderMode() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.activeMode);
  });
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === state.activeMode);
  });
}

function render() {
  renderSummary();
  renderMeetings();
  renderLifecycle();
  renderMode();
}

async function loadData() {
  setText('generatedAt', 'Loading live meeting readback');
  const response = await fetch(CONTRACT_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`meeting readback ${response.status}`);
  }
  const payload = await response.json();
  const data = payload.data || {};
  state.rows = Array.isArray(data.meetings) ? data.meetings : [];
  state.lifecycle = Array.isArray(data.lifecycle) ? data.lifecycle : [];
  state.summary = data.summary || {};
  setText('generatedAt', data.generatedAtLabel ? `Generated ${data.generatedAtLabel}` : `Generated ${data.generatedAt || 'now'}`);
  render();
}

async function refreshAllData() {
  try {
    await loadData();
  } catch (error) {
    setText('generatedAt', error instanceof Error ? error.message : 'Unable to load meeting readback');
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-mode], #refreshButton');
  if (!target) return;
  if (target.id === 'refreshButton') {
    refreshAllData();
    return;
  }
  if (target.dataset.mode) {
    state.activeMode = target.dataset.mode;
    renderMode();
  }
});

refreshAllData();
