# Independent D1 reload-survival review

## Verdict

**Package code: REJECT / changes required.**

The normal POSIX path is real and substantially matches the design: an opted ordinary shell child survives one or repeated bound `AgentSession.reload()` calls without respawn; gap completion, retained output/PID/nonce/path/policy, absolute timeout, cumulative cap, post-reload controls, notification deduplication, lifecycle kills, and PID/file non-adoption all passed on Node 22.19.0 and 24.16.0. EventBus v1 remains request-side closed and D2/P1 code was not added.

That happy-path evidence does not close the package. Three owner/settlement races below violate the required failure and delivery invariants. Finding 1 can turn a launch that reports failure into an unowned live OS process. Findings 2 and 3 lose a handoff publication or permanently retain an already-dead execution slot.

Do not integrate the two commits as accepted D1 package code on this review.

## Findings

### HIGH — failed admission drops the only child/tree authority even when stop did not settle

**Files:** `src/core/registry.ts:1591-1609`; `src/core/reload-shell-owner.ts:256-262, 1530-1548`

When initial metadata/admission fails after spawn, `startReloadableTaskAdmitted()` awaits `execution.requestStop()`, records a timeout/failure in `cleanupError`, and then unconditionally calls `releaseExecution()` whenever the old lease is still current. `removeExecution()` invokes `releaseResources()` even though the execution is nonterminal. This removes close/output listeners, clears timers, drops the child and stream references, and deletes the global owner entry. It contradicts the design requirement to retain minimal authority when close/tree disappearance cannot be established.

Concrete real-child reproduction:

```text
node node_modules/tsx/dist/cli.mjs \
  /private/tmp/pi-bg-closeout-iNoltL/reports/reload-survival-review/probes/admission-real-orphan.mts
```

The probe removes the task directory after the real detached child is spawned, forcing initial metadata failure, and injects the kernel-uninterruptible seam in which TERM/KILL are accepted but no close/disappearance is observed within 100 ms. Observed, with PID normalized:

```json
{
  "pid": "<admission-child>",
  "launchRejected": true,
  "childAliveAfterRejection": true,
  "ownerExecutions": 0,
  "executionPhase": "released",
  "retainedChildHandle": false,
  "signals": ["SIGTERM", "0", "SIGKILL", "0", "0", "0", "0", "0"]
}
```

The probe then explicitly killed `<admission-child>` and verified it gone. Without that probe cleanup, the caller has received a failed launch while the package has discarded its only management authority over a live process.

### MEDIUM — a throwing terminal emitter during reentrant reload is falsely abandoned after one attempt

**File:** `src/core/registry.ts:3831-3868, 3919-3933`

`tryPublishTerminalNow()` checks owner membership only before invoking the emitter. If the emitter synchronously initiates reload handoff/old-service closure and then throws, control returns to the old registry. `handleTerminalPublishFailure()` sees that old registry as closed and marks the shared task `abandoned/publisher_closed`. There is no post-emitter ownership check for the throw path. The fresh activation therefore inherits an abandoned ledger rather than the pending ledger with one consumed attempt required by the design.

Concrete reproduction:

```text
node node_modules/tsx/dist/cli.mjs \
  /private/tmp/pi-bg-closeout-iNoltL/reports/reload-survival-review/probes/reentrant-throw.mts
```

Observed:

```json
{
  "taskStatus": "completed",
  "publicationState": "abandoned",
  "abandonmentReason": "publisher_closed",
  "attempts": 1,
  "oldAttempts": 1,
  "freshPublications": 0,
  "ownerExecutions": 0
}
```

Expected: the throw consumes attempt 1, the fresh activation retries at attempt 2, and only later success/exhaustion determines delivered/abandoned truth. This matters for supported custom EventBus implementations whose `emit()` propagates listener failures; the package documentation explicitly promises bounded retry and valid-handoff transfer for that case.

### MEDIUM — late clean close after deadline timeout leaves a permanent orphaned global slot

**File:** `src/core/reload-shell-owner.ts:272-315` (especially the catch at 308-312)

If no claimant appears, expiry awaits `requestStop()`. When that bounded wait rejects, the catch only logs. It installs no continuation on `execution.terminal` and performs no later owned-group/tree probe. A child that closes after the bounded wait can become terminal and disappear from the OS while remaining forever in the hub's `orphaned` slot. `dispatch()` queues its terminal event because no adapter exists, but never removes it.

Concrete real-child reproduction:

