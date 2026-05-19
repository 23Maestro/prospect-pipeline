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
- the active request or task
- the workflow type
- the current workflow status

## Shape

```text
workflow_key =
  athlete_id
  + athlete_main_id
  + profile_id
  + sport_id
  + contact_id
  + message_id_or_thread_id
  + video_request_id_or_task_id
  + workflow_type
  + workflow_status
```

## Example

```json
{
  "success": true,
  "workflow_key": "video_inbox_resolution:athlete_123:main_456:profile_12:sport_football:contact_parent_1:thread_789:video_request_456:open",
  "status": "open",
  "data": {
    "athlete_id": "123",
    "athlete_main_id": "456",
    "profile_id": "profile_12",
    "sport_id": "football",
    "contact_id": "parent_1",
    "message_id": null,
    "thread_id": "thread_789",
    "video_request_id": "video_request_456",
    "workflow_type": "video_inbox_resolution",
    "workflow_status": "open",
    "route_to": "assigned_owner"
  },
  "next_actions": ["review", "reply", "mark_handled"],
  "errors": []
}
```

```json
{
  "success": true,
  "workflow_key": "video_inbox_resolution:athlete_123:main_456:profile_12:sport_football:contact_parent_1:thread_789:video_request_456:completed",
  "status": "completed",
  "data": {
    "athlete_id": "123",
    "athlete_main_id": "456",
    "profile_id": "profile_12",
    "sport_id": "football",
    "contact_id": "parent_1",
    "message_id": null,
    "thread_id": "thread_789",
    "video_request_id": "video_request_456",
    "workflow_type": "video_inbox_resolution",
    "workflow_status": "completed",
    "route_to": "history"
  },
  "next_actions": ["suppress_assignment", "mark_archived"],
  "errors": []
}
```

```json
{
  "success": false,
  "workflow_key": null,
  "status": "needs_review",
  "data": {
    "athlete_id": "123",
    "athlete_main_id": "456",
    "contact_id": "parent_1",
    "thread_id": "thread_789",
    "candidate_profiles": [
      {
        "profile_id": "profile_12",
        "sport_id": "football"
      },
      {
        "profile_id": "profile_34",
        "sport_id": "baseball"
      }
    ]
  },
  "next_actions": ["select_sport_profile"],
  "errors": [
    {
      "code": "sport_profile_ambiguous",
      "message": "Contact and athlete resolved, but sport/profile requires selection."
    }
  ]
}
```

## Why this fixes real drag

| Workflow | Key fields | What it enables |
| --- | --- | --- |
| Appointment setting | `athlete_id`, `athlete_main_id`, `task_id`, `sales_stage`, `meeting_event_id`, `assigned_owner` | Cleaner meeting-set and confirmation flow. |
| Video progress | `athlete_id`, `athlete_main_id`, `sport/profile`, `video_message_id`, `video_request_id`, `stage`, `status` | Submit/edit actions update progress without extra manual page work. |
| Customer intake | `athlete_id`, `athlete_main_id`, `sport/profile`, `contact_id`, `submission_id/thread_id`, `issue_type`, `resolution_status` | Customer requests route cleanly to the right owner or review queue. |
| Video Inbox resolution | `athlete_id`, `athlete_main_id`, `profile_id`, `sport_id`, `contact_id`, `message_id/thread_id`, `video_request_id`, `workflow_status` | Family messages attach to one video request. Completed threads stay suppressed. Dual-sport conflicts only ask for sport/profile selection. |

## Manual review rule

The operator should step in only when there is a real conflict:

- dual-sport/profile ambiguity
- missing athlete identity
- missing contact identity
- conflicting owner proof
- duplicate submission
- website access or permission failure
