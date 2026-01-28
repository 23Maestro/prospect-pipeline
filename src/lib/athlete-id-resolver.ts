/**
 * Athlete ID Resolution Helper
 *
 * @deprecated This module is deprecated. Use athlete-id-service.ts instead.
 *
 * FIELD ALIASES (CANONICAL MAPPING):
 * - athlete_id == contact_id (same value, context-dependent name)
 * - messageid == video_msg_id (same value, context-dependent name)
 * - athlete_main_id ≠ athlete_id (DISTINCT values)
 *
 * This file re-exports from athlete-id-service.ts for backward compatibility.
 */

// Re-export from central service for backward compatibility
export {
  resolveAndCacheAthleteMainId as resolveAthleteMainId,
  ensureAthleteIds,
  getAthleteMainId,
} from './athlete-id-service';
