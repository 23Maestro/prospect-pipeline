import { getPreferenceValues } from '@raycast/api';
import fs from 'fs';
import path from 'path';
import type { ScoutPrepContext } from '../features/scout-prep/types';
import {
  buildAthleteContactCacheSyncPlan,
  type AthleteContactCacheSyncPlan,
} from '../domain/athlete-contact-cache';
import {
  hasAthleteContactCacheRows,
  patchAthleteContactCacheRowsForAthlete,
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
