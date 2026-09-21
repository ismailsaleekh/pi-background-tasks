# Narrow independent R1 admission/preflight review — Sol5.6/max OAuth

## Verdict

**NOT READY.** The original HIGH finding—an uncancellable hanging Git subprocess holding attested admission drain—is corrected. The directly changed post-spawn admission boundary still has one **HIGH** process-tree ownership defect: admission cancellation uses the normal task stop path, but that path cancels force escalation as soon as the direct group leader closes. A TERM-ignoring descendant can therefore survive session shutdown while the task is reported `killed` and cleanup reports no failure.

Reviewed identity:

- Base: `424a1d3f082e3e1443172a7a0a4d80a7dd76418e`
- Follow-ups: `609c70b1fee0ec3eb270eeb681b36a45a15f8682`, `dc8d2b7f000de2b460f4c189fb7fc9b3d3c39956`, `eedb599777884e10c57895f80a97e050e91f7604`
- HEAD: `eedb599777884e10c57895f80a97e050e91f7604`
- Tree: `ed9d9124ce532abed1cde4d14535678f85de1391`
- Range: 13 files, +1760/-226

## Remaining finding

### HIGH — Inserted admission-owned task can silently leak a process-group descendant

**Affected head lines:**

- `src/core/registry.ts:1101-1124` binds an inserted task to admission abort and invokes the normal `requestKill(..., 'SIGTERM')` path.
- `src/core/registry.ts:2754-2796` sends group TERM and arms the later group KILL.
- `src/core/registry.ts:3128-3134` clears that escalation timer immediately when an ordinary/delegate direct child closes; `:2784` would also suppress force once status is terminal.
- `src/core/registry.ts:2044-2050` has the same early timer cancellation for an attested Pi direct child.

The Git-specific implementation correctly avoids this race at `src/core/attested-pi-run.ts:416-420`: it keeps the grace timer referenced and probes/forces the detached group even if the direct Git child has already closed. The newly relied-on registry stop path does not preserve that invariant.

Independent deterministic repro:

- Probe: `probes/repro-inserted-child-descendant.mts`
- Log: `logs/inserted-child-descendant-repro.log`
- Exit: **0** (the probe asserted the defect)
- Shape: an ordinary admitted task is already inserted/spawned while its first metadata write is held at the same unabortable-operation seam used by the correction test. Its direct group leader exits on TERM; its child is an ordinary shell loop that ignores TERM but remains responsive to KILL. Registry grace/stop windows are shortened through supported constructor options.

Observed after more than the configured grace, admission drain, and the shutdown stop pass:

```json
{
  "directChildReaped": true,
  "descendantAliveAfterGrace": true,
  "descendantPgidAfterRootClose": 51674,
  "descendantRemainsInOwnedGroup": true,
  "escalationTimerAfterRootClose": false,
  "startResult": { "status": "rejected" },
  "admissionDrained": true,
  "stopResult": { "stopped": 0, "failures": [] },
  "taskStatus": "killed",
  "taskKillKind": "shutdown",
  "descendantAliveAfterDrainAndStop": true
}
```

The descendant PGID equals the departed direct child's PID, proving it remained in the task-owned detached group. This is not a kernel-uninterruptible limitation: the probe's failure-only cleanup killed it with SIGKILL. Production simply removed the scheduled force before it could run. The repro then explicitly rescued/reaped the process so the review left no child behind.

Although the timer-clearing behavior predates `eedb599`, that commit's correction specifically claims immediate ownership by binding admitted children to this stop path. Exercising the stop path's tree semantics is therefore a directly changed boundary, not an unrelated whole-program audit.

## Disposition of the requested changed boundaries

### Original hanging Git admission finding — PASS

- Startup `gitRepoRoot()` and `gitAuthoritySnapshot()` receive the admission signal and one absolute deadline.
- Finish authority uses the same bounded `runGitCommand()` policy and deadline.
- Cancellation, deadline, output limit, spawn/process failure, and genuine nonzero/non-repository failure remain distinct; none becomes empty Git authority.
- POSIX Git termination always performs the post-grace group force even if the root closes first, then waits for direct-child `close`; listeners and deadline timers are removed in `finally`.
- Windows uses structured shared `taskkill /T` then `/T /F` under injected tests; no native-Windows claim is made.

The original fake-Git `exec /bin/sleep 60` setup, with no success-path rescue, settled start plus drain in **28 ms**, reaped Git, and left zero registry tasks, Pi spawns, and task artifacts. A separate real probe made the Git root exit on TERM while a same-group descendant ignored TERM; production's force phase removed that descendant and reaped the root, with no rescue.

