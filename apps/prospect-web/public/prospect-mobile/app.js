import {
  cleanMeetingTitle,
  isCurrentCachedMeeting,
  parseCachedMeetingInstant,
} from '/prospect-mobile/set-meetings-utils.mjs';

const routes = {
  '/set-meetings': {
    title: 'Set Meetings',
    endpoint: '/api/prospect-mobile/set-meetings',
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
  route: getInitialRoute(),
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
  scheduleScoutSearch: {
    active: false,
    query: '',
    selectedName: '',
  },
  scheduleSlotSelection: {
    active: false,
    selectedKeys: [],
  },
  setMeetingsMode: 'booked',
  setMeetingsPayload: null,
  rescheduleQueue: {
    events: [],
    loadedAt: 0,
  },
  rescheduleDrawer: {
    event: null,
    scoutName: '',
    schedulePayload: null,
    week: 'this',
  },
};

const pageTitle = document.querySelector('#page-title');
const refreshButton = document.querySelector('#refresh-button');
const content = document.querySelector('#content');
const statusLine = document.querySelector('#status-line');
const weekToolbar = document.querySelector('#week-toolbar');
const FADE_DURATION_MS = 150;
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const ADD_CLIPJAR_SHORTCUT_URL = 'shortcuts://run-shortcut?name=Add%20ClipJar';
const initialContactQuery = applyStartupSearchParams();
let initialContactSearchPending = Boolean(initialContactQuery);
const routeResponseCache = new Map();
let toastTimer = 0;

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
    state.scheduleSlotSelection.selectedKeys = [];
    void loadRoute();
  });
});

refreshButton.addEventListener('click', () => void loadRoute({ forceRefresh: true }));
window.addEventListener('pageshow', () => void loadRoute());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void loadRoute();
  }
});

async function loadRoute(options = {}) {
  const routeKey = state.route;
  const requestId = ++state.routeRequestId;
  const renderContext = { routeKey, requestId };
  const route = routes[routeKey];
  pageTitle.textContent = 'scoutOS';
  weekToolbar.hidden = !route.usesWeek;
  setActiveNavigation();

  if (!route.endpoint) {
    await setLoading(true, 'Refreshing', renderContext);
    try {
      const renderedCount = await route.render(undefined, renderContext);
      if (!isActiveRoute(renderContext)) return;
      if (routeKey === '/contact-search' && initialContactSearchPending) {
        initialContactSearchPending = false;
        await runContactSearchQuery(initialContactQuery, 'contact', { autoSelectSingle: true });
        return;
      }
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

  const cacheKey = buildRouteCacheKey(routeKey, state.week);
  const cachedPayload = !options.forceRefresh ? getCachedRoutePayload(cacheKey) : null;
  if (cachedPayload) {
    try {
      const renderedCount = await route.render(cachedPayload, renderContext);
      if (!isActiveRoute(renderContext)) return;
      const count = typeof renderedCount === 'number'
        ? renderedCount
        : cachedPayload.count ?? cachedPayload.scouts?.length ?? cachedPayload.events?.length ?? 0;
      setStatus(`Cached ${formatCacheAge(cachedPayload.__cachedAt)} - ${count} found`);
    } catch (error) {
      if (!isActiveRoute(renderContext)) return;
      content.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
      setStatus('Could not refresh');
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
    setCachedRoutePayload(cacheKey, payload);
    const renderedCount = await route.render(payload, renderContext);
    if (!isActiveRoute(renderContext)) return;
    const count = typeof renderedCount === 'number' ? renderedCount : payload.count ?? payload.scouts?.length ?? payload.events?.length ?? 0;
    setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${count} found`);
  } catch (error) {
    if (!isActiveRoute(renderContext)) return;
    if (routeKey === '/set-meetings' && isMissingServerSupabaseCredentials(error)) {
      try {
        const payload = await fetchSetMeetingsFromSupabase(state.week);
        if (!isActiveRoute(renderContext)) return;
        setCachedRoutePayload(cacheKey, payload);
        const renderedCount = await route.render(payload, renderContext);
        if (!isActiveRoute(renderContext)) return;
        const count = typeof renderedCount === 'number' ? renderedCount : payload.count ?? payload.events?.length ?? 0;
        setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${count} found`);
        return;
      } catch (fallbackError) {
        if (!isActiveRoute(renderContext)) return;
        content.innerHTML = `<div class="error-state">${escapeHtml(fallbackError.message || String(fallbackError))}</div>`;
        setStatus('Could not refresh');
        return;
      }
    }
    content.innerHTML = `<div class="error-state">${escapeHtml(error.message || String(error))}</div>`;
    setStatus('Could not refresh');
  } finally {
    if (isActiveRoute(renderContext)) setLoading(false);
  }
}

function isMissingServerSupabaseCredentials(error) {
  return /missing server supabase credentials/i.test(String(error?.message || error || ''));
}

function buildRouteCacheKey(routeKey, week) {
  return `${routeKey}:${week || 'this'}`;
}

function getCachedRoutePayload(cacheKey) {
  const cached = routeResponseCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > ROUTE_CACHE_TTL_MS) {
    routeResponseCache.delete(cacheKey);
    return null;
  }
  return {
    ...cached.payload,
    __cachedAt: cached.cachedAt,
  };
}

function setCachedRoutePayload(cacheKey, payload) {
  routeResponseCache.set(cacheKey, {
    cachedAt: Date.now(),
    payload,
  });
}

function formatCacheAge(cachedAt) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - Number(cachedAt || Date.now())) / 1000));
  if (ageSeconds < 60) return 'just now';
  return `${Math.floor(ageSeconds / 60)}m ago`;
}

