---
doc_id: commands/logs
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:logs]
covers_sources: []
---
# `/logs`

<!-- pi-docs:begin name="command-contract-logs" generator="scripts/docs/generate.mjs" -->
| Command | Availability | Default | Description | Provenance |
| --- | --- | --- | --- | --- |
| `/logs` | `always` | yes | Show bounded output from a background task: /logs <id> [maxBytes] | `src/extension.ts:863` |
<!-- pi-docs:end name="command-contract-logs" -->

Show bounded output from a background task.

## Synopsis


`/logs <task-id-or-prefix> [maxBytes]`

Slash-command logs always read the tail.

## When to use

Use `/logs` when you need task output in the host UI. For agent tool calls, use [`bg_logs`](../tools/bg_logs.md) and avoid repeated calls as a waiting loop.

## Defaults

- `maxBytes`: defaults to the model-safe log cap, currently up to 50 KiB.
- Values are normalized to an integer in `[1, MAX_LOG_BYTES]`; invalid numbers use the default.
- `tail`: always `true` for `/logs`.

## Lifecycle

`/logs` is a point-in-time read of the output file. It does not subscribe, follow, or poll. Running tasks may produce more output after the read.

## Examples

```text
/logs b12345678
/logs b1234 2000
```

## Output/result

The notification contains output text. If truncated, a notice is prepended for tail reads:

```text
[Showing tail <bytes-read> of <total>; <omitted> omitted. Full output: .pi/tasks/.../<task-id>.output]
```

If not truncated, the result ends with:

```text
[Full output: .pi/tasks/.../<task-id>.output]
```

The full output path is preserved even when model-visible bytes are bounded.

## Errors

- Missing id: `Task ID is required`.
- Unknown id/prefix: `Unknown background task ID: <id>`.
- Ambiguous prefix: lists matching task ids.
- Missing output file: `Output file does not exist for <id>: <path>`.

Errors are shown as `Background logs error: ...`.

## Runtime artifacts

Reads `.pi/tasks/<session-id>-<pid>/<task-id>.output`; does not modify output or metadata.

## Safety boundaries

Read-only bounded inspection. It is not a polling primitive and should not be used merely to wait for completion.

## Related docs

- [`bg_logs`](../tools/bg_logs.md)
- [`/jobs`](jobs.md)
- [`/kill`](kill.md)
- [Background task runtime](../subsystems/background-task-runtime.md)

## Source ownership/reference

Surface registration lives in `src/extension.ts`; bounded log reading is owned by [background-task-runtime](../subsystems/background-task-runtime.md).
