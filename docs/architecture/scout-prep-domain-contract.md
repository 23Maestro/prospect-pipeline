# Scout Prep Domain Contract

This repo is a Prospect ID workflow extension. The architecture is split by responsibility so ownership, tasks, meetings, outreach wording, and reporting mean the same thing across Laravel, Raycast, FastAPI, Supabase, and the domain modules.

## System Roles

Laravel / Prospect ID is the external command/source system. It owns real website state and executes real commands: sales stage update, meeting set submit, task complete/update, calendar events, open meetings, booked meetings, and athlete profile/task data.

Raycast is the operator UI adapter. Scout Prep, Head Scout Schedules, View Set Meetings, post-call update, confirmation texts, voicemail follow-ups, meeting set actions, and contact/message actions render the workflow and execute actions. Raycast should not independently define ownership, task meaning, meeting meaning, outreach wording, or materialization eligibility.

FastAPI is the legacy website adapter. It receives clean app requests, calls legacy Laravel routes, parses Laravel HTML/JSON, preserves Laravel field names, and reads shared owner config where calendar/head-scout identity is needed. FastAPI should translate behavior; it should not own domain meaning.

Supabase is extension persistence/reporting. It stores lifecycle audit, current pipeline snapshots, appointment records, call activity facts, meeting outcome facts, reminder state, and reporting views. Supabase should not invent ownership. Rows should carry domain proof, and views should count only materialized domain facts.

Domain layer is the internal contract. Domain modules define active operator, owner profiles, athlete identity, owner resolution, materialization gate, task classification, task selection, sales-stage contract, meeting-set contract, outreach time wording, contact selection, message context, Set Meetings candidate pipeline, Scout Prep command pipeline, and Supabase fact construction.

## Facts, Snapshots, Audit

Facts are countable events. Call activity facts, meeting outcome facts, and materialized meeting-set facts are the rows reporting views should count.

Snapshots are current state. Athlete pipeline state and appointment records describe the latest known state, but they are not automatically countable dashboard events.

Audit rows are history. Lifecycle rows preserve what happened and why. A lifecycle row can become reportable only when it carries the domain proof required by the reporting view.

A real Prospect ID event is not automatically an active-operator fact. Prospect ID can contain real meetings and tasks for Tim or another coordinator. Those rows can be true website state while still not materializing into Jerami-owned reporting.

## Ownership

Active operator is the current workflow operator from `config/prospect-id-owners.json`. Owner profile is a known Prospect ID person with roles and legacy IDs. Tim can be an OwnerProfile without being dashboardTrackingEligible.

The owner domain uses names like `activeOperator`, `ownerContext`, `taskAssignedOwner`, `assignedToLegacyUserId`, `meetingForLegacyUserId`, `calendarOwnerId`, `bookedMeetingAssignedOwner`, `profileHeadScout`, `scoutingCoordinator`, and `materializationStatus`.

Supabase compatibility fields like source_owner and owner_proof are persistence outputs, not domain vocabulary. Domain code should produce `resolvedOwnerName`, `ownerProof`, `resolvedFromField`, and `materializationStatus`; the persistence boundary maps those to `source_owner`, `owner_proof`, and `payload_json.materialization_status`.

## Legacy Boundaries

Laravel field names must be preserved at adapter boundaries. Do not rename these payload fields when crossing into FastAPI/Laravel: `assigned_owner`, `assigned_to`, `meeting_for`, `meetingfor`, `calendar_owner_id`, `head_scout`, and `scouting_coordinator`.

Inside domain code, use meaningful names. At Laravel/FastAPI boundaries, preserve legacy field names exactly. At Supabase boundaries, map domain proof to compatibility fields without making those fields the language of business logic.

## Outreach and Commands

Outreach wording is domain-owned. Confirmation day phrases, meeting reminder phrases, greeting selection, and meeting time labels should resolve through `src/domain/outreach-time-wording.ts`; UI code and template wrappers can delegate to it but should not recreate the phrase resolver.

Scout Prep, Head Scout Schedules, and View Set Meetings share one command/data pipeline. Scout Prep builds task/contact/message/post-call meaning through domain modules. Head Scout Schedules shapes and sorts Set Meetings candidates through domain modules. View Set Meetings stays a thin wrapper around the Set Meetings UI.

## Reporting Gate

Supabase reporting views count materialized domain facts. `operator_task` means the row is eligible for active-operator reporting. `not_operator_task` means the row can be stored for context but should not appear as an active-operator dashboard fact.

Legacy compatibility proof must be explicit. Older rows can materialize only when they prove the same domain contract: active-operator task assignment plus owner proof. Missing proof should stay out of reporting instead of being inferred from a calendar owner or snapshot.
