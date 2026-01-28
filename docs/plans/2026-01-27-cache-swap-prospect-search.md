---
title: Cache Swap → Raw Search Revert → Prospect Search Command
date: 2026-01-27
owner: Jerami Singleton / Codex
status: in-progress
scope: cache-swap-first
---

# Kiro Spec: Cache Swap → Raw Search Revert → Prospect Search

## Goals
- Replace WASM/sql.js cache writes with real SQLite (inspectable, stable sorting).
- Restore Video Progress Raw Search to original video-progress-focused behavior.
- Introduce a new **Prospect Search** Raycast command for global athlete search + selection + verification.
- Add selected prospect records into the new SQLite cache.
- Decide whether the MCP search server is still useful; remove if redundant.

## Non-Goals (for cache swap phase)
- No overhaul of FastAPI/legacy translator logic.
- No refactor of unrelated commands or inbox flows.

## Constraints / Musts
- Minimal surface change first (cache swap).
- Inspectable DB file in `~/.prospect-pipeline/`.
- Preserve existing cache schema where possible.
- Keep WASM/sql.js path read-only fallback until cutover.
- Avoid touching unrelated files.

## Phases
1) **Cache swap (first)**
   - Add native SQLite backend.
   - Keep current SQL.js export for fallback / verification.
   - Ensure all reads/writes go to native DB when enabled.

2) **Raw Search revert**
   - Restore Video Progress raw search to prior behavior (video-progress-focused filtering).

3) **Prospect Search command**
   - New Raycast command:
     - Parse name/email input.
     - Show candidate list.
     - Confirm selection with simple verification view.
     - Persist selection into new DB cache.

4) **MCP / AI extension review**
   - Decide on keep/remove based on overlap and maintenance cost.

## Risks
- Native SQLite dependency build on Raycast environment.
- Schema drift between SQL.js and native DB.
- Inconsistent sorting until cache swap stabilizes.

## Success Criteria
- DB can be opened in DB Browser for SQLite.
- Cache order matches website consistently.
- Raw Search in Video Progress is clean and focused.
- Prospect Search command provides clear selection + verification.

