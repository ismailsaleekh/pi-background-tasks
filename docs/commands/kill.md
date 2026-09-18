---
doc_id: commands/kill
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:kill]
covers_sources: []
---
# `/kill`

<!-- pi-docs:begin name="command-contract-kill" generator="scripts/docs/generate.mjs" -->
| Command | Description | Provenance |
| --- | --- | --- |
| `/kill` | Stop a running background task: /kill <id> | `src/extension.ts:651` |
<!-- pi-docs:end name="command-contract-kill" -->

Stop a running background task.

## Synopsis


`/kill <task-id-or-prefix>`

## When to use

Use `/kill` when a tracked background task is no longer needed or is hung. Use [`bg_kill`](../tools/bg_kill.md) for the same operation from an agent tool call.

## Defaults

No defaults beyond task id/prefix resolution. Prefixes must be unambiguous.

## Lifecycle

Only `running` tasks can be killed. A successful user kill sets terminal status `killed` and records the task output path. Trying to kill a `completed`, `failed`, or already `killed` task fails loudly.

## Examples

```text
/kill b12345678
/kill b1234
```

## Output/result

```text
Killed <task-name> (<task-id>). Output: .pi/tasks/.../<task-id>.output
```

## Errors

- Missing id: `Task ID is required`.
- Unknown id/prefix: `Unknown background task ID: <id>`.
- Ambiguous prefix: lists matching task ids.
- Non-running task: `Task <id> is <status>, not running`.
- Kill failure: platform-specific loud error.

Errors are shown as `Background kill error: ...`.

## Runtime artifacts

The task's output file and metadata remain in `.pi/tasks/...`. Termination notices and errors may be appended to the output and metadata.

## Safety boundaries

Process termination differs by platform:

- POSIX first targets the detached process group with `SIGTERM`, falls back to the child handle, and escalates to `SIGKILL` after the grace window.
- Windows uses `taskkill.exe /PID <pid> /T`, then `/F` after the grace window. Force failure is surfaced loudly because descendant processes may have leaked.

Shell commands are not sandboxed; killing controls only tracked process handles/trees.

## Related docs

- [`bg_kill`](../tools/bg_kill.md)
- [`/jobs`](jobs.md)
- [`/logs`](logs.md)
- [Background task runtime](../subsystems/background-task-runtime.md)

## Source ownership/reference

Surface registration lives in `src/extension.ts`; process termination is owned by [background-task-runtime](../subsystems/background-task-runtime.md).
