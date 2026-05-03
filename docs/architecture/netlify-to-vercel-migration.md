# Netlify to Vercel Migration

Date started: 2026-05-02

Scope: migrate the web-hosting adapter for Prospect Mobile and Prospect Call Tracker only. Laravel payloads, FastAPI route behavior, Raycast commands, Supabase views, materialization gates, and domain ownership/operator logic stay unchanged.

Boundary: FastAPI remains the legacy website adapter, Supabase remains persistence/reporting, and domain modules remain the source of ownership/operator/task/meeting/materialization meaning. Next.js route handlers must not own domain meaning.

## Current Netlify Setup

- `netlify.toml`: publishes `mobile-web` and serves functions from `netlify/functions`.
- Redirects: `/set-meetings`, `/scout-schedules`, and `/contact-reminder` all rewrite to `/index.html`.
- `mobile-web/index.html`: Prospect Mobile entrypoint.
- `mobile-web/app.js`: browser UI that calls `/api/set-meetings`, `/api/head-scout-schedules`, and `/api/contact-reminder-intake`.
- `npid-api-layer/app/static/call-tracker/index.html`: Call Tracker entrypoint.
- `npid-api-layer/app/static/call-tracker/app.js`: browser dashboard that reads Supabase anon views and calls `/api/call-tracker-sync` on Netlify.
- `netlify/functions/_shared/prospect-api.mjs`: Netlify proxy helper. Reads `PROSPECT_API_BASE` and `PROSPECT_API_TOKEN`, calls FastAPI/Tailscale, and returns upstream text/status/content-type.

## Migration Map

| Current Netlify surface | What it does | Dependencies/env | Expected response shape | Target Vercel surface |
|---|---|---|---|---|
| `mobile-web/index.html` | Prospect Mobile static shell | Static CSS/JS/icon | HTML page | `apps/prospect-web/app/prospect-mobile/page.tsx` |
| `/set-meetings` redirect | Mobile route fallback | `netlify.toml` | HTML page | `apps/prospect-web/app/prospect-mobile/set-meetings/page.tsx` |
| `/scout-schedules` redirect | Mobile route fallback | `netlify.toml` | HTML page | `apps/prospect-web/app/prospect-mobile/scout-schedules/page.tsx` |
| `/contact-reminder` redirect | Mobile route fallback | `netlify.toml` | HTML page | `apps/prospect-web/app/prospect-mobile/contact-reminder/page.tsx` |
| `netlify/functions/set-meetings.mjs` | GET booked meetings for Eastern week window | `PROSPECT_API_BASE`, `PROSPECT_API_TOKEN` | FastAPI JSON passthrough | `apps/prospect-web/app/api/set-meetings/route.ts` |
| `netlify/functions/head-scout-schedules.mjs` | GET scout slots for Eastern week window | `PROSPECT_API_BASE`, `PROSPECT_API_TOKEN` | FastAPI JSON passthrough | `apps/prospect-web/app/api/head-scout-schedules/route.ts` |
| `netlify/functions/contact-reminder-intake.mjs` | POST contact reminder payload | `PROSPECT_API_BASE`, `PROSPECT_API_TOKEN` | FastAPI JSON passthrough or `{ success:false,error }` for invalid JSON | `apps/prospect-web/app/api/contact-reminder-intake/route.ts` |
| `netlify/functions/call-tracker-sync.mjs` | GET sync status and POST async sync start | `PROSPECT_API_BASE`, `PROSPECT_API_TOKEN` | FastAPI JSON passthrough | `apps/prospect-web/app/api/call-tracker-sync/route.ts` |
| `npid-api-layer/app/static/call-tracker/*` | Static Call Tracker dashboard assets | Supabase anon URL/key in `config.js` | HTML/CSS/JS assets | `apps/prospect-web/app/prospect-call-tracker/page.tsx` plus `public/prospect-call-tracker/*` |

## Vercel Env Vars

Client-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_SCHEMA`
- `NEXT_PUBLIC_CALL_TRACKER_API_BASE` if a future browser override is needed
- `NEXT_PUBLIC_PROSPECT_MOBILE_API_BASE` if a future browser override is needed

Server-only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SCHEMA`
- `FASTAPI_BASE_URL`
- `TAILSCALE_FASTAPI_BASE_URL`
- `FASTAPI_TIMEOUT_MS`
- `PROSPECT_API_BASE`
- `PROSPECT_API_TOKEN`
- `CALL_TRACKER_SYNC_SECRET`
- `INTERNAL_API_SECRET`

Server-only values are read only from route handlers or server utilities. Browser files are guarded by static tests so service-role and internal FastAPI secret names cannot appear in client-facing files.

## Compatibility Notes

- `/api/call-tracker-sync` preserves Netlify methods: `GET` returns FastAPI sync status, `POST` calls `/api/v1/call-tracker/sync?wait=false`, other methods return `{ success:false,error }` with `405`.
- FastAPI responses are passed through with upstream status and content type.
- The Vercel proxy header changes from `x-mobile-proxy: netlify` to `x-mobile-proxy: vercel`; no domain meaning is attached to that value.
- Existing Netlify files remain until Vercel live verification passes.

## Rollback

Before Netlify removal, rollback is DNS/config only: keep the current Netlify project `prospect-call-tracker` at `https://prospect-call-tracker.netlify.app`, keep `netlify.toml`, and keep `netlify/functions`. After removal, rollback means restoring the last commit before Netlify deletion and redeploying the Netlify site with the documented env vars.
