# Scouting Command UI Contract

Scouting Command is the larger Mac surface for Raycast Scout Prep. The Mac app can use a bigger canvas, native panes, color, and richer spacing, but its selected-task surface must be shaped from the Raycast Scout Prep UI and action panels.

## Source Surface To Mirror

Before changing the Scouting Command Scout Prep home/detail surface, inspect these Raycast locations:

- `src/scout-prep.tsx` `ScoutPrepTaskItem`
- `src/scout-prep.tsx` `ScoutPrepDetail`
- `src/scout-prep.tsx` `UpdateAthleteTaskPicker`
- `src/scout-prep.tsx` `UpdateAthleteTaskForm`
- `src/scout-prep.tsx` `PostCallUpdateForm`
- `src/lib/scout-prep.tsx` `buildScoutPrepDetailMarkdown`
- `src/lib/scout-prep.tsx` `buildScoutPrepMetadata`
- `src/scout-prep.tsx` `loadScoutPrepContextForDisplay`

## Current Raycast Mold

### Root Task Row Action Panel

`ScoutPrepTaskItem` has one primary action first:

- `Build Scout Prep`

It then exposes secondary actions through Raycast action-panel sections:

- unsectioned: `Client Outreach`
- `Workflow`: `Post-Call Update`, Daily Call Blocks action, `Batch Operations`, `Move CF Task`, `Complete Task` when eligible, `Update Task`, `Duplicate Profile Check`
- `Follow-Ups`: `Save Follow-Up`, `Personal Follow-Ups`
- `Athlete Info`: `Copy Athlete Name`, `Contact Info`, `Open Client Messages`, `Head Scout Schedules`, `Open Athlete Admin Page`, `Open Athlete Task Tab`, `Open Player ID`, `Open MaxPreps Search`, `Resolve MaxPreps Context`
- `Athlete Note`: `View Notes`, `Add Note`
- `Navigation`: `Show Today/PastDue`, `Show Tomorrow`, `Show Future`, `Show All`, `Prospect Search`, Supabase lifecycle status action
- `Sort`: grad-year sort action, call-attempt sort action

### Root Task Row Accessories

`ScoutPrepTaskItem` accessories carry source labels from Raycast:

- task title tag from `getTaskAccessoryMetadata(task)`; keep the source label exact, including `SCHEDULED FOLLOW-UP`
- grad year tag from `task.grad_year`
- default task-list sort is call attempt ascending, then grad year ascending
- the queue callout is `Total Tasks: n | T1: n`; do not replace it with a generic `Calls` count
- the root/sidebar navigation should not show a second Scout Prep task/call count; keep counts in the active queue callout where Raycast shows them

Mac list rows may use richer spacing, typography, icons, and color, but they must keep the same labels and meaning:

- `SCHEDULED FOLLOW-UP` stays `SCHEDULED FOLLOW-UP`; do not title-case, rename, or soften it
- call attempt 1 uses a blue status treatment and `T1`
- call attempt 2 uses an orange/amber status treatment and `T2`
- call attempt 3 uses a red status treatment and `T3`
- confirmation/meeting tasks use a green status treatment and `Meeting`
- scheduled follow-up uses a yellow/amber status treatment and `Follow-Up`
- grad year uses its own purple tag
- the left icon/status marker should match the task status color

### Build Scout Prep Detail Action Panel

`ScoutPrepDetail` is the build/script view. Its main content is the Scout Prep script/card body produced by `buildScoutPrepDetailMarkdown`, with metadata from `buildScoutPrepMetadata`.

It exposes only two front-facing actions before grouped sections:

- `Post-Call Update`
- `Client Outreach`

Then it uses grouped sections:

- `Workflow`: `Create Call Reminder`, `Create Text Reminder`, `Sync Notion Call Prep`, `Refresh Scout Prep`, `Move CF Task`, `Complete Task` when eligible, `Update Task`
- `Athlete Info`: `Contact Info`, `Open Client Messages`, `Translate Name`, `Head Scout Schedules`, `Open Athlete Admin Page`, `Open Athlete Task Tab`, `Open Player ID`, `Open MaxPreps Search`, `Resolve MaxPreps Context`
- `Athlete Note`: `View Notes`, `Add Note`

### Update Task Surface

`UpdateAthleteTaskPicker` chooses an incomplete athlete task. `UpdateAthleteTaskForm` owns the edit form.

Action labels:

- `Update Task`
- `Save Task Update`
- `Set Scheduled Follow-Up`
- `Complete Task`
- `Copy Task Description`

Form labels:

- `Task Title`
- `Description`
- `Task Due Date`
- `Complete this task after saving`

### Post-Call Update Surface

`PostCallUpdateForm` owns official stage changes. It is not part of standalone task completion.

Action/form labels:

