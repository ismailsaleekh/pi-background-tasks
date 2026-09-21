# Narrow independent POSIX tree-ownership verification — Sol 5.6/max OAuth

## Verdict

**PASS for the specific remaining HIGH finding and the six-file changed boundary.**

`ef3f1ac45116bbbb631352cac4cc4180bc4e8807` corrects the admitted-task leader-close/descendant leak from `eedb599777884e10c57895f80a97e050e91f7604`. I found no remaining severity in the reviewed scope. The corrected real process case retained force ownership after the leader exited, withheld terminal truth while the TERM-ignoring descendant lived, killed the original detached group exactly once, and required no rescue.

Reviewed identity:

- Base: `eedb599777884e10c57895f80a97e050e91f7604`
- Base tree: `ed9d9124ce532abed1cde4d14535678f85de1391`
- HEAD: `ef3f1ac45116bbbb631352cac4cc4180bc4e8807`
- HEAD tree: `a11dbdd5176cd4dcd6efafc1d45775c89b879a3e`
- Effective route: `openai-codex` / `gpt-5.6-sol` / `max`

## Changed boundary inspected

The range contains exactly these six paths:

- `src/core/registry.ts`
- `src/core/common.ts`
- `tests/unit/registry.test.ts`
- `tests/unit/extension-api.test.ts`
- `docs/subsystems/background-task-runtime.md`
- `docs/concepts/completion-delivery.md`

Range size is `+992/-107`. `git diff --check eedb599..HEAD` and worktree `git diff --check` both exited 0. The frozen Git, durable-fs, launcher, Windows helper, EventBus implementation, extensions, package/lock, generated index/read gate, and shared test-plan paths have an empty range diff (`FROZEN_PATHS_DIFF_EXIT=0`). Evidence: `logs/static-boundary.log`.

## Root-contract verification

### Immutable ownership and reentrant ordering

- `src/core/common.ts:141-144` adds in-memory-only group ownership and one-way authority release fields; `snapshot()` does not persist either field.
- `src/core/registry.ts:1118-1130` captures a positive safe-integer PGID directly from the non-Windows detached child returned by the spawn. POSIX signaling reads that field, not mutable `task.pid` or metadata.
- Ordinary, delegate, and attested launch paths capture ownership, install close/error listeners, and only then bind admission cancellation (`registry.ts:1301-1356`, `1685-1734`, `1934-1989`). An already-aborted bind can therefore close synchronously without outrunning ownership/listener publication.
- `beginPosixProcessGroupKill()` (`registry.ts:2514`) stores the single state and referenced grace timer before TERM. `killSignalSent` is also latched before the injected/real signal boundary. Concurrent stops reuse the same WeakMap state, TERM latch, timer, and force latch.

The independently rerun controls confirmed the original spawn PID remained the signal target after mutable `task.pid` was changed, and the reentrant admission-close case produced one TERM and no duplicate force.

### Leader close, truthful finalization, and delivery

- Direct-child close no longer clears a POSIX force owner. `awaitPosixProcessGroupBeforeTerminal()` (`registry.ts:2753`) probes the owned group and awaits the shared settlement.
- Both finalizers cross that barrier before terminal metadata/status, waiters, EventBus publication, or notification: attested at `registry.ts:2058-2091`; ordinary/delegate at `registry.ts:3420-3444`.
- Natural close with no requested tree stop synchronously releases signal authority and deletes the in-memory PGID. `stopTask()` (`registry.ts:2197-2234`) detects that one-way state and waits for existing terminalization rather than signaling a possibly reused target.

The real probe observed `running` status, a live escalation owner, and zero terminal frames/notifications after leader close while the descendant remained alive. The ordinary non-shutdown unit separately proved one terminal snapshot and one notification only after group disappearance. Delegate and attested controls use the same barrier and passed.

### ESRCH, one-shot force, bounded proof, and loud failures

- Signal-0/force `ESRCH` is the successful absence observation and clears the owner (`registry.ts:2587-2611`, `2668-2699`).
- Force is latched before probe/signal reentrancy, sends at most one group SIGKILL, never arms another grace timer, and performs referenced 10 ms bounded probes until ESRCH (`registry.ts:2632-2702`).
- A false/non-ESRCH force result or proof deadline records `Descendant processes may have leaked`, settles the owner as failed, persists diagnostics, causes `stopTask` to reject, and makes a close-in-progress finalize as `failed`, not `killed` success (`registry.ts:2613-2657`, `2671-2699`, `2771-2812`).
- Missing immutable group ownership throws before any group signal or child-handle fallback. The accepted POSIX child-handle fallback remains limited to a failed initial group TERM; it does not replace group force/proof ownership. Windows retains its no-root-only-fallback policy.

My additional injected probe covered gaps directly rather than relying on test declarations:

- persistent post-KILL group presence: bounded in 143 ms, one TERM, one KILL, 12 probes, terminal metadata/status/notification all `failed`, leak warning present, no child fallback, no stale timer;
- two explicit force requests: zero TERM, exactly one KILL, two probes, no grace re-arm or child fallback;
- missing captured ownership with a mutated `task.pid`: zero group signals, zero child fallback, and a loud `has no owned POSIX process group` rejection.

All fake-PID controls injected TERM/KILL/signal-0 behavior; they sent no OS signal to a fake or unowned PID. Evidence: `probes/posix-termination-controls.mts`, `logs/posix-termination-controls.log`.

