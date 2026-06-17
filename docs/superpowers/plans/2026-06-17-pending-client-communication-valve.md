# Pending Client Communication Valve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pending Clients a concise active follow-up surface where RSP, No Show, and Canceled rows move from Offer Slots to Awaiting Client to Try Again based on real note/message evidence.

**Architecture:** Enrollments & Outcomes owns Pending Clients admission and visibility. Client Communication owns message evidence and outbound/reply classification. Pre-Meeting Tasks owns the separate Laravel task due-date mutation. This plan first hardens read-only derived state and UI consistency, then records the guarded task keep-alive slice as a follow-up that must not be mixed into the display cleanup.

**Tech Stack:** TypeScript, Raycast, local Messages SQL evidence, Supabase appointment/contact-cache reads, Node test runner, existing FastAPI task adapter paths.

---

## Linear Tracking

Post this checklist to the existing 10x Communications Linear issue before implementation. If the issue key is unknown, stop and ask for it rather than creating a duplicate issue.

```md
Implementation slice: Pending Clients active follow-up valve

- [ ] RSP and No Show/Canceled use a 14-day active visibility gate
- [ ] Review Follow Ups and Payments are not hidden by that RSP/NS cutoff
- [ ] Tags and markdown checklist are derived from one Pending Clients state helper
- [ ] Outbound proposed-times proof marks Offer Slots complete and moves row to Awaiting Client
- [ ] No client reply after 48 hours moves row to Try Again
- [ ] Client reply after outbound moves row to Review Reply
- [ ] Audit proves decoder coverage and pending-client action state without message body PII
- [ ] Laravel task keep-alive due-date mutation is handled as a separate guarded task-writer slice
```

---

### Task 1: Tighten RSP And No-Show Visibility

**Files:**
- Modify: `src/head-scout-schedules.tsx`
- Test: `src/domain/pending-client-watchlist.test.ts`

- [x] **Step 1: Replace the broad non-payment window expectation**

Update the test named `pending client visible filters use a 30 day last-seen gate except payments` to the new rule:

```ts
test('pending client visible filters use a 14 day gate for RSP and no-show only', () => {
  const source = fs.readFileSync('src/head-scout-schedules.tsx', 'utf8');
  assert.match(source, /PENDING_CLIENT_RECOVERY_WINDOW_MS = 14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /if \(queue\.filter === 'payments'\) return true/);
  assert.match(source, /if \(queue\.filter === 'review_follow_ups'\) return true/);
  assert.match(source, /if \(queue\.filter !== 'reschedule' && queue\.filter !== 'no_show'\) return true/);
  assert.match(source, /const lastSeenAt = pendingClientQueueTime\(row\)/);
  assert.match(source, /lastSeenAt > 0 && now - lastSeenAt <= PENDING_CLIENT_RECOVERY_WINDOW_MS/);
  assert.match(source, /isPendingClientInsideVisibleWindow\(item\.row, item\.queue\)/);
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --import tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: the visibility-gate test fails because the UI still references `PENDING_CLIENT_NON_PAYMENT_WINDOW_MS`.

- [x] **Step 3: Update the visible-window helper**

In `src/head-scout-schedules.tsx`, replace the current broad non-payment constant/helper with:

```ts
const PENDING_CLIENT_RECOVERY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function isPendingClientInsideVisibleWindow(
  row: PendingClientWatchlistDisplayRow,
  queue: PendingClientCentralQueueClassification,
): boolean {
  if (queue.filter === 'payments') return true;
  if (queue.filter === 'review_follow_ups') return true;
  if (queue.filter !== 'reschedule' && queue.filter !== 'no_show') return true;
  const lastSeenAt = pendingClientQueueTime(row);
  const now = Date.now();
  return lastSeenAt > 0 && now - lastSeenAt <= PENDING_CLIENT_RECOVERY_WINDOW_MS;
}
```

- [x] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
node --import tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: all Pending Clients domain tests pass.

---

### Task 2: Derive One Active Follow-Up State For Tags And Checklist

**Files:**
- Modify: `src/domain/pending-client-watchlist.ts`
- Test: `src/domain/pending-client-watchlist.test.ts`

- [x] **Step 1: Add failing tests for tag/checklist unison**

Append these tests near the existing checklist and communication-plan tests:

```ts
test('pending client active follow-up state marks outbound offer as awaiting client', () => {
  const row = pendingClientRow({
    last_seen_at: '2026-06-17T17:34:00.000Z',
    description: 'Notes Tab: 06/17/26 01:34 PM Gage has practice',
  });
  const replyEvidence = {
    operatorReplyProposedTimes: true,
    clientRepliedAfterOperatorTimes: false,
    lastMeaningfulOutbound: {
      body: 'Coach has me checking what works best to reschedule Gage: 1 - Thursday at 7PM ET 2 - Monday at 7PM ET',
      date: '2026-06-17T19:05:00.000Z',
    },
  };
  const state = derivePendingClientActiveFollowUpState({
    row,
    filter: 'reschedule',
    replyEvidence,
    now: new Date('2026-06-18T12:00:00.000Z'),
  });
  const queue = classifyPendingClientCentralQueue({ row, replyEvidence });
  const markdown = buildPendingClientChecklistMarkdown({ row, replyEvidence, centralQueue: queue, now: new Date('2026-06-18T12:00:00.000Z') });

  assert.equal(state.actionLabel, 'Awaiting Client');
  assert.equal(queue.actionLabel, 'Awaiting Client');
  assert.match(markdown, /- \[x\] Offer slots/);
  assert.match(markdown, /- \[ \] Wait for reply until/);
});