- `Post-Call Update`
- `Save`
- `Official Sales Stage`
- meeting/reschedule fields only when `buildPostCallActionPlan` and the selected official stage require them

## Mac App Translation

The Mac selected-task pane should feel like an expansion of `Build Scout Prep`, not a new CRM detail page.

Required shape:

1. Athlete header: compact athlete name, task title, due/status chip, owner chip, and key sport/school/grad/state facts.
2. Main body: Scout Prep build/script details. This is the primary surface under athlete info.
3. Supporting sections: contacts and notes as grouped context.
4. Right Action Panel: organized like Raycast action-panel sections. Main commands front-facing, smaller commands hidden behind grouped callable rows/menus.

The selected task title/description must not be repeated across the page. Render task description only inside the `Update Task` drawer/form where it is editable. Do not add separate `Current Task`, `Open Tasks`, or right-panel task-description cards unless the Raycast surface being mirrored has pushed into the task-update flow.

Front-facing commands in the Mac detail pane:

- `Build Scout Prep` context/script body as the selected detail surface
- `Post-Call Update` only when it calls the vetted Prospect Pipeline post-call helper
- `Client Outreach`
- `Complete Task` only when Raycast would show direct complete
- `Update Task`

Do not duplicate primary commands in the right Action Panel. If the Mac detail makes eligible `Complete Task` front-facing, do not render the same `Complete Task` row again inside `Workflow`.

`Client Outreach` is a selected-task Scout Prep action. It must use the selected task/context and must not navigate to a generic Client Messages side panel as a substitute.

Grouped/callable right-panel sections:

- `Workflow`
- `Follow-Ups`
- `Athlete Info`
- `Athlete Note`
- `Navigation`
- `Sort`

Do not make every Raycast action a visible button. The Mac pane has more space, but the right panel should still preserve Raycast's action hierarchy: primary commands visible; secondary/navigation/copy/open actions grouped.

`Create Call Reminder` and `Create Text Reminder` belong in `Workflow`, not as top-level primary commands.

Mac shortcut behavior:

- `Enter` opens the selected athlete's larger `Post-Call Update` surface in the main pane.
- `Post-Call Update` owns the `Official Sales Stage` selector. Do not render that selector inside `Workflow`.
- `Cmd+Shift+C` navigates to the selected athlete's `Contact Info` context in the main pane instead of duplicating contact cards in the right Action Panel.
- `Cmd+Shift+U` opens the selected athlete's `Update Task` drawer in the right Action Panel.
- Only one right-panel child drawer should be open at a time for the selected athlete.

Action Panel visual rules:

- constrain icons to a fixed icon column so labels never collide with SVGs
- keep controls compact enough for a Mac inspector pane
- typography, spacing, and color may be modernized, but labels remain Raycast labels
- no function names, adapter names, mutation paths, proof labels, or marketing explanations in the panel
- if a control wraps awkwardly or needs a large form, move it into the appropriate Raycast-named disclosure section instead of making it a dominant primary button

## Loading And Cache Behavior

Raycast build detail uses cache-first display:

- `loadScoutPrepContextForDisplay` checks `getCachedScoutPrepContext`.
- It accepts cached context only when `isScoutPrepContextCacheUsableForDisplay` passes.
- Live context is loaded through `loadScoutPrepContext`.
- Live context is stored back through `setCachedScoutPrepContext`.
- `ScoutPrepDetail` uses standard loading state while the detail resolves.
- Manual `Refresh Scout Prep` forces live reload.

Mac app rule:

- Keep the last loaded selected-task detail visible while refreshing when possible.
- Show a small loading state in the detail pane instead of clearing the whole pane.
- Replace cached context only when the matching selected task's new context arrives.
- Manual refresh must mirror `Refresh Scout Prep`: force live context reload through the Prospect Pipeline adapter path.
- Normal selection may return a valid cached context without immediately reloading live; `Refresh Scout Prep` is the explicit force-live action.

## Compare And Contrast Checklist

Before each Scouting Command UI pass, compare current Mac UI against Raycast:

- Does the selected detail feel like `Build Scout Prep`, with script/build details as the main body?
- Are `Post-Call Update` and `Client Outreach` treated as first-class commands?
- Is `Complete Task` visible only when the Raycast direct-complete condition applies?
- Are `Workflow`, `Follow-Ups`, `Athlete Info`, `Athlete Note`, `Navigation`, and `Sort` preserved as action-panel group names?
- Are smaller open/copy/navigation actions grouped instead of filling the pane?
- Are labels copied from Raycast where the action is the same?
- Does loading/cache behavior match `loadScoutPrepContextForDisplay`?
- Are there any visible function names, adapter names, mutation paths, proof labels, or marketing text? If yes, remove them.

If the Mac UI cannot answer these questions from current Raycast code, stop and inspect the Raycast source before editing.