async function renderSetMeetings(payload, renderContext) {
  const data = payload || {};
  if (payload) state.setMeetingsPayload = payload;
  if (!isActiveRoute(renderContext)) return 0;
  if (state.setMeetingsMode === 'reschedule') {
    const queue = await fetchRecentRescheduleQueue();
    if (!isActiveRoute(renderContext)) return 0;
    await setContentHtml(
      `${buildSetMeetingsModeToggleHtml()}${buildRescheduleQueueHtml(queue.events)}`,
      renderContext,
    );
    if (!isActiveRoute(renderContext)) return 0;
    bindSetMeetingsModeToggle();
    bindRescheduleQueueActions();
    return queue.events.length;
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  if (!events.length) {
    await setContentHtml(`${buildSetMeetingsModeToggleHtml()}<div class="empty-state">No booked set meetings found for this window.</div>`, renderContext);
    bindSetMeetingsModeToggle();
    return 0;
  }

  await setContentHtml(
    `${buildSetMeetingsModeToggleHtml()}${events
      .map((event) => {
      const title = event.athlete_name || cleanMeetingTitle(event.title || 'Booked meeting');
      const owner = event.head_scout_name || event.assigned_owner || 'Scout not resolved';
      const task = event.current_task || 'Confirmation Call';
      const time =
        formatCachedMeetingLabel(event.current_meeting_label || event.start, event.meeting_timezone) ||
        event.date_time_label ||
        formatMeetingTime(event.start, event.end);
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
                ? `<button class="link-button admin-button" type="button" data-admin-modal data-admin-url="${escapeAttribute(event.admin_url || '')}" data-event-id="${escapeAttribute(eventId)}" data-event-date="${escapeAttribute(eventDate)}" data-athlete-id="${escapeAttribute(event.athlete_id || '')}" data-athlete-main-id="${escapeAttribute(event.athlete_main_id || '')}" data-athlete-name="${escapeAttribute(title)}" data-head-scout="${escapeAttribute(owner)}">Admin</button>`
                : ''
            }
            <button class="copy-button" type="button" data-contact-copy-modal data-athlete-name="${escapeAttribute(title)}" data-head-scout="${escapeAttribute(owner)}" data-recipient-contacts="${escapeAttribute(JSON.stringify(event.recipient_contacts || []))}">Copy</button>
          </div>
        </article>
      `;
      })
      .join('')}`,
    renderContext,
  );
  bindSetMeetingsModeToggle();
  bindCopyButtons();
  bindSmsButtons();
  bindConfirmationModalButtons();
  bindAdminModalButtons();
  bindContactCopyModalButtons();
  return events.length;
}

function buildSetMeetingsModeToggleHtml() {
  const bookedActive = state.setMeetingsMode === 'booked' ? ' active' : '';
  const rescheduleActive = state.setMeetingsMode === 'reschedule' ? ' active' : '';
  return `
    <section class="mode-toolbar" aria-label="Set meeting mode">
      <button class="mode-button${bookedActive}" type="button" data-set-meetings-mode="booked">Upcoming</button>
      <button class="mode-button${rescheduleActive}" type="button" data-set-meetings-mode="reschedule">Needs Reschedule</button>
    </section>
  `;
}

function bindSetMeetingsModeToggle() {
  document.querySelectorAll('[data-set-meetings-mode]').forEach((button) => {
    button.addEventListener('click', async () => {
      const mode = button.getAttribute('data-set-meetings-mode') || 'booked';
      if (mode === state.setMeetingsMode) return;
      state.setMeetingsMode = mode;
      await renderSetMeetings(state.setMeetingsPayload, currentRenderContext('/set-meetings'));
    });
  });
}

async function fetchRecentRescheduleQueue(options = {}) {
  const athleteId = String(options.athleteId || '').trim();
  const athleteMainId = String(options.athleteMainId || '').trim();
  const params = new URLSearchParams();
  if (athleteId) params.set('athlete_id', athleteId);
  if (athleteMainId) params.set('athlete_main_id', athleteMainId);
  const response = await fetch(`/api/prospect-mobile/reschedule-queue${params.toString() ? `?${params}` : ''}`, {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Queue ${response.status}`);
  }
  if (!athleteId && !athleteMainId) {
    state.rescheduleQueue = {
      events: Array.isArray(payload.events) ? payload.events : [],
      loadedAt: Date.now(),
    };
  }
  return {
    ...payload,
    events: Array.isArray(payload.events) ? payload.events : [],
  };
}

