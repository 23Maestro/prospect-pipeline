# Troubleshooting Lessons

## 2026-04-09 Scout Prep
- When scouting-prep output feels too broad, lock behavior with explicit alignment choices first and then narrow the content by grade and sport instead of broadening templates.
- For live-call UI polish in Raycast, prefer supported `Detail` markdown hierarchy and `Detail.Metadata` tags over trying to force unsupported text-color formatting.
- When Scout Prep needs “memory” without a real database, store only lightweight athlete pointers locally and rehydrate the current truth from Laravel on demand; add shared raw-search helpers instead of duplicating endpoint logic across commands.
- When debugging recent-profile follow-up flows, render the raw recent rows first and enrich them asynchronously; never filter the entire view down to zero before proving whether the backend route or the follow-up matcher is at fault.
- For local FastAPI work, prefer one repo-owned process entrypoint over ad hoc port killing; use a small wrapper around Overmind first, then fall back to direct `uvicorn --reload` only when the supervisor is unavailable.

## 2026-04-16 Head Scout Schedules + Meeting Set
- Use the dashboard's `Head Scouts` filter when validating broad calendar behavior; that filter surfaces the multi-scout view and explains why some `selectedowner[]` combinations can widen the returned feed instead of narrowing it.
- `selectedowner[]` from `/template/calendarevents` and `meetingfor` from `/template/template/openmeetings` are different ID namespaces. Do not treat them as interchangeable.
- Confirmed calendar owner token to scout-name mapping:
  - `calendar_owner_b` -> Head Scout B
  - `calendar_owner_c` -> Head Scout C
  - `calendar_owner_d` -> Head Scout D
- Confirmed Meeting Set numeric `meetingfor` ids from live modal/options:
  - Head Scout B -> `200002`
  - Head Scout C -> `200003`
  - Head Scout D -> `200004`
  - Head Scout E -> `56`
- For Ryan, `openeventid` matches the schedule slot `id`. Example: calendar slot `586548` matched `openmeetings?meetingfor=200004` row with `openeventid=586548`. Treat slot `id` as canonical `openeventid`.
- `/template/template/openmeetings?meetingfor=<id>` is the reliable read-only probe for validating a scout's Meeting Set id. The returned table includes `Assigned Owner` and radio inputs named `openeventid`.
- The athlete admin page JS exposes the Meeting Set relationship: changing `#whoissettingmeetingfor` sends `meetingfor=<numeric id>` to `/template/template/openmeetings`.
- A live Meeting Set modal on an athlete without an already-set meeting is the best place to recover numeric scout ids. The modal contains `<select name="assignedto" id="whoissettingmeetingfor">` with numeric option values.
- Head Scout E is special for calendar fetches right now:
  - Meeting Set owner id is confirmed as `56`.
  - Calendar left-panel selected owner id is confirmed as `calendar_owner_e`.
  - Using `selectedowner[]=56` in `calendarevents` broadens the feed instead of acting like the tokenized head-scout filters.
- Hardcode Head Scout E to Arizona metadata for now. Legacy location data around James/Logan is unreliable; treat James as AZ and two hours behind Eastern until proven otherwise.

## 2026-04-19 Session + Video Progress
- `remember me` cookies existing in `~/.npid_session.pkl` do not prove route validity. Check `/auth-status`, not `/health`, when a legacy surface looks partially broken.
- Scout Prep and Video Progress share the same saved cookie file but run through different local session-manager paths, so a backend role change can break one or both until the saved session is fully rewritten.
- If recent views go empty while the site still shows rows, reconnect with `bash scripts/npid-session-recover.sh` and retest `/admin/portal`, `/template/template/topviews?scout_id=100001`, and `/api/v1/scout/recent-profiles`.
- If a video task exists upstream but is missing locally, inspect cache merge rules before blaming auth. A stale `date_completed` can pin a reassigned task to `Done` even when the live server stage is back to `In Queue`.

## 2026-05-12 Scout Prep Call Card
- For live-call Scout Notes, prefer short opposition-style recruiting questions such as defensive anchor vs bat-first vs both. Keep measurable prompts narrow to the numbers the caller can actually say out loud.

## 2026-05-12 Workflow SDK GitBook
- When selling the workflow SDK direction, frame it as a website/API upgrade that lets selected workflows accept and return stable JSON. Keep app keys, local sessions, and Raycast-specific mechanics out of the core pitch unless they are needed for implementation detail.
