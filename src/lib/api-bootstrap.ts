import { execSync, spawn } from 'child_process';
import fetch from 'node-fetch';
import { WORKSPACE_ROOT } from './python-env';
import * as fs from 'fs';
import * as path from 'path';
import { searchLogger } from './logger';

const API_HEALTH_URL = 'http://127.0.0.1:8000/health';
const API_OPENAPI_URL = 'http://127.0.0.1:8000/openapi.json';
const STARTUP_POLL_INTERVAL_MS = 250;
const STARTUP_MAX_WAIT_MS = Number.parseInt(process.env.API_BOOTSTRAP_MAX_WAIT_MS || '25000', 10);
const OPENAPI_CHECK_INTERVAL_ATTEMPTS = 4;
const DEV_PROCESS_SCRIPT = path.join(WORKSPACE_ROOT, 'scripts', 'dev-processes.sh');
const OVERMIND_MANAGED_API = process.env.OVERMIND_MANAGED_API === '1';
const REQUIRED_SERVER_PATHS = [
  '/api/v1/athlete/{contact_id}/admin/payments',
  '/api/v1/tasks/list',
  '/api/v1/contacts/{contact_id}/enriched',
  '/api/v1/scout/tasks',
  '/api/v1/sales/stage',
  '/api/v1/sales/stages/{athlete_id}',
  '/api/v1/sales/meeting-set-template',
  '/api/v1/sales/meeting-set',
  '/api/v1/tasks/popup',
  '/api/v1/tasks/update',
  '/api/v1/tasks/complete',
  '/api/v1/tasks/call-attempt-3-sent',
  '/api/v1/calendar/head-scout-slots',
  '/api/v1/calendar/booked-meetings',
  '/api/v1/calendar/open-meetings',
  '/api/v1/calendar/booked-meeting/title',
];
const FEATURE = 'api-bootstrap';

let startupPromise: Promise<void> | null = null;

async function waitForManagedServer(): Promise<void> {
  const deadline = Date.now() + STARTUP_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const serverState = await getServerState();
    if (serverState.ok && serverState.hasRequiredPaths) {
      logInfo('API_BOOTSTRAP', 'await-managed-server', 'success', {
        serverReady: true,
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_INTERVAL_MS));
  }

  const finalState = await getServerState();
  const detail =
    finalState.ok && !finalState.hasRequiredPaths
      ? `Managed Overmind API is stale; missing routes: ${finalState.missingPaths.join(', ')}`
      : 'Managed Overmind API did not become ready in time';
  logFailure('API_BOOTSTRAP', 'await-managed-server', detail, {
    missingPaths: finalState.missingPaths,
    serverReady: finalState.ok,
  });
  throw new Error(detail);
}

function logInfo(
  event: string,
  step: string,
  status: 'start' | 'success',
  context?: Record<string, unknown>,
) {
  searchLogger.info(event, {
    event,
    step,
    status,
    feature: FEATURE,
    context: context || {},
  });
}

function logFailure(event: string, step: string, error: string, context?: Record<string, unknown>) {
  searchLogger.error(event, {
    event,
    step,
    status: 'failure',
    feature: FEATURE,
    error,
    context: context || {},
  });
}

/**
 * Checks if the FastAPI server is running.
 * If not, spawns it as a detached process.
 */
