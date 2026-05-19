# Pilot Plan

{% hint style="success" %}
**Pilot ask for James:** Approve one appointment-setting workflow and one video/customer workflow. Measure before and after. Do not ask for a platform rebuild.
{% endhint %}

## Goal

Prove that stable JSON workflow endpoints reduce daily operational drag and give Prospect ID a practical way to scale the work already happening in sales, scouting, video, and customer follow-up.

## Pilot 1: Appointment setting

### Current drag

- Calendar availability takes multiple clicks and page loads.
- Meeting details, stage update, and confirmation copy are separate steps.
- Confirmation text is repetitive and manually formatted.

### Pilot workflow

```text
task -> resolve athlete/context -> show open slots -> submit meeting -> return stage/task/confirmation state
```

### Endpoint mix

| Piece | Contract |
| --- | --- |
| Task list | `GET /api/scout/tasks` |
| Open slots | `GET /api/calendar/open-slots` |
| Meeting context | `GET /api/meetings/context` |
| Meeting set | `POST /api/meetings/set` |
| Sales stage update | `POST /api/sales/stage` |

### Metrics

- clicks and time required to find an open slot
- time from call outcome to meeting set
- confirmation text copied/sent
- task/stage updated correctly
- number of items needing manual review

## Pilot 2: Video progress

### Current drag

Video Progress is useful, but manual updates fall off when editors are moving fast.

### Pilot workflow

```text
video submit/edit -> resolve athlete/video context -> update stage/status -> return handled state
```

### Endpoint mix

| Piece | Contract |
| --- | --- |
| Submit video | `POST /api/videos/submit` |
| Update stage | `POST /api/videos/progress-stage` |
| Update status | `POST /api/videos/progress-status` |
| Edit/update context | `GET /api/videos/edit-context` |
| Submit/edit progress action chain | `POST /api/videos/progress-action` |

### Metrics

- videos updated through submit/edit actions
- videos missing status after delivery
- number of manual progress patches
- editor time preserved
- management visibility improved

## Tracking

| Workflow | Before/after metric |
| --- | --- |
| Video Inbox duplicates | Count duplicate, reappearing, or wrong-profile inbox assignments before and after workflow-key resolution. |

## QA checklist

| Area | Success check |
| --- | --- |
| Open slots | Only available slots display, and selected slot matches the calendar. |
| Confirmation copy | Parent name, athlete name, scout, date, time, and timezone are correct. |
| Meeting set | Stage/task updates correctly after the appointment is submitted. |
| Video submit/edit | Progress updates from the button action and returns handled state. |
| Video Inbox resolution | Family messages attach to one request, completed threads do not recreate assignments, and dual-sport conflicts only prompt for sport/profile. |
| Customer intake | Customer-selected submissions create structured work items instead of raw interpretation. |
| Routing | Result routes to the assigned owner or review queue. |
| Review queue | Manual review appears only when the conflict is real. |

## Business value

| Value area | Outcome |
| --- | --- |
| Revenue operations | Appointment setters spend less time navigating and more time setting meetings. |
| Video operations | Editors stay fast while progress updates happen through natural submit/edit actions. |
| Customer experience | Parents submit clearer requests and receive cleaner follow-up paths. |
| Management visibility | Status comes from workflow data instead of manual patching. |
| Development focus | Backend asks become smaller, clearer, and easier to test. |
| Scale | Marketing volume can increase without multiplying the same manual cleanup. |
