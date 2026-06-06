# Scouting Command Raycast Mutation Contract

Scouting Command must wrap working Scout Prep behavior. It must not create a second process for lifecycle, task status, CRM stage, notes, or meeting truth.

For Scout Prep home/detail layout and action-panel organization, pair this with `docs/architecture/scouting-command-ui-contract.md`.

## Rule

For every Mac app write action:

1. Name the matching Raycast Scout Prep action.
2. Use the Prospect Pipeline helper or domain that Raycast uses.
3. Pass the same operator intent fields.
4. Let Prospect Pipeline own Laravel/FastAPI payloads and Supabase writes.
5. If the Raycast path has not been traced, keep the Mac surface read-only.

## Current Write Paths

### Client Outreach

Raycast source:

- `src/scout-prep.tsx` `ScoutPrepTaskItem.handleClientOutreach`
- `src/scout-prep.tsx` `ScoutPrepDetail.handleClientOutreach`
- Recipient/domain helpers: `getVoicemailFollowUpRecipients`, `buildVoicemailFollowUpBody`, `buildMessagesComposeUrlForRecipients`

Operator fields:

- selected Scout Prep task
- current Scout Prep context
- current task title/status for voicemail variant selection

Source behavior:

- load selected task context
- resolve voicemail follow-up recipients
- open a Messages draft for the selected recipient/body path

Mac rule:

- The primary `Client Outreach` button must operate on the selected Scout Prep task/context.
- It must not route to generic Client Messages rows as a substitute for selected-task outreach.
- It may open a Messages draft through the same Prospect Pipeline recipient/body/url helpers.

### Create Call Reminder / Create Text Reminder

Raycast source:

- `src/scout-prep.tsx` `ScoutPrepDetail.handleCreateReminder`
- Helper: `src/lib/reminders.ts`

Operator fields:

- selected Scout Prep task
- current Scout Prep context
- reminder mode: `call` or `text`
- selected associated contact
- reminder date/time

Source behavior:

- resolve associated contacts from Scout Prep context
- build the Reminders draft with `buildReminderDraft`
- create the Reminders item with `createReminder`

Mac rule:

- The Mac app may expose `Create Call Reminder` and `Create Text Reminder` inside `Workflow`.
- It must call the Prospect Pipeline reminder helper path.
- Until the full recipient/date picker is lifted, the Mac app may use Raycast's default reminder time and first associated contact.

### Open MaxPreps Search

Raycast source:

- `src/scout-prep.tsx` `triggerMaxPrepsSearch`
- Helper: `src/lib/maxpreps-scout-context.ts` `buildMaxPrepsSearchLabel`

Operator fields:

- current Scout Prep context
- high school
- state
- sport

Source behavior:

- build the MaxPreps search label from Scout Prep context
- open the Keyboard Maestro `kmtrigger://` macro URL
- show `MaxPreps Search Sent`

Mac rule:

- The Mac app may expose `Open MaxPreps Search` inside `Athlete Info`.
- It must use `buildMaxPrepsSearchLabel` from Prospect Pipeline.
- It must not resolve, cache, or write MaxPreps context as part of this action.
- `Resolve MaxPreps Context` remains blocked until the cache/context update path from Raycast is lifted explicitly.

### Save Task Update

Raycast source:

- `src/scout-prep.tsx` `UpdateAthleteTaskForm.handleUpdate`
- Helper: `src/lib/scout-prep-task-update.ts` `updateScoutPrepTask`

Operator fields:

- `taskTitle`
- `description`
- `dueDate`
- `dueTime`
- optional `completeTask`

Source behavior:

- POST `/tasks/update`
- Then `lifecycleSalesStage` with task fields and `activitySubtype: 'needs_manual_review'`

Mac rule:

- The Mac app may collect task title, description, due date, and due time.
- It must call the same `updateScoutPrepTask` helper path.
- It must not interpret task title as CRM stage.

### Set Scheduled Follow-Up

Raycast source:

