const BASE_NOW = new Date('2026-07-06T12:00:00-04:00');
const EASTERN_ZONE = 'America/New_York';

const firstNames = [
  'Avery', 'Mason', 'Jordan', 'Cameron', 'Riley', 'Taylor', 'Morgan', 'Parker', 'Quinn', 'Hayden',
  'Reese', 'Logan', 'Kendall', 'Casey', 'Rowan', 'Emerson', 'Micah', 'Sawyer', 'Blake', 'Dakota',
  'Jalen', 'Maya', 'Nolan', 'Amara', 'Trey', 'Keira', 'Darius', 'Lena', 'Caleb', 'Sienna',
  'Malik', 'Tessa', 'Andre', 'Brielle', 'Evan', 'Noelle', 'Isaiah', 'Camila', 'Miles', 'Ari',
];

const lastNames = [
  'Bennett', 'Coleman', 'Hayes', 'Parker', 'Sullivan', 'Ramirez', 'Brooks', 'Reed', 'Foster', 'Morgan',
  'Bell', 'Cooper', 'Wright', 'Griffin', 'Simmons', 'Price', 'Sanders', 'Bryant', 'Wells', 'Flores',
  'Henderson', 'Washington', 'Carter', 'Phillips', 'Russell', 'Howard', 'Ross', 'Torres', 'Ward', 'Murphy',
  'Bailey', 'Rivera', 'Peterson', 'Gray', 'James', 'Watson', 'Barnes', 'Kelly', 'Perry', 'Long',
];

const sports = [
  'Football', 'Baseball', 'Softball', 'Volleyball', 'Men\'s Basketball', 'Women\'s Basketball',
  'Men\'s Soccer', 'Women\'s Soccer', 'Lacrosse', 'Track & Field', 'Wrestling', 'Tennis',
  'Golf', 'Swimming', 'Cross Country',
];

const schools = [
  'Summit Ridge High School', 'Cedar Valley Prep', 'Northview Academy', 'Westfield Central',
  'Lakewood Christian', 'Riverbend High School', 'Heritage Grove', 'Oak Hill Prep',
  'Eastmont High School', 'Pinecrest Academy', 'Brookside High School', 'Mountain View Prep',
];

const locations = [
  ['Atlanta', 'GA', 'America/New_York', 'ET'],
  ['Charlotte', 'NC', 'America/New_York', 'ET'],
  ['Dallas', 'TX', 'America/Chicago', 'CT'],
  ['Phoenix', 'AZ', 'America/Phoenix', 'MT'],
  ['Denver', 'CO', 'America/Denver', 'MT'],
  ['San Diego', 'CA', 'America/Los_Angeles', 'PT'],
  ['Chicago', 'IL', 'America/Chicago', 'CT'],
  ['Tampa', 'FL', 'America/New_York', 'ET'],
  ['Nashville', 'TN', 'America/Chicago', 'CT'],
  ['Seattle', 'WA', 'America/Los_Angeles', 'PT'],
] as const;

const scouts = [
  { scout_name: 'Coach Marcus Reed', meeting_for: '200041', state: 'GA' },
  { scout_name: 'Coach Lauren Blake', meeting_for: '200052', state: 'NC' },
  { scout_name: 'Coach Anthony Wells', meeting_for: '200063', state: 'TX' },
  { scout_name: 'Coach Natalie Brooks', meeting_for: '200074', state: 'CA' },
  { scout_name: 'Coach Devin Carter', meeting_for: '200085', state: 'FL' },
  { scout_name: 'Coach Erin Moore', meeting_for: '200096', state: 'CO' },
];

const meetingOffsets = [
  0, 0, 1, 1, 2, 2, 3, 4, 5,
  7, 7, 8, 9, 10, 11, 12,
  14, 15, 16, 17, 18, 19,
  21, 22, 23, 24, 25,
];
const meetingHours = [16, 18, 19, 17, 20, 18, 19, 16, 17, 20, 15, 18, 19, 16, 17, 20, 16, 18, 19, 17, 20, 18, 16, 19, 17, 20, 18];

type Athlete = ReturnType<typeof buildAthlete>;

