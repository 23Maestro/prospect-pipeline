import { executePythonScript } from "./python-executor";
import { NPID_CLIENT_PATH } from "./python-config";
import { ensureServerRunning } from "./api-bootstrap";
import fetch, { RequestInit } from "node-fetch";

export const API_BASE = "http://127.0.0.1:8000/api/v1";

export interface SeasonsRequest {
  athleteId: string;
  athleteMainId: string;
  videoType: string;
  sportAlias: string;
}

/**
 * Call the NPID API Python client
 * @param method - Method name to call on the Python client
 * @param args - Arguments to pass to the method
 * @returns Parsed JSON response from Python client
 * @throws Error if the Python client fails or returns invalid JSON
 */
export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return executePythonScript<T>(NPID_CLIENT_PATH, method, args, {
    contextName: "NPID Client",
  });
}

/**
 * Wrapper for fetch that ensures the API server is running before request
 */
export async function apiFetch(endpoint: string, options?: RequestInit) {
  await ensureServerRunning();
  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : "/" + endpoint}`;
  return fetch(url, options);
}

/**
 * Fetch seasons from FastAPI (which proxies to Laravel).
 * Returns Laravel's JSON response directly.
 */
export async function getSeasons(params: SeasonsRequest) {
  const response = await apiFetch("/video/seasons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: params.athleteId,
      athlete_main_id: params.athleteMainId,
      video_type: params.videoType,
      sport_alias: params.sportAlias,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch seasons (HTTP ${response.status})`);
  }

  return response.json();
}
