---
doc_id: api/eventbus-v1
audience: maintainer
mode: mixed
review_policy: behavioral
stability: evolving
covers_surfaces: [eventbus:background-task-v1]
covers_sources: [src/core/extension-api.ts]
---
# EventBus API v1

<!-- pi-docs:begin name="eventbus-contract" generator="scripts/docs/generate.mjs" -->
Availability: `always`; available by default: **yes**.

| Channel purpose | Channel | Schema |
| --- | --- | --- |
| Request | `pi-background-tasks:request:v1` | `pi-background-tasks.extension-request.v1` |
| Response | `pi-background-tasks:response:v1` | `pi-background-tasks.extension-response.v1` |
| Terminal | `pi-background-tasks:terminal:v1` | `pi-background-tasks.extension-terminal.v1` |

Operations: `capabilities`, `kill`, `logs`, `run`, `status`.


```json
{
  "api_version": 1,
  "kill": true,
  "logs": true,
  "logs_bounded": true,
  "run": true,
  "run_completion_trigger": true,
  "run_is_agent": true,
  "status": true
}
```
<!-- pi-docs:end name="eventbus-contract" -->

Primary source: `src/core/extension-api.ts`. Code is authoritative.

## Initialized-host SDK requirement

The service accepts requests only after `session_start` supplies its session context. Normal Pi TUI, RPC, print, and JSON modes provide counted lifecycle bindings. An SDK embedder must call `bindExtensions()` with at least one counted UI/command/shutdown/error binding so reload emits `session_start`; an empty or mode-only host must explicitly bind again after every reload.

Bare `createAgentSession()` does not initialize this context, and an empty or mode-only binding does not preserve post-bind initialization across `reload()`. Calls before initialization fail as unavailable; consumers must not fabricate context. This public-host limitation remains a `BLOCKED_SCOPE` SDK compatibility blocker. The generated API availability describes the initialized-host contract and is not a pre-bind availability guarantee.

## Channels and schema ids

| Purpose | Channel | `schema_version` |
|---|---|---|
| Requests | `pi-background-tasks:request:v1` | `pi-background-tasks.extension-request.v1` |
| Responses | `pi-background-tasks:response:v1` | `pi-background-tasks.extension-response.v1` |
| Terminal events | `pi-background-tasks:terminal:v1` | `pi-background-tasks.extension-terminal.v1` |

## Request frame

Closed object; unknown keys fail.

```ts
{
  schema_version: 'pi-background-tasks.extension-request.v1',
  request_id: string,        // non-empty, max 200 chars
  operation: 'capabilities' | 'run' | 'status' | 'logs' | 'kill',
  payload: object            // operation-specific closed object
}
```

Payloads:

- `capabilities`: `{}` only.
- `run`: `{ name, command, isAgent, notifyOnCompletion, triggerOnCompletion, timeoutSeconds? }`; strings are non-empty, booleans are booleans, `timeoutSeconds` is a positive integer when present. V1 cannot request reload survival: `surviveReload` remains an unknown-key error and every v1 run uses the compatible default `false`.
- `status`: `{ taskId? }`; `taskId` is non-empty when present.
- `logs`: `{ taskId, maxBytes?, tail? }`; `maxBytes` is positive when present and is still bounded by runtime log caps.
- `kill`: `{ taskId }`.

Malformed frames still receive a response where possible: `request_id` and `operation` echo valid non-empty input strings, otherwise `malformed`.

## Response frame

Closed by construction through the exported union:

```ts
// success
{
  schema_version: 'pi-background-tasks.extension-response.v1',
  request_id: string,
  operation: string,
  ok: true,
  result: BackgroundTaskExtensionResult
}

// error
{
  schema_version: 'pi-background-tasks.extension-response.v1',
  request_id: string,
  operation: string,
  ok: false,
  error: string             // whitespace-compacted, max 240 chars
}
```

Duplicate `request_id` values are rejected. The service rejects requests before `session_start` and while shutting down. The installed service exposes typed state `open | closed`. Calling `close()` is idempotent, transitions it permanently to `closed`, unsubscribes the request listener, and disposes registry publication, so requests first emitted after close are not handled and receive no service response. A request already accepted before close may receive one error response, but never a post-close success. Direct publication after close throws `BackgroundTaskExtensionServiceClosedError` with code `pi_background_tasks_eventbus_closed`; callers must not infer closure from message text.

## Capabilities

`capabilities` returns exactly:

