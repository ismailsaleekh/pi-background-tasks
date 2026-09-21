# R1 correction report

## Result

Corrected all independent-review findings on `closeout/delivery` and stopped for targeted re-review.

- Base reviewed commit: `a54bb8eeae39c02382fc0f5f3838180589701bc7`
- Follow-up commit: `424a1d3f082e3e1443172a7a0a4d80a7dd76418e` — `fix(core): close R1 lifecycle review races`
- Correction design: `/private/tmp/pi-bg-closeout-iNoltL/reports/delivery-fix/design.md`
- Original PR #25 credit remains in `a54bb8e` unchanged, including Erik Darling’s co-author trailer. The follow-up was not amended or rewritten.

Committed paths:

- `src/core/common.ts`
- `src/core/registry.ts`
- `src/core/extension-api.ts`
- `src/extension.ts` (lifecycle only)
- `tests/unit/registry.test.ts`
- `tests/unit/extension-api.test.ts`
- `tests/sdk/sdk.test.ts`
- `tests/sdk/fusion-sdk.test.ts`
- `tests/sdk/lifecycle-sdk.test.ts` (new)
- `docs/subsystems/background-task-runtime.md`
- `docs/api/eventbus-v1.md`
- `docs/subsystems/host-ui-and-telemetry.md`
- `docs/concepts/completion-delivery.md`

No generated docs, package manifests, shared plans/state, shell/config/feature/lazy code, attribution, launcher, or guard files were changed.

## Finding-by-finding disposition

### 1. In-flight admissions can spawn after shutdown — fixed

- Added one-way counted admission leases to all four registry starters: ordinary, managed, delegate, and attested Pi.
- Shutdown closes admissions synchronously. Runtime-directory admission waits race the closure signal; every later asynchronous preflight is followed by a closure check; insertion and spawn each have an immediate check with no yielding gap.
- The extension cleanup drains admission leases before enumerating running tasks. A task that spawned before closure was inserted first and remains shutdown-owned; a preflight crossing closure cannot insert/spawn.
- Interrupted managed preflight invokes its cancellation callback. Interrupted ordinary/attested file preflight destroys its stream/removes partial files. Post-spawn metadata waits race closure and hand the already-owned task to shutdown.
- EventBus handlers recheck service/shutdown state after execution. An accepted in-flight request may settle with one error response, but never post-close success; requests first emitted after close remain unhandled.
- Durable tests cover all registry starters, delayed EventBus pre-spawn admission, and a child already spawned while initial metadata is delayed.

Reviewer repro now reports `responseOk:false` with no task/pid. It exits 0.

### 2. Late `session_start` recreates status/update resources — fixed

- `session_start` rechecks the one-way activation state after `ensureRuntimeDir()`, after UI setup, and immediately before interval/update-check creation.
- A newly created interval is cleared if disposal is observed before assignment.
- Idempotent shutdown always clears current handles even when disposal was already marked; it no longer returns before cleanup.
- Update-check completion also rechecks disposal before mutating old UI state.

Reviewer repro now reports zero intervals both after shutdown and after the late continuation, with `leakedInterval:false`.

### 3. Pending-oldest retention evicts a newer Fusion result — fixed

- Retention remains recency-based and bounded for finished tasks. When the oldest finished entry is publication-pending, pruning first abandons it as `retention_limit`, clears its gate/retry ownership, releases its task-local publication waiter, and then removes that old entry.
- Synchronous emit settlement and running tasks are only transiently protected; pending publication cannot create unbounded retained finished-task growth.
- The newer notified managed task remains resolvable.
- The durable regression builds a committed Fusion package, completes the managed task behind an older unresolved publication, invokes the production-registered `bg_result` tool, and verifies inline answer retrieval plus the once-only usage claim—not merely internal task fields.

Both reviewer pruning probes now retain the newer task and report `normalResolvable:true` / `resultResolvable:true`.

### 4. Reentrant close records abandonment then delivery — fixed

- Added a distinct synchronous `terminalEmitInFlight` settlement phase.
- Reentrant shutdown/service close disposes queued gate/retry work but defers abandonment diagnostics and pruning for the task whose emitter is still on the stack.
- A normal emitter return settles `delivered` once with no abandonment log. A throw settles closure/abandonment once and includes the thrown error in the diagnostic; it cannot retry or overwrite itself after closure.
- Service-level tests install terminal listeners that call `service.close()` and either return or throw.
- Existing three-total-attempt/100 ms retry behavior, typed publisher closure, and at-least-once duplicate semantics remain green.

