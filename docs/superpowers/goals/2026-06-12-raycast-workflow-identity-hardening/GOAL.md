# GOAL: Raycast Workflow Identity Hardening

## Objective

Harden Raycast Scout Prep workflow identity handling so durable business identity is resolved by the shared identity spine and bucket-owned helpers, while Raycast command files remain UI surfaces and adapter payload mappers.

## Repo Context

- Repo: `<REPO_ROOT>`.
- Primary command surface: `src/scout-prep.tsx`.
- Architecture map: `docs/architecture/scouting-coordinator-system-map.md`.
- Supabase truth map: `docs/architecture/scout-prep-supabase-source-of-truth.md`.
- Existing domain surfaces:
  - Shared identity spine: `src/domain/workflow-context.ts`.
  - Meetings: `src/domain/appointment-truth.ts`, `src/lib/booked-meeting-details-resolver.ts`, `src/lib/head-scout-appointment-lifecycle.ts`.
  - Pre-Meeting Tasks: `src/domain/scout-task-selection.ts`, `src/domain/post-call-action.ts`, `src/lib/scout-prep-task-completion.ts`.
  - Admin Data & Contacts: `src/domain/athlete-contact-cache.ts`, `src/lib/athlete-contact-cache.ts`, `src/lib/scout-prep-contact.ts`.
  - Lifecycle & Stage Truth: `src/domain/sales-stage-contract.ts`, `src/domain/supabase-lifecycle-translator.ts`, `src/lib/supabase-lifecycle.ts`.

## Scouting Coordinator Buckets

- Meetings: confirmed reschedule previous appointment identity, Meeting Set appointment identity, Head Scout confirmation appointment identity.
- Pre-Meeting Tasks: Post-Call Update task completion identity.
- Admin Data & Contacts: Scout Prep contact-cache identity.
- Lifecycle & Stage Truth: sales-stage writes and task status remain adjacent facts, not identity derivation ownership.

## Requirements

1. Confirmed reschedule must resolve one previous appointment identity through a Meetings-owned helper.
2. Laravel/FastAPI `previous_event_id` and Supabase `previousAppointmentId` / `previous_appointment_id` must use the same resolved previous appointment identity.
3. Raycast UI files must not derive durable business identity inline from ad hoc fields such as `initialBookedMeeting?.event_id`, `task_id`, or manually assembled `athlete_id` / `athlete_main_id` / `contact_id` rows when a bucket helper owns the meaning.
4. The workflow identity contract must be audit-able in code, similar in spirit to `scripts/audit-supabase-truth-map.mjs`.
5. The audit must map Raycast actions to buckets, canonical IDs, adapter fields, allowed derivers, required patterns, and forbidden UI-local derivations.
6. The contract must prefer one shared identity spine plus bucket-owned resolvers over a catch-all resolver.
7. Local proof must include focused tests, broad business tests when feasible, whitespace diff checks, and Raycast build proof because `src/scout-prep.tsx` changed.
8. Linear tracking must be updated on the focused issue instead of leaving the thread as the only record.

## Boundaries

- Do not build a catch-all identity resolver.
- Do not add broad fallback logic.
- Do not add a new Supabase truth table, view, or cache.
- Do not make Laravel/FastAPI wrappers own domain meaning.
- Do not use confirmation cache as lifecycle or meeting truth.
- Do not use `task_id` as appointment identity.
- Do not conflate `athlete_id`, `athlete_main_id`, and `contact_id`.
- Do not mark live behavior verified unless Laravel/Supabase live readback was actually performed.

## Definition Of Done

- Confirmed reschedule resolves prior appointment identity in `src/domain/appointment-truth.ts`.
- `PostCallUpdateForm` maps that resolved identity to both Laravel/FastAPI and Supabase reschedule writes.
- `scripts/audit-raycast-workflow-identity-contract.mjs` covers the current high-risk Raycast workflow identity surfaces.
- The audit is included in the root honest test report.
- Focused and broad local verification pass.
- Linear issue `23M-51` records implementation and proof state.

## Stop Conditions

- Stop if a required identity source cannot be classified into a Scouting Coordinator bucket.
- Stop if a Raycast UI surface needs to invent durable identity instead of calling an existing domain or bucket helper.
- Stop if Laravel/FastAPI and Supabase require different semantic IDs for the same business concept.
- Stop if a proposed check cannot be tied to a specific requirement in this file.
