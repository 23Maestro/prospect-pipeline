import cityTimezones from 'city-timezones';
import type {
  ScoutPrepAIOutput,
  ScoutPrepContext,
  ScoutPrepFormValues,
  ScoutPrepMicroEnrichment,
} from '../features/scout-prep/types';
import { buildDeterministicRapportCues } from '../features/scout-prep/content';
import { searchLogger } from './logger';

const FEATURE = 'scout-prep.ai';
const LOCAL_MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const LOCAL_MODEL_TIMEOUT_MS = 25000;
const LOCAL_GENERATION_TIMEOUT_MS = 12000;

let localGeneratorPromise: Promise<unknown> | null = null;

async function loadTransformersPipeline(): Promise<
  (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>
> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{ pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown> }>;
  const transformers = await dynamicImport('@huggingface/transformers');
  return transformers.pipeline;
}

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

function compactLine(value: unknown): string | null {
  const cleaned = String(value || '')
    .replace(/^[\s"'`*-]+|[\s"'`*-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > 180 || cleaned.split(/[.!?]/).filter(Boolean).length > 2) {
    return null;
  }
  return cleaned;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
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

export function buildScoutPrepMicroEnrichmentPrompt(
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
  localTimeLabel?: string | null,
): string {
  const athleteName = clean(context.contactInfo.studentAthlete.name || values.athleteName) || 'Unknown Athlete';
  const parent1 = clean(context.contactInfo.parent1?.name || values.parent1Name);
  const parent2 = clean(context.contactInfo.parent2?.name || values.parent2Name);
  const sport = clean(context.resolved.sport || values.sport);
  const school = clean(context.resolved.high_school);
  const city = clean(context.resolved.city);
  const state = clean(context.resolved.state);
  const gradYear = clean(values.gradYear);
  const gpa = clean(context.resolved.gpa);
  const position = clean(context.resolved.positions);

  return `You are filling five tiny Scout Prep card slots.
Do not rewrite the script. Do not generate a call. Do not add markdown.
Return strict JSON only with these exact keys:
{"rapportAnchor":"","suggestedLiveRapportLane":"","gpaToneLine":"","deficitEmphasis":"","sportPromptBias":""}

Rules:
- One short factual sentence per value.
- No value over 22 words.
- Tone: live recruiting call, practical, skimmable.
- Keep fixed close, meeting, handoff, and final confirmation language untouched.
- Do not mention mascots.
- If location/sport hook is weak, use safe regional sports culture.
- GPA >= 3.0: praise/celebrate. GPA 2.5-2.99: encourage/build up. GPA < 2.5: encouragement plus academic urgency.
- Freshman/Sophomore: get on the map. Junior: coaches should already be reaching out. Senior: where things stand right now.
- Football bias: position, varsity, size, speed, offseason training.
- Baseball bias: travel ball, varsity, pop time, velo, 60.
- Basketball bias: varsity, AAU, size, role, exposure.

Context:
athlete_name: ${athleteName}
parent_1: ${parent1 || 'unknown'}
parent_2: ${parent2 || 'unknown'}
sport: ${sport || 'unknown'}
grad_year: ${gradYear || 'unknown'}
gpa: ${gpa || 'unknown'}
position: ${position || 'unknown'}
school: ${school || 'unknown'}
city: ${city || 'unknown'}
state: ${state || 'unknown'}
local_time: ${localTimeLabel || 'unknown'}`;
}

function extractGeneratedText(output: unknown): string {
  if (Array.isArray(output)) {
    const first = output[0] as { generated_text?: unknown };
    return String(first?.generated_text || '');
  }
  if (output && typeof output === 'object' && 'generated_text' in output) {
    return String((output as { generated_text?: unknown }).generated_text || '');
  }
  return String(output || '');
}

function parseMicroEnrichment(raw: string): ScoutPrepMicroEnrichment | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  const enrichment: ScoutPrepMicroEnrichment = {
    rapportAnchor: compactLine(parsed.rapportAnchor),
    suggestedLiveRapportLane: compactLine(parsed.suggestedLiveRapportLane),
    gpaToneLine: compactLine(parsed.gpaToneLine),
    deficitEmphasis: compactLine(parsed.deficitEmphasis),
    sportPromptBias: compactLine(parsed.sportPromptBias),
  };

  return Object.values(enrichment).some(Boolean) ? enrichment : null;
}

async function getLocalGenerator(): Promise<unknown> {
  if (!localGeneratorPromise) {
    const startedAt = Date.now();
    logInfo('SCOUT_PREP_LOCAL_MODEL', 'load-model', 'start', {
      model: LOCAL_MODEL_ID,
    });
    localGeneratorPromise = withTimeout(
      loadTransformersPipeline().then((transformersPipeline) =>
        transformersPipeline('text-generation', LOCAL_MODEL_ID, { dtype: 'q4' }),
      ),
      LOCAL_MODEL_TIMEOUT_MS,
      'Local scout-prep model load',
    ).then((generator) => {
      logInfo('SCOUT_PREP_LOCAL_MODEL', 'load-model', 'success', {
        model: LOCAL_MODEL_ID,
        elapsedMs: Date.now() - startedAt,
      });
      return generator;
    }).catch((error) => {
      localGeneratorPromise = null;
      throw error;
    });
  }
  return localGeneratorPromise;
}

export async function generateScoutPrepLocalEnrichment(
  values: ScoutPrepFormValues,
  context: ScoutPrepContext,
): Promise<ScoutPrepAIOutput | null> {
  const fallback = buildScoutPrepFallbackOutput(values, context);
  const prompt = buildScoutPrepMicroEnrichmentPrompt(values, context, fallback.localTimeLabel);
  const startedAt = Date.now();

  try {
    logInfo('SCOUT_PREP_LOCAL_MODEL', 'generate', 'start', {
      model: LOCAL_MODEL_ID,
      athleteName: values.athleteName,
    });
    const generator = (await getLocalGenerator()) as (
      prompt: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    const output = await withTimeout(
      generator(prompt, {
        max_new_tokens: 140,
        temperature: 0.2,
        do_sample: false,
        return_full_text: false,
      }),
      LOCAL_GENERATION_TIMEOUT_MS,
      'Local scout-prep model generation',
    );
    const microEnrichment = parseMicroEnrichment(extractGeneratedText(output));
    if (!microEnrichment) {
      logFailure('SCOUT_PREP_LOCAL_MODEL', 'parse', 'Local model returned unusable JSON', {
        model: LOCAL_MODEL_ID,
      });
      return null;
    }

    logInfo('SCOUT_PREP_LOCAL_MODEL', 'generate', 'success', {
      model: LOCAL_MODEL_ID,
      elapsedMs: Date.now() - startedAt,
      slotCount: Object.values(microEnrichment).filter(Boolean).length,
    });

    return {
      ...fallback,
      rapportSource: 'ai',
      hasMascotCue: false,
      microEnrichment,
    };
  } catch (error) {
    logFailure(
      'SCOUT_PREP_LOCAL_MODEL',
      'generate',
      error instanceof Error ? error.message : String(error),
      {
        model: LOCAL_MODEL_ID,
        elapsedMs: Date.now() - startedAt,
      },
    );
    return null;
  }
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
