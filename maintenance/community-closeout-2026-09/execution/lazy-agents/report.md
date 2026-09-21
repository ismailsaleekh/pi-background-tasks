# P1a delegate/Fusion lazy-loading report

Status: **VERIFIED_LOCAL (P1a only)**

Worktree: `/private/tmp/pi-bg-closeout-iNoltL/lazy-agents`
Branch: `closeout/lazy-agents`
Base: `fcf2af0950c8047ebf90b802e8049781fd3136fb` (`tree 0ee3654012711f4a213dc79ca93f56fe30724ab7`)
Final: `0ad75ed23ca26912294ebeb0b33cf26a331f91e2` (`tree 5b04b3985c0f9aae54cf501e8294a557555a9caf`)
Effective route: `openai-codex/gpt-5.6-sol`, reasoning `max`

This stops at the requested P1a package slice. It does not implement D1, close issue #21, merge PR #22, publish, push, tag, or claim complete startup optimization.

## Commits

1. `05e34b8601e84ff068d86d9c1f98efa3047f9d76` (`tree 7e96875aa32fc81cf8ed8f5a5de57128d8f3df62`) — implementation, consumers, lifecycle/import-graph/SDK tests, benchmark, authored/generated docs. Commit message preserves:
   - `PR #22 head 055306d01f6575ce5d3cbbc6588f2bdf6e2c252a`
   - `Co-authored-by: bufan <821869798@qq.com>`
2. `f8d93ae879501f09b007a8ee3d1406441d50d8f8` (`tree 1912ee5174a07c1845e9b4d30a378a07042f4a6a`) — real packed-copy missing-module regression and testing documentation.
3. `0ad75ed23ca26912294ebeb0b33cf26a331f91e2` (`tree 5b04b3985c0f9aae54cf501e8294a557555a9caf`) — no-extension/process-only benchmark controls and focused-scenario support.

## Implemented paths and boundaries

Core/facades:

- `src/core/lazy-module.ts`
- `src/core/delegate/facade-contract.ts`
- `src/core/fusion/facade-contract.ts`
- `src/core/delegate/budget.ts` — only imports/re-exports the extracted light constants; budget behavior is unchanged.
- `src/core/fusion/config.ts` — only imports/re-exports the extracted `$current` sentinel; config behavior is unchanged.
- `src/delegate-extension.ts`
- `src/fusion-extension.ts`

Tests/measurement:

- `tests/unit/lazy-module.test.ts`
- `tests/sdk/lazy-loading-sdk.test.ts`
- `tests/package/lazy-import-graph.test.ts`
- `tests/package/lazy-packed-missing-module.test.ts`
- narrow updates to `tests/package/{package,delegate-mutation-guard}.test.ts` and `tests/sdk/fusion-sdk.test.ts`
- `scripts/benchmark-cold-load.mjs`
- `scripts/benchmark-cold-load-worker.mjs`

Docs:

- authored `README.md`, `docs/operations/testing.md`, `docs/subsystems/{delegation,fusion}.md`
- generated provenance/index/read-gate/manifest/tool/command docs only through `npm run docs:generate`; no semantic PASS receipt was self-recorded.

No `src/extension.ts`, common, registry, provider, attribution, attested producer, durable I/O, launcher, UI component, package/lock, shared `TESTING.md`/`TEST_PLAN.md`, maintenance state, or D1 source was edited. The two tiny engine-file edits above are the explicitly allowed pure-constant extraction needed to prevent facade imports from pulling heavy config/budget modules; package tests prove value identity.

## State machine and lifecycle

`LazyModule<T>` has exactly `unloaded | loading | loaded | failed | closed`:

- The loader sets `loading` and stores a promise whose importer runs in a later microtask, so simultaneous/re-entrant first callers see the same promise before import begins.
- Only module loading is shared. Every `run()` caller receives a separate operation callback and therefore a separate delegate/Fusion run.
- Import failures become one bounded, single-line `lazy_module_load_failed` error carrying the module id. The same error object is retained for that activation.
- `close()` is synchronous and terminal, advances activation generation, discards loaded state, and installs one sticky `lazy_module_closed` error.
- Calls check closure/generation before import, after import, and immediately before their operation callback. A late module is discarded without invoking producer/verifier/UI callbacks.
- There is no reopen operation or process-global module/`pi`/`ctx` cache. Real reload constructs fresh facades/loaders and can retry.

Facade lanes:

- Delegate producer loader: `core/delegate/{launch,runner}`; schema, descriptions, preparation, rendering, and receipts remain immediate.
- Result facade: independent delegate-runner and Fusion-result-package loaders. Task facts select one verifier; running tasks load neither. Fusion usage is still claimed only after committed-result verification.
- Fusion execution loader: context, clean context, model config/resolution, and one activation-local orchestrator. Concurrent workflows have independent controllers/readiness gates/tasks/runs.
- Fusion selector loader: config + selector only. Empty `/fusion` editor cancellation and non-TUI refusal stay cold.
- Every registrar owns a `session_shutdown` closure. Fusion closes/generation-advances/aborts synchronously in a non-awaiting handler before its existing cleanup handler waits. Post-shutdown retained tools reject rather than touching old registry/UI APIs.

Static import-graph tests prove delegate budget/seed/launch/runner/result and Fusion context/clean/config/orchestrator/result/selector roots are absent from their facade runtime-static graphs. Literal dynamic targets must exist under packaged `src/`.

## Red → green evidence

Initial tests were added before production changes:

| Command | Baseline red | Final green |
|---|---|---|
| `npx tsx --test tests/unit/lazy-module.test.ts` | test file failed: `ERR_MODULE_NOT_FOUND` for `src/core/lazy-module.js` | 4/4 |
| `npx tsx --test --test-concurrency=1 tests/sdk/lazy-loading-sdk.test.ts` | 0/6; eager runtime bypassed importer seams, missing-module stickiness/shutdown/subtype routing/selector loading failed | 7/7 |
| `npx tsx --test tests/package/lazy-import-graph.test.ts` | 1/4; three heavy-static/deferred-target checks failed | 5/5 |
| packed damaged-payload regression | added as follow-up against the real tarball | 1/1; startup/inventory succeeds, invocation loud/sticky, no `.pi/delegate` artifact |

Red logs:

- `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents/red-lazy-module.log` (`634e70e1…`)
- `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents/red-lazy-sdk.log` (`62fb4c69…`)
- `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents/red-lazy-import-graph.log` (`635d913a…`)

Integrated green evidence:

- Final Node 24 default gate `npm test`: typecheck; type safety 4/4; unit 567/567; real SDK 75/75 (including every C1a capability subset and real reload); RPC 10/10; component 11/11; package 76/76; hook contract 7/7. Log: `postcommit-default-gate.log` (`76e44689…`).
- Final package follow-up after packed-copy addition: 77/77, plus typecheck/docs/payload. Log: `postcommit-packed-followup.log` (`6c6d4157…`).
- Full scripted-provider lane: 35/35, including actual delegate and Fusion parent/child loops. Log: `green-agent-loop.log` (`6a211bc2…`).
- Node 22.19.0: typecheck, 9/9 focused unit/import-graph tests, and 33/33 delegate/Fusion/lazy SDK tests. Log: `green-node22-focused.log` (`b5adea54…`). Node 24.16.0 ran all other stated gates.
- `smoke`, `smoke:large-context`, `docs:verify` (32 surfaces / 56 production sources), `payload:check` (112 files), and `pack:dry-run` passed. RPC/component/package/hook outputs are in `green-relevant-gates.log`.
- Fusion golden-byte and independent extraction-equivalence tests are included in the 567-unit pass. Real delegate/Fusion SDK producer/result loops passed; no golden, artifact schema, route, budget, context, or result bytes were updated.
- Frozen closeout evidence hash verification: 49/49, `evidence-verify.log` (`1a868974…`).

No PTY, compatibility-install, pnpm, live subscription inference, network, native-Windows, or compiled-Bun gate was run; none is claimed. Default tests used isolated task roots and no user auth/config/session state.

## Benchmark evidence

### Genuinely pre-edit v1 baseline

Before any tracked edit, the byte-identical v1 driver/worker collected one excluded warm-up + 30 fresh processes per scenario at base `fcf2af0`. Candidate collection used implementation commit `05e34b8`. Driver/worker hashes: `b9a24dc…` / `30408637…`. Raw JSON hashes: baseline `29f227f0…`, candidate `dbe02063…`.

Representative median changes (ms): default-full package load `289.142 → 121.949` (-57.8%); delegate-profile load `280.559 → 114.863` (-59.1%); Fusion-profile load `283.739 → 113.855` (-59.9%). Deferred first-use costs increased as expected: delegate launch `82.495 → 145.785`, Fusion launch `85.319 → 196.285`, selector `0.256 → 19.845`. Full median/p90/MAD/min/max and every sample are in `baseline-benchmark-receipt.md`, `candidate-benchmark-receipt.md`, and the raw JSON.

