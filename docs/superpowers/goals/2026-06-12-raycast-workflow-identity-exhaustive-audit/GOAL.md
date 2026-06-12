# Raycast Workflow Identity Exhaustive Audit

## Objective

Exhaustively verify every identity-bearing Raycast Scout Prep, Set Meetings, and Client Messages workflow against the Scouting Coordinator bucket map and the Supabase source-of-truth contract.

## Boundary

- Start read-only.
- Inventory every action before editing runtime behavior.
- Classify each action by Scouting Coordinator bucket.
- Treat commands as UI surfaces, domain and bucket helpers as meaning owners, Supabase as durable truth, and Laravel/FastAPI as source-system adapters.
- Add audit contracts only where durable identity can drift.
- Do not build a catch-all resolver. The intended architecture remains one shared identity spine plus bucket-owned resolvers.

## Buckets

The system map has six buckets, not five:

1. Meetings
2. Pre-Meeting Tasks
3. Client Communication
4. Lifecycle & Stage Truth
5. Enrollments & Outcomes
6. Admin Data & Contacts

## Required Proof

- Current architecture inventory across `src/scout-prep.tsx`, `src/head-scout-schedules.tsx`, `src/client-message-inbox.tsx`, and `src/view-set-meetings.tsx`.
- Bucket classification for each durable or support identity-bearing action.
- Separation of adapter payload mappings from business-identity derivation leaks.
- Contract shape for Raycast workflow identity audit.
- Focused first implementation slice for any uncovered drift risk.
- Test/proof plan before runtime implementation.
