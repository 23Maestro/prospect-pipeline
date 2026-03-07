### Thin Inbox ID Resolution Cleanup (`read-videoteam-inbox.tsx`)

#### Summary
Refactor `read-videoteam-inbox` to follow a strict model:
- Inbox display uses thread/message fields only.
- ID resolution happens only when an action needs it.
- `athlete_main_id` is late-bound via `ensureAthleteIds`, not preloaded.

#### Implementation Changes
- In [`/Users/singleton23/Raycast/prospect-pipeline/src/read-videoteam-inbox.tsx`](/Users/singleton23/Raycast/prospect-pipeline/src/read-videoteam-inbox.tsx):
  - Remove eager “ID hydration” behavior that runs on detail open just to populate `contactId`/`athleteMainId`.
  - Keep detail fetch for content/timestamp/attachments only.
  - Replace multi-path ID logic with one action-time flow:
    1. Resolve `contact_id` from `message.contact_id` first.
    2. If missing, reuse already-fetched detail payload (if present).
    3. If still missing, perform one fallback `fetchMessageDetail` call.
  - Make `ensureAthleteIds(contactId, knownMainId?)` the only place that resolves `athlete_main_id`.
  - Remove deprecated seed/fallback helpers that duplicate resolution (`resolveAthleteIdentifiers`-driven state setup and repeated detail ID re-fetch paths).
- Keep all existing Action Panel capabilities (View/Add Note, Update Stage, Upload, Quick Links) and their guardrails/messages unchanged.

#### Tests / Validation
- Manual validation in Raycast command:
  1. Load assigned inbox list; confirm list renders without ID dependency regressions.
  2. Open a message with thread IDs present; run View Notes, Add Note, Upload Video.
  3. Open a message with missing thread IDs; confirm action-time fallback still resolves or fails with existing clear toasts.
  4. Verify Update Stage still requires `video_msg_id` and behaves unchanged.
  5. Verify Quick Links still open correctly when `contact_id` is available.
- Regression check:
  - No extra detail fetch loops per action (one fallback max when IDs absent).
  - No change to reply/send behavior.

#### Public Interfaces / API Impact
- No FastAPI contract changes.
- No schema/type changes required.
- Frontend behavior change is internal: ID resolution timing only.

#### Assumptions
- `contact_id` remains the actionable alias for inbox-to-athlete operations.
- `ensureAthleteIds` remains the canonical resolver for `athlete_main_id`.
- Preserving existing user-facing actions and toasts is higher priority than aggressive feature removal.