### Final v2 controls

The final committed driver added no-extension and process-only profiles. Its baseline was honestly collected later by checking this same worktree out at frozen base, then returning to final `0ad75ed`; it is supplemental source-state evidence, not described as chronologically pre-edit. Driver/worker hashes are `2c6af054…` / `926752d0…` for both states.

Key v2 distributions (median / p90 / MAD, ms):

| Metric | base | final |
|---|---:|---:|
| no-extension package loader | 1.026 / 1.557 / 0.098 | 1.222 / 1.486 / 0.181 |
| process-only package load | 299.116 / 499.140 / 20.251 | 144.226 / 161.491 / 15.426 |
| default-full package load | 326.749 / 508.006 / 38.725 | 135.276 / 165.911 / 16.235 |
| delegate-profile package load | 306.244 / 491.689 / 26.673 | 123.656 / 153.876 / 13.538 |
| first delegate launch | 85.028 / 96.891 / 3.010 | 159.425 / 192.918 / 12.179 |
| Fusion-profile package load | 302.338 / 566.345 / 22.854 | 124.944 / 169.329 / 10.426 |
| first Fusion launch | 87.269 / 104.894 / 4.302 | 211.002 / 246.865 / 16.143 |
| first selector | 0.264 / 0.378 / 0.017 | 19.547 / 24.550 / 0.626 |

All 30 delegate and Fusion samples in both states committed verified results; every Fusion sample made five fake-child calls; every selector sample entered mocked UI once. Raw v2 JSON: baseline `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents/baseline-benchmark-v2.json` (`3449c927…`), final candidate `candidate-benchmark-v2.json` (`895b1119…`). Complete median/p90/MAD/min/max, controls, and risks: `benchmark-v2-receipt.md` (`2a4c31d8…`).

Cold means fresh process and empty in-process JS/Jiti module cache, **not** flushed filesystem cache. Baseline/candidate are sequential, not simultaneous AB/BA, because a third worktree/copy was forbidden. SDK-import controls and direct facade timings drifted materially (delegate direct import worsened in v2), so no deterministic millisecond or causal claim is made and there is no CI threshold.

## Exact remaining P1b seam / limitations

P1a still does not remove process-only package cost. Final process-only package load remained median 144.226 ms versus 1.222 ms for the no-extension loader. Specifically:

1. `src/extension.ts` still statically imports both light facade source files even when C1a does not instantiate their registrars.
2. The ordered ambient attribution entrypoint still statically imports its implementation before feature selection.
3. Process dock/UI, attested/registry/process runtime imports remain eager and were explicitly out of this lane.
4. npm still ships raw TypeScript loaded by Jiti; no precompiled/bundled distribution, alias/chunk/sourcemap, payload-loader, or compiled-Bun decision was attempted.
5. P1b must own the remaining extension-level import seam and integrated performance/distribution qualification. Native Windows and compiled Bun need their own evidence.

Therefore this report does **not** claim issue #21 closure, Windows acceleration, Bun-binary compatibility, filesystem-cold improvement, or full P1 completion.

## Hashes and cleanup

Selected final source SHA-256:

- `src/core/lazy-module.ts` — `7690944fad0026d788164659005f89feb578475e960d8ec925787f1d274dfa3b`
- `src/core/delegate/facade-contract.ts` — `b9a6a9a3cffdf570b342b1e8f0b8b4b62b0e6f22320ba448695fa5392bd7a095`
- `src/core/fusion/facade-contract.ts` — `fd6129b61337d4fd825719c1ddb0b3e753e353b0cfbd374280ab583357ef4b0d`
- `src/delegate-extension.ts` — `04af577e94456189e6b31a4aae44931532d54dacc9fce9c5cbfbb2534e8267a1`
- `src/fusion-extension.ts` — `efcfafa93fa76454c0b3a6a9363c2495531fdeadb94ce6e0f858a5034508bddc`
- packed-copy test — `4bf826da388dd6f915e649e03aa55e4e94cd8fa36ffcdb69caf6d4076fb2df01`

Design: `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents/design.md` (`0c26ef70…`).

Cleanup completed:

- final Git status clean;
- task-owned `node_modules` symlink removed without touching its target;
- worktree `.pi` artifacts removed;
- `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/lazy-agents` each 0 B;
- no test/fake/delegate/Fusion child remained (the active Sol worker itself is not a test child);
- reports retained at `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents` (~876 KiB at final cleanup);
- exactly the existing main + two authorized auxiliary package worktrees remained; no third worktree or package copy was retained.
