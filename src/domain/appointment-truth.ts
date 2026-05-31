export type AppointmentTruthRow = {
  id: string;
  athlete_key?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  head_scout?: string | null;
  starts_at?: string | null;
  status?: string | null;
  source_event_id?: string | null;
  meeting_timezone?: string | null;
  meeting_timezone_label?: string | null;
  calendar_timezone?: string | null;
  previous_appointment_id?: string | null;
  original_appointment_id?: string | null;
  reschedule_sequence?: number | null;
  operator_owner?: string | null;
  operator_owner_key?: string | null;
  head_scout_key?: string | null;
  appointment_role?: string | null;
  status_reason?: string | null;
  post_meeting_result?: string | null;
  source_system?: string | null;
  source_payload?: Record<string, unknown> | null;
  updated_at?: string | null;
};

export const ACTIVE_APPOINTMENT_STATUSES = [
  'scheduled',
  'rescheduled',
  'reschedule_pending',
  'confirmation_queued',
  'confirmation_sent',
] as const;

export const APPOINTMENT_TRUTH_PRESERVE_FIELDS = [
  'head_scout',
  'starts_at',
  'source_event_id',
  'meeting_timezone',
  'meeting_timezone_label',
  'calendar_timezone',
  'previous_appointment_id',
  'original_appointment_id',
  'operator_owner',
  'operator_owner_key',
  'head_scout_key',
  'appointment_role',
  'source_system',
] as const satisfies ReadonlyArray<keyof AppointmentTruthRow>;

export function hasAppointmentTruthValue(value: unknown): boolean {
  return String(value || '').trim().length > 0;
}

export function isActiveAppointmentStatus(status?: string | null): boolean {
  return ACTIVE_APPOINTMENT_STATUSES.includes(
    String(status || '').trim().toLowerCase() as (typeof ACTIVE_APPOINTMENT_STATUSES)[number],
  );
}

export function asAppointmentTruthRow(row: unknown): AppointmentTruthRow | null {
  return row && typeof row === 'object' && !Array.isArray(row)
    ? (row as AppointmentTruthRow)
    : null;
}

export function mergeAppointmentTruthRow<T extends AppointmentTruthRow>(
  existing: Partial<AppointmentTruthRow> | null | undefined,
  next: T,
): T {
  if (!existing) return next;

  const merged: T = {
    ...next,
    source_payload: {
      ...(asAppointmentTruthRow(existing.source_payload) || {}),
      ...(asAppointmentTruthRow(next.source_payload) || {}),
    },
  };

  for (const field of APPOINTMENT_TRUTH_PRESERVE_FIELDS) {
    if (!hasAppointmentTruthValue(merged[field]) && hasAppointmentTruthValue(existing[field])) {
      (merged as Record<string, unknown>)[field] = existing[field];
    }
  }

  if (Number(merged.reschedule_sequence || 0) === 0 && Number(existing.reschedule_sequence || 0) > 0) {
    merged.reschedule_sequence = Number(existing.reschedule_sequence);
  }

  return merged;
}

export function validateAppointmentTruthWrite(row: AppointmentTruthRow): string[] {
  if (!isActiveAppointmentStatus(row.status)) return [];

  const missing: string[] = [];
  if (!hasAppointmentTruthValue(row.id)) missing.push('id');
  if (!hasAppointmentTruthValue(row.starts_at)) missing.push('starts_at');
  if (!hasAppointmentTruthValue(row.meeting_timezone)) missing.push('meeting_timezone');
  if (!hasAppointmentTruthValue(row.head_scout)) missing.push('head_scout');
  if (!hasAppointmentTruthValue(row.operator_owner)) missing.push('operator_owner');
  if (!hasAppointmentTruthValue(row.original_appointment_id)) missing.push('original_appointment_id');

  if (row.appointment_role === 'reschedule' && !hasAppointmentTruthValue(row.previous_appointment_id)) {
    missing.push('previous_appointment_id');
  }

  return missing;
}

export function assertAppointmentTruthWrite(row: AppointmentTruthRow): void {
  const missing = validateAppointmentTruthWrite(row);
  if (missing.length) {
    throw new Error(
      `Active appointment truth write ${row.id || '(missing id)'} is missing ${missing.join(', ')}`,
    );
  }
}
