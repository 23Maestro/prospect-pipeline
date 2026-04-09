---
title: Command Surface Consolidation
date: 2026-04-09
owner: Jerami Singleton / Codex
status: in-progress
scope: command-surface-consolidation
---

# Command Surface Consolidation

## Goal

Condense athlete-editing workflows into `video-progress` while keeping `manual-sa-additions` as the AI ingest surface and only removing standalone commands after parity is proven.

## Locked Chunk Order

1. Architecture docs and shared service boundaries
2. Shared workflow extraction from `video-updates` and `email-student-athletes`
3. `video-progress` migration to integration-owned workflow views
4. Soft deprecation and eventual command removal

## Chunk Checklist

### Chunk 1

- Replace the `prospect-search`-only deprecation roadmap with a broader consolidation diagram
- Update the system map to show `video-progress` as the primary hub
- Record parity gates and final target command surface in this plan

### Chunk 2

- Extract shared athlete lookup service
- Extract shared email workflow service
- Extract shared post-upload workflow service
- Convert standalone commands into thin wrappers around shared workflow views

### Chunk 3

- Make `video-progress` depend on shared workflow views, not command entry files
- Preserve current seamless `video-progress` to `video-updates` behavior
- Make `video-progress` to email behave like a clean standalone launch while preserving standalone email logic
- Verify integrated athlete-editing quick links and follow-up actions

### Chunk 4

- Mark `prospect-search`, `video-updates`, and `email-student-athletes` fallback-only in docs
- Keep manifest entries during validation
- Remove commands from `package.json` only after all parity gates pass

## Parity Gates

- `manual-sa-additions` materializes tasks reliably enough to replace `prospect-search`
- Integrated `video-progress` update flow matches standalone `video-updates`
- Integrated `video-progress` email flow matches standalone `email-student-athletes`, including recipient composition
- `npx ray lint` and `npx ray build` pass, with pre-existing repo debt called out separately from new regressions

## Final Surface

- `scout-prep`
- `video-progress`
- `read-videoteam-inbox`
- `assign-videoteam-inbox`
- `manual-sa-additions`
