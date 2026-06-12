# Parent Response n8n Reschedule Workflow

## Objective

Set up a Prospect Pipeline reschedule/no-show parent-response workflow with Vercel parent intake, Supabase response storage, Resend email notification, and local npm-based n8n orchestration while preserving Scouting Coordinator source-of-truth boundaries.

## Non-Negotiables

- No Docker for n8n.
- n8n runs locally from npm/nvm.
- Parent page records intent only.
- Supabase stores request/response state.
- Resend sends operator email notifications.
- Approval mutation must reuse the Prospect Pipeline/Raycast reschedule path.
- n8n must not assemble lifecycle meaning, CRM stage meaning, appointment truth, or Laravel payloads.
- Sales stage is the driver: `Meeting Result - Res. Pending` or no-show recovery state must already exist before a parent response link is created.
- Fresh open slots must be fetched only from a human-triggered action, not from n8n or cron.

## Local Tooling State

- `n8n@2.25.7` installed globally with npm.
- n8n binary: `/Users/singleton23/.nvm/versions/node/v22.22.3/bin/n8n`.
- Node: `v22.22.3`.
- Supabase CLI: `2.102.0`.
- Vercel CLI is not currently on PATH.

## Scouting Coordinator Buckets

- Meetings: appointment identity, selected slot, previous appointment, reschedule chain.
- Enrollments & Outcomes: no-show and reschedule-pending parent recovery state.
- Client Communication: parent-facing link and operator email notification.
- Lifecycle & Stage Truth: only updated after operator approval through the existing reschedule path.
- Admin Data & Contacts: athlete/contact context copied into the request row for display and notification.

## Mutation Contract

The parent response workflow starts after the existing post-meeting update:

- Operator sets `Meeting Result - Res. Pending` through the existing Raycast/Prospect Pipeline flow.
- That flow writes the sales stage and the reschedule reason note.
- Cron/sync jobs may observe and report that state; they must not generate parent links or fetch slot options.
- When the parent later says they are ready, the operator triggers a fresh-slot action from a Prospect Pipeline surface.

Approval must emulate Raycast Scout Prep confirmed reschedule:

- Source path: `src/scout-prep.tsx` `PostCallUpdateForm.handleSubmit`.
- Adapter call: `submitRescheduleMeeting(...)` from `src/lib/sales-stage.ts`.
- Stage call: `updateSalesStage(...)` from `src/lib/sales-stage.ts`.
- Durable write: `recordRescheduled(...)` from `src/lib/supabase-lifecycle.ts`.
- Previous appointment identity must come from a Meetings-owned resolver, not the parent page or n8n.

## Work Slices

1. Plan and schema contract.
2. Supabase request/response tables and tests.
3. Vercel parent response page and server routes.
4. Human-triggered fresh-slot request creation action.
5. Resend operator notification route.
6. Protected approval route that calls Prospect Pipeline-owned helper logic.
7. Local n8n workflow import/setup, no Docker.
7. End-to-end verification with dry-run request before live mutation.
