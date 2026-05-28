# Client Message Missed Follow-Up Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable Client Messages review surface that catches missed actionable follow-ups from real local Messages threads, starting with reschedule and outreach callback replies.

**Architecture:** Use the existing Raycast Client Messages route as the source of truth for thread grouping: local Messages `chat` + `chat_message_join` + decoded `message.attributedBody`, admitted only through active `athlete_contact_cache`. The review system produces three buckets from the same scan: confident flags, near misses, and ignored/handled rows. Workflow state such as `Reschedule Pending` is a third gate that can keep a reply visible even when the operator sent a later message.

**Tech Stack:** Raycast React/TypeScript, `@raycast/api` `List`/`ActionPanel`, local macOS Messages SQLite `chat.db`, Supabase PostgREST `athlete_contact_cache` and `athlete_pipeline_state`, `node:test`, `tsx`.

---

## Current Discoveries To Preserve

- Client Messages renders reliably when threads are admitted by active `athlete_contact_cache`; do not return to macOS Contacts as the admission gate.
- Local Messages thread grouping should stay aligned with `src/lib/client-message-sandbox.ts`:
  - `chat.guid` is the stable thread key.
  - One-to-one threads use `participant_identifier` or `chat_identifier`.
  - Group threads use `group_participants`; any participant phone can match active contact cache.
  - Message rows come from `chat_message_join`.
- Live SQL trend from the review session:
  - 56 cache-routed chats.
  - 179 messages inside those routed threads.
  - 115 outbound, 64 inbound.
  - 179/179 had `message.attributedBody`.
  - Only 11 had plain `message.text`.
  - Therefore the review must decode `attributedBody` and must not depend on `message.text`.
- Current useful live buckets:
  - `Flags`: Joseph Tombari callback; Julian Russell, Ta'vion Dickens, and Caden Pritchett pending reschedules.
  - `Near Misses`: Elia Imani reschedule language without enough template/task context.
  - `Ignored: Replied After`: examples like Tavaris Moore and Austin Jones where a later operator reply probably handled the callback.
- The Tiffany Pritchett / Caden Pritchett case is the guiding reschedule pattern:
  - Client asked to reschedule.
  - Operator replied with a question/options.
  - Client did not provide a real scheduling answer.
  - Pipeline still says `Reschedule Pending`.
  - The row should remain visible.

## File Structure

- Modify `src/lib/client-message-reply-themes.ts`
  - Own the pure review logic and cached snapshot shape.
  - Keep only two first-pass themes: `reschedule_request` and `outreach_callback`.
  - Keep three buckets: `rows`, `nearMisses`, and `ignoredHandled`.
  - Add unresolved-workflow evidence to rows so the UI can explain why a later reply did not suppress a flag.

- Modify `src/lib/client-message-reply-themes.test.ts`
  - Pin the SQL-derived business rules with small thread fixtures.
  - Cover Pritchett-style pending reschedule cases.
  - Cover ignored handled callbacks.
  - Cover near misses for evidence-driven tuning.

- Modify `src/client-message-inbox.tsx`
  - Render the three buckets in `Review Follow Ups`.
  - Show concise row labels and evidence: theme, context, task/status, and latest reply state.
  - Keep follow-up actions manual.

- Modify `src/lib/client-message-sandbox.ts`
  - Do not change admission behavior unless a test proves thread grouping is wrong.
  - Export or reuse decoded message helpers only if it reduces duplicate SQL drift.

- Create `scripts/inspect-client-message-follow-up-review.mjs`
  - Read-only diagnostics for live SQL and Supabase state.
  - Print counts and example buckets without sending messages or mutating CRM.
  - Use this script to verify behavior while developing over time.

- Future branch plan file: `docs/superpowers/plans/2026-05-28-client-message-confirmation-options-branch.md`
  - Reserve a separate branch of work for dynamic options derived from confirmation/reschedule data discoveries.
  - This branch must not block the first review surface.

---

### Task 1: Lock SQL Trend Discovery Into A Read-Only Diagnostic

**Files:**
- Create: `scripts/inspect-client-message-follow-up-review.mjs`

- [ ] **Step 1: Create the diagnostic script**

Create `scripts/inspect-client-message-follow-up-review.mjs` with this content:

