# R1 registry POSIX process-group ownership correction

## Result

Corrected the remaining HIGH on `closeout/delivery` and stopped for narrow independent tree-ownership verification.

- Base: `eedb599777884e10c57895f80a97e050e91f7604`
- Follow-up: `ef3f1ac45116bbbb631352cac4cc4180bc4e8807` — `fix(core): retain POSIX process-group ownership`
- Final tree: `a11dbdd5176cd4dcd6efafc1d45775c89b879a3e`
- Design: `reports/registry-tree-fix/design.md`
- Corrected real probe: `reports/registry-tree-fix/probes/repro-inserted-child-descendant-green.mts`

No commit was amended or rewritten. `a54bb8e` remains an ancestor, preserving the original PR #25 credit.

## Committed paths

- `src/core/registry.ts`
- `src/core/common.ts`
- `tests/unit/registry.test.ts`
- `tests/unit/extension-api.test.ts`
- `docs/subsystems/background-task-runtime.md`
- `docs/concepts/completion-delivery.md`

No launcher, attribution, Fusion/config/shell/lazy/persistence, package/lock, generated documentation, shared testing/state, `runGitCommand`, durable-fs, Windows helper, or extension registration path changed.

## Exact ownership policy

1. Each ordinary, delegate, or attested non-Windows detached spawn captures its positive process-group id directly from that child once. The signal target is never reconstructed from persisted/mutable task PID metadata. Close/error listeners are installed before admission binding can synchronously initiate termination.
2. The first POSIX stop publishes one shared termination state and one referenced grace timer before TERM. Concurrent user/admission/shutdown stops reuse it.
3. Direct-leader close probes the still-owned negative group id but does not clear the owner. Only observed `ESRCH` releases authority and disarms its timers.
4. Grace expiry probes the group, latches force before any reentrant boundary, sends at most one group `SIGKILL`, and performs bounded signal-0 proof until `ESRCH`. SIGKILL never rearms grace.
5. Ordinary/delegate and attested finalizers await that state before terminal metadata, waiters, EventBus delivery, or notification. A force error/false result or inability to prove disappearance becomes `failed` with `Descendant processes may have leaked`; `stopTask` rejects on the same shared failure.
6. If natural close wins before any tree stop, finalization one-way releases signal authority. A stop racing after that point waits for the already-owned terminalization rather than signaling a possibly reused group id.
7. Windows remains on the accepted structured `taskkill /T` then `/T /F` implementation with no root-only fallback.

This owns only the originally detached process group. It does not search for descendants, target escaped/unowned processes, or claim Node physically reaps grandchildren.

## RED evidence on unchanged `eedb599`

