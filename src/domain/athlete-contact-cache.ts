import type { ScoutPrepContext } from '../features/scout-prep/types';
import { getProspectContactShortcutCandidates } from './scout-contact-selection';
import { resolveSalesLifecycle } from '../lib/sales-lifecycle';

export type AthleteContactCacheStatus = 'active' | 'inactive';

export type AthleteContactCacheRow = {
  athlete_key: string;
  athlete_id: string;
  athlete_main_id: string;
  athlete_name: string;
  contact_id: string | null;
  contact_name: string;
  relationship_label: string;
  phone: string;
  normalized_phone: string;
  admin_url: string;
  task_url: string | null;
  source: string;
  cache_status: AthleteContactCacheStatus;
  inactive_reason: string | null;
  inactive_at: string | null;
  last_seen_at: string;
  payload_json: Record<string, unknown>;
  updated_at: string;
};

export type AthleteContactCacheSyncPlan =
  | {
      action: 'upsert';
      athleteKey: string;
      rows: AthleteContactCacheRow[];
    }
  | {
      action: 'soft_inactivate';
      athleteKey: string;
      inactiveReason: string;
      inactiveAt: string;
    }
  | {
      action: 'skip';
      reason: string;
    };

type BuildPlanArgs = {
  context: ScoutPrepContext;
  crmStage?: string | null;
  source: string;
  seenAt?: string;
};

const DASHBOARD_BASE_URL = 'https://dashboard.nationalpid.com';

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function buildAthleteAdminUrl(contactId: string, athleteMainId?: string | null): string {
  const params = new URLSearchParams({
    contactid: String(contactId || '').trim(),
  });
  const normalizedAthleteMainId = String(athleteMainId || '').trim();
  if (normalizedAthleteMainId) {
    params.set('athlete_main_id', normalizedAthleteMainId);
  }
  return `${DASHBOARD_BASE_URL}/admin/athletes?${params.toString()}`;
}

export function buildAthleteContactCacheKey(athleteId: string, athleteMainId: string): string {
  return `${athleteId.trim()}:${athleteMainId.trim()}`;
}

export function normalizeContactCachePhone(raw?: string | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

export function buildAthleteContactCacheSyncPlan(
  args: BuildPlanArgs,
): AthleteContactCacheSyncPlan {
  const athleteId = clean(args.context.resolved.athlete_id || args.context.task.contact_id);
  const athleteMainId = clean(
    args.context.resolved.athlete_main_id || args.context.task.athlete_main_id,
  );
  const athleteName = clean(
    args.context.contactInfo.studentAthlete.name || args.context.task.athlete_name,
  );
  if (!athleteId || !athleteMainId || !athleteName) {
    return { action: 'skip', reason: 'missing_athlete_identity' };
  }

  const athleteKey = buildAthleteContactCacheKey(athleteId, athleteMainId);
  const crmStage = clean(args.crmStage);
  const seenAt = args.seenAt || new Date().toISOString();
  const lifecycle = crmStage ? resolveSalesLifecycle(crmStage) : null;
  if (lifecycle?.shouldArchiveFromWorkingViews) {
    return {
      action: 'soft_inactivate',
      athleteKey,
      inactiveReason: lifecycle.reason,
      inactiveAt: seenAt,
    };
  }

  const contactId = clean(args.context.contactInfo.contactId || args.context.task.contact_id);
  const adminUrl = buildAthleteAdminUrl(contactId || athleteId, athleteMainId);
  const taskUrl = clean(args.context.task.athlete_task_url) || null;
  const byPhone = new Map<string, AthleteContactCacheRow>();

  for (const candidate of getProspectContactShortcutCandidates(args.context)) {
    const normalizedPhone = normalizeContactCachePhone(candidate.phone);
    const contactName = clean(candidate.name);
    if (!normalizedPhone || !contactName) {
      continue;
    }

    const row: AthleteContactCacheRow = {
      athlete_key: athleteKey,
      athlete_id: athleteId,
      athlete_main_id: athleteMainId,
      athlete_name: athleteName,
      contact_id: contactId || null,
      contact_name: contactName,
      relationship_label: clean(candidate.label) || candidate.id,
      phone: candidate.phone,
      normalized_phone: normalizedPhone,
      admin_url: adminUrl,
      task_url: taskUrl,
      source: args.source,
      cache_status: 'active',
      inactive_reason: null,
      inactive_at: null,
      last_seen_at: seenAt,
      payload_json: {
        role: candidate.id,
        crm_stage: crmStage || null,
        task_id: clean(args.context.task.task_id) || null,
        task_title: clean(args.context.task.title) || null,
      },
      updated_at: seenAt,
    };

    const existing = byPhone.get(normalizedPhone);
    if (!existing || candidate.id === 'studentAthlete') {
      byPhone.set(normalizedPhone, row);
    }
  }

  const rows = Array.from(byPhone.values());
  if (!rows.length) {
    return { action: 'skip', reason: 'missing_contact_phone' };
  }

  return { action: 'upsert', athleteKey, rows };
}
