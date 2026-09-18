---
doc_id: commands/bg
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:bg]
covers_sources: []
---
# `/bg`

<!-- pi-docs:begin name="command-contract-bg" generator="scripts/docs/generate.mjs" -->
| Command | Description | Provenance |
| --- | --- | --- |
| `/bg` | Start a shell command as a tracked background task: /bg [--agent] [--name "Task name"] <command> | `src/extension.ts:519` |
<!-- pi-docs:end name="command-contract-bg" -->

Start a shell command as a tracked background task from the command line.

## Synopsis


`/bg [--agent|--llm-agent] [--script|--no-agent] [--name <name>|-n <name>] [--] <command>`

`--name=<name>` and `-n=<name>` are also accepted. Quoted names are parsed by the extension before the remaining bytes become the shell command.

## When to use

Use `/bg` for user-driven long-running commands where you want a footer entry, output file, and display notification, but **not** an automatic agent follow-up turn. For agent-driven launches, prefer [`bg_run`](../tools/bg_run.md) because its default completion delivery wakes the agent.

## Defaults

- `isAgent`: `false`; set `--agent`/`--llm-agent` only when the command launches a Pi/LLM agent whose telemetry should be wrapped.
- `--script`/`--no-agent`: forces `isAgent:false` after earlier flags.
- `notifyOnCompletion`: `true`.
- `triggerOnCompletion`: `false` for `/bg`, so completion is display-only by default.
- Task name: explicit `--name` if present, otherwise derived from the command.

## Lifecycle

The command returns after the child process is spawned and reports task id, output path, and command. Terminal statuses are exactly `running`, `completed`, `failed`, or `killed`. A finished footer badge remains visible until that task's detail view is opened or [`/bg-clear`](bg-clear.md) marks unseen finished tasks seen.

## Examples

```text
/bg --name "Docs build" npm run docs
/bg --agent --name "Child Pi" pi -p "summarize this repo"
/bg --name="Server" -- npm run dev -- --host 127.0.0.1
```

## Output/result

Start notification:

```text
Started <task-name> (<task-id>)
Output: .pi/tasks/<session>-<pid>/<task-id>.output
Command: <command>
```

Completion is delivered as a durable `background-task-notification` custom message when notifications are enabled, but `/bg` sets `triggerOnCompletion:false` so it does not start a provider follow-up turn.

## Errors

- Empty command: `Background command is empty`.
- Missing or unterminated `--name`: `requires a task name`.
- Shell/spawn errors fail the task loudly and write failure metadata.
- Unknown shell policy on Windows can reject the launch before a task is created.

## Runtime artifacts

Outputs and metadata are written under `.pi/tasks/<session-id>-<pid>/` as `<task-id>.output` and `<task-id>.json`. Model-visible log reads are bounded; the full output path is preserved in notices.

## Safety boundaries

Shell commands are **not sandboxed**. They run in the current project cwd through the platform shell selected by the runtime. `/bg` tracks and kills the child process/tree, but does not restrict filesystem, network, or subprocess behavior.

## Related docs

- [`bg_run`](../tools/bg_run.md)
- [`/jobs`](jobs.md)
- [`/logs`](logs.md)
- [`/kill`](kill.md)
- [`/bg-clear`](bg-clear.md)
- [Background task runtime](../subsystems/background-task-runtime.md)
- [Completion delivery](../concepts/completion-delivery.md)

## Source ownership/reference

Surface registration lives in `src/extension.ts`; argument parsing and lifecycle behavior are owned by [background-task-runtime](../subsystems/background-task-runtime.md).
