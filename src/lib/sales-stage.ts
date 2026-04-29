import { apiFetch } from './fastapi-client';
import { searchLogger } from './logger';
import type {
  MeetingSetSubmitRequest,
  MeetingSetSubmitResponse,
  MeetingSetTemplateResponse,
  SalesStageOption,
  SalesStageOptionsResponse,
  SalesStageUpdateResponse,
  ScoutPortalTask,
} from '../features/scout-prep/types';

const FEATURE = 'sales-stage';
const DEFAULT_EXCLUDED_STAGE_LABELS = new Set<string>();
const SPOKE_TO_FOLLOW_UP_LABEL = 'Spoke to - I need to follow up';
const STAGE_LABEL_ALIASES = new Map<string, string>([
  ['Spoke to - Follow Up', SPOKE_TO_FOLLOW_UP_LABEL],
]);

const CURATED_STAGE_LABELS = new Set([
  'Left Voice Mail 1',
  'Left Voice Mail 2',
  'Never Spoke To',
  'Called - Unable to Leave VM',
  'Spoke to - Not Interested',
  'Spoke to - Athlete, not Parent',
  'Spoke to - Too Young',
  SPOKE_TO_FOLLOW_UP_LABEL,
  'Meeting Set',
  'Rescheduled',
  'Actual Meeting - Follow Up',
  'Actual Meeting - Close Lost',
  'Actual Meeting - Close Won',
  'Meeting Result - Res. Pending',
  'Meeting Result - Rescheduled',
  'Meeting Result - Canceled',
  'Meeting Result - No Show',
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

export function normalizeSalesStageLabelForLegacy(stage: string): string {
  const trimmed = stage.trim();
  return STAGE_LABEL_ALIASES.get(trimmed) || trimmed;
}

export async function fetchCuratedSalesStageOptions(
  athleteId: string,
  args?: {
    excludeLabels?: string[];
  },
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
  const excludedLabels = new Set(args?.excludeLabels || DEFAULT_EXCLUDED_STAGE_LABELS);
  const selected = options.find((option) => option.selected) || null;
  const selectedAllowed = selected ? !excludedLabels.has(selected.label) : false;
  const curated = options.filter(
    (option) => CURATED_STAGE_LABELS.has(option.label) && !excludedLabels.has(option.label),
  );
  const selectedAlreadyIncluded = selectedAllowed
    ? curated.some(
        (option) =>
          option.label === selected?.label &&
          option.value === selected?.value &&
          option.selected === selected?.selected,
      )
    : false;
  const fallbackOptions = selectedAllowed && selected
    ? [
        selected,
        ...FALLBACK_CURATED_OPTIONS.filter(
          (option) =>
            !excludedLabels.has(option.label) &&
            (option.label !== selected.label || option.value !== selected.value),
        ),
      ]
    : FALLBACK_CURATED_OPTIONS.filter((option) => !excludedLabels.has(option.label));
  const hasOnlySelectedStage = options.length <= 1;
  const finalOptions =
    hasOnlySelectedStage
      ? fallbackOptions
      : curated.length > 0
      ? selectedAllowed && selected && !selectedAlreadyIncluded
        ? [selected, ...curated]
        : curated
      : fallbackOptions;

  logInfo('SALES_STAGE_OPTIONS_LOAD', 'parse', 'success', {
    athleteId,
    officialCount: options.length,
    curatedCount: curated.length,
    selectedStage: selected?.label || selected?.value || null,
    selectedOutsideCurated: Boolean(selected) && !selectedAlreadyIncluded,
    fallbackUsed: hasOnlySelectedStage || curated.length === 0,
    excludedCount: excludedLabels.size,
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
  const stage = normalizeSalesStageLabelForLegacy(args.stage);

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

export async function submitMeetingSet(
  payload: MeetingSetSubmitRequest,
): Promise<MeetingSetSubmitResponse> {
  logInfo('MEETING_SET_SUBMIT', 'request', 'start', {
    athleteId: payload.athlete_id,
    athleteMainId: payload.athlete_main_id,
    assignedTo: payload.assigned_to,
    openEventId: payload.open_event_id,
    templateId: payload.template_id || '210',
  });

  const response = await apiFetch('/sales/meeting-set', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = errorText.slice(0, 200) || `Meeting Set submit HTTP ${response.status}`;
    logFailure('MEETING_SET_SUBMIT', 'request', message, {
      athleteId: payload.athlete_id,
      athleteMainId: payload.athlete_main_id,
      assignedTo: payload.assigned_to,
      openEventId: payload.open_event_id,
      statusCode: response.status,
      responsePreview: errorText.slice(0, 120),
    });
    throw new Error(message);
  }

  const result = (await response.json()) as MeetingSetSubmitResponse;
  logInfo('MEETING_SET_SUBMIT', 'parse', 'success', {
    athleteId: result.athlete_id,
    athleteMainId: result.athlete_main_id,
    assignedTo: result.assigned_to,
    openEventId: result.open_event_id,
    emailSent: result.email_sent,
    hasCreatedTask: Boolean(result.created_task),
  });
  return result;
}
