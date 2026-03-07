import { execSync, spawn } from 'child_process';
import fetch from 'node-fetch';
import { API_LAYER_ROOT, WORKSPACE_ROOT } from './python-env';
import * as fs from 'fs';
import * as path from 'path';

const API_HEALTH_URL = 'http://127.0.0.1:8000/health';
const API_OPENAPI_URL = 'http://127.0.0.1:8000/openapi.json';
const REQUIRED_SERVER_PATHS = ['/api/v1/athlete/{contact_id}/admin/payments'];

/**
 * Checks if the FastAPI server is running.
 * If not, spawns it as a detached process.
 */
export async function ensureServerRunning(): Promise<void> {
  const serverState = await getServerState();
  if (serverState.ok && serverState.hasRequiredPaths) {
    return;
  }
  if (serverState.ok && !serverState.hasRequiredPaths) {
    console.log('NPID API Server is stale; restarting to load new routes...');
    stopServer();
  }

  console.log('Starting NPID API Server...');

  // Prefer API-layer venv (actual runtime), fallback to workspace venv.
  const venvPythonCandidates = [
    path.join(API_LAYER_ROOT, 'venv', 'bin', 'python'),
    path.join(WORKSPACE_ROOT, '.venv', 'bin', 'python'),
  ];
  const venvPython = venvPythonCandidates.find((candidate) => fs.existsSync(candidate));

  if (!venvPython) {
    throw new Error(
      `Venv Python not found. Checked: ${venvPythonCandidates.join(', ')}. Run: cd npid-api-layer && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`,
    );
  }

  // Spawn the server as a detached process
  // It will survive independent of the Raycast command lifecycle
  const child = spawn(
    venvPython,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'],
    {
      cwd: API_LAYER_ROOT,
      detached: true,
      stdio: 'ignore',
    },
  );

  child.unref();

  // Wait for server to become responsive
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250)); // Poll every 250ms
    const state = await getServerState();
    if (state.ok && state.hasRequiredPaths) {
      console.log('NPID API Server Started Successfully.');
      return;
    }
  }

  throw new Error('Failed to start NPID API Server within 5 seconds.');
}

function stopServer(): void {
  try {
    const pidsRaw = execSync('lsof -tiTCP:8000 -sTCP:LISTEN || true', { encoding: 'utf8' }).trim();
    if (!pidsRaw) return;
    pidsRaw
      .split('\n')
      .map((pid) => Number(pid.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
      .forEach((pid) => {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // ignore already-dead pids
        }
      });
  } catch {
    // ignore lsof failures
  }
}

async function getServerState(): Promise<{ ok: boolean; hasRequiredPaths: boolean }> {
  try {
    const health = await fetch(API_HEALTH_URL);
    if (!health.ok) {
      return { ok: false, hasRequiredPaths: false };
    }

    const openapi = await fetch(API_OPENAPI_URL);
    if (!openapi.ok) {
      return { ok: true, hasRequiredPaths: false };
    }
    const spec = (await openapi.json()) as { paths?: Record<string, unknown> };
    const knownPaths = Object.keys(spec.paths || {});
    const hasRequiredPaths = REQUIRED_SERVER_PATHS.every((pathKey) => knownPaths.includes(pathKey));
    return { ok: true, hasRequiredPaths };
  } catch {
    return { ok: false, hasRequiredPaths: false };
  }
}
