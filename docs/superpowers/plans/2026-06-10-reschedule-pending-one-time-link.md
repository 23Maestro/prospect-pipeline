# Reschedule Pending One-Time Link Plan

Date: 2026-06-10

## Bucket Classification

Primary bucket: Meetings.

Supporting buckets:

- Client Communication: sending the parent-facing reschedule link and copy.
- Enrollments & Outcomes: only for the existing `Meeting Result - Res. Pending` state that starts the recovery path.
- Admin Data & Contacts: only for recipient phone/name context already resolved by Scout Prep or Set Meetings.

Commands stay UI buttons. Slot selection, previous meeting context, and reschedule timing stay in the Meetings bucket. Supabase stores the parent intent and audit state. FastAPI/Laravel remains a source-system adapter and should only apply the selected slot after human approval in V1.

## Goal

Create a later implementation path for a Reschedule Pending recovery workflow:

1. Operator starts from an existing Reschedule Pending meeting/task.
2. System fetches live head scout openings at request creation time.
3. System freezes up to 3 proposed slots for the same original head scout.
4. Parent receives a signed one-time link.
5. Parent chooses one of the proposed slots or `None of these work`.
6. Supabase logs the selected intent.
7. Human reviews and applies the reschedule through the existing legacy FastAPI/Laravel path.

This is not a public live scheduler. It is a clean parent-intent intake surface.

## Product Rules

- Focus on Reschedule Pending first. No Show should be a separate later workflow with different copy and stricter recovery rules.
- Keep the original head scout by default. If the family booked with Ryan, show Ryan's slots only.
- Show 3 slots max, not a broad calendar.
- Always include `None of these work`.
- Prefer similar time-of-day to the prior meeting when possible.
- If the request is created late week, choose soonest reasonable same-scout options from the next few days or next week.
- Do not let the public page mutate Laravel, appointment truth, lifecycle, or calendar state directly.
- Store real slot identity behind the display label.
- Treat selected slot as intent until a human applies it.

## Request Row Shape

Create a durable request table or equivalent Supabase surface for parent intent.

Suggested fields:

- `id`
- `appointment_id`
- `athlete_id`
- `athlete_main_id`
- `athlete_name`
- `recipient_name`
- `recipient_phone`
- `original_head_scout_name`
- `original_head_scout_owner_key`
- `original_meeting_starts_at`
- `original_meeting_timezone`
- `request_status`: `open`, `selected`, `none_work`, `expired`, `canceled`, `applied`
- `token_hash`
- `expires_at`
- `used_at`
- `selected_option_id`
- `selected_at`
- `source`: likely `reschedule_pending_link`
- `created_by_operator_key`
- `created_at`
- `updated_at`
- `payload_json`

Each proposed option should store:

- `option_id`
- `open_event_id`
- `head_scout_name`
- `calendar_owner_id`
- `meeting_for`
- `starts_at`
- `ends_at`
- `timezone`
- `timezone_label`
- `display_label`
- `source_payload`

## Signed One-Time Link

Generate a random token at request creation time. Store only a hash of the token in Supabase.

Parent URL shape:

```text
/reschedule/:request_id?token=<random-token>
```

Validation rules:

- Hash the provided token server-side.
- Compare to `token_hash`.
- Require `request_status = open`.
- Require `used_at IS NULL`.
- Require `expires_at > now()`.
- Mark `used_at` on successful selection.
- If already used or expired, show a clear non-mutating fallback state.

Token validation must happen server-side, such as in a Vercel route handler. Browser code must not receive Supabase service credentials or token secrets.

## Architecture

### Creation Flow

Operator action:

```text
Set Meetings / Scout Prep
→ Send Reschedule Link
→ existing slot resolver fetches openings
→ choose 3 same-scout proposed slots
→ create signed request row
→ send parent link via existing Client Communication path
```

### Parent Flow

Parent page:

```text
GET /reschedule/:request_id?token=...
→ validate token server-side
→ render stored proposed slots
→ parent selects one slot or None of these work
→ POST submit
→ validate token again
→ mark request selected/none_work
→ return simple confirmation screen
```

### Operator Apply Flow

Human review:

```text
Review selected request
→ verify chosen slot is still available
→ apply through existing reschedule translator
→ mark request applied
→ optionally send confirmation text
```

The apply step should reuse the existing Reschedule Pending surfaces:

- `GET /sales/reschedule-meeting-template`
- `POST /sales/reschedule-meeting`
- existing `recordRescheduled(...)` / lifecycle behavior where applicable

## Initial Implementation Slices

1. Request schema and token contract.
   - Add Supabase migration/test for request rows and proposed options.
   - Add token hash helpers with focused unit tests.
   - No Laravel mutation.

2. Slot proposal builder.
   - Reuse the existing reschedule outreach slot-selection idea.
   - Input: previous appointment/head scout/timezone plus available openings.
   - Output: max 3 same-scout options plus `None of these work`.
   - Add pure tests for same-scout filtering, time-of-day preference, late-week next-week behavior, and max-3 cap.

3. Vercel parent page and API routes.
   - Add public page for request display.
   - Add server routes for validate/submit.
   - Keep all Supabase service writes server-side.
   - Submit writes intent only.

4. Operator review surface.
   - Add a narrow review action in the existing Set Meetings / Scout Prep context.
   - Show selected slot, original meeting, family contact, and request status.
   - Do not auto-apply.

5. Human-approved apply.
   - Reuse existing FastAPI/Laravel reschedule translator.
   - Verify selected slot is still valid before submit.
   - Mark request `applied` only after adapter success.
   - Send optional confirmation after apply, not before.

## Open Questions

- Exact expiration window: likely 24-48 hours for Reschedule Pending.
- Whether `None of these work` should create a Client Messages follow-up row, email, or Raycast queue item first.
- Whether selected-but-unapplied requests should appear in Set Meetings, Scout Prep, or a small Prospect Web operator page.
- Whether same-head-scout fallback should ever show another head scout in V1. Default answer: no.
- Whether slot availability should be rechecked on parent submit or only on human apply. Default answer: human apply only for V1.

## Proof Plan

Focused tests:

- Token validation helper tests.
- Request status transition tests.
- Slot proposal selection tests.
- Vercel route tests for expired, used, invalid, selected, and `None of these work`.
- Static guard proving browser files do not contain Supabase service env names or token secrets.

Live proof later:

- Create one dry-run request from a known Reschedule Pending meeting.
- Open parent link and select a slot.
- Confirm Supabase row changes from `open` to `selected`.
- Confirm no Laravel mutation happens before human apply.
- Apply one request manually through the existing reschedule translator and verify the admin/readback result.
