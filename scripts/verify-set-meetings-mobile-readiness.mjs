#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readRows } from '../src/domain/supabase-persistence.ts';
import { resolveSupabaseCredentials } from './supabase-credentials.mjs';

const REPO_ROOT = process.cwd();
const DEFAULT_API_BASE = 'http://127.0.0.1:8000/api/v1';
const DEFAULT_PROSPECT_WEB_BASE = 'https://prospect-web.vercel.app';
const EASTERN_TIME_ZONE = 'America/New_York';

function readEnvFile(filePath) {
  try {
    const values = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !process.env[key]) values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

function loadLocalEnv() {
  const env = {
    ...readEnvFile(path.join(REPO_ROOT, 'npid-api-layer/.env')),
    ...readEnvFile(path.join(REPO_ROOT, '.env')),
    ...readEnvFile(path.join(REPO_ROOT, '.overmind.env')),
  };
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function easternDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function formatDateKey(date) {
  const parts = easternDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function buildDefaultWindow(now = new Date()) {
  const startOverride = String(process.env.START_DATE || '').trim();
  const endOverride = String(process.env.END_DATE || '').trim();
  if (startOverride && endOverride) return { start: startOverride, end: endOverride };

  const parts = easternDateParts(now);
  const start = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 16, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Number(process.env.WINDOW_DAYS || 8));
  return { start: formatDateKey(start), end: formatDateKey(end) };
}

function getApiToken() {
  return (
    String(process.env.PROSPECT_API_TOKEN || '').trim() ||
    String(process.env.INTERNAL_API_SECRET || '').trim() ||
    String(process.env.CALL_TRACKER_SYNC_SECRET || '').trim()
  );
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GUARD_TIMEOUT_MS || 30000));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function runResolver(windowRange) {
  const result = spawnSync(
    'npm',
    ['run', 'resolve:set-meeting-confirmation-cache', '--silent'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        START_DATE: windowRange.start,
        END_DATE: windowRange.end,
        LIMIT: String(process.env.LIMIT || 100),
      },
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        'confirmation cache resolver failed',
        result.stderr.trim(),
        result.stdout.trim(),
      ].filter(Boolean).join('\n'),
    );
  }

  const parsed = JSON.parse(result.stdout);
  if (Array.isArray(parsed.failures) && parsed.failures.length) {
    throw new Error(`confirmation cache resolver had failures: ${JSON.stringify(parsed.failures, null, 2)}`);
  }
  return parsed;
}

async function fetchLiveSetMeetings(windowRange) {
  const apiBase = String(process.env.API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const url = new URL(`${apiBase}/mobile/set-meetings`);
  url.searchParams.set('start', windowRange.start);
  url.searchParams.set('end', windowRange.end);
  url.searchParams.set('task_range', process.env.TASK_RANGE || 'thisWeek');
  const token = getApiToken();
  const payload = await fetchJson(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return { payload, events };
}

async function readConfirmationCacheRows(config, windowRange) {
  return readRows(
    config,
    'set_meeting_confirmation_cache',
    [
      'select=appointment_id,kind,athlete_name,recipient_phone,meeting_starts_at,meeting_timezone,message_body',
      `meeting_starts_at=gte.${encodeURIComponent(`${windowRange.start}T00:00:00.000Z`)}`,
      `meeting_starts_at=lt.${encodeURIComponent(`${windowRange.end}T00:00:00.000Z`)}`,
      'order=meeting_starts_at.asc',
    ].join('&'),
  );
}

function findCacheGaps(events, cacheRows) {
  const rowsByAppointment = new Map();
  for (const row of cacheRows) {
    const id = String(row.appointment_id || '').trim();
    if (!id) continue;
    if (!rowsByAppointment.has(id)) rowsByAppointment.set(id, []);
    rowsByAppointment.get(id).push(row);
  }

  return events.flatMap((event) => {
    const id = String(event.event_id || '').trim();
    const rows = rowsByAppointment.get(id) || [];
    const kinds = new Set(rows.map((row) => String(row.kind || '').trim()));
    const rowProblems = [];
    if (!kinds.has('confirmation_1')) rowProblems.push('missing confirmation_1');
    if (!kinds.has('confirmation_2')) rowProblems.push('missing confirmation_2');
    for (const row of rows) {
      if (!String(row.message_body || '').trim()) rowProblems.push(`${row.kind || 'unknown'} empty message_body`);
      if (!String(row.recipient_phone || '').trim()) rowProblems.push(`${row.kind || 'unknown'} missing recipient_phone`);
      if (!String(row.meeting_timezone || '').trim()) rowProblems.push(`${row.kind || 'unknown'} missing meeting_timezone`);
    }
    return rowProblems.length
      ? [{ appointmentId: id, title: event.title, athleteName: event.athlete_name, problems: rowProblems }]
      : [];
  });
}

async function checkSchedulesRoute(windowRange) {
  const apiBase = String(process.env.API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const token = getApiToken();
  const localUrl = new URL(`${apiBase}/mobile/calendar/head-scout-slots`);
  localUrl.searchParams.set('start', windowRange.start);
  localUrl.searchParams.set('end', windowRange.end);
  const localPayload = await fetchJson(localUrl, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  const webBase = String(process.env.PROSPECT_WEB_BASE || DEFAULT_PROSPECT_WEB_BASE).replace(/\/+$/, '');
  const productionUrl = new URL(`${webBase}/api/head-scout-schedules`);
  productionUrl.searchParams.set('week', 'this');
  let production = { ok: true, error: '', scoutCount: 0 };
  try {
    const productionPayload = await fetchJson(productionUrl);
    production = {
      ok: true,
      error: '',
      scoutCount: Array.isArray(productionPayload?.scouts) ? productionPayload.scouts.length : 0,
    };
  } catch (error) {
    production = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      scoutCount: 0,
    };
  }

  return {
    local: {
      ok: true,
      scoutCount: Array.isArray(localPayload?.scouts) ? localPayload.scouts.length : 0,
    },
    production,
  };
}

loadLocalEnv();

const windowRange = buildDefaultWindow();
const { projectRef, url, serviceRoleKey, schema } = resolveSupabaseCredentials(REPO_ROOT);
if (!url || !serviceRoleKey) {
  throw new Error(`Missing Supabase credentials for confirmation cache guard. Linked project: ${projectRef || 'missing'}`);
}

const supabaseConfig = { url, key: serviceRoleKey, schema };
const resolver = runResolver(windowRange);
const live = await fetchLiveSetMeetings(windowRange);
const cacheRows = await readConfirmationCacheRows(supabaseConfig, windowRange);
const gaps = findCacheGaps(live.events, cacheRows);
const schedules = await checkSchedulesRoute(windowRange);

const appointmentCount = new Set(cacheRows.map((row) => String(row.appointment_id || '').trim()).filter(Boolean)).size;
const summary = {
  ok: gaps.length === 0 && schedules.local.ok && schedules.production.ok,
  window: windowRange,
  resolver: {
    appointmentsWritten: resolver.appointmentsWritten,
    cacheRowsPrepared: resolver.cacheRowsPrepared,
  },
  liveSetMeetings: {
    count: live.events.length,
    rawBookedCount: live.payload?.raw_booked_count,
  },
  confirmationCache: {
    appointmentCount,
    rowCount: cacheRows.length,
    gaps,
  },
  schedules,
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}
