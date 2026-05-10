import { cleanMeetingTitle } from '/prospect-mobile/set-meetings-utils.mjs';

const routes = {
  '/set-meetings': {
    title: 'Set Meetings',
    endpoint: '/api/set-meetings',
    render: renderSetMeetings,
    usesWeek: true,
  },
  '/scout-schedules': {
    title: 'Scout Schedules',
    endpoint: '/api/head-scout-schedules',
    render: renderScoutSchedules,
    usesWeek: true,
  },
  '/contact-reminder': {
    title: 'Reminder Intake',
    render: renderContactReminder,
    usesWeek: false,
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
    await route.render();
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
  const events = Array.isArray(payload?.events) ? payload.events : [];
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
      const time = event.current_meeting_label || event.date_time_label || formatMeetingTime(event.start, event.end);
      const copyText = `${title} - ${owner} - ${time}`;
      const firstConfirmation = String(event.confirmation_1_message || '');
      const secondConfirmation = String(event.confirmation_2_message || '');
      const recipientPhone = event.confirmation_recipient?.phone || '';
      const recipientLabel = event.confirmation_recipient?.name
        ? `Text ${event.confirmation_recipient.name}`
        : 'Text';
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
            <button class="copy-button" type="button" data-sms-phone="${escapeAttribute(recipientPhone)}" data-sms-body="${escapeAttribute(firstConfirmation)}">${escapeHtml(recipientLabel)} 1</button>
            <button class="copy-button" type="button" data-sms-phone="${escapeAttribute(recipientPhone)}" data-sms-body="${escapeAttribute(secondConfirmation)}">${escapeHtml(recipientLabel)} 2</button>
            ${
              event.admin_url
                ? `<a class="link-button" href="${escapeAttribute(event.admin_url)}" target="_blank" rel="noreferrer">Admin</a>`
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
  return events.length;
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

async function renderContactReminder() {
  setStatus('Ready for an iOS Shortcut payload');
  await setContentHtml(`
    <form class="form-panel" id="reminder-form">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" name="name" autocomplete="name" />
      </div>
      <div class="field">
        <label for="phone">Phone</label>
        <input id="phone" name="phone" inputmode="tel" autocomplete="tel" />
      </div>
      <div class="field">
        <label for="message">Message</label>
        <textarea id="message" name="message" required></textarea>
      </div>
      <button class="primary-button" type="submit">Create Reminder Payload</button>
    </form>
  `);

  document.querySelector('#reminder-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void setLoading(true, 'Sending');
    try {
      const response = await fetch('/api/contact-reminder-intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          phone: form.get('phone'),
          message: form.get('message'),
          received_at: new Date().toISOString(),
          source: 'mobile_web',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
      }
      setStatus('Reminder payload created');
      content.insertAdjacentHTML(
        'beforeend',
        `<article class="row"><h2 class="row-title">${escapeHtml(payload.reminder?.title || 'Reminder')}</h2><p class="row-subtitle">${escapeHtml(payload.reminder?.notes || '')}</p><div class="row-actions"><button class="copy-button" type="button" data-copy="${escapeAttribute(payload.reminder?.notes || '')}">Copy Notes</button></div></article>`,
      );
      bindCopyButtons();
    } catch (error) {
      setStatus('Reminder failed');
      content.insertAdjacentHTML('beforeend', `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`);
    } finally {
      setLoading(false);
    }
  });
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
    button.addEventListener('click', () => {
      const body = button.getAttribute('data-sms-body') || '';
      const phone = normalizePhoneForSms(button.getAttribute('data-sms-phone') || '');
      window.location.href = phone
        ? `sms:${phone}?body=${encodeURIComponent(body)}`
        : `sms:?body=${encodeURIComponent(body)}`;
    });
  });
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
