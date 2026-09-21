# C1a review-correction design

## Authority and boundary

- Worktree: `/private/tmp/pi-bg-closeout-iNoltL/features`, frozen starting HEAD `e3c0b065c52862e3889c9c5c24841a9d162fb338` (implementation `da2f6fccfc4014f3310c63d7c6ad530f4ab3374d`).
- Effective route checked before work: `openai-codex/gpt-5.6-sol`, reasoning `max`.
- Runtime authority is the supported Pi API and implementation, not the prior C1a report. The accepted `src/core/anthropic-attribution.ts` remains byte-identical at SHA-256 `eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa`.
- This correction owns only ambient attribution orchestration, registration/active-tool reconciliation, finite docs extraction, focused tests/fixtures, corresponding authored docs, and generated docs output. It does not reopen accepted profiles, shortcuts, shared-result behavior, child safety, F1 roles, P1 imports/performance, registry/common/attested/durable/Windows/launcher/engine behavior, shared test plans/state, package metadata, or locks.

## Supported Pi API facts

The 0.84.0 linked SDK, locally installed 0.86.0 SDK, and read-only cached declarations/implementations for every declared peer line (0.81.1, 0.82.1, 0.83.0, 0.84.0) expose the same relevant public contracts:

1. `pi.registerProvider(name, config)` is queued during extension factory loading and is immediate only after the runner binds. A queued call has no success result. `pi.unregisterProvider(name)` is name-wide; it removes both legacy and native extension registrations and has no owner token/CAS guard.
2. Event contexts expose the public `ctx.modelRegistry` compatibility facade. It provides `getProvider`, `getRegisteredProviderConfig`, `getRegisteredNativeProvider`, both `registerProvider(name, config)` and `registerProvider(provider)` overloads, and `unregisterProvider`.
3. `ModelRuntime.registerProvider(name, config)` validates first, deletes a native registration, then creates a new legacy-config object by merging defined fields over the previous config. `registerNativeProvider(provider)` deletes the legacy config and stores the supplied provider object. These public operations permit a synchronous install token (the post-install legacy-config object identity), source-kind snapshots, and restoration without a name-wide delete.
4. `pi.getAllTools()` exposes canonical `sourceInfo`; `setActiveTools` is name-based. During session/reload registry rebuild, Pi filters unknown active names and includes current extension tools. Therefore C1a does not need to delete disabled names itself. Removing the name-wide reconciliation preserves an unrelated same-name definition while Pi still drops a stale package name when no current definition exists.
5. Pi 0.81.1–0.84.0 dispatch event-handler arrays live; a `session_start` handler registered by the accepted attribution factory while the ambient `session_start` handler is running is observed in that dispatch. Pi 0.86.0 snapshots handlers at dispatch start. The provider ownership APIs themselves are unchanged in 0.86, but 0.86 remains outside the declared peer range; this change will not widen compatibility or claim first-start persisted cache-override initialization on 0.86.

Sources read in full/relevant implementation compared: both SDK READMEs; `docs/extensions.md`, `docs/custom-provider.md`, `docs/sdk.md`, `docs/models.md`; extension/SDK example READMEs and custom-provider/dynamic-tool/reload/tool-override examples; public declarations and implementations for extension loader/runner, `ModelRegistry`, `ModelRuntime`, and `AgentSession`. No private field or prototype is used by production code.

## Provider ownership transaction

Ambient attribution remains feature-gated, but installation moves from factory-time queueing to the already-bound `session_start` phase:

1. The ambient wrapper parses configuration at factory time. When attribution is enabled it registers one ambient activation handler and one cleanup handler; it does not queue a provider registration.
2. At `session_start`, snapshot through `ctx.modelRegistry`:
   - the effective Anthropic `Provider` object;
   - any legacy provider config object;
   - any native provider object.
   Missing effective provider is a loud unsupported-host error before package registration.
3. Invoke the accepted attribution factory with the real public Pi facade. Its existing synchronous EventBus claim probe preserves duplicate-copy behavior. If another compatible owner responds, it returns and the registry snapshot is unchanged. Otherwise its provider call is now immediate: a thrown registration failure happens before command/hooks/claim publication.
4. Confirm installation synchronously through public reads. Ownership exists only when a new legacy config object is current, its package stream differs from the prior stream, no native registration is current, and the effective provider changed. Record that exact legacy-config object as this instance's installation token. Merely calling/queueing registration is never ownership.
5. On shutdown, compare the public current legacy-config object by identity with the installation token. If it differs, a later legacy/native owner won and cleanup does nothing. If it matches, restore the captured source kind without `unregisterProvider`:
   - prior native registration: register that exact native provider;
   - prior legacy registration: first register the captured effective provider natively to remove only the current package legacy layer, then register the captured legacy config from an empty legacy layer;
   - no prior dynamic layer: register the captured effective provider natively.
   Verify the restored public registration/stream identities and throw loudly on mismatch.
6. A provider-application failure leaves the host registration untouched, publishes no package claim, and registers no package command/hooks because the accepted factory's provider call precedes those operations. Cleanup has no token and is inert.

The transaction uses no private SDK state, prototype patch, built-in-provider assumption, or name-wide deletion. Permanent real-SDK tests cover the reviewer's preexisting host, later owner, and injected public registration failure cases. A separate duplicate-copy/reload claim control remains green.

