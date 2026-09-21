# R1 delivery report — terminal publication lifecycle

## Result

Implemented #24 / adapted PR #25 on `closeout/delivery`.

- Commit: `a54bb8eeae39c02382fc0f5f3838180589701bc7` — `fix(core): bound terminal publication lifecycle`
- Base: `14afc33e3967a142758169d3217a4e63b4b3ec94` (production baseline `14aa4ef382952f073bd4d540f57d6e8e3c2789a2`)
- Contributor credit retained in the commit for PR #25 / head `24c85e1b03a5bd7e72d1fae1952f07248c592167`:
  `Co-authored-by: Erik Darling <2136037+erikdarlingdata@users.noreply.github.com>`
- Design/red plan: `/private/tmp/pi-bg-closeout-iNoltL/reports/delivery-design.md`

Committed paths:

- `src/core/common.ts`
- `src/core/registry.ts`
- `src/core/extension-api.ts`
- `src/extension.ts` (lifecycle only)
- `tests/unit/registry.test.ts`
- `tests/unit/extension-api.test.ts`
- `tests/sdk/sdk.test.ts`
- `tests/sdk/fusion-sdk.test.ts`
- `docs/subsystems/background-task-runtime.md`
- `docs/api/eventbus-v1.md`
- `docs/subsystems/host-ui-and-telemetry.md`
- `docs/concepts/completion-delivery.md`

No generated docs, manifests, package files, shared plans/state, shell policy, parent checkout, or other production modules were edited.

## Behavior and API decisions

- Terminal EventBus publication now has explicit internal `pending | delivered | abandoned` state plus a typed abandonment reason and emit-attempt count.
- `terminalPublished` remains a compatibility delivery latch and is set `true` only after the publisher returns successfully. Shutdown, closed service, rejected gate, and retry exhaustion leave it `false`.
- Durable terminal metadata, waiter release, notification receipt, and EventBus publication are independent. Abandoning EventBus delivery does not rewrite terminal status, strand waiters, or fabricate notification receipt.
- `BackgroundTaskExtensionService` exposes typed `open | closed` state. Publication after close throws `BackgroundTaskExtensionServiceClosedError` with code `pi_background_tasks_eventbus_closed`. The registry handles that type directly; there is no error-message substring matching.
- Service close and registry shutdown are one-way publication closure. They clear retry handles and gate references and resolve a closure signal that races gate waits, allowing old async continuations to finish without waiting indefinitely for an external gate.
- Gate resolution and rejection both re-check lifecycle. A gate that settles after closure cannot emit or schedule a retry. Rejected gates are non-recoverable and become `gate_rejected` abandonment.
- Genuine synchronous emitter/listener failure retries at 100 ms for at most **3 total emit attempts**. Each failed attempt emits at most one diagnostic, with error text capped at 500 characters. Exhaustion becomes `retry_exhausted` abandonment.
- Delivery remains at-least-once under emitter failure: an earlier listener may receive before a later listener throws, so consumers must deduplicate by `task.id`.
- Finished tasks with pending publication are not pruned until delivery or abandonment, keeping their timer reachable for disposal.
- A synchronous shutdown barrier is registered before managed Fusion shutdown cleanup. It closes the old registry/service and status/retry timers before managed settlement can publish. The later handler performs ordinary kill-on-reload cleanup. A disposed extension instance cannot be revived by a late `session_start`; replacement uses a fresh instance.
- Existing kill-on-reload behavior remains. No process persistence, handoff, or #6 architecture was added.
- EventBus v1 wire frames/capabilities are unchanged.

## Red evidence on unchanged production

All mechanical commands used:

`TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery HOME=/private/tmp/pi-bg-closeout-iNoltL/home/delivery PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/delivery PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1`

1. Registry shutdown/retry/gate regressions:
   - Command: `tsx --test --test-name-pattern='abandons a pending retry|bounds persistent terminal|late gate' tests/unit/registry.test.ts`
   - Exit: **1**; **0 pass / 4 fail**.
   - Failures proved absent abandonment state, a fourth persistent retry, late-gate publication after shutdown, and rejected managed-gate re-arming.
   - Log: `reports/red-registry.log`
2. EventBus listener/close regressions:
   - Command: `tsx --test --test-name-pattern='bounds genuine listener|typed closed-service' tests/unit/extension-api.test.ts`
   - Exit: **1**; **0 pass / 2 fail**.
   - Failures proved a fourth listener delivery and a retained retry timer after service close.
   - Log: `reports/red-eventbus.log`
3. Real SDK activation lifecycle:
   - Command: `tsx --test --test-concurrency=1 --test-name-pattern='disposes old publication lifecycles' tests/sdk/sdk.test.ts`
   - Exit: **1**; **0 pass / 1 fail**.
   - Baseline published a shutdown-killed task onto the old activation EventBus.
   - Log: `reports/red-sdk-lifecycle.log`

These reproduce the lifecycle defect rather than merely replaying PR #25's two message-based tests.

## Green verification

Using the same isolated environment:

- `tsx --test tests/unit/registry.test.ts tests/unit/extension-api.test.ts`
  - Exit **0**; **40/40 pass**.
  - Covers inherited immediate/normal/error/timeout/kill ordering, transient retry, typed close, shutdown abandonment, persistent failure cap, duplicate at-least-once receipt, and ordinary/managed late gates.
  - Log: `reports/green-registry-eventbus-final.log`
