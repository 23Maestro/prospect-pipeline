# Client Messages Scout Prep Two Way Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Client Messages and Scout Prep reliable as a two-way working system: Scout Prep can open the right message thread, Client Messages can show the right student athlete and parent context, and missed replies can later be reviewed by theme.

**Architecture:** `athlete_contact_cache` is the first source of truth for message routing because Scout Prep task-list ingest writes it. macOS Contacts must not decide whether a thread belongs in Client Messages; it can only be optional display enrichment after a contact-cache match exists. The first pass hardens identity and navigation; the second pass adds a transcript view; the third pass classifies common missed-reply themes.

**Tech Stack:** Raycast React/TypeScript, `@raycast/api` `List`/`Detail`/`Form`/`ActionPanel`, local Messages `chat.db`, Supabase PostgREST, `node:test`, existing Scout Prep contact-cache sync.

---

## Current Plain-English Contract

- Scout Prep task-list ingest writes `athlete_contact_cache`.
- Client Messages reads recent local Messages threads.
- Client Messages normalizes thread phone numbers.
- Client Messages admits a thread only when an active `athlete_contact_cache` row matches a thread phone.
- The row must show reliable tags:
  - `Group` when the thread has multiple participants.
  - student athlete name from contact cache.
  - resolved parent/contact names from the same athlete contact-cache family rows.
- Duplicate parent/student-athlete phone rule: if the same phone appears for a parent and the student athlete, treat that phone as the student athlete's number for front-facing options and send defaults.
- When one task has two or three distinct contact numbers, show a small numbered chooser instead of guessing.
- Scout Prep should be able to open the related message thread.
- Client Messages should be able to open related Scout Prep details/actions.
- Confirmation cache is not the filter for Client Messages.
- macOS Contacts is not the filter for Client Messages.

## File Structure

- Modify `src/lib/student-athlete-message-resolver.ts`
  - Keep it as the single middle resolver for phone-to-student-athlete message identity.
  - Return a deterministic `primaryContact`, `associatedContacts`, and ambiguity state.
  - Reuse the duplicate-phone business rule from `src/domain/scout-contact-selection.ts`: student athlete wins over parent when the normalized phone is the same.

- Modify `src/lib/student-athlete-message-resolver.test.ts`
  - Pin family contact grouping, duplicate phone handling, parent-name display, and group ambiguity.

- Modify `src/lib/client-message-sandbox.ts`
  - Keep `athlete_contact_cache` as the admission source.
  - Keep local Messages `chat.db` as the thread source.
  - Build one stable `ClientDirectoryMatch` per matched phone.

- Modify `src/client-message-inbox.tsx`
  - Keep inbox list compact.
  - Add Scout Prep related-detail action once the resolver shape is stable.
  - Add one optional message-markdown route last, if the two-way system still needs it.

- Modify `src/scout-prep.tsx`
  - Add or refine the action from a task row to Client Messages only after the resolver can identify the target reliably.
  - When multiple distinct contact numbers exist, use a numbered Grid/list chooser patterned after Scout Openings.

- Modify `docs/architecture/scout-prep-client-message-lifecycle-flowcharts.md`
  - Keep the contract readable: contact cache gates Client Messages; lifecycle tells whether a cache row stays active.

- Create `src/lib/client-message-theme-classifier.ts`
  - Later phase. Pure helper that classifies common reply themes from message text.

- Create `src/lib/client-message-theme-classifier.test.ts`
  - Later phase. Tests for reschedule, available later today, available tomorrow, schedule follow-up, and no-action replies.

---

### Task 1: Pin Contact Cache As The Client Messages Gate

**Files:**
- Modify: `src/lib/client-message-sandbox.ts`
- Modify: `docs/architecture/scout-prep-client-message-lifecycle-flowcharts.md`
- Test: `src/domain/architecture-contract.test.ts`

- [x] **Step 1: Add architecture guard text**

In `docs/architecture/scout-prep-client-message-lifecycle-flowcharts.md`, keep these exact statements:

```md
Current behavior: active `athlete_contact_cache` rows admit a thread into Client Messages. macOS contact groups are not the filter.

Current behavior: `athlete_contact_cache` plus lifecycle state is the gate. Other caches do not decide whether a client message belongs in the workflow.
```

- [x] **Step 2: Pin the wording in architecture test**

In `src/domain/architecture-contract.test.ts`, ensure the flowchart test includes:

```ts
'active `athlete_contact_cache` rows admit a thread into Client Messages',
'plus lifecycle state is the gate',
```

- [x] **Step 3: Remove contact-group admission from Client Messages**

In `src/lib/client-message-sandbox.ts`, `loadClientDirectory()` should only build `matchesByPhone` from:

