# Legacy Backend Integration

The existing backend can remain the system of record while selected workflow actions get modern JSON contracts.

## Integration goal

The goal is not to expose every backend detail. The goal is to give high-value workflows a reliable request and response shape.

```text
JSON workflow request -> existing backend action -> JSON workflow response
```

## What the contract should hide

| Backend reality | Website contract should provide |
| --- | --- |
| Some actions are spread across multiple screens or forms. | One workflow endpoint that returns the next valid action. |
| Some responses are difficult to use programmatically. | Structured JSON with `success`, `status`, `data`, `next_actions`, and `errors`. |
| A workflow may involve athlete, contact, task, message, meeting, and sport identifiers. | A single `workflow_key` plus stable IDs in the response body. |
| Some actions need manual review. | A clear `needs_review` status with the reason. |

## Contract rule

The website can keep its existing page behavior for normal users. The improvement is that selected workflow actions also support JSON.

That gives Prospect ID a practical modernization path:

- keep the current backend
- add JSON support to selected high-value workflows
- test the workflows with measurable before/after results
- expand only where the pilot proves value

