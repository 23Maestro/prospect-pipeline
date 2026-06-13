# Pending Clients Operator Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Raycast Pending Clients the reliable operator queue by combining pending-client outcome rows with Client Messages thread evidence and Review Follow Ups theme classification.

**Architecture:** Enrollments & Outcomes owns the Pending Clients queue and post-meeting theme labels. Client Communication owns message-thread evidence and reply classification. Pre-Meeting Tasks contributes call-attempt timing signals, but Pending Clients should consume those signals instead of owning task-completion meaning. Raycast proves the source contract first; ScoutID later reuses the same contract as a two-tab command center with Messages and Pending Clients.

**Tech Stack:** Raycast React/TypeScript, existing `pending-client-watchlist` domain/lib helpers, existing `client-message-reply-themes` classifier, Supabase PostgREST read paths, local macOS Messages thread evidence, `node:test`/`tsx`.

---

## Bucket Classification

- Primary bucket: `Enrollments & Outcomes`
  - Owns pending-client review, no-show/follow-up/cancel/reschedule outcome meaning, and operator queue labels.
- Supporting bucket: `Client Communication`
  - Owns Client Messages thread evidence, last inbound/outbound, whether operator replied, and whether the reply proposed times.
- Supporting bucket: `Pre-Meeting Tasks`
  - Owns call-attempt task-title language and callback timing signals.
- Supporting bucket: `Meetings`
  - Owns reschedule slots and future appointment confirmation suppression.

Do not create a new queue helper or script. Reuse `src/domain/pending-client-watchlist.ts`, `src/lib/pending-client-watchlist.ts`, `src/lib/client-message-reply-themes.ts`, and the `Pending Clients` UI in `src/head-scout-schedules.tsx`.

## Supabase Source Of Truth

- Pending Clients admission remains `appointments.post_meeting_result` for `follow_up`, `reschedule_pending`, `no_show`, and `canceled`.
- `pending_client_watchlist` is support/tombstone state only. It can store resolved/expired metadata, but it must not be required for a row whose appointment outcome still needs operator follow-up.
- `set_meeting_confirmation_cache` may support meeting identity/timing context and future-confirmation suppression. It must not decide lifecycle stage, post-meeting outcome, or active appointment status.
- This plan should not add Supabase writers. If execution discovers a missing source fact, fix the existing Raycast action-time writer or an explicitly named audit/reconcile path instead of adding fallback guesses.

## File Structure

- Modify `src/lib/client-message-reply-themes.ts`
  - Extend the existing review row with a small evidence model:
    - last meaningful inbound
    - last meaningful outbound from operator
    - replied after inbound
    - reply proposed times
    - clear opt-out / no-interest
    - theme bucket
  - Keep classification pure and testable.

- Modify `src/lib/client-message-reply-themes.test.ts`
  - Add fixtures for RSP, no-show 1/2/3, cancel soft timing, cancel no-interest, call attempts, and operator replies that did or did not propose times.

- Modify `src/domain/pending-client-watchlist.ts`
  - Add pure Pending Clients display classification that consumes reply evidence without reading Messages or Supabase.
  - Keep source-event identity and durable outcome meaning here.

- Modify `src/domain/pending-client-watchlist.test.ts`
  - Pin the operator queue labels and sort priority from pure inputs.

- Modify `src/head-scout-schedules.tsx`
  - Render the new Pending Clients evidence tags/detail lines using domain output.
  - Keep actions and mutation paths unchanged.

- Optionally modify `src/client-message-inbox.tsx`
  - Only if Review Follow Ups needs to expose the same theme labels for operator review consistency.

---

### Task 1: Add Message Evidence Shape

**Files:**
- Modify: `src/lib/client-message-reply-themes.ts`
- Test: `src/lib/client-message-reply-themes.test.ts`

- [ ] **Step 1: Write failing evidence test**

Append a test that proves a pending reschedule row is still actionable when the operator replied after the inbound but did not propose times.

```ts
test('reschedule reply evidence distinguishes generic reply from proposed times', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-06-13T12:00:00.000Z',
    chats: [
      {
        guid: 'chat-rsp',
        displayName: 'Parent',
        athleteName: 'Avery Jones',
        athleteMainId: '9001',
        taskTitle: 'Reschedule Pending',
      },
    ],
    messagesByChatGuid: {
      'chat-rsp': [
        { guid: 'out-1', isFromMe: true, date: '2026-06-13T10:00:00.000Z', body: 'Please reply with the best fit. 1 reschedule, 2 bad timing, 3 no longer interested.' },
        { guid: 'in-1', isFromMe: false, date: '2026-06-13T10:05:00.000Z', body: '1' },
        { guid: 'out-2', isFromMe: true, date: '2026-06-13T10:10:00.000Z', body: 'No problem, I will check with Coach.' },
      ],
    },
  });

  assert.equal(snapshot.rows[0].operatorRepliedAfter, true);
  assert.equal(snapshot.rows[0].operatorRescheduleOfferAfter, false);
  assert.equal(snapshot.rows[0].replyEvidence.themeBucket, 'RSP');
  assert.equal(snapshot.rows[0].replyEvidence.lastMeaningfulInbound?.body, '1');
  assert.equal(snapshot.rows[0].replyEvidence.lastMeaningfulOutbound?.body, 'No problem, I will check with Coach.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test src/lib/client-message-reply-themes.test.ts
```