```ts
const matchesByPhone = new Map<string, ClientDirectoryMatch>();
const chatPhones = Array.from(new Set(chats.flatMap((chat) => getChatParticipantPhones(chat))));
const contactCacheResolutions = await resolveStudentAthleteMessagesForPhones(chatPhones).catch(
  () => [] as StudentAthleteMessageResolution[],
);

mergeContactCacheMatches(matchesByPhone, contactCacheResolutions);
```

There should be no call to `fetchContactsInGroup()` inside this admission path.

- [x] **Step 4: Verify**

Run:

```bash
npm run test:domain
node --import tsx --test src/lib/student-athlete-message-resolver.test.ts
npx ray build
```

Expected: domain tests pass, resolver tests pass, Raycast build passes.

---

### Task 2: Make The Resolver Return Reliable Display Facts

**Files:**
- Modify: `src/lib/student-athlete-message-resolver.ts`
- Modify: `src/lib/student-athlete-message-resolver.test.ts`
- Modify: `src/lib/client-message-sandbox.ts`
- Reference: `src/domain/scout-contact-selection.ts`
- Reference tests: `src/lib/scout-prep-contact.test.ts`

- [x] **Step 1: Add resolver tests for reliable names**

Add tests that prove:

```ts
assert.equal(resolutions[0].athleteName, 'Avery Jones');
assert.equal(resolutions[0].displayName, 'Tiffany Jones');
assert.deepEqual(
  resolutions[0].associatedContacts.map((contact) => `${contact.role}:${contact.name}`),
  ['parent1:Tiffany Jones', 'studentAthlete:Avery Jones'],
);
```

- [x] **Step 2: Add resolver tests for duplicate family phone**

Reuse the existing rule from `src/domain/scout-contact-selection.ts`: `getProspectContactShortcutCandidates()` and `getVoicemailFollowUpRecipients()` let `studentAthlete` replace parent when the normalized phone is duplicated. Add the same expectation to `src/lib/student-athlete-message-resolver.test.ts`.

Add a resolver test where parent and student athlete share a phone:

```ts
test('message resolver dedupes parent and athlete shared phone to student athlete default', () => {
  const resolutions = buildStudentAthleteMessageResolutions([
    cacheRow({
      contactName: 'Robert Bailey',
      relationshipLabel: 'Father',
      normalizedPhone: '3105551111',
      athleteName: 'Jaylin Bailey',
    }),
    cacheRow({
      contactName: 'Jaylin Bailey',
      relationshipLabel: 'Student Athlete',
      normalizedPhone: '3105551111',
      athleteName: 'Jaylin Bailey',
    }),
  ]);

  assert.equal(resolutions[0].ambiguity, 'none');
  assert.equal(resolutions[0].athleteName, 'Jaylin Bailey');
  assert.equal(resolutions[0].displayName, 'Jaylin Bailey');
  assert.equal(resolutions[0].primaryContact?.role, 'studentAthlete');
});
```

- [x] **Step 3: Implement the duplicate-phone rule in the resolver**

Add a resolver helper that mirrors the current contact-selection behavior:

```ts
const CONTACT_ROLE_PRIORITY = ['parent1', 'parent2', 'studentAthlete'] as const;

function shouldReplaceContactForPhone(existing: StudentAthleteMessageAssociatedContact | undefined, incoming: StudentAthleteMessageAssociatedContact): boolean {
  if (!existing) return true;
  return incoming.role === 'studentAthlete';
}
```

Use it when deduping `associatedContacts` by `normalizedPhoneNumber`, so the front-facing option for a shared parent/student number becomes the student athlete.

- [x] **Step 4: Keep ambiguity only for multiple athletes**

The resolver should set:

```ts
ambiguity:
  (athleteKeysByPhone.get(row.normalizedPhone)?.size || 0) > 1
    ? 'multiple_athletes'
    : 'none'
```

This means family members for one athlete are normal; one phone linked to two athlete keys is a review case.

- [x] **Step 5: Verify**

Run:

```bash
node --import tsx --test src/lib/student-athlete-message-resolver.test.ts
```

Expected: resolver tests pass.

---

### Task 3: Stabilize Inbox Tags And Row Meaning

**Files:**
- Modify: `src/client-message-inbox.tsx`
- Modify: `src/lib/client-message-sandbox.ts`

- [x] **Step 1: Keep left row minimal**

The row title should stay:

```tsx
title={chat.displayName}
```

The subtitle may stay task-oriented:

```tsx
subtitle={chat.clientMatch.currentTaskTitle || chat.clientMatch.taskStatus || ''}
```

