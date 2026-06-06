#!/usr/bin/env python3
import json
import os
import re
import sys


REPO_MARKER = "Raycast/prospect-pipeline"

SCOUTING_COMMAND_KEYWORDS = re.compile(
    r"scouting command|glaze|mac app|mac surface|native scout prep|"
    r"scout prep.*app|app.*scout prep|post-call|post call|"
    r"mutation|adapter|complete task|update task|sales stage|crm stage|"
    r"selected-athlete|selected athlete|action panel",
    re.IGNORECASE,
)

SCOUTING_COMMAND_PATHS = re.compile(
    r"app\.glaze\.macos\.main|scouting-command|\.glaze-sources|"
    r"renderer/main|main/handlers|scout-prep-adapter|"
    r"src/scout-prep\.tsx|src/lib/scout-prep|src/domain/post-call-action|"
    r"src/lib/sales-stage|src/lib/supabase-lifecycle",
    re.IGNORECASE,
)


def read_input():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def command_text(payload):
    tool_input = payload.get("tool_input") or {}
    if isinstance(tool_input, dict):
        return str(tool_input.get("command") or json.dumps(tool_input))
    return str(tool_input)


def should_emit(payload):
    cwd = payload.get("cwd") or os.getcwd()
    event = payload.get("hook_event_name") or ""
    if REPO_MARKER not in cwd and "app.glaze.macos.main" not in cwd:
        return False
    if event == "UserPromptSubmit":
        return bool(SCOUTING_COMMAND_KEYWORDS.search(str(payload.get("prompt") or "")))
    if event == "PreToolUse":
        text = command_text(payload)
        return bool(SCOUTING_COMMAND_KEYWORDS.search(text) or SCOUTING_COMMAND_PATHS.search(text))
    return False


def guard_text(reason):
    return "\n".join(
        [
            "Scouting Command surface guard:",
            f"- Reason: {reason}",
            "- Unbreakable requirement: every Scouting Command surface must emulate the working Raycast Scout Prep workflow.",
            "- Do not invent Mac-side business process, lifecycle meaning, CRM-stage interpretation, manual-review semantics, or mutation payloads.",
            "- Before implementing or changing a mutation, identify the exact Raycast Scout Prep action and source path in src/scout-prep.tsx or its extracted Prospect Pipeline domain/lib helper.",
            "- Read docs/architecture/scouting-command-raycast-mutation-contract.md before wiring or changing any Scouting Command write action.",
            "- For Scout Prep home/detail UI changes, read docs/architecture/scouting-command-ui-contract.md and compare against Raycast src/scout-prep.tsx ScoutPrepTaskItem and ScoutPrepDetail before editing.",
            "- The Mac app may display queue/context data or call a Prospect Pipeline helper that already owns the Raycast behavior. It must not assemble durable meaning itself.",
            "- The selected-task Mac pane should expand Raycast Build Scout Prep: compact athlete info up top, Scout Prep script/build body as the main surface, and a right Action Panel organized by Raycast section names.",
            "- Preserve Raycast action hierarchy: front-facing Build Scout Prep/script body, Post-Call Update, Client Outreach, eligible Complete Task, and Update Task; group smaller actions under Workflow, Follow-Ups, Athlete Info, Athlete Note, Navigation, and Sort.",
            "- Client Outreach must operate on the selected Scout Prep task/context; do not substitute generic Client Messages navigation for the Raycast Client Outreach action.",
            "- Create Call Reminder and Create Text Reminder belong under Workflow and must use the Prospect Pipeline reminders helper path, not a new Mac-side reminder builder.",
            "- Open MaxPreps Search belongs under Athlete Info and must use Prospect Pipeline buildMaxPrepsSearchLabel; do not add Resolve MaxPreps Context/cache writes until that Raycast path is explicitly lifted.",
            "- Do not duplicate primary commands: if eligible Complete Task is front-facing in the Mac detail pane, do not render it again inside Workflow.",
            "- Do not repeat selected task title/description in multiple places. Task description belongs in the Update Task drawer/form only; avoid separate Current Task, Open Tasks, or right-panel description cards.",
            "- Post-Call Update owns the Official Sales Stage selector. Do not render sales-stage controls inside Workflow; Enter should open the larger selected-athlete Post-Call Update surface.",
            "- Cmd+Shift+C should navigate to the selected athlete Contact Info context instead of duplicating contact cards in the right Action Panel; Cmd+Shift+U opens the Update Task drawer.",
            "- Preserve Raycast task-row labels and accessories: source task titles stay exact, including SCHEDULED FOLLOW-UP; grad year is its own tag; status tags/colors are display only and must not rename the task.",
            "- Preserve the Raycast Scout Prep queue callout: Total Tasks plus T1 count. Do not add a generic Calls metric or count that Raycast does not show.",
            "- Do not add a duplicate Scout Prep count to root/sidebar navigation; queue counts belong in the active Scout Prep list callout.",
            "- Scout Prep list color rules: scheduled follow-up yellow/amber, call attempt 1 blue T1, call attempt 2 orange/amber T2, call attempt 3 red T3, confirmation/meeting green Meeting, grad year purple.",
            "- Action Panel UI must constrain icons in a fixed column and keep controls compact enough for a Mac inspector; visual polish must not cause labels to collide, wrap awkwardly, or become oversized primary buttons.",
            "- For post-call updates, mirror Raycast PostCallUpdateForm: official stage selection -> buildPostCallActionPlan -> updateSalesStage -> coupled Supabase/lifecycle/task-completion behavior owned by Prospect Pipeline.",
            "- For Meeting Set inside Post-Call Update, preserve the Raycast sequence: load meeting template/open slots, submitMeetingSet, updateSalesStage, recordMeetingSet, syncMeetingSetConfirmationCacheFromScoutPrep, then optional task completion.",
            "- Standalone Complete Task must omit crmStage entirely; crmStage belongs only to traced Post-Call Update flows that Raycast sends through PostCallUpdateForm.",
            "- For task updates/completion, mirror the exact Raycast action labels and helper paths. If the equivalent Raycast flow has not been traced, stop and report the missing path instead of patching around it.",
            "- Loading/cache must mirror Raycast loadScoutPrepContextForDisplay: cache-first when valid, small loading state while preserving the last matching detail when possible, manual Refresh Scout Prep forces live reload.",
            "- Normal task selection may use valid cached Scout Prep context; Refresh Scout Prep must explicitly bypass the Mac display cache and call the live Prospect Pipeline adapter path.",
            "- UI polish may use Asana/Prospect ID only for layout and visual hierarchy; labels, actions, mutation behavior, refresh behavior, and success/error behavior come from Prospect Pipeline.",
            "- UI style reference lock: blend Raycast speed/command density, Asana list-detail organization, and Prospect ID admin CRM field spacing. Use these only for visual hierarchy, color, spacing, and pane organization.",
            "- Do not add marketing copy, decorative bloat, Asana product concepts, Prospect ID CRM replacement features, or new workflow objects while applying style references.",
        ]
    )


def emit(text, event_name):
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
    if not should_emit(payload):
        return
    event = payload.get("hook_event_name") or ""
    reason = (
        "prompt or tool call touches Scouting Command / Glaze Scout Prep surface"
        if event == "UserPromptSubmit"
        else "before tool touches Scouting Command or Scout Prep mutation surface"
    )
    emit(guard_text(reason), event)


if __name__ == "__main__":
    main()
