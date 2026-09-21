# Independent R1 review — terminal publication lifecycle

## Review result

Commit `a54bb8eeae39c02382fc0f5f3838180589701bc7` is **not ready as reviewed**. The bounded three-attempt retry path, typed closed-service error, gate/closure race, and ordinary happy paths work in the supplied tests, but four lifecycle/retention defects remain and the claimed “real repeated SDK reload” coverage is synthetic.

Reviewed range:

- Base: `14afc33e3967a142758169d3217a4e63b4b3ec94`
- Head: `a54bb8eeae39c02382fc0f5f3838180589701bc7`
- Head tree: `3f2158fa33b7bf36d7342a381ca88d82d0bbacbe`
- Diff: 12 files, +755/-52

## Findings

### HIGH — An in-flight EventBus `run` can spawn after shutdown has completely finished and escape kill-on-reload

**Anchors:** `src/core/extension-api.ts:455-494`, `src/core/registry.ts:843-905`, `src/extension.ts:510-538`.

**Scenario:** A request passes the service/registry checks, then pauses in `startTask()` at `await ensureRuntimeDir()`. Shutdown synchronously closes publication and the service, and the ordinary cleanup handler snapshots zero running tasks. When the awaited operation resumes, `startTask()` never re-checks shutdown/closure before inserting and spawning the task. The already-running request then emits a success response even though the service is closed.

**Expected:** Once the one-way shutdown barrier has run, no new child may be created in the old activation. Shutdown must either reject the admission before spawn or drain/cancel all in-flight admissions before taking the running-task snapshot.

**Actual:** The disposable repro completed shutdown first, then received a successful response for a newly spawned running child:

```json
{
  "shutdownFinishedBeforeResponse": true,
  "responseOk": true,
  "taskStatusInPostShutdownResponse": "running",
  "spawnedPid": 97637,
  "taskId": "b943baed6"
}
```

The cleanup handler had already set `shutdownCleanupStarted`, so a later shutdown cannot recover that task. A long-lived command therefore retains the old registry and process indefinitely, precisely the lifecycle #24 is intended to close.

**Evidence:**

- Script: `scratch/repro-inflight-run-after-shutdown.mts`
- Log: `repro-inflight-run-after-shutdown.log`
- Exit: 0; the bounded repro child was confirmed exited afterward.

**Recommended direction:** Add an atomic task-admission closure/lease. Re-check it after every asynchronous preflight and immediately before task insertion/spawn in all task starters. Shutdown should close admissions first, await/drain admissions already in progress, then enumerate and stop tasks. An in-flight service handler must not emit a post-close success for a task that was admitted after closure. Add a delayed-admission EventBus regression with a fake child that would remain live unless cleanup owns it.

### MEDIUM — An overlapping `session_start` continuation recreates a ref'ed status timer after shutdown

**Anchors:** `src/extension.ts:234-245`, `src/extension.ts:494-507`; contradicted contract at `docs/subsystems/host-ui-and-telemetry.md:72`.

**Scenario:** `session_start` passes the single `disposed` check and blocks in `await registry.ensureRuntimeDir(ctx)`. `session_shutdown` then marks the activation disposed and clears its timers. When the earlier start continuation resumes, it does not re-check `disposed`; it installs `statusInterval` and starts the update-check path after teardown.

**Expected:** No continuation from the old activation may create a timer or other resource after shutdown. A late or overlapping `session_start` must be inert.

**Actual:** The deterministic lifecycle probe observed zero intervals after shutdown and one interval after the old start continuation resumed:

```json
{
  "intervalsAfterShutdown": 0,
  "intervalsAfterLateStartContinuation": 1,
  "leakedInterval": true
}
```

The interval is ref'ed and closes over old extension state. Repeated shutdown is idempotently short-circuited, so it cannot clear this late-created handle; on quit it can also keep the process alive.

**Evidence:**

- Script: `scratch/repro-late-session-start.mts`
- Log: `repro-late-session-start.log`
- Exit: 0.

**Recommended direction:** Use an activation generation/cancellation token and re-check it after `ensureRuntimeDir()` and before every resource creation. Timer cleanup should remain safe even when `disposed` is already true. Add an overlapping start/shutdown regression, not only a start event invoked wholly before or wholly after shutdown.

### MEDIUM — Protected pending publications can evict a newer, already-notified Fusion result before `bg_result`

**Anchors:** `src/core/registry.ts:2394-2396`, `src/core/registry.ts:2624-2636`, and the consumer at `src/delegate-extension.ts:523,546-553`. The ordering also disagrees with `docs/subsystems/background-task-runtime.md:20,59`.

**Scenario:** Fill the retention boundary with an older terminal task whose publication gate never resolves, then complete a normal managed Fusion task. `pruneOldTasks()` excludes the old `pending` task, so the only removable task is the newer delivered task. It is deleted even though its terminal frame and completion notification have just told the agent to call `bg_result`.

**Expected:** Protecting the old publication timer must not make retention anti-recency or invalidate a fresh result before its notified consumer can retrieve it. Temporary overflow, bounded abandonment of stale publication state, or a separate publication-owner structure is preferable to evicting the newer result.

**Actual:** With `maxRecentTasks: 1` (the same algorithm scales to the default 100), the normal managed result was delivered and notified but immediately became unknown:

