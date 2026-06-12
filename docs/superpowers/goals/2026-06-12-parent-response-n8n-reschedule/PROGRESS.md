# Progress

## 2026-06-12

### Completed

- Committed and pushed clean-slate Raycast workflow identity audit: `db58cda1`.
- Confirmed checkout clean after removing generated build/temp noise.
- Researched current n8n setup.
- Installed n8n locally via npm, no Docker.
- Verified local n8n binary and version:
  - `/Users/singleton23/.nvm/versions/node/v22.22.3/bin/n8n`
  - `2.25.7`
- Confirmed Supabase CLI is available:
  - `2.102.0`
- Confirmed Vercel CLI is not on PATH.
- Traced approval mutation boundary to the existing Raycast confirmed reschedule flow.
- Added `parent_response_requests` Supabase migration for parent intent storage.
- Added SQL contract proving the parent response table does not mutate lifecycle or appointment truth.
- Added pure parent-response domain helpers for token hashing, open/expired validation, selected-slot intent, and none-work intent.
- Revised architecture so sales stage remains the driver and fresh slot links are human-triggered only.
- Added `ready_later` parent response intent for families who say they will follow up when ready.
- Added Prospect Web parent response validation, page shell, and submit route that writes only `parent_response_requests`.
- Added protected Prospect Web notify route that sends operator email through Resend REST and does not mutate lifecycle or appointment truth.
- Added notification metadata fields to `parent_response_requests` so local n8n can mark notification delivery without touching business state.
- Added importable local n8n workflow JSON at `n8n/workflows/parent-response-review.json`.
- Imported the workflow successfully into local `n8n@2.25.7`.
- Added Scout Prep Workflow actions named `Create Parent Reschedule Link` on the detail view and task rows.
- Added a parent-response request writer that signs one-time links and inserts intent-only request rows without writing lifecycle, appointment, or sales-stage truth.
- The link action refreshes Scout Prep context live, checks the selected CRM stage is `Meeting Result - Res. Pending`, fetches fresh same-head-scout openings at action time, inserts `parent_response_requests`, and copies parent-facing link text.
- Added Raycast preferences and env examples for `PARENT_RESPONSE_TOKEN_SECRET` and `PARENT_RESPONSE_PUBLIC_BASE_URL`.
- Added a confirmed parent-response approval helper that preserves the Raycast order: reschedule adapter, sales-stage update, then durable reschedule write.
- Added protected Prospect Web approval route at `/api/parent-response/[requestId]/approve`; it requires `PARENT_RESPONSE_APPROVAL_SECRET` and explicit `confirm: true`.
- Approval now marks support rows `applied` only after adapter success and durable write attempt; adapter failures mark `approval_status = failed`.
- Parent response options now persist the head-scout `assigned_to` adapter value needed for later approval.
- Added `n8n/README.md` with local startup, required env, import, and dry-run verification steps.
- Added `n8n/workflows/parent-response-review.test.mjs` to prove the n8n workflow stays downstream of submitted responses and patches only notification metadata.
- Added `scripts/verify-parent-response-readiness.mjs` and `npm run verify:parent-response-readiness` to check live-readiness without printing secrets.
- Confirmed local n8n starts from npm/nvm and serves `http://localhost:5678`.
- Re-imported `n8n/workflows/parent-response-review.json` into local n8n as inactive workflow `parent-response-review`.
- Observed unrelated existing active n8n workflows `pipeline.n8n_INBOX1` and `pipeline.n8n_ASSIGN2` failing startup activation because `n8n-nodes-base.executeCommand` is unavailable; did not modify those workflows.
- Confirmed Vercel auth is available through `npx vercel` as `23maestro`, and `apps/prospect-web` is linked to project `prospect-web`.
- Confirmed production Vercel currently has Supabase/FastAPI env but is missing `PARENT_RESPONSE_TOKEN_SECRET`, `PARENT_RESPONSE_NOTIFY_SECRET`, `PARENT_RESPONSE_APPROVAL_SECRET`, `RESEND_API_KEY`, `PARENT_RESPONSE_NOTIFY_FROM`, and `PARENT_RESPONSE_NOTIFY_TO`.
- Confirmed local root/Raycast env is missing `PARENT_RESPONSE_TOKEN_SECRET` and `PARENT_RESPONSE_PUBLIC_BASE_URL`; the current n8n shell is missing its Supabase and notify-route env.
- Generated and configured shared parent response token, notify, and approval secrets in ignored local `.env` and Vercel production.
- Added local `PARENT_RESPONSE_PUBLIC_BASE_URL` and `PARENT_RESPONSE_NOTIFY_BASE_URL` values pointing at `https://prospect-web.vercel.app`.
- Confirmed local/Raycast readiness passes after ignored env setup; confirmed n8n shell readiness passes when launched with the parsed local env and `SUPABASE_SECRET_KEY` mapped to `SUPABASE_SERVICE_ROLE_KEY`.
- Added `scripts/start-parent-response-n8n.mjs` and npm commands to check/start n8n with parsed ignored repo env instead of shell-sourcing `.env`.
- Added `scripts/sync-parent-response-vercel-env.mjs` and npm commands to sync only allowlisted parent response/Resend env values from ignored local env to Vercel production.
- Applied live Supabase migration `20260612150000_parent_response_requests.sql` to project `udwqtwppbtrtvvsgqwml` after the first live dry-run proved the table was missing.
- Added `scripts/verify-parent-response-live-dry-run.mjs` and npm command for a gated production submit/readback dry-run that writes only fake `parent_response_requests` support state and then marks the row canceled.
- Ran production dry-run successfully:
  - request id `69360c0f-e2b5-48e1-9c8f-f8ec9b45e78f`
  - submit status `200`
  - Supabase readback `request_status=ready_later`, `response_kind=ready_later`, `notification_status=pending`
  - cleanup marked the support row canceled / dry-run verified
