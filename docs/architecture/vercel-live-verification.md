# Vercel Live Verification

Date/time: 2026-05-02 21:03 America/New_York

Vercel production URL: https://prospect-web.vercel.app
Latest deployment URL: https://prospect-186w80mkl-23maestros-projects.vercel.app
Preview URL: not applicable for this manual production CLI deploy; the Vercel project is not connected to Git yet.
Project name: `prospect-web`
Deployment command: `npx vercel deploy --prod --yes`

Boundary: FastAPI remains the legacy website adapter, Supabase remains persistence/reporting, and domain modules remain the source of ownership/operator/task/meeting/materialization meaning. Next.js routes must not own domain meaning.

## Checks

| Check | Result | Evidence |
|---|---|---|
| Health route responds | Pass | `GET https://prospect-web.vercel.app/api/health` returned `200` and `{ "success": true, "status": "ok", "adapter": "vercel-nextjs" }`. |
| Production root route responds | Pass | `GET https://prospect-web.vercel.app/` returned `200` after adding a minimal surface index. |
| Prospect Call Tracker page loads | Pass | Browser loaded `/prospect-call-tracker`; title `Call Tracker` rendered. |
| Prospect Mobile page loads | Pass | `GET /prospect-mobile` returned the Prospect Pipeline mobile shell and `/prospect-mobile/app.js`. |
| Call Tracker reads Supabase data | Pass | Browser network showed `200` from `call_tracker_summary` and `call_tracker_events_owner_context`; rendered 6 current table rows and `$267` money value. |
| Refresh/sync calls Vercel API route | Pass | Browser Refresh issued `POST /api/call-tracker-sync` and polling `GET /api/call-tracker-sync`, both `200`. |
| Vercel route reaches FastAPI/Tailscale | Pass | `POST /api/call-tracker-sync` returned `{ "success": true, "status": "started", "running": true }`. |
| FastAPI/Tailscale returns expected sync response | Pass | Polling ended with `{ "success": true, "status": "complete", "running": false, "return_code": 0 }` after the first live sync. |
| Browser console has no missing asset/API errors | Pass | Playwright console check after favicon/bootstrap fix returned 0 errors and 0 warnings. |
| Service role key not exposed | Pass | Static check found no `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `PROSPECT_API_TOKEN`, or FastAPI secret names in browser-facing files or fetched page/app assets. |
| Existing Raycast commands still work | Pass | `npm run build` completed Raycast extension build successfully. |
| Existing FastAPI routes still work | Pass | FastAPI health was checked by the sync script: `api healthy at http://127.0.0.1:8000/health`. |
| Supabase reporting shows materialized rows only | Pass | `npm run test:domain` passed after updating the architecture contract for this scoped migration. |
| Netlify no longer needed for migrated surfaces | Pass | `netlify.toml`, `netlify/functions`, and `mobile-web` were removed after Vercel live checks passed. |

## Rollback Notes

Netlify repo files have been removed. Rollback after removal is to restore the last commit before Netlify deletion and redeploy the old Netlify project with its production env vars.

## Known Limitations

- Vercel preview env vars could not be configured branch-specifically because the new project is not connected to a Git repository. Production env vars are configured.
- A second browser-triggered sync was started during verification; it also completed successfully with return code 0.
