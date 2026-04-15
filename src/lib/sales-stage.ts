import { apiFetch } from './fastapi-client';
import { searchLogger } from './logger';
import type {
  MeetingSetTemplateResponse,
  SalesStageOption,
  SalesStageOptionsResponse,
  SalesStageUpdateResponse,
  ScoutPortalTask,
} from '../features/scout-prep/types';

const FEATURE = 'sales-stage';

const CURATED_STAGE_LABELS = new Set([
  'Left Voice Mail 1',
  'Left Voice Mail 2',
  'Never Spoke To',
  'Called - Unable to Leave VM',
  'Spoke to - Not Interested',
  'Meeting Set',
]);

const FALLBACK_CURATED_OPTIONS: SalesStageOption[] = Array.from(CURATED_STAGE_LABELS).map(
  (label) => ({
    value: label,
    label,
    selected: false,
  }),
);

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

export async function fetchCuratedSalesStageOptions(
  athleteId: string,
): Promise<SalesStageOption[]> {
  logInfo('SALES_STAGE_OPTIONS_LOAD', 'request', 'start', { athleteId });
  const response = await apiFetch(`/sales/stages/${encodeURIComponent(athleteId)}`);

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Sales stages HTTP ${response.status}`;
    logFailure('SALES_STAGE_OPTIONS_LOAD', 'request', message, {
      athleteId,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as SalesStageOptionsResponse;
  const options = Array.isArray(payload.options) ? payload.options : [];
  const curated = options.filter((option) => CURATED_STAGE_LABELS.has(option.label));
  const finalOptions = curated.length > 0 ? curated : FALLBACK_CURATED_OPTIONS;

  logInfo('SALES_STAGE_OPTIONS_LOAD', 'parse', 'success', {
    athleteId,
    officialCount: options.length,
    curatedCount: curated.length,
    fallbackUsed: curated.length === 0,
  });

  return finalOptions;
}

export async function fetchMeetingSetTemplate(
  task: ScoutPortalTask,
): Promise<MeetingSetTemplateResponse> {
  logInfo('MEETING_SET_TEMPLATE_LOAD', 'request', 'start', {
    adminathlete: task.contact_id,
    athleteMainId: task.athlete_main_id || null,
  });

  const params = new URLSearchParams({
    adminathlete: String(task.contact_id),
    athlete_main_id: String(task.athlete_main_id || ''),
    cal_date: '',
    cal_time: '',
  });

  const response = await apiFetch(`/sales/meeting-set-template?${params.toString()}`);
  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Meeting Set template HTTP ${response.status}`;
    logFailure('MEETING_SET_TEMPLATE_LOAD', 'request', message, {
      adminathlete: task.contact_id,
      athleteMainId: task.athlete_main_id || null,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as MeetingSetTemplateResponse;
  logInfo('MEETING_SET_TEMPLATE_LOAD', 'parse', 'success', {
    adminathlete: task.contact_id,
    athleteMainId: task.athlete_main_id || null,
    hasMeetingName: Boolean(String(payload.meeting_name || '').trim()),
    timezoneCount: payload.recruit_timezone_options?.length || 0,
    hasDetailsTemplate: Boolean(String(payload.details_template || '').trim()),
  });
  return payload;
}

export async function updateSalesStage(args: {
  athleteMainId: string;
  athleteId: string;
  stage: string;
}): Promise<SalesStageUpdateResponse> {
  const athleteMainId = args.athleteMainId.trim();
  const athleteId = args.athleteId.trim();
  const stage = args.stage.trim();

  logInfo('SALES_STAGE_UPDATE', 'request', 'start', {
    athleteId,
    athleteMainId,
    stage,
  });

  const response = await apiFetch('/sales/stage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      athlete_main_id: athleteMainId,
      athlete_id: athleteId,
      stage,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Sales stage update HTTP ${response.status}`;
    logFailure('SALES_STAGE_UPDATE', 'request', message, {
      athleteId,
      athleteMainId,
      stage,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const payload = (await response.json()) as SalesStageUpdateResponse;
  logInfo('SALES_STAGE_UPDATE', 'parse', 'success', {
    athleteId,
    athleteMainId,
    stage: payload.stage,
    statusCode: payload.status_code,
  });
  return payload;
}
