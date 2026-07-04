# Pending Clients Confirmation Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Pending Clients so it reviews only Jerami-owned Set Meetings from the Supabase confirmation cache, then checks the matching athlete eventlist and sales stage.

**Architecture:** Meeting Set submit remains the only writer for mobile confirmation text. Supabase storage is renamed conceptually from "reminders" to "confirmation cache" through code aliases first, while the physical table can remain `reminders` until a separate migration window. Pending Clients stops scanning all booked meetings and instead reads ready confirmation-cache rows, enriches each with athlete eventlist and sales-stage evidence, and renders only actionable rows.

**Tech Stack:** Raycast React/TypeScript, Next.js App Router on Vercel, Supabase PostgREST, node:test, existing FastAPI-backed Laravel adapter functions.

---

## File Structure

- Modify `src/domain/set-meeting-reminder-cache.ts`
  - Keep the existing row shape but add `meeting_duration_minutes` and `meeting_ends_at` to the payload rows.
  - Export this as confirmation-cache domain data without changing the physical table yet.

- Modify `src/lib/set-meeting-reminder-cache-sync.ts`
  - Pass Meeting Set duration from Scout Prep into the Supabase cache rows.
  - Keep writing source `set_meetings_confirmation`.

- Modify `src/scout-prep.tsx`
  - Include `meetingLength` when calling `syncMeetingSetReminderCacheFromScoutPrep`.
  - Do not change Laravel Meeting Set submit behavior.

- Modify `src/domain/pending-client-watchlist.ts`
  - Add pure helpers for selecting ready Set Meeting cache groups.
  - Add pure helpers for `(FU)` / `(FU)*2` review-event title matching.
  - Keep note signal matching separate from row loading.

- Modify `src/lib/pending-client-watchlist.ts`
  - Replace the broad `fetchHeadScoutBookedMeetingsWindow()` scan with a Supabase confirmation-cache read.
  - For each ready Set Meeting, call `fetchAthleteBookedMeetings()` for the corresponding athlete only.
  - Call `fetchCuratedSalesStageOptions()` and read the selected sales stage.
  - Upsert/read `pending_client_watchlist` exactly as before.

- Modify `src/head-scout-schedules.tsx`
  - Keep the `Pending Clients` action location unchanged.
  - Its load path becomes fast because it starts from cached Set Meetings only.

- Modify `src/domain/supabase-persistence.ts`
  - Add `upsertSetMeetingConfirmationCacheRows()` as a named wrapper around the existing `reminders` table.
  - Keep `upsertReminders()` for unrelated legacy code.

- Modify `apps/prospect-web/app/api/set-meetings/route.ts`
  - Rename response source from `supabase_reminders_cache` to `supabase_confirmation_cache`.
  - Keep reading the existing table for now.

- Modify `apps/prospect-web/public/prospect-mobile/app.js`
  - Remove Reminder-tab wording if choosing the delete path.
  - Keep Set and Schedules tabs.

- Modify `apps/prospect-web/app/prospect-mobile/page.tsx`
  - Remove the Reminder tab link if choosing the delete path.

- Modify tests:
  - `src/domain/pending-client-watchlist.test.ts`
  - `src/lib/set-meeting-reminder-cache-sync.test.ts`
  - `src/domain/set-meeting-reminder-cache.test.ts`
  - `apps/prospect-web/tests/routes.test.ts`
  - `apps/prospect-web/tests/static-guards.test.ts`
  - `supabase/tests/reminders-set-meeting-cache-columns.test.mjs`

---

### Task 1: Add Meeting Duration To Confirmation Cache Rows

**Files:**
- Modify: `src/domain/set-meeting-reminder-cache.ts`
- Modify: `src/lib/set-meeting-reminder-cache-sync.ts`
- Modify: `src/scout-prep.tsx`
- Test: `src/domain/set-meeting-reminder-cache.test.ts`
- Test: `src/lib/set-meeting-reminder-cache-sync.test.ts`
- Test: `supabase/tests/reminders-set-meeting-cache-columns.test.mjs`
- Modify: `supabase/migrations/20260510090000_expand_reminders_set_meeting_cache.sql`