All commands used isolated lane TMP/HOME/agent roots and `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

1. Original independent HIGH repro, unchanged:
   - Command: `tsx reports/admission-review/probes/repro-inserted-child-descendant.mts`
   - Exit **0** (its defect assertions passed).
   - Leader `55264` was reaped, descendant `55265` remained alive in PGID `55264`, escalation timer was absent, start/admission drain settled, shutdown reported `{stopped:0, failures:[]}`, task falsely reported `killed`, and failure-only group/direct rescue was required.
   - Evidence: `red-original-inserted-child-descendant.log`.
2. Permanent real POSIX regression against unchanged production:
   - Command: `tsx --test --test-name-pattern='retains an admission-owned POSIX group' tests/unit/registry.test.ts`
   - Exit **1**; **0/1** pass.
   - Failure: `leader close must retain the force owner`; baseline had already removed `killEscalationTimer`.
   - Evidence: `red-permanent-real-posix.log`.

## GREEN verification

### Corrected direct-root/descendant proof

Postcommit command:

```text
tsx reports/registry-tree-fix/probes/repro-inserted-child-descendant-green.mts
```

Exit **0**, with no success-path rescue. Evidence: `postcommit-inserted-child-descendant-probe.log`.

Observed:

- leader PID `70749`; descendant PID `70750`; descendant PGID before stop `70749`;
- after TERM/root close and before grace: leader gone, descendant alive in the owned group, task still `running`, escalation owner present, zero terminal frames and zero notifications;
- after admission drain plus shutdown cleanup: both PIDs gone, task `killed`, `{stopped:1, failures:[]}`, no escalation timer;
- exactly one group TERM, exactly one group KILL, four bounded group probes;
- failure-only group rescue `false`; failure-only direct rescue `false`.

Running the original defect-asserting probe on corrected production exited **1** because both descendant-alive assertions became false; it also reported both failure-only rescue flags `false`. Evidence: `original-repro-now-rejects-defect-expectation.log`.

### Tests

| Check | Result | Evidence |
|---|---:|---|
| Accepted focused Git/durable/registry/EventBus/platform subset plus new controls | exit 0; **110/110** | `postcommit-focused-unit.log` |
| Of that, registry tests | **48/48** (accepted 40 plus 8 ownership controls) | same log |
| EventBus protocol | **8/8** | same log |
| Real Pi lifecycle qualification (`AgentSession.reload`, late `session_start`, `AgentSessionRuntime`) | exit 0; **4/4** | `green-real-lifecycle-sdk-final-precommit.log` |
| Full SDK | exit 0; **46/46** | `postcommit-sdk-full.log` |
| Typecheck | exit 0 | `postcommit-typecheck.log` |
| `git diff --check eedb599..HEAD` | exit 0 | `postcommit-integrity.log` |
| Frozen Git/durable/launcher/Windows/extension/package/generated/shared-plan paths diff | empty; exit 0 | `postcommit-integrity.log` |

The focused total is the independently accepted **102/102** baseline plus eight permanent POSIX controls: real inserted admission tree, already-aborted/reentrant admission binding, ordinary root-close user stop with concurrent sharing, natural-close authority release, already-gone group, loud force failure, delegate finalization, and attested finalization.

Intermediate retained logs show two test-fixture corrections only: the first green real fixture could receive TERM before installing its ignore handler, so readiness moved into the descendant; older fake harnesses also treated signal 0 as TERM/presence forever, so their injected group state was made explicit. No test sends a real signal to a fake/unowned PID.

## No false cleanup and error semantics

- The real probe proves terminal truth was withheld while the known descendant lived: status stayed `running`, the force owner remained present, and terminal/notification counts stayed zero.
- The ordinary user-stop control proves terminal delivery occurs only after group disappearance and one force.
- The force-failure control makes `stopTask` reject, persists the descendant-leak warning, and publishes `failed`, never `killed` success.
- Already-gone groups disarm on `ESRCH` without KILL or stale timers.
- Natural-close terminalization releases signal authority one way; a late stop waits and never targets a mutable/reused PID.

## Preserved behavior and limits

- Accepted Git cancellation/reaping and durable-fs implementations are byte-unchanged and their focused tests remain green.
- Admission closure/drain, managed cleanup, terminal EventBus ordering/retry/abandonment, notification truth, retention, real reload/runtime replacement, delegate/Fusion SDK behavior, and Windows structured taskkill tests remain green.
- POSIX was exercised with real detached groups. Native Windows was unavailable; Windows statements are limited to unchanged source and injected/platform unit coverage.
- A kernel-uninterruptible group can outlive the bounded proof window. The runtime then reports a loud failed cleanup; it does not fabricate disappearance or physical reaping. A process that deliberately escapes the originally owned group is not searched for or killed.
- Generated docs stayed frozen as directed; only authored behavioral prose changed.

## Route, boundaries, and cleanup

- Effective route: `openai-codex` / `gpt-5.6-sol` / `max`.
- Host: macOS 15.7.3 / Darwin 24.6.0 arm64; Node `v24.16.0`; npm `11.13.0`; Git `2.50.1`.
- No network, provider call, user auth/state, paid API, Fusion maintenance tool, delegated agent, GitHub operation, push, publish, release, checkout, copy, or native-Windows run was used.
- Evidence is about 180 KiB, below the 200 MiB limit. Lane TMP/HOME/agent roots were removed. Owned-process scan: none; remaining owned children: **0**. Worktree is clean except the pre-existing untracked read-only `node_modules` symlink. See `cleanup.log`.

This is implementation evidence, not independent signoff. The branch is stopped for the requested narrow independent process-tree ownership verification before integration.
