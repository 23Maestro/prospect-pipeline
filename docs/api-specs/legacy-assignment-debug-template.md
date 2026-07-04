# Legacy Assignment Debug Template

This note preserves the useful troubleshooting shape from an assignment-router repair without publishing live payloads, private names, tokens, or contact details.

## Problem Pattern

The Raycast command appeared to submit successfully, but the legacy dashboard did not mutate the assignment state. The source system returned a success-shaped HTTP response even when the payload did not match the browser form exactly.

## Investigation Steps

1. Compare the Raycast/FastAPI payload against the browser network request.
2. Verify that the same authenticated session is used by the local adapter and the legacy dashboard client.
3. Fetch the CSRF token from the exact modal/form endpoint that owns the mutation.
4. Normalize synthetic UI identifiers into the raw legacy IDs expected by the form.
5. Remove duplicate form fields that were accepted by the client code but rejected or ignored by the server.
6. Prove the mutation with live readback from the source system, not just an HTTP 200.

## Sanitized Example

Browser-compatible payload shape:

```text
_token=<CSRF_TOKEN>
contact_task=<LEGACY_CONTACT_TASK_ID>
athlete_main_id=<LEGACY_PROFILE_ID>
messageid=<NUMERIC_MESSAGE_ID>
videoscoutassignedto=<LEGACY_OWNER_ID>
contactfor=<athlete|parent>
contact=<recipient@example.com>
video_progress_stage=<STAGE_LABEL>
video_progress_status=<STATUS_LABEL>
```

Important normalization:

```text
message_id12870 -> 12870
```

## Fix Shape

- Use one shared local session source for dashboard-backed requests.
- Extract CSRF from the mutation modal, not a nearby JSON endpoint.
- Strip UI prefixes from IDs before submitting form data.
- Submit only the browser-observed field names.
- Log request shape and response type, but never log full tokens, emails, phone numbers, or session cookies.
- Treat HTML login pages, redirects, HTTP 419, and JSON parse failures as auth/CSRF failures.

## Verification Checklist

- The local CLI call submits the sanitized payload shape.
- The Raycast action sends the same field names as the browser.
- The dashboard row disappears from the source queue or changes owner/status after the mutation.
- A follow-up source read confirms the new assignment owner and stage/status.
- Logs show placeholders or redacted values only.

## Public Safety Rules

- Use role labels such as `Primary Operator`, `Head Scout A`, and `Parent 1`.
- Use synthetic IDs such as `100001`, `200001`, and `<LEGACY_PROFILE_ID>`.
- Use `example.com` email addresses and `555-0100` phone values.
- Do not publish CSRF tokens, session file contents, cookies, private URLs, real names, or real contact records.
