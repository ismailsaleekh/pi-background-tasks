# Admission-cancellation correction report

## Result

Implemented the remaining R1 admission blocker on `closeout/delivery` and stopped for narrow independent preflight-ownership verification.

- Correction base: `424a1d3f082e3e1443172a7a0a4d80a7dd76418e`
- Implementation commit: `609c70b1fee0ec3eb270eeb681b36a45a15f8682` — `fix(core): cancel attested preflight admissions`
- Test follow-up: `dc8d2b7f000de2b460f4c189fb7fc9b3d3c39956` — `test(core): accept either bounded Git timeout source`
- Post-spawn ownership follow-up: `eedb599777884e10c57895f80a97e050e91f7604` — `fix(core): stop admitted children during write cleanup`
- Design/red plan: `/private/tmp/pi-bg-closeout-iNoltL/reports/admission-cancellation/design.md`

The second commit changes only the deterministic deadline assertion: the admission controller and Git's copy of the same absolute deadline can legitimately report either timeout code. The third binds an already inserted/spawned task to its admission signal, so shutdown stops that child immediately even when an unabortable metadata syscall is still admission-owned. No commit was amended. Original PR #25 ancestry and Erik Darling's credit in `a54bb8e` remain unchanged.

## Committed paths

- `src/core/attested-pi-run.ts`
- `src/core/durable-fs.ts`
- `src/core/registry.ts`
- `src/extension.ts` (shutdown comment only)
- `tests/unit/attested-pi-run.test.ts` (new)
- `tests/unit/durable-fs.test.ts`
- `tests/unit/extension-api.test.ts`
- `tests/unit/registry.test.ts`
- `docs/api/eventbus-v1.md`
- `docs/subsystems/attested-pi-runs.md`
- `docs/subsystems/background-task-runtime.md`
- `docs/subsystems/child-launch-durability-and-safety.md`
- `docs/subsystems/host-ui-and-telemetry.md`

No package/lock, generated docs, attribution, launcher, Fusion feature, shell policy, P1, shared `TESTING.md`/`TEST_PLAN.md`/state, release, or attestation file changed.

## Root correction

### Admission ownership

Every registry starter now receives a real admission scope:

- one-way `AbortController`/`AbortSignal`;
- one overall 30 second preflight deadline;
- a tracked timer cleared on release;
- release only after the operation started by that admission and its required cleanup settle.

Registry closure synchronously aborts every active scope. The old `Promise.race` boundary, which returned on closure while leaving its operation alive, is gone. Unabortable filesystem operations remain awaited and ownership-tracked. Managed cancellation awaits the workflow completion/child-cleanup promise before releasing its admission; inserted tasks remain registry-owned for finalization. An inserted process/managed task is also bound to the admission signal, so its normal stop path begins immediately while a metadata write finishes cleanup.

### Git preflight

`gitRepoRoot()` and `gitAuthoritySnapshot()` receive the admission signal and absolute deadline. `runGitCommand()` now:

- direct-spawns the exact `git` child with `shell:false`;
- creates a detached POSIX process group;
- captures stdout and stderr separately with an explicit 4 MiB per-stream ceiling;
- rejects loudly on the ceiling instead of using truncated authority;
- distinguishes admission cancellation, timeout, output-limit, spawn/process, and genuine nonzero/non-repository errors;
- sends POSIX group `SIGTERM`, waits the injected/default grace, then probes/forces the same group with `SIGKILL`;
- uses the existing bounded structured Windows `taskkill /T` then `/T /F` helper through injected mocks;
- waits for direct-child `close`/reap before resolving cancellation;
- clears deadline/abort listeners and process stream/listener ownership before settlement.

No aborted/non-repository path falls back to empty commit/tree/status authority. Finish-authority checks use the same bounded Git-command policy, preserving normal sidecar authority integrity.

### Writes and pre-insertion cleanup