- [ ] **Step 1: Write failing domain test for duration and end time**

Append this test to `src/domain/set-meeting-reminder-cache.test.ts`:

```ts
test('set meeting confirmation cache stores duration and computed end time', () => {
  const rows = buildSetMeetingReminderCacheRows({
    appointmentId: 'event-1',
    athleteId: '1489000',
    athleteMainId: '951000',
    athleteName: 'Avery Jones',
    recipientName: 'Tiffany Jones',
    recipientPhone: '615-555-1212',
    headScoutName: 'Head Scout D',
    meetingStartsAt: '2026-05-15T19:00:00-04:00',
    meetingTimezone: 'America/New_York',
    meetingDurationMinutes: 60,
    confirmation1Message: 'confirmation one',
    confirmation2Message: 'confirmation two',
    adminUrl: 'https://legacy-dashboard.example.com/admin/athletes?contactid=1489000&athlete_main_id=951000',
    taskUrl: 'https://legacy-dashboard.example.com/admin/tasks/1',
    generatedAt: '2026-05-14T18:00:00.000Z',
    source: 'set_meetings_confirmation',
  });

  assert.equal(rows[0].meeting_duration_minutes, 60);
  assert.equal(rows[0].meeting_ends_at, '2026-05-15T20:00:00.000Z');
  assert.equal(rows[0].payload_json.meeting_duration_minutes, 60);
  assert.equal(rows[0].payload_json.meeting_ends_at, '2026-05-15T20:00:00.000Z');
  assert.equal(rows[1].meeting_duration_minutes, 60);
  assert.equal(rows[1].meeting_ends_at, '2026-05-15T20:00:00.000Z');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test src/domain/set-meeting-reminder-cache.test.ts
```

Expected: FAIL because `meetingDurationMinutes`, `meeting_duration_minutes`, and `meeting_ends_at` do not exist yet.

- [ ] **Step 3: Implement duration fields in cache row builder**

In `src/domain/set-meeting-reminder-cache.ts`, update the input type:

```ts
export type BuildSetMeetingReminderCacheRowsInput = {
  appointmentId: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  recipientName: string;
  recipientPhone: string;
  headScoutName: string;
  meetingStartsAt: string | null;
  meetingTimezone: string;
  meetingDurationMinutes?: number | null;
  confirmation1Message: string;
  confirmation2Message: string;
  adminUrl: string;
  taskUrl: string;
  generatedAt: string;
  source: string;
};
```

Add these helpers near the top of the file:

```ts
function normalizeDurationMinutes(value?: number | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 60;
}

function computeMeetingEndsAt(startsAt?: string | null, durationMinutes?: number | null): string | null {
  const start = new Date(String(startsAt || '').trim());
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + normalizeDurationMinutes(durationMinutes) * 60_000).toISOString();
}
```

Inside `buildRow`, before `return`, add:

```ts
  const meetingDurationMinutes = normalizeDurationMinutes(input.meetingDurationMinutes);
  const meetingEndsAt = computeMeetingEndsAt(input.meetingStartsAt, meetingDurationMinutes);
```

Then add these fields to the returned row:

```ts
    meeting_duration_minutes: meetingDurationMinutes,
    meeting_ends_at: meetingEndsAt,
```

And add these fields inside `payload_json`:

```ts
      meeting_duration_minutes: meetingDurationMinutes,
      meeting_ends_at: meetingEndsAt,
```

- [ ] **Step 4: Add sync test for Scout Prep meeting length**

In `src/lib/set-meeting-reminder-cache-sync.test.ts`, inside the existing `buildMeetingSetReminderCacheRowsFromScoutPrep` test, add `meetingLength: '01:30'` to `meetingSet`:

```ts
    meetingSet: {
      openEventId: 'event-1',
      startsAt: '2026-05-15T19:00:00-04:00',
      meetingTimezone: 'EST',
      meetingLength: '01:30',
      headScout: 'Head Scout D',
    },
```

Then add assertions:

```ts
  assert.equal(rows[0].meeting_duration_minutes, 90);
  assert.equal(rows[0].meeting_ends_at, '2026-05-16T00:30:00.000Z');
```

