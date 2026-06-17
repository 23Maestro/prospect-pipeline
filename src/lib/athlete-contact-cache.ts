import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import type { ScoutPortalTask, ScoutPrepContext } from '../features/scout-prep/types';
import {
  buildManualAdditionalAthleteContactCacheRow,
  buildAthleteContactCacheKey,
  buildAthleteContactCacheSyncPlan,
  formatNormalizedContactCachePhone,
  type AthleteContactCacheSyncPlan,
  type ManualAdditionalAthleteContactArgs,
} from '../domain/athlete-contact-cache';
import {
  hasAthleteContactCacheRows,
  patchAthleteContactCacheRowsForAthlete,
  readRows,
  upsertAthleteContactCacheRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';
import { normalizeCrmSalesStage } from '../domain/supabase-lifecycle-translator';
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
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  timezone: string | null;
  timezoneLabel: string | null;
};

export type ManualAdditionalAthleteContact = {
  name: string;
  relationshipLabel: string;
  phone: string;
  normalizedPhone: string;
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
  source?: string | null;
  payload_json?: Record<string, unknown> | null;
};

type AthleteLifecycleReadRow = {
  athlete_key?: string | null;
  crm_stage?: string | null;
  task_status?: string | null;
  event_type?: string | null;
  payload_json?: Record<string, unknown> | null;
  created_at?: string | null;
};

