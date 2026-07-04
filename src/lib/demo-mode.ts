import { Response } from 'node-fetch';
import type { RequestInit } from 'node-fetch';

const FAKE_PHONE = '5555555555';
const FAKE_SCOUTS = ['Scout Riley', 'Scout Morgan', 'Scout Avery', 'Scout Jordan'];
const SPORTS = ['Football', 'Basketball', 'Baseball', 'Softball'];
const POSITIONS = ['WR', 'QB-D', 'CB', 'PG', 'RHP', 'SS', 'DE', 'OLB'];
const STAGES = ['Meeting Set', 'Call Attempt 2', 'Call Attempt 3', 'Reschedule Pending'];
const VIDEO_STATUSES = ['HUDL', 'Dropbox', 'Revisions', 'Not Approved', 'External Links'];

export function isDemoMode(): boolean {
  return process.env.PROSPECT_PIPELINE_LIVE_MODE !== '1';
}

export function demoPhone(): string {
  return FAKE_PHONE;
}

function nowBase(): Date {
  const now = new Date();
  if (Number.isNaN(now.getTime())) return new Date('2026-07-06T14:00:00.000Z');
  return now;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localSlot(date: Date, hour: number, minute = 0): string {
  return `${isoDate(date)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function id(index: number, base = 900000): string {
  return String(base + index);
}

function mainId(index: number): string {
  return String(800000 + index);
}

function pad(index: number): string {
  return String(index).padStart(3, '0');
}

export function fakeAthleteName(index = 1): string {
  return `Fake Athlete ${pad(index)}`;
}

function fakeParentName(index: number, parentIndex: 1 | 2): string {
  return `Fake Parent ${pad(index)}-${parentIndex}`;
}

function fakeEmail(prefix: string, index: number): string {
  return `${prefix}${pad(index)}@example.com`;
}

function athleteIndexFromValue(value?: string | number | null): number {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 1;
  return (Number.parseInt(digits.slice(-3), 10) % 24) + 1;
}

function fakeTask(index: number) {
  const due = addDays(nowBase(), index % 8);
  const athleteId = id(index);
  const athleteMainId = mainId(index);
  const sport = SPORTS[index % SPORTS.length];
  return {
    task_id: `task-${pad(index)}`,
    contact_id: athleteId,
    athlete_id: athleteId,
    athlete_main_id: athleteMainId,
    athlete_name: fakeAthleteName(index),
    sport,
    high_school: `Fake Prep ${pad(index)}`,
    city: 'Bradenton',
    state: 'FL',
    due_date: due.toISOString(),
    completion_date: null,
    assigned_owner: 'Primary Operator',
    grad_year: String(2026 + (index % 5)),
    title: STAGES[index % STAGES.length],
    description: `Call notes for ${fakeAthleteName(index)}. Parent asked for practical next steps and available meeting times.`,
    athlete_admin_url: `https://demo.prospect-pipeline.local/admin/athletes?contactid=${athleteId}`,
    athlete_profile_url: `https://demo.prospect-pipeline.local/athlete/profile/${athleteId}`,
    athlete_task_url: `https://demo.prospect-pipeline.local/admin/tasks/${id(index, 700000)}`,
  };
}

function fakeVideoTask(index: number) {
  const due = addDays(nowBase(), index % 12);
  return {
    id: 500000 + index,
    athlete_id: Number(id(index)),
    athlete_main_id: mainId(index),
    athletename: fakeAthleteName(index),
    video_progress_status: VIDEO_STATUSES[index % VIDEO_STATUSES.length],
    stage: index % 6 === 0 ? 'Awaiting Client' : index % 5 === 0 ? 'On Hold' : 'In Queue',
    sport_name: SPORTS[index % SPORTS.length],
    sport_alias: SPORTS[index % SPORTS.length].toLowerCase(),
    grad_year: 2026 + (index % 5),
    video_due_date: due.toISOString(),
    assignedvideoeditor: 'Primary Operator',
    primaryposition: POSITIONS[index % POSITIONS.length],
    secondaryposition: POSITIONS[(index + 2) % POSITIONS.length],
    thirdposition: 'NA',
    high_school: `Fake Prep ${pad(index)}`,
    high_school_city: 'Bradenton',
    high_school_state: 'FL',
    updated_at: nowBase().toISOString(),
    cached_at: nowBase().toISOString(),
    source: 'server',
    jersey_number: String((index % 98) + 1),
    paid_status: 'Paid',
  };
}