Expected: FAIL because `replyEvidence` and `themeBucket` do not exist yet.

- [ ] **Step 3: Implement the evidence type**

Add these exports near the existing review row types:

```ts
export type PendingClientThemeBucket =
  | 'RSP'
  | 'No Show'
  | 'Cancel'
  | 'Call Attempt'
  | 'Opt Out'
  | 'Unclassified';

export type ClientReplyMessageEvidence = {
  guid: string;
  body: string;
  date: string | null;
  senderName: string | null;
  isFromMe: boolean;
};

export type ClientReplyEvidence = {
  themeBucket: PendingClientThemeBucket;
  lastMeaningfulInbound: ClientReplyMessageEvidence | null;
  lastMeaningfulOutbound: ClientReplyMessageEvidence | null;
  operatorRepliedAfterInbound: boolean;
  operatorReplyProposedTimes: boolean;
  clientOptedOut: boolean;
};
```

Add `replyEvidence: ClientReplyEvidence;` to `ClientReplyThemeReviewRow`.

- [ ] **Step 4: Build evidence inside the snapshot**

Add a pure helper that receives sorted messages and the current inbound message:

```ts
function buildClientReplyEvidence(args: {
  messages: ClientReplyThemeReviewMessageInput[];
  inbound: ClientReplyThemeReviewMessageInput;
  theme: ClientMessageTheme;
  taskTitle?: string | null;
}): ClientReplyEvidence {
  const inboundDate = normalizeText(args.inbound.date);
  const meaningful = args.messages.filter((message) => normalizeText(message.body));
  const inboundMessages = meaningful.filter((message) => !message.isFromMe);
  const outboundMessages = meaningful.filter((message) => message.isFromMe);
  const outboundAfterInbound = outboundMessages.filter(
    (message) => normalizeText(message.date) > inboundDate,
  );
  const lastInbound = inboundMessages[inboundMessages.length - 1] || args.inbound;
  const lastOutbound = outboundMessages[outboundMessages.length - 1] || null;
  const operatorReply = outboundAfterInbound[outboundAfterInbound.length - 1] || null;

  return {
    themeBucket: classifyPendingClientThemeBucket(args.inbound.body, args.theme, args.taskTitle),
    lastMeaningfulInbound: toMessageEvidence(lastInbound),
    lastMeaningfulOutbound: lastOutbound ? toMessageEvidence(lastOutbound) : null,
    operatorRepliedAfterInbound: Boolean(operatorReply),
    operatorReplyProposedTimes: outboundAfterInbound.some((message) =>
      isOperatorRescheduleOffer(message.body),
    ),
    clientOptedOut: isClientOptOut(args.inbound.body),
  };
}
```

Keep `classifyPendingClientThemeBucket`, `toMessageEvidence`, and `isClientOptOut` in this same file as pure local helpers.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx tsx --test src/lib/client-message-reply-themes.test.ts
```

Expected: PASS.

---

### Task 2: Classify Theme Buckets

**Files:**
- Modify: `src/lib/client-message-reply-themes.ts`
- Test: `src/lib/client-message-reply-themes.test.ts`

- [ ] **Step 1: Add table-driven tests**

Add fixtures covering:

```ts
[
  ['1', 'Meeting Result - No Show', 'No Show'],
  ['2', 'Meeting Result - No Show', 'No Show'],
  ['3', 'Meeting Result - No Show', 'No Show'],
  ['Can we do later today?', 'Call Attempt 1', 'Call Attempt'],
  ['Call me after work', 'Call Attempt 2', 'Call Attempt'],
  ['We need to cancel but maybe another week', 'Meeting Result - Canceled', 'Cancel'],
  ['Not interested anymore', 'Meeting Result - Canceled', 'Opt Out'],
  ['Need to reschedule', 'Reschedule Pending', 'RSP'],
]
```

- [ ] **Step 2: Implement bucket classifier**

Use task title plus inbound text. Rules:

- `RSP`: task/stage contains `Reschedule Pending`, `Res. Pending`, or inbound asks to reschedule.
- `No Show`: task/stage contains `No Show`; preserve 1/2/3 submeaning in display evidence later.
- `Cancel`: cancel/canceled context without clear opt-out.
- `Opt Out`: text clearly says no interest, not interested, do not contact, stop, unsubscribe.
- `Call Attempt`: callback timing such as later today, tomorrow, specific time, after work, at work, call me back.
- `Unclassified`: fallback.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx tsx --test src/lib/client-message-reply-themes.test.ts
```

