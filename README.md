# Prospect Pipeline

Prospect Pipeline is a production-style workflow automation system for messy, multi-system business operations. It combines Raycast commands, a local FastAPI bridge, legacy Laravel dashboard workflows, Supabase reporting truth, Next/Vercel surfaces, audit scripts, and AI-assisted operator workflows into one documented operating surface.

This repo is used as public proof for practical AI and workflow automation work. It shows how fragile manual processes can be turned into repeatable commands, source-of-truth contracts, validation tests, and review-before-mutation workflows without handing business decisions blindly to automation.

## What This Demonstrates

- Raycast command surfaces for daily operator workflows, including search, task handling, meeting support, client messaging, video workflow tools, and reporting utilities.
- A local FastAPI bridge that adapts legacy Laravel dashboard behavior into a stable local API surface.
- Supabase source-of-truth cleanup across appointments, lifecycle events, call logs, confirmation support, and related reporting tables.
- Audit and parity scripts that compare expected workflow truth against source systems before cleanup or migration work.
- Focused tests and architecture contracts that protect business meaning as commands evolve.
- Prospect Web and Vercel surfaces for public-safe reporting, visual maps, and workflow support pages.
- AI-assisted drafting, classification, and support workflows designed for operator review rather than blind automation.

## Architecture

The supported runtime path is:

```text
Raycast commands -> local FastAPI bridge -> legacy Laravel dashboard
                              |
                              v
                  Supabase durable reporting truth
                              |
                              v
               Prospect Web / Vercel support surfaces
```

The Raycast commands in `src/` call the local FastAPI service in `npid-api-layer/`. FastAPI translates local requests into the legacy dashboard forms and responses the source system expects. Supabase stores durable workflow facts where the repo has explicit mutation rights. Prospect Web reads approved reporting/support surfaces, but it does not own lifecycle meaning.

## Source-Of-Truth Boundaries

The repo is intentionally strict about ownership:

- Commands are UI surfaces, not business truth.
- Domain modules own workflow meaning.
- Laravel/FastAPI calls are source-system adapters.
- Supabase stores durable truth after the source-system action succeeds or after an explicit audit/repair workflow.
- AI helpers draft, classify, summarize, and propose actions for review; they do not silently mutate source-of-truth state.

Core examples:

- `appointments` owns durable meeting timing, timezone, scout, event identity, reschedule chain, and post-meeting result facts.
- `lifecycle_events` owns sales-stage lifecycle history through the canonical lifecycle writer.
- `call_log` is the centralized reporting ledger for call activity, meeting-set facts, post-meeting outcomes, and enrollment/payment evidence.
- `set_meeting_confirmation_cache` supports confirmation-message workflows; it is not lifecycle truth.
- Contact cache surfaces support lookup and message admission; they do not own meeting truth.

See [Scouting Coordinator System Map](docs/architecture/scouting-coordinator-system-map.md) and [Scout Prep Supabase Source Of Truth](docs/architecture/scout-prep-supabase-source-of-truth.md) for the full contract.

## Main Surfaces

- `src/` - Raycast commands, domain modules, command UI, and local workflow helpers.
- `npid-api-layer/` - Local FastAPI bridge for legacy dashboard-backed workflows.
- `scripts/` - Audit, repair, sync, verification, and reporting utilities.
- `supabase/` - Schema and migration history for durable workflow/reporting tables.
- `apps/prospect-web/` - Next/Vercel support surfaces.
- `docs/architecture/` - Source-of-truth rules, system maps, workflow boundaries, and cleanup contracts.
- `docs/visual-maps/` - Operator-facing visual maps for workflow alignment.

## Representative Commands

- `Scout Prep`
- `Client Messages`
- `Set Meetings`
- `Scout Openings`
- `Prospect Search`
- `Assign Video Team Inbox`
- `Read Video Team Inbox`
- `Video Updates`
- `Video Progress`
- `Daily Call Blocks`

## Setup

Install JavaScript dependencies:

```bash
npm ci
```

Set up the FastAPI bridge:

```bash
cd npid-api-layer
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

## Running Locally

Start the FastAPI bridge:

```bash
npm run api
```

Start the Raycast extension:

```bash
npm run dev
```

Start both together:

```bash
npm run dev:all
```

Recommended supervised workflow:

```bash
npm run dev:stack:install
npm run dev:stack
```

To restart only FastAPI after a router change:

```bash
npm run dev:api:restart
```

For the full command set, see [Development Processes](references/dev-processes.md).

## Configuration

This repo expects local credentials and sessions to stay out of public commits.

- Local environment files such as `.env`, `.env.local`, and `.overmind.env` are ignored.
- Dashboard-backed commands depend on a private local session file outside the repo.
- Supabase, dashboard, Vercel, email, and notification credentials must be provided through local environment variables or platform-managed secrets.
- Public artifacts should use role-based labels and synthetic examples instead of real client, athlete, parent, employee, or internal company details.

## Proof And Verification

Useful deterministic checks:

```bash
npm run test:domain
npm test
npm run build
git diff --check
```

Use focused tests for narrow workflow changes. Use broad tests when touching shared Scout Prep, lifecycle, Supabase, reporting, appointment, or client-message behavior. Local tests prove deterministic repo behavior only; live dashboard, Supabase, Vercel, Raycast, and browser state require separate live readback.

## Public-Safe Case Study Pointers

Strong public case-study surfaces:

- [Scouting Coordinator System Map](docs/architecture/scouting-coordinator-system-map.md)
- [Scout Prep Supabase Source Of Truth](docs/architecture/scout-prep-supabase-source-of-truth.md)
- [Supabase Clean House Truth Map](docs/architecture/supabase-clean-house-truth-map.md)
- [Scout Prep Domain Contract](docs/architecture/scout-prep-domain-contract.md)
- [Prospect Web Hosting Adapter](docs/architecture/prospect-web-hosting-adapter.md)
- [Legacy Assignment Debug Template](docs/api-specs/legacy-assignment-debug-template.md)
- `scripts/audit-supabase-truth-map.mjs`
- `scripts/audit-call-tracker-live-parity.mjs`
- `scripts/audit-raycast-workflow-identity-contract.mjs`
- `scripts/watch-ended-meeting-outcomes.mjs`
- `src/domain/workflow-context.ts`
- `src/lib/supabase-lifecycle.ts`
