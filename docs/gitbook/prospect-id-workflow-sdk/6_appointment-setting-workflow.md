# Appointment Setting Workflow

Appointment setting is revenue-facing. The workflow should make it easier to move from call outcome to meeting set, confirmation copy, and updated task/stage state.

## What this solves

The current workflow is split across too many steps:

- find the right athlete and profile
- check the current task and stage
- find open scout slots
- submit meeting details
- update sales stage or task state
- prepare confirmation copy
- keep follow-up work clean

The cleaner workflow:

```text
call outcome -> resolve athlete and meeting context -> choose slot -> submit meeting -> return confirmation and next action
```

## Endpoint contracts that make this easier

| Endpoint | What it should solve |
| --- | --- |
| `GET /api/scout/tasks` | Return the current task list with stable athlete and task identifiers. |
| `GET /api/scout/recent-profiles` | Return recent profiles with the IDs needed to continue work. |
| `GET /api/sales/stages/{athlete_id}` | Return available sales stages and the selected current stage. |
| `POST /api/sales/stage` | Update sales stage from a JSON body and return the resulting state. |
| `GET /api/meetings/template` | Return the meeting fields needed to submit cleanly. |
| `POST /api/meetings/set` | Submit the selected meeting and return task, stage, and confirmation state. |
| `GET /api/calendar/open-slots` | Return filtered open meeting slots. |
| `GET /api/calendar/booked-meetings` | Return booked meeting context for confirmation and follow-up. |
| `POST /api/tasks/update` | Update task details from a JSON body. |
| `POST /api/tasks/complete` | Complete the task and return the updated state. |

## Example: update sales stage

```json
{
  "athlete_main_id": "941787",
  "athlete_id": "1462822",
  "stage": "Meeting Set"
}
```

## Example: set meeting

```http
POST /api/meetings/set
Accept: application/json
Content-Type: application/json
```

```json
{
  "athlete_id": "1462822",
  "athlete_main_id": "941787",
  "meeting_name": "Prospect ID Evaluation",
  "meeting_timezone": "America/New_York",
  "assigned_to": "1408164",
  "open_event_id": "event_123",
  "task_description": "Meeting set from appointment-setting workflow.",
  "start_time": "2026-05-15 16:00:00",
  "meeting_length": "01:00",
  "template_id": "210"
}
```

Expected response:

```json
{
  "success": true,
  "workflow_key": "meeting_set:athlete_1462822:main_941787:event_123",
  "status": "meeting_set",
  "data": {
    "sales_stage": "Meeting Set",
    "task_status": "completed",
    "meeting_event_id": "event_123",
    "confirmation_text": "Hi [Parent Name], this is Prospect ID confirming [Athlete Name]'s evaluation with [Scout Name] for [Day] at [Time] [Timezone]. Please reply YES to confirm."
  },
  "next_actions": ["copy_confirmation", "record_follow_up"],
  "errors": []
}
```

## Before and after

| Workflow | Current friction | JSON contract result |
| --- | --- | --- |
| Open slots | Calendar availability requires extra navigation. | Open slots return as filterable JSON. |
| Meeting set | Meeting details, stage update, and confirmation are separate steps. | Meeting submission returns updated stage, task, and confirmation text. |
| Confirmation | Confirmation copy is manually assembled. | Confirmation text returns with resolved meeting context. |
| Needs review | Conflicts are mixed into normal work. | Only missing IDs, profile ambiguity, or owner conflicts return `needs_review`. |

## Pilot success checks

- Only available slots display.
- Selected slot matches the calendar.
- Parent name, athlete name, scout, date, time, and timezone resolve correctly.
- Stage/task state updates after appointment submission.
- Confirmation text is returned from the workflow response.
- Manual review is reserved for real conflicts.