Reviewer repro now reports delivered truth with an empty diagnostics array.

### 5. Lifecycle coverage was synthetic — corrected qualification

Real installed Pi 0.84.0 APIs now executed:

- `AgentSession.reload()` twice on one session/shared EventBus with old ordinary tasks, old-runner/context invalidation, fresh runner binding, exactly one fresh response, and exactly one fresh terminal.
- `AgentSession.reload()` with a live managed Fusion workflow, verifying old managed publication suppression, old-runner invalidation, cancellation/child cleanup, and a fresh ordinary publisher on the same EventBus.
- `createAgentSessionRuntime()` plus `AgentSessionRuntime.newSession()`, `switchSession()`, and `dispose()` with a shared EventBus, persisted target session, old-context stale errors, fresh rebinding, old terminal suppression, fresh response/publication, and no listener after disposal.

The actual API qualification tests already passed on reviewed R1; their purpose is to replace the unsupported “real reload” claim with executed API evidence. The race-specific tests below are intentionally synthetic and are not described as real Pi replacement flows.

Synthetic/deterministic seams retained only where needed:

- delayed `ensureRuntimeDir()` for admission closure;
- genuinely overlapping direct `session_start`/`session_shutdown` dispatch for the late-continuation race;
- injected in-memory EventBus/fake child for synchronous listener throws and exact spawn/kill control.

## Red evidence on `a54bb8e`

All commands below ran after exporting exactly:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery-fix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/delivery-fix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/delivery-fix
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

`TSX=/private/tmp/pi-bg-closeout-iNoltL/delivery/node_modules/.bin/tsx`.

1. New EventBus admission + reentrant-close regressions:
   - Command: `$TSX --test --test-name-pattern='admission resumes after shutdown|reentrant service close' tests/unit/extension-api.test.ts`
   - Exit **1**; **0 pass / 2 fail**.
   - Correct failures: one child spawned after closure; successful reentrant emit logged false abandonment.
   - Log: `red-new-eventbus.log`.
2. New all-starter admission + actual `bg_result` retention regressions:
   - Command: `$TSX --test --test-name-pattern='starter admission|oldest pending publication' tests/unit/registry.test.ts`
   - Exit **1**; **0 pass / 2 fail**.
   - Correct failures after fixture validation: all four starters fulfilled after closure; production `bg_result` failed `task_unknown` for the newer managed result.
   - Log: `red-new-registry.log`.
3. Genuine overlapping late-start regression:
   - Command: `$TSX --test --test-concurrency=1 --test-name-pattern='overlapping late session_start' tests/sdk/sdk.test.ts`
   - Exit **1**; **0 pass / 1 fail**.
   - Correct failure: one post-shutdown interval remained.
   - Log: `red-new-late-session-start.log`.
4. The five independent reviewer scripts all exited **0** while reproducing their old behavior:
   - `$TSX /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review/scratch/repro-inflight-run-after-shutdown.mts` — success response with running pid.
   - `$TSX /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review/scratch/repro-late-session-start.mts` — leaked interval true.
   - `$TSX /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review/scratch/repro-pending-prune.mts` — newer normal task unresolvable.
   - `$TSX /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review/scratch/repro-reentrant-emit.mts` — delivered state plus abandonment diagnostic.
   - `$TSX /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review/scratch/repro-result-prune.mts` — newer managed result unresolvable.
   - Logs: `red-reviewer-*.log`.

Real API qualification on unchanged R1 was intentionally not claimed as defect-red: actual ordinary `AgentSession.reload()`, managed `AgentSession.reload()`, and corrected-fixture `AgentSessionRuntime` replacement probes each passed 1/1, showing that these tests close the execution/claim gap rather than manufacturing a baseline failure.

## Green verification

Using the same isolated environment:

1. Registry + EventBus owning files:
   - Command: `$TSX --test tests/unit/registry.test.ts tests/unit/extension-api.test.ts`
   - Exit **0**; **45/45 pass**.
   - Log: `green-registry-eventbus-final.log`.
2. Focused real/synthetic lifecycle set:
   - Command: `$TSX --test --test-concurrency=1 --test-name-pattern='AgentSession\.reload|overlapping late session_start|AgentSessionRuntime' tests/sdk/sdk.test.ts tests/sdk/fusion-sdk.test.ts tests/sdk/lifecycle-sdk.test.ts`
   - Exit **0**; **4/4 pass**.
   - Log: `green-lifecycle-sdk-final.log`.
