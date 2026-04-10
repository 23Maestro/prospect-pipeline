# Prospect Pipeline Session Persistence

## Current State

This repo does not rely on Playwright browser state for the active runtime path.

The supported session model is:

`Raycast extension -> local FastAPI bridge -> saved NPID session -> legacy Laravel dashboard`

## Source Of Truth

- Local saved session file: `~/.npid_session.pkl`
- FastAPI bridge: `npid-api-layer/`
- Python helpers: `src/python/`

## Practical Rules

- If dashboard-backed commands fail auth, refresh the saved NPID session.
- Do not assume Playwright storage state is part of the supported flow.
- Do not add new browser-state dependencies unless there is a clear runtime need.

## Notes

- Historical Playwright experiments were local debugging work, not the current production path.
- The FastAPI bridge and Python helpers should continue to reuse the same saved local session.
