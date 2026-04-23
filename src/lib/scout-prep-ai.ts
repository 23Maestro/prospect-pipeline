import cityTimezones from 'city-timezones';
import type {
  ScoutPrepAIOutput,
  ScoutPrepContext,
  ScoutPrepFormValues,
} from '../features/scout-prep/types';
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

const NATURAL_ZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern',
  'America/Detroit': 'Eastern',
  'America/Indiana/Indianapolis': 'Eastern',
  'America/Kentucky/Louisville': 'Eastern',
  'America/Chicago': 'Central',
  'America/Indiana/Knox': 'Central',
  'America/Menominee': 'Central',
  'America/North_Dakota/Beulah': 'Central',
  'America/North_Dakota/Center': 'Central',
  'America/North_Dakota/New_Salem': 'Central',
  'America/Denver': 'Mountain',
  'America/Boise': 'Mountain',
  'America/Phoenix': 'Mountain',
  'America/Los_Angeles': 'Pacific',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'Hawaii',
  'America/Halifax': 'Atlantic',
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

export function resolveTimezone(city?: string | null, state?: string | null): string | null {
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

export function formatCurrentLocalTime(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);
}

export function getNaturalZoneLabel(timeZone: string): string {
  return NATURAL_ZONE_LABELS[timeZone] || timeZone.split('/').pop()?.replace(/_/g, ' ') || timeZone;
}

export function formatScoutPrepTimeInsight(
  city?: string | null,
  state?: string | null,
  now: Date = new Date(),
): string | null {
  const timezone = resolveTimezone(city, state);
  if (!timezone) {
    return null;
  }

  const location = buildLocationLabel(city, state);
  if (!location) {
    return null;
  }

  const localTime = formatCurrentLocalTime(timezone, now);
  const zoneLabel = getNaturalZoneLabel(timezone);
  return `${localTime} | ${zoneLabel} | ${location}`;
}

export function buildScoutPrepDeterministicOutput(
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
): ScoutPrepAIOutput {
  const localTimeInsight = formatScoutPrepTimeInsight(
    context.resolved.city,
    context.resolved.state,
  );
  logInfo('SCOUT_PREP_LOCAL_TIME', 'resolve', 'success', {
    hasLocalTime: Boolean(localTimeInsight),
    hasCity: Boolean(clean(context.resolved.city)),
    hasState: Boolean(clean(context.resolved.state)),
  });

  return {
    rapportCues: buildDeterministicRapportCues(values, context),
    localTimeInsight,
    rapportSource: 'deterministic',
  };
}

export const buildScoutPrepFallbackOutput = buildScoutPrepDeterministicOutput;