Expected: PASS.

---

### Task 3: Add Pending Clients Display Classification

**Files:**
- Modify: `src/domain/pending-client-watchlist.ts`
- Test: `src/domain/pending-client-watchlist.test.ts`

- [ ] **Step 1: Write failing queue classification tests**

Add tests for:

- `RSP` + no proposed times -> `Needs Times`
- `RSP` + proposed times -> `Awaiting RSP`
- `No Show` reply `1` + no proposed times -> `Needs Times`
- `No Show` reply `2` -> `Timing Bad`
- `No Show` reply `3` or opt-out -> `No Interest`
- `Cancel` + soft timing -> `Timing Issue`
- `Cancel` + opt-out -> `No Interest`
- Call-attempt timing -> `Call Back`

- [ ] **Step 2: Add pure domain function**

Export a function like:

```ts
export type PendingClientOperatorQueueLabel =
  | 'Needs Times'
  | 'Awaiting RSP'
  | 'Needs Reply'
  | 'Timing Bad'
  | 'Timing Issue'
  | 'No Interest'
  | 'Call Back'
  | 'Operator Input'
  | 'Follow Up'
  | 'Payment'
  | 'No Note';

export function classifyPendingClientOperatorQueue(input: {
  row: PendingClientWatchlistRow;
  replyEvidence?: {
    themeBucket: string;
    lastMeaningfulInbound?: { body: string } | null;
    operatorRepliedAfterInbound?: boolean;
    operatorReplyProposedTimes?: boolean;
    clientOptedOut?: boolean;
  } | null;
}): { label: PendingClientOperatorQueueLabel; priority: number } {
  // Implement only the tested rules. Do not read Supabase or Messages here.
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: PASS.

---

### Task 4: Wire Pending Clients UI To Domain Classification

**Files:**
- Modify: `src/head-scout-schedules.tsx`
- Test: `src/domain/architecture-contract.test.ts`

- [ ] **Step 1: Replace inline tag branching**

In `getPendingClientDisplayTag`, call `classifyPendingClientOperatorQueue({ row, replyEvidence: replyState?.row.replyEvidence })` and map labels to existing Raycast colors.

Use:

```ts
const colorByLabel: Record<string, Color> = {
  'Needs Times': Color.Red,
  'Needs Reply': Color.Red,
  'No Interest': Color.Red,
  'Awaiting RSP': Color.Yellow,
  'Timing Bad': Color.Orange,
  'Timing Issue': Color.Orange,
  'Call Back': Color.Blue,
  'Operator Input': Color.Red,
  'Follow Up': Color.Blue,
  Payment: Color.Green,
  'No Note': Color.Orange,
};
```

- [ ] **Step 2: Add evidence to detail markdown**

Append a compact evidence block when reply evidence exists:

```md
## Thread Evidence

- Last inbound: ...
- Last outbound: ...
- Reply status: proposed times / replied without times / no reply
```

Keep message bodies short and do not log or persist full PII outside the existing UI.

- [ ] **Step 3: Run build proof**

Run:

```bash
npx ray build
```

Expected: PASS, or only known unrelated Raycast baseline failures documented separately.

---

### Task 5: Keep Review Follow Ups Consistent

**Files:**
- Modify: `src/client-message-inbox.tsx`
- Test: `src/lib/client-message-reply-themes.test.ts`

- [ ] **Step 1: Render the same bucket label**

In Review Follow Ups rows, show the `replyEvidence.themeBucket` and reply status from the classifier. Do not add send/complete mutations in this task.

- [ ] **Step 2: Run focused proof**

Run:

```bash
npx tsx --test src/lib/client-message-reply-themes.test.ts
npx ray build
```

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

```bash
npx tsx --test src/lib/client-message-reply-themes.test.ts
npx tsx --test src/domain/pending-client-watchlist.test.ts
```

- [ ] **Step 2: Run repo proof gates**

```bash
git diff --check
npx ray build
```

- [ ] **Step 3: Optional broad Scout Prep proof**

Run when feasible:

```bash
npm test
```

Expected: PASS, or document any unrelated long-standing baseline failures separately.

## ScoutID Later

After Raycast proves the source logic, lift the contract into ScoutID as a two-page tab:

- `Messages`
- `Pending Clients`

ScoutID must consume this same evidence/classification contract. It should not assemble lifecycle meaning, manual-review semantics, or mutation payloads on the Mac side.
