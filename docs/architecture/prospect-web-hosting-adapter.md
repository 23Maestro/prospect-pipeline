# Prospect Web Hosting Adapter

Status: Vercel/Next.js is now the only web-hosting adapter.

Vercel/Next.js is the target web-hosting adapter for:

- Prospect Mobile
- Prospect Call Tracker
- `/api/call-tracker-sync`
- Prospect Mobile browser API adapter routes

System ownership stays unchanged:

- Laravel / Prospect ID remains the external source of truth for real website state and commands.
- Raycast remains the operator UI.
- FastAPI remains the legacy website adapter.
- Supabase remains extension persistence/reporting.
- Domain modules remain the source of ownership, operator, task, meeting, and materialization meaning.
- Next.js routes must not own or duplicate domain meaning.

Current Prospect Web API adapter routes:

- `apps/prospect-web/app/api/call-tracker-sync/route.ts`
- `apps/prospect-web/app/api/set-meetings/route.ts`
- `apps/prospect-web/app/api/head-scout-schedules/route.ts`
- `apps/prospect-web/app/api/contact-reminder-intake/route.ts`

Rollback is a normal code rollback of Prospect Web plus its Vercel project configuration.
