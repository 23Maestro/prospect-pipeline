# Parent Response n8n Reschedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parent response intake and operator approval workflow for reschedule/no-show recovery using Prospect Web, Supabase, Resend, and local npm-based n8n.

**Architecture:** Vercel hosts the parent-facing page and protected API routes. Supabase stores signed requests and parent responses. Parent links are created only by a human-triggered Prospect Pipeline action after sales stage already indicates reschedule/no-show recovery. n8n runs locally from npm/nvm as a downstream orchestration layer for submitted responses; it does not fetch slots, decide readiness, own business meaning, or build mutation payloads.

**Tech Stack:** Next.js Prospect Web, Supabase Postgres, Resend API, local `n8n@2.25.7` installed by npm, existing Prospect Pipeline FastAPI/Laravel adapters.

---

## Hard Constraints

- No Docker for n8n.
- Parent page records intent only.
- Sales stage is the driver; `Meeting Result - Res. Pending` or an approved recovery state must exist before creating a parent response request.
- Fresh slots are generated only from a human-triggered action, never by n8n or cron.
- Approval mutates only through the existing Raycast/Prospect Pipeline reschedule path.
- n8n cannot assemble the Meeting Set reschedule payload.
- n8n cannot write lifecycle, appointment truth, or CRM stage directly.
- Browser code cannot receive service role keys, Resend keys, token secrets, or approval secrets.

## Correct Trigger Model

```text
Raycast / Prospect Pipeline post-meeting update
-> set Meeting Result - Res. Pending
-> write reschedule reason note
-> cron/sync observes that state

Parent later says they are ready / not ready
-> operator presses Send Reschedule Link
-> action refreshes current state
-> action fetches fresh current openings
-> action creates Supabase parent_response_request
-> action sends parent link

Parent submits response
-> Supabase stores selected_slot / none_work / ready_later
-> n8n sees submitted response
-> Resend operator notification
-> selected slot waits for human approval
```

n8n is downstream of submitted responses. It is not the trigger for slot generation.

## Files

- Create: `supabase/migrations/20260612150000_parent_response_requests.sql`
- Create: `supabase/tests/parent-response-requests-contract.test.mjs`
- Create: `src/domain/parent-response-request.ts`
- Create: `src/domain/parent-response-request.test.ts`
- Create: `apps/prospect-web/app/r/[requestId]/page.tsx`
- Create: `apps/prospect-web/app/api/parent-response/[requestId]/submit/route.ts`
- Create: `apps/prospect-web/app/api/parent-response/[requestId]/notify/route.ts`
- Later create: `apps/prospect-web/app/api/parent-response/[requestId]/approve/route.ts`
- Create: `apps/prospect-web/lib/parent-response.ts`
- Create: `apps/prospect-web/tests/parent-response-routes.test.ts`
- Modify: `apps/prospect-web/lib/env.ts`
- Modify: `apps/prospect-web/.env.example`
- Later create/export: `n8n/workflows/parent-response-review.json`

## Task 1: Schema Contract

- [x] **Step 1: Add failing SQL contract test**

Create `supabase/tests/parent-response-requests-contract.test.mjs` with assertions that the migration defines:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260612150000_parent_response_requests.sql',
  'utf8',
);

