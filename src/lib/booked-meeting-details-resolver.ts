import {
  fetchAthleteBookedMeetings,
  fetchBookedMeetingDetails,
  easternLocalIsoToDate,
  type AthleteBookedMeetingsResponse,
  type BookedMeetingDetailsResponse,
  type BookedMeetingEvent,
} from './head-scout-schedules';
import fs from 'fs';
import path from 'path';

export type ResolvedBookedMeetingDetails = {
  bookedMeeting: BookedMeetingEvent;
  title: string;
  description: string | null;
  eventDate: string | null;
  formData: Record<string, string>;
  meetingName: string | null;
  meetingTimezone: string | null;
  assignedTo: string | null;
  openEventId: string | null;
  startTime: string | null;
  meetingLength: string | null;
};

export type ResolvedAppointmentTruthMeetingDetails = ResolvedBookedMeetingDetails & {
  meetingTimezone: string;
};

type ResolverDependencies = {
  fetchAthleteBookedMeetings?: typeof fetchAthleteBookedMeetings;
  fetchBookedMeetingDetails?: typeof fetchBookedMeetingDetails;
  fetchAppointmentTruth?: typeof fetchActiveAthleteMeetingTruth;
  getCachedMeetingDescription?: (args: {
    athleteId: string;
    athleteMainId: string;
    eventId: string;
  }) => Promise<string | null>;
};

export type ActiveAthleteMeetingTruthRow = {
  athlete_key?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  current_head_scout?: string | null;
  current_appointment_id?: string | null;
  resolved_appointment_id?: string | null;
  current_source_event_id?: string | null;
  current_starts_at?: string | null;
  current_meeting_timezone?: string | null;
  current_meeting_timezone_label?: string | null;
  current_appointment_status?: string | null;
};

