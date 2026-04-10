import cityTimezones from 'city-timezones';
import type { ScoutPrepAIOutput, ScoutPrepContext, ScoutPrepFormValues } from '../features/scout-prep/types';
import { buildDeterministicRapportCues } from '../features/scout-prep/content';
import { searchLogger } from './logger';

const FEATURE = 'scout-prep.ai';

const CITY_STATE_TIMEZONE_OVERRIDES: Record<string, string> = {
  'LONDON|OH': 'America/New_York',
  'LONDON|OHIO': 'America/New_York',
};

const TIMEZONE_BY_STATE: Record<string, string> = {
  AL: 'America/Chicago',
  ALABAMA: 'America/Chicago',
  AK: 'America/Anchorage',
  ALASKA: 'America/Anchorage',
  AZ: 'America/Phoenix',
  ARIZONA: 'America/Phoenix',
  AR: 'America/Chicago',
  ARKANSAS: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CALIFORNIA: 'America/Los_Angeles',
  CO: 'America/Denver',
  COLORADO: 'America/Denver',
  CT: 'America/New_York',
  CONNECTICUT: 'America/New_York',
  DE: 'America/New_York',
  DELAWARE: 'America/New_York',
  FL: 'America/New_York',
  FLORIDA: 'America/New_York',
  GA: 'America/New_York',
  GEORGIA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  HAWAII: 'Pacific/Honolulu',
  ID: 'America/Denver',
  IDAHO: 'America/Denver',
  IL: 'America/Chicago',
  ILLINOIS: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  INDIANA: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  IOWA: 'America/Chicago',
  KS: 'America/Chicago',
  KANSAS: 'America/Chicago',
  KY: 'America/New_York',
  KENTUCKY: 'America/New_York',
  LA: 'America/Chicago',
  LOUISIANA: 'America/Chicago',
  ME: 'America/New_York',
  MAINE: 'America/New_York',
  MD: 'America/New_York',
  MARYLAND: 'America/New_York',
  MA: 'America/New_York',
  MASSACHUSETTS: 'America/New_York',
  MI: 'America/New_York',
  MICHIGAN: 'America/New_York',
  MN: 'America/Chicago',
  MINNESOTA: 'America/Chicago',
  MS: 'America/Chicago',
  MISSISSIPPI: 'America/Chicago',
  MO: 'America/Chicago',
  MISSOURI: 'America/Chicago',
  MT: 'America/Denver',
  MONTANA: 'America/Denver',
  NE: 'America/Chicago',
  NEBRASKA: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NEVADA: 'America/Los_Angeles',
  NH: 'America/New_York',
  'NEW HAMPSHIRE': 'America/New_York',
  NJ: 'America/New_York',
  'NEW JERSEY': 'America/New_York',
  NM: 'America/Denver',
  'NEW MEXICO': 'America/Denver',
  NY: 'America/New_York',
  'NEW YORK': 'America/New_York',
  NC: 'America/New_York',
  'NORTH CAROLINA': 'America/New_York',
  ND: 'America/Chicago',
  'NORTH DAKOTA': 'America/Chicago',
  OH: 'America/New_York',
  OHIO: 'America/New_York',
  OK: 'America/Chicago',
  OKLAHOMA: 'America/Chicago',
  OR: 'America/Los_Angeles',
  OREGON: 'America/Los_Angeles',
  PA: 'America/New_York',
  PENNSYLVANIA: 'America/New_York',
  RI: 'America/New_York',
  'RHODE ISLAND': 'America/New_York',
  SC: 'America/New_York',
  'SOUTH CAROLINA': 'America/New_York',
  SD: 'America/Chicago',
  'SOUTH DAKOTA': 'America/Chicago',
  TN: 'America/Chicago',
  TENNESSEE: 'America/Chicago',
  TX: 'America/Chicago',
  TEXAS: 'America/Chicago',
  UT: 'America/Denver',
  UTAH: 'America/Denver',
  VT: 'America/New_York',
  VERMONT: 'America/New_York',
  VA: 'America/New_York',
  VIRGINIA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WASHINGTON: 'America/Los_Angeles',
  WV: 'America/New_York',
  'WEST VIRGINIA': 'America/New_York',
  WI: 'America/Chicago',
  WISCONSIN: 'America/Chicago',
  WY: 'America/Denver',
  WYOMING: 'America/Denver',
};

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