```js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { buildClientReplyThemeReviewSnapshot } from '../src/lib/client-message-reply-themes.ts';

const root = process.cwd();
const messagesDbPath = path.join(homedir(), 'Library/Messages/chat.db');

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
        if (!match) return [];
        return [[match[1], match[2].replace(/^['"]|['"]$/g, '').trim()]];
      }),
  );
}

const env = {
  ...readEnv(path.join(root, 'npid-api-layer/.env')),
  ...readEnv(path.join(root, '.env')),
  ...process.env,
};

const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '');
const schema = String(env.SUPABASE_SCHEMA || 'public');

function sqliteJson(sql) {
  const out = execFileSync('sqlite3', ['-json', messagesDbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 100_000_000,
  });
  return JSON.parse(out || '[]');
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

function chatPhones(chat) {
  const raw = Number(chat.is_group)
    ? String(chat.group_participants || '').split(',')
    : [chat.participant_identifier || chat.chat_identifier];
  return Array.from(new Set(raw.map(normalizePhone).filter(Boolean)));
}

function postgrestIn(values) {
  return `(${values.map((value) => `"${String(value).replace(/"/g, '')}"`).join(',')})`;
}

async function supabaseRead(table, query) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Accept-Profile': schema,
      'Content-Profile': schema,
    },
  });
  if (!response.ok) throw new Error(`${table}: ${await response.text()}`);
  return response.json();
}

function decodeHexString(hexString) {
  const startPattern = [0x01, 0x2b];
  const endPattern = [0x86, 0x84];
  const bytes = String(hexString || '')
    .match(/.{1,2}/g)
    ?.map((byte) => parseInt(byte, 16)) || [];

  let startIndex = -1;
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (bytes[i] === startPattern[0] && bytes[i + 1] === startPattern[1]) {
      startIndex = i + 2;
      break;
    }
  }
  if (startIndex === -1) return '';

  let endIndex = -1;
  for (let i = startIndex; i < bytes.length - 1; i += 1) {
    if (bytes[i] === endPattern[0] && bytes[i + 1] === endPattern[1]) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return '';

  const result = new TextDecoder('utf-8', { fatal: false }).decode(
    new Uint8Array(bytes.slice(startIndex, endIndex)),
  );
  return result.charCodeAt(0) < 128 ? result.slice(1) : result.slice(3);
}

function titleCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split('-')
        .map((piece) => (piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece))
        .join('-'),
    )
    .join(' ');
}

function snippet(value, max = 190) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const chats = sqliteJson(`
SELECT
  chat.guid,
  chat.chat_identifier,
  MAX(handle.id) AS participant_identifier,
  chat.display_name,
  CASE WHEN COUNT(DISTINCT handle.id) > 1 THEN 1 ELSE 0 END AS is_group,
  CASE WHEN COUNT(DISTINCT handle.id) > 1 THEN GROUP_CONCAT(DISTINCT handle.id) ELSE handle.id END AS group_participants,
  strftime('%Y-%m-%dT%H:%M:%fZ', datetime(MAX(message.date) / 1000000000 + strftime('%s','2001-01-01'), 'unixepoch')) AS last_message_date
