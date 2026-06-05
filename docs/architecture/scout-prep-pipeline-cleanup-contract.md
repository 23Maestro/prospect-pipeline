# Scout Prep Pipeline Cleanup Contract

This is the plain-language rule for when a client leaves the active pipeline.

## What "deleted" means

Deleted from the pipeline means: remove the athlete from the active work list.

It does not mean: erase history. We keep history rows, meeting outcome facts, and audit rows so reporting still knows what happened.

When a client is done, the active row should end. The contact cache should stop acting like that family is still an active client.

## General pipeline logic

Keep the client active when the stage means there is still work to do:

- New Opportunity
- call attempts and voicemail stages
- Meeting Set
- Rescheduled
- Reschedule Pending
- Actual Meeting - Follow Up
- Meeting Result - No Show, while it is still recent

Delete the client from the active pipeline when the stage means the work is over:

- Actual Meeting - Close Won
- Actual Meeting - Close Lost
- Inactive
- Dead Lead
- Archived
- Spoke to - Not Interested
- Spoke to - Too Young

In 7th grade language: if there is still a real next step, keep them. If the answer is yes, no, too young, dead, archived, or not interested, they leave the active pipeline.

## Post-meeting logic

After a meeting ends, the meeting must get an ending.

If the event title or CRM stage says the final result, delete the active pipeline row right away:

- `(ENR)` or Close Won means the client bought. End the pipeline.
- `(CL)` or Close Lost means the client did not buy. End the pipeline.
- `(FU)` or Actual Meeting - Follow Up means the meeting moved into follow-up. Remove it from active meeting work.
- `(NS)` or No Show means the meeting is no longer active. Remove it from active meeting work.
- `(CAN)` or Canceled means the meeting is no longer active. Remove it from active meeting work.

If there is no clear event prefix yet, use the age rule:

- No Show: keep it for up to 7 days, then delete from the active pipeline.
- Follow Up: keep it for up to 7 days, then delete from the active pipeline.
- Reschedule Pending: keep it if there is a future booked meeting. If there is no future booked meeting, delete after 21 days.
- Canceled: keep it for up to 21 days, then delete from the active pipeline.
- Never Spoke To / Call Attempt 3: delete after 3 days.

In 7th grade language: after the meeting, do not let the person sit forever. If the result is known, end it now. If the result is waiting, give it a short window, then end it.

## What other tables should do

Latest `lifecycle_events` is the active lifecycle projection. This is how the system knows whether the client is still in active work.

`athlete_contact_cache` is the lookup cache for message/contact routing. When the client is over, cache rows should be marked inactive instead of being used as active client-message matches.

`set_meeting_confirmation_cache` is only for confirmation message prep. It must not decide whether the client is active.

`lifecycle_events` and `call_log` rows are history. They stay because they explain what happened.

## Current enforcement note

The general stage rule is enforced by `resolveSalesLifecycle`.

The post-meeting cleanup rule is enforced by action-time Scout Prep writes and the scheduled current-pipeline sync lane. There is no normal current-sales-stage reconciler writer.

Contact cache soft-inactivation is enforced by Scout Prep contact-cache sync when a terminal CRM stage is known.

That keeps lifecycle truth and active contact-cache rows tied to source-owned stage evidence instead of a background reconciler guess.