export async function ensureServerRunning(): Promise<void> {
  if (startupPromise) {
    console.log('NPID API Server startup already in progress; waiting for existing attempt...');
    logInfo('API_BOOTSTRAP', 'await-inflight-startup', 'start');
    try {
      await startupPromise;
      logInfo('API_BOOTSTRAP', 'await-inflight-startup', 'success');
    } catch (error) {
      logFailure(
        'API_BOOTSTRAP',
        'await-inflight-startup',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    return;
  }

  startupPromise = ensureServerRunningInner().finally(() => {
    startupPromise = null;
  });

  return startupPromise;
}

async function ensureServerRunningInner(): Promise<void> {
  const serverState = await getServerState();
  if (serverState.ok && serverState.hasRequiredPaths) {
    logInfo('API_BOOTSTRAP', 'check-server-state', 'success', {
      serverReady: true,
    });
    return;
  }
  if (OVERMIND_MANAGED_API) {
    logInfo('API_BOOTSTRAP', 'await-managed-server', 'start', {
      missingPaths: serverState.missingPaths,
      serverReady: serverState.ok,
    });
    await waitForManagedServer();
    return;
  }
  if (serverState.ok && !serverState.hasRequiredPaths) {
    console.log(
      `NPID API Server is stale; missing routes: ${serverState.missingPaths.join(', ') || 'unknown'}. Restarting...`,
    );
    logInfo('API_BOOTSTRAP', 'stale-server-detected', 'start', {
      missingPaths: serverState.missingPaths,
    });
    stopServer();
    logInfo('API_BOOTSTRAP', 'stale-server-detected', 'success', {
      missingPaths: serverState.missingPaths,
    });
  }

  console.log('Starting NPID API Server...');
  logInfo('API_BOOTSTRAP', 'spawn-server', 'start', {
    reason: serverState.ok ? 'stale-routes' : 'server-unavailable',
  });

  if (!fs.existsSync(DEV_PROCESS_SCRIPT)) {
    const message = `Dev process helper not found at ${DEV_PROCESS_SCRIPT}`;
    logFailure('API_BOOTSTRAP', 'resolve-dev-helper', message, {
      helperPath: DEV_PROCESS_SCRIPT,
    });
    throw new Error(message);
  }

  const child = spawn('bash', [DEV_PROCESS_SCRIPT, 'restart', 'api'], {
    cwd: WORKSPACE_ROOT,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  const maxPollAttempts = Math.ceil(STARTUP_MAX_WAIT_MS / STARTUP_POLL_INTERVAL_MS);

  for (let i = 0; i < maxPollAttempts; i++) {
    await new Promise((r) => setTimeout(r, STARTUP_POLL_INTERVAL_MS));
    const state =
      i % OPENAPI_CHECK_INTERVAL_ATTEMPTS === 0
        ? await getServerState()
        : await getServerHealthState();
    if (state.ok && state.hasRequiredPaths) {
      console.log('NPID API Server Started Successfully.');
      logInfo('API_BOOTSTRAP', 'spawn-server', 'success', {
        pollAttempt: i + 1,
      });
      return;
    }
  }

  const timeoutMessage = `Failed to start NPID API Server within ${STARTUP_MAX_WAIT_MS / 1000} seconds.`;
  console.log('NPID API Server startup timed out after final poll.');
  logFailure('API_BOOTSTRAP', 'spawn-server', timeoutMessage, {
    timeoutMs: STARTUP_MAX_WAIT_MS,
  });
  throw new Error(timeoutMessage);
}

function stopServer(): void {
  let targetPids: number[] = [];
  try {
    const pidsRaw = execSync('lsof -tiTCP:8000 -sTCP:LISTEN || true', { encoding: 'utf8' }).trim();
    if (!pidsRaw) return;
    targetPids = pidsRaw
      .split('\n')
      .map((pid) => Number(pid.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    targetPids.forEach((pid) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // ignore already-dead pids
      }
    });
  } catch {
    // ignore lsof failures
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const remainingPids = getListeningPidsOn8000();
    if (!remainingPids.some((pid) => targetPids.includes(pid))) {
      return;
    }
    execSync('sleep 0.1');
  }

  targetPids.forEach((pid) => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore already-dead pids
    }
  });
}

function getListeningPidsOn8000(): number[] {
  try {
    const pidsRaw = execSync('lsof -tiTCP:8000 -sTCP:LISTEN || true', { encoding: 'utf8' }).trim();
    if (!pidsRaw) {
      return [];
    }
    return pidsRaw
      .split('\n')
      .map((pid) => Number(pid.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function getServerState(): Promise<{
  ok: boolean;
  hasRequiredPaths: boolean;
  missingPaths: string[];
}> {
  try {
    const healthState = await getServerHealthState();
    if (!healthState.ok) return healthState;
    return await getServerRoutesState();
  } catch {
    return { ok: false, hasRequiredPaths: false, missingPaths: REQUIRED_SERVER_PATHS };
  }
}

async function getServerRoutesState(): Promise<{
  ok: boolean;
  hasRequiredPaths: boolean;
  missingPaths: string[];
}> {
  try {
    const openapi = await fetch(API_OPENAPI_URL);
    if (!openapi.ok) {
      return { ok: true, hasRequiredPaths: false, missingPaths: REQUIRED_SERVER_PATHS };
    }
    const spec = (await openapi.json()) as { paths?: Record<string, unknown> };
    const knownPaths = Object.keys(spec.paths || {});
    const missingPaths = REQUIRED_SERVER_PATHS.filter((pathKey) => !knownPaths.includes(pathKey));
    return { ok: true, hasRequiredPaths: missingPaths.length === 0, missingPaths };
  } catch {
    return { ok: true, hasRequiredPaths: false, missingPaths: REQUIRED_SERVER_PATHS };
  }
}

async function getServerHealthState(): Promise<{
  ok: boolean;
  hasRequiredPaths: boolean;
  missingPaths: string[];
}> {
  try {
    const health = await fetch(API_HEALTH_URL);
    if (!health.ok) {
      return { ok: false, hasRequiredPaths: false, missingPaths: REQUIRED_SERVER_PATHS };
    }
    return { ok: true, hasRequiredPaths: false, missingPaths: REQUIRED_SERVER_PATHS };
  } catch {
    return { ok: false, hasRequiredPaths: false, missingPaths: REQUIRED_SERVER_PATHS };
  }
}
