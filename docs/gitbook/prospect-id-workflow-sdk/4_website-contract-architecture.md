# Website Contract Architecture

The proposal is simple: keep the existing backend, but modernize selected workflow contracts so they accept JSON and return predictable JSON.

## Contract model

```text
Website workflow action
  -> JSON request
  -> legacy backend action
  -> JSON response
  -> operator or customer sees the next correct step
```

## Contract responsibilities

| Responsibility | Requirement |
| --- | --- |
| Request format | Workflow endpoints accept `Content-Type: application/json`. |
| Response format | Workflow endpoints return JSON when `Accept: application/json` is sent. |
| Stable identity | Responses include stable IDs such as athlete, athlete main profile, contact, task, message, meeting, or submission IDs. |
| Workflow status | Responses include the current status and the next valid actions. |
| Error handling | Failures return structured JSON errors, not HTML pages or unclear redirects. |
| Compatibility | Existing backend behavior can remain in place while selected endpoints get modern contracts. |

## Why this is enough for a pilot

The first pilot does not require the entire website to change. It only requires a few high-value actions to behave consistently:

- resolve workflow context
- return open meeting slots
- submit a selected meeting
- update sales stage or task state
- update video progress after submit/edit actions
- ingest structured customer video requests

## Desired response pattern

```json
{
  "success": true,
  "workflow_key": "meeting_set:athlete_123:main_456:event_789",
  "athlete_id": "123",
  "athlete_main_id": "456",
  "status": "ready",
  "next_actions": ["submit_meeting", "copy_confirmation"],
  "errors": []
}
```

## Design rule

Each endpoint should answer one workflow question:

| Question | Example contract |
| --- | --- |
| Who is this work for? | `POST /api/workflow/resolve` |
| What meeting slots are available? | `GET /api/calendar/open-slots` |
| Can this meeting be submitted? | `POST /api/meetings/set` |
| What confirmation should be sent? | `GET /api/meetings/context` |
| Did video progress update? | `POST /api/videos/progress-action` |
| Can this customer request be routed? | `POST /api/customer/video-action` |