function buildRescheduleQueueHtml(events) {
  const rows = Array.isArray(events) ? events : [];
  if (!rows.length) {
    return '<div class="empty-state">No recent reschedule pending clients.</div>';
  }
  return rows
    .map((event) => {
      const title = event.athlete_name || 'Reschedule pending';
      const scout = event.head_scout_name || 'Scout not resolved';
      const updated = formatRelativeDate(event.updated_at) || 'Recent RSP';
      const previous = formatCachedMeetingLabel(event.previous_meeting_start, event.meeting_timezone) || 'Previous meeting';
      const adminUrl = event.admin_url || buildAthleteAdminUrl(event.athlete_id, event.athlete_main_id);
      return `
        <article class="row reschedule-row">
          <div class="row-header">
            <div>
              <h2 class="row-title">${escapeHtml(title)}</h2>
              <p class="row-subtitle">${escapeHtml(scout)} - ${escapeHtml(previous)}</p>
            </div>
            <p class="row-meta">${escapeHtml(updated)}</p>
          </div>
          <div class="row-actions">
            <button class="copy-button reschedule-button" type="button" data-reschedule-client="${escapeAttribute(encodeRescheduleEvent(event))}">Reschedule</button>
            ${adminUrl ? `<a class="link-button admin-button" href="${escapeAttribute(adminUrl)}" target="_blank" rel="noreferrer">Admin</a>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

function bindRescheduleQueueActions() {
  bindCopyButtons();
  document.querySelectorAll('[data-reschedule-client]').forEach((button) => {
    button.addEventListener('click', async () => {
      const event = decodeRescheduleEvent(button.getAttribute('data-reschedule-client') || '');
      if (!event) {
        setStatus('Missing client');
        return;
      }
      await showRescheduleDrawer(event);
    });
  });
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
    'select=appointment_id,athlete_id,athlete_main_id,athlete_name,recipient_name,recipient_phone,head_scout_name,meeting_starts_at,meeting_ends_at,meeting_timezone,message_body,admin_url,task_url,kind,payload_json',
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
    const existing = grouped.get(key) || { base: row, recipient_contacts: [] };
    if (row.kind === 'confirmation_1') existing.c1 = row.message_body || '';
    if (row.kind === 'confirmation_2') existing.c2 = row.message_body || '';
    for (const contact of buildConfirmationCacheContactOptions(row)) {
      if (
        contact.phone &&
        !existing.recipient_contacts.some((candidate) => normalizePhoneForSms(candidate.phone) === normalizePhoneForSms(contact.phone))
      ) {
        existing.recipient_contacts.push(contact);
      }
    }
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
      end: entry.base.meeting_ends_at,
      meeting_timezone: entry.base.meeting_timezone,
      confirmation_recipient: {
        name: entry.base.recipient_name,
        phone: entry.base.recipient_phone,
      },
      recipient_contacts: entry.recipient_contacts,
      confirmation_1_message: entry.c1 || '',
      confirmation_2_message: entry.c2 || '',
      admin_url: entry.base.admin_url,
      task_url: entry.base.task_url,
      source: 'supabase_confirmation_cache',
    }))
    .filter((event) => isCurrentCachedMeeting(event.start, week, new Date(), event.end));

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

function buildConfirmationCacheContactOptions(row) {
  const payload = row?.payload_json && typeof row.payload_json === 'object' ? row.payload_json : {};
  const payloadContacts = Array.isArray(payload.recipient_contacts)
    ? payload.recipient_contacts
        .map((contact) => ({
          name: String(contact?.name || '').trim(),
          relationship: String(contact?.label || contact?.relationship || '').trim(),
          phone: String(contact?.phone || '').trim(),
        }))
        .filter((contact) => contact.phone)
    : [];
  if (payloadContacts.length) return payloadContacts;

  const phone = String(row?.recipient_phone || payload.recipient_phone || '').trim();
  const name = String(row?.recipient_name || payload.recipient_name || '').trim();
  const relationship = String(payload.relationship_label || payload.relationship || '').trim();
  return [{
    name: name || relationship || 'Contact',
    relationship,
    phone,
  }];
}

async function renderContactSearch(_payload, renderContext) {
  await setContentHtml(buildContactSearchHtml(state.contactSearch), renderContext);
  if (!isActiveRoute(renderContext)) return 0;
  bindContactSearch('contact');
  bindCopyButtons();
  bindScriptableContactButtons();
  bindSearchRescheduleButtons();
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
  const scoutFilteredGroups = filterScheduleGroupsByScout(groups, state.scheduleScoutSearch.selectedName);
  const selectedContact = findSelectedContactGroup(state.scheduleSearch.results, state.scheduleSearch.selectedId);
  const timezone = selectedContact?.timezone || 'America/New_York';
  const timezoneLabel = selectedContact?.timezoneLabel || 'Eastern';

  if (state.scheduleSearch.active) {
    await setContentHtml(buildScheduleSearchHtml(scoutFilteredGroups), renderContext);
    if (!isActiveRoute(renderContext)) return 0;
    bindScheduleActionEntry(groups);
    bindContactSearch('schedule');
    bindCopyButtons();
    bindScheduleSlotSelection();
    return scoutFilteredGroups.reduce((sum, scout) => sum + scout.visibleSlots.length, 0);
  }

  const visibleGroups = scoutFilteredGroups;
  if (!groups.length) {
    await setContentHtml(`${buildScheduleActionEntryHtml(groups)}<div class="empty-state">No open scout slots found for this window.</div>`, renderContext);
    if (!isActiveRoute(renderContext)) return 0;
    bindScheduleActionEntry(groups);
    return 0;
  }

  const visibleCount = visibleGroups.reduce((sum, scout) => sum + scout.visibleSlots.length, 0);
  await setContentHtml(
    `${buildScheduleActionEntryHtml(groups)}${
      visibleGroups.length
        ? `<div class="schedule-list">${buildScheduleGroupsHtml(visibleGroups, timezone, timezoneLabel)}</div>${buildSelectedSlotsBarHtml()}`
        : '<div class="empty-state">No scouts match that search.</div>'
    }`,
    renderContext,
  );
  if (!isActiveRoute(renderContext)) return 0;
  bindScheduleActionEntry(groups);
  bindCopyButtons();
  bindScheduleSlotSelection();
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
    ${buildScheduleActionEntryHtml(groups)}
    <section class="search-panel schedule-search-panel">
      ${buildContactSearchFormHtml(searchState.query, 'schedule')}
      ${buildContactResultsHtml(results, searchState.selectedId, 'schedule')}
      ${
        selected
          ? `<h2 class="group-title">${escapeHtml(selected.title)} - ${escapeHtml(timezoneLabel)}</h2>${buildScheduleGroupsHtml(groups, timezone, timezoneLabel)}${buildSelectedSlotsBarHtml()}`
          : ''
      }
    </section>
  `;
}

function buildScheduleActionEntryHtml(groups) {
  return `
    <section class="search-entry">
      <button class="schedule-actions-button" type="button" data-schedule-actions-start>Schedule Actions</button>
      ${buildScheduleFilterChipsHtml(groups)}
    </section>
  `;
}

function buildScheduleFilterChipsHtml(groups) {
  const chips = [];
  const selectedScout = state.scheduleScoutSearch.selectedName;
  const selectedContact = findSelectedContactGroup(state.scheduleSearch.results, state.scheduleSearch.selectedId);
  if (selectedScout) {
    const slotCount = filterScheduleGroupsByScout(groups, selectedScout).reduce((sum, scout) => sum + scout.visibleSlots.length, 0);
    chips.push(`<button class="filter-chip scout-chip" type="button" data-clear-scout-filter>${escapeHtml(selectedScout)} - ${slotCount}</button>`);
  }
  if (selectedContact) {
    chips.push(`<button class="filter-chip contact-chip" type="button" data-clear-contact-filter>${escapeHtml(selectedContact.title)}</button>`);
  }
  if (state.scheduleSlotSelection.active) {
    chips.push(`<button class="filter-chip slot-chip" type="button" data-stop-slot-selection>Selecting ${state.scheduleSlotSelection.selectedKeys.length}</button>`);
  }
  return chips.length ? `<div class="filter-chip-row">${chips.join('')}</div>` : '';
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
              <span>${escapeHtml(group.sourceLabel || 'Select')}</span>
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
      ${
        group.adminUrl || group.profileUrl
          ? `<div class="matched-result-actions">
              ${group.adminUrl ? `<a class="link-button admin-button matched-admin-action" href="${escapeAttribute(group.adminUrl)}" target="_blank" rel="noreferrer">Admin</a>` : ''}
              ${group.profileUrl ? `<a class="link-button matched-profile-action" href="${escapeAttribute(group.profileUrl)}" target="_blank" rel="noreferrer">Profile</a>` : ''}
              <button class="link-button reschedule-search-button" type="button" data-search-reschedule-athlete-id="${escapeAttribute(group.athleteId || '')}" data-search-reschedule-athlete-main-id="${escapeAttribute(group.athleteMainId || '')}">Reschedule</button>
            </div>`
          : ''
      }
      ${group.contacts.map((contact) => buildSelectedContactCardHtml(contact, timezoneTag)).join('')}
    </div>
  `;
}

function buildSelectedContactCardHtml(contact, timezoneTag) {
  const phone = contact.phone || '';
  const email = contact.email || '';
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
        <p class="row-meta">${escapeHtml(formatPhoneLabel(phone) || email)}</p>
      </div>
      <div class="row-actions">
        ${phone ? `<button class="copy-button contact-copy-button" type="button" data-copy="${escapeAttribute(phone)}">Copy Phone</button>` : ''}
        ${email ? `<button class="copy-button contact-copy-button" type="button" data-copy="${escapeAttribute(email)}">Copy Email</button>` : ''}
        ${phone ? `<button class="link-button contact-create-button" type="button" data-scriptable-url="${escapeAttribute(createUrl)}" data-contact-clipboard="${escapeAttribute(clipboardPayload)}">Create</button>` : ''}
        ${phone ? `<button class="link-button contact-follow-up-button" type="button" data-scriptable-url="${escapeAttribute(followUpUrl)}" data-contact-clipboard="${escapeAttribute(clipboardPayload)}">Follow-Up</button>` : ''}
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
          const copyText = formatSlotCopyLabelForTimezone(slot.start, timezone, timezoneLabel);
          const slotKey = buildScheduleSlotKey(scout, slot);
          const checked = state.scheduleSlotSelection.selectedKeys.includes(slotKey) ? ' checked' : '';
          const slotSelect = state.scheduleSlotSelection.active
            ? `<label class="slot-select-control" aria-label="Select ${escapeAttribute(copyText)}">
                <input type="checkbox" data-slot-select data-slot-key="${escapeAttribute(slotKey)}" data-slot-copy="${escapeAttribute(copyText)}"${checked} />
                <span></span>
              </label>`
            : '';
          return `
            <article class="row schedule-slot-row${state.scheduleSlotSelection.active ? ' selectable' : ''}">
              <div class="row-header">
                ${slotSelect}
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

function buildSelectedSlotsBarHtml() {
  if (!state.scheduleSlotSelection.active) return '';
  const count = state.scheduleSlotSelection.selectedKeys.length;
  return `
    <div class="selected-slots-bar" role="region" aria-label="Selected slots">
      <button class="confirm-slots-button" type="button" data-confirm-selected-slots>
        Confirm Slots${count ? ` (${count})` : ''}
      </button>
    </div>
  `;
}

function buildScheduleSlotKey(scout, slot) {
  return [
    scout?.scout_name || scout?.name || '',
    scout?.state || '',
    slot?.start || '',
    slot?.end || '',
  ].join('|');
}

function filterScheduleGroupsByScout(groups, query) {
  const normalizedQuery = normalizeScoutSearchText(query);
  if (!normalizedQuery) return groups;
  return groups.filter((scout) => scoutMatchesScheduleQuery(scout, normalizedQuery));
}

function scoutMatchesScheduleQuery(scout, normalizedQuery) {
  const scoutName = String(scout?.scout_name || scout?.name || '');
  const normalizedName = normalizeScoutSearchText(scoutName);
  const initials = scoutName
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .toLowerCase();
  return normalizedName.includes(normalizedQuery) || initials.includes(normalizedQuery);
}

function normalizeScoutSearchText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bindScheduleActionEntry(groups) {
  document.querySelector('[data-schedule-actions-start]')?.addEventListener('click', () => {
    showScheduleActionsModal(groups);
  });

  document.querySelector('[data-clear-scout-filter]')?.addEventListener('click', async () => {
    state.scheduleScoutSearch.selectedName = '';
    state.scheduleScoutSearch.query = '';
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    setStatus('Scout cleared');
  });

  document.querySelector('[data-clear-contact-filter]')?.addEventListener('click', async () => {
    state.scheduleSearch.active = false;
    state.scheduleSearch.selectedId = '';
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    setStatus('Contact cleared');
  });

  document.querySelector('[data-stop-slot-selection]')?.addEventListener('click', async () => {
    state.scheduleSlotSelection.active = false;
    state.scheduleSlotSelection.selectedKeys = [];
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    setStatus('Selection off');
  });
}

function showScheduleActionsModal(groups) {
  closeScheduleActionsModal();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-schedule-actions-modal', '');
  modal.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-label="Schedule actions">
      <div class="modal-header">
        <h2 class="modal-title">Schedule Actions</h2>
        <p class="modal-subtitle">Choose a schedule filter or slot action.</p>
      </div>
      <div class="modal-actions">
        <button class="modal-button scout-search-modal-button" type="button" data-open-scout-picker>Search Scouts</button>
        <button class="modal-button contact-search-modal-button" type="button" data-open-schedule-contact-search>Search Contacts</button>
        <button class="modal-button success" type="button" data-start-slot-selection>Select Slots</button>
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeScheduleActionsModal();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeScheduleActionsModal);
  modal.querySelector('[data-open-scout-picker]')?.addEventListener('click', () => {
    closeScheduleActionsModal();
    showScoutPickerModal(groups);
  });
  modal.querySelector('[data-open-schedule-contact-search]')?.addEventListener('click', async () => {
    closeScheduleActionsModal();
    state.scheduleSearch.active = true;
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    document.querySelector('.search-input')?.focus();
  });
  modal.querySelector('[data-start-slot-selection]')?.addEventListener('click', async () => {
    closeScheduleActionsModal();
    state.scheduleSlotSelection.active = true;
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    setStatus('Selection on');
  });

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  modal.querySelector('[data-open-scout-picker]')?.focus();
}

function showScoutPickerModal(groups) {
  closeScoutPickerModal();
  const availableGroups = Array.isArray(groups) ? groups : [];
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-scout-picker-modal', '');
  modal.innerHTML = `
    <section class="modal-panel scout-picker-panel" role="dialog" aria-modal="true" aria-label="Scout picker">
      <div class="modal-header">
        <h2 class="modal-title">Search Scouts</h2>
        <p class="modal-subtitle">Pick a scout to load their cached slots.</p>
      </div>
      <div class="scout-picker-grid">
        ${
          availableGroups.length
            ? availableGroups.map((scout, index) => {
                const scoutName = scout.scout_name || scout.name || 'Scout';
                const active = state.scheduleScoutSearch.selectedName === scoutName ? ' active' : '';
                return `<button class="scout-picker-button scout-color-${index % 8}${active}" type="button" data-scout-pick="${escapeAttribute(scoutName)}">
                  <span>${escapeHtml(shortScoutName(scoutName))}</span>
                  <small>${scout.visibleSlots.length} slots</small>
                </button>`;
              }).join('')
            : '<button class="modal-button secondary" type="button" disabled>No scouts loaded</button>'
        }
      </div>
      <div class="modal-actions">
        <button class="modal-button secondary" type="button" data-clear-scout-pick>All Scouts</button>
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeScoutPickerModal();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeScoutPickerModal);
  modal.querySelector('[data-clear-scout-pick]')?.addEventListener('click', async () => {
    state.scheduleScoutSearch.selectedName = '';
    state.scheduleScoutSearch.query = '';
    closeScoutPickerModal();
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    setStatus('All scouts');
  });
  modal.querySelectorAll('[data-scout-pick]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.scheduleScoutSearch.selectedName = button.getAttribute('data-scout-pick') || '';
      state.scheduleScoutSearch.query = state.scheduleScoutSearch.selectedName;
      closeScoutPickerModal();
      await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
      setStatus('Scout loaded');
    });
  });

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  modal.querySelector('[data-scout-pick]')?.focus();
}

