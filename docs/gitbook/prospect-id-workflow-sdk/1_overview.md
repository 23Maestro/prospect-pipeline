# Prospect ID Workflow Contracts

Stable JSON contracts for high-value Prospect ID workflows.

## What this is

James, this is a concrete proposal for what Prospect ID should support next: selected website endpoints that accept `application/json` requests and return predictable JSON responses for the workflows operators already repeat every day.

> Marketing creates demand. Workflow systems create capacity.

That is the core thesis from the workflow scale audit. If lead volume, meeting volume, video volume, and customer questions grow while internal workflows stay manual, Prospect ID gets more demand and more cleanup at the same time.

The goal is to modernize the workflow contracts around the current backend, not rebuild the whole site.

## What should change

Selected website actions should have clear request and response contracts:

```http
Accept: application/json
Content-Type: application/json
```

Those endpoints should return stable identifiers, workflow status, next actions, and errors in JSON. That makes the workflows easier to build, test, automate, and improve without forcing operators to keep interpreting pages and re-entering context.

## First workflow areas

| Area | Current drag | Contract improvement |
| --- | --- | --- |
| Appointment setting | Open slots, meeting submission, confirmation copy, and stage/task updates are split across steps. | One structured workflow for context, available slots, meeting submission, confirmation text, and follow-up state. |
| Video progress | Progress updates can fall behind actual submit/edit activity. | Submit/edit actions return stage, status, handled state, and customer update context. |
| Customer video requests | Customer intent arrives as raw notes or email. | Customer-selected actions create structured requests with routeable workflow status. |

## Why this matters

The issue is not that each task is technically hard. The issue is that operators repeatedly interpret, search, click, wait, and re-enter context the system already has somewhere.

The better pattern is:

```text
customer/operator action -> website resolves context -> endpoint updates/routes -> operator handles exceptions
```

## What this is not

This is not a broad rebuild request. It is not a pitch for a separate internal tool. It is a focused contract upgrade for the workflows that already create the most operational drag.

It is a small website contract upgrade: enable JSON for the workflows that already drive appointments, video progress, and customer follow-up.

## First pilot ask

Approve one appointment-setting workflow and one video/customer workflow as a measured pilot.

The pilot should track:

- clicks and time to find an open meeting slot
- time from call outcome to meeting set and confirmation copied
- video actions that update progress from submit/edit moments
- customer requests converted into structured workflow items
- items that still require manual review
