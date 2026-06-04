# Prospect Pipeline Codex Contract

This repo is a production work system, not a one-off project. The user makes money with this workflow, and Scout Prep / Set Meetings / Client Messages changes must be treated like professional product work.

Before editing files related to Scout Prep, Client Messages, Set Meetings, Scout Openings, lifecycle, Supabase, contacts, or reporting:

1. Identify the Scouting Coordinator bucket.
2. Read `docs/architecture/scouting-coordinator-system-map.md`.
3. Reuse the bucket-owned domain surface before adding helpers.
4. Keep commands as UI surfaces, domains as meaning, Supabase as durable truth, and Laravel/API calls as source-system adapters.
5. Do not create one-off helpers or scripts unless the task is explicitly repair/audit work and the script is named that way.
6. For source-of-truth disputes, read `docs/architecture/scout-prep-supabase-source-of-truth.md`.
7. Prove shared workflow changes with focused tests; use `npm test` for broad Scout Prep business changes when feasible.
8. For duplicate-profile / repeat-profile workflow changes, use the `auto-logger` skill and log the decision envelope, confidence outcome, external request boundaries, and mutation result without logging full PII.

If the correct bucket or source of truth is unclear, stop and report the ambiguity instead of patching around it.

This is a pre-edit requirement. Do not wait until commit review to apply it.
