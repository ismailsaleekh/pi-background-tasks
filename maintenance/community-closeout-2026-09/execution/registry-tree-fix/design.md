# Registry-owned POSIX process-group termination — design and red plan

Effective route checked before source work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`. Correction base/HEAD is `eedb599777884e10c57895f80a97e050e91f7604` on `closeout/delivery`.

## Finding and root invariant

An inserted/spawned ordinary, delegate, or attested task is bound to admission cancellation, but the shared registry finalizers currently clear the task's grace timer when the direct child closes. They also let the timer suppress force once direct-child finalization makes status terminal. On POSIX, direct leader close does not prove that its detached process group is empty, so a TERM-ignoring same-group descendant can survive while admission drain/shutdown report a clean `killed` task.

After a tree stop is requested, the registry must retain one bounded owner for the originally spawned detached process group. Direct-child close may disarm that owner only after an `ESRCH` observation proves the group is gone; it may not cancel force merely because the leader closed. Terminal metadata, waiters, EventBus publication, and completion notification must wait for group termination success or carry a loud `failed` result when force/proof fails. This is process-group termination ownership, not a claim that Node physically reaps grandchildren or can cure kernel-uninterruptible processes.

## Design

1. **Capture immutable ownership at spawn.** Immediately after each non-Windows detached ordinary/delegate/attested spawn returns, record the positive child PID as that task's owned process-group id, before admission binding, listener registration, or any kill side effect that can reentrantly emit `close`. Group signals use only this captured in-memory ownership, never a later snapshot/metadata PID and never process discovery.
2. **One shared POSIX termination state.** The first POSIX TERM request creates one task-local registry state and publishes its referenced grace timer before sending TERM. Concurrent stop/admission/shutdown requests reuse that state and timer. The state records the original group id, one completion, one force-attempt latch, and one failure; SIGKILL is attempted at most once and never rearms grace.
3. **Leader close is only an observation point.** Ordinary/delegate and attested finalizers do not clear an active POSIX tree timer. Before terminal work they probe only the still-owned negative group id with signal 0. `ESRCH` settles ownership and clears timers. If the group still exists, finalization awaits the shared owner; therefore status remains `running`, waiters remain blocked, and no terminal delivery occurs while a known descendant survives.
4. **Bounded grace, force, and proof.** At grace expiry, the owner probes the group. If already gone it disarms without SIGKILL. Otherwise it marks force attempted before invoking the injected/real group SIGKILL, preventing reentrant close from creating a second attempt. After successful SIGKILL it performs short bounded signal-0 probes until `ESRCH`, within the configured stop window. These ownership timers stay referenced so a departed leader cannot let the Node host exit while its descendant is still owned. Observation of `ESRCH` permanently disarms ownership, preventing a later signal to a reused group id.
5. **Loud uncertainty/failure.** A non-`ESRCH` group force error, false force result, or group still present at the bounded proof deadline becomes a task error explicitly warning that descendant processes may have leaked. A direct-child finalizer converts the terminal result to `failed` before durable metadata/delivery; a concurrent `stopTask` rejects on that same shared failure. The implementation does not search for or directly signal descendants. A kernel-uninterruptible group can therefore produce a bounded loud failure, never a false successful cleanup claim.
6. **Fallback and already-gone behavior.** The documented child-handle fallback remains for a failed group TERM. `ESRCH` is positive evidence that the owned group is already gone and disarms group escalation; other group errors remain owned through the force phase instead of being hidden by root-only fallback. Normal completion with no requested tree stop is unchanged.
7. **Windows remains frozen.** Existing structured `taskkill /T` then `/T /F`, force barrier, exit-128 handling, and no-root-only-fallback behavior are unchanged. Managed-task cancellation has no POSIX process group and remains unchanged.
8. **Finalization integration only.** Both ordinary/delegate `finalizeTask` and `finalizeAttestedPiTask` await the POSIX owner just as they already honor Windows force settlement. No launcher, Git cancellation/reaping, durable-fs, registration block, persistence, shell, package, lock, generated-doc, or accepted publication design changes.

## Red-first plan on unchanged `eedb599`

1. Run the independent `reports/admission-review/probes/repro-inserted-child-descendant.mts` unchanged with isolated TMP/HOME/agent roots. Preserve its expected defect assertion: leader gone, same-group descendant alive after grace and shutdown, no escalation timer, task falsely `killed`, empty shutdown failures, and failure-only rescue required.
2. Add permanent focused tests before production edits and run only their names against unchanged production. The primary real POSIX test blocks first metadata after spawn, closes admissions, has the leader exit on TERM, and has a same-group descendant ignore TERM but die on KILL. Its corrected expectation is both PIDs gone after start rejection/admission drain/shutdown, no success-path rescue, no stale timer, and no terminal success/false cleanup receipt while the group is live.
3. Add injected controls for root-close-before-grace, ordinary user stop, delegate/attested finalization barriers, already-gone group, concurrent stop sharing, one force/no rearm, and loud force/proof failure. Every fake PID test injects kill/probe behavior; no test sends real signals to a mock/unowned PID.

## Green verification plan

Use only:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/registry-tree-fix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/registry-tree-fix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/registry-tree-fix
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

Run focused registry/EventBus/platform units (including the accepted 102-test baseline subset), targeted real SDK lifecycle and full SDK where warranted, project typecheck, and the original independent repro inverted to require correction with no success-path rescue. Record exact exits/counts and verify owned children/timers are zero. Keep all configured grace/stop windows short; no successful test waits 60 seconds.