FROM chat
JOIN chat_message_join ON chat.ROWID = chat_message_join.chat_id
JOIN message ON chat_message_join.message_id = message.ROWID
LEFT JOIN chat_handle_join ON chat.ROWID = chat_handle_join.chat_id
LEFT JOIN handle ON chat_handle_join.handle_id = handle.ROWID
WHERE handle.id IS NOT NULL
GROUP BY chat.guid
ORDER BY MAX(message.date) DESC
LIMIT 1000;
`);

const phones = Array.from(new Set(chats.flatMap(chatPhones)));
const cacheRows = await supabaseRead(
  'athlete_contact_cache',
  [
    'select=athlete_key,athlete_id,athlete_main_id,athlete_name,contact_id,contact_name,normalized_phone',
    'cache_status=eq.active',
    `normalized_phone=in.${postgrestIn(phones)}`,
    'order=last_seen_at.desc',
  ].join('&'),
);

const athleteKeys = Array.from(
  new Set(cacheRows.map((row) => String(row.athlete_key || '')).filter(Boolean)),
);
const pipelineRows = athleteKeys.length
  ? await supabaseRead(
      'athlete_pipeline_state',
      [
        'select=athlete_key,crm_stage,task_status,current_task_title',
        `athlete_key=in.${postgrestIn(athleteKeys)}`,
      ].join('&'),
    )
  : [];
const pipelineByKey = new Map(pipelineRows.map((row) => [String(row.athlete_key || ''), row]));

const rowsByPhone = new Map();
for (const row of cacheRows) {
  const phone = String(row.normalized_phone || '');
  if (phone && !rowsByPhone.has(phone)) rowsByPhone.set(phone, row);
}

const routed = chats
  .map((chat) => ({ chat, matchedPhones: chatPhones(chat).filter((phone) => rowsByPhone.has(phone)) }))
  .filter((entry) => entry.matchedPhones.length);
const routedByGuid = new Map(routed.map((entry) => [entry.chat.guid, entry]));
const routedGuidSet = new Set(routedByGuid.keys());

const chatInputs = routed.map(({ chat, matchedPhones }) => {
  const row = rowsByPhone.get(matchedPhones[0]) || {};
  const pipeline = pipelineByKey.get(String(row.athlete_key || '')) || {};
  return {
    guid: chat.guid,
    displayName: titleCase(row.contact_name) || titleCase(chat.display_name) || matchedPhones[0],
    lastMessageDate: chat.last_message_date,
    athleteName: titleCase(row.athlete_name),
    contactId: row.contact_id || row.athlete_id || null,
    athleteMainId: row.athlete_main_id || null,
    taskTitle: pipeline.current_task_title || pipeline.task_status || pipeline.crm_stage || null,
    matchedPhones,
  };
});

const messages = sqliteJson(`
SELECT
  chat.guid AS chat_guid,
  message.guid,
  strftime('%Y-%m-%dT%H:%M:%fZ', datetime(message.date / 1000000000 + strftime('%s','2001-01-01'), 'unixepoch')) AS date,
  message.is_from_me,
  chat.chat_identifier,
  hex(message.attributedBody) AS body
FROM message
JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
JOIN chat ON chat_message_join.chat_id = chat.ROWID
WHERE message.attributedBody IS NOT NULL
ORDER BY message.date DESC
LIMIT 10000;
`);

const messagesByChatGuid = {};
for (const message of messages) {
  if (!routedGuidSet.has(message.chat_guid)) continue;
  const body = decodeHexString(message.body);
  if (!body.trim()) continue;
  (messagesByChatGuid[message.chat_guid] ||= []).push({
    guid: message.guid,
    body,
    date: message.date,
    senderName: Number(message.is_from_me) ? 'Me' : routedByGuid.get(message.chat_guid).chat.display_name,
    sender: message.chat_identifier,
    isFromMe: Boolean(Number(message.is_from_me)),
  });
}

const snapshot = buildClientReplyThemeReviewSnapshot({ chats: chatInputs, messagesByChatGuid });

function renderRows(rows) {
  return rows.slice(0, 12).map((row) => ({
    theme: row.theme,
    context: row.templateContext,
    reason: row.reason || null,
    date: row.messageDate,
    athlete: row.athleteName,
    contact: row.displayName,
    task: row.taskTitle,
    text: snippet(row.messageBody),
  }));
}

console.log(
  JSON.stringify(
    {
      routedChats: routed.length,
      totalMessagesReviewed: snapshot.totalMessagesReviewed,
      flags: snapshot.rows.length,
      nearMisses: snapshot.nearMisses.length,
      ignoredHandled: snapshot.ignoredHandled.length,
      examples: {
        flags: renderRows(snapshot.rows),
        nearMisses: renderRows(snapshot.nearMisses),
        ignoredHandled: renderRows(snapshot.ignoredHandled),
      },
    },
    null,
    2,
  ),
);
```

- [ ] **Step 2: Run the diagnostic**

Run:

```bash
node --import tsx scripts/inspect-client-message-follow-up-review.mjs
```

Expected:

```text
"routedChats": 56
"totalMessagesReviewed": 179
"flags": 4
"nearMisses": 1
```

The exact counts can drift as Messages and Supabase update, but the output must include `flags`, `nearMisses`, `ignoredHandled`, and example rows.