- [ ] **Step 5: Implement meetingLength parsing**

In `src/lib/set-meeting-reminder-cache-sync.ts`, update `MeetingSetReminderCacheInput.meetingSet`:

```ts
    meetingLength?: string | null;
```

Add helper:

```ts
function parseMeetingLengthMinutes(value?: string | null): number {
  const trimmed = clean(value);
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 60;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const total = hours * 60 + minutes;
  return Number.isFinite(total) && total > 0 ? total : 60;
}
```

Pass this into `buildSetMeetingReminderCacheRows`:

```ts
    meetingDurationMinutes: parseMeetingLengthMinutes(args.meetingSet.meetingLength),
```

In `src/scout-prep.tsx`, pass the meeting length to the sync call:

```ts
              meetingLength: meetingSetInput.meetingLength,
```

- [ ] **Step 6: Add Supabase migration columns**

In `supabase/migrations/20260510090000_expand_reminders_set_meeting_cache.sql`, add:

```sql
  add column if not exists meeting_duration_minutes integer,
  add column if not exists meeting_ends_at timestamptz,
```

In `supabase/tests/reminders-set-meeting-cache-columns.test.mjs`, add assertions:

```js
  assert.match(sql, /add column if not exists meeting_duration_minutes integer/i);
  assert.match(sql, /add column if not exists meeting_ends_at timestamptz/i);
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx tsx --test src/domain/set-meeting-reminder-cache.test.ts src/lib/set-meeting-reminder-cache-sync.test.ts
node --test supabase/tests/reminders-set-meeting-cache-columns.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/set-meeting-reminder-cache.ts src/domain/set-meeting-reminder-cache.test.ts src/lib/set-meeting-reminder-cache-sync.ts src/lib/set-meeting-reminder-cache-sync.test.ts src/scout-prep.tsx supabase/migrations/20260510090000_expand_reminders_set_meeting_cache.sql supabase/tests/reminders-set-meeting-cache-columns.test.mjs
git commit -m "feat: store set meeting confirmation cache end times"
```

---

### Task 2: Make Pending Clients Start From Confirmation Cache Only

**Files:**
- Modify: `src/domain/pending-client-watchlist.ts`
- Modify: `src/domain/pending-client-watchlist.test.ts`
- Modify: `src/lib/pending-client-watchlist.ts`

- [ ] **Step 1: Write failing domain tests for Set Meeting source selection**

Append to `src/domain/pending-client-watchlist.test.ts`:

```ts
import {
  filterReadySetMeetingConfirmationGroups,
  isPendingClientReviewEventTitle,
} from './pending-client-watchlist';

test('pending client source keeps only ready Jerami-owned set meeting cache groups', () => {
  const now = new Date('2026-05-15T21:05:00.000Z');
  const rows = [
    {
      appointment_id: 'past-jerami',
      athlete_id: '1489000',
      athlete_main_id: '951000',
      athlete_name: 'Avery Jones',
      head_scout_name: 'Head Scout D',
      meeting_starts_at: '2026-05-15T19:00:00.000Z',
      meeting_ends_at: '2026-05-15T20:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'operator_primary' },
    },
    {
      appointment_id: 'future-jerami',
      athlete_id: '1489001',
      athlete_main_id: '951001',
      athlete_name: 'Future Jones',
      head_scout_name: 'Head Scout D',
      meeting_starts_at: '2026-05-15T21:00:00.000Z',
      meeting_ends_at: '2026-05-15T22:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'operator_primary' },
    },
    {
      appointment_id: 'past-other',
      athlete_id: '1489002',
      athlete_main_id: '951002',
      athlete_name: 'Other Jones',
      head_scout_name: 'Head Scout D',
      meeting_starts_at: '2026-05-15T19:00:00.000Z',
      meeting_ends_at: '2026-05-15T20:00:00.000Z',
      source: 'set_meetings_confirmation',
      kind: 'confirmation_1',
      status: 'cached',
      message_body: 'one',
      payload_json: { active_operator_key: 'not_jerami' },
    },
  ];

  assert.deepEqual(
    filterReadySetMeetingConfirmationGroups(rows, {
      now,
      activeOperatorKey: 'operator_primary',
    }).map((row) => row.appointmentId),
    ['past-jerami'],
  );
});

test('pending client review title accepts only FU prefixes', () => {
  assert.equal(isPendingClientReviewEventTitle('(FU) Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('(FU)*2 Avery Jones Football 2027 TN'), true);
  assert.equal(isPendingClientReviewEventTitle('Follow Up - Avery Jones Football 2027 TN'), false);
  assert.equal(isPendingClientReviewEventTitle('Booked Meeting Avery Jones'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement cache row filtering helpers**

In `src/domain/pending-client-watchlist.ts`, add:

```ts
export type SetMeetingConfirmationCacheRowInput = {
  appointment_id?: string | null;
  athlete_id?: string | null;
  athlete_main_id?: string | null;
  athlete_name?: string | null;
  head_scout_name?: string | null;
  meeting_starts_at?: string | null;
  meeting_ends_at?: string | null;
  meeting_duration_minutes?: number | null;
  source?: string | null;
  kind?: string | null;
  status?: string | null;
  message_body?: string | null;
  payload_json?: Record<string, unknown> | null;
};