async function showRescheduleDrawer(event) {
  closeRescheduleDrawer();
  state.rescheduleDrawer.event = event;
  state.rescheduleDrawer.scoutName = event.head_scout_name || '';
  state.rescheduleDrawer.week = state.week || 'this';
  showLoadingModal('Loading slots');
  setStatus('Loading slots');
  try {
    state.rescheduleDrawer.schedulePayload = await loadRescheduleSchedulePayload(state.rescheduleDrawer.week);
    closeLoadingModal();
    renderRescheduleDrawer();
  } catch (error) {
    closeLoadingModal();
    setStatus(`Slots failed: ${error.message || error}`);
  }
}

async function loadRescheduleSchedulePayload(week = state.week || 'this') {
  if (week === state.week && state.schedulePayload?.scouts?.length) return state.schedulePayload;
  const cacheKey = buildRouteCacheKey('/scout-schedules', week);
  const cached = getCachedRoutePayload(cacheKey);
  if (cached?.scouts?.length) return cached;
  const response = await fetch(`/api/head-scout-schedules?week=${encodeURIComponent(week)}`, {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Slots ${response.status}`);
  }
  setCachedRoutePayload(cacheKey, payload);
  if (week === state.week) state.schedulePayload = payload;
  return payload;
}

function renderRescheduleDrawer() {
  const event = state.rescheduleDrawer.event;
  if (!event) return;
  const groups = buildVisibleRescheduleGroups(state.rescheduleDrawer.schedulePayload);
  const selectedScout = resolveRescheduleScoutName(groups, state.rescheduleDrawer.scoutName);
  state.rescheduleDrawer.scoutName = selectedScout;
  const selectedGroup = groups.find((group) => (group.scout_name || group.name || '') === selectedScout) || groups[0] || null;
  const slots = selectedGroup?.visibleSlots || [];
  const timezone = event.meeting_timezone || 'America/New_York';
  const timezoneLabel = event.meeting_timezone_label || timezoneAbbreviation(timezone, event.meeting_timezone_label);
  const adminUrl = event.admin_url || buildAthleteAdminUrl(event.athlete_id, event.athlete_main_id);
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-reschedule-drawer', '');
  modal.innerHTML = `
    <section class="modal-panel reschedule-panel" role="dialog" aria-modal="true" aria-label="Reschedule client">
      <div class="modal-header">
        <h2 class="modal-title">${escapeHtml(event.athlete_name || 'Reschedule pending')}</h2>
        <p class="modal-subtitle">${escapeHtml(selectedScout || 'Select scout')}</p>
      </div>
      <div class="reschedule-summary">
        <span>RSP</span>
        <strong>${escapeHtml(formatCachedMeetingLabel(event.previous_meeting_start, timezone) || 'Previous meeting')}</strong>
      </div>
      <div class="reschedule-scout-row">
        <button class="modal-button scout-search-modal-button" type="button" data-reschedule-scout-picker>Search Scouts</button>
        <button class="modal-button secondary" type="button" data-reschedule-week-toggle>${state.rescheduleDrawer.week === 'next' ? 'This Week' : 'Next Week'}</button>
      </div>
      ${
        adminUrl
          ? `<a class="modal-button admin-modal-button" href="${escapeAttribute(adminUrl)}" target="_blank" rel="noreferrer">Admin</a>`
          : ''
      }
      <label class="field">
        <span>Open Slot</span>
        <select data-reschedule-slot>
          ${
            slots.length
              ? slots.slice(0, 12).map((slot) => {
                  const slotPayload = {
                    open_event_id: slot.id,
                    start_time: slot.start,
                    assigned_to: selectedGroup.meeting_for,
                    head_scout_name: selectedScout,
                    display_label: formatSlotCopyLabelForTimezone(slot.start, timezone, timezoneLabel),
                  };
                  const label = `${formatSlotDateForTimezone(slot.start, timezone)} - ${formatSlotRangeForTimezone(slot.start, slot.end, timezone, timezoneLabel)}`;
                  return `<option value="${escapeAttribute(encodeRescheduleEvent(slotPayload))}">${escapeHtml(label)}</option>`;
                }).join('')
              : '<option value="">No slots loaded</option>'
          }
        </select>
      </label>
      <div class="modal-actions">
        <button class="modal-button success" type="button" data-submit-reschedule${slots.length ? '' : ' disabled'}>Submit Reschedule</button>
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (clickEvent) => {
    if (clickEvent.target === modal) closeRescheduleDrawer();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeRescheduleDrawer);
  modal.querySelector('[data-reschedule-scout-picker]')?.addEventListener('click', () => {
    showRescheduleScoutPicker(groups);
  });
  modal.querySelector('[data-reschedule-week-toggle]')?.addEventListener('click', async () => {
    const nextWeek = state.rescheduleDrawer.week === 'next' ? 'this' : 'next';
    state.rescheduleDrawer.week = nextWeek;
    closeRescheduleDrawer();
    showLoadingModal(nextWeek === 'next' ? 'Loading next week' : 'Loading this week');
    setStatus(nextWeek === 'next' ? 'Next week' : 'This week');
    try {
      state.rescheduleDrawer.schedulePayload = await loadRescheduleSchedulePayload(nextWeek);
      closeLoadingModal();
      renderRescheduleDrawer();
    } catch (error) {
      closeLoadingModal();
      setStatus(`Slots failed: ${error.message || error}`);
    }
  });
  modal.querySelector('[data-submit-reschedule]')?.addEventListener('click', async () => {
    await submitSelectedReschedule(modal);
  });

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  modal.querySelector('[data-reschedule-slot]')?.focus();
}

function buildVisibleRescheduleGroups(payload) {
  const scouts = Array.isArray(payload?.scouts) ? payload.scouts : [];
  return scouts
    .map((scout) => ({
      ...scout,
      visibleSlots: filterVisibleScoutSlots(Array.isArray(scout.slots) ? scout.slots : []),
    }))
    .filter((scout) => scout.visibleSlots.length);
}

function resolveRescheduleScoutName(groups, preferredScout) {
  const preferred = String(preferredScout || '').trim();
  if (preferred) {
    const exact = groups.find((group) => normalizeScoutSearchText(group.scout_name || group.name) === normalizeScoutSearchText(preferred));
    if (exact) return exact.scout_name || exact.name || preferred;
  }
  return groups[0]?.scout_name || groups[0]?.name || preferred;
}

function showRescheduleScoutPicker(groups) {
  closeScoutPickerModal();
  const availableGroups = Array.isArray(groups) ? groups : [];
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-scout-picker-modal', '');
  modal.innerHTML = `
    <section class="modal-panel scout-picker-panel" role="dialog" aria-modal="true" aria-label="Reschedule scout picker">
      <div class="modal-header">
        <h2 class="modal-title">Search Scouts</h2>
        <p class="modal-subtitle">Pick the scout for this reschedule.</p>
      </div>
      <div class="scout-picker-grid">
        ${
          availableGroups.length
            ? availableGroups.map((scout, index) => {
                const scoutName = scout.scout_name || scout.name || 'Scout';
                const active = state.rescheduleDrawer.scoutName === scoutName ? ' active' : '';
                return `<button class="scout-picker-button scout-color-${index % 8}${active}" type="button" data-reschedule-scout-pick="${escapeAttribute(scoutName)}">
                  <span>${escapeHtml(shortScoutName(scoutName))}</span>
                  <small>${scout.visibleSlots.length} slots</small>
                </button>`;
              }).join('')
            : '<button class="modal-button secondary" type="button" disabled>No scouts loaded</button>'
        }
      </div>
      <div class="modal-actions">
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeScoutPickerModal();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeScoutPickerModal);
  modal.querySelectorAll('[data-reschedule-scout-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      state.rescheduleDrawer.scoutName = button.getAttribute('data-reschedule-scout-pick') || '';
      closeScoutPickerModal();
      closeRescheduleDrawer();
      renderRescheduleDrawer();
      setStatus('Scout loaded');
    });
  });
  document.body.appendChild(modal);
  modal.querySelector('[data-reschedule-scout-pick]')?.focus();
}

async function submitSelectedReschedule(modal) {
  const event = state.rescheduleDrawer.event;
  const select = modal.querySelector('[data-reschedule-slot]');
  const slot = decodeRescheduleEvent(select?.value || '');
  if (!event || !slot?.open_event_id || !slot?.assigned_to || !slot?.start_time) {
    setStatus('Select slot');
    return;
  }
  const submitButton = modal.querySelector('[data-submit-reschedule]');
  submitButton.disabled = true;
  setStatus('Saving');
  try {
    const response = await fetch('/api/prospect-mobile/reschedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        athlete_id: event.athlete_id,
        athlete_main_id: event.athlete_main_id,
        athlete_name: event.athlete_name,
        previous_appointment_id: event.appointment_id,
        previous_meeting_title: event.previous_meeting_title,
        previous_meeting_text: event.previous_meeting_text,
        meeting_timezone: event.meeting_timezone || 'America/New_York',
        meeting_timezone_label: event.meeting_timezone_label || '',
        open_event_id: slot.open_event_id,
        assigned_to: slot.assigned_to,
        start_time: slot.start_time,
        head_scout_name: slot.head_scout_name || state.rescheduleDrawer.scoutName,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    closeRescheduleDrawer();
    state.rescheduleQueue.events = state.rescheduleQueue.events.filter(
      (row) => String(row.appointment_id || '') !== String(event.appointment_id || ''),
    );
    await renderSetMeetings(state.setMeetingsPayload, currentRenderContext('/set-meetings'));
    setStatus('Rescheduled');
  } catch (error) {
    submitButton.disabled = false;
    setStatus(`Save failed: ${error.message || error}`);
  }
}

function closeRescheduleDrawer() {
  document.querySelector('[data-reschedule-drawer]')?.remove();
  document.body.classList.remove('modal-open');
}

function showLoadingModal(message = 'Loading') {
  closeLoadingModal();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop loading-backdrop';
  modal.setAttribute('data-loading-modal', '');
  modal.innerHTML = `
    <section class="modal-panel loading-panel" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <strong>${escapeHtml(message)}</strong>
    </section>
  `;
  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
}

function closeLoadingModal() {
  document.querySelector('[data-loading-modal]')?.remove();
}

function shortScoutName(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
}

function closeScheduleActionsModal() {
  document.querySelector('[data-schedule-actions-modal]')?.remove();
  document.body.classList.remove('modal-open');
}

function closeScoutPickerModal() {
  document.querySelector('[data-scout-picker-modal]')?.remove();
  document.body.classList.remove('modal-open');
}

function bindContactSearch(scope) {
  document.querySelector(`[data-contact-search-form="${scope}"]`)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const query = String(new FormData(form).get('query') || '').trim();
    await runContactSearchQuery(query, scope);
  });

  document.querySelector('[data-schedule-search-cancel]')?.addEventListener('click', async () => {
    state.scheduleSearch.active = false;
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

function bindScheduleSlotSelection() {
  document.querySelectorAll('[data-slot-select]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.getAttribute('data-slot-key') || '';
      if (!key) return;
      const selected = new Set(state.scheduleSlotSelection.selectedKeys);
      if (input.checked) selected.add(key);
      else selected.delete(key);
      state.scheduleSlotSelection.selectedKeys = Array.from(selected);
      updateSelectedSlotsUi();
    });
  });

  document.querySelector('[data-confirm-selected-slots]')?.addEventListener('click', async () => {
    const selectedCopies = Array.from(document.querySelectorAll('[data-slot-select]:checked'))
      .map((input) => input.getAttribute('data-slot-copy') || '')
      .filter(Boolean);
    if (!selectedCopies.length) {
      setStatus('Select slots');
      return;
    }
    const copied = await writeClipboardText(selectedCopies.join('\n'));
    if (!copied) {
      setStatus('Copy failed');
      return;
    }
    state.scheduleSlotSelection.active = false;
    state.scheduleSlotSelection.selectedKeys = [];
    setStatus('Slots copied');
    window.location.href = ADD_CLIPJAR_SHORTCUT_URL;
  });
}

function updateSelectedSlotsUi() {
  const count = state.scheduleSlotSelection.selectedKeys.length;
  const stopButton = document.querySelector('[data-stop-slot-selection]');
  if (stopButton) stopButton.textContent = `Selecting ${count}`;
  const confirmButton = document.querySelector('[data-confirm-selected-slots]');
  if (confirmButton) confirmButton.textContent = `Confirm Slots${count ? ` (${count})` : ''}`;
}

async function runContactSearchQuery(query, scope, options = {}) {
  const trimmedQuery = String(query || '').trim();
  if (scope === 'schedule') {
    state.scheduleSearch.query = trimmedQuery;
    state.scheduleSearch.selectedId = '';
  } else {
    state.contactSearch.query = trimmedQuery;
    state.contactSearch.selectedId = '';
  }
  if (!trimmedQuery) {
    if (scope === 'schedule') state.scheduleSearch.results = [];
    else state.contactSearch.results = [];
    await rerenderSearchScope(scope);
    return;
  }

  setStatus('Searching');
  const results = scope === 'schedule'
    ? groupContactSearchRows(await searchAthleteContactCache(trimmedQuery), trimmedQuery)
    : await searchProspectMobile(trimmedQuery);
  if (scope === 'schedule') {
    state.scheduleSearch.results = results;
    if (options.autoSelectSingle && results.length === 1) state.scheduleSearch.selectedId = results[0].id;
  } else {
    state.contactSearch.results = results;
    if (options.autoSelectSingle && results.length === 1) state.contactSearch.selectedId = results[0].id;
    history.replaceState({}, '', `/prospect-mobile/contact-search?q=${encodeURIComponent(trimmedQuery)}`);
  }
  await rerenderSearchScope(scope);
  setStatus(`${results.length} found`);
}

async function rerenderSearchScope(scope) {
  if (scope === 'schedule') {
    await renderScoutSchedules(undefined, currentRenderContext('/scout-schedules'));
    return;
  }
  await renderContactSearch(undefined, currentRenderContext('/contact-search'));
}

async function searchAthleteContactCache(query) {
  const response = await fetch('/api/prospect-mobile/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Search ${response.status}`);
  }
  return Array.isArray(payload.rows) ? payload.rows : [];
}

