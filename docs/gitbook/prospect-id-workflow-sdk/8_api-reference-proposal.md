# API Reference Proposal

This is a neutral first proposal for Prospect ID website endpoints that accept JSON requests and return JSON responses.

## Website JSON contract

Selected website workflow endpoints should support:

```http
Accept: application/json
Content-Type: application/json
```

The pilot should verify both headers on the exact endpoints being tested.

## Proposed workflow endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/workflow/resolve` | Resolve workflow key, identity, status, and next actions. |
| `GET` | `/api/calendar/open-slots` | Return filtered open meeting slots. |
| `GET` | `/api/meetings/context` | Return parent, athlete, scout, date, time, timezone, and approved confirmation copy. |
| `POST` | `/api/meetings/set` | Submit selected meeting details and return updated workflow state. |
| `POST` | `/api/sales/stage` | Update official sales stage and return the resulting state. |
| `POST` | `/api/videos/progress-action` | Run video submit/edit progress update chain. |
| `POST` | `/api/customer/video-action` | Convert customer-selected video action into a structured work item. |

## Shared response envelope

```json
{
  "success": true,
  "workflow_key": "string",
  "status": "string",
  "data": {},
  "next_actions": [],
  "errors": []
}
```

## Workflow resolve

```http
POST /api/workflow/resolve
```

```json
{
  "athlete_id": "123",
  "athlete_main_id": "456",
  "workflow_type": "meeting_set"
}
```

```json
{
  "success": true,
  "workflow_key": "meeting_set:athlete_123:main_456:football",
  "status": "ready",
  "data": {
    "athlete_id": "123",
    "athlete_main_id": "456",
    "sport_id": "football"
  },
  "next_actions": ["open_slots", "set_meeting", "copy_confirmation"],
  "errors": []
}
```

## Meeting set

```http
POST /api/meetings/set
```

```json
{
  "athlete_id": "123",
  "athlete_main_id": "456",
  "open_slot_id": "slot_789",
  "meeting_timezone": "America/New_York"
}
```

```json
{
  "success": true,
  "workflow_key": "meeting_set:athlete_123:main_456:slot_789",
  "status": "meeting_set",
  "data": {
    "meeting_id": "meeting_789",
    "sales_stage": "Meeting Set",
    "confirmation_text": "Hi [Parent Name], this is Prospect ID confirming [Athlete Name]'s evaluation with [Scout Name] for [Day] at [Time] [Timezone]. Please reply YES to confirm."
  },
  "next_actions": ["copy_confirmation", "record_follow_up"],
  "errors": []
}
```

## Video progress action

```http
POST /api/videos/progress-action
```

```json
{
  "action": "video_submitted",
  "athlete_id": "123",
  "athlete_main_id": "456",
  "video_message_id": "message_789",
  "video_url": "https://example.com/video"
}
```

```json
{
  "success": true,
  "workflow_key": "video_progress:athlete_123:main_456:message_789",
  "status": "updated",
  "data": {
    "stage": "Done",
    "video_status": "HUDL",
    "handled_state": "video_submitted"
  },
  "next_actions": ["prepare_customer_update"],
  "errors": []
}
```