export type ReadySetMeetingConfirmationGroup = {
  appointmentId: string;
  athleteId: string;
  athleteMainId: string;
  athleteName: string;
  headScoutName: string | null;
  meetingStartsAt: string;
  meetingEndsAt: string;
  rows: SetMeetingConfirmationCacheRowInput[];
};

function parseDateMs(value?: string | null): number {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function getPayloadOperatorKey(row: SetMeetingConfirmationCacheRowInput): string {
  return String(row.payload_json?.active_operator_key || row.payload_json?.detected_by_operator_key || '').trim();
}

export function isPendingClientReviewEventTitle(title?: string | null): boolean {
  return /^\(FU\)(?:\*\d+)?\s+/i.test(normalizeText(title));
}

export function filterReadySetMeetingConfirmationGroups(
  rows: SetMeetingConfirmationCacheRowInput[],
  args: { now?: Date; activeOperatorKey: OwnerKey | string },
): ReadySetMeetingConfirmationGroup[] {
  const nowMs = (args.now || new Date()).getTime();
  const grouped = new Map<string, SetMeetingConfirmationCacheRowInput[]>();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (normalizeText(row.source) !== 'set_meetings_confirmation') continue;
    if (normalizeText(row.status) !== 'cached') continue;
    if (!['confirmation_1', 'confirmation_2'].includes(normalizeText(row.kind))) continue;
    if (getPayloadOperatorKey(row) && getPayloadOperatorKey(row) !== args.activeOperatorKey) continue;
    const appointmentId = normalizeText(row.appointment_id);
    if (!appointmentId) continue;
    grouped.set(appointmentId, [...(grouped.get(appointmentId) || []), row]);
  }

  return Array.from(grouped.entries()).flatMap(([appointmentId, groupRows]) => {
    const base = groupRows[0];
    const athleteId = normalizeText(base.athlete_id);
    const athleteMainId = normalizeText(base.athlete_main_id);
    const meetingStartsAt = normalizeText(base.meeting_starts_at);
    const meetingEndsAt =
      normalizeText(base.meeting_ends_at) ||
      new Date(parseDateMs(meetingStartsAt) + 60 * 60_000).toISOString();
    if (!athleteId || !athleteMainId || !meetingStartsAt || !meetingEndsAt) return [];
    if (parseDateMs(meetingEndsAt) > nowMs) return [];
    return [{
      appointmentId,
      athleteId,
      athleteMainId,
      athleteName: normalizeText(base.athlete_name),
      headScoutName: normalizeText(base.head_scout_name) || null,
      meetingStartsAt,
      meetingEndsAt,
      rows: groupRows,
    }];
  });
}
```

- [ ] **Step 4: Update review-event selection to use FU prefixes**

In `selectLatestPendingClientReviewEvent`, replace:

```ts
          /^Follow Up -/i.test(title) &&
```

with:

```ts
          isPendingClientReviewEventTitle(title) &&