```json
{
  "api_version": 1,
  "run": true,
  "run_is_agent": true,
  "run_completion_trigger": true,
  "status": true,
  "logs": true,
  "logs_bounded": true,
  "kill": true
}
```

## Terminal frames

Terminal events are emitted on `pi-background-tasks:terminal:v1`:

```ts
{
  schema_version: 'pi-background-tasks.extension-terminal.v1',
  task: BgTaskSnapshot
}
```

The terminal event carries no request id; consumers correlate by `task.id` returned from `run`/`kill`/`status`. The additive task snapshot can include `surviveReload` and `reloadSurvival` when a task was launched through `bg_run` or `/bg`; the request side remains unchanged. A fresh activation may emit that survivor's pending terminal on this same v1 channel.

## Ordering and durability barrier

For `run` and `kill` requests, the service installs a terminal-publication gate. After the response is emitted, the gate waits one microtask before releasing terminal publication, so immediate-exit tasks cannot publish terminal before the caller has observed the task id.

The registry publishes terminal snapshots only after the output stream has finished/closed and durable terminal metadata has been written. Publication state is tracked separately as `pending`, `delivered`, or `abandoned`; successful publication is latched and not emitted again, while abandonment is never represented as delivery.

If `EventBus.emit` throws, the registry retries after 100 ms for at most three total emit attempts. Persistent failure then becomes `abandoned` with bounded diagnostics. Because one listener may have received a frame before a later listener threw, delivery is **at least once under emission failure** and the same task can be observed up to the attempt bound. Consumers must deduplicate by `task.id`.

Shutdown, service disposal, a rejected publication gate, retry exhaustion, retention-limit eviction, or reload-handoff expiry can abandon the terminal frame without changing durable task metadata, waiter completion, or notification truth. Shutdown/service disposal clears pending retry timers and races any gate wait against one-way activation closure. Retention eviction abandons and releases an oldest pending publication before deleting that old task, so a newer notified result remains retrievable and finished-task retention stays bounded. After either gate resolution or rejection, lifecycle is checked again, so a late gate cannot emit or re-arm an old activation. Tasks made terminal by ordinary session shutdown intentionally do not publish onto the disposed activation's EventBus.

A valid opted reload handoff removes the survivor before old publication closure, clears only old physical gate/retry handles, and retains its logical state plus cumulative attempt count. Completion in the gap queues for the fresh service. The three-attempt cap and typed closed-service handling do not reset across reload; physical delivery remains at-least-once and consumers still deduplicate by task id.

If a synchronous terminal listener calls `close()` while emission is on the stack, queued publication work is disposed but that emission settles only when the emitter returns or throws. A normal return is delivered without an abandonment diagnostic; a non-handoff throw is abandoned once with truthful diagnostics. If the listener synchronously transferred reload ownership before throwing, the old publisher first observes that its exact task/lease binding is gone, leaves publication pending with the attempt consumed, and schedules no old retry; the fresh activation resumes at the next cumulative attempt. Closure never records both outcomes.

## Operations

- `run` starts a background task through the registry and returns a `BgTaskSnapshot`. Task admission is one-way closed at shutdown; each accepted admission has cancellation plus an overall bounded preflight deadline, and shutdown drains its owned cleanup before taking the running-task snapshot. A request crossing closure cannot insert/spawn or return success.
- `status` returns `{ tasks }`; with `taskId`, the array has one resolved task or errors loudly.
- `logs` returns bounded log details plus `text`; full bytes stay in `.pi/tasks/...output`.
- `kill` stops a running task and returns `{ task, message }` after the stop path.
- `capabilities` is pure and does not require a task.

## Integration example

```ts
const requestId = crypto.randomUUID();
const terminal = new Promise((resolve) => {
  const off = events.on('pi-background-tasks:terminal:v1', (frame) => {
    if (frame?.schema_version === 'pi-background-tasks.extension-terminal.v1') {
      off();
      resolve(frame.task);
    }
  });
});

events.emit('pi-background-tasks:request:v1', {
  schema_version: 'pi-background-tasks.extension-request.v1',
  request_id: requestId,
  operation: 'run',
  payload: {
    name: 'Example',
    command: 'printf eventbus-ok',
    isAgent: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true
  }
});
```

Listen for the matching response on `pi-background-tasks:response:v1`, deduplicate terminal frames by `task.id`, and treat the frame's metadata-backed status as terminal truth; do not poll status merely to reconfirm it.
