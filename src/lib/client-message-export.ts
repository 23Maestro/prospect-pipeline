import fs from 'fs';
import path from 'path';
import type { ScoutPortalTask } from '../features/scout-prep/types';
import { fetchScoutPortalTasks } from './scout-prep';
import { fetchContactInfo } from './npid-mcp-adapter';
import { getActiveMeetingFallbackRows } from './supabase-lifecycle';
import { resolveSalesLifecycle } from './sales-lifecycle';
import { searchLogger } from './logger';

export type ClientMessageSegment = 'client' | 'pending';

export type PipelineClientAssociate = {
  role: 'studentAthlete' | 'parent1' | 'parent2';
  name: string | null;
  relationshipLabel: string;
  displayLabel: string;
  normalizedPhoneNumber: string;
};

export type PipelineClientExportRow = {
  contactId: string;
  athleteMainId: string;
  athleteName: string;
  normalizedPhoneNumbers: string[];
  associatedClients: PipelineClientAssociate[];
  crmStage: string | null;
  taskStatus: string | null;
  currentTaskTitle: string | null;
  segment: ClientMessageSegment;
};

export type ClientMessageExportPayload = {
  generatedAt: string;
  source: 'prospect-pipeline';
  rows: PipelineClientExportRow[];
};

type DraftRow = Omit<PipelineClientExportRow, 'normalizedPhoneNumbers' | 'associatedClients'>;

const EXPORT_RELATIVE_PATH = 'tmp/client-message-inbox-export.json';
const TASK_RANGES = ['todayPastDue', 'tomorrow', 'future'] as const;