function fakeContactInfo(index: number) {
  return {
    contactId: id(index),
    studentAthlete: {
      name: fakeAthleteName(index),
      email: fakeEmail('athlete', index),
      phone: FAKE_PHONE,
    },
    parent1: {
      name: fakeParentName(index, 1),
      relationship: 'Parent 1',
      email: fakeEmail('parent1.', index),
      phone: FAKE_PHONE,
    },
    parent2: {
      name: fakeParentName(index, 2),
      relationship: 'Parent 2',
      email: fakeEmail('parent2.', index),
      phone: FAKE_PHONE,
    },
  };
}

function fakeSalesOptions() {
  return [
    { value: 'Meeting Set', label: 'Meeting Set', selected: true },
    { value: 'Rescheduled', label: 'Rescheduled', selected: false },
    { value: 'Follow Up', label: 'Follow Up', selected: false },
    { value: 'No Show', label: 'No Show', selected: false },
    { value: 'Close Won', label: 'Close Won', selected: false },
    { value: 'Close Lost', label: 'Close Lost', selected: false },
  ];
}

function fakeBookedEvent(index: number) {
  const startDay = addDays(nowBase(), index + 1);
  const start = localSlot(startDay, 18 + (index % 3), index % 2 ? 30 : 0);
  const end = localSlot(startDay, 19 + (index % 3), index % 2 ? 30 : 0);
  const scout = FAKE_SCOUTS[index % FAKE_SCOUTS.length];
  const athleteName = fakeAthleteName(index);
  return {
    event_id: `fake-event-${pad(index)}`,
    athlete_id: id(index),
    athlete_main_id: mainId(index),
    athlete_name: athleteName,
    title: `${athleteName} Football ${2026 + (index % 5)} FL`,
    assigned_owner: scout,
    start,
    end,
    date_time_label: `${start.replace('T', ' ')} EST`,
    description: `Meeting with ${athleteName}. Parent phone: ${FAKE_PHONE}.`,
  };
}

function fakeHeadScoutSlots() {
  const start = addDays(nowBase(), 1);
  return FAKE_SCOUTS.map((scout, scoutIndex) => ({
    scout_name: scout,
    city: 'Bradenton',
    state: 'FL',
    calendar_owner_id: `calendar_owner_${scoutIndex + 1}`,
    meeting_for: `head_scout_${scoutIndex + 1}`,
    slot_count: 3,
    slots: [0, 1, 2].map((slotIndex) => {
      const day = addDays(start, scoutIndex + slotIndex);
      return {
        id: `fake-slot-${scoutIndex + 1}-${slotIndex + 1}`,
        start: localSlot(day, 17 + slotIndex),
        end: localSlot(day, 18 + slotIndex),
        scout_name: scout,
      };
    }),
  }));
}

