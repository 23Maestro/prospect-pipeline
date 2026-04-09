import { apiFetch } from './fastapi-client';
import type {
  EmailRecipients,
  EmailTemplateData,
  EmailTemplateOption,
} from '../types/athlete-workflows';

export const DEFAULT_OTHER_EMAIL = 'jholcomb@prospectid.com';
export const DEFAULT_SENDER_NAME = 'Prospect ID Video';
export const DEFAULT_SENDER_EMAIL = 'videoteam@prospectid.com';
export const DEFAULT_EDITING_DONE_TEMPLATE_ID = '172';

export async function fetchEmailTemplates(athleteId: string): Promise<EmailTemplateOption[]> {
  const response = await apiFetch(`/email/templates/${encodeURIComponent(athleteId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load templates (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as any;
  const templates = (payload.templates || []) as { label?: string; value?: string }[];

  return templates
    .filter((template) => template.value)
    .map((template) => ({
      title: template.label || template.value || 'Unknown Template',
      value: template.value as string,
    }));
}

export async function fetchEmailRecipients(athleteId: string): Promise<EmailRecipients> {
  const response = await apiFetch(`/email/recipients/${encodeURIComponent(athleteId)}`);
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(payload?.detail || `Failed to load recipients (HTTP ${response.status})`);
  }

  const recipients = payload.recipients || {};
  return {
    athlete: recipients.athlete || null,
    parents: Array.isArray(recipients.parents) ? recipients.parents : [],
    other_email: recipients.other_email || null,
  };
}

export async function fetchEmailTemplateData(
  templateId: string,
  athleteId: string,
): Promise<EmailTemplateData> {
  const response = await apiFetch('/email/template-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: templateId,
      athlete_id: athleteId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch template data (HTTP ${response.status})`);
  }

  return (await response.json()) as EmailTemplateData;
}

export function buildEditingDoneRecipientPayload(
  recipients: EmailRecipients | null | undefined,
  options?: { respectCheckedParents?: boolean },
) {
  const respectCheckedParents = options?.respectCheckedParents ?? true;
  const parents = (recipients?.parents || []).filter((parent) =>
    respectCheckedParents ? parent.checked !== false : !!parent.id,
  );

  return {
    includeAthlete: true,
    parentIds: parents.map((parent) => parent.id),
    otherEmail: recipients?.other_email || DEFAULT_OTHER_EMAIL,
  };
}

export function buildVideoAdjustmentsRecipientPayload() {
  return {
    includeAthlete: false,
    parentIds: [] as string[],
    otherEmail: DEFAULT_OTHER_EMAIL,
  };
}

export async function sendEmailViaAPI(params: {
  athleteId: string;
  templateId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  message: string;
  includeAthlete?: boolean;
  parentIds?: string[];
  otherEmail?: string;
}) {
  const response = await apiFetch('/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athlete_id: params.athleteId,
      template_id: params.templateId,
      notification_from: params.senderName,
      notification_from_email: params.senderEmail,
      notification_subject: params.subject,
      notification_message: params.message,
      include_athlete: params.includeAthlete ?? true,
      parent_ids: params.parentIds,
      other_email: params.otherEmail,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send email (HTTP ${response.status})`);
  }

  const result = await response.json();
  if (!result?.success) {
    throw new Error(result?.message || 'Send email request failed');
  }
}
