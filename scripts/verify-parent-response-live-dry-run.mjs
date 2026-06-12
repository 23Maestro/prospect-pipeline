import { fileURLToPath } from 'node:url';
import {
  createSignedParentResponseRequest,
  getParentResponseRuntimeConfig,
} from '../src/lib/parent-response-request-writer.ts';
import { buildParentResponseN8nEnv } from './verify-parent-response-readiness.mjs';

const DEFAULT_SCHEMA = 'public';
const DEFAULT_BASE_URL = 'https://prospect-web.vercel.app';

function clean(value) {
  return String(value || '').trim();
}

function requireConfirmFlag(argv = process.argv) {
  if (!argv.includes('--confirm-live-write')) {
    throw new Error('Refusing live dry-run without --confirm-live-write');
  }
}

function getSupabaseConfig(env) {
  const url = clean(env.SUPABASE_URL);
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  const schema = clean(env.SUPABASE_SCHEMA) || DEFAULT_SCHEMA;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url: url.replace(/\/+$/, ''), key, schema };
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-profile': config.schema,
    'content-profile': config.schema,
    ...extra,
  };
}

async function readParentResponseRow(config, requestId) {
  const response = await fetch(
    `${config.url}/rest/v1/parent_response_requests?${new URLSearchParams({
      id: `eq.${requestId}`,
      select: 'id,request_status,response_kind,selected_option_id,notification_status,response_payload,approval_status,source',
    })}`,
    { headers: supabaseHeaders(config) },
  );
  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Supabase read HTTP ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

async function patchParentResponseRow(config, requestId, body) {
  const response = await fetch(
    `${config.url}/rest/v1/parent_response_requests?${new URLSearchParams({ id: `eq.${requestId}` })}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(config, { prefer: 'return=minimal' }),
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error((await response.text().catch(() => '')) || `Supabase patch HTTP ${response.status}`);
  }
}

function buildDryRunRequestInput(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return {
    appointmentId: `dry-run-previous-${stamp}`,
    athleteId: `dry-run-athlete-${stamp}`,
    athleteMainId: `dry-run-main-${stamp}`,
    athleteName: 'Parent Response Dry Run',
    recipientName: 'Dry Run Parent',
    recipientPhone: '+15555550100',
    originalHeadScoutName: 'Dry Run Scout',
    originalHeadScoutOwnerKey: 'dry_run_scout',
    originalMeetingStartsAt: '2099-01-01T15:00:00.000Z',
    originalMeetingTimezone: 'America/New_York',
    createdByOperatorKey: 'dry_run',
    source: 'parent_response_live_dry_run',
    proposedOptions: [
      {
        option_id: 'dry-run-slot-1',
        display_label: 'Dry run slot - do not book',
        starts_at: '2099-01-02T15:00:00',
        ends_at: '2099-01-02T16:00:00',
        timezone: 'America/New_York',
        timezone_label: 'America/New_York',
        open_event_id: `dry-run-open-${stamp}`,
        assigned_to: 'dry-run-assigned-to',
        head_scout_name: 'Dry Run Scout',
      },
    ],
    responsePayload: {
      dry_run: true,
    },
    approvalPayload: {
      previous_appointment_id: `dry-run-previous-${stamp}`,
      meeting_name: 'Parent Response Dry Run',
      task_description: 'Dry run only. Do not book.',
      dry_run: true,
    },
  };
}

export async function runParentResponseLiveDryRun({
  env = buildParentResponseN8nEnv(),
  baseUrl = DEFAULT_BASE_URL,
  now = new Date(),
  cleanup = true,
} = {}) {
  const config = getSupabaseConfig(env);
  const runtime = getParentResponseRuntimeConfig({
    parentResponseTokenSecret: env.PARENT_RESPONSE_TOKEN_SECRET,
    parentResponsePublicBaseUrl: clean(env.PARENT_RESPONSE_PUBLIC_BASE_URL) || baseUrl,
  });
  const created = await createSignedParentResponseRequest(
    config,
    runtime,
    buildDryRunRequestInput(now),
  );

  const submitUrl = `${baseUrl.replace(/\/+$/, '')}/api/parent-response/${encodeURIComponent(created.requestId)}/submit`;
  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      token: created.token,
      responseKind: 'ready_later',
      response_kind: 'ready_later',
      parentNote: 'Live dry run. No family action.',
      parent_note: 'Live dry run. No family action.',
    }),
  });
  const submitPayload = await submitResponse.json().catch(async () => ({
    error: await submitResponse.text().catch(() => ''),
  }));
  if (!submitResponse.ok) {
    throw new Error(`Submit failed: ${submitResponse.status} ${JSON.stringify(submitPayload)}`);
  }

  const submittedRow = await readParentResponseRow(config, created.requestId);
  if (!submittedRow) throw new Error('Dry-run row was not found after submit');
  if (submittedRow.request_status !== 'ready_later') {
    throw new Error(`Expected ready_later, got ${submittedRow.request_status}`);
  }
  if (submittedRow.response_kind !== 'ready_later') {
    throw new Error(`Expected response_kind ready_later, got ${submittedRow.response_kind}`);
  }
  if (submittedRow.approval_status !== 'pending') {
    throw new Error(`Expected approval_status pending, got ${submittedRow.approval_status}`);
  }
  if (submittedRow.notification_status !== 'pending') {
    throw new Error(`Expected notification_status pending, got ${submittedRow.notification_status}`);
  }

  if (cleanup) {
    await patchParentResponseRow(config, created.requestId, {
      request_status: 'canceled',
      notification_status: 'failed',
      notification_error: 'dry_run_verified_no_notification_sent',
      response_payload: {
        ...(submittedRow.response_payload || {}),
        dry_run_cleaned_up_at: new Date().toISOString(),
      },
    });
  }

  return {
    requestId: created.requestId,
    submitStatus: submitResponse.status,
    requestStatus: submittedRow.request_status,
    responseKind: submittedRow.response_kind,
    notificationStatus: submittedRow.notification_status,
    cleanedUp: cleanup,
  };
}

async function main() {
  requireConfirmFlag();
  const result = await runParentResponseLiveDryRun();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