### Admission scopes and managed cleanup — PASS except for the process-tree finding

All four registry starters acquire one-way admission scopes and the overall deadline. Awaited preflight operations stay owned until settlement rather than being abandoned by a race. Managed pre-insertion cancellation waits for the workflow completion/child-cleanup promise. Post-close insertion/spawn/success checks and EventBus response gating passed. The inserted-child binding does initiate TERM immediately while metadata remains blocked, but it does not retain force ownership after group-leader close, as described above.

### Durable cancellation — PASS

Optional `{ signal }` preserves default sequencing and caller compatibility. Independent negative controls verified:

- a write failure remains primary over concurrent cancellation, close remains a cleanup failure, no rename occurs, and the owned temp is removed;
- cancellation overlapping successful rename completes directory sync/close, reports `renameCompleted:true`, and does not attempt pre-commit temp cleanup after commit;
- post-rename directory-sync failure remains the primary `DurableFileError`, reports `renameCompleted:true`, and is not mislabeled as cancellation.

The implementation truthfully awaits in-flight filesystem phases and handle cleanup; it does not claim physical cancellation of every kernel syscall.

## Independent commands and results

All executable checks used isolated roots below `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/admission-review` and:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

| Check | Result | Evidence |
|---|---:|---|
| `tsx --test tests/unit/attested-pi-run.test.ts tests/unit/durable-fs.test.ts tests/unit/registry.test.ts tests/unit/extension-api.test.ts tests/unit/windows-taskkill.test.ts tests/unit/pi-launch.test.ts tests/unit/posix-invariance.test.ts` | exit 0; **102/102** | `logs/focused-unit.log` |
| `tsx --test --test-concurrency=1 --test-name-pattern='AgentSession\.reload|overlapping late session_start|AgentSessionRuntime' tests/sdk/{sdk,fusion-sdk,lifecycle-sdk}.test.ts` | exit 0; **4/4** | `logs/real-lifecycle-sdk.log` |
| `npm run test:sdk` | exit 0; **46/46** | `logs/sdk-full.log` |
| `npm run typecheck` | exit 0 | `logs/typecheck.log` |
| Existing corrected original Git-drain probe | exit 0; 28 ms, no rescue | `logs/original-git-drain-green.log` |
| Independent root-exits/descendant-needs-force Git probe | exit 0; both gone, no rescue | `logs/git-root-exit-descendant-force.log` |
| Independent durability negative controls | exit 0 | `logs/durable-negative-controls.log` |
| Independent inserted-child tree repro | exit 0; defect reproduced; failure-only rescue | `logs/inserted-child-descendant-repro.log` |
| `git diff --check 424a1d3..HEAD` and worktree `git diff --check` | exit 0 | `logs/static-boundary.log` |
| SHA-256 before/after over all 261 tracked files | identical; `cmp` exit 0 | `logs/source-hashes-{before,after}.txt`, `logs/source-hash-compare.log` |

The green 102-unit and SDK suites do not cover the failing shape: their POSIX escalation cases keep the direct child open until KILL, while the admission metadata test uses a fake child without a TERM-ignoring same-group descendant.

## Environment and limits

- Effective review route verified before substantive work: `openai-codex` / `gpt-5.6-sol` / `max`.
- Darwin 24.6.0 arm64 (macOS 15.7.3); Node `v24.16.0`; npm `11.13.0`; Git `2.50.1`.
- Project Pi dependency: `0.84.0`; harness installation consulted: `0.86.0`.
- Real POSIX subprocess behavior was exercised. Native Windows was unavailable; Windows conclusions are limited to source review and injected/mock unit coverage.
- No live user state, auth/provider request, network, paid API, maintenance Fusion tool, delegated agent, GitHub operation, push, publish, release, checkout, copy, or source/docs/tests/index/history edit was used. SDK Fusion/delegate cases used only their local fake children.
- Directed inherited attribution type-safety and generated-doc freshness failures were not re-litigated.

## Integrity and cleanup

Tracked files remained byte-identical: HEAD/tree are unchanged, and `git status --short` contains only the pre-existing untracked read-only `node_modules` symlink. Review material occupied about **220 KiB** before this report. Exact review TMP/HOME/agent roots were removed. Known repro PIDs were absent, the owned-process scan was empty, and review-owned children remaining were **0** (`logs/cleanup.log`). No semantic receipt or attestation was written.
