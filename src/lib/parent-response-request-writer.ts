import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashParentResponseToken } from '../domain/parent-response-request';
import type { SupabasePersistenceConfig } from '../domain/supabase-persistence';
import { isDemoMode } from './demo-mode';

const DEFAULT_SCHEMA = 'public';
const REPO_ROOT_FALLBACK = process.env.PROSPECT_PIPELINE_ROOT || process.cwd();
const DEFAULT_PARENT_RESPONSE_TTL_HOURS = 48;

export type ParentResponseRuntimePreferences = {
  parentResponseTokenSecret?: string;
  parentResponsePublicBaseUrl?: string;
};

export type ParentResponseProposedOption = {
  option_id: string;
  display_label: string;
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  timezone_label?: string | null;
  open_event_id?: string | null;
  assigned_to?: string | null;
  head_scout_name?: string | null;
  source_payload?: Record<string, unknown> | null;
};

export type ParentResponseRequestInsert = {
  appointmentId?: string | null;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  recipientName?: string | null;
  recipientPhone?: string | null;
  originalHeadScoutName?: string | null;
  originalHeadScoutOwnerKey?: string | null;
  originalMeetingStartsAt?: string | null;
  originalMeetingTimezone?: string | null;
  createdByOperatorKey?: string | null;
  proposedOptions: ParentResponseProposedOption[];
  responsePayload?: Record<string, unknown>;
  approvalPayload?: Record<string, unknown>;
  expiresAt?: string | null;
  source?: string | null;
};

export type ParentResponseRuntimeConfig = {
  tokenSecret: string;
  publicBaseUrl: string;
};

export type CreatedParentResponseRequest = {
  requestId: string;
  token: string;
  url: string;
  expiresAt: string;
};

function clean(value?: string | null): string {
  return String(value || '').trim();
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) return acc;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (key) acc[key] = value;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function findProjectRoot(): string {
  const starts = [process.cwd(), REPO_ROOT_FALLBACK];
  const seen = new Set<string>();
  for (const start of starts) {
    let current = path.resolve(start);
    while (!seen.has(current)) {
      seen.add(current);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8')) as {
          name?: string;
        };
        if (pkg.name === 'prospect-pipeline') return current;
      } catch {
        // keep walking up
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return process.cwd();
}

function readRepoEnv(): Record<string, string> {
  const root = findProjectRoot();
  return {
    ...readEnvFile(path.join(root, 'npid-api-layer/.env')),
    ...readEnvFile(path.join(root, '.env')),
    ...readEnvFile(path.join(root, '.overmind.env')),
  };
}

export function getParentResponseRuntimeConfig(
  preferences: ParentResponseRuntimePreferences = {},
): ParentResponseRuntimeConfig {
  if (isDemoMode()) {
    return {
      tokenSecret: 'parent-response-token-secret',
      publicBaseUrl: 'https://ops.prospect-pipeline.local',
    };
  }
  const repoEnv = readRepoEnv();
  const tokenSecret = clean(
    process.env.PARENT_RESPONSE_TOKEN_SECRET ||
      repoEnv.PARENT_RESPONSE_TOKEN_SECRET ||
      preferences.parentResponseTokenSecret,
  );
  const publicBaseUrl = clean(
    process.env.PARENT_RESPONSE_PUBLIC_BASE_URL ||
      repoEnv.PARENT_RESPONSE_PUBLIC_BASE_URL ||
      preferences.parentResponsePublicBaseUrl,
  ).replace(/\/+$/, '');

  if (!tokenSecret) {
    throw new Error('Missing PARENT_RESPONSE_TOKEN_SECRET');
  }
  if (!publicBaseUrl) {
    throw new Error('Missing PARENT_RESPONSE_PUBLIC_BASE_URL');
  }

  return { tokenSecret, publicBaseUrl };
}

function buildExpiresAt(now: Date): string {
  return new Date(now.getTime() + DEFAULT_PARENT_RESPONSE_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

function requireText(value: string, label: string): string {
  const normalized = clean(value);
  if (!normalized) throw new Error(`Missing ${label}`);
  return normalized;
}

export async function createSignedParentResponseRequest(
  config: SupabasePersistenceConfig,
  runtime: ParentResponseRuntimeConfig,
  input: ParentResponseRequestInsert,
  deps: {
    now?: Date;
    randomToken?: () => string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<CreatedParentResponseRequest> {
  const now = deps.now || new Date();
  const token = deps.randomToken?.() || randomBytes(32).toString('base64url');
  const expiresAt = clean(input.expiresAt) || buildExpiresAt(now);
  const proposedOptions = Array.isArray(input.proposedOptions) ? input.proposedOptions : [];
  if (!proposedOptions.length) {
    throw new Error('Missing parent response proposed options');
  }
  if (isDemoMode()) {
    return {
      requestId: `parent-response-${Date.now()}`,
      token,
      url: `${runtime.publicBaseUrl.replace(/\/+$/, '')}/parent-response/${token}`,
      expiresAt,
    };
  }

  const row = {
    appointment_id: clean(input.appointmentId) || null,
    athlete_id: requireText(input.athleteId, 'athleteId'),
    athlete_main_id: requireText(input.athleteMainId, 'athleteMainId'),
    athlete_name: requireText(input.athleteName, 'athleteName'),
    recipient_name: clean(input.recipientName) || null,
    recipient_phone: clean(input.recipientPhone) || null,
    original_head_scout_name: clean(input.originalHeadScoutName) || null,
    original_head_scout_owner_key: clean(input.originalHeadScoutOwnerKey) || null,
    original_meeting_starts_at: clean(input.originalMeetingStartsAt) || null,
    original_meeting_timezone: clean(input.originalMeetingTimezone) || null,
    request_status: 'open',
    approval_status: 'pending',
    notification_status: 'pending',
    token_hash: await hashParentResponseToken(token, runtime.tokenSecret),
    expires_at: expiresAt,
    source: clean(input.source) || 'parent_response_link',
    created_by_operator_key: clean(input.createdByOperatorKey) || null,
    proposed_options: proposedOptions,
    response_payload: input.responsePayload || {},
    approval_payload: input.approvalPayload || {},
  };

  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(
    `${config.url.replace(/\/+$/, '')}/rest/v1/parent_response_requests?select=id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Prefer: 'return=representation',
        'Accept-Profile': config.schema || DEFAULT_SCHEMA,
        'Content-Profile': config.schema || DEFAULT_SCHEMA,
      },
      body: JSON.stringify(row),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      text.slice(0, 300) || `parent_response_requests insert failed: ${response.status}`,
    );
  }

  const payload = (await response.json()) as Array<{ id?: string | null }>;
  const requestId = clean(payload?.[0]?.id);
  if (!requestId) {
    throw new Error('Parent response request insert did not return id');
  }

  return {
    requestId,
    token,
    expiresAt,
    url: `${runtime.publicBaseUrl}/r/${encodeURIComponent(requestId)}?token=${encodeURIComponent(token)}`,
  };
}
