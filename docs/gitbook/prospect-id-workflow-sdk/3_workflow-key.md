# Workflow Key

{% hint style="info" %}
**Pilot:** The workflow key is the smallest shared idea that lets Prospect ID route work without making the operator infer the same context over and over.
{% endhint %}

## Plain English

Before creating or routing work, the system should know:

- the athlete
- the main athlete profile
- the sport/profile
- the parent or contact
- the triggering message, thread, task, event, or submission
- the workflow type
- the current workflow status

## Shape

```text
workflow_key =
  athlete_id
  + athlete_main_id
  + profile_id_or_sport_id
  + contact_id
  + message_id_or_thread_id
  + workflow_type
  + workflow_status
```

## Example

```json
{
  "success": true,
  "workflow_key": "customer_video:athlete_123:main_456:football:submission_789",
  "athlete_id": "123",
  "athlete_main_id": "456",
  "sport_id": "football",
  "contact_id": "parent_1",
  "workflow_type": "customer_video_intake",
  "workflow_status": "new",
  "route_to": "assigned_owner",
  "next_actions": ["review", "reply", "mark_handled"],
  "errors": []
}
```

## Why this fixes real drag

| Workflow | Key fields | What it enables |
| --- | --- | --- |
| Appointment setting | `athlete_id`, `athlete_main_id`, `task_id`, `sales_stage`, `meeting_event_id`, `assigned_owner` | Cleaner meeting-set and confirmation flow. |
| Video progress | `athlete_id`, `athlete_main_id`, `sport/profile`, `video_message_id`, `video_request_id`, `stage`, `status` | Submit/edit actions update progress without extra manual page work. |
| Customer intake | `athlete_id`, `athlete_main_id`, `sport/profile`, `contact_id`, `submission_id/thread_id`, `issue_type`, `resolution_status` | Customer requests route cleanly to the right owner or review queue. |

## Manual review rule

The operator should step in only when there is a real conflict:

- dual-sport/profile ambiguity
- missing athlete identity
- missing contact identity
- conflicting owner proof
- duplicate submission
- website access or permission failure