```

- [ ] **Step 5: Run domain tests**

Run:

```bash
npx tsx --test src/domain/pending-client-watchlist.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/pending-client-watchlist.ts src/domain/pending-client-watchlist.test.ts
git commit -m "feat: scope pending clients to ready set meetings"
```

---

### Task 3: Replace Broad Pending Client Scan With Cached Set Meeting Read

**Files:**
- Modify: `src/lib/pending-client-watchlist.ts`
- Modify: `src/lib/sales-stage.ts` only if the selected-stage helper is not exported cleanly
- Test: existing domain tests plus Raycast typecheck/build

- [ ] **Step 1: Add imports**

In `src/lib/pending-client-watchlist.ts`, replace unused broad-scan imports:

```ts
  buildPendingClientScanWindow,
  filterPendingClientCandidateEvents,
```

with:

```ts
  filterReadySetMeetingConfirmationGroups,
```

Keep `selectLatestPendingClientReviewEvent`, `findPendingClientSignals`, and `hasPendingClientWatchNote`.

Add:

```ts
import { fetchCuratedSalesStageOptions } from './sales-stage';
import { getActiveOperator } from '../domain/owners';
```

- [ ] **Step 2: Add confirmation-cache row type and reader**

Add this near existing types in `src/lib/pending-client-watchlist.ts`:

```ts
type SetMeetingConfirmationCacheRow = {
  appointment_id: string | null;
  athlete_id: string | null;
  athlete_main_id: string | null;
  athlete_name: string | null;
  head_scout_name: string | null;
  meeting_starts_at: string | null;
  meeting_ends_at: string | null;
  meeting_duration_minutes: number | null;
  source: string | null;
  kind: string | null;
  status: string | null;
  message_body: string | null;
  payload_json: Record<string, unknown> | null;
};

