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
- Verified:
  - `node --test supabase/tests/parent-response-requests-contract.test.mjs`
  - `npx tsx --test src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/lib/parent-response-request-writer.test.ts src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/domain/architecture-contract.test.ts`
  - `npm run test:domain`
  - `npm run build`
  - `npm test`
  - `cd apps/prospect-web && npx tsx --test tests/parent-response-routes.test.ts`
  - `cd apps/prospect-web && npm run verify`
  - `node -e "const fs=require('fs'); const workflow=JSON.parse(fs.readFileSync('n8n/workflows/parent-response-review.json','utf8')); ..."`
  - `n8n --version`
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
- Vercel auth prompt if installing/using Vercel CLI.
- Supabase/Vercel env var confirmation before deployment.
- Dry-run Supabase row and local n8n UI/manual workflow execution before live use.