function fakeConfirmationRows() {
  return [1, 2, 3, 4].map((index) => {
    const event = fakeBookedEvent(index);
    return {
      id: `confirmation-${index}`,
      appointment_id: event.event_id,
      kind: index % 2 ? 'confirmation_1' : 'confirmation_2',
      status: 'pending',
      athlete_key: `${event.athlete_id}:${event.athlete_main_id}`,
      athlete_id: String(event.athlete_id),
      athlete_main_id: String(event.athlete_main_id),
      athlete_name: event.athlete_name,
      recipient_name: fakeParentName(index, 1),
      recipient_phone: FAKE_PHONE,
      head_scout_name: event.assigned_owner,
      meeting_starts_at: new Date(event.start).toISOString(),
      meeting_duration_minutes: 60,
      meeting_ends_at: new Date(event.end).toISOString(),
      meeting_timezone: 'America/New_York',
      message_body: `Hi ${fakeParentName(index, 1)}, confirming ${event.athlete_name}'s meeting with ${event.assigned_owner}.`,
      admin_url: `https://demo.prospect-pipeline.local/admin/athletes?contactid=${event.athlete_id}`,
      task_url: `https://demo.prospect-pipeline.local/admin/tasks/${id(index, 700000)}`,
      source: 'raycast',
      generated_at: nowBase().toISOString(),
      created_at: nowBase().toISOString(),
      updated_at: nowBase().toISOString(),
      payload_json: {},
    };
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseBody(options?: RequestInit): Record<string, unknown> {
  const body = options?.body;
  if (!body || typeof body !== 'string') return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getDemoApiResponse(endpoint: string, options?: RequestInit): Response | null {
  if (!isDemoMode()) return null;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const body = parseBody(options);

  if (path === '/auth-status') {
    return jsonResponse({
      status: 'ok',
      session_file: { path: '<session>', exists: true, size_bytes: 1 },
      shared_session: {
        cookies_loaded: true,
        cookie_count: 1,
        cookie_names: [],
        csrf_token_present: true,
        probe: { auth_valid: true },
      },
      video_progress_session: {
        cookies_loaded: true,
        cookie_count: 1,
        cookie_names: [],
        csrf_token_present: true,
        form_token_present: true,
        probe: { auth_valid: true },
      },
      summary: {
        cookies_present: true,
        shared_session_valid: true,
        video_progress_session_valid: true,
        likely_disconnected: false,
      },
    });
  }

  if (path === '/openapi.json') return jsonResponse({ paths: { '/api/v1/scout/tasks': {} } });
  if (path.startsWith('/scout/tasks'))
    return jsonResponse({ tasks: Array.from({ length: 18 }, (_, i) => fakeTask(i + 1)) });
  if (path === '/scout/recent-profiles')
    return jsonResponse({
      profiles: Array.from({ length: 8 }, (_, i) => ({
        athlete_id: id(i + 1),
        athlete_main_id: mainId(i + 1),
        athlete_name: fakeAthleteName(i + 1),
        grad_year: String(2026 + (i % 5)),
        sport: SPORTS[i % SPORTS.length],
        state: 'FL',
        parent_names: [fakeParentName(i + 1, 1)],
      })),
    });
  if (path === '/tasks/list')
    return jsonResponse({ tasks: [fakeTask(1), fakeTask(2), fakeTask(3)] });
  if (path.startsWith('/tasks/'))
    return jsonResponse({
      success: true,
      status_code: 200,
      task: fakeTask(1),
      task_id: 'task-001',
    });
  if (path.startsWith('/athlete/') && path.endsWith('/scout-prep-resolve')) {
    const index = athleteIndexFromValue(path);
    return jsonResponse({
      athlete_id: id(index),
      athlete_main_id: mainId(index),
      name: fakeAthleteName(index),
      grad_year: String(2026 + (index % 5)),
      high_school: `Fake Prep ${pad(index)}`,
      city: 'Bradenton',
      state: 'FL',
      positions: 'WR | CB',
      sport: 'Football',
      gpa: '3.7',
      head_scout: FAKE_SCOUTS[index % FAKE_SCOUTS.length],
      scouting_coordinator: 'Primary Operator',
    });
  }
  if (path.startsWith('/athlete/') && path.endsWith('/measurables')) {
    return jsonResponse({ height: `6'1"`, weight: '185' });
  }
  if (path.startsWith('/athlete/') && path.endsWith('/name'))
    return jsonResponse({ name: fakeAthleteName(athleteIndexFromValue(path)) });
  if (path.startsWith('/athlete/') && path.includes('/resolve')) {
    const index = athleteIndexFromValue(path);
    return jsonResponse({
      athlete_id: id(index),
      athlete_main_id: mainId(index),
      name: fakeAthleteName(index),
      grad_year: String(2026 + (index % 5)),
      sport: 'Football',
      high_school: `Fake Prep ${pad(index)}`,
      city: 'Bradenton',
      state: 'FL',
      positions: 'WR | CB',
      jersey_number: String(index + 1),
    });
  }
  if (path === '/athlete/raw-search')
    return jsonResponse({
      success: true,
      count: 8,
      results: Array.from({ length: 8 }, (_, i) => ({
        athlete_id: id(i + 1),
        athlete_main_id: mainId(i + 1),
        name: fakeAthleteName(i + 1),
        grad_year: String(2026 + (i % 5)),
        sport: SPORTS[i % SPORTS.length],
        state: 'FL',
        city: 'Bradenton',
        high_school: `Fake Prep ${pad(i + 1)}`,
        email: fakeEmail('athlete', i + 1),
        phone: FAKE_PHONE,
        parent_name: fakeParentName(i + 1, 1),
        parent_email: fakeEmail('parent1.', i + 1),
        parent_phone: FAKE_PHONE,
        positions: 'WR | CB',
        source: 'recent',
      })),
    });
  if (path.startsWith('/contacts/') && path.includes('/enriched'))
    return jsonResponse(fakeContactInfo(athleteIndexFromValue(path)));
  if (path === '/notes/list')
    return jsonResponse({
      notes: [
        {
          title: 'Call Prep',
          description: 'Parent wants clear next steps and available meeting times.',
          created_by: 'Primary Operator',
          created_at: nowBase().toISOString(),
        },
      ],
    });
  if (path === '/notes/add') return jsonResponse({ success: true, status_code: 200 });

  if (path.startsWith('/sales/stages/'))
    return jsonResponse({
      success: true,
      count: fakeSalesOptions().length,
      selected_value: 'Meeting Set',
      selected_label: 'Meeting Set',
      options: fakeSalesOptions(),
    });
  if (
    path.startsWith('/sales/meeting-set-template') ||
    path.startsWith('/sales/reschedule-meeting-template')
  )
    return jsonResponse({
      success: true,
      meeting_name: `${fakeAthleteName(1)} Football 2027 FL`,
      selected_recruit_timezone: 'EST',
      recruit_timezone_options: [
        { value: 'EST', label: 'EST', selected: true },
        { value: 'CST', label: 'CST', selected: false },
        { value: 'PST', label: 'PST', selected: false },
      ],
      details_template: 'Intro call with [Athlete] and family. Review fit, goals, and next steps.',
    });
  if (path === '/sales/stage')
    return jsonResponse({
      success: true,
      stage: String(body.stage || 'Meeting Set'),
      athlete_id: String(body.athlete_id || id(1)),
      athlete_main_id: String(body.athlete_main_id || mainId(1)),
      status_code: 200,
      tasks_count: 1,
      created_task: fakeTask(1),
    });
  if (path === '/sales/meeting-set' || path === '/sales/reschedule-meeting')
    return jsonResponse({
      success: true,
      athlete_id: String(body.athlete_id || id(1)),
      athlete_main_id: String(body.athlete_main_id || mainId(1)),
      assigned_to: String(body.assigned_to || FAKE_SCOUTS[0]),
      open_event_id: String(body.open_event_id || 'fake-slot-1-1'),
      meeting_name: String(body.meeting_name || `${fakeAthleteName(1)} Football 2027 FL`),
      template_id: String(body.template_id || '210'),
      status_code: 200,
      email_sent: true,
      created_task: fakeTask(1),
    });

  if (path.startsWith('/calendar/head-scout-slots'))
    return jsonResponse({
      success: true,
      week_start: isoDate(nowBase()),
      week_end: isoDate(addDays(nowBase(), 7)),
      timezone_label: 'EST',
      scouts: fakeHeadScoutSlots(),
    });
  if (path.startsWith('/calendar/open-meetings'))
    return jsonResponse({
      success: true,
      meeting_for: 'head_scout_1',
      count: 6,
      slots: fakeHeadScoutSlots()
        .flatMap((scout) => scout.slots)
        .slice(0, 6)
        .map((slot) => ({
          open_event_id: slot.id,
          date_time_label: `${slot.start.replace('T', ' ')} EST`,
          title: `${slot.scout_name} Open Meeting`,
          assigned_owner: slot.scout_name,
          start_time: slot.start,
        })),
    });
  if (path.startsWith('/calendar/booked-meetings'))
    return jsonResponse({
      success: true,
      week_start: isoDate(nowBase()),
      week_end: isoDate(addDays(nowBase(), 7)),
      count: 8,
      events: Array.from({ length: 8 }, (_, i) => fakeBookedEvent(i + 1)),
    });
  if (path.startsWith('/calendar/athlete-booked-meetings'))
    return jsonResponse({
      success: true,
      athlete_id: id(1),
      athlete_main_id: mainId(1),
      count: 2,
      events: [fakeBookedEvent(1), fakeBookedEvent(2)],
    });
  if (path.startsWith('/calendar/booked-meeting/details'))
    return jsonResponse({
      success: true,
      event_id: 'fake-event-001',
      title: fakeBookedEvent(1).title,
      description: fakeBookedEvent(1).description,
      form_data: { contact: FAKE_PHONE, template_id: '210' },
    });
  if (path === '/calendar/booked-meeting/title')
    return jsonResponse({
      success: true,
      event_id: String(body.event_id || 'fake-event-001'),
      prefix: String(body.prefix || 'CONF'),
      original_title: fakeBookedEvent(1).title,
      updated_title: `${String(body.prefix || 'CONF')} ${fakeBookedEvent(1).title}`,
      message: 'Saved',
    });
  if (path === '/calendar/booked-meeting/description')
    return jsonResponse({
      success: true,
      event_id: String(body.event_id || 'fake-event-001'),
      original_description: fakeBookedEvent(1).description,
      updated_description: String(body.description || fakeBookedEvent(1).description),
      message: 'Saved',
    });
  if (path.startsWith('/calendar/booked-meeting'))
    return jsonResponse({
      success: true,
      calendar_owner_id: 'calendar_owner_1',
      title_query: '',
      start: isoDate(nowBase()),
      end: isoDate(addDays(nowBase(), 7)),
      count: 1,
      event: fakeBookedEvent(1),
      events: [fakeBookedEvent(1)],
    });

  if (path === '/video/progress')
    return jsonResponse({
      success: true,
      count: 24,
      tasks: Array.from({ length: 24 }, (_, i) => fakeVideoTask(i + 1)),
    });
  if (path === '/video/seasons')
    return jsonResponse({
      success: true,
      seasons: [
        { value: '2026', title: '2026 Season', season: '2026' },
        { value: '2025', title: '2025 Season', season: '2025' },
      ],
    });
  if (path.startsWith('/video/') || path === '/video/submit' || path === '/video/update')
    return jsonResponse({
      success: true,
      status_code: 200,
      message: 'Saved',
      html: '<form><input name="video_url" value="" /></form>',
    });
  if (path.startsWith('/email/templates'))
    return jsonResponse({
      templates: [
        { title: 'Editing Done', value: 'editing-done' },
        { title: 'Video Ready', value: 'video-ready' },
      ],
    });
  if (path.startsWith('/email/recipients'))
    return jsonResponse({
      recipients: {
        athlete: {
          id: 'athlete-001',
          name: fakeAthleteName(1),
          email: fakeEmail('athlete', 1),
          checked: true,
        },
        parents: [
          {
            id: 'parent-1',
            name: fakeParentName(1, 1),
            email: fakeEmail('parent1.', 1),
            checked: true,
          },
        ],
        other_email: null,
      },
    });
  if (path === '/email/template-data')
    return jsonResponse({
      sender_name: 'Primary Operator',
      sender_email: 'operator@example.com',
      subject: 'Your video update is ready',
      message: 'Hi, your video update is ready for review.',
    });
  if (path === '/email/send') return jsonResponse({ success: true, status_code: 200 });

  if (path === '/inbox/threads')
    return jsonResponse({
      threads: Array.from({ length: 8 }, (_, i) => ({
        id: `msg-${pad(i + 1)}`,
        itemCode: `item-${pad(i + 1)}`,
        thread_id: `thread-${pad(i + 1)}`,
        contact_id: id(i + 1),
        name: fakeAthleteName(i + 1),
        email: fakeEmail('parent1.', i + 1),
        subject: 'Video update question',
        content: 'Can you help with this video update?',
        preview: 'Can you help with this video update?',
        status: i % 2 ? 'assigned' : 'unassigned',
        timestamp: nowBase().toISOString(),
        timeStampDisplay: 'Today',
        timeStampIso: nowBase().toISOString(),
        is_reply_with_signature: false,
        canAssign: true,
        athleteMainId: mainId(i + 1),
        sport_alias: 'football',
        video_msg_id: String(500000 + i),
        attachments: [],
      })),
    });
  if (path === '/inbox/message')
    return jsonResponse({
      content: 'Hi, can you help with this video update?',
      latest_visible_body: 'Hi, can you help with this video update?',
      subject: 'Video update question',
      from_name: fakeParentName(1, 1),
      from_email: fakeEmail('parent1.', 1),
      message_id: 'msg-001',
      item_code: 'item-001',
      contact_id: id(1),
      athlete_main_id: mainId(1),
      attachments: [],
    });
  if (path === '/inbox/reply' || path === '/inbox/assign')
    return jsonResponse({
      success: true,
      contact_id: id(1),
      athlete_main_id: mainId(1),
      message_id: 'msg-001',
    });
  if (path === '/inbox/assignment-modal') return jsonResponse({ modal: {}, contacts: [] });
  if (path === '/inbox/contacts/search')
    return jsonResponse({
      contacts: [
        {
          contactId: id(1),
          name: fakeAthleteName(1),
          email: fakeEmail('athlete', 1),
          athleteMainId: mainId(1),
        },
      ],
    });
  if (path === '/inbox/assignment-defaults') return jsonResponse({ success: true, defaults: {} });

  return jsonResponse({ success: true, status_code: 200, message: 'Saved' });
}

export function getDemoSupabaseRows<T = Record<string, unknown>>(table: string): T[] {
  if (!isDemoMode()) return [];
  if (table === 'set_meeting_confirmation_cache') return fakeConfirmationRows() as T[];
  if (table === 'appointments')
    return Array.from({ length: 4 }, (_, i) => {
      const event = fakeBookedEvent(i + 1);
      return {
        id: event.event_id,
        athlete_key: `${event.athlete_id}:${event.athlete_main_id}`,
        athlete_id: event.athlete_id,
        athlete_main_id: event.athlete_main_id,
        athlete_name: event.athlete_name,
        starts_at: new Date(event.start).toISOString(),
        ends_at: new Date(event.end).toISOString(),
        meeting_timezone: 'America/New_York',
        head_scout_name: event.assigned_owner,
        status: 'active',
        post_meeting_result: null,
        source_payload: event,
      };
    }) as T[];
  if (table === 'athlete_contact_cache')
    return Array.from({ length: 8 }, (_, i) => ({
      athlete_key: `${id(i + 1)}:${mainId(i + 1)}`,
      athlete_id: id(i + 1),
      athlete_main_id: mainId(i + 1),
      athlete_name: fakeAthleteName(i + 1),
      contact_name: fakeParentName(i + 1, 1),
      contact_phone: FAKE_PHONE,
      contact_role: 'parent1',
      phone_lookup: FAKE_PHONE,
      lifecycle_active: true,
    })) as T[];
  if (table === 'athletes')
    return Array.from({ length: 8 }, (_, i) => ({
      athlete_key: `${id(i + 1)}:${mainId(i + 1)}`,
      athlete_id: id(i + 1),
      athlete_main_id: mainId(i + 1),
      athlete_name: fakeAthleteName(i + 1),
    })) as T[];
  if (table === 'call_log' || table === 'lifecycle_events' || table === 'pending_client_watchlist')
    return [] as T[];
  return [] as T[];
}

export const demoFixtures = {
  fakeAthleteName,
  fakeTask,
  fakeVideoTask,
  fakeContactInfo,
  fakeBookedEvent,
  fakeConfirmationRows,
};