3. Full SDK suite:
   - Command: `npm --prefix /private/tmp/pi-bg-closeout-iNoltL/delivery run test:sdk`
   - Exit **0**; **46/46 pass** across delegate, Fusion, dedicated lifecycle, and ordinary SDK suites.
   - Log: `green-sdk-full-final.log`.
4. Typecheck:
   - Command: `npm --prefix /private/tmp/pi-bg-closeout-iNoltL/delivery run typecheck`
   - Exit **0**.
   - Log: `typecheck-final.log`.
5. Reviewer repros, rerun unchanged:
   - Commands: the five absolute `$TSX /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review/scratch/repro-{inflight-run-after-shutdown,late-session-start,pending-prune,reentrant-emit,result-prune}.mts` invocations listed in the red section.
   - Exit **0** for each; fixed outputs are `responseOk:false`, `leakedInterval:false`, newer ordinary/managed result resolvable, and reentrant delivered with no diagnostic.
   - Logs: `green-reviewer-*-final.log`.
6. Full unit suite:
   - Command: `npm --prefix /private/tmp/pi-bg-closeout-iNoltL/delivery run test:unit`
   - Exit **1**; **458/459 pass**.
   - Sole failure: acknowledged integrator-owned generated `docs/commands/bg.md` staleness. No behavioral/unit failure remains.
   - Log: `green-unit-full-final.log`.
7. Type-safety gate:
   - Command: `npm --prefix /private/tmp/pi-bg-closeout-iNoltL/delivery run test:type-safety`
   - Exit **1**; **1/2 pass**.
   - Sole test failure reports the two frozen inherited attribution findings at `src/core/anthropic-attribution.ts:83` and `:1493`; no correction-owned path was reported.
   - Log: `type-safety-attempt1.log`.
8. Frozen evidence:
   - Command from `maintenance/community-closeout-2026-09`: `shasum -a 256 -c /private/tmp/pi-bg-closeout-iNoltL/delivery/maintenance/community-closeout-2026-09/evidence/SHA256SUMS`
   - Exit **0**; **49/49 OK**.
   - Log: `frozen-checksums-final.log`.
9. `git diff HEAD^..HEAD --check`: exit **0**.

## Remaining gaps / reviewer focus

- Native Windows was not available. Existing injected Windows registry tests pass in the 45-test focused run and full unit run; this report does not claim native Windows qualification.
- Full RPC/component/PTY/package/release gates were not rerun. Full SDK, owning unit files, typecheck, reviewer repros, and frozen evidence were run.
- Generated docs remain stale as explicitly assigned to integrator work; no generated region/index/manifest was hand edited and no semantic attestation was created.
- Publication state remains process-local/internal. `retention_limit` deliberately abandons an oldest pending frame to preserve bounded recency and fresh-result retrieval; it does not alter durable terminal status or notification truth.
- Accepted EventBus work crossing close can emit one failure response. It cannot emit success. Requests first emitted after close still receive no response.
- Reviewer should focus on: admission closure racing `ensureRuntimeDir`; no-yield insertion-before-spawn ownership in all starters; managed cancellation and attested preflight cleanup; task-local abandonment releasing a pruned gate; and the emit-return versus emit-throw settlement branches.
- No D1 persistence/process handoff was implemented. Default kill-on-reload is unchanged.

## Cleanup and process accounting

- Peak task-owned scratch observed: approximately **13 MiB**, below the 400 MiB limit.
- Removed exact disposable roots:
  - `/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery-fix`
  - `/private/tmp/pi-bg-closeout-iNoltL/home/delivery-fix`
  - `/private/tmp/pi-bg-closeout-iNoltL/agent/delivery-fix`
- Retained only bounded reports/logs under `/private/tmp/pi-bg-closeout-iNoltL/reports/delivery-fix` (about 272 KiB before this report).
- Owned children/watchers/servers remaining: **0**.
- Worktree is clean for tracked files at `424a1d3f082e3e1443172a7a0a4d80a7dd76418e`; only the pre-existing untracked read-only `node_modules` symlink remains.
- No checkout/copy/worktree, network/GitHub, paid API, live provider call, Fusion maintenance route, other agent, push, publish, tag, or attestation was used.

## Effective route / host

- `PI_PROVIDER=openai-codex`
- `PI_MODEL=gpt-5.6-sol`
- `PI_REASONING_LEVEL=max`
- Darwin 24.6.0 arm64; Node `v24.16.0`; npm `11.13.0`.

This is implementation evidence, not independent signoff. Parent should schedule the requested targeted independent re-review before integration.
