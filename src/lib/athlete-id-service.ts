/**
 * Central athlete ID resolution and caching service.
 *
 * INVARIANT: athlete_main_id ≠ athlete_id (they are DISTINCT values)
 *
 * Resolution sources (in priority order):
 * 1. SQLite cache (instant)
 * 2. FastAPI /athlete/{id}/resolve (server-side)
 * 3. Fallback: use athlete_id if all else fails (per ATHLETE_MAIN_ID_INVARIANT.md)
 *
 * This module centralizes all athlete_main_id resolution and ensures
 * cache write-backs happen consistently across all call sites.
 */

import { apiFetch } from './python-server-client';
import { cacheAthleteMainId, getCachedAthleteMainId } from './video-progress-cache';
import { logger } from './logger';

export interface AthleteIds {
  athleteId: string;
  athleteMainId: string;
  source: 'cache' | 'api' | 'fallback';
}

/**
 * Resolve athlete_main_id with automatic cache population.
 * Always writes back to cache on successful API fetch.
 *
 * @param athleteId - The athlete_id to resolve
 * @returns AthleteIds object with source indicator, or null if invalid input
 */
export async function resolveAndCacheAthleteMainId(
  athleteId: string | number
): Promise<AthleteIds | null> {
  const id = String(athleteId);
  const numericId = parseInt(id, 10);

  if (!id || isNaN(numericId) || numericId <= 0) {
    logger.warn('Invalid athleteId provided to resolver', { athleteId });
    return null;
  }

  // 1. Check cache first
  const cached = await getCachedAthleteMainId(numericId);
  if (cached) {
    logger.debug('athlete_main_id cache HIT', { athleteId: id, athleteMainId: cached });
    return { athleteId: id, athleteMainId: cached, source: 'cache' };
  }

  // 2. Fetch from API
  try {
    const response = await apiFetch(`/athlete/${encodeURIComponent(id)}/resolve`);
    if (response.ok) {
      const data = (await response.json()) as { athlete_main_id?: string };
      if (data.athlete_main_id) {
        // ALWAYS write back to cache
        await cacheAthleteMainId(numericId, data.athlete_main_id);
        return {
          athleteId: id,
          athleteMainId: data.athlete_main_id,
          source: 'api',
        };
      }
    }
  } catch (error) {
    logger.error('Failed to resolve athlete_main_id from API', { athleteId: id, error });
  }

  // 3. Fallback: use athlete_id as athlete_main_id (per documented invariant workaround)
  logger.warn('Using athlete_id as athlete_main_id fallback', { athleteId: id });
  return { athleteId: id, athleteMainId: id, source: 'fallback' };
}

/**
 * Simple helper to get just the athlete_main_id string.
 * Returns null if resolution fails entirely.
 */
export async function getAthleteMainId(athleteId: string | number): Promise<string | null> {
  const result = await resolveAndCacheAthleteMainId(athleteId);
  return result?.athleteMainId || null;
}

/**
 * Batch resolve and cache athlete_main_ids for a list of tasks.
 * Called after fetching video progress to proactively populate cache.
 *
 * Strategy:
 * - If task already has athlete_main_id, cache it immediately
 * - For tasks missing athlete_main_id, check cache first
 * - Only API-resolve those that are truly missing
 * - Limit to 20 resolutions per batch to avoid overwhelming API
 *
 * @param tasks - Array of task objects with athlete_id and optional athlete_main_id
 */
export async function batchResolveAndCache(
  tasks: Array<{ athlete_id: number | string; athlete_main_id?: string }>
): Promise<{ cached: number; resolved: number; failed: number }> {
  const stats = { cached: 0, resolved: 0, failed: 0 };
  const needsResolution: number[] = [];

  for (const task of tasks) {
    const numericId =
      typeof task.athlete_id === 'string' ? parseInt(task.athlete_id, 10) : task.athlete_id;

    if (isNaN(numericId) || numericId <= 0) continue;

    // If task has athlete_main_id from API response, cache it immediately
    if (task.athlete_main_id && task.athlete_main_id !== '') {
      await cacheAthleteMainId(numericId, String(task.athlete_main_id));
      stats.cached++;
    } else {
      // Check if already cached
      const cached = await getCachedAthleteMainId(numericId);
      if (cached) {
        stats.cached++;
      } else {
        needsResolution.push(numericId);
      }
    }
  }

  // Resolve missing in batches of 5 (avoid overwhelming API)
  // Limit to 20 total per call to keep response times reasonable
  const toResolve = needsResolution.slice(0, 20);
  const batches = chunk(toResolve, 5);

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((id) => resolveAndCacheAthleteMainId(id))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        if (result.value.source === 'api') {
          stats.resolved++;
        } else if (result.value.source === 'fallback') {
          stats.failed++; // Fallback indicates we couldn't get the real ID
        }
      } else {
        stats.failed++;
      }
    }
  }

  logger.debug('Batch resolution complete', {
    total: tasks.length,
    fromCache: stats.cached,
    apiResolved: stats.resolved,
    failed: stats.failed,
    skipped: needsResolution.length - toResolve.length,
  });

  return stats;
}

/**
 * Ensure both athlete_id and athlete_main_id are available.
 * Convenience wrapper that normalizes input and returns both IDs.
 *
 * @param athleteId - The athlete_id
 * @param athleteMainId - Optional pre-known athlete_main_id
 * @returns Object with both IDs, or null if resolution fails
 */
export async function ensureAthleteIds(
  athleteId: string | number | null | undefined,
  athleteMainId?: string | null | undefined
): Promise<{ athleteId: string; athleteMainId: string } | null> {
  if (!athleteId) return null;

  const id = String(athleteId);

  // If both already provided, return them (but still cache if mainId is new)
  if (athleteMainId) {
    const numericId = parseInt(id, 10);
    if (!isNaN(numericId) && numericId > 0) {
      // Opportunistically cache if not already cached
      const cached = await getCachedAthleteMainId(numericId);
      if (!cached) {
        await cacheAthleteMainId(numericId, athleteMainId);
      }
    }
    return { athleteId: id, athleteMainId };
  }

  // Resolve athlete_main_id
  const result = await resolveAndCacheAthleteMainId(athleteId);
  if (!result) return null;

  return { athleteId: result.athleteId, athleteMainId: result.athleteMainId };
}

// Helper function to split array into chunks
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}