### Exact public-API limit and product choice

The public facade cannot simultaneously restore a prior legacy registration source **and** preserve the identity of Pi's transient composed `getProvider().streamSimple` adapter. Reapplying a legacy config necessarily recomposes a fresh effective adapter; registering the captured effective provider natively preserves that adapter identity but necessarily deletes the legacy config, breaking later incremental host-config merges. This is identical in 0.84.0 and installed 0.86.0 and is demonstrated by `provider-api-limit-probe.mjs`. There is no owner token, conditional remove, exact registration-state setter, or adapter-stack API. The product choice in this package is to preserve the host's public registration kind/config and its actual registered `streamSimple` function identity, because that also preserves future host merge behavior. The ephemeral composed wrapper identity is not claimed. Full preservation of both requires a new host ownership/snapshot API and remains an explicit host dependency, not a fabricated package guarantee.

## Active-tool policy

Delete C1a's `FEATURE_CONTROLLED_TOOL_NAMES` subtraction/re-addition handler. Registration absence remains authoritative. Pi's real registry rebuild already:

- drops an active name with no current definition;
- activates newly/currently registered extension tools under the existing default policy;
- preserves an active external definition whose name happens to equal `bg_delegate`, `fusion_brainstorm`, or another package capability.

Permanent tests load real external same-name definitions plus an unrelated control, assert canonical external `sourceInfo`, and prove all remain active in process-only mode. Existing full→process/off→delegate reload assertions continue to prove stale package cleanup and default parity.

## Finite docs grammar boundary

The extractor remains a finite structural recognizer, not a JavaScript interpreter.

Supported registration-owning scopes are:

- the default extension factory;
- an imported registrar reached exactly once with the validated Pi host;
- the one validated local tool-wrapper shape;
- a direct inline `session_start` activation callback registered as an immediate top-level statement (or under an already validated finite feature branch), needed for successful post-bind provider installation.

Within every registration-owning scope the gate will:

1. Inspect all parameter declarations and initializers, not only `fn.body`. Any default/destructured/derived alias of the Pi host is rejected. Registration-looking methods on an unvalidated host are rejected.
2. Reject any top-level return/control-flow escape that can bypass an extracted registration. The only early return admitted is the structurally validated synchronous duplicate-owner claim guard already used by the accepted attribution registrar: a local acknowledgement array, a direct Pi EventBus emit using a probe whose callback appends to that array, followed by the exact positive-length guard and bare return. Returns inside ordinary command/tool/event handlers remain outside registration-owning traversal and remain legal.
3. Treat the parser result binding as capability authority only when it is a top-level `const`, initialized by the imported `parseBackgroundTasksConfig()`, and that parser has the production immutable shape: frozen returned config and frozen exact feature record. Every use of the binding must be part of one recognized finite condition; aliases, writes, updates, mutator calls such as `Object.defineProperty`, argument passing, and other escapes fail closed.
4. Preserve the existing exact feature atoms, exact delegate-or-Fusion disjunction, and two dock literal guards. Unsupported nesting, loops, switches, alternate conditions, repeated registrars, hidden helpers, or host/config aliases remain errors.
5. Traverse imported registrars with inherited availability and apply the same parameter/control-flow checks there.

The positive parser fixture will use the real `src/core/config.ts` parser rather than `return {} as any`. Permanent decisive controls pair runtime observations with extractor rejection for: a default-parameter host alias that registers a hidden command, an early-return registrar that invents a command in docs, and mutation of the frozen config that prevents runtime registration. Runtime parser/profile tests remain separate from these structural grammar tests.

## Red/green plan

Red first on the frozen implementation:

- add real-SDK provider ownership tests for preexisting host restore, later-owner survival, and provider-application failure;
- add a real external `bg_delegate` + `fusion_brainstorm` + control fixture and collision test;
- add exact docs decisive controls for default-parameter alias, early return, config mutation, and mutable fake parser.

Then implement and run focused green commands, followed by 16 feature profiles, three shortcut modes / 48 docs availability profiles, current delegate/Fusion retrieval, forced child/path controls, real reload/claim lifecycle, docs selftest/negative controls/generate/verify, typecheck, type safety, and payload checks. Node 22.19 is the docs floor; Node 24 may be used for supplemental checks. No provider/model/network call is required.

## Exact owned files

Planned source/test edits:

- `extensions/anthropic-attribution.ts`
- `src/extension.ts` (registration reconciliation block only)
- `scripts/docs/lib.mjs`
- `scripts/docs/selftest.mjs`
- `tests/sdk/feature-selection-sdk.test.ts`
- `tests/fixtures/feature-tool-collisions.ts` (new narrow fixture)
- `tests/package/docs-contract.test.ts` only if a generated-contract assertion is needed
- narrow authored docs: `docs/subsystems/anthropic-attribution.md`, `docs/subsystems/host-ui-and-telemetry.md`, `docs/operations/configuration.md`, `docs/subsystems/docs-freshness-gate.md`

Generated files will be changed only by `npm run docs:generate` and enumerated in the final report. No edit is planned to `src/core/anthropic-attribution.ts`, `src/core/config.ts`, delegate/Fusion engines, registry/common, attested/launcher/durability/Windows files, package/lock, or shared test/state documents.
