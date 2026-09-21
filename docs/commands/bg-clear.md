---
doc_id: commands/bg-clear
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:bg-clear]
covers_sources: []
---
# `/bg-clear`

<!-- pi-docs:begin name="command-contract-bg-clear" generator="scripts/docs/generate.mjs" -->
| Command | Availability | Default | Description | Provenance |
| --- | --- | --- | --- | --- |
| `/bg-clear` | `always` | yes | Clear finished background task footer notices | `src/extension.ts:793` |
<!-- pi-docs:end name="command-contract-bg-clear" -->

Clear finished background task footer notices.

## Synopsis


`/bg-clear`

## When to use

Use this after you have seen completed, failed, or killed task badges in the footer and want to remove those finished counts from the dock status.

## Defaults

No arguments. It only marks currently unseen finished tasks as seen.

## Lifecycle

A finished task's footer badge is marked seen when its detail view opens. `/bg-clear` or the equivalent shortcut marks every currently unseen finished task seen at once. Merely opening the list view or closing the task manager does not clear badges. Running task counts remain visible after clearing finished notices.

## Examples

```text
/bg-clear
```

## Output/result

Interactive notification:

- `Cleared N finished background task notice(s).` when at least one unseen finished task was marked seen.
- `No finished background task notices to clear.` when none were pending.

## Errors

No task-resolution errors; the command operates on the in-memory task registry.

## Runtime artifacts

No task files are deleted. Output and metadata under `.pi/tasks/...` remain intact.

## Safety boundaries

`/bg-clear` does not kill, prune, or modify tasks. It only updates the host UI's seen set for this extension runtime.

## Related docs

- [Shortcuts and dock](../reference/shortcuts-and-dock.md)
- [`/tasks` and `/bg-tasks`](task-manager.md)
- [Host UI and telemetry](../subsystems/host-ui-and-telemetry.md)

## Source ownership/reference

Surface registration lives in `src/extension.ts`; footer behavior is owned by [host-ui-and-telemetry](../subsystems/host-ui-and-telemetry.md).
