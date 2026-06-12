import type {
  RescheduleMeetingSubmitRequest,
  RescheduleMeetingSubmitResponse,
  SalesStageUpdateResponse,
} from '../features/scout-prep/types';
import { getActiveOperator } from '../domain/owners';

const CONFIRMED_RESCHEDULE_STAGE = 'Meeting Result - Rescheduled';

type ParentResponseApprovalOption = {
  option_id?: string | null;
  display_label?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  timezone_label?: string | null;
  open_event_id?: string | null;
  assigned_to?: string | null;
  head_scout_name?: string | null;
  source_payload?: Record<string, unknown> | null;
};

export type ParentResponseApprovalRequest = {
  id: string;
  appointment_id?: string | null;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  original_head_scout_name?: string | null;
  original_meeting_timezone?: string | null;
  request_status: string;
  approval_status: string;
  response_kind?: string | null;
  selected_option_id?: string | null;
  proposed_options: ParentResponseApprovalOption[];
  response_payload?: Record<string, unknown> | null;
  approval_payload?: Record<string, unknown> | null;
};

export type ParentResponseApprovalDeps = {
  submitRescheduleMeeting?: (
    payload: RescheduleMeetingSubmitRequest,
  ) => Promise<RescheduleMeetingSubmitResponse>;
  updateSalesStage?: (args: {
    athleteMainId: string;
    athleteId: string;
    athleteName?: string | null;
    stage: string;
    appointmentId?: string | null;
  }) => Promise<SalesStageUpdateResponse>;
  recordRescheduled?: (args: RecordRescheduledArgs) => Promise<{ enabled: boolean }>;
};

export type ParentResponseApprovalResult = {
  stage: string;
  selectedOption: ParentResponseApprovalOption;
  reschedulePayload: RescheduleMeetingSubmitRequest;
  rescheduleResult: RescheduleMeetingSubmitResponse;
  salesStageResult: SalesStageUpdateResponse;
  durableWrite: { enabled: boolean };
};

type RecordRescheduledArgs = {
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  crmStage: string;
  taskStatus: string;
  headScout?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  previousAppointmentId?: string | null;
  appointmentId?: string | null;
  sourceEventId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  payload?: Record<string, unknown>;
};

