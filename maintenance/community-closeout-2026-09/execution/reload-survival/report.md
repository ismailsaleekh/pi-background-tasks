# D1 / issue #6 implementation report

## Outcome

**Package behavior: `VERIFIED_LOCAL` on POSIX for supported normal same-process Pi reload modes.**

**D1 closure state: `BLOCKED_ENVIRONMENT`.** The Windows owner implementation, structured taskkill path, injected handoff tests, and six native test cases are present, but this host is Darwin arm64. `npm run test:windows` deliberately exited 1 off Windows; no skip or mock is counted as native qualification.

Two host lifecycle boundaries remain **`BLOCKED_UPSTREAM`**:

1. Pi 0.84.0 and installed 0.86.0 rebuild the extension runner on `AgentSession.reload()` after `bindExtensions({})` or mode-only binding, but omit the new runner's `session_start` because `hasBindings` is inferred only from counted callback/UI fields. A package owner cannot truthfully claim without that callback. Normal TUI/RPC/print/JSON modes and SDK hosts with a counted binding/rebind work.
2. Direct `AgentSession.dispose()` invalidates the runner without awaited `session_shutdown`. `AgentSessionRuntime.dispose()` emits `reason:"quit"` and is supported. The permanent test demonstrates the direct-dispose child remains alive until explicit failure-only cleanup; its old registry then truthfully exhausts the bounded publication path rather than pretending shutdown occurred.

Hard crash, SIGKILL, power loss, process restart, VM/realm replacement, cross-process resume, PID/file adoption, and external-supervisor behavior are **unsupported**, not tested or claimed as survival.

## Identity and commits

- Worktree: `/private/tmp/pi-bg-closeout-iNoltL/reload-survival`
- Branch: `closeout/reload-survival`
- Base: `fcf2af0950c8047ebf90b802e8049781fd3136fb`
- Base tree: `0ee3654012711f4a213dc79ca93f56fe30724ab7`
- Final HEAD: `8b4accccc5c54931619dc408d53b72d9ef9ec4ef`
- Final tree: `bd4d6118b0cc72023ad8306205d2a88e31d58bb6`

Commits:

1. `2114d33fbaf84075b1853af9a934e920b2b62f88` — `feat(core): retain opted shell execution ownership across reload`
   - tree `ee6f28a6fce03fd0cc3c832bdccbb610fde2fbba`
   - owner protocol plus real registry consumer, common types/audit fields, pre-side-effect/refusal controls, owner/registry/EventBus/component/Windows tests.
2. `8b4accccc5c54931619dc408d53b72d9ef9ec4ef` — `feat(extension): hand off opted shell tasks on real reload`
   - tree `bd4d6118b0cc72023ad8306205d2a88e31d58bb6`
   - real lifecycle/public tool/command/dock behavior, SDK lifecycle matrix, authored/generated docs, and small core settlement follow-ups.

No amend, merge, push, publish, tag, GitHub operation, parent/main edit, package/lock edit, repository/shared dependency install, paid API, live provider request, Fusion maintenance, D2 Bash override/threshold/adoption, P1 lazy work, external daemon, or PID scanner was used. The existing package gate performed only its isolated offline disposable consumer install. `main` remained at the requested base. The other auxiliary worktree stayed independent.

## Changed paths

Production/runtime:

- `src/core/common.ts`
- `src/core/registry.ts`
- `src/core/reload-shell-owner.ts` (new owner)
- `src/extension.ts`

No delegate or Fusion production source was edited. EventBus request implementation stayed unchanged; only its tests/docs and additive task snapshot type changed.

Tests:

- `tests/unit/core.test.ts`
- `tests/unit/extension-api.test.ts`
- `tests/unit/registry.test.ts`
- `tests/unit/reload-shell-owner.test.ts`
- `tests/component/background-tasks-manager.test.ts`
- `tests/sdk/lifecycle-sdk.test.ts`
- `tests/sdk/reload-survival-sdk.test.ts`
- `tests/windows/windows-integration.test.ts`