const DEFAULT_SCHEMA = 'public';
const REPO_ROOT_FALLBACK = '/Users/singleton23/Raycast/prospect-pipeline';

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const values: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function findProjectRoot(): string {
  const starts = [process.cwd(), REPO_ROOT_FALLBACK];
  const seen = new Set<string>();
  for (const start of starts) {
    let current = path.resolve(start);
    while (!seen.has(current)) {
      seen.add(current);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8')) as {
          name?: string;
        };
        if (pkg.name === 'prospect-pipeline') return current;
      } catch {
        // keep walking up
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return process.cwd();
}

function getAppointmentTruthSupabaseConfig(): { url: string; key: string; schema: string } | null {
  const root = findProjectRoot();
  const repoEnv = {
    ...readEnvFile(path.join(root, 'npid-api-layer/.env')),
    ...readEnvFile(path.join(root, '.env')),
    ...readEnvFile(path.join(root, '.overmind.env')),
  };
  const url = clean(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL).replace(/\/+$/, '');
  const key = clean(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY,
  );
  const schema = clean(process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA) || DEFAULT_SCHEMA;
  return url && key ? { url, key, schema } : null;
}

function buildAthleteKey(athleteId: string, athleteMainId: string): string {
  return `${athleteId.trim()}:${athleteMainId.trim()}`;
}

export async function fetchActiveAthleteMeetingTruth(args: {
  athleteId?: string | null;
  athleteMainId?: string | null;
}): Promise<ActiveAthleteMeetingTruthRow | null> {
  const athleteId = clean(args.athleteId);
  const athleteMainId = clean(args.athleteMainId);
  const config = getAppointmentTruthSupabaseConfig();
  if (!athleteId || !athleteMainId || !config) return null;

  const query = [
    'select=*',
    `athlete_key=eq.${encodeURIComponent(buildAthleteKey(athleteId, athleteMainId))}`,
    'order=pipeline_updated_at.desc',
    'limit=1',
  ].join('&');
  const response = await fetch(`${config.url}/rest/v1/active_athlete_meeting_truth?${query}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Accept-Profile': config.schema,
    },
  });
  if (!response.ok) {
    throw new Error((await response.text()).slice(0, 300) || `Supabase HTTP ${response.status}`);
  }
  const rows = (await response.json()) as ActiveAthleteMeetingTruthRow[];
  return Array.isArray(rows) ? rows[0] || null : null;
}

export function getBookedMeetingEventDate(meeting?: BookedMeetingEvent | null): string | null {
  return String(meeting?.start || '').split('T')[0] || null;
}

export function selectCurrentBookedMeeting(
  events: BookedMeetingEvent[],
  now = new Date(),
): BookedMeetingEvent | null {
  const sorted = [...events]
    .filter((event) =>
      Boolean(
        String(event.start || '').trim() ||
        String(event.date_time_label || '').trim() ||
        String(event.event_id || '').trim(),
      ),
    )
    .sort((left, right) =>
      String(left.start || left.date_time_label || left.event_id || '').localeCompare(
        String(right.start || right.date_time_label || right.event_id || ''),
      ),
    );
  if (!sorted.length) return null;

  return (
    sorted.find((event) => {
      const meetingDate = easternLocalIsoToDate(String(event.start || ''));
      return Boolean(meetingDate && meetingDate.getTime() >= now.getTime());
    }) ||
    sorted[sorted.length - 1] ||
    null
  );
}

function normalizeFormData(
  formData?: BookedMeetingDetailsResponse['form_data'],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(formData || {})) {
    output[key] = String(value ?? '').trim();
  }
  return output;
}

function firstValue(formData: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = String(formData[key] || '').trim();
    if (value) return value;
  }
  return null;
}

function resolveBookedMeetingStartTime(
  bookedMeeting: BookedMeetingEvent,
  formData: Record<string, string>,
): string | null {
  const formStartTime = firstValue(formData, ['starttime', 'start_time']);
  if (formStartTime) return formStartTime;

  const start = String(bookedMeeting.start || '').trim();
  return start.split('T')[1]?.slice(0, 5) || null;
}

function toEasternLocalStamp(value?: string | null): string | null {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || '';
  const hour = part('hour') === '24' ? '00' : part('hour');
  return `${part('year')}-${part('month')}-${part('day')}T${hour}:${part('minute')}`;
}

function addMinutesToEasternLocalStamp(value: string, minutes: number): string {
  const parsed = easternLocalIsoToDate(value);
  if (!parsed) return value;
  return toEasternLocalStamp(new Date(parsed.getTime() + minutes * 60_000).toISOString()) || value;
}

function buildAppointmentTruthMeeting(
  row: ActiveAthleteMeetingTruthRow,
): ResolvedBookedMeetingDetails | null {
  const startsAt = toEasternLocalStamp(row.current_starts_at);
  const meetingTimezone = clean(row.current_meeting_timezone);
  const appointmentId =
    String(row.current_source_event_id || '').trim() ||
    String(row.resolved_appointment_id || '').trim() ||
    String(row.current_appointment_id || '').trim();
  const headScout = String(row.current_head_scout || '').trim();

  if (!startsAt || !meetingTimezone || !appointmentId || !headScout) {
    return null;
  }

  const end = addMinutesToEasternLocalStamp(startsAt, 60);
  const title = [row.athlete_name, headScout].filter(Boolean).join(' • ') || 'Appointment Truth';
  return buildResolvedMeetingDetails({
    bookedMeeting: {
      event_id: appointmentId,
      title,
      assigned_owner: headScout,
      start: startsAt,
      end,
      date_time_label: startsAt,
      description: null,
    },
    title,
    description: null,
    eventDate: startsAt.split('T')[0] || null,
    formData: {
      meetingtimezone: meetingTimezone,
      openeventid: appointmentId,
      meetinglength: '01:00',
    },
  });
}

function buildResolvedMeetingDetails(args: {
  bookedMeeting: BookedMeetingEvent;
  eventDate: string | null;
  title: string;
  description: string | null;
  formData?: BookedMeetingDetailsResponse['form_data'];
}): ResolvedBookedMeetingDetails {
  const formData = normalizeFormData(args.formData);
  const formDescription = firstValue(formData, ['taskdescription', 'task_description']);
  return {
    bookedMeeting: args.bookedMeeting,
    title: args.title,
    description: args.description || formDescription,
    eventDate: args.eventDate,
    formData,
    meetingName: firstValue(formData, ['tasktitle']) || args.title || null,
    meetingTimezone: firstValue(formData, ['meetingtimezone', 'recruittimezone']),
    assignedTo: firstValue(formData, ['assignedto', 'assigned_to', 'meetingfor']),
    openEventId:
      firstValue(formData, ['openeventid', 'open_event_id', 'existingtask']) ||
      String(args.bookedMeeting.event_id || '').trim() ||
      null,
    startTime: resolveBookedMeetingStartTime(args.bookedMeeting, formData),
    meetingLength: firstValue(formData, ['meetinglength', 'meeting_length']),
  };
}

export async function resolveBookedMeetingDetailsForForm(
  args: {
    athleteId?: string | null;
    athleteMainId?: string | null;
    initialBookedMeeting?: BookedMeetingEvent | null;
    fallbackEvents?: BookedMeetingEvent[];
    source?: 'appointment_truth' | 'booked_meetings';
  },
  dependencies: ResolverDependencies = {},
): Promise<ResolvedBookedMeetingDetails | null> {
  const athleteId = String(args.athleteId || '').trim();
  const athleteMainId = String(args.athleteMainId || '').trim();
  const fetchMeetings = dependencies.fetchAthleteBookedMeetings || fetchAthleteBookedMeetings;
  const fetchDetails = dependencies.fetchBookedMeetingDetails || fetchBookedMeetingDetails;

  if (args.source === 'appointment_truth') {
    const fetchTruth = dependencies.fetchAppointmentTruth || fetchActiveAthleteMeetingTruth;
    const truth = await fetchTruth({ athleteId, athleteMainId }).catch(() => null);
    return truth ? buildAppointmentTruthMeeting(truth) : null;
  }

  let bookedMeeting =
    args.initialBookedMeeting ||
    selectCurrentBookedMeeting(Array.isArray(args.fallbackEvents) ? args.fallbackEvents : []);

  if (!bookedMeeting && athleteId && athleteMainId) {
    try {
      const response: AthleteBookedMeetingsResponse = await fetchMeetings({
        athleteId,
        athleteMainId,
      });
      bookedMeeting = selectCurrentBookedMeeting(response.events || []);
    } catch {
      bookedMeeting = null;
    }
  }

  if (!bookedMeeting) {
    return null;
  }

  const eventDate = getBookedMeetingEventDate(bookedMeeting);
  const fallbackDescription = String(bookedMeeting.description || '').trim() || null;
  const getCachedDescription = async () => {
    if (!dependencies.getCachedMeetingDescription || !bookedMeeting.event_id) return null;
    return (
      String(
        (await dependencies.getCachedMeetingDescription({
          athleteId,
          athleteMainId,
          eventId: bookedMeeting.event_id,
        })) || '',
      ).trim() || null
    );
  };

  if (!bookedMeeting.event_id || !eventDate) {
    return buildResolvedMeetingDetails({
      bookedMeeting,
      title: String(bookedMeeting.title || '').trim(),
      description: fallbackDescription || (await getCachedDescription()),
      eventDate,
    });
  }

  try {
    const details: BookedMeetingDetailsResponse = await fetchDetails({
      eventId: bookedMeeting.event_id,
      eventDate,
    });
    return buildResolvedMeetingDetails({
      bookedMeeting,
      title: String(details.title || bookedMeeting.title || '').trim(),
      description:
        String(details.description || '').trim() ||
        fallbackDescription ||
        (await getCachedDescription()),
      eventDate,
      formData: details.form_data,
    });
  } catch {
    return buildResolvedMeetingDetails({
      bookedMeeting,
      title: String(bookedMeeting.title || '').trim(),
      description: fallbackDescription || (await getCachedDescription()),
      eventDate,
    });
  }
}

export async function resolveRequiredAppointmentTruthMeeting(
  args: {
    athleteId?: string | null;
    athleteMainId?: string | null;
  },
  dependencies: Pick<ResolverDependencies, 'fetchAppointmentTruth' | 'getCachedMeetingDescription'> = {},
): Promise<ResolvedAppointmentTruthMeetingDetails> {
  const athleteId = clean(args.athleteId);
  const athleteMainId = clean(args.athleteMainId);
  const resolved = await resolveBookedMeetingDetailsForForm(
    {
      athleteId,
      athleteMainId,
      source: 'appointment_truth',
    },
    dependencies,
  );
  if (!resolved?.meetingTimezone) {
    throw new Error(
      `Missing appointment truth timezone for athlete ${athleteId || '(missing athlete id)'}:${athleteMainId || '(missing athlete main id)'}`,
    );
  }
  return {
    ...resolved,
    meetingTimezone: resolved.meetingTimezone,
  };
}
