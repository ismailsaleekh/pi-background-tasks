---
doc_id: subsystems/background-task-runtime
audience: maintainer
mode: authored
review_policy: behavioral
stability: stable
covers_surfaces: []
covers_sources: [src/core/common.ts, src/core/registry.ts, src/core/store-root.ts, src/core/windows-taskkill.ts]
---
# Background task runtime

The runtime owns task identity, shell invocation, process lifecycle, bounded logs, metadata, telemetry ingestion, completion publication, and platform termination.

## Core contracts

- Task statuses are exactly `running`, `completed`, `failed`, and `killed`.
- Terminal statuses are exactly `completed`, `failed`, and `killed`.
- Runtime directory: `.pi/tasks/<session-id>-<pid>/` under the project cwd, or `<PI_BG_RUNTIME_ROOT>/tasks/<session-id>-<pid>/` when `PI_BG_RUNTIME_ROOT` is set (see [Configuration](../operations/configuration.md)).
- Per task: `<task-id>.output` and `<task-id>.json`; some agent modes may add wrapper or attestation files.
- In-memory recent retention prunes oldest finished tasks over the limit while preserving running tasks.
- `resolveTask` accepts exact ids or unambiguous prefixes and fails loudly for empty, unknown, or ambiguous ids.

## Starting managed tasks

`startManagedTask` tracks a package-owned in-process asynchronous workflow through the same metadata, output, dock, status, logs, kill, EventBus terminal, and notification surfaces as process tasks. Fusion uses this path only after its no-child-yet durable preflight barrier. Managed cancellation invokes a task-owned callback; terminal state is not published until the workflow promise has settled and completed its own child cleanup/audit sealing.

Managed task ids are explicit and path-safe. Fusion uses its run id as the single task/run identity. Progress is written as bounded task output and persisted in Fusion task facts. `claimFusionUsage` serializes a once-only durable accounting claim so repeated `bg_result` calls cannot duplicate usage.

## Starting ordinary tasks

`startTask` trims surrounding command whitespace and rejects an empty command. It derives task name from explicit `name`, then `description`, then command. Names are compacted and truncated; callers should still provide concise names.

Shell commands are spawned in the task cwd using `stdio: ['ignore','pipe','pipe']`, `windowsHide:true`, the extension environment, and detached process groups on non-Windows. Shell commands are **not sandboxed**.

Default delivery at registry level is `notifyOnCompletion:true` and `triggerOnCompletion:false`; surface tools may override that. [`bg_run`](../tools/bg_run.md) explicitly defaults both to true.

## Shell policy

POSIX uses `$SHELL` when set, otherwise `/bin/sh`, with `-c <command>`.

Windows defaults to `cmd.exe` or `ComSpec`, with args `['/d','/s','/c','"<command>"']` and `windowsVerbatimArguments:true`. `PI_BG_SHELL=cmd|bash` can select a shell; `PI_BG_SHELL_PATH` is accepted only with `PI_BG_SHELL` and must be an absolute `.exe`/`.com` path. `PI_BG_SHELL=bash` without a path searches PATH for `bash.exe` or `bash.com`; unresolved or invalid shell settings fail before creating a task.

## Logs and output caps

All child stdout/stderr is written to the output file unless it is recognized control telemetry from a wrapped Pi agent. The runtime enforces `PI_BG_MAX_OUTPUT_BYTES` or the default 20 MiB output cap; exceeding it appends an error notice, kills the task, and finalizes as `failed`.

Model-visible log reads use bounded file reads capped by `MAX_LOG_BYTES` (currently up to 50 KiB). Truncated reads preserve the full output path in the notice.

## Telemetry

Telemetry is task-owned. It is parsed from task output/control lines when the task reports it; it is never copied from the parent session. Optional telemetry includes context usage, token usage, tool usage, and model. Malformed optional telemetry is ignored without clearing prior task state; unknown wrapped-agent JSON is written to the transcript rather than silently dropped.

`isAgent` explicitly controls telemetry wrapping. If `isAgent:false`, a `pi -p` command is treated as an ordinary command. If `isAgent:true` and the POSIX command contains an interceptable `pi -p`, `pi --print`, or `pi --mode json` invocation, the runtime writes a wrapper and converts Pi JSON events into task-owned metrics and human transcript lines. Path-qualified `pi` commands are not intercepted. On Windows cmd, telemetry wrapping is unavailable and the task records `win32-cmd-cannot-safely-intercept-pi-argv`.

## Finalization and completion

A child closing with code `0` becomes `completed` unless killed/timeout/cap state overrides it. Nonzero exit becomes `failed` with `Exited with code ...`. User or shutdown kills become `killed`; timeout and output cap become `failed`.

During finalization, the runtime flushes wrapped-agent output, ends and waits for the output stream to finish/close, writes terminal metadata through the durable metadata path, updates waiters, initiates terminal EventBus publication, sends the completion notification when enabled and not shutting down, persists notification state, then prunes old finished tasks. Actual EventBus emission may wait behind the run-response publication gate and therefore may occur after the completion notification; it still occurs only after stream close and terminal metadata. The registry calls a historically named `closeAndFsyncOutputStream()` helper, but its current implementation ends and observes the stream rather than issuing `fsync` for ordinary `.output`; durable terminal truth refers to the metadata-backed status, not a stronger crash-durability guarantee for every output byte.

## Stopping tasks

Only `running` tasks can be stopped. Managed tasks invoke their task-owned cancellation callback and wait for workflow settlement; process tasks use the platform paths below.

POSIX stop path:

1. send `SIGTERM` to the detached process group (`-pid`),
2. if that fails, call the child handle's `kill`,
3. after the grace window, send one `SIGKILL` escalation.

Windows stop path:

1. run `%SystemRoot%\System32\taskkill.exe /PID <pid> /T`, or `%WINDIR%` fallback,
2. after the grace window, abort the soft helper and run `/F`,
3. treat taskkill exit 128 as an already-exited race,
4. surface force failures loudly with `Descendant processes may have leaked`.

Windows never falls back to root-only `child.kill` for tree termination. The taskkill helper uses structured argv, `shell:false`, bounded stdout/stderr capture, external abort, and a helper timeout.

## Related docs

- [`bg_run`](../tools/bg_run.md)
- [`bg_status`](../tools/bg_status.md)
- [`bg_logs`](../tools/bg_logs.md)
- [`bg_kill`](../tools/bg_kill.md)
- [Completion delivery](../concepts/completion-delivery.md)
- [Host UI and telemetry](host-ui-and-telemetry.md)

## Source ownership/reference

Primary source ownership for this document is `src/core/common.ts`, `src/core/registry.ts`, `src/core/store-root.ts`, and `src/core/windows-taskkill.ts`.
