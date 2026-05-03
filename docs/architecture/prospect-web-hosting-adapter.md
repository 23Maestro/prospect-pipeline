# Prospect Web Hosting Adapter

Status: Vercel/Next.js is now the web-hosting adapter. Netlify files/config/scripts have been removed from the repo.

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

Current Vercel route replacements:

- Old `netlify/functions/call-tracker-sync.mjs` -> `apps/prospect-web/app/api/call-tracker-sync/route.ts`
- Old `netlify/functions/set-meetings.mjs` -> `apps/prospect-web/app/api/set-meetings/route.ts`
- Old `netlify/functions/head-scout-schedules.mjs` -> `apps/prospect-web/app/api/head-scout-schedules/route.ts`
- Old `netlify/functions/contact-reminder-intake.mjs` -> `apps/prospect-web/app/api/contact-reminder-intake/route.ts`

Netlify has been removed. Rollback is to restore the last commit before Netlify deletion and redeploy the old Netlify project from the historical migration map in `docs/architecture/netlify-to-vercel-migration.md`.
