---
doc_id: subsystems/background-task-runtime
audience: maintainer
mode: authored
review_policy: behavioral
stability: stable
covers_surfaces: []
covers_sources: [src/core/common.ts, src/core/registry.ts, src/core/reload-shell-owner.ts, src/core/shell-policy.ts, src/core/windows-taskkill.ts]
---
# Background task runtime

The runtime owns task identity, shell invocation, process lifecycle, bounded logs, metadata, telemetry ingestion, completion publication, and platform termination.

## Core contracts

- Task statuses are exactly `running`, `completed`, `failed`, and `killed`.
- Terminal statuses are exactly `completed`, `failed`, and `killed`.
- Runtime directory: `.pi/tasks/<session-id>-<pid>/` under the project cwd.
- Per task: `<task-id>.output` and `<task-id>.json`; some agent modes may add wrapper or attestation files. Ordinary shell-task snapshots and metadata include the non-secret activation shell facts (`policy`, `executable`, `argvPrefix`, and `dialect`) used for that launch. New records also emit `surviveReload`; missing legacy fields mean false. Opted records carry `reloadSurvival` audit facts, but those bytes never grant process authority or permit adoption.
- In-memory recent retention prunes oldest finished tasks over the limit while preserving running tasks and newest-result recency. If the oldest finished task still owns pending publication, pruning first abandons and disposes that publication as `retention_limit`; pending gates cannot force eviction of a newer result or grow retained finished tasks without bound.
- `resolveTask` accepts exact ids or unambiguous prefixes and fails loudly for empty, unknown, or ambiguous ids.

## Task admission

Every registry starter (ordinary, managed, delegate, and attested Pi) holds a counted admission scope with a one-way `AbortSignal` and a 30 second overall preflight deadline. Session shutdown closes admissions and aborts every live scope before cleanup. Cooperative preflight receives that signal; all other started operations remain tracked until they settle. Insertion plus spawn retain immediate checks with no yielding gap between them. Shutdown drains accepted admissions before taking its running-task snapshot. Therefore a preflight crossing closure cannot insert or spawn, while a child that spawned before closure was already inserted and is owned by shutdown cleanup.

Interrupted managed work is cancelled immediately and its workflow/child cleanup promise is awaited before the lease is released; if it was already inserted, terminal finalization remains registry-owned. A process child already inserted/spawned is bound to the admission signal and receives the normal stop path even while an admission-time metadata write is still settling. Interrupted wrapper/durable-file preflight awaits opened-handle/stream cleanup and removes owned partial task files. Node does not provide physical cancellation for every filesystem syscall: such a syscall remains admission-owned and shutdown waits for its settlement rather than racing it and allowing late artifact work. Cleanup failures are surfaced; they are not treated as successful cancellation.

For reload survival, only an opted ordinary execution whose initial metadata write and admission commit both completed is transferable. A pre-commit child remains old-registry shutdown work and can never appear in a reload claim. If its bounded stop wait fails, caller admission still rejects and the task leaves the registry, but the process-global owner retains the child, streams, listeners, tree state, and timers without a host adapter until actual terminal settlement permits release.

## Starting managed tasks

`startManagedTask` tracks a package-owned in-process asynchronous workflow through the same metadata, output, dock, status, logs, kill, EventBus terminal, and notification surfaces as process tasks. Fusion uses this path only after its no-child-yet durable preflight barrier. Managed cancellation invokes a task-owned callback; terminal state is not published until the workflow promise has settled and completed its own child cleanup/audit sealing.

Managed task ids are explicit and path-safe. Fusion uses its run id as the single task/run identity. Progress is written as bounded task output and persisted in Fusion task facts. `claimFusionUsage` serializes a once-only durable accounting claim so repeated `bg_result` calls cannot duplicate usage.

## Starting ordinary tasks

`startTask` trims surrounding command whitespace and rejects an empty command. It derives task name from explicit `name`, then `description`, then command. Names are compacted and truncated; callers should still provide concise names.

Shell commands are spawned in the task cwd using `stdio: ['ignore','pipe','pipe']`, `windowsHide:true`, the extension environment, and detached process groups on non-Windows. Shell commands are **not sandboxed**.

Default delivery at registry level is `notifyOnCompletion:true` and `triggerOnCompletion:false`; surface tools may override that. [`bg_run`](../tools/bg_run.md) explicitly defaults both to true.

`surviveReload:true` is opt-in and requires `isAgent:false`. Validation occurs before admission timers, runtime directories, files, wrappers, insertion, or spawn. The task keeps the exact same child, PID, detached group/tree authority, pipes, output stream/path, launch nonce, completion id, shell policy, timeout deadline, output cap, and cumulative byte count across a supported reload. It is never restarted. Agent, managed, delegate, Fusion, and attested work refuse survival-shaped input; EventBus request v1 cannot request it. Dock rerun preserves the flag but creates a new execution/id/nonce under the current activation policy.

## Shell policy