type AthleteLifecycleState = {
  athlete_key?: string | null;
  crm_stage?: string | null;
  task_status?: string | null;
  current_task_id?: string | null;
  current_task_title?: string | null;
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

function uniqueConfigValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function buildSupabaseConfigCandidates(): SupabasePersistenceConfig[] {
  const prefs = getPreferenceValues<Preferences>();
  const repoEnv = readRepoEnv();
  const urls = uniqueConfigValues([
    repoEnv.SUPABASE_URL,
    prefs.supabaseUrl || '',
    process.env.SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.VITE_SUPABASE_URL || '',
  ]).map((url) => url.replace(/\/+$/, ''));
  const keys = uniqueConfigValues([
    repoEnv.SUPABASE_SECRET_KEY,
    repoEnv.SUPABASE_SERVICE_ROLE_KEY,
    prefs.supabaseSecretKey || '',
    prefs.supabaseServiceRoleKey || '',
    process.env.SUPABASE_SECRET_KEY || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    process.env.SUPABASE_ANON_KEY || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    process.env.VITE_SUPABASE_ANON_KEY || '',
    process.env.SUPABASE_KEY || '',
  ]);
  const schema =
    String(
      repoEnv.SUPABASE_SCHEMA || prefs.supabaseSchema || process.env.SUPABASE_SCHEMA || '',
    ).trim() || DEFAULT_SCHEMA;

  return urls.flatMap((url) =>
    keys.map((key) => ({
      url,
      key,
      schema,
    })),
  );
}

async function isSupabaseConfigUsable(
  config: SupabasePersistenceConfig,
  table = 'athlete_contact_cache',
): Promise<boolean> {
  try {
    const response = await fetch(`${config.url}/rest/v1/${table}?select=*&limit=1`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Accept-Profile': config.schema,
        'Content-Profile': config.schema,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function getSupabaseConfig(table = 'athlete_contact_cache'): Promise<SupabasePersistenceConfig | null> {
  const candidates = buildSupabaseConfigCandidates();
  for (const candidate of candidates) {
    if (await isSupabaseConfigUsable(candidate, table)) {
      return {
        url: candidate.url,
        key: candidate.key,
        schema: candidate.schema,
      };
    }
  }
  return null;
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

function lifecycleStateFromEvent(row: AthleteLifecycleReadRow): AthleteLifecycleState {
  const crmStage = String(row.crm_stage || '').trim();
  const taskStatus = String(row.task_status || '').trim();
  const eventType = String(row.event_type || '').trim();
  const payload = row.payload_json && typeof row.payload_json === 'object' ? row.payload_json : {};
  const currentTaskId =
    String(payload.current_task_id || '').trim() ||
    String(payload.task_id || '').trim() ||
    String(payload.selected_task_id || '').trim();
  const currentTaskTitle =
    String(payload.current_task_title || '').trim() ||
    String(payload.task_title || '').trim() ||
    String(payload.selected_task_title || '').trim();
  const normalizedStage = normalizeCrmSalesStage(crmStage || taskStatus || eventType);
  const isTerminal = ['closed_won', 'closed_lost', 'inactive'].includes(normalizedStage);
  return {
    athlete_key: row.athlete_key,
    crm_stage: crmStage || null,
    task_status: taskStatus || null,
    current_task_id: currentTaskId || null,
    current_task_title: currentTaskTitle || null,
    next_action: currentTaskTitle || taskStatus || crmStage || eventType || null,
    is_terminal: isTerminal,
    normalized_stage: normalizedStage,
  };
}

async function readLifecycleEventsByAthleteKey(
  config: SupabasePersistenceConfig,
  athleteKeys: string[],
): Promise<Map<string, AthleteLifecycleState>> {
  if (!athleteKeys.length) return new Map();
  const rows = await readRows<AthleteLifecycleReadRow>(
    config,
    'lifecycle_events',
    [
      'select=athlete_key,crm_stage,task_status,event_type,payload_json,created_at',
      `athlete_key=in.${postgrestInList(athleteKeys)}`,
      'order=created_at.desc',
    ].join('&'),
  );
  const latestByAthleteKey = new Map<string, AthleteLifecycleState>();
  for (const row of rows) {
    const athleteKey = String(row.athlete_key || '').trim();
    if (!athleteKey || latestByAthleteKey.has(athleteKey)) continue;
    latestByAthleteKey.set(athleteKey, lifecycleStateFromEvent(row));
  }
  return latestByAthleteKey;
}

function shouldAdmitContactCacheMatch(lifecycle?: AthleteLifecycleState): boolean {
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

  const config = await getSupabaseConfig('athlete_contact_cache');
  if (!config) {
    throw new Error('No valid Supabase config for athlete_contact_cache.');
  }

  const cacheRows = await readActiveContactCacheRowsForPhones(config, phones);
  const athleteKeys = Array.from(
    new Set(cacheRows.map((row) => String(row.athlete_key || '').trim()).filter(Boolean)),
  );
  const lifecycleByKey = await readLifecycleEventsByAthleteKey(config, athleteKeys);

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
        crmStage: String(lifecycle?.crm_stage || '').trim() || null,
        taskStatus: String(lifecycle?.task_status || '').trim() || null,
        currentTaskId: String(lifecycle?.current_task_id || '').trim() || null,
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

  const config = await getSupabaseConfig('athlete_contact_cache');
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

export async function upsertManualAdditionalAthleteContactCacheRow(
  args: ManualAdditionalAthleteContactArgs,
): Promise<{ enabled: boolean; count: number; normalizedPhone: string | null }> {
  const row = buildManualAdditionalAthleteContactCacheRow(args);
  if (!row) {
    throw new Error('No phone');
  }

  const config = await getSupabaseConfig('athlete_contact_cache');
  if (!config) {
    return { enabled: false, count: 0, normalizedPhone: row.normalized_phone };
  }

  await upsertAthleteContactCacheRows(config, [row]);
  return { enabled: true, count: 1, normalizedPhone: row.normalized_phone };
}

export async function listManualAdditionalAthleteContacts(
  context: ScoutPrepContext,
): Promise<ManualAdditionalAthleteContact[]> {
  const athleteId = String(context.resolved.athlete_id || context.task.contact_id || '').trim();
  const athleteMainId = String(
    context.resolved.athlete_main_id || context.task.athlete_main_id || '',
  ).trim();
  if (!athleteId || !athleteMainId) return [];

  const config = await getSupabaseConfig('athlete_contact_cache');
  if (!config) return [];

  const athleteKey = buildAthleteContactCacheKey(athleteId, athleteMainId);
  const rows = await readRows<AthleteContactCacheReadRow>(
    config,
    'athlete_contact_cache',
    [
      'select=contact_name,relationship_label,phone,normalized_phone,source,payload_json,last_seen_at',
      `athlete_key=eq.${encodeURIComponent(athleteKey)}`,
      'cache_status=eq.active',
      'source=eq.scout_prep_manual_contact',
      'order=last_seen_at.desc',
    ].join('&'),
  );

  const uniqueByPhone = new Map<string, ManualAdditionalAthleteContact>();
  for (const row of rows) {
    const normalizedPhone = String(row.normalized_phone || '').trim();
    const name = String(row.contact_name || '').trim();
    if (!normalizedPhone || !name || uniqueByPhone.has(normalizedPhone)) continue;
    uniqueByPhone.set(normalizedPhone, {
      name,
      relationshipLabel: 'Parent 2',
      phone: formatNormalizedContactCachePhone(normalizedPhone) || String(row.phone || '').trim(),
      normalizedPhone,
    });
  }

  return Array.from(uniqueByPhone.values());
}

export async function hasAthleteContactCacheForTask(
  task: ScoutPortalTask,
): Promise<{ enabled: boolean; cached: boolean; athleteKey: string | null }> {
  const athleteId = String(task.athlete_id || task.contact_id || '').trim();
  const athleteMainId = String(task.athlete_main_id || '').trim();
  if (!athleteId || !athleteMainId) {
    return { enabled: false, cached: false, athleteKey: null };
  }

  const config = await getSupabaseConfig('athlete_contact_cache');
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
