# Verification

## Required Local Proof

- `git status --short --branch`
- Supabase migration contract test for parent request/response tables.
- Prospect Web route tests for:
  - valid request/token render
  - invalid token rejection
  - expired request rejection
  - selected slot response write
  - none-work response write
  - ready-later response write
  - notify route requires protected operator token
  - notify route sends a mocked Resend email
  - approval route requires protected operator token
  - approval route requires explicit confirmation
  - approval route calls the reschedule adapter path and marks applied only after durable write attempt
- Static guard proving browser code does not expose service role, Resend key, approval secret, or token hash secret.
- `npm run verify` in `apps/prospect-web`.
- n8n workflow contract:
  - `node --test n8n/workflows/parent-response-review.test.mjs`
  - confirms local workflow is inactive by default
  - confirms submitted-response query only
  - confirms notify route call
  - confirms final patch writes only notification metadata
- n8n env/start helper:
  - `node --test scripts/start-parent-response-n8n.test.mjs`
  - `npm run n8n:parent-response:check`
  - confirms ignored repo env can start n8n without shell-sourcing `.env`
- Live readiness verifier:
  - `npm run verify:parent-response-readiness`
  - confirms local Raycast/root env has parent token and public base URL
  - confirms current n8n shell env has Supabase and notify route settings
  - confirms Vercel production env has Supabase, FastAPI, parent response, and Resend settings
  - confirms the n8n workflow artifact exists
- Focused Prospect Pipeline tests for any shared helper:
  - `node --import tsx --test src/lib/parent-response-approval.test.ts src/lib/parent-response-request-writer.test.ts src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/lib/parent-response-request-writer.test.ts src/domain/parent-response-request.test.ts`
  - `node --import tsx --test src/domain/architecture-contract.test.ts`
  - `npm run test:domain`
  - `npm run build`
  - `npm test`
- `git diff --check`.

## Required Live/Manual Proof Before Real Use

- Start n8n locally from npm/nvm, not Docker.
- Confirm n8n version is `2.25.7`.
- Import or verify the local workflow JSON.
- Confirm `http://localhost:5678` responds.
- Run `npm run verify:parent-response-readiness` until all sections pass.
- Start n8n with `npm run n8n:parent-response:start`.
- Create one dry-run Supabase request row.
- Open the Vercel parent URL.
- Submit a selected slot.
- Confirm Supabase request changes to selected response state.
- Confirm Resend notification reaches the operator inbox.
- Confirm approval route does not run without the operator approval secret.
- Confirm first real approval uses the existing reschedule adapter path and produces live readback.

## Not Proof

- n8n workflow canvas existing locally.
- Resend API key existing.
- Supabase insert succeeding without checking row state.
- Vercel build passing without route behavior tests.
