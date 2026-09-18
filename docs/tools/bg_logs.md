---
doc_id: tools/bg_logs
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:bg_logs]
covers_sources: []
---
# `bg_logs`

<!-- pi-docs:begin name="tool-contract-bg_logs" generator="scripts/docs/generate.mjs" -->
- Label: **Background Logs**
- Source: `src/extension.ts:865`
- Description: Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at 50.0KB for model safety and points to the full output file when truncated.
- Root schema: `object`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `maxBytes` | no | `number` | Maximum bytes to return, capped at 50.0KB. Default: 50.0KB. |  |
| `tail` | no | `boolean` | Read the tail of the log when true, head when false. Default: true. |  |
| `taskId` | yes | `string` | Task ID or unambiguous prefix |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "properties": {
    "maxBytes": {
      "description": "Maximum bytes to return, capped at 50.0KB. Default: 50.0KB.",
      "type": "number"
    },
    "tail": {
      "description": "Read the tail of the log when true, head when false. Default: true.",
      "type": "boolean"
    },
    "taskId": {
      "description": "Task ID or unambiguous prefix",
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
<!-- pi-docs:end name="tool-contract-bg_logs" -->

Read bounded output from a background task.

## Schema


Required fields:

- `taskId: string` — exact task id or unambiguous prefix.

Optional fields:

- `maxBytes: number` — normalized to `[1, MAX_LOG_BYTES]`, with a current cap of up to 50 KiB.
- `tail: boolean` — `true` reads the tail; `false` reads the head. Default `true`.

## When to use

Use only when output bytes are needed: after a terminal notification and you need details, when the user asks for logs, when automatic completion was disabled, or when diagnosing a concrete hang.

Do **not** repeatedly call `bg_logs` to wait for completion while a notification is pending.

## Defaults

- `maxBytes`: default bounded log size, currently up to 50 KiB.
- `tail`: `true`.

## Lifecycle

`bg_logs` is a point-in-time file read. Running tasks may append more output later; the tool does not follow or subscribe.

## Examples

```json
{"taskId":"b12345678"}
```

```json
{"taskId":"b1234","maxBytes":4096,"tail":false}
```

## Output/result

Text content is the selected output slice plus a full-output notice. If truncated:

- tail reads prepend `[Showing tail ... Full output: <path>]`,
- head reads append `[Showing head ... Full output: <path>]`.

If not truncated, the result appends `[Full output: <path>]`. Structured details:

```ts
{ task: BgTaskSnapshot, path: string, bytesRead: number, truncated: boolean, tail: boolean }
```

The `path` is the full output path relative to the task cwd, preserved for opening the complete file.

## Errors

- Missing/empty id: `Task ID is required`.
- Unknown id/prefix: `Unknown background task ID: <id>`.
- Ambiguous prefix: lists matching task ids.
- Missing output file: `Output file does not exist for <id>: <path>`.

## Runtime artifacts

Reads `.pi/tasks/<session-id>-<pid>/<task-id>.output`; does not modify output or metadata.

## Safety boundaries

Read-only, bounded, model-safe inspection. It is not a polling primitive. For the larger interactive tail buffer, use the [`/tasks`](../commands/task-manager.md) detail view.

## Related docs

- [`/logs`](../commands/logs.md)
- [`bg_status`](bg_status.md)
- [`bg_run`](bg_run.md)
- [Completion delivery](../concepts/completion-delivery.md)
- [Background task runtime](../subsystems/background-task-runtime.md)

## Source ownership/reference

Tool registration lives in `src/extension.ts`; bounded log reads are owned by [background-task-runtime](../subsystems/background-task-runtime.md).
