# Endpoint Priority List

The first endpoint list should stay small. Each endpoint should solve a daily workflow problem.

## Minimum technical requirement

Selected workflow endpoints should return consistent JSON and stable IDs.

```http
Accept: application/json
Content-Type: application/json
```

Every pilot response should include:

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

## Priority endpoints

| Endpoint group | Purpose | Phase |
| --- | --- | --- |
| `calendar/open-slots` | Return filtered open meeting slots without manual calendar navigation. | 1 |
| `meeting/context` | Return parent, athlete, scout, date, time, timezone, and confirmation copy. | 1 |
| `meeting/set` | Submit selected appointment details and return updated task/stage state. | 1 |
| `sales/stage` | Update stage after appointment-setting actions. | 1 |
| `athlete/resolve` | Resolve athlete, main profile, sport/profile, and contacts. | 1 |
| `video/progress-action` | Run submit/edit progress update chains. | 2 |
| `customer/video-action` | Create a structured customer video request from selected intent. | 2 |
| `workflow/resolve` | Return workflow key, current status, and next action options. | 2 |

## Why this is a smaller backend ask

The ask is not "rebuild Prospect ID."

The ask is:

- expose selected high-friction actions as JSON
- return stable identity fields
- make route results testable
- return clear next actions
- return structured errors when the workflow needs manual review

## Endpoint design rule

Each endpoint should answer one workflow question:

| Question | Endpoint direction |
| --- | --- |
| Who is this work for? | `workflow/resolve` |
| What open meeting slots are usable? | `calendar/open-slots` |
| What copy should be sent? | `meeting/context` |
| Can we submit the selected meeting? | `meeting/set` |
| Did the official CRM stage update? | `sales/stage` |
| Did video progress update? | `video/progress-action` |
| Can this customer request be routed without guessing? | `customer/video-action` |