```text
node node_modules/tsx/dist/cli.mjs \
  /private/tmp/pi-bg-closeout-iNoltL/reports/reload-survival-review/probes/deadline-real-late-close.mts
```

The real child exits naturally after the injected 100 ms stop wait. At 500 ms, with PID normalized:

```json
{
  "pid": "<late-close-child>",
  "pidGone": true,
  "taskStatus": "failed",
  "executionPhase": "terminal",
  "ownerPhase": "orphaned",
  "ownerExecutions": 1,
  "retainedChildHandle": true,
  "nextActivationError": "pi_bg_reload_owner_activation_conflict: ... state orphaned"
}
```

Thus an already-gone child still retains old module state and prevents any later same-identity activation from binding until the host process exits. A deterministic structural version of the same result is in `deadline-late-settlement.mts`.

## Required status separation

### BLOCKED_ENVIRONMENT

**Native Windows D1 remains unqualified.** This Darwin 24.6.0 arm64 host has no native Windows runtime. The six native D1 cases are present and are not converted to skips/passes. Independent off-host execution returned exit 1 with **0 pass / 15 fail / 0 skip**, including all six D1 cases. Injected taskkill tests are useful but do not establish native pipe/handle continuity or descendant removal.

### BLOCKED_UPSTREAM

1. **Pi 0.84.0 and 0.86.0 empty or mode-only SDK reload:** `AgentSession.reload()` rebuilds the runner but emits fresh `session_start` only when one of UI context, command actions, shutdown handler, or error listener is truthy. `bindExtensions({})` and `{mode:"print"}` alone are not counted. The package correctly refuses new opted launches and leaves an old handoff to its deadline; it cannot claim it without the missing callback.
2. **Direct `AgentSession.dispose()`:** both host versions invalidate the runner without `session_shutdown`. `AgentSessionRuntime.dispose()` does emit `reason:"quit"` and is the supported cleanup path.
3. **D2 automatic built-in Bash promotion:** still blocked on a host execution-transfer/cancellation API and is outside these commits. No D2 workaround was found in the diff.

### Unsupported by design (not blockers disguised as passes)

| Transition | D1 behavior/status |
|---|---|
| Real same-process reload, exact session id + canonical cwd, counted binding | Intended supported path for opted `isAgent:false` ordinary shell work; happy path verified locally, but package rejected for findings above. |
| Default ordinary task on reload | Killed; verified. |
| `new`, `resume`/switch/import, `fork`, `clone` | No transfer; kill via runtime replacement. New/switch/fork/clone verified. |
| Graceful quit through `AgentSessionRuntime.dispose()` | Kill; verified. |
| Empty/mode-only SDK reload | `BLOCKED_UPSTREAM`; no fresh claim callback. |
| Direct `AgentSession.dispose()` | `BLOCKED_UPSTREAM`; no shutdown event. |
| Hard crash, SIGKILL, power loss, process restart, cross-process resume, VM/realm replacement | Unsupported. No PID/JSON/file adoption and no synthesized exit status. |
| Delegate, Fusion, managed, attested, `isAgent:true`, EventBus-v1 `run` | Survival unavailable/refused; verified at public and registry seams. |

## Independent verification

