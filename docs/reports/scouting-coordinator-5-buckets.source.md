# Scouting Coordinator: 5 Buckets

Source: `docs/architecture/scouting-coordinator-system-map.md`

## Compression Rule

The repo system map names six buckets. This report compresses the human-facing view into five buckets by treating Admin Data & Contacts as shared context that supports every workflow instead of a standalone job bucket.

## Five Buckets

1. Meetings & Scheduling
   - Owns appointment truth, booked meeting details, head scout openings, slots, reschedules, confirmations, and meeting timezone.
   - Starts from Scout Prep, Scout Openings, and Set Meetings.
   - Durable truth: `appointments`.

2. Pre-Meeting Work
   - Owns call attempts, reminders, confirmation tasks, voicemail tasks, and task-title completion gates before the meeting.
   - Starts from Scout Prep task actions and follow-up queues.
   - Durable truth: `lifecycle_events` for lifecycle facts and `call_log` for centralized call activity.

3. Client Communication
   - Owns outbound messages, voicemail follow-ups, confirmations, recipient selection, message context, and Client Messages.
   - Starts from Client Messages, Scout Prep, and Set Meetings.
   - Support tables: `set_meeting_confirmation_cache` and `athlete_contact_cache`.

4. Lifecycle & Reporting
   - Owns CRM sales stage, task status, lifecycle current/timeline, active/inactive states, and source-owned reporting facts.
   - Starts from Scout Prep, Set Meetings, and reporting views.
   - Durable truth: `lifecycle_events` through `lifecycleSalesStage`.

5. Outcomes & Enrollments
   - Owns close-won, close-lost, no-show, follow-up results, pending-client review, post-meeting outcomes, and reschedule-pending meaning.
   - Starts from Scout Prep, Set Meetings, and Pending Client review.
   - Durable truth: `call_log` and `pending_client_watchlist`.

## Shared Layer

Identity, contact cache, admin URLs, macOS Contacts, notes, phone facts, Prospect Search, and MaxPreps context are shared context. They support all five buckets, but they should not become a sixth operator job in the compressed view.

## Operating Rule

Commands are buttons. Buckets are jobs. Domains own meaning. Supabase stores durable truth. Laravel/API calls fetch or mutate source systems. Helpers move data through the right bucket.