- [x] **Step 2: Keep tags deterministic**

The row accessories should include:

```tsx
...(chat.clientMatch.ambiguity === 'multiple_athletes'
  ? [{ tag: { value: 'Review', color: Color.Red } }]
  : []),
...(chat.clientMatch.athleteName
  ? [
      {
        tag: {
          value: chat.clientMatch.athleteName,
          color: tagColorFor(chat.clientMatch.athleteName),
        },
      },
    ]
  : []),
...(chat.is_group ? [{ tag: { value: 'Group', color: Color.Yellow } }] : []),
```

- [x] **Step 3: Verify in Raycast build**

Run:

```bash
npx ray build
```

Expected: build passes.

---

### Task 4: Define Scout Prep To Messages And Messages To Scout Prep Navigation

**Files:**
- Modify: `src/scout-prep.tsx`
- Modify: `src/client-message-inbox.tsx`
- Modify: `src/lib/student-athlete-message-resolver.ts`

- [x] **Step 1: Scout Prep to Messages**

Add a task-row action only when the task has contact-cache phone evidence. If one resolved phone exists, open the matching messages flow directly:

```tsx
<Action
  title="Open Client Messages"
  shortcut={{ modifiers: ['cmd', 'shift'], key: 'm' }}
  onAction={() => {
    // Open Client Message Inbox with a query or launch context for this athlete/contact.
  }}
/>
```

The implementation must pass athlete/contact identity through Raycast launch context or a shared resolver input, not through macOS Contacts.

- [x] **Step 2: If two or three distinct numbers exist, show a numbered chooser**

Use the existing Scout Openings pattern from `src/head-scout-schedules.tsx`:

```ts
const SCOUT_GRID_SHORTCUT_KEYS: readonly KeyEquivalent[] = ['1', '2', '3', '4', '5', '6'];
```

For contact choices, use only the first three keys:

```ts
const CONTACT_CHOICE_SHORTCUT_KEYS: readonly KeyEquivalent[] = ['1', '2', '3'];
```

The chooser titles should be numbered:

```tsx
title={`${index + 1}. ${option.label} / ${option.name}`}
```

Each action should use the matching unmodified number key:

```tsx
shortcut={shortcutKey ? { modifiers: [], key: shortcutKey } : undefined}
```

The option source must reuse the contact-selection order and duplicate-phone behavior:

```ts
getProspectContactShortcutCandidates(context)
```

Expected examples:

```text
1. Parent 1 / Tiffany Jones
2. Student Athlete / Avery Jones
3. Parent 2 / Chris Jones
```

If Parent 1 and Student Athlete share the same number, only show:

```text
1. Student Athlete / Avery Jones
```

- [x] **Step 3: Messages to Scout Prep**

Add a transcript/inbox action:

```tsx
<Action
  title="Open Scout Prep Details"
  onAction={() => {
    // Push a Scout Prep detail/action view using chat.clientMatch.athleteMainId and contactId.
  }}
/>
```

- [x] **Step 4: All related actions must respect the selected/default contact**

These actions must use the same resolved contact option:

```text
Open Client Messages
Reply
Create Follow-Up
Open Scout Prep Details
```

If the phone is shared by parent and athlete, each action should assume `studentAthlete`, matching the voicemail follow-up rule.

- [x] **Step 5: Do not complete this task until Task 2 is stable**

This task depends on reliable `athleteName`, `contactId`, `athleteMainId`, and `associatedContacts`.

---

### Task 5: Add Missed-Reply Theme Classification

**Files:**
- Create: `src/lib/client-message-theme-classifier.ts`
- Create: `src/lib/client-message-theme-classifier.test.ts`
- Modify later: `src/client-message-inbox.tsx`

- [ ] **Step 1: Create theme classifier tests**

Create `src/lib/client-message-theme-classifier.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyClientMessageTheme } from './client-message-theme-classifier';

test('classifies reschedule replies', () => {
  assert.equal(classifyClientMessageTheme('Can we reschedule?'), 'reschedule');
  assert.equal(classifyClientMessageTheme('Need to move the meeting'), 'reschedule');
});

test('classifies later today availability', () => {
  assert.equal(classifyClientMessageTheme('I am available later today'), 'available_later_today');
});

test('classifies tomorrow availability', () => {
  assert.equal(classifyClientMessageTheme('Tomorrow works better'), 'available_tomorrow');
});

test('classifies follow up scheduling replies', () => {
  assert.equal(classifyClientMessageTheme('Can you call me after work?'), 'schedule_follow_up');
});

test('returns null for non-action replies', () => {
  assert.equal(classifyClientMessageTheme('Thanks'), null);
});
```