- First production deploy failed because `apps/prospect-web/lib/parent-response-approval.ts` imported root `src` files that Vercel does not upload for the app project.
- Made the Prospect Web approval adapter deployable by keeping its approval payload assembly and minimal response types inside `apps/prospect-web/lib/parent-response-approval.ts`, while preserving reschedule -> stage -> durable write order.
- Deployed Prospect Web production successfully:
  - deployment: `https://prospect-idvug9ycc-23maestros-projects.vercel.app`
  - alias: `https://prospect-web.vercel.app`
- Verified:
  - `node --test supabase/tests/parent-response-requests-contract.test.mjs`
  - `npx tsx --test src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/lib/parent-response-request-writer.test.ts src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/lib/parent-response-approval.test.ts src/lib/parent-response-request-writer.test.ts src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/domain/architecture-contract.test.ts`
  - `npm run test:domain`
  - `npm run build`
  - `npm test`
  - `cd apps/prospect-web && npx tsx --test tests/parent-response-routes.test.ts`
  - `cd apps/prospect-web && npm run verify`
  - `node -e "const fs=require('fs'); const workflow=JSON.parse(fs.readFileSync('n8n/workflows/parent-response-review.json','utf8')); ..."`
  - `node --test n8n/workflows/parent-response-review.test.mjs`
  - `node --test scripts/verify-parent-response-readiness.test.mjs`
  - `node --test scripts/start-parent-response-n8n.test.mjs`
  - `node --test scripts/sync-parent-response-vercel-env.test.mjs`
  - `node --import tsx --test scripts/verify-parent-response-live-dry-run.test.mjs`
  - `npm run n8n:parent-response:check`
  - `npm run sync:parent-response-vercel-env:check` (expected FAIL until Resend values are added to ignored local env)
  - `npm run verify:parent-response-readiness` (expected FAIL until missing env is configured)
  - `npm run verify:parent-response-live-dry-run`
  - `/opt/homebrew/bin/supabase db push`
  - `npx vercel env ls`
  - `npx vercel deploy --prod -y`
  - `n8n --version`
  - `curl -fsSI http://localhost:5678`
  - `n8n import:workflow --input=n8n/workflows/parent-response-review.json`
  - `git diff --check`

### Current Direction

V1 should use Vercel for the parent-facing page and protected approval routes. Slot-link creation should be a human-triggered Prospect Pipeline action after sales stage is already `Meeting Result - Res. Pending` or another approved recovery state. n8n should run locally as a downstream polling/orchestration layer for submitted parent responses only. It should not fetch slots, generate parent links by cron, infer readiness, expose public webhooks in V1, or run from Docker.

### Architecture Adjustment

- Sales stage is the driver.
- The existing post-meeting update writes the reschedule-pending state and reason note first.
- Parent link creation happens later only when the operator knows the family is ready.
- Fresh head-scout openings are fetched at that operator action time to avoid stale slot options.
- Parent responses support selected slot, none work, and ready later.
- n8n notifies/routes submitted responses but does not decide the next business state.

### Needs User/API Input

- Resend API key.
- Verified sender/from domain or address for Resend.
- Operator notification email address.
- Dry-run Supabase row and local n8n UI/manual workflow execution before live use.