export function normalizeClientMessagePhoneNumber(raw?: string | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

function toTitleCase(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildRelationshipLabel(
  role: PipelineClientAssociate['role'],
  relationship?: string | null,
): string {
  if (role === 'studentAthlete') {
    return 'Student Athlete';
  }

  const normalized = toTitleCase(relationship);
  if (normalized) {
    return normalized;
  }

  return role === 'parent1' ? 'Parent 1' : 'Parent 2';
}

export function buildAssociatedClientsFromContactInfo(args: {
  athleteName: string;
  contactInfo: Awaited<ReturnType<typeof fetchContactInfo>>;
}): PipelineClientAssociate[] {
  const candidates: Array<{
    role: PipelineClientAssociate['role'];
    name: string | null;
    relationship?: string | null;
    phone?: string | null;
  }> = [
    {
      role: 'studentAthlete',
      name: args.contactInfo.studentAthlete.name || args.athleteName,
      phone: args.contactInfo.studentAthlete.phone,
    },
    {
      role: 'parent1',
      name: args.contactInfo.parent1?.name || null,
      relationship: args.contactInfo.parent1?.relationship || null,
      phone: args.contactInfo.parent1?.phone || null,
    },
    {
      role: 'parent2',
      name: args.contactInfo.parent2?.name || null,
      relationship: args.contactInfo.parent2?.relationship || null,
      phone: args.contactInfo.parent2?.phone || null,
    },
  ];

  return candidates.flatMap((candidate) => {
    const normalizedPhoneNumber = normalizeClientMessagePhoneNumber(candidate.phone);
    if (!normalizedPhoneNumber) {
      return [];
    }

    const relationshipLabel = buildRelationshipLabel(candidate.role, candidate.relationship);
    const preferredName =
      String(candidate.name || '').trim() ||
      (candidate.role === 'studentAthlete' ? args.athleteName : null);
    const displayLabel = preferredName
      ? `${relationshipLabel}: ${preferredName}`
      : relationshipLabel;

    return [
      {
        role: candidate.role,
        name: preferredName,
        relationshipLabel,
        displayLabel,
        normalizedPhoneNumber,
      } satisfies PipelineClientAssociate,
    ];
  });
}

function buildExportPath() {
  return path.resolve(process.cwd(), EXPORT_RELATIVE_PATH);
}

function isPendingTask(task: ScoutPortalTask): boolean {
  const title = String(task.title || '')
    .trim()
    .toLowerCase();
  const description = String(task.description || '')
    .trim()
    .toLowerCase();
  const completionDate = String(task.completion_date || '').trim();
  if (completionDate) {
    return false;
  }
  return (
    title.startsWith('call attempt 1') ||
    title.startsWith('call attempt 2') ||
    title.startsWith('call attempt 3') ||
    description.includes('call the family')
  );
}

function buildPendingDraft(task: ScoutPortalTask): DraftRow | null {
  const contactId = String(task.contact_id || '').trim();
  const athleteMainId = String(task.athlete_main_id || '').trim();
  const athleteName = String(task.athlete_name || '').trim();
  const currentTaskTitle = String(task.title || '').trim() || null;
  if (!contactId || !athleteMainId || !athleteName || !currentTaskTitle) {
    return null;
  }

  return {
    contactId,
    athleteMainId,
    athleteName,
    crmStage: 'Call Attempt',
    taskStatus: currentTaskTitle,
    currentTaskTitle,
    segment: 'pending',
  };
}

function shouldIncludeClientLifecycle(rawStage?: string | null): boolean {
  const lifecycle = resolveSalesLifecycle(rawStage);
  return (
    lifecycle.operatorStatus === 'active_meeting_queue' ||
    lifecycle.operatorStatus === 'awaiting_follow_up' ||
    lifecycle.operatorStatus === 'awaiting_close' ||
    lifecycle.operatorStatus === 'awaiting_reschedule' ||
    lifecycle.operatorStatus === 'no_show' ||
    lifecycle.operatorStatus === 'won'
  );
}

function buildClientDraft(
  row: Awaited<ReturnType<typeof getActiveMeetingFallbackRows>>[number],
): DraftRow | null {
  const contactId = String(row.athleteId || '').trim();
  const athleteMainId = String(row.athleteMainId || '').trim();
  const athleteName = String(row.athleteName || '').trim();
  if (!contactId || !athleteMainId || !athleteName) {
    return null;
  }
  if (!shouldIncludeClientLifecycle(row.crmStage)) {
    return null;
  }

  return {
    contactId,
    athleteMainId,
    athleteName,
    crmStage: row.crmStage || null,
    taskStatus: row.taskStatus || null,
    currentTaskTitle: row.currentTaskTitle || row.taskStatus || null,
    segment: 'client',
  };
}

function mergeDraftRows(existing: DraftRow | undefined, incoming: DraftRow): DraftRow {
  if (!existing) {
    return incoming;
  }
  const segment =
    existing.segment === 'client' || incoming.segment === 'client' ? 'client' : 'pending';

  return {
    ...existing,
    ...incoming,
    crmStage: existing.crmStage || incoming.crmStage,
    taskStatus: existing.taskStatus || incoming.taskStatus,
    currentTaskTitle: existing.currentTaskTitle || incoming.currentTaskTitle,
    segment,
  };
}

async function collectDraftRows(): Promise<DraftRow[]> {
  const [taskGroups, clientRows] = await Promise.all([
    Promise.all(TASK_RANGES.map((range) => fetchScoutPortalTasks(range))),
    getActiveMeetingFallbackRows().catch(() => []),
  ]);

  const draftMap = new Map<string, DraftRow>();

  for (const row of clientRows) {
    const draft = buildClientDraft(row);
    if (!draft) continue;
    const key = `${draft.contactId}:${draft.athleteMainId}`;
    draftMap.set(key, mergeDraftRows(draftMap.get(key), draft));
  }

  for (const task of taskGroups.flat()) {
    if (!isPendingTask(task)) continue;
    const draft = buildPendingDraft(task);
    if (!draft) continue;
    const key = `${draft.contactId}:${draft.athleteMainId}`;
    draftMap.set(key, mergeDraftRows(draftMap.get(key), draft));
  }

  return Array.from(draftMap.values());
}

export async function buildClientMessageExportPayload(): Promise<ClientMessageExportPayload> {
  const drafts = await collectDraftRows();

  const settled = await Promise.allSettled(
    drafts.map(async (draft) => {
      const contactInfo = await fetchContactInfo(draft.contactId, draft.athleteMainId);
      const associatedClients = buildAssociatedClientsFromContactInfo({
        athleteName: draft.athleteName,
        contactInfo,
      });
      const normalizedPhoneNumbers = Array.from(
        new Set(associatedClients.map((client) => client.normalizedPhoneNumber)),
      );

      if (!normalizedPhoneNumbers.length) {
        return null;
      }

      return {
        ...draft,
        normalizedPhoneNumbers,
        associatedClients,
      } satisfies PipelineClientExportRow;
    }),
  );

  const rows = settled.flatMap((result) => {
    if (result.status === 'fulfilled' && result.value) {
      return [result.value];
    }
    if (result.status === 'rejected') {
      searchLogger.error('CLIENT_MESSAGE_EXPORT_CONTACT_FAILURE', {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
    return [];
  });

  return {
    generatedAt: new Date().toISOString(),
    source: 'prospect-pipeline',
    rows: rows.sort((left, right) => left.athleteName.localeCompare(right.athleteName)),
  };
}

export async function writeClientMessageExport(): Promise<{
  path: string;
  payload: ClientMessageExportPayload;
}> {
  const exportPath = buildExportPath();
  const payload = await buildClientMessageExportPayload();

  fs.mkdirSync(path.dirname(exportPath), { recursive: true });
  fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2));

  return {
    path: exportPath,
    payload,
  };
}
