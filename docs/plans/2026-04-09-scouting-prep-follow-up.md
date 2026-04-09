---
title: Scouting Prep Follow-Up
date: 2026-04-09
owner: Jerami Singleton / Codex
status: pending
scope: scouting-prep-next-phase
---

# Scouting Prep Follow-Up

## Current State
The current `scout-prep` command is intentionally v1 and intentionally local.

It uses static TypeScript content only:
- voicemail
- deficit guidance
- quick call reminders

It does not use AI.
It does not call FastAPI.
It does not pull live CRM or task data.

## Why v1 Stops Here
This command is awaiting real-life scouting-specific login support.

The likely path is to use the same saved authenticated session model already used elsewhere in the extension, very likely through the existing local session/pickle-file approach:
- `~/.npid_session.pkl`

That means the future version may be able to use the same authenticated foundation already used by the Raycast extension and FastAPI bridge, but with scout-specific endpoints integrated.

## Next Phase Goal
Evolve `scout-prep` from a static prep tool into a live scouting-prep command that can pull actual data for the current recruit scenario, including:
- athlete name
- parent name
- grad year
- sport
- relevant CRM context
- relevant pending scouting tasks

## Expected Integration Shape
The expected future shape should remain consistent with the current project architecture:
- Raycast-led command
- local authenticated workflow
- reuse saved session auth if valid for scout-specific access
- only add scout-specific endpoint integration when the source endpoints are confirmed

## Constraints For Future Work
- preserve the existing editing workflow
- do not break the current FastAPI/Laravel connection
- prefer existing auth/session patterns over inventing a second login path
- do not add AI where deterministic CRM/task data is the real source of truth
- do not build broad abstractions before the scout-specific endpoints are known

## Future Acceptance Criteria
A future live-data version of `scout-prep` should:
- authenticate using the existing local saved-session pattern if possible
- load live recruit details from the CRM
- load any pending scouting task context needed for call prep
- keep the command easy to scan during a live call
- preserve the current extension architecture