function pad(value: number, size = 2) {
  return String(value).padStart(size, '0');
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function easternDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function localIsoDate(daysFromBase: number) {
  const parts = easternDateParts(addDays(BASE_NOW, daysFromBase));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedInstant(date: string, hour: number, timeZone: string) {
  const offsetByZone: Record<string, string> = {
    'America/New_York': '-04:00',
    'America/Chicago': '-05:00',
    'America/Denver': '-06:00',
    'America/Phoenix': '-07:00',
    'America/Los_Angeles': '-07:00',
  };
  return new Date(`${date}T${pad(hour)}:00:00${offsetByZone[timeZone] || '-04:00'}`).toISOString();
}

function buildAthlete(index: number) {
  const [city, state, timezone, timezoneLabel] = locations[index % locations.length];
  const first = firstNames[index % firstNames.length];
  const last = lastNames[(index * 7) % lastNames.length];
  const name = `${first} ${last}`;
  const athleteId = String(720000 + index);
  const athleteMainId = String(410000 + index);
  return {
    athlete_id: athleteId,
    athlete_main_id: athleteMainId,
    athlete_key: `${athleteId}:${athleteMainId}`,
    athlete_name: name,
    name,
    grad_year: String(2027 + (index % 4)),
    sport: sports[index % sports.length],
    state,
    city,
    high_school: schools[index % schools.length],
    email: `${first}.${last}.${index}@examplemail.com`.toLowerCase(),
    phone: `555${pad(200 + (index % 700), 3)}${pad(1000 + (index * 13) % 9000, 4)}`,
    parent_name: `${firstNames[(index + 11) % firstNames.length]} ${last}`,
    parent_email: `family.${last}.${index}@examplemail.com`.toLowerCase(),
    parent_phone: `555${pad(300 + (index % 600), 3)}${pad(1000 + (index * 17) % 9000, 4)}`,
    relationship_label: index % 3 === 0 ? 'Parent 1' : index % 3 === 1 ? 'Parent 2' : 'Student Athlete',
    timezone,
    timezoneLabel,
    admin_url: `https://dashboard.nationalpid.com/admin/athletes?contactid=${athleteId}&athlete_main_id=${athleteMainId}`,
    profileUrl: `https://dashboard.nationalpid.com/player/${athleteMainId}`,
  };
}

export function getAthletes(count = 100) {
  return Array.from({ length: count }, (_, index) => buildAthlete(index + 1));
}

export function getDemoMeetingWindow(week = 'this') {
  if (week === 'rest-of-july' || week === 'month') {
    return { start: '2026-07-06', end: '2026-08-01', week: 'rest-of-july' };
  }

  return week === 'next'
    ? { start: '2026-07-13', end: '2026-07-20', week: 'next' }
    : { start: '2026-07-06', end: '2026-07-13', week: 'this' };
}

function confirmationText(athlete: Athlete, scoutName: string, startLabel: string) {
  return {
    one: `Hi ${athlete.parent_name.split(' ')[0]}, confirming ${athlete.athlete_name}'s meeting with ${scoutName} for ${startLabel}.`,
    two: `Hi ${athlete.parent_name.split(' ')[0]}, ${scoutName} is ready for ${athlete.athlete_name}'s meeting at ${startLabel}.`,
  };
}

function formatStartLabel(start: string, timeZone: string, timezoneLabel: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(start)) + ` ${timezoneLabel}`;
}

export function getSetMeetingEvents(week = 'this') {
  const athletes = getAthletes(40);
  const events = meetingOffsets.map((offset, index) => {
    const athlete = athletes[index];
    const scout = scouts[index % scouts.length];
    const date = localIsoDate(offset);
    const start = zonedInstant(date, meetingHours[index], athlete.timezone);
    const end = new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
    const label = formatStartLabel(start, athlete.timezone, athlete.timezoneLabel);
    const messages = confirmationText(athlete, scout.scout_name, label);
    return {
      key: `appt_${index + 1}`,
      appointment_id: `appt_${index + 1}`,
      athlete_id: athlete.athlete_id,
      athlete_main_id: athlete.athlete_main_id,
      athlete_name: athlete.athlete_name,
      sport: athlete.sport,
      grad_year: athlete.grad_year,
      head_scout_name: scout.scout_name,
      current_task: index % 2 === 0 ? 'Confirmation Call' : 'Confirmation Text',
      current_meeting_label: start,
      start,
      end,
      meeting_timezone: athlete.timezone,
      meeting_timezone_label: athlete.timezoneLabel,
      confirmation_recipient: {
        name: athlete.parent_name,
        phone: athlete.parent_phone,
        relationship: athlete.relationship_label,
      },
      recipient_contacts: [
        { name: athlete.parent_name, relationship: athlete.relationship_label, phone: athlete.parent_phone },
        { name: athlete.athlete_name, relationship: 'Student Athlete', phone: athlete.phone },
      ],
      confirmation_1_message: messages.one,
      confirmation_2_message: messages.two,
      admin_url: athlete.admin_url,
      task_url: `${athlete.admin_url}&tab=tasks`,
      source: 'local_set_meetings_command_demo',
    };
  });
  return filterByWeek(events, week, (event) => event.start);
}

export function getScoutSchedules(week = 'this') {
  const meetings = getSetMeetingEvents(week);
  return scouts
    .map((scout) => ({
      ...scout,
      name: scout.scout_name,
      slots: meetings
        .filter((event) => event.head_scout_name === scout.scout_name)
        .map((event) => ({
          id: event.appointment_id,
          open_event_id: event.appointment_id,
          assigned_to: scout.meeting_for,
          meeting_for: scout.meeting_for,
          head_scout_name: scout.scout_name,
          athlete_name: event.athlete_name,
          start: event.start,
          end: event.end,
        })),
    }))
    .filter((scout) => scout.slots.length);
}

export function getRescheduleEvents() {
  return getAthletes(40).slice(20, 24).map((athlete, index) => {
    const scout = scouts[(index + 2) % scouts.length];
    const start = zonedInstant(localIsoDate(-index - 1), 18 + index, athlete.timezone);
    return {
      key: `rsp_${index + 1}`,
      appointment_id: `rsp_${index + 1}`,
      athlete_id: athlete.athlete_id,
      athlete_main_id: athlete.athlete_main_id,
      athlete_name: athlete.athlete_name,
      head_scout_name: scout.scout_name,
      previous_meeting_start: start,
      meeting_timezone: athlete.timezone,
      meeting_timezone_label: athlete.timezoneLabel,
      updated_at: new Date(BASE_NOW.getTime() - (index + 1) * 90 * 60_000).toISOString(),
      status: 'scheduled',
      post_meeting_result: 'reschedule_pending',
      previous_meeting_title: `${scout.scout_name} - ${athlete.athlete_name}`,
      previous_meeting_text: `${athlete.athlete_name} ${athlete.sport} ${athlete.grad_year} ${athlete.state}`,
      admin_url: athlete.admin_url,
    };
  });
}

export function searchAthletes(query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return getAthletes()
    .filter((athlete) => {
      const haystack = [
        athlete.athlete_name,
        athlete.parent_name,
        athlete.email,
        athlete.parent_email,
        athlete.phone,
        athlete.parent_phone,
        athlete.sport,
        athlete.state,
      ].join(' ').toLowerCase();
      return haystack.includes(term) || haystack.replace(/\D/g, '').includes(term.replace(/\D/g, ''));
    })
    .slice(0, 8);
}

export function getSearchRows(query: string) {
  return searchAthletes(query).map((athlete) => ({
    athlete_key: athlete.athlete_key,
    athlete_id: athlete.athlete_id,
    athlete_main_id: athlete.athlete_main_id,
    athlete_name: athlete.athlete_name,
    contact_name: athlete.parent_name,
    recipient_name: athlete.parent_name,
    relationship_label: athlete.relationship_label,
    phone: athlete.parent_phone,
    normalized_phone: athlete.parent_phone.replace(/\D/g, ''),
    email: athlete.parent_email,
    timezone: athlete.timezone,
    timezone_label: athlete.timezoneLabel,
    admin_url: athlete.admin_url,
    profile_url: athlete.profileUrl,
  }));
}

export function getRawSearchResults(query: string) {
  return searchAthletes(query).map((athlete) => ({
    athlete_id: athlete.athlete_id,
    athlete_main_id: athlete.athlete_main_id,
    name: athlete.athlete_name,
    grad_year: athlete.grad_year,
    sport: athlete.sport,
    state: athlete.state,
    city: athlete.city,
    high_school: athlete.high_school,
    email: athlete.email,
    phone: athlete.phone,
    parent_name: athlete.parent_name,
    parent_email: athlete.parent_email,
    parent_phone: athlete.parent_phone,
    url: athlete.admin_url,
    source: 'roster',
  }));
}

export function getMeetingReadbackContract() {
  const setEvents = getSetMeetingEvents('month');
  const outcomes = ['Set', 'Follow Up', 'Close Won', 'Close Lost', 'No Show', 'Rescheduled'];
  const meetingRows = setEvents.map((event, index) => ({
    when: event.start,
    whenLabel: formatStartLabel(event.start, event.meeting_timezone, event.meeting_timezone_label || ''),
    athleteId: event.athlete_id,
    athleteName: event.athlete_name,
    status: index % 4 === 0 ? 'Follow Up' : 'Set',
    headScout: event.head_scout_name,
    moneyCents: index === 3 ? 250000 : 0,
  }));
  const historyRows = getAthletes(28).slice(10, 28).map((athlete, index) => {
    const start = zonedInstant(localIsoDate(index - 2), 16 + (index % 5), athlete.timezone);
    return {
      when: start,
      whenLabel: formatStartLabel(start, athlete.timezone, athlete.timezoneLabel),
      athleteId: athlete.athlete_id,
      athleteName: athlete.athlete_name,
      status: outcomes[index % outcomes.length],
      headScout: scouts[index % scouts.length].scout_name,
      moneyCents: index % 5 === 1 ? 250000 : 0,
    };
  });
  const rows = [...meetingRows, ...historyRows].sort(
    (left, right) => new Date(left.when || 0).getTime() - new Date(right.when || 0).getTime(),
  );

  const enrollments = rows.filter((row) => row.status === 'Close Won').length;
  const actualHeld = rows.filter((row) => ['Close Won', 'Close Lost', 'Follow Up'].includes(row.status)).length;
  const generatedAt = BASE_NOW.toISOString();
  return {
    contract: 'monthly-enrollment-tracker',
    version: 1,
    generatedFrom: 'apps/prospect-web/app/api/meeting-readback-data/route.ts',
    data: {
      generatedAt,
      generatedAtLabel: formatStartLabel(generatedAt, EASTERN_ZONE, 'ET'),
      title: 'July Enrollment Tracker',
      monthStart: '2026-07-01',
      monthEndExclusive: '2026-08-01',
      supabaseReads: {
        canonicalEventTable: 'call_log',
        appointmentTable: 'appointments',
        athleteTable: 'athletes',
      },
      summary: {
        meetingsSet: rows.length,
        enrollments,
        showRate: rows.length ? Math.round((actualHeld / rows.length) * 100) : 0,
      },
      rows,
    },
  };
}

function filterByWeek<T>(rows: T[], week: string, getStart: (row: T) => string) {
  const window = getDemoMeetingWindow(week);
  const start = new Date(`${window.start}T00:00:00-04:00`).getTime();
  const end = new Date(`${window.end}T00:00:00-04:00`).getTime();
  return rows.filter((row) => {
    const time = Date.parse(getStart(row));
    return Number.isFinite(time) && time >= start && time < end;
  });
}

export function getVideoProgressRows(count = 60) {
  return getAthletes(count).map((athlete, index) => ({
    id: `vp_${index + 1}`,
    athlete_id: Number(athlete.athlete_id),
    athlete_main_id: athlete.athlete_main_id,
    athletename: athlete.athlete_name,
    video_progress_status: ['Need Film', 'In Review', 'Sent to Scout', 'Follow Up'][index % 4],
    video_progress_stage: ['New', 'Editing', 'Ready', 'Delivered'][index % 4],
    sport: athlete.sport,
    grad_year: athlete.grad_year,
    state: athlete.state,
    updated_at: addDays(BASE_NOW, -index).toISOString(),
  }));
}
