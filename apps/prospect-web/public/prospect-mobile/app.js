import {
  cleanMeetingTitle,
  isCurrentCachedMeeting,
  parseCachedMeetingInstant,
} from '/prospect-mobile/set-meetings-utils.mjs';

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
  '/contact-search': {
    title: 'Search',
    render: renderContactSearch,
    usesWeek: false,
  },
};

const state = {
  week: 'this',
  route: routes[toWorkflowPath(window.location.pathname)] ? toWorkflowPath(window.location.pathname) : '/set-meetings',
  routeRequestId: 0,
  isLoading: false,
  contactSearch: {
    query: '',
    results: [],
    selectedId: '',
  },
  schedulePayload: null,
  scheduleSearch: {
    active: false,
    query: '',
    results: [],
    selectedId: '',
  },
};

const pageTitle = document.querySelector('#page-title');
const refreshButton = document.querySelector('#refresh-button');
const content = document.querySelector('#content');
const statusLine = document.querySelector('#status-line');
const weekToolbar = document.querySelector('#week-toolbar');
const FADE_DURATION_MS = 150;

window.addEventListener('popstate', () => {
  setCurrentRoute(routes[toWorkflowPath(window.location.pathname)] ? toWorkflowPath(window.location.pathname) : '/set-meetings');
  void loadRoute();
});

document.querySelectorAll('[data-route]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const nextRoute = link.getAttribute('data-route');
    if (!nextRoute || nextRoute === state.route) return;
    history.pushState({}, '', `/prospect-mobile${nextRoute}`);
    setCurrentRoute(nextRoute);
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
  const routeKey = state.route;
  const requestId = ++state.routeRequestId;
  const renderContext = { routeKey, requestId };
  const route = routes[routeKey];
  pageTitle.textContent = 'SC: Mobile';
  weekToolbar.hidden = !route.usesWeek;
  setActiveNavigation();

  if (!route.endpoint) {
    await setLoading(true, 'Refreshing', renderContext);
    try {
      const renderedCount = await route.render(undefined, renderContext);
      if (!isActiveRoute(renderContext)) return;
      const count = typeof renderedCount === 'number' ? renderedCount : 0;
      setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${count} found`);
    } catch (error) {
      if (!isActiveRoute(renderContext)) return;
      content.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
      setStatus('Could not refresh');
    } finally {
      if (isActiveRoute(renderContext)) setLoading(false);
    }
    return;
  }

  await setLoading(true, 'Refreshing', renderContext);
  try {
    const response = await fetch(`${route.endpoint}?week=${encodeURIComponent(state.week)}`, {
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }
    if (!isActiveRoute(renderContext)) return;
    const renderedCount = await route.render(payload, renderContext);
    if (!isActiveRoute(renderContext)) return;
    const count = typeof renderedCount === 'number' ? renderedCount : payload.count ?? payload.scouts?.length ?? payload.events?.length ?? 0;
    setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${count} found`);
  } catch (error) {
    if (!isActiveRoute(renderContext)) return;
    content.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
    setStatus('Could not refresh');
  } finally {
    if (isActiveRoute(renderContext)) setLoading(false);
  }
}

