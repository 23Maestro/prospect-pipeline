# Prospect Web Vercel Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the web-hosted Prospect Mobile and Call Tracker adapter surfaces from Netlify to an isolated Vercel/Next.js app without changing Laravel, FastAPI, Raycast, Supabase, Scout Prep, Meeting Set, or domain behavior.

**Architecture:** Keep the existing browser UIs and response contracts. Next.js only serves static pages/assets and route-handler adapters that proxy the same FastAPI/Tailscale endpoints with server-only credentials.

**Tech Stack:** Next.js App Router, TypeScript route handlers, Node test runner with `tsx`, existing static HTML/CSS/JS assets, Vercel CLI.

---

### Task 1: Audit Netlify Surface

**Files:**
- Create: `docs/architecture/netlify-to-vercel-migration.md`
- Read: `netlify.toml`
- Read: `netlify/functions/*.mjs`
- Read: `mobile-web/*`
- Read: `npid-api-layer/app/static/call-tracker/*`

- [ ] Document every Netlify function, route, static entrypoint, env var, and response pass-through contract.
- [ ] Map each current Netlify route to its target Next.js page or route handler.
- [ ] Include rollback notes that keep Netlify files in place until live Vercel checks pass.

### Task 2: Create Isolated Next.js App

**Files:**
- Create: `apps/prospect-web/package.json`
- Create: `apps/prospect-web/next.config.ts`
- Create: `apps/prospect-web/tsconfig.json`
- Create: `apps/prospect-web/app/layout.tsx`
- Create: `apps/prospect-web/app/prospect-mobile/page.tsx`
- Create: `apps/prospect-web/app/prospect-call-tracker/page.tsx`
- Create: `apps/prospect-web/public/prospect-mobile/*`
- Create: `apps/prospect-web/public/prospect-call-tracker/*`

- [ ] Keep app-local dependencies isolated from the Raycast extension package.
- [ ] Copy static browser assets from the existing Netlify/FastAPI locations.
- [ ] Serve existing UIs through thin App Router pages without UI redesign.

### Task 3: Migrate API Adapter Behavior

**Files:**
- Create: `apps/prospect-web/lib/env.ts`
- Create: `apps/prospect-web/lib/fastapi-client.ts`
- Create: `apps/prospect-web/lib/response-shapes.ts`
- Create: `apps/prospect-web/app/api/call-tracker-sync/route.ts`
- Create: `apps/prospect-web/app/api/set-meetings/route.ts`
- Create: `apps/prospect-web/app/api/head-scout-schedules/route.ts`
- Create: `apps/prospect-web/app/api/contact-reminder-intake/route.ts`
- Create: `apps/prospect-web/app/api/health/route.ts`

- [ ] Preserve `GET` and `POST` behavior for `/api/call-tracker-sync`.
- [ ] Preserve mobile API route methods and FastAPI paths.
- [ ] Pass FastAPI response bodies, statuses, and content types through unchanged.
- [ ] Keep server-only credentials in route utilities only.

### Task 4: Add Tests and Static Guards

**Files:**
- Create: `apps/prospect-web/tests/*.test.ts`
- Modify: `apps/prospect-web/package.json`

- [ ] Mock FastAPI responses for route handler tests.
- [ ] Assert call tracker sync success, FastAPI error, timeout/fetch failure, and method handling.
- [ ] Assert browser assets load from the Vercel public tree.
- [ ] Assert server-only env names do not appear in client-facing files.
- [ ] Assert domain/Raycast/Supabase/Laravel source paths were not changed by this migration pass.

### Task 5: Build, Deploy, Verify, Then Remove Netlify

**Files:**
- Create: `docs/architecture/vercel-live-verification.md`
- Create: `docs/architecture/prospect-web-hosting-adapter.md`
- Later delete only after live verification: `netlify.toml`, `netlify/functions/`

- [ ] Run local tests and Next build.
- [ ] Deploy `apps/prospect-web` with Vercel CLI.
- [ ] Verify production health, pages, API sync, Supabase reads, browser console, key exposure, Raycast commands, FastAPI routes, and Supabase materialization reporting.
- [ ] Only after live verification passes, remove Netlify files/scripts/docs and add no-Netlify checks.
