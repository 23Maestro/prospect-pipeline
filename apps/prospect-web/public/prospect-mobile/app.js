import { cleanMeetingTitle } from '/prospect-mobile/set-meetings-utils.mjs';

const routes = {
  '/set-meetings': {
    title: 'Set Meetings',
    render: renderSetMeetings,
    usesWeek: true,
  },
  '/scout-schedules': {
    title: 'Scout Schedules',
    endpoint: '/api/head-scout-schedules',
    render: renderScoutSchedules,
    usesWeek: true,
  },
};

const state = {
  week: 'this',
  route: routes[window.location.pathname] ? window.location.pathname : '/set-meetings',
  isLoading: false,
};

const pageTitle = document.querySelector('#page-title');
const refreshButton = document.querySelector('#refresh-button');
const content = document.querySelector('#content');
const statusLine = document.querySelector('#status-line');
const weekToolbar = document.querySelector('#week-toolbar');
const FADE_DURATION_MS = 150;

window.addEventListener('popstate', () => {
  state.route = routes[toWorkflowPath(window.location.pathname)] ? toWorkflowPath(window.location.pathname) : '/set-meetings';
  void loadRoute();
});

document.querySelectorAll('[data-route]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const nextRoute = link.getAttribute('data-route');
    if (!nextRoute || nextRoute === state.route) return;
    history.pushState({}, '', `/prospect-mobile${nextRoute}`);
    state.route = nextRoute;
    void loadRoute();
  });
});

document.querySelectorAll('[data-week]').forEach((button) => {
  button.addEventListener('click', () => {
    state.week = button.getAttribute('data-week') || 'this';
    void loadRoute();
  });
});

refreshButton.addEventListener('click', () => void loadRoute());
window.addEventListener('pageshow', () => void loadRoute());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void loadRoute();
  }
});

async function loadRoute() {
  const route = routes[state.route];
  pageTitle.textContent = 'Prospect Mobile';
  weekToolbar.hidden = !route.usesWeek;
  setActiveNavigation();

  if (!route.endpoint) {
    await setLoading(true, 'Refreshing');
    try {
      const renderedCount = await route.render();
      const count = typeof renderedCount === 'number' ? renderedCount : 0;
      setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${count} found`);
    } catch (error) {
      content.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
      setStatus('Could not refresh');
    } finally {
      setLoading(false);
    }
    return;
  }

  await setLoading(true, 'Refreshing');
  try {
    const response = await fetch(`${route.endpoint}?week=${encodeURIComponent(state.week)}`, {
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }
    const renderedCount = await route.render(payload);
    const count = typeof renderedCount === 'number' ? renderedCount : payload.count ?? payload.scouts?.length ?? payload.events?.length ?? 0;
    setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${count} found`);
  } catch (error) {
    content.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
    setStatus('Could not refresh');
  } finally {
    setLoading(false);
  }
}