- Ordinary telemetry-wrapper creation passes the admission signal to Node's abort-aware `writeFile` and removes the settled partial file on failure.
- Attested output/events/stderr/wrapper/metadata writes pass the admission signal through the durable helpers.
- The minimal durable-fs API change is optional `{ signal? }` on `write`/`replace` and their exported wrappers. Existing callers and durability sequencing remain unchanged.
- A cancelled durable operation always closes an opened handle. Atomic replacement removes its owned temp before rename. Cancellation overlapping a completed rename still finishes directory sync and reports `renameCompleted:true` before registry-owned artifact removal.
- Interrupted streams are observed closed before task-file removal. Removal/cleanup failures are aggregated and surfaced instead of logged-and-ignored.

This durable-fs change was required because post-await checks alone could not stop later write/sync/rename phases or prove handle/temp cleanup before admission release.

## Red evidence on `424a1d3`

All commands used the required isolated TMP/HOME/agent roots and `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

1. Original independent fake-Git `exec /bin/sleep 60` repro:
   - Command: `node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/delivery-review-2/probes/repro-attested-admission-drain.mts`
   - Exit **0** (defect successfully reproduced).
   - Observation: `drainSettledBeforeExternalKill:false`, `startSettledBeforeExternalKill:false`, `externalKillWasRequired:true`, then both settled only after probe rescue; registered tasks/Pi spawns were zero.
   - Log: `red-original-attested-admission-drain.log`.
2. New Git ownership unit file:
   - Command: `tsx --test tests/unit/attested-pi-run.test.ts`
   - Exit **1**; module-load failure because baseline had no cancellable `runGitCommand` export (**0 pass / 1 file failure**).
   - Log: `red-attested-unit.log`.
3. New durable cancellation boundaries:
   - Command: `tsx --test --test-name-pattern='cancellation' tests/unit/durable-fs.test.ts`
   - Exit **1**; **0/2 pass**. Baseline ignored cancellation, committed the atomic replacement, and resolved both operations.
   - Log: `red-durable-cancellation.log`.
4. Managed settlement plus real Git-tree shutdown regressions:
   - Command: `tsx --test --test-name-pattern='cancelled pre-insertion managed|real hanging attested Git' tests/unit/registry.test.ts`
   - Exit **1**; **0/2 pass**. Baseline released managed admission before cleanup settlement and the real Git start/drain exceeded 1500 ms until failure-only rescue.
   - Log: `red-registry-admission-cleanup.log`.

## Green verification

### Final commit checks

1. Focused attested/durable/admission/registry/EventBus/launch/platform units:
   - Command: `tsx --test tests/unit/attested-pi-run.test.ts tests/unit/durable-fs.test.ts tests/unit/registry.test.ts tests/unit/extension-api.test.ts tests/unit/windows-taskkill.test.ts tests/unit/pi-launch.test.ts tests/unit/posix-invariance.test.ts`
   - Head: `eedb5997...`
   - Exit **0**; **102/102 pass**.
   - Counts include registry **40/40** plus EventBus **8/8**. Thus the accepted pre-existing registry/EventBus **45/45** remain green, with three new registry tests added.
   - Log: `final-focused-unit.log`.
2. Real installed Pi lifecycle qualification:
   - Command: `tsx --test --test-concurrency=1 --test-name-pattern='AgentSession\.reload|overlapping late session_start|AgentSessionRuntime' tests/sdk/sdk.test.ts tests/sdk/fusion-sdk.test.ts tests/sdk/lifecycle-sdk.test.ts`
   - Head: `eedb5997...`
   - Exit **0**; **4/4 pass**.
   - Log: `final-real-lifecycle-sdk.log`.
3. Full existing SDK acceptance:
   - Command: `npm run test:sdk`
   - Head: `eedb5997...`
   - Exit **0**; **46/46 pass**.
   - Log: `final-sdk-full.log`.
4. Typecheck:
   - Command: `npm run typecheck`
   - Head: `eedb5997...`
   - Exit **0**.
   - Log: `final-typecheck.log`.
5. Original fake-Git setup with success-path rescue removed:
   - Command: `tsx reports/admission-cancellation/probes/repro-attested-admission-drain-green.mts`
   - Head: `eedb5997...`
   - Exit **0**.
   - Observation: start and drain settled without external kill in **27 ms**; `gitPidReaped:true`; zero registered tasks, zero Pi spawns, and `taskArtifacts:[]`.
   - Log: `final-attested-admission-drain-repro.log`.
6. `git diff --check 424a1d3..HEAD`: exit **0**.

A first postcommit focused run had **101/102** because the injected 20 ms deadline reported `attested_git_timeout` rather than the equally valid admission-controller timeout. No production code changed in response; `dc8d2b7` corrected that over-specific assertion, and the final **102/102** run above is green. The failed attempt is retained as `postcommit-focused-unit.log`.

### Directed inherited failures

- `npm run test:type-safety`: exit **1**, **1/2 pass**. The only findings remain the directed inherited `src/core/anthropic-attribution.ts:83` false-positive comment and `:1493` double assertion. No correction-owned path was reported. Log: `final-type-safety.log`.
- `npm run docs:verify`: exit **1** on the already directed inherited generated `docs/commands/bg.md` staleness. No generated region/index/manifest was hand-edited and no semantic receipt was self-awarded. Log: `final-docs-verify.log`.

## Process reaping and artifact proof

The permanent real test creates a local executable named `git`. That process starts a real `/bin/sleep 60` descendant. It then closes registry admissions and asserts, without success-path rescue:

- starter plus `waitForTaskAdmissions()` finish inside 1500 ms;
- Git root PID no longer exists;
- descendant PID no longer exists;
- registry task count is zero;
- Pi spawn count is zero;
- no files remain below the task runtime root.

Its `finally` rescue executes only when assertions fail. The green external probe uses the independent review's original fake-Git `exec /bin/sleep 60` shape and likewise performs no rescue on success.

After all checks, exact owned TMP/HOME/agent roots were removed and a process scan found **0** owned test/probe children. Reports/probes/logs are about 184 KiB, far below 300 MiB.

## Explicit OS/cancellation limits

- Node cannot physically cancel every filesystem syscall. Admission cancellation prevents later phases, but an already-entered unabortable syscall is awaited through handle close and cleanup. Shutdown does not race it and falsely claim ownership ended.
- POSIX group signals and Windows taskkill cannot make a truthful guarantee about a kernel-uninterruptible process. The deadline bounds when termination starts. If the OS never reports direct-child close after force termination, admission drain continues waiting rather than fabricating a reap or releasing a still-owned child.
- The real Darwin subprocess tree is qualified. Native Windows was unavailable; Windows tree termination remains covered by shared taskkill tests and injected terminate/force mocks only. No native-Windows claim is made.

## Preserved accepted behavior

- Normal clean Git authority, OAuth observation, logical argv, raw evidence, report hashing, metadata/sidecar ordering, and no-sidecar-on-failure remain green in registry and SDK tests.
- Existing retention/`bg_result`, terminal publication retries/abandonment, reentrant publication, late session start, notification, EventBus response ordering, ordinary/delegate/managed lifecycle, and real Pi reload/runtime replacement tests remain green.
- No persistence/handoff redesign was introduced. Default kill-on-reload is unchanged.

## Route, host, and boundaries

- Effective provider/model/reasoning: `openai-codex` / `gpt-5.6-sol` / `max`.
- Host: Darwin 24.6.0 arm64; Node `v24.16.0`; npm `11.13.0`.
- No user session/auth/provider inference, external network, paid API, Fusion maintenance route, delegated agent, GitHub operation, push, publish, release, extra checkout/worktree/copy, or native-Windows run was used.
- Final tracked worktree is clean; only the pre-existing untracked read-only `node_modules` symlink remains.

This is implementation evidence, not independent signoff. The branch is intentionally stopped here for the requested narrow independent admission/preflight ownership verification before integration.
