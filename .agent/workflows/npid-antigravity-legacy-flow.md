---
description: NPID Legacy Laravel constraints (Translator Pattern, Session Wrapper)
---

# NPID Antigravity Legacy Flow

Skills for building and maintaining the Prospect ID video team workflow automation.

Available Skills

1. npid-api.md – NPID API Client

Interact with National PID Dashboard REST API for athlete operations.

Use when:
	•	Making API calls to NPID Dashboard
	•	Authenticating with the platform
	•	Searching for athletes
	•	Sending emails via templates
	•	Managing sessions

Key operations:
	•	Session management (400-day persistence)
	•	Video progress workflow search
	•	Email template retrieval
	•	Athlete email notifications

⸻

2. npid-fastapi.md – NPID FastAPI Translation Layer

Use the local FastAPI server as the only bridge between Raycast and the legacy Laravel dashboard.

Use when:
	•	Raycast needs JSON for anything related to NPID
	•	Resolving athlete IDs, main IDs, or seasons
	•	Reading/updating video stage/status via the new /api/v1/* endpoints
	•	You need to change how we talk to Laravel without touching Raycast

Hard rules:
	•	Raycast must never call dashboard.nationalpid.com directly.
Only call http://127.0.0.1:8000/api/v1/*.
	•	All upstream Laravel calls from FastAPI must:
	•	Use one legacy client module (session/translator), not ad-hoc requests calls scattered around
	•	Use application/x-www-form-urlencoded for writes
	•	Include a fresh _token in the body
	•	Use the saved session cookies from .npid_session.pkl
	•	Send X-Requested-With: XMLHttpRequest
	•	Use the exact parameter names Laravel expects
(no renames, no “cleanups”, no REST-style IDs)
	•	If Laravel returns HTML, parse it. Do not try to “fix” the backend to REST in this layer.
	•	FastAPI endpoints must always return clean JSON to Raycast, even if the upstream source is HTML.

Key endpoints (FastAPI side):
	•	GET /api/v1/athlete/{query}/resolve
	•	Resolve any name/email/ID into:
	•	athlete_id
	•	athlete_main_id
	•	video_msg_id (if available)
	•	profile info (name, grad_year, school, city, state, positions, sport)
	•	GET /api/v1/video/{athlete_id}/seasons
	•	Calls legacy /API/scout-api/video-seasons-by-video-type
	•	Uses correct params for: athlete_id, athlete_main_id, video_type, sport
	•	Parses HTML/JSON and returns normalized season options:
	•	{ id, season_id, label } where label is the exact text (e.g. 24-25 Junior Season – Naperville North)
	•	GET /api/v1/video/{video_msg_id}/status
	•	Calls legacy /API/scout-api/video-status
	•	Returns normalized status JSON for Raycast
	•	POST /api/v1/video/{video_msg_id}/stage
	•	Calls legacy /API/scout-api/video-stage
	•	Form-encoded POST with _token and required params
	•	Returns updated stage JSON

Use this skill when editing:
	•	npid-api-layer/app/routers/*.py
	•	npid-api-layer/app/session.py
	•	npid-api-layer/app/translators/legacy.py (or equivalent)
	•	Any code that changes how FastAPI talks to Laravel

Absolutely do NOT:
	•	Introduce JSON bodies to legacy endpoints
	•	Add bearer tokens or “modern” auth
	•	Rename parameters away from what Laravel actually uses
	•	Bypass the shared legacy session client
	•	Make Raycast talk to Laravel directly

⸻

3. raycast-python.md – Raycast Python Integration

Build Raycast extensions that bridge TypeScript UI to Python backend.

Use when:
	•	Creating new Raycast commands
	•	Debugging Python script execution
	•	Fixing environment/dependency issues
	•	Implementing TypeScript → Python communication

Key patterns:
	•	Python spawn() from Node.js
	•	Error handling and validation
	•	Environment detection
	•	Shebang best practices

⸻

4. video-team-workflow.md – Video Team Workflow

Manage the complete athlete video editing workflow.

Use when:
	•	Understanding the business process
	•	Building workflow features
	•	Managing inbox operations
	•	Tracking video progress stages

Key workflows:
	•	Inbox → Assignment → Editing → Complete
	•	Email communications at milestones
	•	Contact detection (athlete vs parent)
	•	Status tracking and updates

⸻

How to Use These Skills

In Claude Code conversations, reference skills when needed:

@npid-api.md         – Show me how to search for an athlete
@npid-fastapi.md     – Fix the FastAPI → Laravel translation for seasons/status/stage
@raycast-python.md   – Help me debug Python spawn issues
@video-team-workflow.md – What are the available email templates?

Project Structure

prospect-pipeline/
├── .claude/
│   └── skills/               # This directory
├── src/                      # Raycast extensions (TypeScript)
├── scripts/                  # Python automation scripts
├── npid-api-layer/      # FastAPI → legacy Laravel translation layer
├── mcp-servers/npid-native/  # REST API client
└── .kiro/                    # Shared context with Gemini CLI

Skill Maintenance

When updating skills:
	1.	Keep examples practical and tested.
	2.	Update both the skill and shared-context.md.
	3.	Include common pitfalls and solutions.
	4.	Add debugging tips from real issues encountered.

Quick Reference

Task	Skill
Call NPID REST API directly	npid-api.md
Talk to NPID via FastAPI only	npid-fastapi.md
Build/maintain Raycast extensions	raycast-python.md
Understand the business workflow	video-team-workflow.md