- [ ] **Step 2: Create classifier**

Create `src/lib/client-message-theme-classifier.ts`:

```ts
export type ClientMessageTheme =
  | 'reschedule'
  | 'available_later_today'
  | 'available_tomorrow'
  | 'schedule_follow_up';

export function classifyClientMessageTheme(text?: string | null): ClientMessageTheme | null {
  const normalized = String(text || '').toLowerCase();
  if (!normalized.trim()) return null;
  if (/\b(reschedule|re-schedule|move\s+(the\s+)?meeting|different\s+time)\b/.test(normalized)) {
    return 'reschedule';
  }
  if (/\b(later\s+today|available\s+today|free\s+today)\b/.test(normalized)) {
    return 'available_later_today';
  }
  if (/\b(tomorrow|tmrw)\b/.test(normalized)) {
    return 'available_tomorrow';
  }
  if (/\b(call\s+me|call\s+back|after\s+work|follow\s+up|talk\s+later)\b/.test(normalized)) {
    return 'schedule_follow_up';
  }
  return null;
}
```

- [ ] **Step 3: Verify**

Run:

```bash
node --import tsx --test src/lib/client-message-theme-classifier.test.ts
```

Expected: tests pass.

---

### Task 6: Build Review Follow Ups From Themes

**Files:**
- Modify: `src/client-message-inbox.tsx`
- Modify: `src/lib/client-message-sandbox.ts`
- Modify: `src/lib/client-message-theme-classifier.ts`

- [ ] **Step 1: Keep this behind an action first**

Add an action named:

```tsx
<Action title="Review Follow Ups" />
```

It should open a view of message threads with detected themes. Do not auto-create reminders from themes in the first pass.

- [ ] **Step 2: Theme rows should show only actionable categories**

Start with:

```ts
['reschedule', 'available_later_today', 'available_tomorrow', 'schedule_follow_up']
```

- [ ] **Step 3: Human confirms action**

Each row should offer manual actions:

```tsx
<Action title="Create Follow-Up" />
<Action title="Open Thread" />
<Action title="Open Scout Prep Details" />
```

No destructive or CRM-changing action should happen automatically from a classifier result.

---

### Task 7: Optional Last-Pass Message Markdown Route

**Files:**
- Modify: `src/client-message-inbox.tsx`
- Modify: `src/lib/client-message-sandbox.ts`

Only do this after Tasks 1-6 are reliable. The first hardening pass does not need multiple markdown variants. If a markdown route still helps after the two-way system works, add one route only.

- [ ] **Step 1: Add one pure markdown builder**

```ts
function buildClientMessageMarkdown(messages: ClientThreadMessage[], chat: ClientInboxChat): string {
  const contacts = (chat.clientMatch.associatedClients || [])
    .map((contact) => `- ${contact.relationshipLabel}: ${contact.name || contact.normalizedPhoneNumber}`)
    .join('\n');
  const transcript = [...messages]
    .reverse()
    .map((message) => {
      const sender = message.is_from_me ? 'Me' : message.senderName;
      const body = String(message.body || '').trim() || '[empty message]';
      return [`### ${sender}`, '', `> ${body.replace(/\n/g, '\n> ')}`, '', `_${format(new Date(message.date), 'PPp')}_`].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    `# ${chat.clientMatch.athleteName || chat.displayName}`,
    '',
    '## Contacts',
    contacts || '- No resolved contacts',
    '',
    '## Messages',
    transcript || 'No messages loaded.',
  ].join('\n');
}
```

- [ ] **Step 2: Add one action**

```tsx
<Action
  title="View Message Markdown"
  onAction={() => push(<ClientMessageMarkdownView chat={chat} />)}
/>
```

- [ ] **Step 3: Keep it optional**

Do not make this the default route unless the normal Client Messages and Scout Prep actions are already reliable.

---

## Self-Review

- Spec coverage: This plan covers contact-cache-vs-contacts, reliable group/student-athlete/parent tags, Scout Prep to Messages, Messages to Scout Prep, missed-reply theme review, and one optional last-pass markdown route.
- Duplicate-phone coverage: This plan explicitly reuses the voicemail/contact-selection rule where student athlete wins over parent when the same phone is shared.
- Multi-number coverage: This plan adds a numbered 1-3 contact chooser using the Scout Openings shortcut pattern.
- Scope control: The first pass is identity/routing reliability only. Theme review is later. Message markdown is last, optional, and limited to one route.
- Source-of-truth rule: `athlete_contact_cache` gates Client Messages. Confirmation cache and macOS Contacts do not.
- No auto-actions: Reply themes produce review rows first, not automatic lifecycle or reminder writes.