async function searchProspectMobile(query) {
  const response = await fetch('/api/prospect-mobile/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Search ${response.status}`);
  }
  if (payload.mode === 'contact_cache') {
    return groupContactSearchRows(Array.isArray(payload.rows) ? payload.rows : [], query);
  }
  return groupRawProspectRows(Array.isArray(payload.results) ? payload.results : []);
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
      sourceLabel: 'Cache',
    };
  });
}

function groupRawProspectRows(rows) {
  return rows
    .map((row, index) => {
      const athleteId = String(row.athlete_id || '').trim();
      const athleteMainId = String(row.athlete_main_id || '').trim();
      if (!athleteId) return null;
      const contacts = buildRawProspectContacts(row);
      const subtitle = [
        row.grad_year ? `Class of ${row.grad_year}` : '',
        row.sport || '',
        row.high_school || '',
      ]
        .filter(Boolean)
        .join(' - ');
      return {
        id: `raw:${athleteId}:${athleteMainId || index}`,
        athleteName: row.name || `Athlete ${athleteId}`,
        athleteId,
        athleteMainId,
        title: row.name || `Athlete ${athleteId}`,
        subtitle: subtitle || row.parent_name || row.email || 'Prospect Search',
        adminUrl: buildAthleteAdminUrl(athleteId, athleteMainId),
        profileUrl: row.url || `https://legacy-dashboard.example.com/athlete/profile/${encodeURIComponent(athleteId)}`,
        matchKind: 'raw',
        sourceLabel: 'Prospect',
        contacts,
      };
    })
    .filter(Boolean);
}

