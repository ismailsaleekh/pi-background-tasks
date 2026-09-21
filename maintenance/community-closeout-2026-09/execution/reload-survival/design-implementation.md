# D1 implementation design — current integrated tree

## Identity and boundaries

- Worktree: `/private/tmp/pi-bg-closeout-iNoltL/reload-survival`
- Branch: `closeout/reload-survival`
- Base/HEAD: `fcf2af0950c8047ebf90b802e8049781fd3136fb`
- Tree: `0ee3654012711f4a213dc79ca93f56fe30724ab7`
- Effective worker: `openai-codex/gpt-5.6-sol/max` from `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL`.
- Existing dirt is only the task-provided read-only `node_modules` symlink. No other worktree, checkout, copy, install, network, GitHub, provider call, Fusion maintenance, delegate/fusion source edit, package/lock edit, or parent/main edit is permitted.
- Native Windows is unavailable on this Darwin arm64 host. Implemented Windows owner behavior and injected tests cannot qualify the six native cases; final D1 remains `BLOCKED_ENVIRONMENT` for Windows.
- Pi 0.84 and installed 0.86 both gate reload `session_start` on a non-empty counted binding and direct `AgentSession.dispose()` emits no shutdown. Empty/mode-only binding survival and direct-dispose cleanup remain `BLOCKED_UPSTREAM`. Normal TUI/RPC/print/JSON and counted SDK bindings are supported; `AgentSessionRuntime.dispose()` is the supported SDK quit path.
- Hard crash, SIGKILL, process restart, and cross-process/PID/JSON adoption are unsupported and will not be claimed.

## Current ownership and invariants

Current integrated anchors (line numbers are pre-D1 and will move):

- `src/core/common.ts:47-174,264-303,426-492,943-977` owns snapshots/internal task data, starter options, `/bg` parsing, and serialization.
- `src/core/registry.ts:790-1074` owns one-way admission/publication closure; `1181-1423` owns ordinary spawn/admission; `1426-2208` owns managed/delegate/attested paths; `2225-2328` owns controls/metadata; `2443-3187` owns output, POSIX one-TERM/one-KILL/proof and Windows structured taskkill; `3189-3567` owns R1 publication/notification/finalization/retention.
- `src/core/extension-api.ts:1-576` owns closed EventBus v1 parsing, exact capabilities, response gate, typed service closure, and controls. V1 will remain byte-contract compatible and cannot request survival.
- `src/extension.ts:215-287` constructs the activation registry/service and installs the early synchronous shutdown barrier; `370-432` owns ordinary adapters and dock rerun; `522-575` owns session start and async shutdown; `578-602` owns `/bg`; `754-918` owns `bg_run` and attested public schemas.
- `src/ui/background-tasks-manager.ts` owns display/input only. The rerun policy remains in `src/extension.ts`.
- `src/core/config.ts:85` still requires `process`; `src/extension.ts:219` resolves one immutable shell policy per activation. A survivor retains its launch policy; reruns use the new activation policy.
- Accepted R1 invariants are frozen: counted/cancellable 30 s admission, one-way close, durable terminal metadata before delivery, `pending|delivered|abandoned`, three cumulative EventBus attempts at 100 ms, typed closed-service errors, reentrant settlement, recency retention, POSIX immutable spawn PGID with one TERM/one KILL/bounded ESRCH proof, and Windows `taskkill /T` then `/T /F` with no root-only fallback.

## Files and responsibility