function requireDependency<T>(dependency: T | undefined, label: string): T {
  if (!dependency) throw new Error(`Missing parent response approval dependency: ${label}`);
  return dependency;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function payloadText(payload: Record<string, unknown> | null | undefined, key: string): string {
  return text(payload?.[key]);
}

function selectedOption(row: ParentResponseApprovalRequest): ParentResponseApprovalOption {
  const selectedOptionId = text(row.selected_option_id);
  if (!selectedOptionId) throw new Error('Parent response approval requires selected_option_id');
  const option = (row.proposed_options || []).find(
    (candidate) => text(candidate.option_id) === selectedOptionId,
  );
  if (!option) throw new Error('Selected parent response option was not found');
  return option;
}

function optionPayloadText(option: ParentResponseApprovalOption, key: string): string {
  return payloadText(option.source_payload, key);
}

function buildReschedulePayload(
  row: ParentResponseApprovalRequest,
  option: ParentResponseApprovalOption,
): RescheduleMeetingSubmitRequest {
  const approvalPayload = row.approval_payload || {};
  const openEventId = text(option.open_event_id) || optionPayloadText(option, 'open_event_id');
  const assignedTo =
    text(option.assigned_to) ||
    optionPayloadText(option, 'assigned_to') ||
    optionPayloadText(option, 'meeting_for') ||
    payloadText(approvalPayload, 'assigned_to');
  const startTime = text(option.starts_at) || optionPayloadText(option, 'start_time');
  const meetingTimezone =
    text(option.timezone) ||
    text(option.timezone_label) ||
    text(row.original_meeting_timezone) ||
    payloadText(approvalPayload, 'meeting_timezone');
  const previousAppointmentId =
    payloadText(approvalPayload, 'previous_appointment_id') || text(row.appointment_id);
  const meetingName =
    payloadText(approvalPayload, 'meeting_name') ||
    payloadText(approvalPayload, 'previous_meeting_title') ||
    text(row.athlete_name);
  const taskDescription =
    payloadText(approvalPayload, 'task_description') ||
    payloadText(approvalPayload, 'previous_meeting_text') ||
    text(option.display_label);

  if (!openEventId) throw new Error('Parent response approval requires open_event_id');
  if (!assignedTo) throw new Error('Parent response approval requires assigned_to');
  if (!startTime) throw new Error('Parent response approval requires selected option start time');
  if (!meetingTimezone) throw new Error('Parent response approval requires meeting timezone');
  if (!previousAppointmentId) {
    throw new Error('Parent response approval requires previous appointment identity');
  }

  return {
    athlete_id: text(row.athlete_id),
    athlete_main_id: text(row.athlete_main_id),
    meeting_name: meetingName,
    meeting_timezone: meetingTimezone,
    assigned_to: assignedTo,
    open_event_id: openEventId,
    task_description: taskDescription,
    start_time: startTime,
    meeting_length: payloadText(approvalPayload, 'meeting_length') || '01:00',
    openmeetings_list_length: '-1',
    template_id: payloadText(approvalPayload, 'template_id') || '210',
    keep_as_open_slot: 'yes',
    previous_event_id: previousAppointmentId,
  };
}

export async function applyApprovedParentResponseReschedule(
  row: ParentResponseApprovalRequest,
  deps: ParentResponseApprovalDeps = {},
): Promise<ParentResponseApprovalResult> {
  if (text(row.response_kind) !== 'selected_slot' || text(row.request_status) !== 'selected') {
    throw new Error('Only selected parent response slots can be approved');
  }
  if (text(row.approval_status) !== 'pending') {
    throw new Error('Parent response approval is no longer pending');
  }

  const option = selectedOption(row);
  const reschedulePayload = buildReschedulePayload(row, option);
  const runSubmit = requireDependency(deps.submitRescheduleMeeting, 'submitRescheduleMeeting');
  const runStageUpdate = requireDependency(deps.updateSalesStage, 'updateSalesStage');
  const runRecordRescheduled = requireDependency(deps.recordRescheduled, 'recordRescheduled');

  const rescheduleResult = await runSubmit(reschedulePayload);
  const salesStageResult = await runStageUpdate({
    athleteId: text(row.athlete_id),
    athleteMainId: text(row.athlete_main_id),
    athleteName: text(row.athlete_name),
    stage: CONFIRMED_RESCHEDULE_STAGE,
    appointmentId: reschedulePayload.previous_event_id || text(row.appointment_id) || null,
  });
  const activeOperator = getActiveOperator();
  const durableWrite = await runRecordRescheduled({
    athleteId: text(row.athlete_id),
    athleteMainId: text(row.athlete_main_id),
    athleteName: text(row.athlete_name),
    crmStage: salesStageResult.stage || CONFIRMED_RESCHEDULE_STAGE,
    taskStatus: rescheduleResult.created_task?.title || 'Confirmation Call',
    headScout: text(option.head_scout_name) || text(row.original_head_scout_name) || null,
    currentTaskId: rescheduleResult.created_task?.task_id || null,
    currentTaskTitle: rescheduleResult.created_task?.title || null,
    previousAppointmentId: reschedulePayload.previous_event_id || text(row.appointment_id) || null,
    appointmentId: reschedulePayload.open_event_id,
    sourceEventId: reschedulePayload.open_event_id,
    startsAt: text(option.starts_at) || reschedulePayload.start_time,
    dueAt: text(option.starts_at) || reschedulePayload.start_time,
    payload: {
      meeting_timezone: reschedulePayload.meeting_timezone,
      previous_appointment_id: reschedulePayload.previous_event_id || text(row.appointment_id) || null,
      operator_owner: activeOperator.personName,
      operator_owner_key: activeOperator.operatorKey,
      owner_proof: 'parent_response_operator_approval',
      parent_response_request_id: row.id,
      selected_option_id: row.selected_option_id || null,
    },
  });

  return {
    stage: salesStageResult.stage || CONFIRMED_RESCHEDULE_STAGE,
    selectedOption: option,
    reschedulePayload,
    rescheduleResult,
    salesStageResult,
    durableWrite,
  };
}
