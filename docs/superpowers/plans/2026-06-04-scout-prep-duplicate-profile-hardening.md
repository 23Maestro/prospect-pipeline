# Scout Prep Duplicate Profile Hardening Plan

Date: 2026-06-04

## Bucket Classification

Primary bucket: Admin Data & Contacts.

Supporting buckets:

- Pre-Meeting Tasks: only for duplicate-side Call Attempt 1 completion or completed REPEAT task creation.
- Lifecycle & Stage Truth: only for CRM sales-stage gates such as New Opportunity or New Scout Appearance; stage meaning stays separate from task status.

Command-D in Scout Prep remains a UI button. Duplicate meaning belongs in `src/lib/scout-duplicate-profiles.ts`. FastAPI/Laravel calls remain source-system adapters. Supabase is not the first writer for this workflow unless a later slice explicitly adds durable duplicate-audit truth.

## Current State

- Scout Prep exposes `Duplicate Profile Check` on `cmd+d`.
- The Raycast tool `deplicate-profiles` also calls `runDuplicateProfileResolutionForTask(...)`.
- The current domain searches `/athlete/admin-duplicate-search`, filters exact-name matches, accepts any single secondary row match, then mutates the duplicate-side task.
- The legacy script `<LOCAL_SCRIPTS_DIR>/check-repeat-profiles.sh` manually adds a `REPEAT` task and marks it complete in Chrome.
- The repo domain already implements the legacy mutation through `/tasks/create-completed`, `updateScoutPrepTask(...)`, and `completeScoutPrepTaskAfterVoicemail(...)`.

## Logging Contract

Use the `auto-logger` skill for this workflow.

Logger: reuse `searchLogger` / `<LOCAL_LOG_DIR>/search.log`.

Every duplicate check should emit structured events with:

- `event`
- `step`
- `status`
- `feature`
- `error` only on failure

Log key milestones, not full payloads:

- check start: task id, current contact id, athlete main id presence, task title
- duplicate search request and response: endpoint, status, result count, duration if available
- candidate classification: candidate id, matched field names, confidence outcome, unresolved reason
- detail-envelope request and response: contact id, athlete main id presence, status, has student, has parent1, has parent2
- mutation start and result: update existing Call Attempt 1 or create completed REPEAT task, task id, status

Do not log full names, phone numbers, emails, or full contact payloads.

## Decision Envelope

Build a duplicate decision envelope before mutating:

- current profile identity: athlete id, athlete main id, name parts, sport, grad year, state, high school
- candidate profile identity: same fields from search row and resolved details
- current contact envelope from `fetchContactInfo(...)`
- candidate contact envelope from `fetchContactInfo(...)`
- candidate tasks from `fetchAthleteTasks(...)`
- sales-stage evidence when available from existing scout-prep resolve/task surfaces

The search table row is a discovery surface only. Contact envelope comparison is the confidence surface.

## Confidence Rules

Auto-mark repeat only when all required gates pass:

- Current task is incomplete `Call Attempt 1`.
- Candidate is not the current athlete id or same athlete main id.
- Name is an exact first/last match after existing normalization.
- Candidate profile has incomplete `Call Attempt 1`, or no duplicate-side Call Attempt 1 and the fallback is to create completed `REPEAT`.
- Detail envelope confirms identity through contact/family evidence or enough profile evidence.

High-confidence repeat examples:

- Same name, same sport, same grad year, same state, and same parent/student phone or email.
- Same name, different sport, same grad year/state, and same parent/student phone or email. Treat as likely same kid multi-sport.
- Same name, same sport, same grad year, sparse high school on one side, and same parent/student phone or email.
- Both profiles show New Opportunity and duplicate-side task is Call Attempt 1, with contact envelope match.

Do not auto-mark:

- Same name only.
- Same name plus same state/sport/grad year but no contact-envelope match.
- Same name with different grad year unless contact envelope match is strong and the plan gets a later explicit business approval.
- Same name, different state, even same sport, unless contact envelope match is strong; otherwise return unresolved.
- Candidate stage is the grayed New Scout Appearance value until the exact label and task/stage meaning are captured.

## Contingencies To Encode

1. Same name, same grad year/state, different sport.
   - Fetch both detail envelopes.
   - If contact envelope matches, classify as `likely_same_kid_multi_sport` and auto-mark repeat.
   - If not, return unresolved with `different_sport_contact_mismatch`.

2. Same name, different state and maybe same or different sport.
   - Fetch both detail envelopes.
   - Only auto-mark on strong contact envelope match.
   - Otherwise leave alone with `different_state_unresolved`.

3. Both profiles are New Opportunity and duplicate-side task is Call Attempt 1.
   - If contact envelope matches, mark repeat by updating/completing duplicate Call Attempt 1.
   - If duplicate-side Call Attempt 1 is missing, create completed `REPEAT` task through the existing `/tasks/create-completed` adapter.

4. Candidate has grayed New Scout Appearance stage.
   - First implementation should log and return unresolved until the exact source label is known.
   - Add a focused test once the exact label is captured.

## Implementation Slices

1. Logging and result shape.
   - Bring `src/lib/scout-duplicate-profiles.ts` logging into the auto-logger contract.
   - Return candidate decision outcomes so Scout Prep can show clearer toasts.
   - Keep mutations unchanged.

2. Detail-envelope comparator.
   - Add a domain-level comparator in `src/lib/scout-duplicate-profiles.ts` or a bucket-owned domain module if the file becomes too large.
   - Fetch current and candidate contact info once per check and compare normalized phones/emails/names without storing full PII in logs.
   - Add tests for sparse high school, multi-sport, different state, and contact mismatch.

3. Stage and task gates.
   - Reuse existing Scout Prep detail/task fetchers.
   - Gate auto-marking on incomplete Call Attempt 1 and known stage labels.
   - Add unresolved outcome for the New Scout Appearance label until verified.

4. Mutation hardening.
   - Keep existing `updateScoutPrepTask(...)`, `completeScoutPrepTaskAfterVoicemail(...)`, and `/tasks/create-completed`.
   - Only call them after the decision envelope is high confidence.
   - Log mutation result and skip reasons.

5. UI feedback.
   - Keep `cmd+d`.
   - Show `Duplicate resolved`, `Duplicate unresolved`, or `No duplicate found` with the highest-signal reason.
   - Do not make Scout Prep parse raw candidate details in the component.

## Proof Plan

Focused tests:

- `npm run test:scout-duplicate-profiles`
- Add comparator tests for all contingency cases above.
- Add a regression test that same-name plus weak table evidence no longer mutates.

Broader proof when the business meaning changes:

- `npm test`
- `git diff --check`
- `npx ray build` if Raycast TSX changes.

Live proof is separate from local tests. A later live slice should run one observational duplicate check first, inspect `search.log`, then run one high-confidence repeat mutation.
