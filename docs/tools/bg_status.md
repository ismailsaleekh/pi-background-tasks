---
doc_id: tools/bg_status
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:bg_status]
covers_sources: []
---
# `bg_status`

<!-- pi-docs:begin name="tool-contract-bg_status" generator="scripts/docs/generate.mjs" -->
- Label: **Background Status**
- Source: `src/extension.ts:1105`
- Availability: `always`
- Available by default: **yes**
- Description: Inspect one background task or list all running/recent background tasks. This is a point-in-time inspection tool, not a waiting primitive.
- Root schema: `object`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `taskId` | no | `string` | Optional task ID or unambiguous prefix. If omitted, all running/recent tasks are returned. |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "properties": {
    "taskId": {
      "description": "Optional task ID or unambiguous prefix. If omitted, all running/recent tasks are returned.",
      "type": "string"
    }
  },
  "required": [],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-bg_status" -->

Inspect one background task or list all running/recent tasks.

## Schema


Optional fields:

- `taskId: string` — exact task id or unambiguous prefix. If omitted, all retained tasks are returned.

## When to use

Use for deliberate point-in-time inspection: the user asks for an update, completion handling was disabled, or there is concrete evidence a task is hung.

Do **not** use `bg_status` as a polling or waiting primitive. A `running` result is not an instruction to call it again, and a terminal notification does not need reconfirmation.

## Defaults

No `taskId` means list all tasks retained by this extension runtime.

## Lifecycle

Returns current snapshots. Status values are exactly `running`, `completed`, `failed`, and `killed`.

## Examples

```json
{}
```

```json
{"taskId":"b1234"}
```

## Output/result

Text content uses the same snapshot formatting as [`/jobs`](../commands/jobs.md), including output path. Structured details are:

```ts
{ tasks: BgTaskSnapshot[] }
```

Each snapshot includes delivery flags, notification state, optional telemetry reported by the task, and optional error.

## Errors

- Missing id is only possible when an empty string is supplied: `Task ID is required`.
- Unknown id/prefix: `Unknown background task ID: <id>`.
- Ambiguous prefix: lists matching task ids.

Tool execution rejects loudly; there is no silent fallback to an empty list.

## Runtime artifacts

Read-only in-memory snapshots. It does not read or write `.pi/tasks` files.

## Safety boundaries

Inspection only. Not a polling primitive, not a wait loop, and not a task-control operation.

## Related docs

- [`/jobs`](../commands/jobs.md)
- [`bg_logs`](bg_logs.md)
- [`bg_run`](bg_run.md)
- [Completion delivery](../concepts/completion-delivery.md)
- [Background task runtime](../subsystems/background-task-runtime.md)

## Source ownership/reference

Tool registration lives in `src/extension.ts`; snapshots and task resolution are owned by [background-task-runtime](../subsystems/background-task-runtime.md).