function buildRawProspectContacts(row) {
  const contacts = [];
  const athleteName = row.name || 'Student Athlete';
  if (row.phone || row.email) {
    contacts.push({
      name: athleteName,
      relationship: 'Student Athlete',
      phone: row.phone || '',
      email: row.email || '',
    });
  }
  if (row.parent_name || row.parent_phone || row.parent_email) {
    contacts.push({
      name: row.parent_name || 'Parent',
      relationship: 'Parent',
      phone: row.parent_phone || '',
      email: row.parent_email || '',
    });
  }
  if (!contacts.length) {
    contacts.push({
      name: athleteName,
      relationship: 'Prospect',
      phone: '',
      email: '',
    });
  }
  return contacts;
}

function buildAthleteAdminUrl(athleteId, athleteMainId) {
  const id = String(athleteId || '').trim();
  if (!id) return '';
  const params = new URLSearchParams({ contactid: id });
  const mainId = String(athleteMainId || '').trim();
  if (mainId) params.set('athlete_main_id', mainId);
  return `https://legacy-dashboard.example.com/admin/athletes?${params.toString()}`;
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
  if (/\b(pst|pacific|pt)\b/.test(key)) return 'America/Los_Angeles';
  return '';
}

function timezoneAbbreviation(timezone, timezoneLabel) {
  const key = normalizeSearchText(`${timezone || ''} ${timezoneLabel || ''}`);
  if (key.includes('america/chicago') || /\b(cst|central|ct)\b/.test(key)) return 'CT';
  if (key.includes('america/denver') || /\b(mst|mountain|mt)\b/.test(key)) return 'MT';
  if (key.includes('america/los_angeles') || key.includes('america/los angeles') || /\b(pst|pacific|pt)\b/.test(key)) return 'PT';
  return 'ET';
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
  if (key.includes('america/los_angeles') || key.includes('america/los angeles') || /\b(pst|pacific|pt)\b/.test(key)) return 'PT';
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
      const copied = await writeClipboardText(button.getAttribute('data-copy') || '');
      setStatus(copied ? 'Copied' : 'Copy failed');
    });
  });
}