One immutable policy is resolved per extension activation and shared by actual registry spawns and the agent-visible guidance hook. Mutating shell-selection environment variables cannot change that activation; `/reload` creates a new activation and resolves them again.

On non-Windows platforms, `PI_BG_POSIX_SHELL` accepts exactly `inherit`, `bash`, or `sh` and defaults to `inherit`:

- `inherit` preserves compatibility: use a non-empty `$SHELL`, otherwise `/bin/sh`, with `-c <command>`. The inherited executable is not replaced or turned into a login shell.
- `bash` checks executable `/bin/bash` first, then checks `bash` in `PATH` order.
- `sh` checks executable `/bin/sh` first, then checks `sh` in `PATH` order.

`PI_BG_POSIX_SHELL_PATH` is accepted only with explicit `bash` or `sh`. It must be a non-empty absolute path whose target is a regular executable file. A bad explicit path fails without falling back to search. The selected path is passed as the spawn executable and is never interpolated into the command. Bash and sh use `-c`, never `-lc`.

Inherited basename `bash` is classified as Bash. Reviewed Bourne-family shells (`sh`, `dash`, `ash`, `ksh`, `ksh93`, `mksh`, `pdksh`, `zsh`, `yash`, and `posh`) are classified as POSIX-function compatible. Nu, fish, csh/tcsh, and unknown names are reported as `user-non-posix`; they are never mislabeled as POSIX or Bash. This classification does not validate or replace an inherited executable, preserving existing spawn-failure behavior.

Windows ignores both POSIX variables. It defaults to `cmd.exe` or `ComSpec`, with args `['/d','/s','/c','"<command>"']` and `windowsVerbatimArguments:true`. `PI_BG_SHELL=cmd|bash` can select a shell; `PI_BG_SHELL_PATH` is accepted only with `PI_BG_SHELL` and must be an absolute `.exe`/`.com` path. `PI_BG_SHELL=bash` without a path searches PATH for `bash.exe` or `bash.com`; unresolved or invalid Windows shell settings fail before creating a task. Existing structured argv behavior is unchanged.

## Logs and output caps

All child stdout/stderr is written to the output file unless it is recognized control telemetry from a wrapped Pi agent. The runtime enforces `PI_BG_MAX_OUTPUT_BYTES` or the default 20 MiB output cap; exceeding it appends an error notice, kills the task, and finalizes as `failed`.

Model-visible log reads use bounded file reads capped by `MAX_LOG_BYTES` (currently up to 50 KiB). Truncated reads preserve the full output path in the notice.

## Telemetry

Telemetry is task-owned. It is parsed from task output/control lines when the task reports it; it is never copied from the parent session. Optional telemetry includes context usage, token usage, tool usage, and model. Malformed optional telemetry is ignored without clearing prior task state; unknown wrapped-agent JSON is written to the transcript rather than silently dropped.

`isAgent` explicitly controls telemetry wrapping. If `isAgent:false`, a `pi -p` command is treated as an ordinary command. If `isAgent:true`, the command contains an interceptable `pi -p`, `pi --print`, or `pi --mode json` invocation, and the resolved policy supports POSIX function syntax, the runtime writes a wrapper and converts Pi JSON events into task-owned metrics and human transcript lines. Path-qualified `pi` commands are not intercepted. Capability, not a generic “non-Windows” label, controls injection: Windows cmd records `win32-cmd-cannot-safely-intercept-pi-argv`, while an inherited Nu/fish/csh/unknown shell records `user-non-posix-shell-cannot-safely-intercept-pi-argv`. Neither route receives a Bash/POSIX function wrapper.

## Finalization and completion

A child closing with code `0` becomes `completed` unless killed/timeout/cap state overrides it. Nonzero exit becomes `failed` with `Exited with code ...`. User or shutdown kills become `killed`; timeout and output cap become `failed`.

During finalization, the runtime flushes wrapped-agent output, ends and waits for the output stream to finish/close, writes terminal metadata through the durable metadata path, updates waiters, initiates terminal EventBus publication, sends the completion notification when enabled and not shutting down, persists notification state, then prunes old finished tasks. After a POSIX tree stop, finalization first waits for the originally owned detached group to be observed gone or records a loud failed result when force/proof fails; direct-child close alone cannot publish successful cleanup. Actual EventBus emission may wait behind the run-response publication gate and therefore may occur after the completion notification; it still occurs only after stream close and terminal metadata. The registry calls a historically named `closeAndFsyncOutputStream()` helper, but its current implementation ends and observes the stream rather than issuing `fsync` for ordinary `.output`; durable terminal truth refers to the metadata-backed status, not a stronger crash-durability guarantee for every output byte.

Terminal EventBus publication has separate `pending`, `delivered`, and `abandoned` truth. The legacy internal `terminalPublished` latch means delivered only; abandonment never sets it. A genuine synchronous emitter failure is retried after 100 ms, up to three total emit attempts. Exhaustion abandons publication with bounded diagnostics. Since an earlier listener can receive before a later listener throws, retries are at-least-once and consumers deduplicate by task id.