Authored docs/QA:

- `README.md`, `TESTING.md`, `TEST_PLAN.md`
- `docs/api/eventbus-v1.md`
- `docs/commands/bg.md`
- `docs/concepts/completion-delivery.md`
- `docs/operations/configuration.md`
- `docs/operations/troubleshooting.md`
- `docs/reference/shortcuts-and-dock.md`
- `docs/subsystems/background-task-runtime.md`
- `docs/subsystems/host-ui-and-telemetry.md`
- `docs/tools/bg_run.md`

Generated only through `npm run docs:generate`:

- `docs/INDEX.md`, `docs/read-before-edit.md`, `docs/manifest.json`, `docs/reference/runtime-contracts.md`, `docs/subsystems/docs-freshness-gate.md`
- generated provenance/contracts in `docs/commands/{bg-clear,bg-update,jobs,kill,logs,task-manager}.md` and `docs/tools/{bg_kill,bg_logs,bg_run,bg_run_pi_attested,bg_status}.md`

## Implemented contract

- `bg_run.surviveReload?: boolean` and one bare leading `/bg --survive-reload`; default is false.
- True requires `isAgent:false`. Malformed/agent combinations fail before admission timers, directories, files, wrappers, insertion, or spawn.
- Managed/delegate/Fusion/attested survival-shaped input is loud unsupported. Delegate/Fusion retain their existing closed/unknown-key facades; no concurrent facade files were edited. Attested and internal registry paths have explicit guards.
- EventBus v1 request/response channels, exact capabilities, and closed run payload are unchanged. V1 rejects `surviveReload` and always starts default non-survivors. Tool/command survivors may emit additive snapshots on terminal v1.
- New snapshots/metadata always emit `surviveReload`; absent legacy data reads false through `snapshot()`. Opted records include `pi-background-tasks.reload-shell.v1` audit facts, which never authorize adoption.
- Dock rerun preserves the flag while creating a new id/nonce under current shell policy/cap.

The owner is structural at `Symbol.for('pi-background-tasks.reload-shell-owner.v1')`, keyed by a length-delimited `(process.pid, exact session id, canonical cwd)`. It uses a hub nonce, activation/claim nonces, monotonic generations, two-phase claim/import/audit/commit, a fixed referenced 30,000 ms handoff deadline, stale/conflict checks, and no `instanceof` protocol dependency.

Only admission-committed executions transfer. The owner retains the actual Node child, PID, pipes/listeners, output stream, metadata chain, immutable shell invocation/policy, absolute timeout, launch-time cap and cumulative bytes, passive telemetry buffer, real close observation, POSIX group or Windows taskkill state, R1 publication ledger, and notification token. Its hub stores no old Pi/UI/EventBus/registry/config/provider/lazy closure; the adapter is removed before old shutdown awaits.

Completion during the gap queues. A fresh registry maps the same task object and id, so status/logs/kill/tools/commands/dock continue without metadata lookup. Timeout/cap/policy are never reset. POSIX retains accepted one-TERM/one-KILL/bounded-ESRCH proof even after leader close. Windows retains structured `/T` then `/T /F`, helper abort/state, exit-128 handling, and no `child.kill` fallback.

R1 `pending|delivered|abandoned`, attempt count, typed closed error, reentrant settlement, retention semantics, and notification truth cross the handoff. Old physical gate/retry handles are cleared without false abandonment; the total EventBus budget remains three attempts. Successful notification is latched once and `notified` is never reset by reload.

## Red evidence

All red commands used Node 22.19.0 directly through `node_modules/tsx/dist/cli.mjs` and isolated offline TMP/HOME/agent roots.

1. Owner absent:
   - `node .../tsx/dist/cli.mjs --test --test-concurrency=1 tests/unit/reload-shell-owner.test.ts`
   - exit 1; module `src/core/reload-shell-owner.js` absent, 0 pass / 1 file failure.
   - `logs/red-owner.log`, SHA-256 `d486a4fe11e99b00f908ade05c6c9bdc15310cf4c5d3e5c30d4cc57029f6b4a4`.
