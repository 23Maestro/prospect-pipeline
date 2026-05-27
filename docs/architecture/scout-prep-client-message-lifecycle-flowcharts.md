# Scout Prep Client Message And Lifecycle Flowcharts

This note shows the message resolver path and the lifecycle/cache boundaries. The goal is less moving parts, not less rigor: keep Scout Prep, Client Messages, lifecycle, and caches tied to the same domain truth.

## Legacy Client Messages Routing

```mermaid
flowchart TD
  A["Client Message Inbox"] --> B["Read local Messages chat.db"]
  B --> C["Load macOS Contacts group"]
  C --> D["Try ID Clients, then ID Contacts"]
  D --> E{"Chat participant phone in group?"}
  E -- "No" --> F["Hide chat"]
  E -- "Yes" --> G["Create client directory match"]
  G --> H["Optional backend parent-name search"]
  H --> I{"Backend contact phone matches?"}
  I -- "Yes" --> J["Add athlete name and Prospect IDs"]
  I -- "No" --> K["Keep contact-group-only match"]
  J --> L["Render inbox row"]
  K --> L
  L --> M["Open local Raycast thread or Messages UI"]
```

Legacy behavior: the contact group was the gate. Athlete identity was enrichment after a phone was already admitted by `ID Clients` or `ID Contacts`.

Group threads are resolved by matched participant phone. If a parent and student athlete both appear across threads, that legacy path did not have a single student-athlete resolver in the middle.

## Implemented Client Messages Routing

```mermaid
flowchart TD
  A["Client Message Inbox"] --> B["Read local Messages chat.db"]
  B --> C["Normalize chat participant phones"]
  C --> D["Lookup active athlete_contact_cache rows"]
  D --> E["StudentAthleteMessageResolver"]
  E --> F["Load current athlete_pipeline_state labels"]
  F --> G{"Active contact-cache match?"}
  G -- "No" --> H["Hide chat"]
  G -- "Yes" --> I["Render inbox row"]
  I --> J["Open local Raycast thread or Messages UI"]
```

Current behavior: active `athlete_contact_cache` rows admit a thread into Client Messages. macOS contact groups are not the filter.

## Current Lifecycle And Cache Truth

```mermaid
flowchart TD
  A["Scout Prep task list loads"] --> B["Render task rows from portal tasks"]
  B --> C["Best-effort seed athlete_contact_cache"]
  C --> D{"Contact cache exists?"}
  D -- "Yes" --> E["Skip seed"]
  D -- "No" --> F["Load Scout Prep context"]
  F --> G["Upsert active athlete/contact phone rows"]

  H["Scout Prep action"] --> I["Laravel/FastAPI write succeeds first"]
  I --> J["Supabase lifecycle write"]
  J --> K["athletes identity"]
  J --> L["athlete_pipeline_state current snapshot"]
  J --> M["lifecycle_events audit history"]
  J --> N["appointments when meeting exists"]

  O["Meeting set / confirmation workflow"] --> P["set_meeting_confirmation_cache"]
  P --> Q["Confirmation message prep"]
  P -. "not lifecycle truth" .-> L

  R["CRM stage resolved"] --> S{"Terminal or inactive?"}
  S -- "Yes" --> T["Soft-inactivate athlete_contact_cache rows"]
  S -- "No" --> U["Keep rows active"]

  V["Reconcile current sales stages"] --> W["Patch or delete athlete_pipeline_state"]
  V --> X["Append lifecycle_events"]
  V --> Y["Upsert meeting outcome facts"]
```

Current behavior: lifecycle truth and message lookup are related but not centralized. `athlete_pipeline_state` can be deleted when a row leaves the active working set. `athlete_contact_cache` is soft-inactivated by lifecycle stage. Confirmation cache remains a message-prep cache and should not decide whether someone is in the lifecycle.

## Target Resolver Shape

```mermaid
flowchart TD
  A["Scout Prep task, Messages chat, or phone"] --> B["StudentAthleteMessageResolver"]
  B --> C["Normalize phone and athlete identity"]
  C --> D["Lookup athlete_contact_cache active rows"]
  C --> E["Read current lifecycle state"]
  D --> H{"One active athlete match?"}
  E --> H
  H -- "Yes" --> I["Resolved student athlete, contact, thread"]
  H -- "Multiple" --> J["Show explicit disambiguation"]
  H -- "None" --> K["Fallback search or save contact"]
  I --> L["Client Messages row"]
  I --> M["Scout Prep action"]
  I --> N["Open Messages thread"]
```

Current behavior: `athlete_contact_cache` plus lifecycle state is the gate. Other caches do not decide whether a client message belongs in the workflow.

## Remaining Gaps

- Ambiguous message matches are flagged for review, but the UI does not yet provide a dedicated chooser.
- Cleanup is split: lifecycle state can be deleted, contact cache is soft-inactivated, confirmation cache persists as message support, and audit/history rows remain append-only.
- Group-message opening is less deterministic than one-to-one Messages opening because the current link is built from participant addresses.