async function renderSetMeetings(payload, renderContext) {
  const data = payload || (await fetchSetMeetingsFromSupabase(state.week));
  if (!isActiveRoute(renderContext)) return 0;
  const events = Array.isArray(data?.events) ? data.events : [];
  if (!events.length) {
    await setContentHtml('<div class="empty-state">No booked set meetings found for this window.</div>', renderContext);
    return 0;
  }

  await setContentHtml(
    events
      .map((event) => {
      const title = event.athlete_name || cleanMeetingTitle(event.title || 'Booked meeting');
      const owner = event.head_scout_name || event.assigned_owner || 'Scout not resolved';
      const task = event.current_task || 'Confirmation Call';
      const time =
        formatCachedMeetingLabel(event.current_meeting_label || event.start, event.meeting_timezone) ||
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
      const eventDate = buildBookedMeetingEventDate(event.start, event.meeting_timezone);
      const cardUrl = buildScriptableContactCardUrl(owner);
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
            <button class="copy-button" type="button" data-confirmation-modal data-sms-phone="${escapeAttribute(recipientPhone)}" data-confirmation-1-body="${escapeAttribute(firstConfirmation)}" data-confirmation-2-body="${escapeAttribute(secondConfirmation)}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-recipient-label="${escapeAttribute(recipientLabel)}" data-athlete-name="${escapeAttribute(title)}" data-head-scout="${escapeAttribute(owner)}">Confirm</button>
            <a class="link-button id-card-button" href="${escapeAttribute(cardUrl)}" target="_blank" rel="noreferrer" aria-label="Share ID card for ${escapeAttribute(owner)}">
              ${clipboardIconSvg()}
              <span>ID Cards</span>
            </a>
            ${
              event.admin_url || eventId
                ? `<button class="link-button admin-button" type="button" data-admin-modal data-admin-url="${escapeAttribute(event.admin_url || '')}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-athlete-name="${escapeAttribute(title)}" data-head-scout="${escapeAttribute(owner)}">Admin</button>`
                : ''
            }
            <button class="copy-button" type="button" data-copy="${escapeAttribute(copyText)}">Copy</button>
          </div>
        </article>
      `;
      })
      .join(''),
    renderContext,
  );
  bindCopyButtons();
  bindSmsButtons();
  bindConfirmationModalButtons();
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

  const weekWindow = buildMeetingWeekWindow(week);
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
    cache: 'no-store',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      'accept-profile': schema,
      'cache-control': 'no-cache',
      pragma: 'no-cache',
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

  const events = Array.from(grouped.values())
    .map((entry) => ({
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
    }))
    .filter((event) => isCurrentCachedMeeting(event.start, week));

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

async function renderContactSearch(_payload, renderContext) {
  await setContentHtml(buildContactSearchHtml(state.contactSearch), renderContext);
  if (!isActiveRoute(renderContext)) return 0;
  bindContactSearch('contact');
  bindCopyButtons();
  bindScriptableContactButtons();
  return state.contactSearch.results.length;
}

async function renderScoutSchedules(payload, renderContext) {
  if (!isActiveRoute(renderContext)) return 0;
  if (payload) {
    state.schedulePayload = payload;
  }
  const sourcePayload = payload || state.schedulePayload || {};
  const scouts = Array.isArray(sourcePayload?.scouts) ? sourcePayload.scouts : [];
  const groups = scouts
    .map((scout) => ({
      ...scout,
      visibleSlots: filterVisibleScoutSlots(Array.isArray(scout.slots) ? scout.slots : []),
    }))
    .filter((scout) => scout.visibleSlots.length);
  if (state.scheduleSearch.active) {
    await setContentHtml(buildScheduleSearchHtml(groups), renderContext);
    if (!isActiveRoute(renderContext)) return 0;
    bindContactSearch('schedule');
    bindCopyButtons();
    return groups.reduce((sum, scout) => sum + scout.visibleSlots.length, 0);
  }

  if (!groups.length) {
    await setContentHtml(`${buildScheduleSearchBarHtml()}<div class="empty-state">No open scout slots found for this window.</div>`, renderContext);
    if (!isActiveRoute(renderContext)) return 0;
    bindScheduleSearchEntry();
    return 0;
  }

  const visibleCount = groups.reduce((sum, scout) => sum + scout.visibleSlots.length, 0);
  await setContentHtml(
    `${buildScheduleSearchBarHtml()}<div class="schedule-list">${groups
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
    .join('')}</div>`,
    renderContext,
  );
  if (!isActiveRoute(renderContext)) return 0;
  bindScheduleSearchEntry();
  bindCopyButtons();
  return visibleCount;
}

function buildContactSearchHtml(searchState) {
  const results = Array.isArray(searchState.results) ? searchState.results : [];
  const selected = findSelectedContactGroup(results, searchState.selectedId);
  return `
    <section class="search-panel">
      ${buildContactSearchFormHtml(searchState.query, 'contact')}
      ${buildContactResultsHtml(results, searchState.selectedId, 'contact')}
      ${selected ? buildSelectedContactCardsHtml(selected) : ''}
    </section>
  `;
}

function buildScheduleSearchHtml(groups) {
  const searchState = state.scheduleSearch;
  const results = Array.isArray(searchState.results) ? searchState.results : [];
  const selected = findSelectedContactGroup(results, searchState.selectedId);
  const timezone = selected?.timezone || 'America/New_York';
  const timezoneLabel = selected?.timezoneLabel || 'Eastern';
  return `
    <section class="search-panel schedule-search-panel">
      ${buildContactSearchFormHtml(searchState.query, 'schedule')}
      ${buildContactResultsHtml(results, searchState.selectedId, 'schedule')}
      ${
        selected
          ? `<h2 class="group-title">${escapeHtml(selected.title)} - ${escapeHtml(timezoneLabel)}</h2>${buildScheduleGroupsHtml(groups, timezone, timezoneLabel)}`
          : ''
      }
    </section>
  `;
}

function buildScheduleSearchBarHtml() {
  return `
    <section class="search-entry">
      <button class="search-entry-button" type="button" data-schedule-search-start>
        <span>Search contacts</span>
      </button>
    </section>
  `;
}

function buildContactSearchFormHtml(query, scope) {
  return `
    <form class="search-form" data-contact-search-form="${escapeAttribute(scope)}">
      <input class="search-input" name="query" type="search" inputmode="search" autocomplete="off" placeholder="Search" value="${escapeAttribute(query || '')}" />
      <button class="primary-button search-submit" type="submit">Send</button>
      ${
        scope === 'schedule'
          ? '<button class="link-button search-cancel" type="button" data-schedule-search-cancel>Done</button>'
          : ''
      }
    </form>
  `;
}

function buildContactResultsHtml(results, selectedId, scope) {
  if (!results.length) return '';
  return `
    <div class="result-list">
      ${results
        .map((group) => {
          const active = group.id === selectedId ? ' active' : '';
          return `
            <button class="result-row${active}" type="button" data-contact-result="${escapeAttribute(group.id)}" data-result-scope="${escapeAttribute(scope)}">
              <span>
                <strong>${escapeHtml(group.title)}</strong>
                <small>${escapeHtml(group.subtitle)}</small>
              </span>
              <span>Select</span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function buildSelectedContactCardsHtml(group) {
  const timezoneTag = buildCurrentTimezoneTag(group.timezone, group.timezoneLabel);
  return `
    <div class="contact-card-list">
      ${group.adminUrl ? `<div class="matched-result-actions"><a class="link-button admin-button" href="${escapeAttribute(group.adminUrl)}" target="_blank" rel="noreferrer">Admin</a></div>` : ''}
      ${group.contacts.map((contact) => buildSelectedContactCardHtml(contact, timezoneTag)).join('')}
    </div>
  `;
}

function buildSelectedContactCardHtml(contact, timezoneTag) {
  const phone = contact.phone || '';
  const createUrl = buildScriptablePhoneActionUrl('ID New Contact', phone);
  const followUpUrl = buildScriptablePhoneActionUrl('ID iCal Follow-Up', phone);
  const clipboardPayload = buildContactClipboardPayload(contact);
  return `
    <article class="row contact-card">
      <div class="row-header">
        <div>
          <h2 class="row-title">${escapeHtml(contact.name)}</h2>
          <p class="row-subtitle">${escapeHtml(contact.relationship || 'Contact')}</p>
        </div>
        <p class="row-meta">${escapeHtml(formatPhoneLabel(phone))}</p>
      </div>
      <div class="row-actions">
        <button class="copy-button contact-copy-button" type="button" data-copy="${escapeAttribute(phone)}">Copy</button>
        <button class="link-button contact-create-button" type="button" data-scriptable-url="${escapeAttribute(createUrl)}" data-contact-clipboard="${escapeAttribute(clipboardPayload)}">Create</button>
        <button class="link-button contact-follow-up-button" type="button" data-scriptable-url="${escapeAttribute(followUpUrl)}" data-contact-clipboard="${escapeAttribute(clipboardPayload)}">Follow-Up</button>
        ${timezoneTag ? `<span class="timezone-tag">${escapeHtml(timezoneTag)}</span>` : ''}
      </div>
    </article>
  `;
}

function buildScheduleGroupsHtml(groups, timezone, timezoneLabel) {
  if (!groups.length) {
    return '<div class="empty-state">No open scout slots found for this window.</div>';
  }
  return groups
    .map((scout) => {
      const rows = scout.visibleSlots
        .map((slot) => {
          const dateLabel = formatSlotDateForTimezone(slot.start, timezone);
          const range = formatSlotRangeForTimezone(slot.start, slot.end, timezone, timezoneLabel);
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
    .join('');
}

function bindScheduleSearchEntry() {
  document.querySelector('[data-schedule-search-start]')?.addEventListener('click', async () => {
    state.scheduleSearch.active = true;
    state.scheduleSearch.selectedId = '';
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    document.querySelector('.search-input')?.focus();
  });
}

function bindContactSearch(scope) {
  document.querySelector(`[data-contact-search-form="${scope}"]`)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const query = String(new FormData(form).get('query') || '').trim();
    if (scope === 'schedule') {
      state.scheduleSearch.query = query;
      state.scheduleSearch.selectedId = '';
    } else {
      state.contactSearch.query = query;
      state.contactSearch.selectedId = '';
    }
    if (!query) {
      if (scope === 'schedule') state.scheduleSearch.results = [];
      else state.contactSearch.results = [];
      await rerenderSearchScope(scope);
      return;
    }

    setStatus('Searching');
    const results = groupContactSearchRows(await searchAthleteContactCache(query), query);
    if (scope === 'schedule') state.scheduleSearch.results = results;
    else state.contactSearch.results = results;
    await rerenderSearchScope(scope);
    setStatus(`${results.length} found`);
  });

  document.querySelector('[data-schedule-search-cancel]')?.addEventListener('click', async () => {
    state.scheduleSearch.active = false;
    state.scheduleSearch.selectedId = '';
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
  });

  document.querySelectorAll(`[data-result-scope="${scope}"]`).forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-contact-result') || '';
      if (scope === 'schedule') state.scheduleSearch.selectedId = id;
      else state.contactSearch.selectedId = id;
      await rerenderSearchScope(scope);
      bindCopyButtons();
    });
  });
}

async function rerenderSearchScope(scope) {
  if (scope === 'schedule') {
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    return;
  }
  await renderContactSearch(undefined, currentRenderContext('/contact-search'));
}

async function searchAthleteContactCache(query) {
  const config = window.__PROSPECT_SUPABASE__ || {};
  const supabaseUrl = String(config.url || '').replace(/\/+$/, '');
  const anonKey = String(config.anonKey || '');
  const schema = String(config.schema || 'public').trim() || 'public';
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase public config');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/search_athlete_contact_cache`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      'accept-profile': schema,
      'content-profile': schema,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ input_query: query }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(rows.message || rows.error || `Supabase ${response.status}`);
  }
  return Array.isArray(rows) ? rows : [];
}

function groupContactSearchRows(rows, query) {
  const normalizedQuery = normalizeSearchText(query);
  const phoneQuery = String(query || '').replace(/\D/g, '');
  const byAthlete = new Map();
  for (const row of rows) {
    const key = String(row.athlete_key || '').trim();
    if (!key) continue;
    const existing =
      byAthlete.get(key) ||
      {
        id: key,
        athleteName: row.athlete_name || 'Student Athlete',
        athleteId: row.athlete_id || '',
        athleteMainId: row.athlete_main_id || '',
        adminUrl: row.admin_url || buildAthleteAdminUrl(row.athlete_id, row.athlete_main_id),
        matchKind: 'athlete',
        timezone: row.timezone || '',
        timezoneLabel: row.timezone_label || '',
        contacts: [],
      };
    existing.timezone ||= row.timezone || '';
    existing.timezoneLabel ||= row.timezone_label || '';
    existing.adminUrl ||= row.admin_url || buildAthleteAdminUrl(row.athlete_id, row.athlete_main_id);
    const contact = {
      name: row.contact_name || '',
      relationship: row.relationship_label || '',
      phone: row.phone || '',
      normalizedPhone: row.normalized_phone || '',
    };
    if (!existing.contacts.some((candidate) => candidate.normalizedPhone === contact.normalizedPhone)) {
      existing.contacts.push(contact);
    }
    if (
      row.match_kind === 'contact' ||
      normalizeSearchText(row.contact_name).includes(normalizedQuery) ||
      (phoneQuery.length >= 3 && String(row.normalized_phone || '').includes(phoneQuery))
    ) {
      existing.matchKind = row.match_kind === 'phone' ? 'phone' : 'contact';
      existing.matchedContactName ||= row.contact_name || '';
    }
    byAthlete.set(key, existing);
  }

  return Array.from(byAthlete.values()).map((group) => {
    const parents = group.contacts
      .filter((contact) => !isStudentAthleteRelationship(contact.relationship))
      .map((contact) => contact.name)
      .filter(Boolean);
    const title = group.matchKind === 'contact' || group.matchKind === 'phone'
      ? group.matchedContactName || group.contacts[0]?.name || group.athleteName
      : group.athleteName;
    const subtitle = group.matchKind === 'contact' || group.matchKind === 'phone'
      ? group.athleteName
      : parents.join(' / ') || 'Contact cache';
    return {
      ...group,
      title,
      subtitle,
    };
  });
}

function buildAthleteAdminUrl(athleteId, athleteMainId) {
  const id = String(athleteId || '').trim();
  if (!id) return '';
  const params = new URLSearchParams({ contactid: id });
  const mainId = String(athleteMainId || '').trim();
  if (mainId) params.set('athlete_main_id', mainId);
  return `https://dashboard.nationalpid.com/admin/athletes?${params.toString()}`;
}

function findSelectedContactGroup(results, selectedId) {
  return (Array.isArray(results) ? results : []).find((group) => group.id === selectedId) || null;
}

function isStudentAthleteRelationship(value) {
  return normalizeSearchText(value).includes('student athlete');
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function buildScriptablePhoneActionUrl(scriptName, phone) {
  return `scriptable:///run/${encodeURIComponent(scriptName)}?phone=${encodeURIComponent(phone || '')}`;
}

function buildContactClipboardPayload(contact) {
  return [
    contact.name || '',
    contact.relationship || '',
    formatPhoneLabel(contact.phone || '') || contact.phone || '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
}

function formatPhoneLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value || '';
}

function buildCurrentTimezoneTag(timezone, timezoneLabel) {
  const resolvedTimezone = normalizeContactTimezone(timezone, timezoneLabel);
  if (!resolvedTimezone) return '';
  try {
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: resolvedTimezone,
    }).format(new Date());
    return `${time} ${timezoneAbbreviation(resolvedTimezone, timezoneLabel)}`;
  } catch {
    return '';
  }
}

function normalizeContactTimezone(timezone, timezoneLabel) {
  const rawTimezone = String(timezone || '').trim();
  if (rawTimezone.includes('/')) return rawTimezone;

  const key = normalizeSearchText(`${rawTimezone} ${timezoneLabel || ''}`);
  if (/\b(est|eastern|et)\b/.test(key)) return 'America/New_York';
  if (/\b(cst|central|ct)\b/.test(key)) return 'America/Chicago';
  if (/\b(mst|mountain|mt)\b/.test(key)) return 'America/Denver';
  return '';
}

function timezoneAbbreviation(timezone, timezoneLabel) {
  const key = normalizeSearchText(`${timezone || ''} ${timezoneLabel || ''}`);
  if (key.includes('america/chicago') || /\b(cst|central|ct)\b/.test(key)) return 'CST';
  if (key.includes('america/denver') || /\b(mst|mountain|mt)\b/.test(key)) return 'MST';
  return 'EST';
}

function normalizeMeetingTimezoneLabel(timezone) {
  const rawTimezone = String(timezone || '').trim();
  if (rawTimezone.includes('/')) return rawTimezone;

  const key = normalizeSearchText(rawTimezone);
  if (/\b(est|eastern|et)\b/.test(key)) return 'America/New_York';
  if (/\b(cst|central|ct)\b/.test(key)) return 'America/Chicago';
  if (/\b(mst|mountain|mt)\b/.test(key)) return 'America/Denver';
  if (/\b(pst|pacific|pt)\b/.test(key)) return 'America/Los_Angeles';
  return 'America/New_York';
}

function meetingTimezoneLabel(timezone) {
  const key = normalizeSearchText(String(timezone || ''));
  if (key.includes('america/chicago') || /\b(cst|central|ct)\b/.test(key)) return 'CT';
  if (key.includes('america/denver') || /\b(mst|mountain|mt)\b/.test(key)) return 'MT';
  if (key.includes('america/los angeles') || /\b(pst|pacific|pt)\b/.test(key)) return 'PT';
  return 'ET';
}

function buildMeetingWeekWindow(week = 'this', now = new Date()) {
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

function bindScriptableContactButtons() {
  document.querySelectorAll('[data-scriptable-url][data-contact-clipboard]').forEach((button) => {
    button.addEventListener('click', async () => {
      const clipboardText = button.getAttribute('data-contact-clipboard') || '';
      const scriptableUrl = button.getAttribute('data-scriptable-url') || '';
      if (!scriptableUrl) return;
      try {
        await navigator.clipboard.writeText(clipboardText);
        setStatus('Contact selected');
      } catch {
        setStatus('Clipboard failed');
        return;
      }
      window.location.href = scriptableUrl;
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

function bindConfirmationModalButtons() {
  document.querySelectorAll('[data-confirmation-modal]').forEach((button) => {
    button.addEventListener('click', () => showConfirmationModal(button));
  });
}

function bindAdminModalButtons() {
  document.querySelectorAll('[data-admin-modal]').forEach((button) => {
    button.addEventListener('click', () => showAdminModal(button));
  });
}

function showConfirmationModal(button) {
  closeConfirmationModal();

  const eventId = button.getAttribute('data-event-id') || '';
  const eventDate = button.getAttribute('data-event-date') || '';
  const phone = button.getAttribute('data-sms-phone') || '';
  const firstBody = button.getAttribute('data-confirmation-1-body') || '';
  const secondBody = button.getAttribute('data-confirmation-2-body') || '';
  const recipientLabel = button.getAttribute('data-recipient-label') || 'Text';
  const athleteName = button.getAttribute('data-athlete-name') || 'Meeting';
  const headScout = button.getAttribute('data-head-scout') || '';

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-confirmation-action-modal', '');
  modal.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-label="Confirmation text options">
      <div class="modal-header">
        <h2 class="modal-title">${escapeHtml(athleteName)}</h2>
        <p class="modal-subtitle">${escapeHtml(headScout)}</p>
      </div>
      <div class="modal-actions">
        <button class="modal-button confirmation-primary" type="button" data-sms-phone="${escapeAttribute(phone)}" data-sms-body="${escapeAttribute(firstBody)}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-confirmation-prefix="(ACF)">${escapeHtml(recipientLabel)} 1</button>
        <button class="modal-button" type="button" data-sms-phone="${escapeAttribute(phone)}" data-sms-body="${escapeAttribute(secondBody)}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-confirmation-prefix="(ACF*2)">${escapeHtml(recipientLabel)} 2</button>
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeConfirmationModal();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeConfirmationModal);
  modal.querySelectorAll('[data-sms-body]').forEach((smsButton) => {
    smsButton.addEventListener('click', async () => {
      const body = smsButton.getAttribute('data-sms-body') || '';
      const smsPhone = normalizePhoneForSms(smsButton.getAttribute('data-sms-phone') || '');
      await updateConfirmationPrefixFromButton(smsButton);
      closeConfirmationModal();
      window.location.href = smsPhone
        ? `sms:${smsPhone}?body=${encodeURIComponent(body)}`
        : `sms:?body=${encodeURIComponent(body)}`;
    });
  });

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  modal.querySelector('[data-sms-body]')?.focus();
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
        <button class="modal-button success" type="button" data-prefix-action="(CF)">Set (CF)</button>
        <button class="modal-button warning" type="button" data-prefix-action="(RSP)">Set (RSP)</button>
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

function closeConfirmationModal() {
  document.querySelector('[data-confirmation-action-modal]')?.remove();
  document.body.classList.remove('modal-open');
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeAdminModal();
    closeConfirmationModal();
  }
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

function setCurrentRoute(nextRoute) {
  state.route = nextRoute;
  if (nextRoute !== '/scout-schedules') {
    state.scheduleSearch.active = false;
    state.scheduleSearch.selectedId = '';
  }
  if (nextRoute !== '/contact-search') {
    state.contactSearch.selectedId = '';
  }
}

function currentRenderContext(routeKey) {
  return { routeKey, requestId: state.routeRequestId };
}

function isActiveRoute(renderContext) {
  if (!renderContext) return true;
  return state.route === renderContext.routeKey && state.routeRequestId === renderContext.requestId;
}

async function setLoading(isLoading, message = '', renderContext) {
  if (!isActiveRoute(renderContext)) return;
  state.isLoading = isLoading;
  refreshButton.disabled = isLoading;
  refreshButton.style.opacity = isLoading ? '0.6' : '1';
  content.classList.toggle('is-loading', isLoading);
  if (isLoading) {
    await swapContentHtml(buildLoadingRows(), renderContext);
  }
  if (message) setStatus(message);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function setContentHtml(html, renderContext) {
  return swapContentHtml(html, renderContext);
}

async function swapContentHtml(html, renderContext) {
  if (!isActiveRoute(renderContext)) return false;
  content.classList.remove('content-ready');
  content.classList.add('content-exit');
  await wait(FADE_DURATION_MS);
  if (!isActiveRoute(renderContext)) return false;
  content.innerHTML = html;
  content.classList.remove('content-exit');
  requestAnimationFrame(() => content.classList.add('content-ready'));
  return true;
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

function formatSlotDateForTimezone(value, timezone) {
  const date = parseEasternSlotInstant(value);
  if (!date) return formatSlotDate(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatSlotRangeForTimezone(start, end, timezone, timezoneLabel) {
  const startDate = parseEasternSlotInstant(start);
  const endDate = parseEasternSlotInstant(end);
  if (!startDate || !endDate) return formatSlotRange(start, end);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)} ${timezoneLabel || 'Eastern'}`;
}

function formatMeetingTime(start, end) {
  return `${formatSlotDate(start)}, ${formatSlotRange(start, end)}`;
}

function formatCachedMeetingLabel(value, timezone) {
  const date = parseCachedMeetingInstant(value);
  if (!date) return '';
  const meetingTimezone = normalizeMeetingTimezoneLabel(timezone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: meetingTimezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || '';
  const day = Number.parseInt(valueFor('day'), 10);
  const period = valueFor('dayPeriod').toLowerCase();
  return `${valueFor('weekday')}, ${valueFor('month')} ${day}${ordinalSuffix(day)} - ${valueFor('hour')}:${valueFor('minute')}${period} ${meetingTimezoneLabel(timezone)}`;
}

function buildBookedMeetingEventDate(value, timezone) {
  const date = parseCachedMeetingInstant(value);
  if (!date) return '';
  const meetingTimezone = normalizeMeetingTimezoneLabel(timezone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: meetingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
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

function buildScriptableContactCardUrl(scoutName) {
  return `scriptable:///run/share-prospect-contact-card?scout=${encodeURIComponent(String(scoutName || ''))}`;
}

function clipboardIconSvg() {
  return `
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4.75h6M9 4.75A2.25 2.25 0 0 1 11.25 2.5h1.5A2.25 2.25 0 0 1 15 4.75M9 4.75H6.75A2.25 2.25 0 0 0 4.5 7v12.25a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V7a2.25 2.25 0 0 0-2.25-2.25H15" />
      <path d="M8.5 11.25h7M8.5 15.25h5.25" />
    </svg>
  `;
}

function parseEasternLocal(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function parseEasternSlotInstant(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:00-04:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
