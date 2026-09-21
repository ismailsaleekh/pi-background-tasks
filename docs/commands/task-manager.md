---
doc_id: commands/task-manager
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:bg-tasks, command:tasks]
covers_sources: []
---
# `/tasks` and `/bg-tasks`

<!-- pi-docs:begin name="command-contract-tasks-bg-tasks" generator="scripts/docs/generate.mjs" -->
| Command | Availability | Default | Description | Provenance |
| --- | --- | --- | --- | --- |
| `/tasks` | `always` | yes | Open the Claude-like background task manager UI | `src/extension.ts:777` |
| `/bg-tasks` | `always` | yes | Open the background task manager UI | `src/extension.ts:785` |
<!-- pi-docs:end name="command-contract-tasks-bg-tasks" -->

Open the interactive background task manager. `/tasks` and `/bg-tasks` are aliases.

## Synopsis


`/tasks [exact-task-id]`

`/bg-tasks [exact-task-id]`

## When to use

Use the task manager when you want the host UI: select tasks, inspect a live output tail, stop one or all running tasks, rerun a task, copy/show an output path, or review recent finished task history.

## Defaults

- No argument opens the list view.
- An exact task id opens detail view for that task and marks it seen in the footer. Unlike `/logs`, `/kill`, and the task tools, this optional UI argument is not prefix-resolved.
- If there are no running tasks but finished history exists, the list opens in history mode.

## Lifecycle

The manager is an overlay dock. Opening it sets the footer hint to `focused` and temporarily hides the `/bg-clear` hint; closing returns the footer to the configured `Shift↓`, `CtrlAltB`, or `/tasks` hint. `PI_BG_DOCK_SHORTCUT=off` disables only the key registration—both commands on this page continue to work. Opening a finished task's detail view marks that task seen. Merely opening the list or closing the dock does **not** clear other finished badges; use [`/bg-clear`](bg-clear.md) to clear them together.

List view sorts tasks as running, failed, killed, then completed; within a status, newest terminal/start time appears first. Status labels shown in the UI are `running`, `error` for `failed`, `stopped` for `killed`, and `done` for `completed`.

## Examples

```text
/tasks
/bg-tasks b1234
```

## Output/result

This command opens UI only. In non-interactive mode, it emits an error notification:

```text
Background task manager requires an interactive Pi UI. Use /jobs, /logs, or the bg_status/bg_logs tools in non-interactive mode.
```

## Controls

List view:

- `↑`/`↓`: select.
- `PgUp`/`PgDn`: page selection.
- `Enter`/`→`: open output detail.
- `k`: stop selected running task.
- `a`, `A`, or `K`: stop all running tasks; press again to confirm.
- `h`: show/hide history.
- `R`: rerun selected task with notification enabled and wake disabled.
- `c`/`C`: show output path.
- `Esc`, `q`, `Q`, `x`, `X`: close.

Detail view:

- `←`: return to list.
- `↑`/`↓`/`PgUp`/`PgDn`: scroll output.
- `r`: refresh and resume following tail.
- `k`: stop running task.
- `R`: rerun task.
- `c`/`C`: show output path.
- close keys are the same as list view.

## Detail output tail semantics

The detail view reads a UI-only tail buffer of 128 KiB once per second while following. It displays 12 output lines. Scrolling up pauses live following and freezes the buffer so the view stays stable. Scrolling/pageing back to the bottom resumes follow mode; `r` also resumes follow and refreshes. This UI tail is larger than the model-facing log cap and is separate from [`bg_logs`](../tools/bg_logs.md).

## Errors

Stop, stop-all, rerun, and output-read failures are reported inside the dock as action messages. A missing output file appears as `Output file not found: <path>`.

## Runtime artifacts

The manager reads task snapshots and output files from the current extension runtime. It does not reattach to detached historical OS processes after Pi shutdown/reload.

## Safety boundaries

Stopping uses the same runtime kill path as [`/kill`](kill.md) and [`bg_kill`](../tools/bg_kill.md). Shell commands are not sandboxed; the manager only controls tracked tasks.

## Related docs

- [Shortcuts and dock](../reference/shortcuts-and-dock.md)
- [`/jobs`](jobs.md)
- [`/logs`](logs.md)
- [`/kill`](kill.md)
- [Host UI and telemetry](../subsystems/host-ui-and-telemetry.md)

## Source ownership/reference

Surface registration and dock wiring live in `src/extension.ts`; UI behavior is implemented in `src/ui/background-tasks-manager.ts` and owned by [host-ui-and-telemetry](../subsystems/host-ui-and-telemetry.md).
