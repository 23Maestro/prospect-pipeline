# Purge Log - 2026-01-27

## Purpose
Repository cleanup to reduce clutter and improve maintainability.

## Files Moved

### Debug Scripts → `.purge/2026-01-27/debug-scripts/`
| File | Reason |
|------|--------|
| `debug_api_response.py` | One-off debug script, not part of main workflow |
| `debug_message_detail.py` | One-off debug script, not part of main workflow |
| `artifact-file` (was `=1.9.4`) | Accidental file creation artifact |

### HAR Captures → `.purge/2026-01-27/har-capture/`
| File | Size | Reason |
|------|------|--------|
| `2025-11-24_video-progress-done_email.stage.har.md` | ~1.1MB | HTTP archive capture, useful for reference but clutters docs |
| `2025-11-24_video.updates.har.md` | ~189KB | HTTP archive capture, useful for reference but clutters docs |

### Bitwarden Integration → `.purge/2026-01-27/bitwarden-integration/`
| Folder | Reason |
|--------|--------|
| `docs/bitwarden-contact-integration/*` | Unrelated to core NPID workflow, exploratory docs |

## Not Moved (Evaluation Deferred)
| Item | Reason |
|------|--------|
| `mcp-servers/npid-search/` | May still be useful per cache-swap plan - evaluate after Phase 5 |
| `src/python/npid_api_client.py` | Legacy but still referenced in some flows |

## Restoration
If any files need to be restored:
```bash
git mv .purge/2026-01-27/<folder>/<file> <original-location>
```

## .gitignore Updates
Added in this session:
- `progress.db` (local SQLite cache, should not be committed)

---
Last Updated: 2026-01-27