```json
{
  "retainedIds": ["review-1"],
  "managedTerminalDelivered": true,
  "managedNotificationSent": true,
  "resultResolvable": false,
  "resolutionError": "Unknown background task ID: reason-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

`bg_result` has no artifact-only fallback before registry resolution, so durable Fusion artifacts do not repair this API failure.

**Evidence:**

- Script: `scratch/repro-result-prune.mts`
- Log: `repro-result-prune.log`
- Exit: 0.
- A second ordinary-task control is preserved in `scratch/repro-pending-prune.mts` / `repro-pending-prune.log`.

**Recommended direction:** Keep publication cancellation ownership separate from recent-result retention, or allow temporary overflow while the oldest entry is publication-pending. Pruning should preserve recency and the notified `bg_result` contract. Add a pending-oldest + newly completed managed-task regression and assert actual `bg_result` retrieval, not only internal state fields.

### MEDIUM — Reentrant shutdown during a successful emit records both “abandoned” and “delivered”

**Anchors:** `src/core/registry.ts:804-821`, `src/core/registry.ts:2383-2412`.

**Scenario:** A synchronous terminal listener initiates shutdown while `publishTerminalSnapshot()` is on the stack, then returns normally. `closeTerminalPublication()` marks/logs the in-flight task as abandoned and may prune based on that provisional state. Control returns to `tryPublishTerminalNow()`, which unconditionally calls `markTerminalPublicationDelivered()`.

**Expected:** One coherent, truthful outcome. If successful emitter return defines delivery, shutdown must not first publish an abandonment diagnostic or prune as abandoned. If shutdown is intended to win, the outer emitter must not overwrite abandonment as delivered.

**Actual:** The repro ended with delivered state while its only diagnostic asserted abandonment:

```json
{
  "finalState": "delivered",
  "terminalPublished": true,
  "abandonReason": null,
  "diagnostics": [
    "[background-tasks] terminal publication abandoned for review-reentrant (registry_shutdown) after 1/3 emit attempts"
  ]
}
```

The public diagnostic is therefore false, and pruning can run against a state that is changed again before the emit call returns.

**Evidence:**

- Script: `scratch/repro-reentrant-emit.mts`
- Log: `repro-reentrant-emit.log`
- Exit: 0.

**Recommended direction:** Treat in-flight emission as a distinct settlement phase. Closure should clear queued retries/gates but defer final abandonment logging and pruning for the in-flight task until the emitter returns or throws. Add service-level tests where a terminal listener calls `close()` and either returns or throws.

### MEDIUM (qualification gap) — The “repeated reload activations” SDK test does not execute a Pi reload/replacement flow

**Anchor:** `tests/sdk/sdk.test.ts:810-879`.

**Expected:** Acceptance calls for real Pi reload/new/resume/quit replacement, fresh extension rebinding, and late-start behavior.

**Actual:** Each loop calls `harness({ eventBus })` to construct an unrelated session, directly emits synthetic `session_start`/`session_shutdown` events with reason `reload`, disposes it, and constructs another harness. The file does not use `AgentSession.reload()`, `ctx.reload()`, or `AgentSessionRuntime` replacement APIs. It therefore does not exercise loader reload, old-runner invalidation, new/resume rebinding, quit, overlapping lifecycle continuations, or task admission racing teardown. Both high/medium lifecycle repros above pass outside this test.

**Recommended direction:** Drive the installed Pi runtime’s real reload and `AgentSessionRuntime` new/switch/dispose paths on one shared EventBus, with ordinary and managed tasks. Add a delayed `session_start`/admission seam and negative controls proving the fresh activation still publishes ordinary terminals while no old activation emits, responds, starts children, or leaves handles.

## Verification performed

All commands used isolated `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` under the dedicated `delivery-review` roots with `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1`.

| Command | Exit / result |
|---|---|
| `shasum -a 256 -c maintenance/community-closeout-2026-09/evidence/SHA256SUMS` | 0; all frozen entries OK |
| `tsx --test tests/unit/registry.test.ts tests/unit/extension-api.test.ts` | 0; 40/40 |
| Focused SDK lifecycle patterns in `sdk.test.ts` + `fusion-sdk.test.ts` | 0; 2/2 |
| `npm run test:sdk` | 0; 43/43 |
| `npm run typecheck` | 0 |
| `npm run test:unit` | 1; 453/454, sole failure is acknowledged generated `docs/commands/bg.md` staleness |
| `npm run test:type-safety` | 1; acknowledged inherited comment false-positive plus pre-existing double assertion |
| Five disposable repro scripts (four primary plus the ordinary pruning control) | 0; defects reproduced |
| `git diff --check 14afc33e..a54bb8ee` | 0 |

The three worker red logs were inspected and their frozen hashes verified: registry 0/4, EventBus 0/2, SDK lifecycle 0/1 on baseline production. I did not re-check out or copy baseline source, in accordance with the immutable-tree/no-worktree restriction.

## Coverage and limits

- Read the package gateway, generated index/read gate, owning runtime/EventBus/host/completion docs, maintenance acceptance/execution/baseline, frozen #24/#25 threads and PR #25 patch, worker report, complete diff, changed source/tests, and relevant installed Pi extension/SDK/session lifecycle docs and examples.
- Verified normal delivery, transient retry, three-attempt exhaustion, typed close, late gate closure, managed Fusion shutdown, and at-least-once duplicate tests pass as written.
- Host: Darwin arm64; Node `v24.16.0`; npm `11.13.0`.
- No native Windows qualification, live user session/auth, model call, paid API, network browsing, Fusion maintenance route, agent spawn, push, publish, or doc attestation.
- RPC/component/PTY/package/release suites were not rerun.
- Generated-doc staleness is treated as integrator-owned as directed, not as a review finding.

## Environment and tree integrity

Effective route verified before review and again during evidence collection:

- `PI_PROVIDER=openai-codex`
- `PI_MODEL=gpt-5.6-sol`
- `PI_REASONING_LEVEL=max`

Final source worktree remains unchanged at `a54bb8eeae39c02382fc0f5f3838180589701bc7`; `git status --short` shows only the pre-existing untracked `node_modules` symlink. Review scratch remained below 100 MiB, and no repro child remains running.
