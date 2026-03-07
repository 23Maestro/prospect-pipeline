# purge-review/ Manifest

**Created:** 2026-02-26
**Purpose:** High-confidence deletion candidates moved here for manual review before permanent deletion.

## How to Use

1. **Review each item** below
2. **Restore** anything you want to keep: `mv purge-review/<file> <original-path>`
3. **Delete** the folder when satisfied: `rm -rf purge-review/`

---

## Items in This Folder

| # | File | Original Path | Confidence | Rationale |
|---|------|--------------|------------|-----------|
| 1 | `cd` | `./cd` | **HIGH** | Accidental empty file at project root. Created by a mistyped terminal command. Not referenced by any code, config, or documentation. Zero bytes. |
| 2 | `progress.db.bak-20260207-170149` | `./progress.db.bak-20260207-170149` | **HIGH** | One-time backup of the SQLite cache from Feb 7, 2026. The live cache is `progress.db`. This backup is 643 KB and not referenced by any code. |
| 3 | `ISSUES-2026-01-28.md` | `./ISSUES-2026-01-28.md` | **HIGH** | Snapshot of 4 open issues from a single date. Issues should be tracked in GitHub Issues, not as root-level markdown files. Content is preserved in `docs/REPO_AUDIT_2026-02-26.md` Section C for reference. |

## Items NOT Moved (Flagged for Future Review)

These items were identified as potential candidates but have lower confidence or need code-path verification:

| File | Reason Not Moved |
|------|-----------------|
| `plan.plan.md` | May contain useful historical context. Recommend moving to `docs/plans/`. |
| `Craft-api-bundle.md` | 24 KB reference doc. Recommend moving to `docs/reference/`. |
| `docs/ACTIVE_TASKS_FIXES_STATUS.md` | Historical but references deleted files. |
| `docs/IMPLEMENTATION_SPEC.md` | Superseded by REST migration but contains useful endpoint details. |
| `docs/GITHUB_ISSUES.md` | Draft issues never filed. Some may still be relevant. |
| `src/python/npid_api_client.py` | May still be called at runtime — needs code trace. |
| `src/lib/prospect-pipeline/` | Nested CRA app — needs usage verification. |

---

*See `docs/REPO_AUDIT_2026-02-26.md` for full analysis and phased cleanup plan.*