2. Public command contract absent:
   - focused `core.test.ts` + `extension-api.test.ts`
   - exit 1; 16 pass / 1 fail. `/bg` parsing lacked `surviveReload`; EventBus closed-v1 control already passed.
   - `logs/red-public-eventbus.log`, SHA-256 `caac230dfb9a369f01e98c9bc552874e1bb6254653ce4d3d6f5681e7e41e35a5`.
3. Real SDK survival absent:
   - `reload-survival-sdk.test.ts` + `lifecycle-sdk.test.ts`
   - exit 1; new owner module missing and lifecycle `runSurvivor` observed no true opt-in, 0 pass / 2 file failures.
   - `logs/red-real-sdk.log`, SHA-256 `59f2d6f657b01ca15365c1d03ebaef801302893eb91ed0d4efde9d79cde5c6bb`.
4. Compatible default control remained green on base:
   - existing real `AgentSession.reload()` default-kill test, 1/1 pass.
   - `logs/red-baseline-default-kill-control.log`, SHA-256 `4d6873d667668ae3ea1d42ec513e6b8157c78fb636202aa61dcf5125eb3e758b`.
5. Component baseline remained green, 9/9; component behavior itself was not used as a fabricated defect red.

## Green evidence

Postcommit source-bound results:

| Gate | Result |
|---|---:|
| Node 22 focused owner/registry/EventBus/platform/component/real SDK | 100/100 PASS |
| Node 24 focused same set | 100/100 PASS |
| Full unit | 576/576 PASS |
| Full SDK (including C1a/C1b, R1, Fusion cancellation controls, D1) | 77/77 PASS |
| Full RPC | 10/10 PASS |
| Full package | 71/71 PASS |
| Full scripted-provider/agent loop | 35/35 PASS |
| Type safety | 4/4 PASS |
| Docs tests | 8/8 PASS |
| Typecheck | PASS |
| Docs verify | PASS: 32 surfaces / 54 sources |
| Payload | PASS: 110 packed files |
| C1a + shell combined focused set | 5/5 PASS |

Key logs/hashes:

- Node 22 focused: `logs/postcommit-focused.log`, `15b26066c0b5b815c5152638883a326223b458cf86fadfb2fe118f753be42507`
- Node 24 focused: `logs/postcommit-focused-node24-final.log`, `5a08b69cb2257771a78294fd5991383da01f565281a65565b98576d10367e576`
- Full unit: `logs/green-full-unit-final.log`, `82d6876cdf975398fac5d457b83910c6592a95abcab40e6374b11899af386d27`
- Full SDK: `logs/postcommit-full-sdk.log`, `1df36a9871aa2d80abdc32f07f49a460674780cf224f5d70057d2f5964a8b8a8`
- Package: `logs/postcommit-package.log`, `35aeb49c4a89d183b5c22cffbbe2a3cccb9c2f774b30a2def5a69179636d7b0f`
- RPC: `logs/green-rpc.log`, `e67c20bc7462962a5c46da1d7d626bbc0f3aa59e0e0e248310ef87308f922509`
- Agent loop: `logs/postcommit-agent-loop.log`, `a8094fe704edec730c5286181329ef84f2f0c07d4637069a515b81b2bd6637a0`
- Static/type safety: `logs/postcommit-static.log`, `6d634f54675701e787e1afcd0b842a073c7030bc8de5fc0cfc25234f1d762f68`
- Docs/payload: `logs/postcommit-docs-payload.log`, `1e39f368404dc1ba28925ea28609d7496f02a22922942c37930bb93b12021ef3`

`git diff --check` passed for both commits and the complete range.

## Real-process and lifecycle evidence

Permanent real POSIX tests use actual `AgentSession.reload()` and actual subprocesses; successful scenarios have no rescue path:

- same child object/task id/PID/nonce/completion id/path/policy/bytes across two reloads; `before` + `after`, exit 0, one terminal v1 frame, one successful notification, no respawn/kill;
- deterministic nonzero loader gap (held over 220 ms; assertion requires at least 150 ms), actual exit 7 during the gap, old delivery count zero, one fresh failed terminal with real code;
- post-reload `bg_status`, `bg_logs`, `bg_kill`, `/jobs`, `/logs`, `/kill`, `/bg` and dock rerun contract;
- leader exits on TERM while a ready descendant ignores TERM; task stays running through grace, one retained group force/proof removes the descendant, no success rescue;
- original one-second absolute timeout after a 650 ms pre-reload interval; no reset;
- real 700-byte + 700-byte output around reload against one 1,024-byte launch cap; only cumulative first 1,024 bytes plus loud cap notice persist;
- old `sh` task remains `sh`/1,024-byte policy while a post-reload task uses new `bash`/2,048-byte policy and a new id/nonce;
- actual runtime new, switch/resume, fork, clone, and `AgentSessionRuntime.dispose()` each kill opted tasks instead of transferring;
- a copied JSON record whose PID/audit child PID was replaced with a separate live fixture PID creates no task, status, signal, or synthesized completion. The unrelated fixture remains alive until explicit fixture cleanup.

The direct-dispose characterization intentionally uses failure-only cleanup after proving the host omitted shutdown. Its stale registry emits the expected bounded three-attempt diagnostics; this is blocker evidence, not a supported success case.

Independent real host probes (normalized non-secret output):

```json
{"hostVersion":"0.84.0","startedAt":"2026-09-20T12:12:02.293Z","reloadedAt":"2026-09-20T12:12:02.573Z","endedAt":"2026-09-20T12:12:02.993Z","taskId":"baf5e069b","pid":88178,"launchNonce":"fc3ecfadf9ecdeb0948486b8f22089e6","generation":2,"handoffCount":1,"status":"completed","output":["before-086","after-086"]}
{"hostVersion":"0.86.0","startedAt":"2026-09-20T12:12:03.882Z","reloadedAt":"2026-09-20T12:12:04.151Z","endedAt":"2026-09-20T12:12:04.570Z","taskId":"b0b8816f3","pid":88183,"launchNonce":"4f5d8a0a3b7536778977e93c17f1207a","generation":2,"handoffCount":1,"status":"completed","output":["before-086","after-086"]}
```

Both PIDs were subsequently confirmed gone. Logs:

- `logs/host084-real-reload.log`, SHA-256 `869dee9692c8f1da54481026989abb880091176035a04652edc4b9bd06f0e607`
- `logs/host086-real-reload.log`, SHA-256 `3a09d41ba1578d8c4716423edb91f2ee75259399c01793ddb730cb8019d5b476`

## Publication/notification/EventBus evidence

- Owner unit tests: structural global reuse, separate identities, two-phase claim, queued gap terminal, stale lease, fixed deadline across abort/retry, conflict/incompatible global, copied metadata ignored.
- Registry handoff test: old emitter throws once, old retry handle is cleared, fresh emitter succeeds on cumulative attempt 2, `terminalPublished=true` only after return.
- Existing R1 persistent/transient/reentrant/retention controls remain green in the 55-case registry suite; no message matching replaced typed closure.
- Repeated real reload: one logical terminal, one successful notification, unchanged `notified`, no second spawn.
- EventBus capabilities remain the exact eight v1 keys. A request-side `surviveReload` receives unknown-key error and creates zero children; tool/command survivor terminal remains valid terminal v1.
- `bg_result` remains ordinary-task-inapplicable and directs callers to ordinary logs.

## Windows blocker

Injected/mock implementation evidence passes:

- same execution/child object across a registry handoff;
- structured soft `/T`, aborted soft helper, exactly one force `/T /F`;
- no `child.kill` fallback;
- timeout/cumulative-cap generic owner invariants;
- existing Windows helper, exit-128, force-failure, and terminal barrier controls.

