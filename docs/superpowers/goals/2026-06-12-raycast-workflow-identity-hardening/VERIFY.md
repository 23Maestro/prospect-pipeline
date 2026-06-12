# VERIFY: Raycast Workflow Identity Hardening

## Requirement-To-Check Map

| Requirement | Verification Method | Expected Result | Evidence |
| --- | --- | --- | --- |
| R1. Confirmed reschedule uses a Meetings-owned helper. | `npm run test:domain` and inspect `src/domain/appointment-truth.test.ts`. | Tests prove one previous appointment identity is resolved and initial booked meeting is preferred. | `src/domain/appointment-truth.test.ts` |
| R2. Laravel/FastAPI and Supabase use the same previous appointment identity. | `npm run test:domain`; architecture contract test `Post-call confirmed reschedule uses one Meetings identity for Laravel and Supabase`. | `previous_event_id`, `previousAppointmentId`, and `previous_appointment_id` all come from `rescheduleAppointmentIdentity`. | `src/domain/architecture-contract.test.ts` |
| R3. Raycast UI files do not derive durable identity inline for mapped high-risk surfaces. | `node --test scripts/audit-raycast-workflow-identity-contract.test.mjs`. | Regression fixtures fail when UI code assembles identity directly. Current mapped files pass. | `scripts/audit-raycast-workflow-identity-contract.test.mjs` |
| R4. Workflow identity contract is audit-able in code. | `node scripts/audit-raycast-workflow-identity-contract.mjs`. | CLI exits 0 and prints `Raycast workflow identity contracts passed.` | `scripts/audit-raycast-workflow-identity-contract.mjs` |
| R5. Audit maps actions to buckets, canonical IDs, adapter fields, allowed derivers, required patterns, and forbidden derivations. | Inspect exported `RAYCAST_WORKFLOW_IDENTITY_CONTRACTS`; run audit unit tests. | Contracts exist for five action surfaces and tests assert each mapping. | `scripts/audit-raycast-workflow-identity-contract.mjs` |
| R6. Architecture remains shared identity spine plus bucket-owned resolvers, not a catch-all resolver. | Inspect `GOAL.md`, contract allowed derivers, and domain helper placement. | Resolver added to Meetings-owned `appointment-truth`; no god resolver introduced. | `src/domain/appointment-truth.ts` |
| R7. Local proof includes focused tests, broad tests, diff check, and Raycast build. | Run command list below. | All commands pass locally. | `.tmp/honest-test-report.json` for `npm test`; terminal output for other commands. |
| R8. Linear tracking is updated. | Check Linear issue `23M-51`. | Issue records proof and is closed after the verified commit is pushed. | Linear `23M-51` |

## Commands

```bash
node --test scripts/audit-raycast-workflow-identity-contract.test.mjs
node scripts/audit-raycast-workflow-identity-contract.mjs
node --test scripts/honest-test-report.test.mjs
git diff --check
npm test
npx ray build
```

## Expected Results

- The audit test suite reports 12 passing tests.
- The audit CLI reports `Raycast workflow identity contracts passed.`
- The honest test report includes `raycast workflow identity contracts`.
- `npm test` writes `.tmp/honest-test-report.json` with every suite passing.
- `npx ray build` reports `built extension successfully`.
- `git diff --check` exits with no output.

## Manual Review Checks

- Confirm `src/scout-prep.tsx` resolves `rescheduleAppointmentIdentity` once before submitting confirmed reschedule.
- Confirm `previous_event_id` maps from `rescheduleAppointmentIdentity.previousEventId`.
- Confirm `recordRescheduled.previousAppointmentId` and payload `previous_appointment_id` map from `rescheduleAppointmentIdentity.previousAppointmentId`.
- Confirm the audit contract covers the intended buckets instead of scanning every identifier occurrence blindly.
- Confirm the change does not claim live Laravel/Supabase readback.

## Seam Checks

- Confirmed reschedule seam: same previous appointment identity crosses Laravel/FastAPI submit and Supabase durable appointment write.
- Meeting Set seam: Laravel submit, Supabase lifecycle write, and confirmation-cache sync remain action-plan driven.
- Task completion seam: task ID remains task identity; CRM stage remains lifecycle meaning.
- Contact-cache seam: Raycast passes `ScoutPrepContext`; contact-cache helpers assemble durable row identity.
- Head Scout confirmation seam: confirmation title prefix and cache read use booked meeting event identity, not task/pending-client IDs.

## Environment Notes

- Commands assume the repo root is `/Users/singleton23/Raycast/prospect-pipeline`.
- `npm test` is local deterministic proof only.
- `npx ray build` validates Raycast extension compile/build only.
- Live Laravel/Supabase verification requires a real athlete/reschedule run and was not part of this local proof.