- `src/scout-prep.tsx` `UpdateAthleteTaskForm.handleSetScheduledFollowUp`
- Constant: `SCHEDULED_FOLLOW_UP`
- Helper: `src/lib/scout-prep-task-update.ts` `updateScoutPrepTask`

Operator fields:

- `taskTitle: 'SCHEDULED FOLLOW-UP'`
- `description`
- `dueDate`
- `dueTime`
- optional `completeTask`

Source behavior:

- Same as Save Task Update.

Mac rule:

- The Mac app may provide a `Set Scheduled Follow-Up` action.
- It must set the exact title `SCHEDULED FOLLOW-UP`.
- It must call the same task update helper.

### Complete Task

Raycast source:

- `src/scout-prep.tsx` `UpdateAthleteTaskForm.handleCompleteTask`
- Helper: `src/lib/scout-prep-task-completion.ts` `completeScoutPrepTaskAfterVoicemail`

Operator fields:

- `athleteId`
- `athleteMainId`
- `athleteName`
- `contactTask`
- `taskId`
- `taskTitle`
- `assignedOwner`
- `description`

Source behavior:

- POST `/tasks/complete`
- Then `lifecycleSalesStage`

Mac rule:

- Standalone Complete Task mirrors this exact helper.
- It must not create or choose an `Official Sales Stage`.
- It must omit `crmStage` from the Mac completion request, matching Raycast `completeScoutPrepTaskDirectly`.
- If a stage is involved, that is not standalone Complete Task; it is Post-Call Update.

### Post-Call Update

Raycast source:

- `src/scout-prep.tsx` `PostCallUpdateForm.handleSubmit`
- Domain: `src/domain/post-call-action.ts` `buildPostCallActionPlan`
- Stage helper: `src/lib/sales-stage.ts` `updateSalesStage`
- Task completion helper: `src/lib/scout-prep-task-completion.ts` `completeScoutPrepTaskAfterVoicemail`

Operator fields:

- `Official Sales Stage`
- current Scout Prep task context
- current athlete IDs
- meeting fields only when the selected stage requires meeting scheduling
- reschedule/cancel notes only when the selected stage requires post-meeting operator note fields

Source behavior:

- Build a `PostCallActionPlan`.
- POST `/sales/stage` through `updateSalesStage`.
- `updateSalesStage` handles the coupled `lifecycleSalesStage` write for non-Meeting Set stages.
- For Meeting Set, Raycast submits the meeting payload first, then writes meeting-set lifecycle/cache through Prospect Pipeline helpers.
- If the action plan selects a task to complete, Raycast calls `completeScoutPrepTaskAfterVoicemail` with `crmStage` from the official stage selected in the post-call form.

Mac rule:

- The Mac app must not bolt `crmStage` onto generic task completion.
- A Mac `Post-Call Update` surface must call a Prospect Pipeline helper that owns the full Raycast `PostCallUpdateForm` sequence.
- `src/lib/scout-prep-post-call-update.ts` owns the Scouting Command post-call writer.
- That helper calls `buildPostCallActionPlan`, `updateSalesStage`, and `completeScoutPrepTaskAfterVoicemail`.
- For `Meeting Set`, the Mac app must first load the Prospect Pipeline meeting form model, then submit meeting fields through the helper so the sequence remains: `submitMeetingSet` -> `updateSalesStage` -> `recordMeetingSet` -> `syncMeetingSetConfirmationCacheFromScoutPrep` -> optional task completion.
- Confirmed reschedule scheduling and post-meeting outcome stages must remain blocked in Scouting Command until the matching Raycast reschedule/note fields and helper sequence are lifted.

## Style Boundary

Asana, Raycast, and Prospect ID are UI references only:

- Raycast: command density, exact action labels, fast operator flow.
- Asana: list/detail organization, grouped task details, compact action area.
- Prospect ID: dense admin field spacing and CRM-style grouping.

They do not define business process, labels, source truth, or mutation behavior.