## Corrected real reproduction

Independent rerun of the corrected original admission seam:

```text
node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/registry-tree-fix/probes/repro-inserted-child-descendant-green.mts
```

Exit **0**. Observed:

- leader PID `76035`, descendant PID `76036`, descendant PGID `76035`;
- before force: leader gone, descendant alive in the owned group, task `running`, force owner present, terminal count 0, notification count 0;
- admission start rejected after closure and admission drain completed;
- after cleanup: both PIDs gone, task `killed` with `killKind=shutdown`, `stopAllRunning={stopped:1,failures:[]}`;
- exactly one group TERM, one group KILL, and four group probes;
- failure-only group rescue `false`; failure-only direct rescue `false`.

This is a corrected-outcome probe with positive assertions. I did not treat the old defect-asserting probe's historical exit 0, its declaration, or the worker's old-red inversion as green evidence. Evidence: `logs/corrected-real-probe.log`.

## Independent commands and outcomes

Every executable check used the isolated review TMP/HOME/agent roots and:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

| Check | Independent result | Evidence |
|---|---:|---|
| Corrected inserted leader/descendant real probe | exit 0; both gone; no rescue; 1 TERM/1 KILL | `logs/corrected-real-probe.log` |
| `tsx --test` over attested Git, durable-fs, registry, EventBus, Windows helper, launcher, and POSIX invariance units | exit 0; **110/110** | `logs/focused-110.log` |
| Registry portion of that run | **48/48**, including all eight new ownership controls | `logs/focused-110.log` |
| EventBus protocol portion | **8/8** | `logs/focused-110.log` |
| Real lifecycle SDK name-filter (`AgentSession.reload`, overlapping late `session_start`, `AgentSessionRuntime`) | exit 0; **4/4** | `logs/real-lifecycle-4.log` |
| Independent proof-failure/one-shot/unowned-PID controls | exit 0; all assertions passed | `logs/posix-termination-controls.log` |
| `tsc --noEmit` | exit 0 | `logs/typecheck.log` |
| Range/worktree diff checks and frozen-path check | exits 0 | `logs/static-boundary.log` |
| SHA-256 manifest comparison over all 261 tracked files | identical; `cmp` exit 0 | `logs/source-hashes-{before,after}.txt`, `logs/integrity-final.log` |

Per the narrow brief, I did not rerun the full SDK suite. I inspected the worker's `postcommit-sdk-full.log` (reported exit 0, 46/46) but do not count it as independent execution here.

## Preserved behavior and limits

- Accepted Git cancellation/reaping and durable-file cancellation implementations are byte-unchanged; their focused tests passed in the 110-test run.
- Admission closure/drain, EventBus ordering/retry/abandonment, terminal metadata ordering, notification truth, retention, real reload/runtime replacement, delegate/attested finalization, shell invariance, and launcher behavior passed their owning controls.
- `src/core/windows-taskkill.ts` is unchanged. Injected registry and helper tests preserve structured `taskkill /T` then `/T /F`, exit-128 handling, force settlement, and no root-only fallback. Native Windows was unavailable, so this is not a native-Windows qualification.
- The guarantee is disappearance of the originally owned detached POSIX group as observed by signal 0. It does not claim `waitpid` reaping of grandchildren, cancellation of kernel-uninterruptible work, or discovery/termination of processes that deliberately escape that group. Force/proof uncertainty is bounded and loud rather than reported as successful cleanup.
- No broader accepted Git/durable/admission/publication/lifecycle design was reopened.

## Source integrity

The before/after all-tracked-files SHA-256 manifests are identical:

```text
0b4644dafcdc3030007cdd6154b1b259fd0726f82fa2a2952958f4bed5d36fff
```

Current six-file SHA-256 values:

```text
93a3f9afcc4ee83190f4db8a0a8f6f0a1b0c45333766a4de28b0ba69345b37da  docs/concepts/completion-delivery.md
3b58cb1f208416a3f5a72bcd72051468b017d77c731c020aceef18f9f9b1272d  docs/subsystems/background-task-runtime.md
bcd85471d5ea6a197b6e445e2a749ab045b58e56cf53b883f13a6ec367de4c75  src/core/common.ts
8495fcb94309d9ca35550189dfa211419906707e7939a0314a2113fab46f1f18  src/core/registry.ts
2e97fce23110c25bb225d726f43d28c9a8872307617cfd56d73194e618ab18a9  tests/unit/extension-api.test.ts
ed78db05d4134c3b899e87ec0d27d4d0224a45c293c2af63e06c2f53154cdf6c  tests/unit/registry.test.ts
```

Final Git status is unchanged from entry: only the pre-existing untracked read-only `node_modules` symlink is present.

## Environment and cleanup

- Darwin 24.6.0 arm64 / macOS 15.7.3; Node `v24.16.0`; npm `11.13.0`; Git `2.50.1`.
- Review report material is about 280 KiB, below the 150 MiB limit.
- Review TMP/HOME/agent roots were removed. Both real-probe PIDs and their process groups returned ESRCH; the post-command owned-path scan found **zero owned children**. Evidence: `logs/cleanup.log`.
- No source/docs/tests/index/history edit, checkout/worktree/copy, install, network/provider/user-state access, GitHub operation, push, publish, paid API, Fusion maintenance tool, delegated agent, or semantic receipt/attestation was used.