Publication gates race both activation closure and task-local abandonment. Gate resolution is followed by a lifecycle re-check; gate rejection abandons publication; shutdown, publisher disposal, or retention pruning clears gate references and retry timers. A late gate cannot emit or re-arm an old registry, and pruning an old gate releases its waiting continuation. These outcomes do not rewrite durable task status, waiter completion, or notification receipt state.

Synchronous emission has its own in-flight settlement phase. Reentrant shutdown/service close clears queued work but does not log abandonment or prune that task while its emitter is on the stack. A normal emitter return settles delivered. A throw settles abandonment/retry policy once only while that registry still owns the exact task; if the emitter synchronously transferred reload ownership before throwing, the old catch leaves the ledger pending with that attempt consumed and schedules no old retry. This prevents contradictory abandoned-then-delivered outcomes while preserving ordinary non-handoff close behavior.

For a survivor, pending/delivered/abandoned state and the attempt count move with the live execution. Reload clears old physical gates/retry handles without recording abandonment; a fresh adapter resumes the same cumulative three-attempt budget, including after a reentrant transferred throw. A terminal close during the hostless gap is queued. Notification uses a task-owned sending token, so a successful old or fresh send latches `notified` once and reload never resets it.

## Stopping tasks

Only `running` tasks can be stopped. Managed tasks invoke their task-owned cancellation callback and wait for workflow settlement; process tasks use the platform paths below.

Session shutdown atomically closes task admission before managed-workflow cleanup starts. For a real `reason:"reload"`, it first detaches and removes only admission-committed opted ordinary executions, then closes old publication/EventBus and applies normal stop paths to everything else. Pending survivor publication is transferred without false abandonment. For `quit`, `new`, `resume`, or `fork` (including clone), nothing transfers: all work follows normal cleanup. Registry admission/publication closure is one-way; stale lifecycle, admission, gate, lease, claim, adapter, and retry continuations cannot mutate a newer activation.

## Same-process reload owner

`src/core/reload-shell-owner.ts` installs a structurally checked process-global v1 hub under `Symbol.for('pi-background-tasks.reload-shell-owner.v1')`. Identity is the length-delimited tuple `(process.pid, exact session id, canonical cwd)`. It uses random activation/claim nonces, monotonic generations, and a two-phase claim: the fresh registry imports the same task objects and durably advances audit facts before the adapter becomes visible. There is no `instanceof` protocol test, metadata scan, PID adoption, external daemon, or liveness-derived exit result.

The adapter is the only retained closure over the current registry/Pi/EventBus/notification host and is removed synchronously before shutdown awaits. The owner retains only the living Node child, pipes/listeners, stream, timers, immutable launch facts, tree authority, metadata chain, and logical delivery state. A fixed referenced 30-second handoff deadline is not reset by claim/abort. No compatible claimant (including extension removal, config/factory failure, or an incompatible package copy) triggers retained-tree cleanup and `pi_bg_reload_handoff_expired`; a real close code/signal and tree proof remain required. A bounded stop timeout never releases those resources: one owner-only terminal continuation removes the execution and empty slot if a close settles later. If close/tree proof never arrives, force/proof uncertainty stays loud and retains minimal authority rather than fabricating cleanup or permitting a conflicting activation.

Supported scope is same-process normal Pi reload with the same session id and canonical cwd. Hard crash, SIGKILL, power loss, process restart, resume/new/fork/clone, and PID/file reconstruction are unsupported. Normal TUI/RPC/print/JSON modes provide lifecycle binding. Empty or mode-only SDK reload lacks the fresh `session_start` in Pi 0.84/0.86 and is blocked upstream; direct `AgentSession.dispose()` also lacks `session_shutdown`, while `AgentSessionRuntime.dispose()` is supported.

POSIX stop path:

1. use the immutable process-group id captured directly from the detached spawn (never a restored metadata PID), and publish one shared grace/force owner before signaling,
2. send `SIGTERM` to that process group (`-pid`), falling back to the child handle's `kill` when the group signal fails,
3. if the direct child closes, probe the still-owned group; only `ESRCH` disarms escalation,
4. after the grace window, probe and send at most one group `SIGKILL`, then perform bounded signal-0 probes until `ESRCH`,
5. on force failure or inability to prove the group gone within the stop window, report `failed` with `Descendant processes may have leaked` rather than claim a successful kill.

The POSIX grace/proof owner remains referenced after leader close, is shared by concurrent stop requests, and is permanently disarmed once group absence is observed so it cannot later signal a reused group id. This proves process-group disappearance for the ordinary local case; it does not claim that Node reaps grandchildren or that signals can cure a kernel-uninterruptible process. Such a limit is surfaced as a bounded cleanup failure.

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

Primary source ownership for this document is `src/core/common.ts`, `src/core/registry.ts`, `src/core/reload-shell-owner.ts`, `src/core/shell-policy.ts`, and `src/core/windows-taskkill.ts`.
