---
doc_id: subsystems/host-ui-and-telemetry
audience: maintainer
mode: authored
review_policy: behavioral
stability: stable
covers_surfaces: []
covers_sources: [extensions/background-tasks.ts, src/core/config.ts, src/core/update-check.ts, src/extension.ts, src/ui/background-tasks-manager.ts]
---
# Host UI and telemetry

This subsystem owns the extension entrypoint, command/tool registration, footer dock, task manager UI, completion renderer, and update-available footer notice. Task lifecycle internals are owned by [background-task-runtime](background-task-runtime.md).

## Entrypoint and registration

The published `dist/extensions/background-tasks.js` entrypoint is compiled from `extensions/background-tasks.ts`, which re-exports the authoritative `src/extension.ts`. Only the ordered paths in `package.json.pi.extensions` and the package-owned child extension paths are supported extension roots. Files under `dist/src/**` are private compiled implementation chunks, not standalone Node entrypoints. Importing one directly from an unrelated natively loaded extension bypasses Pi's Jiti host-module aliases and is unsupported. The packed-package gate instead exercises every public lazy lane through the real package entrypoint with no package-local Pi SDK or TypeBox installation.

Before creating the registry or registering a surface, the extension strictly parses the shared capability/shortcut configuration. It dynamically imports delegate/Fusion facade registration only for enabled capabilities; the dock component is imported only when an interactive manager is opened. `process` is mandatory and registers:

- commands: `/bg`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update`, `/jobs`, `/logs`, `/kill`;
- tools: `bg_run`, `bg_status`, `bg_logs`, `bg_kill`;
- shortcut: the selected dock key (`shift+down`, `ctrl+alt+b`, or none for `off`) plus unconditional `ctrl+alt+c`;
- renderer: `background-task-notification`;
- the task UI and EventBus service.

Delegate, Fusion, attested-run, and ambient attribution registrations are independently selected by `PI_BG_FEATURES`. `bg_result` is derived and registered once iff delegate or Fusion is enabled. Disabled facade/attribution modules are absent from the process-only static startup graph rather than merely inactive. Active-tool cleanup is delegated to Pi's registration rebuild: a stale package name with no current definition is dropped, while an active definition from another extension remains active even when it uses a disabled package capability name such as `bg_delegate` or the retired `fusion_brainstorm`. The package does not perform name-wide subtraction. The default selection preserves the complete historical surface. Capability flags alone make no startup-performance claim.

## Agent-visible shell guidance

A dedicated `before_agent_start` hook adds the activation's actual background-shell executable, dialect, and `-c`/cmd argument shape before the model generates a command. The hook uses an independently replaceable prompt section when the host supports structured sections and a chained, idempotent section on older supported hosts. It preserves guidance added by other background-feature hooks in either registration order.

An inherited Nu, fish, csh, or unknown shell is explicitly described as `user-non-posix`, with instructions not to assume Bash syntax and remediation to set `PI_BG_POSIX_SHELL=bash` before startup or `/reload`. The guidance contains only resolved launch facts, not the process environment or credentials. The registry receives the same immutable selection; task snapshots and metadata make that match observable.

## Footer status

The footer widget is updated on task changes and once per second while a session is active. If there are no running tasks and no unseen finished tasks, the background-task footer is cleared unless an update segment is available.

When visible, the footer label includes counts in this order:

1. running,
2. failed,
3. stopped (`killed`),
4. done (`completed`),
5. entry hint (`focused` while the dock is open, otherwise `Shift↓`, `CtrlAltB`, or `/tasks` from the parsed dock setting),
6. `/bg-clear` hint when there are unseen finished tasks **and the dock is closed**,
7. optional update segment.

A finished badge is cleared when that task's detail view is opened, or when `/bg-clear` or its shortcut marks all currently unseen finished tasks as seen. Merely opening the list view or closing the dock does not clear badges.

## Task manager UI

`/tasks`, `/bg-tasks`, and the configured dock shortcut (when not `off`) open the same overlay. The two commands are unconditional process surfaces, including when the shortcut is disabled. Non-interactive contexts receive an error notification directing users to `/jobs`, `/logs`, `bg_status`, or `bg_logs`.

The list view supports selection, paging, stop, confirmed stop-all, history toggle, rerun, output path, and close. Rerun is shell-task-only: typed delegate and Fusion tasks fail with guidance to relaunch through their owning tool rather than executing their display command as a shell command. Rerunning an opted survivor preserves `surviveReload:true`, but it is a new execution with a new id/nonce and the current activation's shell policy, timeout, and output cap. The detail view shows task identity, status, runtime, output path, description, task-owned model/context/tokens/tools when reported, command, error, and an output tail.

Detail output semantics:

- reads a UI-only tail buffer of 128 KiB;
- refreshes every second only while following;
- shows 12 output lines;
- scrolling up pauses follow and freezes the buffer;
- reaching the bottom or pressing `r` resumes follow;
- missing output files and read failures are displayed in the detail box.

## Completion rendering

`background-task-notification` renders `[bg completed]`, `[bg failed]`, `[bg killed]`, or other status with task name, id, output path, and error. The notification content itself is produced by the runtime and may trigger a follow-up turn depending on task flags.

## Update check

The update check is one-shot per extension runtime, launched after `session_start` without blocking session startup. It is skipped for `PI_BG_DISABLE_UPDATE_CHECK=1`, `PI_OFFLINE=1`, or missing installed version. The npm registry URL defaults to `https://registry.npmjs.org` and can be overridden by `PI_BG_REGISTRY_URL`. Fetch is time-boxed by `DEFAULT_UPDATE_TIMEOUT_MS` (2000 ms) and every network/status/payload failure resolves to no update segment.

