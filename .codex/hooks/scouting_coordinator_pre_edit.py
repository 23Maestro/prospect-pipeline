#!/usr/bin/env python3
import json
import os
import re
import sys


REPO_MARKER = "Raycast/prospect-pipeline"
MAP_DOC = "docs/architecture/scouting-coordinator-system-map.md"
SUPABASE_DOC = "docs/architecture/scout-prep-supabase-source-of-truth.md"

KEYWORDS = re.compile(
    r"scout prep|client messages?|set meetings?|scout openings?|head scout|"
    r"supabase|lifecycle|sales stage|crm stage|call tracker|appointment truth|"
    r"contact cache|contacts?|admin url|voicemail|confirmation|reschedule|"
    r"pending client|meeting events?|post-call|post call",
    re.IGNORECASE,
)

PATH_BUCKETS = [
    (
        "Meetings",
        re.compile(
            r"src/lib/booked-meeting-details-resolver\.ts|"
            r"src/lib/head-scout-|src/head-scout-schedules\.tsx|"
            r"src/view-set-meetings\.tsx|supabase/.*appointment",
            re.IGNORECASE,
        ),
    ),
    (
        "Pre-Meeting Tasks",
        re.compile(
            r"src/domain/scout-task-selection\.ts|"
            r"src/lib/scout-follow-up-queue\.ts|"
            r"src/domain/scout-batch-runner",
            re.IGNORECASE,
        ),
    ),
    (
        "Client Communication",
        re.compile(
            r"src/client-message-inbox\.tsx|"
            r"src/domain/scout-message-context\.ts|"
            r"src/domain/scout-contact-selection\.ts|"
            r"src/lib/scout-follow-up-templates\.ts|"
            r"src/lib/client-message|src/lib/student-athlete-message-resolver\.ts",
            re.IGNORECASE,
        ),
    ),
    (
        "Lifecycle & Stage Truth",
        re.compile(
            r"src/lib/supabase-lifecycle|"
            r"src/domain/supabase-lifecycle-translator\.ts|"
            r"src/lib/sales-lifecycle\.ts|src/domain/call-tracker|supabase/",
            re.IGNORECASE,
        ),
    ),
    (
        "Enrollments & Outcomes",
        re.compile(
            r"src/domain/post-call-action\.ts|"
            r"src/domain/pending-client-watchlist\.ts|"
            r"src/lib/pending-client-watchlist\.ts|"
            r"scripts/reconcile-current-sales-stages-to-supabase",
            re.IGNORECASE,
        ),
    ),
    (
        "Admin Data & Contacts",
        re.compile(
            r"src/domain/athlete-contact-cache\.ts|"
            r"src/lib/athlete-contact-cache\.ts|"
            r"src/lib/scout-prep-contact\.ts|"
            r"src/lib/prospect-search\.ts|src/prospect-search\.tsx|"
            r"src/lib/maxpreps-|scripts/backfill-macos-contact-notes",
            re.IGNORECASE,
        ),
    ),
]

GENERAL_SC_PATHS = re.compile(
    r"src/scout-prep\.tsx|src/lib/scout-prep\.tsx|src/features/scout-prep/|"
    r"AGENTS\.md|docs/architecture/scouting-coordinator-system-map\.md",
    re.IGNORECASE,
)


def read_input():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def in_repo(payload):
    cwd = payload.get("cwd") or os.getcwd()
    return REPO_MARKER in cwd


def command_text(payload):
    tool_input = payload.get("tool_input") or {}
    if isinstance(tool_input, dict):
        return str(tool_input.get("command") or json.dumps(tool_input))
    return str(tool_input)


def relevant_buckets(text):
    buckets = []
    if GENERAL_SC_PATHS.search(text):
        buckets.append("classify from system map")
    for name, pattern in PATH_BUCKETS:
        if pattern.search(text):
            buckets.append(name)
    return list(dict.fromkeys(buckets))


def context_text(reason, buckets=None, supabase=False):
    bucket_line = ", ".join(buckets or ["classify from system map"])
    lines = [
        "Prospect Pipeline pre-edit guard:",
        f"- Reason: {reason}",
        f"- Before editing, identify the Scouting Coordinator bucket: {bucket_line}.",
        f"- Read AGENTS.md and {MAP_DOC}.",
        "- Reuse the bucket-owned domain surface before creating helpers/scripts.",
        "- Commands are buttons. Domains own meaning. Supabase stores durable truth. Laravel/API calls are adapters.",
    ]
    if supabase:
        lines.append(f"- Supabase truth appears involved; also read {SUPABASE_DOC}.")
    return "\n".join(lines)


def emit_additional_context(text, event_name):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": event_name,
                    "additionalContext": text,
                }
            }
        )
    )


def main():
    payload = read_input()
    event = payload.get("hook_event_name") or ""
    if not in_repo(payload):
        return

    if event == "UserPromptSubmit":
        prompt = str(payload.get("prompt") or "")
        if KEYWORDS.search(prompt):
            emit_additional_context(
                context_text(
                    "prompt mentions Scout Prep / lifecycle / contacts / Supabase workflow",
                    supabase=bool(re.search(r"supabase|appointment truth|lifecycle|call tracker", prompt, re.I)),
                ),
                event,
            )
        return

    if event == "PreToolUse":
        tool_name = str(payload.get("tool_name") or "")
        text = command_text(payload)
        buckets = relevant_buckets(text)
        if buckets or KEYWORDS.search(text):
            emit_additional_context(
                context_text(
                    f"before {tool_name} touches SC-related code",
                    buckets=buckets,
                    supabase=bool(re.search(r"supabase/|supabase|appointment_truth|lifecycle", text, re.I)),
                ),
                event,
            )


if __name__ == "__main__":
    main()