function clean(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function titleCase(value?: string | null): string {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeStateKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .replace(/\./g, '')
    .toUpperCase();
}

function normalizeCityKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ');
}

function buildCityStateOverrideKey(city?: string | null, state?: string | null): string | null {
  const normalizedCity = normalizeCityKey(city).toUpperCase();
  const normalizedState = normalizeStateKey(state);
  if (!normalizedCity || !normalizedState) {
    return null;
  }
  return `${normalizedCity}|${normalizedState}`;
}

function detectTimezoneOverride(city?: string | null, state?: string | null): string | null {
  const key = buildCityStateOverrideKey(city, state);
  return key ? CITY_STATE_TIMEZONE_OVERRIDES[key] || null : null;
}

function detectTimezoneByCityState(city?: string | null, state?: string | null): string | null {
  const normalizedCity = normalizeCityKey(city);
  const normalizedState = normalizeStateKey(state);
  if (!normalizedCity || !normalizedState) {
    return null;
  }

  const matches = cityTimezones.lookupViaCity(String(city || '').trim()).filter((entry) => {
    const entryStateCode = normalizeStateKey(entry.state_ansi || '');
    const entryStateName = normalizeStateKey(entry.province || '');
    const entryCity = normalizeCityKey(entry.city);
    return (
      entry.country === 'United States of America' &&
      entryCity === normalizedCity &&
      (entryStateCode === normalizedState || entryStateName === normalizedState)
    );
  });

  if (!matches.length) {
    return null;
  }

  const exactMatch =
    matches.find((entry) => normalizeCityKey(entry.city) === normalizedCity) || matches[0];
  return exactMatch.timezone || null;
}

function detectTimezone(state?: string | null, city?: string | null): string | null {
  const overrideTimezone = detectTimezoneOverride(city, state);
  if (overrideTimezone) {
    return overrideTimezone;
  }
  const cityTimezone = detectTimezoneByCityState(city, state);
  if (cityTimezone) {
    return cityTimezone;
  }
  const key = normalizeStateKey(state);
  return key ? TIMEZONE_BY_STATE[key] || null : null;
}

function buildLocationLabel(city?: string | null, state?: string | null): string | null {
  const cityValue = titleCase(city);
  const stateValue = titleCase(state);
  const parts = [cityValue, stateValue].filter(Boolean);
  if (!parts.length) {
    return null;
  }
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    return parts[0];
  }
  return parts.join(', ');
}

function formatLocalTimeLabel(context: ScoutPrepContext): string | null {
  const timezone = detectTimezone(context.resolved.state, context.resolved.city);
  if (!timezone) {
    return null;
  }
  const location = buildLocationLabel(context.resolved.city, context.resolved.state) || 'the client';
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(new Date());
  return `Current local time in ${location}: ${localTime}`;
}

export function buildScoutPrepAIPrompt(values: ScoutPrepFormValues, context: ScoutPrepContext): string {
  const athleteName = clean(context.contactInfo.studentAthlete.name || values.athleteName) || 'Unknown Athlete';
  const sport = clean(context.resolved.sport || values.sport);
  const school = clean(context.resolved.high_school);
  const city = clean(context.resolved.city);
  const state = clean(context.resolved.state);
  const gradYear = clean(values.gradYear);
  const gpa = clean(context.resolved.gpa);
  const taskTitle = clean(context.task.title);
  const taskDescription = clean(context.task.description);

  return `You are helping a Prospect ID scout prepare a recruiting call.

Return strict JSON only with this shape:
{"rapport_cues":["cue 1","cue 2"],"has_mascot_cue":true}

Rules:
- Return exactly 2 rapport cues.
- Each cue must be grounded in the provided athlete context.
- Prioritize one strong local or sport cue.
- Use the second cue for the high school, mascot, or school-community tie-in.
- If you can confidently identify the mascot from the school, city, and state context, use it.
- If you cannot confidently identify the mascot, use the school name instead.
- Do not use GPA, academics, or generic praise as a rapport cue if a school or mascot cue is available.
- Keep each cue under 22 words.
- Do not mention uncertainty.
- Do not use markdown.
- Do not add keys beyond the required JSON keys.
- Do not write a greeting or opener line.
- No fluff. No validation language. No "impressed by" phrasing.

Athlete context:
athlete_name: ${athleteName}
sport: ${sport || 'unknown'}
high_school: ${school || 'unknown'}
city: ${city || 'unknown'}
state: ${state || 'unknown'}
grad_year: ${gradYear || 'unknown'}
gpa: ${gpa || 'unknown'}
task_title: ${taskTitle || 'unknown'}
task_description: ${taskDescription || 'unknown'}`;
}