test('pending client active follow-up state moves awaiting client to try again after deadline', () => {
  const row = pendingClientRow({
    last_seen_at: '2026-06-17T17:34:00.000Z',
    description: 'Notes Tab: 06/17/26 01:34 PM Gage has practice',
  });
  const replyEvidence = {
    operatorReplyProposedTimes: true,
    clientRepliedAfterOperatorTimes: false,
    lastMeaningfulOutbound: {
      body: 'Coach has me checking what works best to reschedule Gage: 1 - Thursday at 7PM ET 2 - Monday at 7PM ET',
      date: '2026-06-17T19:05:00.000Z',
    },
  };
  const state = derivePendingClientActiveFollowUpState({
    row,
    filter: 'reschedule',
    replyEvidence,
    now: new Date('2026-06-19T19:06:00.000Z'),
  });
  const queue = classifyPendingClientCentralQueue({ row, replyEvidence, now: new Date('2026-06-19T19:06:00.000Z') });
  const markdown = buildPendingClientChecklistMarkdown({ row, replyEvidence, centralQueue: queue, now: new Date('2026-06-19T19:06:00.000Z') });

  assert.equal(state.actionLabel, 'Try Again');
  assert.equal(queue.actionLabel, 'Try Again');
  assert.match(markdown, /- \[x\] Offer slots/);
  assert.match(markdown, /- \[ \] Try again - waited until/);
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --import tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: failure because `derivePendingClientActiveFollowUpState` does not exist or the checklist still recalculates action state separately from the tag classifier.

- [x] **Step 3: Add the derived state type and helper**

In `src/domain/pending-client-watchlist.ts`, add a small helper that does not call `classifyPendingClientCentralQueue`:

```ts
export type PendingClientActiveFollowUpState = {
  filter: PendingClientCentralFilter;
  actionLabel: PendingClientCentralQueueClassification['actionLabel'];
  checklistAction:
    | 'add_note'
    | 'offer_slots'
    | 'await_client'
    | 'try_again'
    | 'review_reply'
    | 'review_payment'
    | 'review_context';
  deadlineLabel: string | null;
};

function pendingClientRecoveryActionLabel(args: {
  filter: PendingClientCentralFilter;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  now?: Date;
  retryAfterHours?: number;
}): PendingClientCentralQueueClassification['actionLabel'] {
  if (args.replyEvidence?.clientRepliedAfterOperatorTimes) return 'Review Reply';
  if (
    isPendingClientReplyRetryDue({
      replyEvidence: args.replyEvidence,
      now: args.now,
      retryAfterHours: args.retryAfterHours,
    })
  ) {
    return 'Try Again';
  }
  if (args.replyEvidence?.operatorReplyProposedTimes) return 'Awaiting Client';
  return args.filter === 'reschedule' ? 'Offer Slots' : 'Needs Reply';
}

export function derivePendingClientActiveFollowUpState(args: {
  row: PendingClientWatchlistRow;
  filter: PendingClientCentralFilter;
  replyEvidence?: PendingClientOperatorQueueReplyEvidence | null;
  now?: Date;
  retryAfterHours?: number;
}): PendingClientActiveFollowUpState {
  const filter = args.filter;
  const deadlineLabel = pendingClientReplyDeadlineLabel({
    replyEvidence: args.replyEvidence,
    retryAfterHours: args.retryAfterHours,
  }) || null;

  if (filter === 'payments') {
    return { filter, actionLabel: 'Payments', checklistAction: 'review_payment', deadlineLabel: null };
  }
  if (filter === 'review_follow_ups') {
    return { filter, actionLabel: 'Review', checklistAction: 'review_context', deadlineLabel: null };
  }
  const actionLabel = pendingClientRecoveryActionLabel({
    filter,
    replyEvidence: args.replyEvidence,
    now: args.now,
    retryAfterHours: args.retryAfterHours,
  });
  if (actionLabel === 'Review Reply') return { filter, actionLabel, checklistAction: 'review_reply', deadlineLabel };
  if (actionLabel === 'Try Again') return { filter, actionLabel, checklistAction: 'try_again', deadlineLabel };
  if (actionLabel === 'Awaiting Client') return { filter, actionLabel, checklistAction: 'await_client', deadlineLabel };
  return {
    filter,
    actionLabel,
    checklistAction: 'offer_slots',
    deadlineLabel: null,
  };
}
```

- [x] **Step 4: Route `classifyPendingClientCentralQueue` through the helper**

Keep the existing `now?: Date` and `retryAfterHours?: number` signature. Replace the duplicated RSP and No Show/Canceled ternaries with `pendingClientRecoveryActionLabel(...)`. Payments, bad-timing, and Review Follow Ups keep their existing actions.

- [x] **Step 5: Route checklist markdown through the helper**

Inside `buildPendingClientChecklistMarkdown`, compute:

```ts
const activeState = derivePendingClientActiveFollowUpState({
  row,
  filter: centralQueue?.filter || classifyPendingClientCentralQueue({ row, replyEvidence, now, retryAfterHours }).filter,
  replyEvidence,
  now,
  retryAfterHours,
});
```

Then use `activeState.checklistAction` for `Offer slots`, `Wait for reply`, `Try again`, and `Review reply` lines instead of recalculating state independently.

- [x] **Step 6: Run the focused test**

Run:

```bash
node --import tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: all Pending Clients domain tests pass, including the new tag/checklist unison tests.

---

### Task 3: Keep 10x Evidence Audit Repeatable

**Files:**
- Modify: `scripts/audit-10x-communications-evidence.mjs`
- Test: `src/lib/client-message-audit-verification.test.ts`

- [x] **Step 1: Add active follow-up counts to the audit output**

In the audit, after `pendingActions`, add a PII-safe count bucket:

```js
const activeFollowUpActionCounts = pendingActions.reduce((acc, action) => {
  const key = action.action || 'unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
```

Add `activeFollowUpActionCounts` to the report and console JSON.

- [x] **Step 2: Run the communication verifier**

Run:

```bash
npm run verify:10x-communications
```

Expected: verifier passes and `tmp/10x-communications-evidence-audit.json` includes `decoderCoverage` plus the new active action count bucket.

---

### Task 4: Defer Laravel Task Keep-Alive Into A Guarded Writer Slice

**Files:**
- Read first: `src/scout-prep.tsx`
- Read first: `src/lib/scout-prep-task-completion.ts`
- Future slice modify: `src/lib/scout-prep-task-completion.ts`
- Future slice test: `src/lib/scout-prep-task-completion.test.ts`

- [x] **Step 1: Do not implement in the display cleanup pass**

Confirm this first pass remains read/derive/display only:

```bash
git diff -- src/lib/scout-prep-task-completion.ts src/scout-prep.tsx
```

Expected: no Laravel task mutation changes from Tasks 1-3.

Observed: this slice did not edit the Laravel task writer path. `src/scout-prep.tsx` already had unrelated pre-existing local diffs, so the keep-alive mutation remains deferred.

- [x] **Step 2: Open the next Linear checklist item**

Use this exact wording in Linear after Tasks 1-3 pass:

```md
Next slice: Laravel RSP/NS task keep-alive

- [ ] Trace exact Raycast Client Outreach send path
- [ ] Confirm which successful send payload owns task completion today
- [ ] Add due-date helper: two days later at 9:00 AM local operator time
- [ ] For RSP/No Show/Canceled attempts with remaining retries, update task due date instead of fully ending the workflow
- [ ] Keep final resolution/purge operator-approved
- [ ] Prove with mocked `/tasks/update` and `/tasks/complete` behavior before live use
```

- [x] **Step 3: Stop before coding this slice unless explicitly approved**

Expected: implementation agent reports that the keep-alive mutation is intentionally deferred until the display/evidence state is verified.

---

### Task 5: Final Verification

**Files:**
- Verify: `src/domain/pending-client-watchlist.test.ts`
- Verify: `src/lib/client-message-sandbox.test.ts`
- Verify: `scripts/audit-10x-communications-evidence.mjs`
- Verify: Raycast build

- [x] Run:

```bash
node --import tsx --test src/domain/pending-client-watchlist.test.ts
node --import tsx --test src/lib/client-message-sandbox.test.ts
npm run verify:10x-communications
npx ray build
git diff --check
```

Expected:
- Pending Clients tests pass.
- Decoder tests pass.
- 10x audit verification summary is `pass`.
- Raycast extension builds.
- Diff has no whitespace errors.