When a newer semver is found, the footer segment is `⬆ v<latest> /bg-update`. `/bg-update` prints npm/git install instructions only; it never installs or self-updates.

## Telemetry display

The host UI displays telemetry only from task snapshots: context, model, token totals, and tool counts. When unavailable, detail rows say `not reported by this background task`. The UI never copies telemetry from the parent session into a task.

## Shutdown

On session shutdown, one early synchronous lifecycle fence permanently closes the activation. Only `reason:"reload"` may first detach admission-committed `surviveReload:true`, `isAgent:false` ordinary executions; detachment removes the old host adapter before any await while preserving logical publication and notification state. The same call stack then closes admissions, aborts admission-owned cancellation scopes, closes registry publication and the EventBus service, clears pending retry/status handles, suppresses old-host notifications, closes every enabled Fusion/delegate/result lazy lane, aborts Fusion controllers, and aborts delegate preparation. The entrypoint registers this shared fence before any facade asynchronous cleanup, so sequential Pi dispatch cannot pause with another old lane still open. Later handlers drain workflow/preparation/admission-owned subprocess, file, and managed cleanup; kill every remaining registry-owned task with the specific lifecycle reason; and report cleanup failures through the UI when possible. Preflight that crosses closure cannot insert, spawn, or return EventBus success.

The first fresh `session_start` callback synchronously claims the exact `(process.pid, session id, canonical cwd)` slot, imports/durably audits the same task records, commits the fresh adapter, then allows existing UI/status/update setup. Completion during the gap queues for that adapter. Status, logs, kill, commands, and dock therefore use the same id/PID/path/nonce/execution after reload. A malformed new activation or removed extension cannot steal the owner; its fixed handoff deadline cleans up.

Shutdown terminal metadata and task waiters remain truthful even when old-activation EventBus publication is abandoned. Shutdown is idempotent, including handle cleanup on repeated calls. `session_start` rechecks activation after runtime-directory setup and before status interval/update-check creation, so an overlapping late continuation cannot recreate old resources. Pi `AgentSession.reload()` replaces the extension runner; `AgentSessionRuntime` new/switch/fork/clone/dispose flows do not claim reload handoffs and kill opted work. Kill-on-reload remains the default unless an ordinary task explicitly opts in. Hard crash/restart survival is not supported.

## Related docs

- [Shortcuts and dock](../reference/shortcuts-and-dock.md)
- [`/tasks` and `/bg-tasks`](../commands/task-manager.md)
- [`/bg-clear`](../commands/bg-clear.md)
- [`/bg-update`](../commands/bg-update.md)
- [Completion delivery](../concepts/completion-delivery.md)
- [Background task runtime](background-task-runtime.md)

## Source ownership/reference

Primary source ownership for this document is `extensions/background-tasks.ts`, `src/extension.ts`, `src/core/update-check.ts`, and `src/ui/background-tasks-manager.ts`.
