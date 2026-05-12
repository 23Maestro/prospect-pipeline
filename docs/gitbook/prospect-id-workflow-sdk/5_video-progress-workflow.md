# Video Progress Workflow

Video progress should update from the same actions editors already take: submit, revise, update, or mark a video as complete.

## What this solves

Video Progress is useful, but manual updating can fall behind actual editing work. When status updates are separate from submit/edit actions, management visibility depends on someone remembering an extra step.

The cleaner workflow:

```text
video submit/edit action -> resolve athlete and video context -> update progress -> return next action
```

## Endpoint contracts that make this easier

| Endpoint | What it should solve |
| --- | --- |
| `POST /api/videos/submit` | Submit a video and return the athlete, video, stage, and next action state. |
| `POST /api/videos/progress-stage` | Update progress stage from a JSON body. |
| `POST /api/videos/progress-status` | Update progress status from a JSON body. |
| `POST /api/videos/due-date` | Update due date and return the updated task state. |
| `GET /api/videos/edit-context` | Return the current video/edit context needed before changing a video. |
| `POST /api/videos/update` | Update an existing video and return progress/customer-update context. |
| `POST /api/videos/remove` | Remove or unapprove a video and return the resulting workflow state. |
| `POST /api/videos/progress-action` | Run the full submit/edit progress update chain from one action. |

## Example: submit video

```json
{
  "athlete_id": "1462822",
  "athlete_main_id": "941787",
  "video_url": "https://youtu.be/Z0sLZz_Dlfs",
  "video_type": "Full Season Highlight",
  "season": "highschool:16137",
  "season_type": "senior",
  "source": "youtube",
  "auto_approve": true,
  "sport": "football"
}
```

## Example: progress action

```http
POST /api/videos/progress-action
Accept: application/json
Content-Type: application/json
```

```json
{
  "action": "video_submitted",
  "athlete_id": "1462822",
  "athlete_main_id": "941787",
  "video_message_id": "11875",
  "video_url": "https://youtu.be/Z0sLZz_Dlfs",
  "video_type": "Full Season Highlight",
  "season": "highschool:16137",
  "sport_id": "football"
}
```

Expected response:

```json
{
  "success": true,
  "workflow_key": "video_progress:athlete_1462822:main_941787:football:message_11875",
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

## Before and after

| Moment | Current drag | JSON contract result |
| --- | --- | --- |
| Video Submitted | Progress needs a separate status update. | Submit action returns updated progress state. |
| Revision Submitted | Revision context can be disconnected from progress status. | Revision action updates status and returns customer-update context. |
| Video Updated | Status depends on manual follow-up. | Update action refreshes progress and returns next action. |
| No Edit Needed | Finalization can become another manual interpretation step. | Finalization returns handled state and next action. |

## Pilot success checks

- Progress updates from submit/edit actions.
- Missing status count decreases.
- Editors do not need an extra manual maintenance step.
- Management gets cleaner status from the workflow response.