Native suite now contains six explicit D1 cases:

1. real cmd continuity over `AgentSession.reload()` with same PID/nonce/path and before/after output;
2. post-reload grandchild removal via `bg_kill`;
3. original timeout plus cumulative cap;
4. actual nonzero-gap completion;
5. repeated reload with one terminal/no residual process;
6. short no-claim deadline removing a real tree.

They were **not run natively**. On Darwin, `npm run test:windows` deliberately failed each `requireWindows()` assertion (exit 1), rather than skipping or passing. Evidence: `logs/windows-native-unavailable.log`, SHA-256 `2167fd202aa488c2eb06a38d64af00b017d1d50c746625c1fb1479f1654bce55`. Native pipe/handle continuity, taskkill behavior, and zero residual Windows processes therefore remain unqualified.

## Source hashes

```text
4133564bfef268db66e5123bb90030d02a1e5eaedb3ceee00acfbd1f5bd38963  src/core/common.ts
9eb1146ab77b009a3fccbe5f1e0c66c493f3c7181436c0a79fba82f860a58808  src/core/registry.ts
f1fec6b0f1e95c2f47b8e39e36755241022956e0081a303817130c3180154274  src/core/reload-shell-owner.ts
29672729236fe4decdd3010c9374976a31238fba984c2fd8292af87a1390cc30  src/core/extension-api.ts
5110442dfc53cfab0fe970c8a8b5134d33f086717d570cd44b4408b662356f5a  src/extension.ts
21fbc58b25474c6e7a8e045769e01d2376b83db256c271ddbe00fb2506ed2f16  tests/unit/reload-shell-owner.test.ts
28118eadf4f4db159ebe6fd9552204aaf3f412043523767c5bac90f91c966bac  tests/unit/registry.test.ts
f35ce0b353c520ee457bc10c6f0f4e01da90399570658aee84d3df6561e473e5  tests/unit/extension-api.test.ts
54619e141b731cbee6b507d108b820795de84b9a06b54b3bad3e6eec7f1c21b6  tests/sdk/reload-survival-sdk.test.ts
9dcfed07fae7204794dad3c2b0a077d8d9d79e062dc673a8e2730f73b589c2cc  tests/sdk/lifecycle-sdk.test.ts
719095a67fc2a18270452ad040a66f75d47337a05ccafe6a402598bccf425403  docs/manifest.json
```

## Route, environment, and cleanup

Effective injected route was verified before substantive work and at closeout:

- `PI_PROVIDER=openai-codex`
- `PI_MODEL=gpt-5.6-sol`
- `PI_REASONING_LEVEL=max`

Host: Darwin 24.6.0 arm64; Node 22.19.0 and 24.16.0 focused gates; package Pi 0.84.0 plus installed Pi 0.86.0 real reload probes. No native Windows executable/environment was available.

Task-owned scratch stayed far below 700 MiB (peak observed about 21 MiB plus sub-1-MiB retained reports). Exact roots removed after final gates:

- `/private/tmp/pi-bg-closeout-iNoltL/tmp/reload-survival`
- `/private/tmp/pi-bg-closeout-iNoltL/home/reload-survival`
- `/private/tmp/pi-bg-closeout-iNoltL/agent/reload-survival`

All are absent. D1 fixture PIDs/groups, test children, taskkill helpers, watchers, and timers remaining: **0**. The current Sol worker itself and the separately owned lazy-agents worker/benchmark are not D1 fixture children and were not touched. Worktree tracked state is clean; the sole status entry is the pre-existing read-only untracked `node_modules` symlink. Exactly the original two auxiliary package worktrees remain; none was created or removed by D1.

Stop state: implementation committed and locally verified; awaiting independent review. Do not describe D1 as cross-platform closure-ready until the six native Windows cases pass, and do not describe empty/mode-only SDK reload, direct `AgentSession.dispose()`, crash, or restart as supported.