- [ ] **Step 3: Commit**

```bash
git add scripts/inspect-client-message-follow-up-review.mjs
git commit -m "chore: add client message follow-up review diagnostic"
```

---

### Task 2: Formalize The Three Review Buckets

**Files:**
- Modify: `src/lib/client-message-reply-themes.ts`
- Test: `src/lib/client-message-reply-themes.test.ts`

- [ ] **Step 1: Write the failing bucket tests**

Append these tests to `src/lib/client-message-reply-themes.test.ts`:

```ts
test('near misses keep actionable replies without enough outbound context', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: null })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'reply',
          body: 'I want to reschedule again like evening',
          date: '2026-05-27T16:00:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.nearMisses.length, 1);
  assert.equal(snapshot.nearMisses[0].reason, 'no_template_context');
});

test('ignored handled keeps evidence when operator replied after callback', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 1' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Avery’s profile came through and I wanted to ask a few quick questions about his college football goals.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'reply',
          body: 'Tomorrow would work',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'handled',
          body: 'Okay, I can follow up then',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.ignoredHandled.length, 1);
  assert.equal(snapshot.ignoredHandled[0].theme, 'outreach_callback');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --import tsx --test src/lib/client-message-reply-themes.test.ts
```

Expected: FAIL until `nearMisses` and `ignoredHandled` exist.

- [ ] **Step 3: Implement bucket properties**

In `src/lib/client-message-reply-themes.ts`, ensure the snapshot includes:

```ts
export type ClientReplyThemeNearMissReason = 'no_template_context' | 'wrong_template_context';

export type ClientReplyThemeNearMissRow = ClientReplyThemeReviewRow & {
  reason: ClientReplyThemeNearMissReason;
};

export type ClientReplyThemeReviewSnapshot = {
  version: 1;
  generatedAt: string;
  totalChatsReviewed: number;
  totalMessagesReviewed: number;
  rows: ClientReplyThemeReviewRow[];
  nearMisses: ClientReplyThemeNearMissRow[];
  ignoredHandled: ClientReplyThemeReviewRow[];
};
```

In `buildClientReplyThemeReviewSnapshot(...)`, use:

```ts
const rows: ClientReplyThemeReviewRow[] = [];
const nearMisses: ClientReplyThemeNearMissRow[] = [];
const ignoredHandled: ClientReplyThemeReviewRow[] = [];
```

When an actionable reply has no matching context and no later operator reply:

```ts
nearMisses.push({
  ...baseRow,
  reason: latestTemplateContext ? 'wrong_template_context' : 'no_template_context',
});
```

When an actionable reply has matching context but a later operator reply:

```ts
ignoredHandled.push(baseRow);
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import tsx --test src/lib/client-message-reply-themes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-message-reply-themes.ts src/lib/client-message-reply-themes.test.ts
git commit -m "feat: bucket client message follow-up review results"
```

---

### Task 3: Add The Pending Reschedule Third Gate

**Files:**
- Modify: `src/lib/client-message-reply-themes.ts`
- Test: `src/lib/client-message-reply-themes.test.ts`

- [ ] **Step 1: Write the failing Pritchett-style test**

Append this test to `src/lib/client-message-reply-themes.test.ts`:

```ts
test('pending reschedule remains visible even when operator replied after client reschedule request', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Reschedule Pending' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'confirmation',
          body: 'Coach Ryan has Avery down for the meeting today at 5:00 PM.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client',
          body: 'Is there any way to reschedule this?',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'operator',
          body: 'No problem! Would an evening time work this week?',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'client-thanks',
          body: 'Thank you!',
          date: '2026-05-27T16:30:00.000Z',
        }),
      ],
    },
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].theme, 'reschedule_request');
  assert.equal(snapshot.rows[0].taskTitle, 'Reschedule Pending');
  assert.equal(snapshot.ignoredHandled.length, 0);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --import tsx --test src/lib/client-message-reply-themes.test.ts
```

Expected: FAIL until pending reschedule overrides later-operator suppression.

- [ ] **Step 3: Implement the third gate**

Add this helper to `src/lib/client-message-reply-themes.ts`:

```ts
function isPendingRescheduleContext(value?: string | null): boolean {
  return /\breschedule\s+pending\b|\bpending\s+reschedule\b|\bres\.\s*pending\b/i.test(
    normalizeText(value),
  );
}
```

Inside the candidate row logic:

```ts
const keepPendingRescheduleVisible =
  candidateTheme === 'reschedule_request' && isPendingRescheduleContext(chat.taskTitle);

if (theme && latestTemplateContext) {
  if (operatorRepliedAfter && !keepPendingRescheduleVisible) {
    ignoredHandled.push(baseRow);
  } else {
    rows.push(baseRow);
  }
  continue;
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import tsx --test src/lib/client-message-reply-themes.test.ts
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-message-reply-themes.ts src/lib/client-message-reply-themes.test.ts
git commit -m "feat: keep pending reschedule replies visible"
```

---

### Task 4: Render Buckets In Client Messages

**Files:**
- Modify: `src/client-message-inbox.tsx`

- [ ] **Step 1: Add three `List.Section` buckets**

In `ClientReplyThemeReview`, render:

```tsx
<List.Section title={`Flags (${snapshot?.rows.length || 0})`}>
  {(snapshot?.rows || []).map((row) => renderRow(row, 'flag'))}
</List.Section>
<List.Section title={`Near Misses (${snapshot?.nearMisses.length || 0})`}>
  {(snapshot?.nearMisses || []).map((row) => renderRow(row, 'nearMiss'))}
</List.Section>
<List.Section title={`Ignored: Replied After (${snapshot?.ignoredHandled.length || 0})`}>
  {(snapshot?.ignoredHandled || []).map((row) => renderRow(row, 'handled'))}
</List.Section>
```

- [ ] **Step 2: Make row tone visible**

Use these labels:

```ts
function themeLabel(theme: ClientReplyThemeReviewRow['theme']): string {
  if (theme === 'reschedule_request') return 'Reschedule';
  return 'Call Back';
}

function templateContextLabel(context: ClientReplyThemeReviewRow['templateContext']): string {
  return context === 'confirmation' ? 'Confirmation' : 'Attempt';
}
```

For handled rows, expose only `Open Thread` and refresh actions. For `Flags` and `Near Misses`, expose:

```tsx
<Action title="Create Follow-Up" />
<Action title="Open Thread" />
<Action title="Open Scout Prep" />
```

- [ ] **Step 3: Verify**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client-message-inbox.tsx
git commit -m "feat: show client message follow-up review buckets"
```

---

### Task 5: Add Reminder And Calendar Evidence Before Treating Handled As Safe

**Files:**
- Modify: `src/lib/client-message-reply-themes.ts`
- Modify: `src/client-message-inbox.tsx`
- Test: `src/lib/client-message-reply-themes.test.ts`
- Reference: `src/lib/reminders.ts`
- Reference: `src/lib/apple-calendar-follow-ups.ts`
- Reference: `src/lib/cal-follow-ups.ts`

- [ ] **Step 1: Write a pure evidence test**

Append this test to `src/lib/client-message-reply-themes.test.ts`:

```ts
test('handled rows can carry reminder evidence for later filtering', () => {
  const snapshot = buildClientReplyThemeReviewSnapshot({
    generatedAt: '2026-05-27T17:00:00.000Z',
    chats: [chat({ taskTitle: 'Call Attempt 1' })],
    messagesByChatGuid: {
      'chat-1': [
        message({
          guid: 'attempt',
          body: 'Avery’s profile came through and I wanted to ask a few quick questions about his college football goals.',
          date: '2026-05-27T14:00:00.000Z',
          isFromMe: true,
        }),
        message({
          guid: 'reply',
          body: 'Tomorrow would work',
          date: '2026-05-27T15:00:00.000Z',
        }),
        message({
          guid: 'handled',
          body: 'Okay, I can follow up then',
          date: '2026-05-27T16:00:00.000Z',
          isFromMe: true,
        }),
      ],
    },
    reminderEvidenceByChatGuid: {
      'chat-1': {
        hasReminder: true,
        source: 'apple_calendar',
        label: 'Call Tiffany Rawls',
      },
    },
  });

  assert.equal(snapshot.ignoredHandled.length, 1);
  assert.equal(snapshot.ignoredHandled[0].reminderEvidence?.hasReminder, true);
});
```

- [ ] **Step 2: Implement optional evidence**

Extend row type:

```ts
export type ClientReplyReminderEvidence = {
  hasReminder: boolean;
  source: 'apple_calendar' | 'cal' | 'raycast_reminder' | 'unknown';
  label: string | null;
};
```

Add optional argument:

```ts
reminderEvidenceByChatGuid?: Record<string, ClientReplyReminderEvidence | undefined>;
```

When building `baseRow`, include:

```ts
reminderEvidence: args.reminderEvidenceByChatGuid?.[chat.guid],
```

- [ ] **Step 3: Keep UI conservative**

In `src/client-message-inbox.tsx`, do not hide handled rows automatically. Add a tag:

```tsx
...(row.reminderEvidence?.hasReminder
  ? [{ tag: { value: 'Reminder', color: Color.Green } }]
  : [])
