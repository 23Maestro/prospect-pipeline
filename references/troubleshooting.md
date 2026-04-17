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
  - `OrJsV8nhBouEzKY` -> Jeffrey Stein
  - `bMBrA26OElRUwPs` -> Luther Winfield
  - `nhVvYOz8bAaL57c` -> Ryan Lietz
- Confirmed Meeting Set numeric `meetingfor` ids from live modal/options:
  - Jeffrey Stein -> `1418529`
  - Luther Winfield -> `370959`
  - Ryan Lietz -> `1354049`
  - James Holcomb -> `56`
- For Ryan, `openeventid` matches the schedule slot `id`. Example: calendar slot `586548` matched `openmeetings?meetingfor=1354049` row with `openeventid=586548`. Treat slot `id` as canonical `openeventid`.
- `/template/template/openmeetings?meetingfor=<id>` is the reliable read-only probe for validating a scout's Meeting Set id. The returned table includes `Assigned Owner` and radio inputs named `openeventid`.
- The athlete admin page JS exposes the Meeting Set relationship: changing `#whoissettingmeetingfor` sends `meetingfor=<numeric id>` to `/template/template/openmeetings`.
- A live Meeting Set modal on an athlete without an already-set meeting is the best place to recover numeric scout ids. The modal contains `<select name="assignedto" id="whoissettingmeetingfor">` with numeric option values.
- James Holcomb is special for calendar fetches right now:
  - Meeting Set owner id is confirmed as `56`.
  - Using `selectedowner[]=56` in `calendarevents` broadens the feed instead of acting like the tokenized head-scout filters.
  - This is still usable because parser-side filtering by configured scout names preserves James open slots.
- Hardcode James Holcomb to Arizona metadata for now. Legacy location data around James/Logan is unreliable; treat James as AZ and two hours behind Eastern until proven otherwise.
