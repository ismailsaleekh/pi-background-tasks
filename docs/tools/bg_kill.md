---
doc_id: tools/bg_kill
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:bg_kill]
covers_sources: []
---
# `bg_kill`

<!-- pi-docs:begin name="tool-contract-bg_kill" generator="scripts/docs/generate.mjs" -->
- Label: **Background Kill**
- Source: `src/extension.ts:1181`
- Availability: `always`
- Available by default: **yes**
- Description: Stop a running background task by ID. Fails loudly if the task is unknown or already finished.
- Root schema: `object`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `taskId` | yes | `string` | Task ID or unambiguous prefix to stop |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "properties": {
    "taskId": {
      "description": "Task ID or unambiguous prefix to stop",
      "type": "string"
    }
  },
  "required": [
    "taskId"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-bg_kill" -->

Stop a running background task by id.

## Schema


Required fields:

- `taskId: string` — exact task id or unambiguous prefix.

## When to use

Use when the user asks to stop a background task or when a `bg_run` command is no longer needed.

## Defaults

No defaults. The task must be running.

## Lifecycle

A successful kill sets the task terminal status to `killed`. Killing a completed, failed, or already killed task rejects loudly.

## Examples

```json
{"taskId":"b12345678"}
```

```json
{"taskId":"b1234"}
```

## Output/result

Text result:

```text
Killed background task <name> (<id>). Output: .pi/tasks/.../<id>.output
```

Structured details:

```ts
{ task: BgTaskSnapshot, message: string }
```

## Errors

- Missing/empty id: `Task ID is required`.
- Unknown id/prefix: `Unknown background task ID: <id>`.
- Ambiguous prefix: lists matching task ids.
- Non-running task: `Task <id> is <status>, not running`.
- Platform-specific process termination failures are loud.

## Runtime artifacts

Output and metadata remain under `.pi/tasks/...`. Termination diagnostics may be written into the output file and `error` metadata.

## Safety boundaries

Task control only. POSIX and Windows process-tree semantics differ; Windows force failures report that descendants may have leaked. Shell commands are not sandboxed.

## Related docs

- [`/kill`](../commands/kill.md)
- [`bg_status`](bg_status.md)
- [`bg_logs`](bg_logs.md)
- [Background task runtime](../subsystems/background-task-runtime.md)

## Source ownership/reference

Tool registration lives in `src/extension.ts`; task stopping is owned by [background-task-runtime](../subsystems/background-task-runtime.md).
