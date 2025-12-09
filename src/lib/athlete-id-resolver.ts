/**
 * Athlete ID Resolution Helper
 *
 * FIELD ALIASES (CANONICAL MAPPING):
 * - athlete_id == contact_id (same value, context-dependent name)
 * - messageid == video_msg_id (same value, context-dependent name)
 * - athlete_main_id ≠ athlete_id (DISTINCT values)
 */

import { apiFetch } from './python-server-client';
import { cacheAthleteMainId, getCachedAthleteMainId } from './video-progress-cache';

/**
 * Resolve athlete_main_id from athlete_id.
 * Checks SQLite cache first, then fetches from API if needed.
 */
export async function resolveAthleteMainId(athleteId: string): Promise<string | null> {
  if (!athleteId) return null;

  // Check cache first
  const cached = await getCachedAthleteMainId(parseInt(athleteId));
  if (cached) return cached;

  // Fetch from API and store
  try {
    const response = await apiFetch(`/athlete/${encodeURIComponent(athleteId)}/resolve`);

    if (!response.ok) {
      console.error(`Failed to resolve athlete_main_id for ${athleteId}: ${response.status}`);
      return null;
    }

    const data = await response.json() as { athlete_main_id?: string };
    const mainId = data.athlete_main_id || null;

    if (mainId) {
      await cacheAthleteMainId(parseInt(athleteId), mainId);
    }

    return mainId;
  } catch (error) {
    console.error(`Error resolving athlete_main_id for ${athleteId}:`, error);
    return null;
  }
}

/**
 * Ensure both athlete_id and athlete_main_id are available.
 * Normalizes field aliases and returns canonical IDs.
 */
export async function ensureAthleteIds(
  athleteId: string | null | undefined,
  athleteMainId?: string | null | undefined
): Promise<{ athleteId: string; athleteMainId: string } | null> {
  if (!athleteId) return null;

  // If both already provided, return them
  if (athleteMainId) {
    return { athleteId, athleteMainId };
  }

  // Resolve athlete_main_id (checks cache first, then API)
  const resolvedMainId = await resolveAthleteMainId(athleteId);
  if (!resolvedMainId) return null;

  return { athleteId, athleteMainId: resolvedMainId };
}