test('parent response requests store intent but not lifecycle truth', () => {
  assert.match(migration, /create table if not exists public\.parent_response_requests/);
  assert.match(migration, /request_status text not null/);
  assert.match(migration, /token_hash text not null/);
  assert.match(migration, /response_kind text/);
  assert.match(migration, /selected_option_id text/);
  assert.match(migration, /approval_status text not null default 'pending'/);
  assert.doesNotMatch(migration, /lifecycle_events/i);
  assert.doesNotMatch(migration, /update public\.appointments/i);
});
```

- [x] **Step 2: Run test and confirm it fails**

Run: `node --test supabase/tests/parent-response-requests-contract.test.mjs`

Expected: FAIL because the migration does not exist.

- [x] **Step 3: Add migration**

Create `supabase/migrations/20260612150000_parent_response_requests.sql`:

```sql
create table if not exists public.parent_response_requests (
  id uuid primary key default gen_random_uuid(),
  appointment_id text,
  athlete_id text not null,
  athlete_main_id text not null,
  athlete_name text not null,
  recipient_name text,
  recipient_phone text,
  original_head_scout_name text,
  original_head_scout_owner_key text,
  original_meeting_starts_at timestamptz,
  original_meeting_timezone text,
  request_status text not null default 'open',
  approval_status text not null default 'pending',
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  response_kind text,
  selected_option_id text,
  selected_at timestamptz,
  source text not null default 'parent_response_link',
  created_by_operator_key text,
  proposed_options jsonb not null default '[]'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  approval_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_response_requests_status_check
    check (request_status in ('open', 'selected', 'none_work', 'expired', 'canceled', 'applied')),
  constraint parent_response_requests_approval_check
    check (approval_status in ('pending', 'approved', 'applied', 'rejected', 'failed')),
  constraint parent_response_requests_response_kind_check
    check (response_kind is null or response_kind in ('selected_slot', 'none_work'))
);

create index if not exists parent_response_requests_open_idx
  on public.parent_response_requests (request_status, expires_at);

create index if not exists parent_response_requests_approval_idx
  on public.parent_response_requests (approval_status, updated_at desc);

alter table public.parent_response_requests enable row level security;

drop policy if exists parent_response_requests_service_role_all on public.parent_response_requests;
create policy parent_response_requests_service_role_all
  on public.parent_response_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

- [x] **Step 4: Run contract test**

Run: `node --test supabase/tests/parent-response-requests-contract.test.mjs`

Expected: PASS.

## Task 2: Token and Request Domain

- [x] **Step 1: Add domain tests**

Create `src/domain/parent-response-request.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashParentResponseToken,
  isParentResponseRequestOpen,
  selectParentResponseOption,
} from './parent-response-request';

test('hashParentResponseToken is deterministic and hides the token', async () => {
  const hash = await hashParentResponseToken('secret-token', 'pepper');
  assert.equal(hash, await hashParentResponseToken('secret-token', 'pepper'));
  assert.notEqual(hash, 'secret-token');
});

test('isParentResponseRequestOpen rejects used and expired requests', () => {
  assert.equal(isParentResponseRequestOpen({ request_status: 'open', used_at: null, expires_at: '2099-01-01T00:00:00Z' }, new Date('2026-06-12T12:00:00Z')), true);
  assert.equal(isParentResponseRequestOpen({ request_status: 'selected', used_at: null, expires_at: '2099-01-01T00:00:00Z' }, new Date('2026-06-12T12:00:00Z')), false);
  assert.equal(isParentResponseRequestOpen({ request_status: 'open', used_at: '2026-06-12T10:00:00Z', expires_at: '2099-01-01T00:00:00Z' }, new Date('2026-06-12T12:00:00Z')), false);
  assert.equal(isParentResponseRequestOpen({ request_status: 'open', used_at: null, expires_at: '2026-06-12T10:00:00Z' }, new Date('2026-06-12T12:00:00Z')), false);
});

test('selectParentResponseOption writes intent only', () => {
  const update = selectParentResponseOption({
    optionId: 'slot-1',
    responsePayload: { parent_note: 'That works' },
    selectedAt: '2026-06-12T12:00:00Z',
  });
  assert.equal(update.request_status, 'selected');
  assert.equal(update.response_kind, 'selected_slot');
  assert.equal(update.selected_option_id, 'slot-1');
  assert.equal(update.used_at, '2026-06-12T12:00:00Z');
  assert.equal('crm_stage' in update, false);
  assert.equal('appointment_status' in update, false);
});
```

- [x] **Step 2: Run test and confirm it fails**

Run: `npx tsx --test src/domain/parent-response-request.test.ts`

Expected: FAIL because module does not exist.

- [x] **Step 3: Add domain module**

Create `src/domain/parent-response-request.ts` with token hashing and intent-only update helpers.

