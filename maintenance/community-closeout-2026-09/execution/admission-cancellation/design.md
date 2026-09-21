# Admission cancellation correction — design and red plan

Effective route verified before source work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`. Correction base is `424a1d3f082e3e1443172a7a0a4d80a7dd76418e` on `closeout/delivery`.

## Root design

1. **An admission is an owned cancellation scope, not a counter.** Every registry starter receives an admission object with a one-way `AbortSignal`, one overall preflight deadline, and a release function. Registry/session closure aborts every live admission synchronously. The deadline is dependency-injectable for short deterministic tests. Admission release clears its timer and occurs only after the starter's currently owned operation and cleanup have settled.
2. **No abandoned mutating preflight promises.** Admission boundaries await the operation they started; they no longer win a `Promise.race` and leave `mkdir`, metadata, wrapper, stream, or durable-artifact work running after the lease is released. Operations that can cooperate receive the admission signal. Non-abortable Node/OS filesystem calls remain tracked and are awaited through handle close and artifact cleanup before release. This deliberately favors truthful ownership over pretending an unabortable syscall was physically cancelled.
3. **Git is a cancellable, bounded owned subprocess.** `gitRepoRoot` and `gitAuthoritySnapshot` receive the admission signal and absolute deadline. Each `git` command is direct-spawned with bounded stdout/stderr capture and an explicit failure when the cap is exceeded. On cancellation/deadline, the exact spawned process tree receives TERM then bounded force escalation (detached process group on POSIX; the existing structured `/T` then `/T /F` taskkill helper on Windows), and the promise waits for the direct child close/reap before settling. Timers and abort listeners are removed. Cancellation/timeout errors remain distinct from genuine Git/non-repository failures; no empty-authority fallback exists.
4. **Pre-insertion artifacts remain cleanup-owned.** Telemetry-wrapper writes use Node's abort-aware write API and are removed after the write settles. Attested output/events/stderr/wrapper/metadata writes use an optional signal added to the existing durable-fs API. Durable writes check cancellation between phases, always close opened handles, remove uncommitted temp files, and complete post-rename directory sync before surfacing cancellation. Interrupted output streams are destroyed and observed closed before task files are removed. Cleanup failures are surfaced rather than logged-and-forgotten.
5. **Managed preflight cancellation settles.** If managed work has not yet become registry-owned, closure invokes its cancellation callback and awaits its completion/cleanup settlement before releasing the admission. Once insertion/spawn has happened, the existing registry ownership and shutdown snapshot remain authoritative; no accepted late continuation can publish or return success.
6. **Scope and invariants preserved.** Normal Git authority and sidecar ordering/hashes stay unchanged. Existing terminal publication, retention, reentrant emission, notification, EventBus, and real Pi lifecycle behavior are not redesigned. No launcher, attribution, Fusion feature, shell policy, package/lock, generated docs, or shared planning/state files change.

## OS/filesystem limit

`AbortSignal` cannot physically cancel every kernel filesystem syscall, and POSIX cannot reap grandchildren directly. The implementation will not claim otherwise: filesystem phases remain awaited and cleanup-owned, while Git uses a detached process group/tree termination and waits for the direct Git child `close`. If an OS never reports an uninterruptible syscall/process exit even after force termination, shutdown can still wait rather than falsely release ownership; failures from signal/tree helpers are reported. The real regression proves bounded behavior for an ordinary local subprocess tree, not for an uninterruptible kernel state. Native Windows is unavailable; Windows behavior remains covered through the shared taskkill helper and injected mocks only.

## Red-first plan

Before production edits:

1. Run the independent `repro-attested-admission-drain.mts` unchanged on `424a1d3`; retain its fake-Git `exec /bin/sleep 60` observation that start and drain remain unsettled until the probe externally kills Git.
2. Add focused tests for:
   - pre-aborted Git (zero spawn);
   - cancellation while Git is running, TERM/force tree ownership, child close/reap, and listener/timer cleanup;
   - an injected short overall admission deadline;
   - normal Git output, non-repository/nonzero Git, spawn error, and explicit output-cap failure;
   - injected Windows `/T` and `/T /F` tree-kill phases without a native-Windows claim;
   - durable direct/atomic writes cancelled at controlled boundaries, with handle close, temp cleanup, and no rename after pre-commit cancellation;
   - managed pre-insertion cancellation waiting for workflow settlement;
   - real local fake-Git process-tree shutdown with bounded starter plus admission drain, no test rescue on success, root/descendant gone, zero registry/Pi children, and no task-file residue.
3. Run only the new test names/files against unchanged production and retain expected failures.

## Green plan

Use only the isolated roots and environment required by the brief:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/admission-cancellation
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/admission-cancellation
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/admission-cancellation
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

Run focused attested/admission/durable-fs/registry/EventBus tests; the real SDK lifecycle pattern and full SDK acceptance; typecheck; relevant launch/Windows helper tests; and the original review repro expecting bounded completion without external kill. Preserve the inherited generated-doc and attribution type-safety findings as inherited; do not hand-edit generated docs or self-attest.
