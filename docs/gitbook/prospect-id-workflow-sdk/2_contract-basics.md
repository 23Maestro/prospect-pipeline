# Contract Basics

This page defines the minimum contract needed for the pilot.

## Required headers

```http
Accept: application/json
Content-Type: application/json
```

Both headers matter.

| Header | Why it matters |
| --- | --- |
| `Accept: application/json` | The caller is asking the website to return JSON. |
| `Content-Type: application/json` | The caller is sending a JSON body. |

If either side is missing, the route can still behave like an older form/page endpoint instead of a modern workflow endpoint.

## Standard response shape

Every pilot workflow should return a consistent envelope:

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

## Error response shape

```json
{
  "success": false,
  "workflow_key": null,
  "status": "needs_review",
  "data": {},
  "next_actions": ["review_manually"],
  "errors": [
    {
      "code": "missing_athlete_identity",
      "message": "The request could not be matched to a single athlete."
    }
  ]
}
```

## Example workflow resolve request

```http
POST /api/workflow/resolve
Accept: application/json
Content-Type: application/json
```

```json
{
  "athlete_id": "123",
  "athlete_main_id": "456",
  "workflow_type": "meeting_set",
  "source": "website"
}
```

## Example workflow resolve response

```json
{
  "success": true,
  "workflow_key": "meeting_set:athlete_123:main_456:football",
  "status": "ready",
  "data": {
    "athlete_id": "123",
    "athlete_main_id": "456",
    "sport_id": "football",
    "workflow_type": "meeting_set"
  },
  "next_actions": ["open_slots", "set_meeting", "copy_confirmation"],
  "errors": []
}
```

## Access control

Access control should follow the normal website permission model for logged-in users. It does not need to be the center of the pilot.

The pilot goal is consistent JSON behavior for selected workflow endpoints.