- [x] **Step 4: Run domain test**

Run: `npx tsx --test src/domain/parent-response-request.test.ts`

Expected: PASS.

## Task 3: Prospect Web Parent Page and Submit Route

- [x] Add server-side request validation in `apps/prospect-web/lib/parent-response.ts`.
- [x] Add parent page at `/r/[requestId]`.
- [x] Add submit route that updates only `parent_response_requests`.
- [x] Add route tests for invalid token, expired token, selected slot, none-work, and ready-later.
- [x] Run route tests through `cd apps/prospect-web && npm run verify`.

## Task 4: Human-Triggered Request Creation

- [x] Identify the exact Prospect Pipeline surface for `Create Parent Reschedule Link` in Scout Prep detail and task-row Workflow actions.
- [x] Require current state evidence that the athlete is in `Meeting Result - Res. Pending` or a deliberately supported no-show recovery state.
- [x] Refresh current context before fetching slots.
- [x] Fetch current openings only at button/action time.
- [x] Create `parent_response_requests` with proposed options from that fresh fetch.
- [x] Do not let n8n or cron create request rows.

## Task 5: Resend Notification

- [x] Add env names to `apps/prospect-web/lib/env.ts`:
  - `RESEND_API_KEY`
  - `PARENT_RESPONSE_NOTIFY_FROM`
  - `PARENT_RESPONSE_NOTIFY_TO`
  - `PARENT_RESPONSE_APPROVAL_SECRET`
  - `PARENT_RESPONSE_TOKEN_SECRET`
- [x] Add `.env.example` placeholders.
- [x] Add notify route that sends operator email via Resend REST API.
- [x] Email includes:
  - parent response
  - athlete/meeting context
  - manual review link for none-work / ready-later.
- [x] Test route without real Resend by mocking `fetch`.

Approval links are intentionally deferred until the approval route can reuse the traced Prospect Pipeline/Raycast reschedule mutation path end to end.

## Task 6: Approval Route

- [x] Extract or add a Prospect Pipeline helper for confirmed reschedule approval only if it can preserve the traced Raycast sequence.
- [x] Approval route must require `PARENT_RESPONSE_APPROVAL_SECRET`.
- [x] Approval route must load the Supabase row server-side.
- [x] Approval route must call the helper that owns:
  - `submitRescheduleMeeting(...)`
  - `updateSalesStage(...)`
  - `recordRescheduled(...)`
- [x] Approval route must mark approval failed if adapter call fails.
- [x] Approval route must mark applied only after adapter success and durable write attempt.

## Task 7: Local n8n, No Docker

- [x] Start local n8n:

```sh
n8n
```

- [x] Open `http://localhost:5678`.
- [ ] Create credentials for Supabase using HTTP Request or Postgres node.
- [x] Create workflow JSON:
  - Schedule Trigger every 5 minutes.
  - Query `parent_response_requests` where `request_status in ('selected', 'none_work', 'ready_later')` and `approval_status = 'pending'`.
  - HTTP Request to Vercel notify route.
  - Mark `notification_status`, `notification_sent_at`, and `notification_error` only.
- [x] Export/import workflow JSON at `n8n/workflows/parent-response-review.json`.
- [x] Add workflow contract test proving n8n stays downstream and patches only notification metadata.

## Task 8: Verification and Deploy

- [ ] Install Vercel CLI only if needed:

```sh
npm install -g vercel
```

- [ ] Ask user to accept Vercel auth prompt if needed.
- [ ] Set Vercel env vars.
- [x] Add live readiness verifier for local Raycast/root env, current n8n shell env, Vercel production env, and workflow artifact:

```sh
npm run verify:parent-response-readiness
```

- [x] Run `cd apps/prospect-web && npm run verify`.
- [x] Run focused root tests for any shared helper.
- [ ] Create one dry-run request row.
- [ ] Submit parent response.
- [ ] Confirm Supabase state.
- [ ] Confirm Resend notification.
- [ ] Approve one test with explicit operator confirmation.
