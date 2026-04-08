# Prospect Pipeline

Raycast extension for Prospect ID's video editing workflow.

The current working architecture is:

`Raycast extension -> local FastAPI bridge -> legacy NPID Laravel dashboard`

This repo is optimized around a local, saved Prospect ID session file at `~/.npid_session.pkl`. The FastAPI bridge in `npid-api-layer/` translates clean TypeScript requests into the legacy Laravel form and HTML workflow that the dashboard still expects.

## What Is Active

- Raycast commands in `src/`
- Local FastAPI bridge in `npid-api-layer/`
- Legacy Python client/session helpers in `src/python/`
- SQLite-backed local cache for video progress data

## What Is Not The Primary Path

- `mcp-servers/npid-search/` still exists in the repo, but it is a legacy standalone MCP server and is not the primary runtime path for the extension today.
- Craft MCP support still exists in `video-progress.tsx`, but it is optional workflow plumbing and not part of the default setup required to run the extension.

## Current Commands

- `npm run dev`
  Starts the Raycast extension in development mode.
- `npm run api`
  Starts the local FastAPI bridge from `npid-api-layer/`.
- `npm run dev:all`
  Starts both the Raycast extension and the FastAPI bridge together.
- `npm run build`
  Builds the Raycast extension.
- `npm run lint`
  Runs Raycast linting.

## Repo Layout

```text
prospect-pipeline/
├── src/                    # Raycast commands, UI, adapters, local helpers
├── npid-api-layer/         # Local FastAPI bridge to the legacy Laravel site
├── src/python/             # Legacy Python client and auth/session helpers
├── mcp-servers/npid-search # Legacy standalone NPID MCP server (not primary path)
├── docs/                   # Architecture notes, audits, reference docs
├── scripts/                # Local helper scripts
└── assets/                 # Raycast icons and static assets
```

## Core Workflow

The extension depends on a local authenticated Prospect ID browser-style session:

1. A saved session file lives at `~/.npid_session.pkl`
2. Raycast commands call the local FastAPI bridge
3. FastAPI reuses that local session and translates requests to the legacy dashboard
4. Responses are normalized back into JSON for the extension

This means the extension is local-first. It is not built around a shared remote bridge.

## Local Development

### Prerequisites

- Raycast
- Node.js 22
- Python 3.11
- A valid Prospect ID account and local session workflow

### Install JavaScript Dependencies

```bash
npm ci
```

### Set Up The FastAPI Bridge

```bash
cd npid-api-layer
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Start The Services

Run the FastAPI bridge:

```bash
npm run api
```

In another terminal, run the Raycast extension:

```bash
npm run dev
```

Or run both together:

```bash
npm run dev:all
```

## Auth Model

- The repo currently assumes a local session file at `~/.npid_session.pkl`
- The active FastAPI and Python flows reuse that local saved session
- The Laravel dashboard is still the system of record behind the bridge

If the session expires or is missing, commands that depend on the dashboard will fail until the local session is refreshed.

## Main Surfaces

- `Assign Video Team Inbox`
  Assign unassigned inbox threads into the video workflow.
- `Read Video Team Inbox`
  View assigned inbox threads and message detail.
- `Email Student Athletes`
  Load legacy templates and send emails through the bridge.
- `Video Updates`
  Submit video links and run the post-upload workflow.
- `Video Progress`
  Browse and manage active video editing work.
- `Prospect Search`
  Search broader athlete records and materialize selected records into the local workflow.

## Notes On MCP

There are two different MCP stories in this repo:

- NPID MCP:
  Historical. `mcp-servers/npid-search/` is still present, but it is not the extension's main runtime path.
- Craft MCP:
  Optional and personal workflow-specific. It should be treated as an add-on, not a required part of the extension setup.

## Useful Docs

- [`npid-api-layer/README.md`](/Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/README.md)
- [`docs/MCP_TERMINAL_GUIDE.md`](/Users/singleton23/Raycast/prospect-pipeline/docs/MCP_TERMINAL_GUIDE.md)
- [`docs/architecture/README.md`](/Users/singleton23/Raycast/prospect-pipeline/docs/architecture/README.md)
- [`docs/REPO_AUDIT_2026-02-26.md`](/Users/singleton23/Raycast/prospect-pipeline/docs/REPO_AUDIT_2026-02-26.md)
