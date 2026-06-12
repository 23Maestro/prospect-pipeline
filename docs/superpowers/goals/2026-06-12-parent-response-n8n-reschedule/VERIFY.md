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
- Static guard proving browser code does not expose service role, Resend key, approval secret, or token hash secret.
- `npm run verify` in `apps/prospect-web`.
- Focused Prospect Pipeline tests for any shared helper:
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