1. New `src/core/reload-shell-owner.ts` owns the structural process-global protocol and the complete live opted execution controller. It retains only Node process/pipe/stream/timer/tree state and plain logical task state. It never retains Pi/UI/EventBus/config/provider/lazy-module closures.
2. `src/core/common.ts` owns public/additive survival snapshot fields, typed errors, identity/lease/claim/adapter/execution structural types, and `/bg` grammar.
3. `src/core/registry.ts` remains the sole ordinary launch/control/finalization adapter. Default ordinary and all managed paths stay on the accepted R1 implementation. The opted branch creates a real owner execution and consumes it in the same commit. Registry import/detach and fresh host-delivery adapters bridge reload.
4. `src/extension.ts` derives exact `{process.pid, sessionManager.getSessionId(), realpathSync(ctx.cwd)}`, begins/commits activation claims on the first start handler, detaches committed survivors only for `reason:'reload'`, then closes/kills all remainder. Public schema/command/dock behavior is minimal here.
5. `src/core/extension-api.ts` changes only additive task typing/tests if needed. Request v1 schema/capabilities remain exact and `surviveReload` stays an unknown-key error.
6. No delegate/Fusion facade source edits. Their closed schemas/explicit unknown-key guards are tested. Registry rejects survival-shaped managed/delegate inputs defensively. Attested preparation is checked in `src/extension.ts` because its current compatibility preparation otherwise drops unknown keys.
7. Authored docs and QA plans are updated, then generated files only through `npm run docs:generate`.

## Global owner protocol

`globalThis[Symbol.for('pi-background-tasks.reload-shell-owner.v1')]` contains a structurally checked v1 hub. No `instanceof`, JSON restoration, PID scan, or process discovery is used.

Identity keys are length-delimited encodings of exact host PID, session id, and canonical cwd. Every mutator checks protocol, hub nonce, identity key, monotonically increasing generation, and random activation/claim nonce.

Per identity states:

```
absent -> claiming(g=1) -> bound(g=1)
bound(g) --reload detach--> handoff(g, absolute deadline)
handoff -> claiming(g+1, same deadline) -> bound(g+1)
claiming --abort/failure--> handoff(same deadline)
handoff|claiming --30 s deadline--> orphan cleanup
bound --quit/new/resume/fork--> releasing -> absent after executions settle
```

`beginActivation` is synchronous and claim-only. Registry imports every claimed object, rejects collisions transactionally, durably advances only audit generation/handoff count, then `commitActivation` calls adapter `onBound` before exposing/flushing it. Abort never extends the original deadline. A same-identity second package activation conflicts loudly; independent identities coexist. Stale tokens cannot mutate.

The fixed production handoff timeout is 30,000 ms and referenced. A test-only constructor injects a shorter deadline and process/tree dependencies. Expiry marks publication abandoned with `reload_handoff_expired`, stops a still-live retained tree, waits for real close/tree proof, persists truthful terminal state, emits bounded `console.error`, and removes the slot only after ownership settles. A force/proof failure retains the minimal live authority and is not reported as clean.

## Opted execution state machine

Only `isAgent:false, surviveReload:true` uses the owner path. Validation precedes admission timers, directories, files, task insertion, wrappers, or spawn.

```
starting --initial metadata + open admission--> running (handoff eligible)
starting --admission close/failure--> stop_requested (never transferable)
running --user/nonreload/timeout/cap/expiry--> stop_requested
running|stop_requested --actual child close--> finalizing
finalizing --tree proof + stream close + terminal metadata--> terminal
terminal --current host delivery settles (or orphan cleanup)--> released
```

The execution owns the actual child, stdout/stderr listeners, stream, immutable shell invocation/policy, launch nonce/completion id, absolute timeout deadline/timer, launch-time output cap/cumulative bytes, passive telemetry buffer, real close observation, metadata chain, POSIX group state, Windows helper/escalation state, publication ledger, and notification CAS. No liveness check creates terminal truth; child `close` is the only exit-code/signal source. Signal 0 is only proof for an already-owned POSIX group.

The registry inserts the task before spawn ownership can yield, registers the execution with the current lease, writes initial metadata under admission cancellation, and only then marks admission committed. Reload transfers only committed executions. Uncommitted opted starts are removed from the hub and follow ordinary shutdown cleanup.

## Adapter and reload sequence

The hub stores no registry or host API directly. `registerExecution` installs only a hub event sink. The currently bound adapter is the sole closure over a fresh registry/Pi/EventBus/notification host. Child and timer callbacks dynamically dispatch through that sink; gap events queue in the hub.

Old early shutdown, synchronously before any await:

1. Close admissions.
2. For `reason === 'reload'` only, call hub `beginReloadHandoff(lease)`, which clears the adapter first.
3. Clear old retry/gate handles without abandonment, invalidate old delivery continuations, and remove only committed owner-backed tasks from the old registry.
4. Mark the old registry shutting down, close EventBus, clear context/UI handles.

The existing async cleanup drains admissions and kills every remaining task. Other lifecycle reasons transfer nothing.

New first start handler, before existing UI setup and before its first await:

1. Derive exact identity and call `beginActivation(identity,event.reason,newNonce)` synchronously.
2. Stage all same-object task records in the fresh registry, update audit generation/handoff count, and durably write them.
3. Recheck disposal, build the fresh adapter, commit the claim, then continue existing UI/status startup.
4. On error/reentrant shutdown abort the claim and preserve the original deadline.

A child can finish during the gap: it continues draining both pipes, closes the same stream, records the actual code/signal, and durably finalizes. The fresh adapter then publishes/notifies it once. Status/log/kill/commands/dock use the imported same task object and path; no metadata lookup path exists.

## Delivery preservation

Task-owned R1 fields move unchanged. Detach clears old physical gate/retry handles but not logical state or attempt count. Fresh publication resumes at the cumulative count, never over three total. `terminalPublished` remains delivery-only; abandonment never sets it. Every old asynchronous continuation checks current registry/lease ownership after awaits/timers. Reentrant synchronous emitter return remains delivered; a throw follows the existing typed retry/abandon policy.

Notification uses execution-owned `disabled|pending|sending(token)|delivered`. A successful synchronous send latches `task.notified=true`; a throw restores pending only for its current token. Reload does not reset notified or resend a successful notification.

## Public behavior

- `bg_run.surviveReload?: boolean` defaults false. `/bg` accepts one bare leading `--survive-reload`; `--` ends parsing. Duplicate and assignment forms are `pi_bg_survive_reload_invalid`.
- True with `isAgent:true` is `pi_bg_survive_reload_requires_non_agent` before side effects.
- Managed/delegate/Fusion/attested survival-shaped input is loud unsupported. EventBus v1 is unchanged, rejects the extra key, and always starts default non-survivors.
- New snapshots/metadata always emit `surviveReload`; omitted legacy metadata means false and is never adopted. Opted records add the exact `pi-background-tasks.reload-shell.v1` audit object.
- Dock rerun preserves the flag but creates a new execution/id/nonce under current policy/cap.
- `bg_result` remains inapplicable to ordinary survivors.

## Red/green evidence plan

Tests are authored before production. Named baseline reds cover owner module absence, public schema/grammar absence, unavailable opted consumer, and real reload killing opted work. Existing default reload-kill, lifecycle kill, R1 publication/tree, EventBus v1, and shell policy controls remain baseline-green.

Permanent focused coverage:

- owner structural reuse, identities, generations/two-phase claim, stale/conflict, deadline, copied-JSON nonadoption, gap terminal, repeated handoff, publication attempts, notification latch, policy/timeout/cap persistence, and injected Windows owner state;
- registry pre-side-effect validation, admission commit, imported controls, POSIX leader/descendant proof, retention/delivery;
- EventBus exact closed v1 and additive terminal snapshot;
- command/tool schemas, managed/refusal paths, dock rerun;
- real counted-binding `AgentSession.reload()` continuity/gap/post-reload controls/repeated reload/timeout/cap/policy; actual `AgentSessionRuntime` new/switch/fork/clone/dispose kill matrix; empty-binding and direct-dispose blocker characterizations; copied JSON no-adoption.

Passing real process scenarios have no rescue. Rescue exists only in failure cleanup and is reported.

## Commit plan

1. Owner + common types + real registry opted consumer + owner/registry/POSIX/Windows-mock tests.
2. Lifecycle/public/dock/EventBus tests + real SDK tests + authored/generated docs and D1 QA sections.

No infrastructure-only commit, no D2/P1/lazy changes, and no native-Windows success claim.
