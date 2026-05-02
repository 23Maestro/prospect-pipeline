# Scout Prep Domain Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move shared Scout Prep workflow facts into domain modules while preserving Raycast, Laravel, Supabase, and command behavior.

**Architecture:** Add small domain modules for outreach time wording, task selection, contact selection, message context, Set Meetings candidates, and command payloads. Keep existing UI files as adapters that render and execute actions.

**Tech Stack:** TypeScript, Raycast extension files, Node test runner through existing package scripts.

---

### Task 1: Outreach Time Wording Domain

**Files:**
- Modify: `src/domain/outreach-time-wording.ts`
- Modify: `src/domain/outreach-time-wording.test.ts`
- Modify: `src/lib/scout-follow-up-templates.ts`

- [ ] Add tests for same-day/tomorrow/future wording and timezone mismatch.
- [ ] Export the requested temporal API while keeping legacy aliases.
- [ ] Update confirmation templates to call the domain helpers only.
- [ ] Run `npm run test:domain` and `npm run test:scout-follow-up-templates`.

### Task 2: Task Selection Domain

**Files:**
- Create: `src/domain/scout-task-selection.ts`
- Create: `src/domain/scout-task-selection.test.ts`
- Modify: `src/scout-prep.tsx`
- Modify: `src/lib/scout-prep.tsx`
- Modify: `src/lib/head-scout-follow-ups.ts`
- Modify: `src/domain/post-call-action.ts`

- [ ] Add tests for incomplete, confirmation, voicemail, and post-call task selection.
- [ ] Move duplicated pure task-selection helpers into the domain module.
- [ ] Replace local helper definitions/imports with domain calls.
- [ ] Run `npm run test:domain`.

### Task 3: Contact And Message Context Domains

**Files:**
- Create: `src/domain/scout-contact-selection.ts`
- Create: `src/domain/scout-message-context.ts`
- Create: `src/domain/scout-message-context.test.ts`
- Modify: `src/lib/scout-prep-contact.ts`
- Modify: `src/scout-prep.tsx`
- Modify: `src/head-scout-schedules.tsx`

- [ ] Add tests for recipient selection, voicemail recipient dedupe, phone normalization, and confirmation context phrase reuse.
- [ ] Move contact selection into domain and keep `src/lib/scout-prep-contact.ts` as composition adapter.
- [ ] Build confirmation and voicemail context through domain helpers without changing copy.
- [ ] Run `npm run test:domain`, `npm run test:scout-prep-contact`, and `npm run test:scout-follow-up-templates`.

### Task 4: Set Meetings Candidate Domain

**Files:**
- Create: `src/domain/set-meetings-candidate.ts`
- Create: `src/domain/set-meetings-candidate.test.ts`
- Modify: `src/head-scout-schedules.tsx`
- Modify: `src/lib/head-scout-follow-ups.ts`

- [ ] Add tests proving booked meeting start is the source of truth and sorting is stable.
- [ ] Move candidate shaping, day labels, buckets, and sorting into the domain module.
- [ ] Keep `HeadScoutBookingsList` rendering unchanged and use domain sort/label helpers.
- [ ] Run `npm run test:domain` and `npm run test:head-scout-schedules`.

### Task 5: Command Pipeline Facade

**Files:**
- Create: `src/domain/scout-prep-command-pipeline.ts`
- Create: `src/domain/scout-prep-command-pipeline.test.ts`
- Modify: `src/scout-prep.tsx`
- Modify: `src/head-scout-schedules.tsx`
- Modify: `src/view-set-meetings.tsx`

- [ ] Add tests for Scout Prep, Head Scout, and Set Meetings context/payload builders.
- [ ] Add low-risk orchestration helpers that call the extracted domains.
- [ ] Replace duplicated action payload construction where the data is already shared.
- [ ] Run focused tests and grep checks for unchanged Laravel/Supabase contract surfaces.