async function readSetMeetingConfirmationCacheRows(config: SupabasePersistenceConfig, now: Date) {
  const since = new Date(now);
  since.setDate(since.getDate() - PENDING_CLIENT_WATCH_WINDOW_DAYS);
  return readRows<SetMeetingConfirmationCacheRow>(
    config,
    'reminders',
    [
      'select=appointment_id,athlete_id,athlete_main_id,athlete_name,head_scout_name,meeting_starts_at,meeting_ends_at,meeting_duration_minutes,source,kind,status,message_body,payload_json',
      'status=eq.cached',
      'source=eq.set_meetings_confirmation',
      'kind=in.(confirmation_1,confirmation_2)',
      `meeting_starts_at=gte.${encodeURIComponent(since.toISOString())}`,
      `meeting_starts_at=lte.${encodeURIComponent(now.toISOString())}`,
      'order=meeting_starts_at.desc',
    ].join('&'),
  );
}
```

- [ ] **Step 3: Add selected sales stage helper**

Add:

```ts
async function fetchSelectedSalesStage(athleteId: string): Promise<string | null> {
  try {
    const options = await fetchCuratedSalesStageOptions(athleteId);
    return options.find((option) => option.selected)?.label || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Replace `loadPendingClientWatchlist` live scan**

Replace this block:

```ts
  const now = new Date();
  const window = buildPendingClientScanWindow(now);
  const booked = await fetchHeadScoutBookedMeetingsWindow(window);
  const candidates = filterPendingClientCandidateEvents(booked.events || [], now);
  const scan = await buildConfirmedRows(candidates);
```

with:

```ts
  const now = new Date();
  const cacheRows = await readSetMeetingConfirmationCacheRows(config, now);
  const activeOperator = getActiveOperator();
  const readyMeetings = filterReadySetMeetingConfirmationGroups(cacheRows, {
    now,
    activeOperatorKey: activeOperator.operatorKey,
  });
  const scan = await buildConfirmedRowsFromReadySetMeetings(readyMeetings);
```

- [ ] **Step 5: Replace `buildConfirmedRows` with Set Meeting version**

Replace the old `buildConfirmedRows(events: BookedMeetingEvent[])` implementation with:

```ts
async function buildConfirmedRowsFromReadySetMeetings(
  meetings: ReadySetMeetingConfirmationGroup[],
): Promise<{
  rows: PendingClientWatchlistRow[];
  scannedCount: number;
  confirmedCount: number;
  aiUnavailableCount: number;
}> {
  const rows: PendingClientWatchlistRow[] = [];
  let aiUnavailableCount = 0;

  for (const meeting of meetings) {
    const athleteMeetings = await fetchAthleteBookedMeetings({
      athleteId: meeting.athleteId,
      athleteMainId: meeting.athleteMainId,
    }).catch(() => ({ events: [] }));

    const reviewEvent = selectLatestPendingClientReviewEvent(
      {
        event_id: meeting.appointmentId,
        title: meeting.athleteName,
        assigned_owner: meeting.headScoutName,
        start: meeting.meetingStartsAt,
        end: meeting.meetingEndsAt,
      },
      athleteMeetings.events || [],
    );
    if (!reviewEvent) continue;

    const salesStage = await fetchSelectedSalesStage(meeting.athleteId);
    const description = reviewEvent.description || '';
    const matchedSignals = findPendingClientSignals(description);
    if (!hasPendingClientWatchNote(description)) continue;

    let aiVerdict: 'pending_client' | null = 'pending_client';
    if (matchedSignals.length) {
      aiVerdict = await confirmPendingClientWithRayAI({
        title: reviewEvent.title || meeting.athleteName,
        description: [`Sales Stage: ${salesStage || 'Unknown'}`, description].join('\n'),
        matchedSignals,
      });
      if (!aiVerdict) {
        aiUnavailableCount += 1;
        continue;
      }
    }

    rows.push(
      buildPendingClientWatchlistRow({
        event: {
          event_id: reviewEvent.event_id || meeting.appointmentId,
          title: reviewEvent.title || meeting.athleteName,
          assigned_owner: reviewEvent.assigned_owner || meeting.headScoutName,
          start: reviewEvent.start || meeting.meetingStartsAt,
          end: reviewEvent.end || null,
          date_time_label: reviewEvent.date_time_label,
        },
        description: [`Sales Stage: ${salesStage || 'Unknown'}`, description].join('\n\n'),
        matchedSignals,
        aiVerdict,
        athleteId: meeting.athleteId,
        athleteMainId: meeting.athleteMainId,
        athleteName: meeting.athleteName,
      }),
    );
  }

  return {
    rows,
    scannedCount: meetings.length,
    confirmedCount: rows.length,
    aiUnavailableCount,
  };
}
```

- [ ] **Step 6: Remove unused broad scan functions**

In `src/lib/pending-client-watchlist.ts`, remove:

```ts
function getEventDate(event: BookedMeetingEvent): string {
  return String(event.start || '').split('T')[0] || '';
}

async function resolvePendingClientAthlete(title: string): Promise<ProspectResult | null> {
  ...
}
```

Also remove imports for:

```ts
buildPendingClientScanWindow
filterPendingClientCandidateEvents
fetchHeadScoutBookedMeetingsWindow
runProspectRawSearch
ensureProspectDetails
ProspectResult
BookedMeetingEvent
```

- [ ] **Step 7: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS. If it fails on an import/type name, fix only the named compile error.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pending-client-watchlist.ts
git commit -m "fix: load pending clients from set meeting cache"
```

---

### Task 4: Rename Vercel Set Tab Source To Confirmation Cache

**Files:**
- Modify: `src/domain/supabase-persistence.ts`
- Modify: `src/lib/set-meeting-reminder-cache-sync.ts`
- Modify: `src/head-scout-schedules.tsx`
- Modify: `apps/prospect-web/app/api/set-meetings/route.ts`
- Test: `apps/prospect-web/tests/routes.test.ts`
- Test: `apps/prospect-web/tests/static-guards.test.ts`

- [ ] **Step 1: Add named persistence wrapper**

In `src/domain/supabase-persistence.ts`, add below `upsertReminders`:

```ts
export function upsertSetMeetingConfirmationCacheRows(config: SupabasePersistenceConfig, rows: unknown[]) {
  return writeRows(config, 'reminders', rows, 'dedupe_key');
}
```

- [ ] **Step 2: Use named wrapper at write sites**

In `src/lib/set-meeting-reminder-cache-sync.ts`, replace:

```ts
import { upsertReminders, type SupabasePersistenceConfig } from '../domain/supabase-persistence';
```

with:

```ts
import {
  upsertSetMeetingConfirmationCacheRows,
  type SupabasePersistenceConfig,
} from '../domain/supabase-persistence';
```

Replace:

```ts
  await upsertReminders(config, rows);
```

with:

```ts
  await upsertSetMeetingConfirmationCacheRows(config, rows);
```

In `src/head-scout-schedules.tsx`, replace the `upsertReminders` import and call the same way.

- [ ] **Step 3: Update Vercel route source naming test**

In `apps/prospect-web/tests/routes.test.ts`, rename the test:

```ts
test('/api/set-meetings reads Supabase confirmation cache and groups confirmations', async () => {
```

Replace:

```ts
  assert.equal(payload.source, 'supabase_reminders_cache');
```

with:

```ts
  assert.equal(payload.source, 'supabase_confirmation_cache');
```

Keep this assertion because the physical table is still `reminders`:

```ts
  assert.equal(calls[0].includes('/rest/v1/reminders?'), true);
```

- [ ] **Step 4: Update route payload source**

In `apps/prospect-web/app/api/set-meetings/route.ts`, replace both occurrences of:

```ts
supabase_reminders_cache
```

with:

```ts
supabase_confirmation_cache
```

- [ ] **Step 5: Update static guard wording**

In `apps/prospect-web/tests/static-guards.test.ts`, rename:

```ts
test('prospect mobile set meetings uses cached confirmation messages', () => {
```

to:

```ts
test('prospect mobile set meetings uses confirmation cache messages', () => {
```

- [ ] **Step 6: Run Vercel app tests**

Run:

```bash
cd apps/prospect-web
npm run test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/supabase-persistence.ts src/lib/set-meeting-reminder-cache-sync.ts src/head-scout-schedules.tsx apps/prospect-web/app/api/set-meetings/route.ts apps/prospect-web/tests/routes.test.ts apps/prospect-web/tests/static-guards.test.ts
git commit -m "chore: name set meeting storage confirmation cache"
```

---

### Task 5: Remove Or Convert Mobile Reminder Tab

**Decision:** Default implementation is delete the Reminder tab now. A Prospect Search tab is useful, but it is a separate product surface and should not block fixing Set Meetings.

**Files:**
- Modify: `apps/prospect-web/app/prospect-mobile/page.tsx`
- Modify: `apps/prospect-web/public/prospect-mobile/app.js`
- Modify: `apps/prospect-web/tests/static-guards.test.ts`

- [ ] **Step 1: Write failing guard that Reminder route is gone**

Replace the existing `prospect mobile reminder tab looks up contacts directly in Supabase` test in `apps/prospect-web/tests/static-guards.test.ts` with:

```ts
test('prospect mobile exposes only set meetings and scout schedules tabs', () => {
  const appText = readFileSync(join(appRoot, 'public/prospect-mobile/app.js'), 'utf8');
  const pageText = readFileSync(join(appRoot, 'app/prospect-mobile/page.tsx'), 'utf8');
  assert.match(pageText, /data-route="\/set-meetings"/);
  assert.match(pageText, /data-route="\/scout-schedules"/);
  assert.doesNotMatch(pageText, /data-route="\/contact-reminder"/);
  assert.doesNotMatch(appText, /'\/contact-reminder'/);
  assert.doesNotMatch(appText, /renderContactReminder/);
  assert.doesNotMatch(appText, /lookup_athlete_contact_cache/);
  assert.doesNotMatch(appText, /Reminder Intake/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/prospect-web
npm run test -- tests/static-guards.test.ts
```

Expected: FAIL because the Reminder route still exists.

- [ ] **Step 3: Remove Reminder nav link**

In `apps/prospect-web/app/prospect-mobile/page.tsx`, delete this link block:

```tsx
          <a href="/prospect-mobile/contact-reminder" data-route="/contact-reminder">
            Reminder
          </a>
```

Also remove the inline Supabase config script if it is only used by the Reminder tab:

```tsx
        id="prospect-mobile-supabase-config"
```

Remove related `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` browser config from this page if no remaining browser code uses it.

- [ ] **Step 4: Remove Reminder route and functions from mobile JS**

In `apps/prospect-web/public/prospect-mobile/app.js`, delete this route entry:

```js
  '/contact-reminder': {
    title: 'Reminder Intake',
    render: renderContactReminder,
    usesWeek: false,
  },
```

Delete these functions if no longer referenced:

```js
async function renderContactReminder() { ... }
async function lookupAthleteContactByPhone(phone) { ... }
function renderReminderLookupMatch(match) { ... }
function buildReminderLookupDraft(match) { ... }
```

Also remove direct browser Supabase lookup helpers tied only to that tab.

- [ ] **Step 5: Run app tests**

Run:

```bash
cd apps/prospect-web
npm run test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/prospect-web/app/prospect-mobile/page.tsx apps/prospect-web/public/prospect-mobile/app.js apps/prospect-web/tests/static-guards.test.ts
git commit -m "chore: remove mobile reminder tab"
```

---

### Task 6: Local And Live Verification

**Files:**
- No code changes expected unless a verification failure exposes a bug.

- [ ] **Step 1: Run Raycast and domain focused tests**

Run:

```bash
npx tsx --test src/domain/pending-client-watchlist.test.ts src/domain/set-meeting-reminder-cache.test.ts src/lib/set-meeting-reminder-cache-sync.test.ts
npm run build
```

Expected: all tests PASS and Raycast build completes.

- [ ] **Step 2: Run Prospect Web tests**

Run:

```bash
cd apps/prospect-web
npm run test
```

Expected: PASS.

- [ ] **Step 3: Start local Prospect Web and smoke Set tab**

Run:

```bash
cd apps/prospect-web
npm run dev
```

Open:

```text
http://localhost:3000/prospect-mobile/set-meetings
```

Expected: page loads with Set and Schedules only. No Reminder tab appears.

- [ ] **Step 4: Smoke local API**

Run:

```bash
curl -sS 'http://localhost:3000/api/set-meetings?week=this' | jq '{success, source, backend_required, count}'
```

Expected:

```json
{
  "success": true,
  "source": "supabase_confirmation_cache",
  "backend_required": false,
  "count": 0
}
```

`count` may be greater than `0` when Supabase contains current-week cached meetings.

- [ ] **Step 5: Deploy production Vercel**

Run:

```bash
cd apps/prospect-web
npx vercel deploy --prod --yes
```

Expected: deploy succeeds and returns a production URL.

- [ ] **Step 6: Smoke production API**

Run:

```bash
curl -sS 'https://prospect-web.vercel.app/api/set-meetings?week=this' | jq '{success, source, backend_required, count}'
```

Expected:

```json
{
  "success": true,
  "source": "supabase_confirmation_cache",
  "backend_required": false,
  "count": 0
}
```

`count` may be greater than `0` when Supabase contains current-week cached meetings.

- [ ] **Step 7: Commit verification-only fixes if needed**

Only run this if Step 1-6 required code changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize confirmation cache verification"
```

---

## Self-Review

- Spec coverage:
  - Pending Clients no longer scans all booked meetings: Task 2 and Task 3.
  - Pending Clients starts from Set Meetings only: Task 2 and Task 3.
  - Meeting duration must pass before review: Task 1 and Task 2.
  - Review uses corresponding Student Athlete eventlist: Task 3.
  - Review checks `(FU)` or `(FU)*2`: Task 2 and Task 3.
  - Review checks sales stage: Task 3.
  - Vercel Set tab reads Supabase only: Task 4 and Task 6.
  - Rename concept from reminders to confirmation cache: Task 4.
  - Remove confusing Reminder tab: Task 5.

- Placeholder scan:
  - No `TBD`, `TODO`, or incomplete task steps are present.
  - Code steps include concrete snippets and exact files.

- Type consistency:
  - `meetingDurationMinutes` is the TypeScript input field.
  - `meeting_duration_minutes` and `meeting_ends_at` are Supabase row fields.
  - `filterReadySetMeetingConfirmationGroups` returns `ReadySetMeetingConfirmationGroup`.
  - Vercel response source is `supabase_confirmation_cache`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-pending-clients-confirmation-cache.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
