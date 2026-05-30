import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import type { ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import {
  buildAthleteContactCacheKey,
  buildAthleteContactCacheSyncPlan,
  type AthleteContactCacheSyncPlan,
} from '../domain/athlete-contact-cache';
import {
  hasAthleteContactCacheRows,
  patchAthleteContactCacheRowsForAthlete,
  readRows,
  upsertAthleteContactCacheRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';
import { searchLogger } from './logger';

const DEFAULT_SCHEMA = 'public';
const REPO_ROOT_FALLBACK = '/Users/singleton23/Raycast/prospect-pipeline';

type Preferences = {
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  supabaseServiceRoleKey?: string;
  supabaseSchema?: string;
};

export type AthleteContactCacheClientMatch = {
  athleteKey: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  contactId: string | null;
  contactName: string;
  relationshipLabel: string;
  phone: string;
  normalizedPhone: string;
  crmStage: string | null;
  taskStatus: string | null;
  currentTaskTitle: string | null;
  timezone: string | null;
  timezoneLabel: string | null;
};

type AthleteContactCacheReadRow = {
  athlete_key?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  relationship_label?: string | null;
  phone?: string | null;
  normalized_phone?: string | null;
  timezone?: string | null;
  timezone_label?: string | null;
};

type AthletePipelineStateReadRow = {
  athlete_key?: string | null;
  raw_crm_stage?: string | null;
  raw_task_status?: string | null;
  next_action?: string | null;
  is_terminal?: boolean | null;
  normalized_stage?: string | null;
};

function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match) return acc;
      const [, key, rawValue] = match;
      acc[key] = rawValue.replace(/^['"]|['"]$/g, '').trim();
      return acc;
    }, {});
}

function findProjectRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function readRepoEnv(): Record<string, string> {
  const roots = [findProjectRoot(), REPO_ROOT_FALLBACK]
    .map((value) => path.resolve(value))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

  return roots.reduce<Record<string, string>>(
    (acc, root) => ({
      ...acc,
      ...readEnvFile(path.join(root, 'npid-api-layer/.env')),
      ...readEnvFile(path.join(root, '.env')),
      ...readEnvFile(path.join(root, '.overmind.env')),
    }),
    {},
  );
}

function getSupabaseConfig(): SupabasePersistenceConfig | null {
  const prefs = getPreferenceValues<Preferences>();
  const repoEnv = readRepoEnv();
  const url = String(process.env.SUPABASE_URL || repoEnv.SUPABASE_URL || prefs.supabaseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.SUPABASE_SECRET_KEY ||
      repoEnv.SUPABASE_SECRET_KEY ||
      prefs.supabaseSecretKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      repoEnv.SUPABASE_SERVICE_ROLE_KEY ||
      prefs.supabaseServiceRoleKey ||
      '',
  ).trim();
  const schema =
    String(
      process.env.SUPABASE_SCHEMA || repoEnv.SUPABASE_SCHEMA || prefs.supabaseSchema || '',
    ).trim() || DEFAULT_SCHEMA;
  if (!url || !key) return null;
  return { url, key, schema };
}

function logPlanSkipped(plan: AthleteContactCacheSyncPlan) {
  if (plan.action !== 'skip') return;
  searchLogger.info('ATHLETE_CONTACT_CACHE_SKIPPED', {
    feature: 'athlete-contact-cache',
    reason: plan.reason,
  });
}

function uniqueNormalizedPhones(phones: string[]): string[] {
  return Array.from(
    new Set(
      phones
        .map((phone) => String(phone || '').replace(/\D/g, ''))
        .map((phone) => (phone.length === 11 && phone.startsWith('1') ? phone.slice(1) : phone))
        .filter((phone) => phone.length === 10),
    ),
  );
}

function postgrestInList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/"/g, '')}"`).join(',')})`;
}

async function readActiveContactCacheRowsForPhones(
  config: SupabasePersistenceConfig,
  phones: string[],
): Promise<AthleteContactCacheReadRow[]> {
  if (!phones.length) return [];
  const matchedRows = await readRows<AthleteContactCacheReadRow>(
    config,
    'athlete_contact_cache',
    [
      'select=athlete_key,athlete_id,athlete_main_id,athlete_name,contact_id,contact_name,relationship_label,phone,normalized_phone,timezone,timezone_label',
      'cache_status=eq.active',
      `normalized_phone=in.${postgrestInList(phones)}`,
      'order=last_seen_at.desc',
    ].join('&'),
  );

  const athleteKeys = Array.from(
    new Set(matchedRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean)),
  );
  if (!athleteKeys.length) return matchedRows;

  return readRows<AthleteContactCacheReadRow>(
    config,
    'athlete_contact_cache',
    [
      'select=athlete_key,athlete_id,athlete_main_id,athlete_name,contact_id,contact_name,relationship_label,phone,normalized_phone,timezone,timezone_label',
      'cache_status=eq.active',
      `athlete_key=in.${postgrestInList(athleteKeys)}`,
      'order=last_seen_at.desc',
    ].join('&'),
  );
}

