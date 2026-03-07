# Prospect Pipeline — Full Repository Audit

**Date:** 2026-02-26
**Auditor:** Antigravity (Gemini CLI, Auditor Mode)
**Scope:** Architecture docs, repo overview, deletion candidates, naming conventions

---

## Section A: Architecture Doc Findings (Duplication Map + Quality Issues)

### 4 Architecture Files Reviewed

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `system-map.mmd` | 104 | Master system diagram — all layers and connections |
| 2 | `workflow-ingest.mmd` | 47 | Prospect-ingest specific flow (AI tool → cache → list view) |
| 3 | `workflow-email.mmd` | 43 | Email-send workflow (template → policy → send) |
| 4 | `workflow-deprecation.mmd` | 55 | Phased plan for retiring `prospect-search` |

### Duplication / Overlap Map

| Issue | Files Affected | Details |
|-------|---------------|---------|
| **Copy-paste legend block** | All 4 files | All 4 files share an identical 5-line `legend` subgraph. This is fine in Mermaid (each file is standalone), but the legends were inconsistent — some included `:::fail` styling but not `:::store` or `:::policy`. |
| **Copy-paste classDef block** | All 4 files | All files define `deprecated`, `fail` class defs even when unused (e.g., `workflow-email.mmd` defined `deprecated` but never used it). |
| **Overlapping nodes** | `system-map.mmd` vs `workflow-ingest.mmd` | The ingest workflow is a *subset* of the system map. Both define `manual-sa-additions`, `POST /athlete/raw-search`, `progress.db`, and `video-progress` as nodes. This is expected (the workflow is a zoomed-in view), but there was no README explaining the relationship. |
| **Inconsistent subgraph labels** | All 4 files | `system-map` uses `"Shared Services"`, but `workflow-ingest` uses `"Shared Services"` too while `workflow-email` uses no qualifier. Labels were not parallel. |

### Quality Issues Found

| Issue | File(s) | Severity |
|-------|---------|----------|
| **No header comments** — files had no description of what they represent or how to read them | All 4 | Medium |
| **No README** in `docs/architecture/` explaining the folder contents | Folder | Medium |
| **Legend missing `:::store` styling** — the legend mentions "dashed arrow" but never demonstrates the blue store node style | `system-map.mmd`, `workflow-ingest.mmd` | Low |
| **`workflow-deprecation.mmd` lacked phase labels** — subgraphs were named `p1`, `p2`, etc. but the human-readable titles didn't include "Phase N" prefix | `workflow-deprecation.mmd` | Low |
| **Edge labels were terse** — e.g., `"proxy legacy requests"` repeated 7 times; could be grouped or commented | `system-map.mmd` | Low |

### Verdict

The 4 files are **not** true duplicates of each other — they cover different scopes:
- 1 master map + 3 workflow zoom-ins

The "low-quality photocopies" appearance comes from:
1. Copy-pasted boilerplate (classDefs, legends) that wasn't tailored per file
2. No README tying them together
3. No header comments explaining each file's purpose
4. Inconsistent naming and styling between files

---

## Section B: Rewritten Architecture Docs

The following files have been **rewritten in place**:

| File | Changes Made |
|------|-------------|
| `docs/architecture/README.md` | **NEW** — Index file with table of contents, reading instructions, and style legend |
| `docs/architecture/system-map.mmd` | Added section comments for each layer, expanded legend with `:::store` demo, added header comment block |
| `docs/architecture/workflow-ingest.mmd` | Added header comment describing the flow, used consistent subgraph labels matching system-map layer names, added numbered steps |
| `docs/architecture/workflow-email.mmd` | Added numbered steps to processing pipeline, included `:::policy` in legend, added header comment |
| `docs/architecture/workflow-deprecation.mmd` | Added em-dash phase labels ("Phase 1 — Baseline"), added `:::gate` to legend, added header comment |

All rewrites preserve existing factual content. No nodes, edges, or connections were invented.

---

