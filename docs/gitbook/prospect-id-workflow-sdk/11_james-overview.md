# James Overview

This section lays out the practical case for a small workflow pilot: improve the website/API structure around the daily actions that already drive appointments, video progress, and customer follow-up.

## Core idea

James, the useful pattern here is on the workflow side. Marketing can create more demand, but if internal workflows stay manual, Prospect ID also creates more cleanup.

Drew Nickles' growth handoff was a helpful model for organizing a lot of moving parts into one operating plan: resources, phases, tracking, technical requirements, QA, and deliverables. This applies that same structure to Prospect ID's internal workflow layer.

The simple thesis:

> Marketing creates demand. Workflow systems create capacity.

This GitBook shows what a small Prospect ID workflow contract upgrade could look like. It is not a rebuild of the site. It is a cleaner JSON structure around the highest-friction workflows already repeated every day.

## Current drag

- calendar availability takes too many clicks
- meeting set and confirmation are split across steps
- Video Progress exists, but manual updates fall off when editing volume is high
- customer requests arrive as raw intent and need interpretation

The issue is not that each task is hard. It is that the operator keeps re-entering context the system already has somewhere.

## Clean workflow

Before the system creates or routes work, it should know the athlete, main profile, sport/profile, contact, triggering task/message/event, workflow type, and current status.

That gives us this cleaner pattern:

```text
customer/operator action -> workflow key resolves context -> system updates/routes -> operator handles exceptions
```

## Appointment setting workflow

For appointment setting, the first pilot can be small: show open slots, submit the selected meeting, update stage/task, and copy the confirmation text.

Endpoint contracts that make this easier:

- `GET /api/scout/tasks`
- `GET /api/calendar/open-slots`
- `GET /api/meetings/context`
- `POST /api/meetings/set`
- `POST /api/sales/stage`

This supports the revenue side directly because setters spend less time navigating and more time setting meetings.

## Video progress workflow

For video, the first pilot is even simpler: progress should update when the editor submits or edits the video, not as a separate manual maintenance step.

Endpoint contracts that make this easier:

- `POST /api/videos/submit`
- `POST /api/videos/progress-stage`
- `POST /api/videos/progress-status`
- `POST /api/videos/progress-action`

This keeps editors fast while giving management better status visibility.

## Why this is a focused backend ask

This is not a vague rebuild request. The ask is a short endpoint priority list for selected workflows that should return stable JSON and stable IDs first.

Priority contracts:

- `calendar/open-slots`
- `meeting/context`
- `meeting/set`
- `sales/stage`
- `athlete/resolve`
- `video/progress-action`
- `workflow/resolve`

## Pilot ask

I am asking to pilot one appointment-setting workflow and one video/customer workflow. We can measure clicks saved, time saved, missing status reduction, and how many items still need manual review. If the pilot does not create measurable lift, we stop there. If it does, we have a cleaner scaling path and a better way to prioritize backend work.
