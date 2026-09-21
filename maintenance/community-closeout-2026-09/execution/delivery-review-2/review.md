# Targeted independent R1 correction review — Sol5.6/max Codex OAuth

## Verdict

**NOT READY.** Commit `424a1d3f082e3e1443172a7a0a4d80a7dd76418e` fixes the four original disposable repros, the pending-publication retention defect, reentrant emit settlement, late `session_start`, and the lifecycle qualification gap. One **HIGH** admission-lifecycle defect remains: an accepted attested-task preflight can hold the counted admission forever on an unbounded Git subprocess, so session shutdown/reload waits forever and cannot own or cancel that preflight child.

Reviewed range and immutable identity:

- Reviewed base: `a54bb8eeae39c02382fc0f5f3838180589701bc7`
- Reviewed head: `424a1d3f082e3e1443172a7a0a4d80a7dd76418e`
- Head tree: `bbadc171e9b829a0fde6775e1bd2639c58c6d472`
- Follow-up: 13 files, +1547/-268

## Finding-by-finding disposition

### 1. HIGH — Task admission is one-way, but shutdown can still wait forever on an uncancellable attested preflight

**Disposition: FAIL / remaining blocker.**

The new lease is acquired by `startAttestedPiTask()` at `src/core/registry.ts:1536-1540` and released only when the whole starter settles. `ensureRuntimeDir()` and post-spawn metadata use the closure race helper, but several later pre-insertion awaits do not:

- `gitRepoRoot()` and `gitAuthoritySnapshot()` at `src/core/registry.ts:1573-1578`;
- the durable artifact writes and initial metadata write at `src/core/registry.ts:1631-1643`;
- similarly, the ordinary telemetry-wrapper write at `src/core/registry.ts:1010-1015` is followed by a check but is not raced or cancelled.

The demonstrated path is the Git preflight. `runGit()` at `src/core/attested-pi-run.ts:196-216` creates a real subprocess with no timeout, `AbortSignal`, closure hook, or kill/reap ownership. Shutdown closes admission and then awaits `registry.waitForTaskAdmissions()` at `src/extension.ts:530`. A Git process that does not exit therefore prevents the admission's `finally` from releasing the lease, while that preflight child is not a registered task that shutdown can stop.

Independent bounded repro:

- Script: `probes/repro-attested-admission-drain.mts`
- Log: `repro-attested-admission-drain.log`
- Exit: **0** (the script successfully demonstrated the defect)
- Setup: local fake `git` from an isolated `PATH`, which `exec`s `/bin/sleep 60`; no network, provider, auth, or Pi child.
- Shutdown observation window: 300 ms. The script then sent `SIGTERM` to its own fake Git process and awaited its exit so no probe child remained.

Observed:

```json
{
  "drainSettledBeforeExternalKill": false,
  "startSettledBeforeExternalKill": false,
  "externalKillWasRequired": true,
  "drainSettledAfterExternalKill": true,
  "registeredTasks": 0,
  "piSpawnCount": 0
}
```

Thus the post-close Pi-task/no-success invariant holds in this case, but the required bounded drain and preflight-child cleanup do not. The existing all-starter test pauses only `ensureRuntimeDir()`, the one preflight await already wrapped by `awaitTaskAdmissionBoundary()`, so its 4/4 rejection does not exercise this path.

**Fix direction:** make an admission carry cancellation ownership, not only a counter. Pass an admission `AbortSignal` and a bounded deadline through every asynchronous preflight. In particular, make `runGit()` abort-aware and kill/reap its subprocess on admission closure; ensure interrupted durable writes/streams/artifacts and managed work settle cleanup before releasing the lease. Add a real shutdown regression with a hanging injected Git preflight and assert bounded shutdown, child reaping, zero registered/Pi children, and no residual task artifacts. Closure checks only after an unbounded await are insufficient.

What did pass within this disposition:

- all four starters reject when the delayed runtime-directory boundary resumes after closure;
- ordinary insertion-before-spawn ownership and post-spawn metadata shutdown are covered;
- accepted EventBus work cannot return post-close success;
- the original in-flight EventBus repro now reports `responseOk:false` and no task/PID.

### 2. PASS — Overlapping `session_start` cannot recreate timer/update/UI resources

`beginSessionShutdown()` now always clears `currentCtx` and the current interval even on repeated calls (`src/extension.ts:234-247`). `session_start` rechecks `disposed` after runtime-directory setup, after UI setup, before and after interval creation, and before the update check (`src/extension.ts:498-519`). Update completion also checks disposal (`src/extension.ts:475-496`).

Evidence:

- original `repro-late-session-start.mts`: zero intervals after shutdown and after continuation, `leakedInterval:false`;
- genuine overlapping deterministic race test: pass;
- repeated real `AgentSession.reload()` tests: pass;
- source review found no post-close status/update UI mutation path.

### 3. PASS — Retention is bounded and preserves the newest notified result

`pruneOldTasks()` now selects the oldest finished task, excludes only a synchronous emit currently on-stack, abandons a pending publication as `retention_limit`, and removes that old entry (`src/core/registry.ts:2958-2970`). Task-local abandonment resolves the publication waiter and clears gate/retry ownership (`src/core/registry.ts:2599-2688`, `2743-2768`), so the old gate continuation is released rather than retained indefinitely.

Evidence:

- both original pruning repros retain the newer task and report it resolvable;
- the focused registry test invokes the production-registered `bg_result`, reads the committed inline answer, and retains the managed task;
- existing focused coverage verifies `claimFusionUsage()` returns true once and false thereafter;
- full SDK `BUG-182` repeats `bg_result` and verifies repeated retrieval carries no usage.

### 4. PASS — Reentrant synchronous emit settles once and truthfully

`terminalEmitInFlight` distinguishes the synchronous emitter stack. Reentrant closure clears queued ownership but defers settlement (`src/core/registry.ts:884-903`); the outer emitter then settles return versus throw once (`src/core/registry.ts:2696-2729`). The throw path sees closure, abandons once with the thrown detail, and schedules no retry. Normal non-closure failures retain the three-total-attempt, 100 ms policy and at-least-once listener semantics.

Evidence:

- service-level return and throw cases pass with one listener call and one attempt;
- successful reentrant close is `delivered`, has no abandon reason, and logs no diagnostic;
- throwing reentrant close is `abandoned/publisher_closed`, logs one diagnostic containing the listener error, and has no retry handle;
- persistent/transient listener retry tests pass;
- original reentrant repro now reports delivered state with an empty diagnostics array.

### 5. PASS — Lifecycle qualification now uses real installed host APIs

The new/revised tests execute the dependency's actual Pi 0.84.0 lifecycle surfaces rather than merely constructing unrelated harnesses:

- `tests/sdk/sdk.test.ts:823` calls `AgentSession.reload()` twice, observes runner replacement and stale-context invalidation, suppresses old terminals, and proves one response/terminal from each fresh activation;
- `tests/sdk/fusion-sdk.test.ts:1076` calls `AgentSession.reload()` with a live managed Fusion workflow, then proves stale-runner invalidation, old publication suppression, and a fresh ordinary publisher;
- `tests/sdk/lifecycle-sdk.test.ts:99` creates an `AgentSessionRuntime` and invokes `newSession()`, `switchSession()`, and `dispose()` over one shared EventBus, checking runner replacement, stale contexts, fresh response/publication, and no listener after dispose.

The direct-handler overlap test at `tests/sdk/sdk.test.ts:893` is clearly a deterministic synthetic race seam. The real API qualification tests already passed on the reviewed baseline, and the correction report correctly does not claim defect-red for them.

## Independent verification

All executable checks used:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery-review-2
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/delivery-review-2
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/delivery-review-2
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

`TSX=/private/tmp/pi-bg-closeout-iNoltL/delivery/node_modules/.bin/tsx`; npm used the absolute `--prefix /private/tmp/pi-bg-closeout-iNoltL/delivery` operand.

| Check | Exit / result | Evidence |
|---|---:|---|
| Focused `registry.test.ts` + `extension-api.test.ts` | 0; **45/45** | `focused-registry-eventbus.log` |
| Focused real/synthetic lifecycle pattern | 0; **4/4** | `focused-lifecycle-sdk.log` |
| Full SDK suite | 0; **46/46** | `sdk-full.log` |
| Five unchanged first-review repros | 0 each | `original-repros.log` |
| New hanging-attested-preflight repro | 0; defect reproduced | `repro-attested-admission-drain.log` |
| `npm run typecheck` | 0 | `typecheck.log` |
| Frozen maintenance checksums | 0; **49/49 OK** | `frozen-checksums.log` |
| `git diff --check a54bb8e..HEAD` | 0 | `preflight.log`, `final-integrity-precleanup.log` |
| Type-safety gate | 1; **1/2** | `type-safety.log` |

The type-safety failure is exactly the directed inherited pair in `src/core/anthropic-attribution.ts`: the false-positive comment at line 83 and existing double assertion at line 1493. It is not attributed to this R1 follow-up. I did not rerun the full unit suite; I inspected the supplied correction log showing 458/459 with only generated `docs/commands/bg.md` freshness failing. Generated docs were not edited or review-stamped.

## Review inputs and limits

Read the package gateway/index/read gate; all four owning authored docs; maintenance acceptance; first-review report and five repros; correction design/report and relevant logs; complete follow-up diff and changed source/tests; installed Pi 0.84.0 SDK/extension/session lifecycle implementation, docs, and examples; and the harness-installed Pi 0.86.0 SDK/extension/session docs/examples plus relevant linked session docs.

Limits:

- Darwin 24.6.0 arm64; Node `v24.16.0`; npm `11.13.0`; package dependency Pi `0.84.0`.
- No native Windows qualification. Injected Windows registry cases passed, but this is not a native-Windows claim.
- No live user session, auth, provider/model call, external network, paid API, Fusion maintenance route, delegated agent, GitHub operation, push, publish, or release run.
- No RPC/component/PTY/package/full-release suite claim.

## Route, integrity, and cleanup

Effective route was verified before substantive work:

- `PI_PROVIDER=openai-codex`
- `PI_MODEL=gpt-5.6-sol`
- `PI_REASONING_LEVEL=max`

Tracked source stayed byte-identical throughout. Final HEAD/tree remain the values above; `git status --short` contains only the pre-existing untracked read-only `node_modules` symlink. The 13 changed-file SHA-256 lists before/after match. Review reports/probes/logs occupy about 132 KiB before this report, below 150 MiB. Exact owned TMP/HOME/agent roots were removed. Review-owned test/probe children remaining: **0**; the hanging-Git probe explicitly terminated and reaped its child. No code, docs, tests, generated indexes, history, or attestations were changed.