function sanitizeCue(value: unknown): string | null {
  const cleaned = String(value || '')
    .replace(/^[-*•\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function parseAIResponse(raw: string): {
  rapportCues: string[];
  hasMascotCue: boolean;
} | null {
  const normalized = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const parsed = JSON.parse(normalized) as {
    rapport_cues?: unknown;
    has_mascot_cue?: unknown;
  };

  const rapportCues = Array.isArray(parsed.rapport_cues)
    ? parsed.rapport_cues.map(sanitizeCue).filter((value): value is string => Boolean(value)).slice(0, 2)
    : [];
  const hasMascotCue = Boolean(parsed.has_mascot_cue);

  return {
    rapportCues,
    hasMascotCue,
  };
}

export function buildScoutPrepFallbackOutput(
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
): ScoutPrepAIOutput {
  const localTimeLabel = formatLocalTimeLabel(context);
  logInfo('SCOUT_PREP_LOCAL_TIME', 'resolve', 'success', {
    hasLocalTime: Boolean(localTimeLabel),
    hasCity: Boolean(clean(context.resolved.city)),
    hasState: Boolean(clean(context.resolved.state)),
  });

  return {
    rapportCues: buildDeterministicRapportCues(values, context),
    localTimeLabel,
    rapportSource: 'fallback',
    hasMascotCue: false,
  };
}

export function parseScoutPrepAIOutput(
  raw: string,
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
): ScoutPrepAIOutput | null {
  const parsed = parseAIResponse(raw);
  if (!parsed || parsed.rapportCues.length === 0) {
    return null;
  }

  const fallback = buildScoutPrepFallbackOutput(values, context);
  return {
    ...fallback,
    rapportCues: parsed.rapportCues,
    rapportSource: 'ai',
    hasMascotCue: parsed.hasMascotCue,
  };
}

export function logScoutPrepAIStart(values: ScoutPrepFormValues, context: ScoutPrepContext) {
  logInfo('SCOUT_PREP_AI_REQUEST', 'ask', 'start', {
    athleteName: values.athleteName,
    hasSport: Boolean(clean(context.resolved.sport || values.sport)),
    hasSchool: Boolean(clean(context.resolved.high_school)),
    hasCity: Boolean(clean(context.resolved.city)),
    hasState: Boolean(clean(context.resolved.state)),
    hasGpa: Boolean(clean(context.resolved.gpa)),
  });
}

export function logScoutPrepAISuccess(
  values: ScoutPrepFormValues,
  aiOutput: ScoutPrepAIOutput,
  model: string,
) {
  logInfo('SCOUT_PREP_AI_REQUEST', 'ask', 'success', {
    athleteName: values.athleteName,
    model,
    cueCount: aiOutput.rapportCues.length,
    hasMascotCue: aiOutput.hasMascotCue,
    hasLocalTime: Boolean(aiOutput.localTimeLabel),
  });
}

export function logScoutPrepAIFailure(
  values: ScoutPrepFormValues,
  step: string,
  error: string,
  context?: Record<string, unknown>,
) {
  logFailure('SCOUT_PREP_AI_REQUEST', step, error, {
    athleteName: values.athleteName,
    ...(context || {}),
  });
}