async function renderSetMeetings(payload) {
  const data = payload || (await fetchSetMeetingsFromSupabase(state.week));
  const events = Array.isArray(data?.events) ? data.events : [];
  if (!events.length) {
    await setContentHtml('<div class="empty-state">No booked set meetings found for this window.</div>');
    return 0;
  }

  await setContentHtml(
    events
      .map((event) => {
      const title = event.athlete_name || cleanMeetingTitle(event.title || 'Booked meeting');
      const owner = event.head_scout_name || event.assigned_owner || 'Scout not resolved';
      const task = event.current_task || 'Confirmation Call';
      const time =
        formatCachedMeetingLabel(event.current_meeting_label || event.start) ||
        event.date_time_label ||
        formatMeetingTime(event.start, event.end);
      const copyText = `${title} - ${owner} - ${time}`;
      const firstConfirmation = String(event.confirmation_1_message || '');
      const secondConfirmation = String(event.confirmation_2_message || '');
      const recipientPhone = event.confirmation_recipient?.phone || '';
      const recipientLabel = event.confirmation_recipient?.name
        ? `Text ${event.confirmation_recipient.name}`
        : 'Text';
      const eventId = event.appointment_id || event.key || '';
      const eventDate = buildBookedMeetingEventDate(event.start);
      return `
        <article class="row">
          <div class="row-header">
            <div>
              <h2 class="row-title">${escapeHtml(title)}</h2>
              <p class="row-subtitle">${escapeHtml(owner)} - ${escapeHtml(task)}</p>
            </div>
            <p class="row-meta">${escapeHtml(time)}</p>
          </div>
          <div class="row-actions">
            <button class="copy-button" type="button" data-sms-phone="${escapeAttribute(recipientPhone)}" data-sms-body="${escapeAttribute(firstConfirmation)}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-confirmation-prefix="(ACF)">${escapeHtml(recipientLabel)} 1</button>
            <button class="copy-button" type="button" data-sms-phone="${escapeAttribute(recipientPhone)}" data-sms-body="${escapeAttribute(secondConfirmation)}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-confirmation-prefix="(ACF*2)">${escapeHtml(recipientLabel)} 2</button>
            ${
              event.admin_url || eventId
                ? `<button class="link-button" type="button" data-admin-modal data-admin-url="${escapeAttribute(event.admin_url || '')}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-athlete-name="${escapeAttribute(title)}" data-head-scout="${escapeAttribute(owner)}">Admin</button>`
                : ''
            }
            <button class="copy-button" type="button" data-copy="${escapeAttribute(copyText)}">Copy</button>
          </div>
        </article>
      `;
      })
      .join(''),
  );
  bindCopyButtons();
  bindSmsButtons();
  bindAdminModalButtons();
  return events.length;
}

async function fetchSetMeetingsFromSupabase(week) {
  const config = window.__PROSPECT_SUPABASE__ || {};
  const supabaseUrl = String(config.url || '').replace(/\/+$/, '');
  const anonKey = String(config.anonKey || '');
  const schema = String(config.schema || 'public').trim() || 'public';
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase public config');
  }

  const weekWindow = buildEasternWeekWindow(week);
  const query = [
    'select=appointment_id,athlete_id,athlete_main_id,athlete_name,recipient_name,recipient_phone,head_scout_name,meeting_starts_at,meeting_timezone,message_body,admin_url,task_url,kind',
    'status=eq.cached',
    'source=eq.set_meetings_confirmation',
    'kind=in.(confirmation_1,confirmation_2)',
    `meeting_starts_at=gte.${encodeURIComponent(`${weekWindow.start}T00:00:00-04:00`)}`,
    `meeting_starts_at=lt.${encodeURIComponent(`${weekWindow.end}T00:00:00-04:00`)}`,
    'order=meeting_starts_at.asc',
  ].join('&');

  const response = await fetch(`${supabaseUrl}/rest/v1/set_meeting_confirmation_cache?${query}`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      'accept-profile': schema,
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
  }

  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row.appointment_id || '').trim();
    if (!key) continue;
    const existing = grouped.get(key) || { base: row };
    if (row.kind === 'confirmation_1') existing.c1 = row.message_body || '';
    if (row.kind === 'confirmation_2') existing.c2 = row.message_body || '';
    grouped.set(key, existing);
  }

  const events = Array.from(grouped.values()).map((entry) => ({
    key: entry.base.appointment_id,
    appointment_id: entry.base.appointment_id,
    athlete_id: entry.base.athlete_id,
    athlete_main_id: entry.base.athlete_main_id,
    athlete_name: entry.base.athlete_name,
    head_scout_name: entry.base.head_scout_name,
    current_meeting_label: entry.base.meeting_starts_at,
    start: entry.base.meeting_starts_at,
    meeting_timezone: entry.base.meeting_timezone,
    confirmation_recipient: {
      name: entry.base.recipient_name,
      phone: entry.base.recipient_phone,
    },
    confirmation_1_message: entry.c1 || '',
    confirmation_2_message: entry.c2 || '',
    admin_url: entry.base.admin_url,
    task_url: entry.base.task_url,
    source: 'supabase_confirmation_cache',
  }));

  return {
    success: true,
    source: 'supabase_confirmation_cache',
    backend_required: false,
    week_start: weekWindow.start,
    week_end: weekWindow.end,
    count: events.length,
    events,
  };
}

async function renderScoutSchedules(payload) {
  const scouts = Array.isArray(payload?.scouts) ? payload.scouts : [];
  const groups = scouts
    .map((scout) => ({
      ...scout,
      visibleSlots: filterVisibleScoutSlots(Array.isArray(scout.slots) ? scout.slots : []),
    }))
    .filter((scout) => scout.visibleSlots.length);
  if (!groups.length) {
    await setContentHtml('<div class="empty-state">No open scout slots found for this window.</div>');
    return 0;
  }

  const visibleCount = groups.reduce((sum, scout) => sum + scout.visibleSlots.length, 0);
  await setContentHtml(
    groups
    .map((scout) => {
      const rows = scout.visibleSlots
        .map((slot) => {
          const dateLabel = formatSlotDate(slot.start);
          const range = formatSlotRange(slot.start, slot.end);
          const copyText = `${scout.scout_name}: ${dateLabel}, ${range}`;
          return `
            <article class="row">
              <div class="row-header">
                <div>
                  <h2 class="row-title">${escapeHtml(dateLabel)}</h2>
                  <p class="row-subtitle">${escapeHtml(range)}</p>
                </div>
                <p class="row-meta">${escapeHtml(scout.state || '')}</p>
              </div>
              <div class="row-actions">
                <button class="copy-button" type="button" data-copy="${escapeAttribute(copyText)}">Copy</button>
              </div>
            </article>
          `;
        })
        .join('');
      return `<h2 class="group-title">${escapeHtml(scout.scout_name)} - ${scout.visibleSlots.length}</h2>${rows}`;
    })
    .join(''),
  );
  bindCopyButtons();
  return visibleCount;
}

function buildEasternWeekWindow(week = 'this', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const easternDate = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const dayOfWeek = easternDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekOffset = week === 'next' ? 1 : 0;
  const start = new Date(easternDate);
  start.setUTCDate(start.getUTCDate() + mondayOffset + weekOffset * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
    week: week === 'next' ? 'next' : 'this',
  };
}

function toIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function bindCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.getAttribute('data-copy') || '');
      setStatus('Copied');
    });
  });
}

function bindSmsButtons() {
  document.querySelectorAll('[data-sms-body]').forEach((button) => {
    button.addEventListener('click', async () => {
      const body = button.getAttribute('data-sms-body') || '';
      const phone = normalizePhoneForSms(button.getAttribute('data-sms-phone') || '');
      await updateConfirmationPrefixFromButton(button);
      window.location.href = phone
        ? `sms:${phone}?body=${encodeURIComponent(body)}`
        : `sms:?body=${encodeURIComponent(body)}`;
    });
  });
}

async function updateConfirmationPrefixFromButton(button) {
  const eventId = button.getAttribute('data-event-id') || '';
  const eventDate = button.getAttribute('data-event-date') || '';
  const prefix = button.getAttribute('data-confirmation-prefix') || '';
  if (!eventId || !eventDate || !prefix) return;

  await updateMeetingPrefix({ eventId, eventDate, prefix });
}

function bindAdminModalButtons() {
  document.querySelectorAll('[data-admin-modal]').forEach((button) => {
    button.addEventListener('click', () => showAdminModal(button));
  });
}

function showAdminModal(button) {
  closeAdminModal();

  const eventId = button.getAttribute('data-event-id') || '';
  const eventDate = button.getAttribute('data-event-date') || '';
  const adminUrl = button.getAttribute('data-admin-url') || '';
  const athleteName = button.getAttribute('data-athlete-name') || 'Meeting';
  const headScout = button.getAttribute('data-head-scout') || '';

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-admin-prefix-modal', '');
  modal.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-label="Meeting admin options">
      <div class="modal-header">
        <h2 class="modal-title">${escapeHtml(athleteName)}</h2>
        <p class="modal-subtitle">${escapeHtml(headScout)}</p>
      </div>
      <div class="modal-actions">
        <button class="modal-button" type="button" data-prefix-action="(CF)">Set (CF)</button>
        <button class="modal-button" type="button" data-prefix-action="(RSP)">Set (RSP)</button>
        <button class="modal-button danger" type="button" data-prefix-action="(CAN)">Set (CAN)</button>
        ${
          adminUrl
            ? `<a class="modal-button secondary" href="${escapeAttribute(adminUrl)}" target="_blank" rel="noreferrer">Open Admin</a>`
            : ''
        }
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAdminModal();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeAdminModal);
  modal.querySelectorAll('[data-prefix-action]').forEach((prefixButton) => {
    prefixButton.addEventListener('click', async () => {
      const prefix = prefixButton.getAttribute('data-prefix-action') || '';
      prefixButton.disabled = true;
      await updateMeetingPrefix({ eventId, eventDate, prefix });
      closeAdminModal();
    });
  });

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  modal.querySelector('[data-prefix-action]')?.focus();
}

function closeAdminModal() {
  document.querySelector('[data-admin-prefix-modal]')?.remove();
  document.body.classList.remove('modal-open');
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAdminModal();
});

async function updateMeetingPrefix({ eventId, eventDate, prefix }) {
  if (!eventId || !eventDate || !prefix) return;

  try {
    const response = await fetch('/api/set-meeting-confirmation-prefix', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        event_date: eventDate,
        prefix,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    setStatus(`Saved ${prefix}`);
  } catch (error) {
    setStatus(`Prefix failed: ${error.message || error}`);
  }
}

function setActiveNavigation() {
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('data-route') === state.route);
  });
  document.querySelectorAll('[data-week]').forEach((button) => {
    button.classList.toggle('active', button.getAttribute('data-week') === state.week);
  });
}

async function setLoading(isLoading, message = '') {
  state.isLoading = isLoading;
  refreshButton.disabled = isLoading;
  refreshButton.style.opacity = isLoading ? '0.6' : '1';
  content.classList.toggle('is-loading', isLoading);
  if (isLoading) {
    await swapContentHtml(buildLoadingRows());
  }
  if (message) setStatus(message);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function setContentHtml(html) {
  return swapContentHtml(html);
}

async function swapContentHtml(html) {
  content.classList.remove('content-ready');
  content.classList.add('content-exit');
  await wait(FADE_DURATION_MS);
  content.innerHTML = html;
  content.classList.remove('content-exit');
  requestAnimationFrame(() => content.classList.add('content-ready'));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toWorkflowPath(pathname) {
  return String(pathname || '').replace(/^\/prospect-mobile/, '') || '/set-meetings';
}

if (document.readyState !== 'loading') {
  void loadRoute();
}

function buildLoadingRows() {
  return Array.from({ length: 4 })
    .map(
      () => `
        <article class="row skeleton-row" aria-hidden="true">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-subtitle"></div>
          <div class="row-actions">
            <span class="skeleton-button"></span>
            <span class="skeleton-button short"></span>
          </div>
        </article>
      `,
    )
    .join('');
}

function filterVisibleScoutSlots(slots) {
  if (state.week !== 'this') {
    return [...slots];
  }
  const currentStamp = getCurrentEasternSlotStamp();
  return slots.filter((slot) => String(slot.start || '') >= currentStamp);
}

function getCurrentEasternSlotStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function formatSlotDate(value) {
  const date = parseEasternLocal(value);
  if (!date) return 'Unknown date';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatSlotRange(start, end) {
  const startDate = parseEasternLocal(start);
  const endDate = parseEasternLocal(end);
  if (!startDate || !endDate) return 'Unknown time';
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)} Eastern`;
}

function formatMeetingTime(start, end) {
  return `${formatSlotDate(start)}, ${formatSlotRange(start, end)}`;
}

function formatCachedMeetingLabel(value) {
  const date = parseCachedEasternInstant(value);
  if (!date) return '';
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
  const day = date.getUTCDate();
  const hour24 = date.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const period = hour24 >= 12 ? 'pm' : 'am';
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)} - ${hour12}:${minute}${period} Eastern`;
}

function parseCachedEasternInstant(value) {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() - 5 * 60 * 60 * 1000);
}

function buildBookedMeetingEventDate(value) {
  const date = parseCachedEasternInstant(value);
  if (!date) return '';
  return toIsoDate(date);
}

function ordinalSuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

function normalizePhoneForSms(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length === 10) return digits;
  return '';
}

function parseEasternLocal(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