```

- [ ] **Step 4: Verify**

Run:

```bash
node --import tsx --test src/lib/client-message-reply-themes.test.ts
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-message-reply-themes.ts src/lib/client-message-reply-themes.test.ts src/client-message-inbox.tsx
git commit -m "feat: attach reminder evidence to handled client replies"
```

---

### Task 6: Pending Branch For Dynamic Options From Confirmation Data

**Files:**
- Create: `docs/superpowers/plans/2026-05-28-client-message-confirmation-options-branch.md`

- [ ] **Step 1: Create branch plan file**

Create `docs/superpowers/plans/2026-05-28-client-message-confirmation-options-branch.md`:

```md
# Client Message Confirmation Options Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use confirmation and reschedule data discoveries to propose dynamic follow-up options for missed client replies.

**Architecture:** This branch starts after the missed follow-up review surface is stable. It should read existing confirmation cache, booked meeting, and head scout opening data to suggest options, but it must keep all actions manual until the suggested copy is proven reliable.

**Tech Stack:** Raycast React/TypeScript, Supabase PostgREST, local Messages SQLite, existing head scout schedule utilities.

---

## Branch Rules

- Do not block the first review surface.
- Do not auto-send messages.
- Do not auto-create CRM or lifecycle writes.
- Start with reschedule examples such as Caden Pritchett / Tiffany Pritchett.
- Only suggest dynamic options when the current data source can explain where the options came from.

## Candidate Data Sources

- `set_meeting_confirmation_cache` for original confirmation messages.
- `athlete_pipeline_state` for current unresolved state.
- Existing booked meeting details for prior head scout context.
- Head scout openings from `src/lib/head-scout-schedules.ts`.
- Apple Calendar / Reminder evidence after Task 5 from the main plan.

## First Experiments

1. For pending reschedule flags, show prior outbound reply and latest client reply.
2. Resolve previous head scout and current open slots.
3. Suggest two slot options in the same style as the reschedule voicemail flow.
4. Keep the suggested copy in a preview form with manual send.

## Exit Criteria

- Dynamic options appear only for rows with `Reschedule Pending`.
- Every suggestion includes data-source evidence.
- Operator can edit or reject the suggestion before any follow-up action.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-28-client-message-confirmation-options-branch.md
git commit -m "docs: plan confirmation option branch for client replies"
```

---

## Verification Checklist

- Run focused tests:

```bash
node --import tsx --test src/lib/client-message-reply-themes.test.ts
```

- Run build:

```bash
npm run build
```

- Run live diagnostic:

```bash
node --import tsx scripts/inspect-client-message-follow-up-review.mjs
```

- Confirm the diagnostic shows live buckets and examples:

```text
flags
nearMisses
ignoredHandled
```

## Self-Review

- Spec coverage: This plan covers SQL trend discovery, current live rendering behavior, two first-pass themes, Pritchett-style pending reschedule logic, handled callback evidence, and a separate future branch for dynamic confirmation/reschedule options.
- Scope control: The first surface remains manual review only. No auto-send, auto-reminder, or CRM mutation is introduced.
- Type consistency: `rows`, `nearMisses`, and `ignoredHandled` are snapshot properties; `taskTitle` carries current task/status text; `Reschedule Pending` is the third-gate state.
- Known gap: Reminder/calendar evidence is planned as Task 5 and should be implemented before hiding handled callback replies such as Tavaris Moore from review.
