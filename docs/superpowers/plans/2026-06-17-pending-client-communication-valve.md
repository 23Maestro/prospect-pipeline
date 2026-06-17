# Pending Client Communication Valve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pending Clients expose a concise operator-controlled communication valve for no-show/reschedule cycles without automatic purge-by-count behavior.

**Architecture:** Keep templates in the existing Client Communication helper and cycle interpretation in the existing Pending Clients domain. Supabase remains durable truth; cycle counts only select copy tone and review labels. Final-check does not mutate lifecycle or purge unless the operator explicitly chooses a Raycast-owned action.

**Tech Stack:** TypeScript, Node test runner, Raycast command surface, Supabase read models.

---

### Task 1: Tighten No-Show Copy

**Files:**
- Modify: `src/lib/scout-follow-up-templates.ts`
- Test: `src/lib/scout-follow-up-templates.test.ts`

- [ ] Update the no-show template to use brief three-option wording.
- [ ] Keep student-athlete and parent recipient variants separate.
- [ ] Run `npm run test:scout-follow-up-templates`.

### Task 2: Make Cycle Lanes Operator-Controlled

**Files:**
- Modify: `src/domain/pending-client-watchlist.ts`
- Test: `src/domain/pending-client-watchlist.test.ts`

- [ ] Add stage labels to pending-client communication plans: first cycle, second cycle, final check.
- [ ] Keep `final_time_check` as a recommendation only; do not add automatic purge by count.
- [ ] Make terminal sales stage the only domain reason that returns `purge_terminal`.
- [ ] Run `npm run test:domain -- src/domain/pending-client-watchlist.test.ts` or the closest focused command available.

### Task 3: Preserve Visible Filter Safety

**Files:**
- Verify: `src/head-scout-schedules.tsx`
- Test: `src/domain/pending-client-watchlist.test.ts`

- [ ] Confirm the 30-day non-payment visible gate remains only a UI readability filter.
- [ ] Confirm payments are not hidden by that gate.
- [ ] Do not add sales-stage mutation or Laravel fallback logic.

### Task 4: Verify 10x Evidence

**Files:**
- Verify: `scripts/audit-10x-communications-evidence.mjs`

- [ ] Run `npm run verify:10x-communications` if feasible.
- [ ] If broad verification is too noisy, run focused template/domain tests plus `npm run audit:10x-communications-evidence`.