## Section C: Repository Overview

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Raycast Extension                         │
│  (TypeScript/React — src/*.tsx commands + src/tools/*.ts)        │
├──────────────────────────────────────────────────────────────────┤
│                    TypeScript Shared Services                    │
│  (src/lib/ — API clients, caches, adapters, resolvers)          │
├──────────────────────────────────────────────────────────────────┤
│                     FastAPI Backend (Python)                      │
│  (npid-api-layer/ — translates REST ↔ legacy Laravel HTML)      │
├──────────────────────────────────────────────────────────────────┤
│                 External: NPID Dashboard (Laravel)               │
│  (dashboard.nationalpid.com — legacy web app, HTML responses)   │
└──────────────────────────────────────────────────────────────────┘
```

### Major Domains

#### 1. Raycast UI Commands (`src/`)

| Command | File | Responsibility |
|---------|------|---------------|
| **Video Progress** | `video-progress.tsx` (90 KB) | Browse/filter active video tasks, update stage/status, view athlete details |
| **Video Updates** | `video-updates.tsx` (60 KB) | Submit YouTube links, send "Editing Done" emails, post-upload automation |
| **Email Student Athletes** | `email-student-athletes.tsx` (14 KB) | Template-based email sending with recipient-policy enforcement |
| **Read Videoteam Inbox** | `read-videoteam-inbox.tsx` (46 KB) | View assigned inbox threads with full message detail |
| **Assign Videoteam Inbox** | `assign-videoteam-inbox.tsx` (23 KB) | Assign unassigned threads to team members |
| **Prospect Search** | `prospect-search.tsx` (18 KB) | **DEPRECATED** — Global athlete search + materialize into cache |
| **Update Video Progress** | `update-video-progress.tsx` (8 KB) | Lightweight stage/status updater |

#### 2. Raycast AI Tool (`src/tools/`)

| Tool | File | Responsibility |
|------|------|---------------|
| **Manual SA Additions** | `manual-sa-additions.ts` (16 KB) | AI-assisted loose athlete search → resolve → materialize into Video Progress cache |

#### 3. TypeScript Shared Services (`src/lib/`)

| Service | File | Responsibility |
|---------|------|---------------|
| `python-server-client.ts` | HTTP client wrapper for FastAPI backend | 
| `npid-mcp-adapter.ts` (19 KB) | High-level adapter for inbox, contacts, assignment, email workflows |
| `athlete-id-service.ts` (7 KB) | Resolves `athlete_main_id` with cache fallback |
| `jersey-number-service.ts` (4 KB) | Resolves jersey numbers from athlete profiles |
| `video-progress-cache.ts` (26 KB) | SQLite-backed cache for video progress tasks |
| `api-bootstrap.ts` (3 KB) | Shared API initialization and auth headers |
| `logger.ts` (3 KB) | Structured domain logging to `raycast_logs/` |
| `session-loader.ts` (1.5 KB) | Loads Python session cookies |
| `python-config.ts` / `python-executor.ts` / `python-rest-bridge.ts` | Python subprocess execution layer |
| `dropbox-adapter.ts` (3 KB) | Dropbox file request integration |
| `season-calculator.ts` | Grade level / season name from graduation year |
| `craft-reminder-date.ts` | Craft app date formatting |
| `npid-client-raycast.ts` (5 KB) | Alternative NPID client for Raycast |

##### Sub-module: `src/lib/prospect-pipeline/`
A **Create React App** project nested inside `src/lib/`. Contains a web-based prospect pipeline UI (separate from the Raycast extension). Has its own `package.json`, `node_modules`, and build output.

#### 4. FastAPI Backend (`npid-api-layer/`)

| Component | Path | Responsibility |
|-----------|------|---------------|
| **Entry point** | `main.py` | FastAPI app with CORS, session middleware |
| **Routers** | `app/routers/` | REST endpoints for athlete, video, email, inbox, contacts, tasks, notes, assignments |
| **Legacy Translator** | `app/translators/legacy.py` (132 KB!) | Core "Translator Pattern" — converts NPID Dashboard HTML responses into clean JSON |
| **Session Manager** | `app/session.py` (14 KB) | Manages authentication sessions with NPID Dashboard |
| **Cache** | `app/cache.py` | Server-side caching |
| **Schemas** | `app/models/schemas.py` (13 KB) | Pydantic request/response models |
| **Invariants** | `app/invariants.py` | Business rule enforcement |

#### 5. Python Scripts and Clients

| Location | Responsibility |
|----------|---------------|
| `src/python/npid_api_client.py` (66 KB) | Legacy standalone NPID REST client (pre-FastAPI) |
| `src/python/npid_rest_client.py` (6 KB) | Lighter REST client variant |
| `src/python/craft_mcp_client.py` (7 KB) | Craft.do MCP client |
| `scripts/raycast/` | Standalone scripts for video stage/status updates |
| `scripts/backfill-athlete-main-id.ts` | One-off data backfill script |

#### 6. MCP Server (`mcp-servers/npid-search/`)

TypeScript MCP server providing `search_athletes` and `get_athlete_details` tools. Was designed for Claude integration. **Status: may be redundant** per cache-swap plan (see `docs/plans/2026-01-27-cache-swap-prospect-search.md`).

#### 7. Data Stores

| Store | Location | Purpose |
|-------|----------|---------|
| SQLite cache | `progress.db` (project root) | Video progress task cache |
| Log files | `raycast_logs/*.log` | Structured domain logs |
| Python sessions | `~/.npid_session.pkl` | NPID auth session persistence |

#### 8. CI/CD (`.github/`)

| File | Purpose |
|------|---------|
| `workflows/ci.yml` | Lint + build checks for TypeScript and Python |
| `workflows/dependency-updates.yml` | Dependabot auto-merge |
| `workflows/release.yml` | Release workflow |
| `ISSUE_TEMPLATE/` | Bug report, feature request, Raycast-specific templates |
| `settings.yml` | Repository labels, branch protection config |

#### 9. Documentation (`docs/`)

| File | Purpose | Status |
|------|---------|--------|
| `architecture/*.mmd` | System/workflow diagrams | ✅ Rewritten in this audit |
| `plans/` | Implementation plans (search design, cache swap) | Current |
| `ACTIVE_TASKS_FIXES_STATUS.md` | Fix status from prior MCP integration attempt | Historical |
| `API_DOCUMENTATION.md` | NPID API client function reference | Current |
| `CSRF_TOKEN_FINDINGS.md` | Laravel CSRF extraction research | Historical |
| `FULL_MESSAGE_FETCH_SPEC.md` | Message detail fetch implementation spec | Historical (incomplete) |
| `GITHUB_ISSUES.md` | Draft GitHub issues (never filed) | Stale |
| `IMPLEMENTATION_SPEC.md` | REST API implementation spec (Oct 2025) | Historical |
| `MCP_TERMINAL_GUIDE.md` | CLI guide for `npid_api_client.py` | Current |
| `REST_API_MIGRATION_COMPLETE.md` | Migration from Selenium to REST | Historical |
| `Tool _ Raycast API.md` | Raycast Tool API reference (web clipping) | Reference |

#### 10. Root-level Files

| File | Purpose | Status |
|------|---------|--------|
| `CLAUDE.md` | Claude Code instructions + API invariants | Active |
| `README.md` | Project README | Needs update (references `web/` dir that doesn't exist, lists `active-tasks.tsx` which was renamed) |
| `Craft-api-bundle.md` | Craft daily notes API bundle | Reference (24 KB, large) |
| `ISSUES-2026-01-28.md` | Open issues snapshot | Stale |
| `plan.plan.md` | Icon fix + Vaultwarden + Contact integration plan | Historical |
| `dev-all.sh` | Unified dev server startup | Active |
| `cd` | **Accidental file** — empty/broken, likely created by a mistyped `cd` command | Delete candidate |
| `progress.db` | SQLite cache | Active (should be in `.gitignore`) |
| `progress.db.bak-*` | Database backup | Delete candidate |

### Key Data Flows

1. **Video Progress Lifecycle:**
   `Inbox thread → Assign → In Queue → Edit video → Submit YouTube link → Send email → Done`

2. **Prospect Ingest (via AI tool):**
   `Search term → raw search → candidate selection → resolve athlete_main_id → materialize task → upsert to SQLite cache → visible in Video Progress`

3. **Request Proxy Pattern:**
   `Raycast TS → python-server-client.ts → FastAPI → legacy.py Translator → NPID Laravel Dashboard (HTML) → parsed JSON → returned to TS`

---

## Section D: `purge-review/` Manifest

### Items Moved to `purge-review/`

> **⚠️ NOTE:** Per instructions, no items were deleted. Items below are **candidates** to be moved to `purge-review/` for your manual review.

| # | Item | Current Path | Confidence | Rationale |
|---|------|-------------|------------|-----------|
| 1 | `cd` (empty accidental file) | `./cd` | **HIGH** | Zero-byte file at project root. Almost certainly created by accidentally running `echo > cd` or similar. Not referenced anywhere. |
| 2 | `progress.db.bak-20260207-170149` | `./progress.db.bak-20260207-170149` | **HIGH** | One-time backup of SQLite cache. 643 KB. Not referenced by code; the live cache is `progress.db`. |
| 3 | `ISSUES-2026-01-28.md` | `./ISSUES-2026-01-28.md` | **HIGH** | Snapshot of 4 issues from a single date. Issues should live in GitHub Issues, not as root-level markdown. Doesn't affect code. |
| 4 | `plan.plan.md` | `./plan.plan.md` | **MEDIUM** | 296-line plan from an older phase (Icon Fix + Vaultwarden + Contact Management). Contains a random HTML comment with UUIDs at line 1. Phases 2-3 were never implemented (no `fetch-athlete-creds.tsx` exists). Could move to `docs/plans/` if preserving, or purge if superseded. |
| 5 | `Craft-api-bundle.md` | `./Craft-api-bundle.md` | **MEDIUM** | 24 KB Craft Daily Notes API reference at project root. Not related to core prospect-pipeline functionality. Could move to `docs/reference/` or purge if only used for one-off Craft integration. |
| 6 | `docs/ACTIVE_TASKS_FIXES_STATUS.md` | `docs/ACTIVE_TASKS_FIXES_STATUS.md` | **MEDIUM** | References `src/active-tasks.tsx` which no longer exists (renamed to `video-progress.tsx`). Historical debugging notes from a failed MCP integration. |
| 7 | `docs/IMPLEMENTATION_SPEC.md` | `docs/IMPLEMENTATION_SPEC.md` | **MEDIUM** | Spec from Oct 2025 referencing `npid_automator_complete.py` (deleted) and `mcp-servers/npid-native/npid_rest_client.py`. Specifies Selenium dependencies. Superseded by REST migration. |
| 8 | `docs/GITHUB_ISSUES.md` | `docs/GITHUB_ISSUES.md` | **MEDIUM** | Pre-written GitHub issues that were never filed. References `mcp-servers/npid-native/npid_api_client.py` (moved). Some issues may still be relevant, but the document itself is stale. |
| 9 | `docs/REST_API_MIGRATION_COMPLETE.md` | `docs/REST_API_MIGRATION_COMPLETE.md` | **LOW** | Historical record of Selenium → REST migration. References `mcp-servers/npid-native/` paths. Still useful as project history. |
| 10 | `docs/FULL_MESSAGE_FETCH_SPEC.md` | `docs/FULL_MESSAGE_FETCH_SPEC.md` | **LOW** | Marked "INCOMPLETE" and "95% complete." References old file paths. May still contain useful API endpoint details. |
| 11 | `.DS_Store` files (multiple) | Various | **HIGH** | macOS Finder metadata files. Should be in `.gitignore`. Not code. |

### Items **NOT** recommended for purge (needs verification)

| Item | Path | Why Not |
|------|------|---------|
| `src/python/npid_api_client.py` | `src/python/npid_api_client.py` | 66 KB Python client. May still be called by `python-rest-bridge.ts`. **Needs code trace to confirm.** |
| `mcp-servers/npid-search/` | `mcp-servers/npid-search/` | Per `.purge/PURGE_LOG.md`: "evaluate after Phase 5" of cache-swap plan. |
| `src/lib/prospect-pipeline/` | `src/lib/prospect-pipeline/` | Nested CRA project. **Unusual location.** Needs verification of whether it's actively used or abandoned. |
| `src/python/craft_mcp_client.py` | `src/python/craft_mcp_client.py` | **Needs verification** — may be used by Craft integration preferences in `package.json`. |
| `NPID-API-specs/api_visual_map.txt` | `NPID-API-specs/api_visual_map.txt` | ASCII art version of API map. Some info is **stale** (says "estimated" for stage/status IDs that have since been confirmed as strings). But still potentially useful for reference. |

---

## Section E: Naming Convention Issues and Proposed Rename Candidates

### File Naming Issues

| # | Current Name | Issue | Suggested Name | Impact/Risk |
|---|-------------|-------|---------------|-------------|
| 1 | `docs/Tool _ Raycast API.md` | Spaces and special chars in filename; looks like a web clipping pasted as-is | `docs/reference/raycast-tool-api.md` | Low risk — not referenced by code. Only human-read doc. |
| 2 | `plan.plan.md` | Redundant `.plan` in name; unclear what "plan" refers to | `docs/plans/2025-icon-vaultwarden-contacts.md` (or purge) | Low risk — not referenced by code. |
| 3 | `ISSUES-2026-01-28.md` | Root-level issue snapshot; naming doesn't follow any convention | Move to `docs/issues/2026-01-28.md` (or purge) | Low risk — not referenced by code. |
| 4 | `Craft-api-bundle.md` | Root-level, PascalCase-kebab mix, large reference doc cluttering root | `docs/reference/craft-api-bundle.md` | Low risk — not referenced by code. |
| 5 | `NPID-API-specs/` | Uppercase + hyphenated folder name; inconsistent with other folders (`docs/`, `scripts/`) | `docs/npid-api-specs/` or `docs/api-specs/` | **Medium risk** — no code imports from here, but GitHub links / bookmarks may break. |
| 6 | `src/lib/prospect-pipeline/` | **Confusing** — same name as the project root. A nested CRA app inside `src/lib/` is unexpected. | `src/lib/web-dashboard/` or move to `web/` at root | **High risk** — has own `package.json`, `node_modules`. Renaming requires updating any import paths. |
| 7 | `npid-api-layer/` | Fine as a name, but inconsistent with `NPID-API-specs/` casing | Keep as-is (lowercase is correct; rename the specs folder instead) | N/A |

### Module/Symbol Naming Issues

| # | Current Name | Location | Issue | Suggested Name |
|---|-------------|----------|-------|---------------|
| 8 | `python-server-client.ts` | `src/lib/` | Name implies "Python server" but it's actually a TypeScript HTTP client that talks to the FastAPI server | `fastapi-client.ts` or `npid-api-client.ts` | 
| 9 | `python-config.ts` | `src/lib/` | Manages Python binary path for subprocess execution | `python-env.ts` (clearer purpose) |
| 10 | `npid-client-raycast.ts` | `src/lib/` | Unclear relationship to `python-server-client.ts` and `npid-mcp-adapter.ts` — three different API client files | Needs consolidation analysis before renaming |
| 11 | `athlete-id-resolver.ts` vs `athlete-id-service.ts` | `src/lib/` | Two files with nearly identical names. Resolver is 630 bytes (thin wrapper). | Merge into `athlete-id-service.ts` |
| 12 | `src/python/npid_api_client.py` vs `src/python/npid_rest_client.py` | `src/python/` | Two Python REST clients in same folder. Unclear which is canonical. | Consolidate or clearly mark one as deprecated |

### Folder Structure Issues

| # | Issue | Details |
|---|-------|---------|
| 13 | **Docs scattered across root** | `CLAUDE.md`, `README.md`, `Craft-api-bundle.md`, `ISSUES-2026-01-28.md`, `plan.plan.md` all live at root. Only `CLAUDE.md` and `README.md` belong there. |
| 14 | **Multiple AI config dirs** | `.claude/`, `.codex/`, `.kiro/`, `.agent/` — 4 separate AI tool configurations. Each has its own conventions. Not a naming issue per se, but adds cognitive load. |
| 15 | **`src/python/` inside TypeScript source** | Python files live inside `src/` which is the TypeScript source root. They have their own `venv/` and `requirements.txt`. Unusual for a Raycast extension. |

---

## Section F: Recommended Phased Rename/Cleanup Plan

### Phase 0: Zero-Risk Cleanup (can do immediately)

1. **Add `.DS_Store` to `.gitignore`** (if not already there)
2. **Move `cd` to `purge-review/`** — accidental empty file
3. **Move `progress.db.bak-*` to `purge-review/`** — old backup
4. **Move `ISSUES-2026-01-28.md` to `purge-review/`** — stale snapshot

**Dependencies:** None. No code references these files.

### Phase 1: Docs Reorganization (low risk)

1. Create `docs/reference/` folder
2. Move `Craft-api-bundle.md` → `docs/reference/craft-api-bundle.md`
3. Move `docs/Tool _ Raycast API.md` → `docs/reference/raycast-tool-api.md`
4. Move `plan.plan.md` → `docs/plans/2025-icon-vaultwarden-contacts.md` (or `purge-review/`)
5. Move `NPID-API-specs/` → `docs/api-specs/` (rename + relocate)
6. Move stale historical docs (`ACTIVE_TASKS_FIXES_STATUS.md`, `IMPLEMENTATION_SPEC.md`, `GITHUB_ISSUES.md`) → `docs/archive/` or `purge-review/`

**Dependencies:** No code imports from `docs/` or `NPID-API-specs/`. Possible GitHub bookmark breakage.
**Verification step:** `grep -r "NPID-API-specs" --include="*.ts" --include="*.py" --include="*.md" .` — confirm no code references.

### Phase 2: Lib Renames (medium risk)

1. Rename `src/lib/python-server-client.ts` → `src/lib/fastapi-client.ts`
2. Merge `src/lib/athlete-id-resolver.ts` into `src/lib/athlete-id-service.ts`
3. Rename `src/lib/python-config.ts` → `src/lib/python-env.ts`

**Dependencies:** Every rename requires updating all import statements across `src/`.
**Verification step:**
```bash
# For each rename, find all importers:
grep -r "python-server-client" --include="*.ts" --include="*.tsx" src/
grep -r "athlete-id-resolver" --include="*.ts" --include="*.tsx" src/
grep -r "python-config" --include="*.ts" --include="*.tsx" src/
```
**Build verification:** `npm run build` after each rename.

### Phase 3: Structural Changes (high risk — defer until capacity)

1. Evaluate `src/lib/prospect-pipeline/` — determine if it should be at `web/` or removed entirely
2. Evaluate consolidation of `npid-client-raycast.ts`, `python-server-client.ts`, and `npid-mcp-adapter.ts` — three API abstraction layers is likely one too many
3. Evaluate moving `src/python/` → `python/` at project root (parallel to `npid-api-layer/`)
4. Consolidate `src/python/npid_api_client.py` and `src/python/npid_rest_client.py`

**Dependencies:** Deep — requires tracing all call paths and verifying no runtime breakage.
**Verification step:** Full integration testing (start dev server, test each Raycast command).

### Phase 4: README Update

After all renames are done:
1. Update `README.md` project structure section
2. Remove reference to `web/` directory (doesn't exist at that path)
3. Remove reference to `src/tools/npid-inbox.ts` (doesn't exist)
4. Update technology stack (currently lists "Angular JS" which is inaccurate for this project)

---

## Quality Notes

- **Uncertainty markers:**
  - `src/lib/prospect-pipeline/` usage status: ❓ NEEDS VERIFICATION
  - `src/python/craft_mcp_client.py` usage status: ❓ NEEDS VERIFICATION
  - `mcp-servers/npid-search/` redundancy: ❓ DEFERRED per existing plan
- **No speculative assumptions:** All file sizes, paths, and content references were verified by reading the actual files
- **Evidence paths:** Every recommendation references specific file paths verified in this audit

---

*End of audit report.*
