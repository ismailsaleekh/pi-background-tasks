# P1a lazy delegate/Fusion design

Date: 2026-09-20
Worktree: `/private/tmp/pi-bg-closeout-iNoltL/lazy-agents`
Branch/base: `closeout/lazy-agents` at `fcf2af0950c8047ebf90b802e8049781fd3136fb` (`tree 0ee3654012711f4a213dc79ca93f56fe30724ab7`)
Effective worker route: `openai-codex/gpt-5.6-sol`, reasoning `max`

## Decision and stopping boundary

Implement only the delegate/Fusion P1a slice of issue #21 / PR #22. Preserve immediate enabled registrations, schemas, descriptions, renderers, workflow metadata, argument preparation, and launch/result receipt formats. Preserve C1a's conditional registration: these facades are constructed only when their feature is enabled. Do not edit `src/extension.ts`, registry/common/config/provider/attribution/attested/durable/launcher/UI code, package/lock/shared QA plans, or D1.

This slice deliberately does **not** claim complete process-only startup isolation: `src/extension.ts` still statically imports both facade source files, and process dock, attested, attribution, UI, raw TypeScript/Jiti, precompiled distribution, Windows, and compiled-Bun work remain outside P1a/P1b integration. The benchmark will state that limitation.

## LazyModule state machine

Add package-internal `src/core/lazy-module.ts` with terminal activation semantics:

- `unloaded`: no importer invocation.
- `loading`: one stored promise. The promise is assigned from a deferred microtask before the importer is invoked, preventing re-entrant or simultaneous calls from starting another import.
- `loaded`: the module value is activation-local and reused; every `run()` callback is invoked independently, so module single-flight never becomes run single-flight.
- `failed`: one bounded `lazy_module_load_failed` error containing the module id and a bounded/single-line cause. The exact wrapped error is sticky for all later callers in that activation.
- `closed`: `close()` changes state synchronously, advances the generation, drops loaded values, and installs one sticky closure error. Calls check the captured generation before import, after import, and immediately before invoking their side-effect callback. A late imported value is discarded.

The constructor accepts an importer for deterministic tests and facade dependency seams. There is no process-global cache and no reopen operation. A real reload constructs a new extension/facade instance and therefore a fresh loader/import attempt.

## Delegate boundary

`registerDelegateExtension` owns one activation-local loader for the producer runtime. Static facade imports retain only registration/schema/rendering contracts and light delegate types. The loader imports delegate launch + runner implementation on first valid `bg_delegate` execution. Existing immediate argument preparation remains unchanged. The execution path checks activation before the artifact-producing preparation call and again before calling the registry starter.

`registerBackgroundResultExtension` owns two independent activation-local loaders:

- delegate terminal verifier (`core/delegate/runner`), selected only after task facts identify a delegate;
- Fusion committed/failure verifier (`core/fusion/result-package`), selected only after task facts identify Fusion.

Running/unknown/ordinary task handling remains immediate and does not import either verifier. Fusion usage cloning stays byte/shape equivalent, and usage is claimed only after verification plus an activation check. Hashing remains `sha256:<hex>` without importing the attested producer solely for that helper.

Each registrar installs its own synchronous `session_shutdown` closure handler. It does not reset/reopen on a later event in the same stale instance.

## Fusion boundary

`registerFusionExtension` owns two loaders:

1. execution runtime: context projection, clean context, model config/resolution, and `FusionOrchestrator` construction;
2. model-selector runtime: config load/save/path and the selector component.

Four schemas, fixed workflow profiles, public registrations, renderer metadata, and synchronous argument preparation remain eager. `/fusion` editor cancellation and headless `/fusion-models` refusal do not load execution or selector implementations. Simultaneous cold workflow calls share only the execution-module import/constructor; each creates its own controller, active-run record, readiness gate, managed task, and `orchestrator.run()` call.

The existing Fusion shutdown handler synchronously marks shutdown, advances generation, closes both lazy loaders, and aborts active runs before its first await. Checks remain before/after awaited config and immediately before orchestrator/UI/registry side effects. No old `pi` or `ctx` is placed in a global cache.

A tiny pure public-URL canonicalizer may be extracted from `source-policy.ts` only if static graph evidence shows that its shared import drags the heavy artifact implementation into the facade. Any extraction must retain exact errors/bytes and gain direct equivalence tests; no policy change is allowed.

## Red-first proving scenarios

1. `tests/unit/lazy-module.test.ts`: simultaneous first calls import once and run twice; sticky bounded failure; close during a blocked import discards the module and invokes zero callbacks; post-close rejection; a fresh loader retries successfully.
2. `tests/sdk/lazy-loading-sdk.test.ts`: real SDK extension runner with controlled facade importers. Immediate registration, cold-call single-flight for delegate and Fusion, stable failure with zero starters, blocked-import shutdown with zero starter/artifact callback, stale old tool rejection, fresh real reload retry, selector-only loading, and editor-cancel non-loading.
3. Result subtype routing: task facts load only the matching delegate or Fusion verifier; running facts load neither.
4. `tests/package/lazy-import-graph.test.ts`: compiler-based runtime-import graph excludes the named heavy roots from facade startup, distinguishes static from literal dynamic imports, records the process-only facade-source limitation, and verifies every deferred literal target exists under the packed `src/` closure.
5. Existing real SDK delegate/Fusion producer-and-result tests plus Fusion golden/equivalence tests prove successful children, task/artifact formats, retrieval, and bytes remain unchanged.
6. Injected missing-module errors prove startup/inventory still works and invocation fails loudly; payload closure ensures shipped literal targets cannot actually be absent.

Tests will use only `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/lazy-agents`, offline environment variables, deterministic fake children/importers, and no user state/network/provider/install.

## Benchmark protocol

Before production/test edits, save 30 fresh-process baseline samples with one excluded warm-up. After implementation, run the exact same benchmark/worker bytes and host dependency tree for 30 candidate samples. Each worker gets a unique pre-created project/agent/session root and offline environment. Record:

- source commit/tree, dirty status, source TypeScript (not compiled), Node/Pi/npm, OS/arch, feature set, entrypoint and scenario;
- real `DefaultResourceLoader` facade/package load;
- first delegate launch + delegate result using a fake child;
- first Fusion launch + Fusion result using deterministic fake children;
- first `/fusion-models` command through a real SDK runner with mocked UI;
- raw samples and median/p90/MAD/min/max.

“Cold” means fresh OS process and empty JS/Jiti module cache, not flushed filesystem cache. Baseline then candidate is sequential because the two-worktree ceiling and no-copy rule prevent honest simultaneous A/B roots. No timing threshold enters CI. Results make no native-Windows or compiled-Bun claim and do not establish filesystem-cold or precompiled-distribution performance.

## Source/document ownership

Planned production paths: `src/core/lazy-module.ts`, `src/delegate-extension.ts`, `src/fusion-extension.ts`, and only a decisively necessary tiny delegate/Fusion pure helper. Planned tests: new focused unit/SDK/package files and narrow existing assertions only. Planned authored docs: delegation, Fusion, and testing operations. Generated docs are changed only via `npm run docs:generate`; no semantic attestation is self-recorded.

Contributor adaptation credit in the coherent implementation commit:

- `PR #22 head 055306d01f6575ce5d3cbbc6588f2bdf6e2c252a`
- `Co-authored-by: bufan <821869798@qq.com>`