async function readLifecycleCurrentByAthleteKey(
  config: SupabasePersistenceConfig,
  athleteKeys: string[],
): Promise<Map<string, AthletePipelineStateReadRow>> {
  if (!athleteKeys.length) return new Map();
  const rows = await readRows<AthletePipelineStateReadRow>(
    config,
    'athlete_lifecycle_current',
    [
      'select=athlete_key,raw_crm_stage,raw_task_status,next_action,is_terminal,normalized_stage',
      `athlete_key=in.${postgrestInList(athleteKeys)}`,
    ].join('&'),
  );
  return new Map(rows.map((row) => [String(row.athlete_key || '').trim(), row]));
}

function shouldAdmitContactCacheMatch(lifecycle?: AthletePipelineStateReadRow): boolean {
  if (!lifecycle) return true;
  if (lifecycle.is_terminal === true) return false;
  const normalizedStage = String(lifecycle.normalized_stage || '').trim();
  return normalizedStage !== 'inactive';
}

export async function lookupActiveAthleteContactCacheForPhones(
  rawPhones: string[],
): Promise<AthleteContactCacheClientMatch[]> {
  const phones = uniqueNormalizedPhones(rawPhones);
  if (!phones.length) return [];

  const config = getSupabaseConfig();
  if (!config) return [];

  const cacheRows = await readActiveContactCacheRowsForPhones(config, phones);
  const athleteKeys = Array.from(
    new Set(cacheRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean)),
  );
  const lifecycleByKey = await readLifecycleCurrentByAthleteKey(config, athleteKeys);

  return cacheRows.flatMap((row) => {
    const athleteKey = String(row.athlete_key || '').trim();
    const athleteId = String(row.athlete_id || '').trim();
    const athleteMainId = String(row.athlete_main_id || '').trim();
    const athleteName = String(row.athlete_name || '').trim();
    const contactName = String(row.contact_name || '').trim();
    const normalizedPhone = String(row.normalized_phone || '').trim();
    if (
      !athleteKey ||
      !athleteId ||
      !athleteMainId ||
      !athleteName ||
      !contactName ||
      !normalizedPhone
    ) {
      return [];
    }

    const lifecycle = lifecycleByKey.get(athleteKey);
    if (!shouldAdmitContactCacheMatch(lifecycle)) {
      return [];
    }

    return [
      {
        athleteKey,
        athleteId,
        athleteMainId,
        athleteName,
        contactId: String(row.contact_id || '').trim() || null,
        contactName,
        relationshipLabel: String(row.relationship_label || '').trim() || 'Contact',
        phone: String(row.phone || '').trim() || normalizedPhone,
        normalizedPhone,
        crmStage: String(lifecycle?.raw_crm_stage || '').trim() || null,
        taskStatus: String(lifecycle?.raw_task_status || '').trim() || null,
        currentTaskTitle: String(lifecycle?.next_action || '').trim() || null,
        timezone: String(row.timezone || '').trim() || null,
        timezoneLabel: String(row.timezone_label || '').trim() || null,
      } satisfies AthleteContactCacheClientMatch,
    ];
  });
}

export async function syncAthleteContactCacheFromScoutPrepContext(args: {
  context: ScoutPrepContext;
  crmStage?: string | null;
  source: string;
  seenAt?: string;
}): Promise<{ enabled: boolean; action: AthleteContactCacheSyncPlan['action']; count: number }> {
  const plan = buildAthleteContactCacheSyncPlan(args);
  if (plan.action === 'skip') {
    logPlanSkipped(plan);
    return { enabled: false, action: plan.action, count: 0 };
  }

  const config = getSupabaseConfig();
  if (!config) {
    return { enabled: false, action: plan.action, count: 0 };
  }

  if (plan.action === 'soft_inactivate') {
    await patchAthleteContactCacheRowsForAthlete(config, plan.athleteKey, {
      cache_status: 'inactive',
      inactive_reason: plan.inactiveReason,
      inactive_at: plan.inactiveAt,
      updated_at: plan.inactiveAt,
    });
    return { enabled: true, action: plan.action, count: 1 };
  }

  if (await hasAthleteContactCacheRows(config, plan.athleteKey)) {
    searchLogger.info('ATHLETE_CONTACT_CACHE_EXISTS', {
      feature: 'athlete-contact-cache',
      athleteKey: plan.athleteKey,
      source: args.source,
    });
    return { enabled: true, action: 'skip', count: 0 };
  }

  await upsertAthleteContactCacheRows(config, plan.rows);
  return { enabled: true, action: plan.action, count: plan.rows.length };
}

export async function hasAthleteContactCacheForTask(
  task: ScoutPortalTask,
): Promise<{ enabled: boolean; cached: boolean; athleteKey: string | null }> {
  const athleteId = String(task.athlete_id || task.contact_id || '').trim();
  const athleteMainId = String(task.athlete_main_id || '').trim();
  if (!athleteId || !athleteMainId) {
    return { enabled: false, cached: false, athleteKey: null };
  }

  const config = getSupabaseConfig();
  if (!config) {
    return { enabled: false, cached: false, athleteKey: null };
  }

  const athleteKey = buildAthleteContactCacheKey(athleteId, athleteMainId);
  return {
    enabled: true,
    cached: await hasAthleteContactCacheRows(config, athleteKey),
    athleteKey,
  };
}