All cited reruns used isolated review `HOME`, `TMPDIR`, `PI_CODING_AGENT_DIR`, npm cache, and `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

| Command/evidence | Result |
|---|---|
| Node 22.19 focused owner + registry + EventBus + POSIX/Windows seams + component + real SDK/lifecycle | exit 0; **100/100**, 0 skipped (`logs/focused-node22.log`) |
| Node 24.16 same focused set | exit 0; **100/100**, 0 skipped (`logs/focused-node24.log`) |
| Node 22 typecheck + type-safety + docs verify/tests + payload + diff check | exit 0; type safety **4/4**, docs **8/8**, generated inventory **32 surfaces / 54 sources**, payload **110 files** (`logs/static-docs-safety.log`) |
| Real Pi 0.84 continuity, Node 22 | exit 0; one child, same task/PID/nonce/path, generation 2, handoff 1, `before-086` + `after-086`, exit 0 (`logs/host084-continuity.log`) |
| Windows suite on Darwin | expected exit 1; **0/15 pass, 15 fail, 0 skip** (`logs/windows-offhost.log`) |
| Isolated `npm pack --dry-run --json --ignore-scripts` | exit 0; `pi-background-tasks@2.5.0`, **110 files**, 581,613-byte package / 2,039,313-byte unpacked payload |
| Three adversarial probes above | process exit 0, but each emitted the defect state shown above |

Focused real POSIX coverage included:

- repeated real reload continuity with one child/object/id/PID/nonce/completion id/output path and one terminal frame + one notification;
- actual exit 7 during a held reload gap, with zero old frames and one fresh frame;
- leader exit plus TERM-ignoring descendant, one retained group force/proof, descendant gone before the passing assertion (cleanup is failure-only);
- original absolute timeout and one cumulative output cap across reload;
- post-reload tool and command status/log/kill, dock rerun policy, and changed configuration affecting only new work;
- actual runtime new/switch/fork/clone/quit kill behavior;
- copied JSON with a separate live PID producing no task, status, signal, or completion; the unrelated fixture was asserted alive before explicit fixture cleanup;
- short no-claim deadline asserting owner release and PID disappearance before failure-only cleanup.

Worker evidence was hash-verified and inspected rather than treated as certification by itself: full unit **576/576**, SDK **77/77**, RPC **10/10**, package **71/71**, scripted-provider **35/35**, type safety **4/4**, docs **8/8**, all with zero skips/failures. The SDK logs' stale-context diagnostics belong to the intentionally unsupported direct-`AgentSession.dispose()` characterization.

## Source, host, route, and payload receipt

- Package: `pi-background-tasks@2.5.0`
- Base: `fcf2af0950c8047ebf90b802e8049781fd3136fb`
- Target/HEAD: `8b4accccc5c54931619dc408d53b72d9ef9ec4ef`
- Target tree: `bd4d6118b0cc72023ad8306205d2a88e31d58bb6`
- Commits: `2114d33fbaf84075b1853af9a934e920b2b62f88`, then target `8b4accc...`
- Diff: 39 paths, 5,094 insertions / 135 deletions; no package/lock, delegate, Fusion, P1 lazy-loader, or D2 production edit.
- Injected route verified: `openai-codex / gpt-5.6-sol / max`.
- Package Pi: 0.84.0; global host Pi: 0.86.0. Relevant lifecycle/EventBus/loader/runner docs, examples, declarations, and implementation for both were inspected. Standard TUI/RPC/print/JSON source bindings are counted; empty/mode-only SDK bindings are not.

Key target SHA-256 values:

```text
4133564bfef268db66e5123bb90030d02a1e5eaedb3ceee00acfbd1f5bd38963  src/core/common.ts
9eb1146ab77b009a3fccbe5f1e0c66c493f3c7181436c0a79fba82f860a58808  src/core/registry.ts
f1fec6b0f1e95c2f47b8e39e36755241022956e0081a303817130c3180154274  src/core/reload-shell-owner.ts
29672729236fe4decdd3010c9374976a31238fba984c2fd8292af87a1390cc30  src/core/extension-api.ts
5110442dfc53cfab0fe970c8a8b5134d33f086717d570cd44b4408b662356f5a  src/extension.ts
54619e141b731cbee6b507d108b820795de84b9a06b54b3bad3e6eec7f1c21b6  tests/sdk/reload-survival-sdk.test.ts
719095a67fc2a18270452ad040a66f75d47337a05ccafe6a402598bccf425403  docs/manifest.json
```

The complete changed-file freeze before and after review is identical; both receipts hash to:

```text
8f10769373b80c821762fa7cac1240c81caa5281b97458956457ae150ee72d5c
```

Relevant host source hashes include Pi 0.84 `agent-session.js` `91e72d...`, runtime `9111bc...`, loader `0fd56e...`; Pi 0.86 `agent-session.js` `edaff7...`, runtime `61375f...`, loader `81106b...`; EventBus is identical `f96a9a...`. Full values are in `mechanical/pi-source-hashes.txt`; review evidence hashes are in `mechanical/review-evidence-sha256.txt`.

## Limits and cleanup

- No network, GitHub, provider/model call, paid API, Fusion/agent delegation, install, push, publish, source edit, index/history mutation, or source checkout/copy/worktree operation was performed.
- No full release rerun was needed; full worker logs were inspected and focused/safety/type/docs gates were independently rerun.
- Native Windows remains unavailable. Hard-crash/restart survival was neither run nor claimed.
- Report PIDs are normalized. Raw local logs retain non-secret randomized launch nonces and local fixture PIDs.
- All review fixture children, process groups, timers, and helpers are gone. The two defect probes that deliberately exposed live/late children explicitly cleaned them after recording the failed invariant. Review TMP/HOME/agent roots are empty; report material is below 1 MiB.
- Worktree tracked bytes and tree stayed frozen. Final status remains only the pre-existing untracked read-only `node_modules` symlink.

No fixes or attestations were written.