async function writeClipboardText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
}

function bindScriptableContactButtons() {
  document.querySelectorAll('[data-scriptable-url][data-contact-clipboard]').forEach((button) => {
    button.addEventListener('click', async () => {
      const clipboardText = button.getAttribute('data-contact-clipboard') || '';
      const scriptableUrl = button.getAttribute('data-scriptable-url') || '';
      if (!scriptableUrl) return;
      const copied = await writeClipboardText(clipboardText);
      if (!copied) {
        setStatus('Clipboard failed');
        return;
      }
      setStatus('Contact selected');
      window.location.href = scriptableUrl;
    });
  });
}

function bindSmsButtons() {
  document.querySelectorAll('[data-sms-body]').forEach((button) => {
    button.addEventListener('click', async () => {
      const body = button.getAttribute('data-sms-body') || '';
      const phone = normalizePhoneForSms(button.getAttribute('data-sms-phone') || '');
      const prefixSaved = await updateConfirmationPrefixFromButton(button);
      if (!prefixSaved) return;
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
  if (!eventId || !eventDate || !prefix) return true;

  return updateMeetingPrefix({ eventId, eventDate, prefix });
}

function bindConfirmationModalButtons() {
  document.querySelectorAll('[data-confirmation-modal]').forEach((button) => {
    button.addEventListener('click', () => showConfirmationModal(button));
  });
}

function bindContactCopyModalButtons() {
  document.querySelectorAll('[data-contact-copy-modal]').forEach((button) => {
    button.addEventListener('click', () => showContactCopyModal(button));
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
      const prefixSaved = await updateConfirmationPrefixFromButton(smsButton);
      if (!prefixSaved) return;
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

function showContactCopyModal(button) {
  closeContactCopyModal();

  const athleteName = button.getAttribute('data-athlete-name') || 'Meeting';
  const headScout = button.getAttribute('data-head-scout') || '';
  const contacts = parseRecipientContacts(button.getAttribute('data-recipient-contacts') || '[]');

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.setAttribute('data-contact-copy-action-modal', '');
  modal.innerHTML = `
    <section class="modal-panel" role="dialog" aria-modal="true" aria-label="Contact number options">
      <div class="modal-header">
        <h2 class="modal-title">${escapeHtml(athleteName)}</h2>
        <p class="modal-subtitle">${escapeHtml(headScout)}</p>
      </div>
      <div class="modal-actions">
        ${
          contacts.length
            ? contacts.map((contact) => {
                const label = contact.relationship || contact.name || 'Contact';
                const formattedPhone = formatPhoneLabel(contact.phone);
                const copyValue = formattedPhone || contact.phone;
                return `<button class="modal-button" type="button" data-contact-phone-copy="${escapeAttribute(copyValue)}">${escapeHtml(label)} - ${escapeHtml(copyValue)}</button>`;
              }).join('')
            : '<button class="modal-button secondary" type="button" disabled>No cached contacts</button>'
        }
        <button class="modal-button secondary" type="button" data-modal-close>Close</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeContactCopyModal();
  });
  modal.querySelector('[data-modal-close]')?.addEventListener('click', closeContactCopyModal);
  modal.querySelectorAll('[data-contact-phone-copy]').forEach((copyButton) => {
    copyButton.addEventListener('click', async () => {
      await copyContactPhoneFromModal(copyButton);
    });
  });

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  modal.querySelector('[data-contact-phone-copy]')?.focus();
}

function parseRecipientContacts(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((contact) => ({
        name: String(contact?.name || '').trim(),
        relationship: String(contact?.relationship || '').trim(),
        phone: String(contact?.phone || '').trim(),
      }))
      .filter((contact) => contact.phone);
  } catch {
    return [];
  }
}

async function copyContactPhoneFromModal(button) {
  const phone = button.getAttribute('data-contact-phone-copy') || '';
  if (!phone) return;
  const copied = await writeClipboardText(phone);
  closeContactCopyModal();
  setStatus(copied ? 'Copied' : 'Copy failed');
}

function showAdminModal(button) {
  closeAdminModal();

  const eventId = button.getAttribute('data-event-id') || '';
  const eventDate = button.getAttribute('data-event-date') || '';
  const adminUrl = button.getAttribute('data-admin-url') || '';
  const athleteId = button.getAttribute('data-athlete-id') || '';
  const athleteMainId = button.getAttribute('data-athlete-main-id') || '';
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
      <div class="field">
        <label for="post-meeting-reason">RSP/CAN Note</label>
        <textarea id="post-meeting-reason" data-post-meeting-reason placeholder="Why they need follow-up"></textarea>
      </div>
      <div class="modal-actions">
        <button class="modal-button success" type="button" data-prefix-action="(CF)">Set (CF)</button>
        <button class="modal-button warning" type="button" data-prefix-action="(RSP)">Set (RSP)</button>
        <button class="modal-button danger" type="button" data-prefix-action="(CAN)">Set (CAN)</button>
        ${
          adminUrl
            ? `<a class="modal-button admin-modal-button" href="${escapeAttribute(adminUrl)}" target="_blank" rel="noreferrer">Open Admin</a>`
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
      const noteDescription = modal.querySelector('[data-post-meeting-reason]')?.value?.trim() || '';
      if ((prefix === '(RSP)' || prefix === '(CAN)') && !noteDescription) {
        setStatus(prefix === '(RSP)' ? 'Add reschedule reason' : 'Add cancel reason');
        modal.querySelector('[data-post-meeting-reason]')?.focus();
        return;
      }
      prefixButton.disabled = true;
      if (prefix === '(RSP)' || prefix === '(CAN)') {
        const saved = await updatePostMeetingOutcome({
          eventId,
          eventDate,
          prefix,
          athleteId,
          athleteMainId,
          operatorNoteDescription: noteDescription,
        });
        if (!saved) {
          prefixButton.disabled = false;
          return;
        }
      } else {
        const saved = await updateMeetingPrefix({ eventId, eventDate, prefix });
        if (!saved) {
          prefixButton.disabled = false;
          return;
        }
      }
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

function closeContactCopyModal() {
  document.querySelector('[data-contact-copy-action-modal]')?.remove();
  document.body.classList.remove('modal-open');
}

function bindSearchRescheduleButtons() {
  document.querySelectorAll('[data-search-reschedule-athlete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const athleteId = button.getAttribute('data-search-reschedule-athlete-id') || '';
      const athleteMainId = button.getAttribute('data-search-reschedule-athlete-main-id') || '';
      if (!athleteId) {
        setStatus('Missing athlete');
        return;
      }
      setStatus('Checking RSP');
      try {
        const queue = await fetchRecentRescheduleQueue({ athleteId, athleteMainId });
        const event = queue.events[0];
        if (!event) {
          setStatus('No recent RSP');
          return;
        }
        await showRescheduleDrawer(event);
      } catch (error) {
        setStatus(`RSP failed: ${error.message || error}`);
      }
    });
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeScheduleActionsModal();
    closeScoutPickerModal();
    closeAdminModal();
    closeConfirmationModal();
    closeContactCopyModal();
    closeRescheduleDrawer();
  }
});

async function updateMeetingPrefix({ eventId, eventDate, prefix }) {
  if (!eventId || !eventDate || !prefix) return false;

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
    return true;
  } catch (error) {
    setStatus(`Prefix failed: ${error.message || error}`);
    return false;
  }
}

async function updatePostMeetingOutcome({
  eventId,
  eventDate,
  prefix,
  athleteId,
  athleteMainId,
  operatorNoteDescription,
}) {
  if (!eventId || !eventDate || !prefix || !athleteId || !athleteMainId || !operatorNoteDescription) {
    setStatus('Missing outcome fields');
    return false;
  }

  try {
    const response = await fetch('/api/post-meeting-outcome', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        event_date: eventDate,
        prefix,
        athlete_id: athleteId,
        athlete_main_id: athleteMainId,
        operator_note_description: operatorNoteDescription,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    setStatus(prefix === '(RSP)' ? 'RSP saved' : 'CAN saved');
    return true;
  } catch (error) {
    setStatus(`Outcome failed: ${error.message || error}`);
    return false;
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
    state.scheduleScoutSearch.active = false;
    state.scheduleScoutSearch.query = '';
    state.scheduleScoutSearch.selectedName = '';
    state.scheduleSlotSelection.active = false;
    state.scheduleSlotSelection.selectedKeys = [];
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
  const text = String(message || '');
  if (shouldShowToast(text)) {
    statusLine.textContent = '';
    statusLine.className = 'status-line';
    showToast(text);
    return;
  }
  const status = buildStatusDisplay(text);
  statusLine.className = `status-line ${status.className}`.trim();
  statusLine.innerHTML = status.html;
}

function buildStatusDisplay(message) {
  const text = String(message || '').trim();
  if (!text) return { className: '', html: '' };
  let className = 'status-idle';
  let label = text;
  if (/^(Refreshing|Searching)$/.test(text)) {
    className = 'status-loading';
  } else if (/^Could not refresh/.test(text)) {
    className = 'status-error';
  } else if (/^Updated\s+/.test(text)) {
    className = 'status-idle';
    label = text.replace(/^Updated\s+/, '');
  } else if (/^Cached\s+/.test(text) || /^\d+ found$/.test(text)) {
    className = 'status-idle';
  }
  return {
    className,
    html: `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`,
  };
}

function shouldShowToast(message) {
  if (!message) return false;
  if (/^(Updated|Cached|Refreshing|Searching|Could not refresh|\d+ found)/.test(message)) return false;
  return message.length <= 36;
}

function showToast(message) {
  let toast = document.querySelector('[data-mobile-toast]');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'mobile-toast';
    toast.setAttribute('data-mobile-toast', '');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.classList.toggle('error', /failed|missing|could not|couldn/i.test(message));
  toast.innerHTML = '<span class="mobile-toast-dot" aria-hidden="true"></span><span data-mobile-toast-message></span>';
  toast.querySelector('[data-mobile-toast-message]').textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 1450);
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

function getInitialRoute() {
  const route = toWorkflowPath(window.location.pathname);
  if (routes[route]) return route;
  const params = new URLSearchParams(window.location.search);
  return params.get('q') || params.get('phone') ? '/contact-search' : '/set-meetings';
}

function applyStartupSearchParams() {
  const params = new URLSearchParams(window.location.search);
  const query = String(params.get('q') || params.get('phone') || '').trim();
  if (!query) return '';
  state.contactSearch.query = query;
  state.contactSearch.selectedId = '';
  return query;
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

function formatSlotCopyLabel(start) {
  const date = parseEasternLocal(start);
  if (!date) return 'Unknown time';
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${dateLabel} at ${timeLabel} ET`;
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
  return `${formatter.format(startDate)} - ${formatter.format(endDate)} ${naturalTimezoneLabel(timezone, timezoneLabel)}`;
}

function formatSlotCopyLabelForTimezone(start, timezone, timezoneLabel) {
  const date = parseEasternSlotInstant(start);
  if (!date) return formatSlotCopyLabel(start);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${dateLabel} at ${timeLabel} ${timezoneLabelForCopy(timezoneLabel)}`;
}

function timezoneLabelForCopy(value) {
  return naturalTimezoneLabel('', value);
}

function naturalTimezoneLabel(timezone, timezoneLabel) {
  const key = normalizeSearchText(`${timezone || ''} ${timezoneLabel || ''}`);
  if (key.includes('america/chicago') || /\bcentral\b|\bct\b|\bcst\b/.test(key)) return 'CT';
  if (key.includes('america/denver') || /\bmountain\b|\bmt\b|\bmst\b/.test(key)) return 'MT';
  if (key.includes('america/los_angeles') || key.includes('america/los angeles') || /\bpacific\b|\bpt\b|\bpst\b/.test(key)) return 'PT';
  return 'ET';
}

function legacyTimezoneLabelForCopy(value) {
  const key = normalizeSearchText(value);
  if (/\bcentral\b|\bct\b|\bcst\b/.test(key)) return 'CT';
  if (/\bmountain\b|\bmt\b|\bmst\b/.test(key)) return 'MT';
  if (/\bpacific\b|\bpt\b|\bpst\b/.test(key)) return 'PT';
  return 'ET';
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

function formatRelativeDate(value) {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.getTime())) return '';
  const ageMs = Date.now() - parsed.getTime();
  const ageHours = Math.max(0, Math.floor(ageMs / 36e5));
  if (ageHours < 1) return 'Now';
  if (ageHours < 24) return `${ageHours}h`;
  return `${Math.floor(ageHours / 24)}d`;
}

function encodeRescheduleEvent(value) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(value || {}))));
  } catch {
    return '';
  }
}

function decodeRescheduleEvent(value) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(String(value || '')))));
  } catch {
    return null;
  }
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
