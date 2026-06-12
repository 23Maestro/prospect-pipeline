# Local n8n Parent Response Workflow

This folder contains the local npm-based n8n workflow for parent response review.
n8n is orchestration glue only: it polls submitted `parent_response_requests`,
calls the protected Prospect Web notify route, and patches notification metadata
after a successful route call.

It must not fetch openings, create parent links, assemble reschedule payloads,
write lifecycle facts, update appointment truth, or set CRM/task status.

## Runtime

Use the local npm/nvm install:

```sh
n8n --version
n8n
```

The UI runs at:

```text
http://localhost:5678
```

## Required Environment

Start n8n from a shell that has these variables available:

```sh
export SUPABASE_URL="https://PROJECT_REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
export SUPABASE_SCHEMA="public"
export PARENT_RESPONSE_NOTIFY_BASE_URL="https://prospect-web.vercel.app"
export PARENT_RESPONSE_NOTIFY_SECRET="..."
```

The notify route itself also requires Prospect Web/Vercel to have:

```sh
PARENT_RESPONSE_NOTIFY_SECRET
RESEND_API_KEY
PARENT_RESPONSE_NOTIFY_FROM
PARENT_RESPONSE_NOTIFY_TO
```

Approval is intentionally separate and requires `PARENT_RESPONSE_APPROVAL_SECRET`.

## Import

Import the repo-owned workflow:

```sh
n8n import:workflow --input=n8n/workflows/parent-response-review.json
```

Regular local n8n mode deactivates imported workflows by default. Keep it
inactive until a dry-run row proves the route, Resend delivery, and metadata
patch behavior.

## Verification

Run the workflow contract test:

```sh
node --test n8n/workflows/parent-response-review.test.mjs
```

Manual dry-run proof still requires:

1. Create a test `parent_response_requests` row through the Prospect Pipeline
   request creation path.
2. Submit a parent response through Prospect Web.
3. Manually execute the imported n8n workflow.
4. Confirm Resend notification delivery.
5. Confirm only `notification_status`, `notification_sent_at`, and
   `notification_error` changed in Supabase.
6. Confirm no lifecycle, appointment, CRM stage, or task status fields were
   written by n8n.
