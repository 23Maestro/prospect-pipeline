# Architecture Documentation

This folder contains **Mermaid diagrams** (`.mmd`) documenting the Prospect Pipeline system architecture. Open these files with a Mermaid-compatible viewer (e.g., VS Code + Mermaid extension, GitHub renders them inline, or [mermaid.live](https://mermaid.live)).

## Files

| File                       | Purpose                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system-map.mmd`           | **Master system map** — all layers (UI → Shared Services → FastAPI → External NPID), data stores, and logging                                                                      |
| `workflow-ingest.mmd`      | **Prospect ingest flow** — from AI tool input through search → resolve → materialize → cache → list view                                                                           |
| `workflow-email.mmd`       | **Email automation flow** — template fetch → recipient resolution → recipient-policy enforcement → send + log                                                                      |
| `workflow-deprecation.mmd` | **Command consolidation roadmap** — phased plan for retiring `prospect-search`, `video-updates`, and `email-student-athletes` in favor of `manual-sa-additions` + `video-progress` |

## How to Read

- **Solid arrows** → primary / happy-path data flow
- **Dashed arrows** → fallback or failure branches
- **Red nodes/edges** → failure or deprecated status
- **Green nodes** → policy / gating points
- **Blue nodes** → data stores
