# Prospect Pipeline

Prospect ID's Raycast extension for managing the video editing workflow through a local FastAPI bridge backed by the legacy NPID Laravel dashboard.

## Architecture

The supported runtime path is:

`Raycast extension -> local FastAPI bridge -> legacy NPID Laravel dashboard`

The Raycast commands in `src/` call the local FastAPI service in `npid-api-layer/`, which translates requests into the legacy Laravel forms and responses the NPID dashboard still expects.

## Prerequisites

- Raycast
- Node.js 22
- Python 3.11
- A valid Prospect ID account
- A working local Prospect ID session saved at `~/.npid_session.pkl`

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

## Auth Model

This repo relies on a local saved session file at `~/.npid_session.pkl`.

- The Python helpers in `src/python/` and the FastAPI bridge both reuse that local session
- FastAPI acts as the stable local translation layer in front of the legacy Laravel dashboard
- If the saved session expires or is missing, dashboard-backed commands will fail until the session is refreshed

## Main Commands

- `Assign Video Team Inbox`
- `Read Video Team Inbox`
- `Email Student Athletes`
- `Video Updates`
- `Video Progress`
- `Prospect Search`

## Repository Layout

```text
prospect-pipeline/
├── src/              # Raycast commands, UI, adapters, and local helpers
├── npid-api-layer/   # Local FastAPI bridge for the legacy NPID backend
├── src/python/       # Python auth/session and legacy client helpers
├── docs/             # Active architecture and API notes
├── scripts/          # Local helper scripts
└── assets/           # Icons and static assets
```

## Useful Docs

- [`npid-api-layer/README.md`](/Users/singleton23/Raycast/prospect-pipeline/npid-api-layer/README.md)
- [`docs/architecture/README.md`](/Users/singleton23/Raycast/prospect-pipeline/docs/architecture/README.md)
- [`docs/api-specs/npid_implementation_guide.md`](/Users/singleton23/Raycast/prospect-pipeline/docs/api-specs/npid_implementation_guide.md)