- `tsx --test --test-concurrency=1 --test-name-pattern='cancels live fusion children on session shutdown' tests/sdk/fusion-sdk.test.ts`
  - Exit **0**; **1/1 pass**; proves real managed Fusion shutdown cancellation emits no old-activation terminal frame.
  - Log: `reports/green-sdk-managed-lifecycle-1.log`
- `npm run test:sdk`
  - Exit **0**; **43/43 pass** across delegate, Fusion, and ordinary SDK suites, including repeated reload activation replacement.
  - Log: `reports/green-sdk.log`
- `npm run typecheck`
  - Exit **0**.
  - Log: `reports/typecheck-final.log`
- `npm run test:unit` on the committed tree
  - Exit **1**; **453/454 pass**. The sole failure is the expected integrator-owned generated-doc freshness check: `docs/commands/bg.md is stale; run npm run docs:generate`, caused by `src/extension.ts` provenance line shifts. All registry/EventBus tests pass.
  - Log: `reports/green-unit-final.log`
- `npm run test:type-safety`
  - Exit **1**; **1/2 pass**. The failure is the frozen inherited baseline: false-positive comment match at `src/core/anthropic-attribution.ts:83` and existing double assertion at line 1493. Neither path is owned by R1.
  - Log: `reports/type-safety-inherited.log`
- `npm run docs:verify`
  - Exit **1** at the same generated `docs/commands/bg.md` staleness. Per mission boundary, no docs generation or semantic self-attestation was performed; the integrator must reconcile generated docs.
  - Log: `reports/docs-verify-integrator-generated.log`
- `git diff HEAD^..HEAD --check`: exit **0**.
- Frozen evidence checksum verification: all entries in `evidence/SHA256SUMS` passed.

## Lifecycle/race evidence

- Ordinary task + pending retry: shutdown leaves durable `completed` metadata and notification truth intact, changes publication to `abandoned/registry_shutdown`, clears the handle, and makes no later attempt.
- Typed closed publisher: one attempt only, `publisher_closed`, no message parsing.
- Persistent genuine listener throw: exactly three attempts/diagnostics. A listener registered before the throwing listener receives three duplicate frames, proving/documenting at-least-once semantics.
- Ordinary late resolving gate: task reaches durable terminal state; closure clears the gate reference; later resolution emits nothing and does not notify during shutdown.
- Managed late rejecting gate: durable managed terminal state survives; closure wins, clears in-flight/gate/timer state, and rejection cannot re-arm.
- Real repeated SDK reload: each fresh activation alone answers requests and publishes normal completion; shutdown tasks produce no old-activation terminal; disposed services stay unsubscribed.
- Real managed Fusion SDK shutdown: cancellation/result artifacts remain retrievable while old-activation terminal publication is absent.
- Existing EventBus matrix still proves response-before-terminal for immediate, normal, failed, timeout, and killed tasks outside shutdown.

## Limitations / reviewer attack points

- Publication state is intentionally process-local/internal and is not added to the v1 terminal frame or metadata snapshot. Durable task status remains the public truth; process persistence belongs to #6 and is out of scope.
- The retry policy is fixed at three total attempts and 100 ms; it is deliberately small and not configurable in this unit.
- The installed Pi `createEventBus()` normally catches extension handler failures. The true synchronous `emit`-throw path is exercised with an injected deterministic EventBus where an earlier listener receives and a later one throws.
- Native Windows was not available. Existing mocked Windows registry paths and the full SDK suite passed on Darwin arm64, but this change does not claim native Windows qualification.
- Generated docs remain intentionally stale until the integrator runs the shared docs engine; no generated region was hand-edited.
- Full release/package/RPC/component/PTY gates were not run in this worker lane. Scope qualification is registry/EventBus/SDK lifecycle plus typecheck.
- Requests racing an already closed service follow the documented close contract (listener removed/no new response); an in-flight request may still complete its response emission.

## Cleanup and process accounting

- Peak task-owned mechanical scratch was about 10 MiB, below the 400 MiB lane cap.
- Removed exact disposable paths:
  - `/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery`
  - `/private/tmp/pi-bg-closeout-iNoltL/home/delivery`
  - `/private/tmp/pi-bg-closeout-iNoltL/agent/delivery`
- Retained only small logs/reports under `/private/tmp/pi-bg-closeout-iNoltL/reports`.
- Owned test/child subprocesses, watchers, servers, and auxiliary workers remaining: **0**.
- No worktrees/copies were created. Shared untracked `node_modules` remains the original read-only symlink to `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules`; it was not installed into, staged, removed, or modified.
- Final tracked worktree state is clean; only that pre-existing shared `node_modules` symlink is untracked.

## Effective worker route

Observed before substantive work and again at closeout:

- `PI_PROVIDER=openai-codex`
- `PI_MODEL=gpt-5.6-sol`
- `PI_REASONING_LEVEL=max`

Host used for local evidence: Darwin arm64, Node `v24.16.0`, npm `11.13.0`. No paid API, live model test, network browsing, Fusion maintenance tool, other agent, push, tag, publish, or GitHub action was used.
