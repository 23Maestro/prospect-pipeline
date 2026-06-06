# Set Meetings UI References

## Direction

For later work on `src/view-set-meetings.tsx` and the Scouting Command meetings surface, blend:

- Prospect ID's dense weekly/day schedule grid.
- Asana's cleaner calendar/project framing.

## User-Provided Screenshot References

The two pasted screenshots in chat should be preserved as the visual direction for this bucket. If exported to disk later, place them here as:

- `prospect-id-dense-week-schedule.png`
- `asana-calendar-project-view.png`

## Use

- Dense time-grid behavior for openings, follow-ups, meetings, and head-scout schedules.
- Strong color semantics for owners, open slots, booked meetings, and conflicts.
- Readable event blocks even when stacked.
- Calendar framing that feels calmer than the current Prospect ID grid.

## Avoid

- Creating a separate calendar truth system.
- Replacing Prospect Pipeline appointment/source-of-truth paths.
- Applying this calendar-specific reference to Scout Prep selected-athlete layout.

## Source Boundaries

- Meetings bucket owns appointment truth, head-scout openings, reschedules, confirmations, and meeting timezone.
- Existing Prospect Pipeline/Raycast Set Meetings and Head Scout Schedules paths remain the source adapter paths.

## References

- Asana project/calendar organization reference: https://help.asana.com/s/article/navigating-asana
- Asana calendar/task organization reference: https://help.asana.com/s/article/sections
