# Targeted independent C1a ownership-correction review — Sol 5.6/max OAuth

## Verdict

**CHANGES REQUIRED; #20 is not closure-ready on the supported public SDK surface.** The two original runtime defects are substantially corrected: preexisting/later provider owners are preserved and unrelated same-name tools remain active. However:

1. a **HIGH** lifecycle gap leaves selected ambient attribution entirely uninitialized on Pi's documented bare `createAgentSession()` extension path and fails enabled → disabled → enabled reload after an empty or mode-only SDK binding; and
2. a **MEDIUM** cleanup defect changes a no-prior-registration state into a persistent native registration instead of restoring absence.

The reported composed-adapter identity limitation is real but is **not** a defect: public legacy source/config, registered stream, auth, routing, and future merge behavior are restored. Pi 0.86's handler-snapshot difference is a qualification boundary, not a supported-version claim.

Frozen state reviewed:

- HEAD `c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541`, tree `c21e75f14fe4ae6ef502ef6942dc95275c72293c`
- correction parent `e3c0b065c52862e3889c9c5c24841a9d162fb338`
- effective injected route environment: `openai-codex/gpt-5.6-sol`, reasoning `max`
- package SDK/TUI/AI `0.84.0`; installed comparison SDK `0.86.0`
- Node `v24.16.0`, npm `11.13.0`, macOS arm64

No live model or external-provider request, and no external network, was used.

## Findings

### HIGH — Post-bind-only attribution is not initialized by the documented bare SDK path and cannot re-enable after empty/mode-only SDK reload

**Package location:** `extensions/anthropic-attribution.ts:135-140` (all installation is inside `session_start`).  
**Host locations (Pi 0.84):** `dist/core/agent-session.js:1741-1763` and `2052-2074`.  
**Documented paths:** `docs/sdk.md:608-619`, `examples/sdk/06-extensions.ts:40-43`, and `examples/sdk/13-session-runtime.ts:40-44`.

There are two related public-SDK failures.

#### 1. Documented `createAgentSession()` extension use does not bind or emit `session_start`

Pi's SDK docs and `examples/sdk/06-extensions.ts` create a session with a populated `DefaultResourceLoader` and call `session.prompt()` without calling `bindExtensions()`. `createAgentSession()` constructs and core-binds the runner, but it does not emit `session_start`. The package now performs no ambient installation until that event.

Actual Pi 0.84 observation before any bind:

```json
{
  "claimAcks": 0,
  "cacheCommand": false,
  "sessionTreeHook": false,
  "registeredLegacyProvider": false,
  "registeredNativeProvider": false,
  "cacheStatus": null
}
```

Thus the default-selected `attribution` capability has no package provider transport, `/claude-cache`, lifecycle hooks, or duplicate-owner responder. An Anthropic request on that path would use the unmodified host provider rather than the selected package attribution/sanitization transport. This is more than missing inventory.

This is a **new package regression exposed by an existing host SDK initialization gap**. At the correction parent, `spawnAnthropicAttribution(pi)` ran in the extension factory (`e3c0b06:extensions/anthropic-attribution.ts:23`), so command/hooks/claim registered during load and the queued provider was flushed when `AgentSession` core-bound the runner. Moving all registration to `session_start` made the documented no-bind path lose that behavior.

#### 2. `reload()` suppresses the new `session_start` after empty or mode-only bindings

Pi 0.84 `AgentSession.reload()` emits the rebuilt runner's `session_start` only if at least one of UI context, command-context actions, shutdown handler, or error listener was previously supplied. `{}` and `{ mode: "print" }` do not satisfy that predicate.

Actual Pi 0.84 states from one `bindExtensions({})` session:

| State | Claim | `/claude-cache` | `session_tree` | Package legacy provider |
|---|---:|---:|---:|---:|
| initial bound | 1 | yes | yes | yes |
| disabled reload | 0 | no | no | no |
| re-enabled reload | 0 | no | no | no |
| explicit `bindExtensions({})` after reload | 1 | yes | yes | yes |

A mode-only binding behaves the same: initial activation succeeds, but re-enable remains `0/no/no/no`. A binding with `onError`, representative of normal host bindings, produces `1/0/1`, restores the command/hooks, and on 0.84 restores the persisted 5-minute cache override on both starts.

**Classification of the correction report's empty-binding limit:** the host behavior is genuine, public, and unchanged throughout cached 0.81.1–0.84.x packages. It is nevertheless an acceptance blocker, not a harmless package qualification. #20 requires exact SDK reload selection without accidental omission, and the selected attribution capability remains absent after re-enable. Calling this only a host limitation would quietly narrow the accepted SDK surface.

**Supported remedies/limits:**

- A host can supply any counted binding (for example `onError` or command-context actions), or explicitly re-bind after every reload. Normal Pi TUI, RPC, print, and JSON modes do so.
- There is no complete package-only remedy in the current public API that also retains the corrected ownership invariant. Factory-time provider registration is queued, has no success result, and cannot gate command/hooks/claim publication. A later `before_agent_start` fallback could repair first-request routing only; it would not provide correct initial command inventory or persisted cache initialization.
- A complete resolution needs a guaranteed post-core-bind/reload lifecycle callback or a successful owner-token provider-registration API, or an explicit approved exclusion of bare/empty-binding SDK hosts. This review does not approve that scope reduction.

Concrete repro:

```text
./node_modules/.bin/tsx ../reports/feature-runtime-review-2/probes/sdk-lifecycle-bindings.mts
```

Exit `0` (characterization probe); evidence `logs/sdk-lifecycle-bindings.log`, SHA-256 `6043b446ea9cde296b497f2ba47e6e0663f407e4c3d53201d5e6ee706ffdcb71`.

### MEDIUM — No-prior cleanup leaves an unexpected native Anthropic registration instead of restoring absence

**Location:** `extensions/anthropic-attribution.ts:108`.  
**Contradicted contract:** `docs/subsystems/anthropic-attribution.md:16,18` and `docs/operations/configuration.md:88` say disabled attribution has no parent provider registration and restoration returns the prior public host state.

When the initial public state has neither a legacy nor a native dynamic registration, cleanup executes:

```ts
registry.registerProvider(before.effective);
```

That stores the captured effective built-in object as a **native extension registration**. It restores current effective object identity, but not the prior state of dynamic-registration absence.

Actual Pi 0.84 and 0.86 result after enabled → disabled:

```json
{
  "legacyAbsent": true,
  "nativeAbsent": false,
  "residualNativeIsCapturedBuiltin": true,
  "registeredIdsContainAnthropic": true,
  "effectiveObjectRestored": true,
  "offlineRefreshCatalogSame": true
}
```

This review did **not** reproduce a current catalog or routing freeze: the exact built-in object remains effective and an offline refresh retained the same model IDs in both tested hosts. The finding is the concrete state/ownership leak, not a speculative catalog failure. Native registrations take precedence over the built-in map, so retaining one also needlessly fixes that source choice for later composition.

The public API can restore the exact original state. After synchronously proving that the current installation token is still the package's and no later native owner exists, public `unregisterProvider("anthropic")` yields:

```json
{
  "legacyAbsent": true,
  "nativeAbsent": true,
  "registeredIdsContainAnthropic": false,
  "exactBuiltinEffectiveRestored": true
}
```

That is an owner-conditional operation, not the old blind name-wide deletion. No private map, prototype patch, or assumed API spelling is required. The product requirement is prior-state absence.

Concrete repro:

```text
./node_modules/.bin/tsx ../reports/feature-runtime-review-2/probes/provider-public-state.mts
```

Exit `0`; evidence `logs/provider-public-state.log`, SHA-256 `71a6d2d7345e7bb16ecb21f0daa2382a4ed7db60224a1712209db4c950af8c95`.

## Requested resolution matrix

| Review target | Independent resolution |
|---|---|
| Preexisting legacy provider | **Resolved behaviorally.** Legacy source is present after disable; exact registered `streamSimple`, API key, headers, base URL/routing, and future incremental merge behavior are preserved. The composed effective adapter and config object are freshly composed. |
| Preexisting native provider | **Resolved.** Exact native and effective provider object identities are restored. |
| Later legacy/native owner | **Resolved.** Cleanup compares the exact current legacy token and is inert after replacement. Permanent and prior-review probes pass. |
| Failed provider application | **Resolved.** Immediate failure leaves the host registration current, publishes zero claims, registers no `/claude-cache`, and cleanup is inert. |
| Duplicate copies | **Resolved.** Exactly one command and one claim owner. |
| No prior dynamic provider | **Not resolved.** Finding 2 leaves a native registration instead of absence. |
| Private SDK/core changes | **Pass.** Production uses the public `ctx.modelRegistry` facade and public overloads only. Accepted `src/core/anthropic-attribution.ts` remains byte-identical. |
| Unrelated `bg_delegate` / `fusion_brainstorm` | **Resolved.** The name-wide active-tool subtraction is removed; external tools retain canonical source provenance and remain active. |
| Full → process → delegate inventory | **Resolved in normally bound Pi 0.84.** Exact definitions and active names rebuild; stale package names disappear. Attribution has the SDK lifecycle exception in Finding 1. |
| Shared `bg_result` | **Resolved.** Delegate-only and Fusion-only each register one result producer/retrieval path and both focused end-to-end retrieval cases pass. |

## Public API facts and limit classifications

### Provider ownership API

Pi 0.84 public declarations expose `ModelRegistry.getProvider`, `getRegisteredProviderConfig`, `getRegisteredNativeProvider`, both `registerProvider` overloads, `unregisterProvider`, and `getRegisteredProviderIds`.

Observed implementation semantics across cached 0.81.1, 0.82.1, 0.83.0, 0.84.0, 0.84.1, 0.84.2, and 0.84.4, plus installed 0.86.0:

- factory-time provider calls queue; after runner core binding they apply immediately;
- legacy registration validates first, removes native registration, and merges defined values into a fresh config object;
- native registration removes legacy registration and stores the supplied provider object;
- unregister removes both dynamic source kinds and restores built-in behavior;
- there is no owner token or compare-and-swap API.

The correction's source/current-token transaction is therefore sound for prior legacy/native and later-owner cases. Finding 2 is a branch choice, not a missing API.

### Claimed limit 1: composed adapter identity

**Classification: real, acceptable, non-blocking.** Reapplying public legacy config necessarily recomposes Pi's effective adapter. Neither public docs nor declarations promise `getProvider()` wrapper identity across registration changes.

The stronger behavioral probe proves on both 0.84 and 0.86:

- restored registered stream identity is exact;
- API-key auth and effective base URL are preserved;
- actual `ModelRuntime.streamSimple()` routing reaches the original host stream with the host header, API key, session id, model route, and (on the supported 0.84 context contract) original context identity;
- a later partial base-URL registration preserves the original stream/header/auth and routes through the updated URL;
- exact prior native object identity is restored.

It is correct not to require transient composed-wrapper identity. Registering that wrapper natively instead would lose legacy source state and future merge semantics.

### Claimed limit 2: empty-binding reload

**Classification: genuine host capability gap, but still a package acceptance blocker.** The correction report accurately identified `1/0/0` for `bindExtensions({})`; it understated the related documented no-bind initial path. See Finding 1. Normal Pi modes are not affected because their bindings are nonempty:

- print/JSON: `dist/modes/print-mode.js:53-78` supplies mode, command actions, and `onError`;
- RPC: `dist/modes/rpc/rpc-mode.js:230-270` supplies UI, command actions, shutdown, and `onError`;
- TUI: `dist/modes/interactive/interactive-mode.js:1364-1420` supplies the corresponding full binding.

The actual on-error-bound 0.84 probe confirms initial/reload commands, hooks, claim, provider, and persisted cache override—not inventory alone.

### Handler-dispatch/version qualification

Read-only cached-tarball inspection (no install or filesystem extraction) found live handler-array iteration in every declared line and cached supported patch listed above. The actual 0.84 first start restored a persisted `short` cache override and `/claude-cache status` reported `5-minute (session override)`, proving that the core factory's newly added `session_start` handler ran during the outer dispatch.

Installed 0.86 snapshots handlers at dispatch start. Actual 0.86 first start still installs the provider, command, hooks, and claim, but the newly registered cache-restoration handler does not run: status reports `1-hour (default)` despite a persisted short override. A second explicit bind changes it to `5-minute (session override)`. Therefore 0.86 provider-ownership observations are supplemental only; this review makes no unqualified 0.86 support claim. Cached 0.85 still iterates live, but it is also outside the declared peer range and is not newly claimed.

Evidence: `logs/cached-peer-surface.log`, exit `0`, SHA-256 `432b2215e2fb11b1deaa7fbeb311f3fa96e4094d5d700c1722df283fbfc5b10a`.

## Active-tool and capability results

The correction removed `FEATURE_CONTROLLED_TOOL_NAMES` reconciliation rather than trying to infer ownership from names. Independent results:

- the prior reviewer's external `bg_delegate` remains registered and active before and after process-only startup;
- the permanent fixture additionally covers external `fusion_brainstorm` and an unrelated control with canonical `sourceInfo`;
- all 16 optional capability subsets match exact command/tool/renderer inventory;
- default/full and real full → process/off → delegate/alternate active-tool transitions pass;
- delegate-only and Fusion-only each complete their real producer → single `bg_result` retrieval path;
- forced delegate/Fusion/attested child attribution/path controls pass 15/15.

No remaining name-only reconciliation finding was reproduced.

## Commands, exits, and evidence

Every executable verification used:

```text
env TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/feature-runtime-review-2 HOME=/private/tmp/pi-bg-closeout-iNoltL/home/feature-runtime-review-2 PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/feature-runtime-review-2 PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file
```

| Command after prefix | Exit/result | Evidence SHA-256 |
|---|---:|---|
| `tsx ../reports/feature-runtime-review-2/probes/provider-public-state.mts` | `0`; legacy/native/absence and real routing/auth/future-merge cases on 0.84 + 0.86 | `71a6d2d7345e7bb16ecb21f0daa2382a4ed7db60224a1712209db4c950af8c95` |
| `tsx ../reports/feature-runtime-review-2/probes/sdk-lifecycle-bindings.mts` | `0`; no-bind, empty, mode-only, normal binding, reload, cache state on 0.84 + 0.86 | `6043b446ea9cde296b497f2ba47e6e0663f407e4c3d53201d5e6ee706ffdcb71` |
| `node ../reports/feature-runtime-review-2/probes/cached-peer-surface.mjs` | `0`; read-only cached peer implementation/API characterization | `432b2215e2fb11b1deaa7fbeb311f3fa96e4094d5d700c1722df283fbfc5b10a` |
| `tsx --test --test-concurrency=1 tests/sdk/feature-selection-sdk.test.ts` | `0`, 15/15 | `fb416e2c1be0afc9f71339ac86d4868de67f4fef405f9a72d30a2c0053f7ac7d` |
| prior reviewer provider + active-collision probes | `0`, corrected outputs | `521346b0c42adf301a831cffcdf70445e17fc347de65db33b3a1bb163f64b162` |
| delegate-only producer/result focused SDK case | `0`, 1/1 | `ce1aaf4684c524d07af2edbb130fc140d4cac52a4e83ad97cd52cc2fe2722511` |
| Fusion-only producer/result focused SDK case | `0`, 1/1 | `1afc09247a64c80aa972ab959f6ab29d7b88ab3a92e99126242a02c63ca5cbaa` |
| forced attribution/delegate/Fusion/attested child controls | `0`, 15/15 | `07b529bd572fe2a439cbf132f782402279f403a7f45c56449d60911c7b4a2c33` |
| `tsx --test --test-concurrency=1 tests/sdk/anthropic-attribution-lifecycle.test.ts` | `0`, 1/1 | `9db28e2e8400585c0a6509713b3222b6066fc6e3d2cc34b8791f1b05e5e1f74f` |
| `npm run typecheck` | `0` | `77e9a108916124668eccc7c116d0f9f8fe378d8dce6ed77ba401fdf68c09277a` |
| `npm run test:type-safety` | `0`, 4/4 | `bd8daf979c77def7cfb253705946768283c9186829646b1eeabafb8c0eeb9e31` |
| `git diff --check e3c0b06..c4eb78c` | `0` | `edaa86834ac2e907fcb1bad713471595bb5395fc09fd5e9c3f63c2f7d5ca208e` |

Two first-draft probe launches failed before exercising package behavior: one report-directory bare package import could not resolve, and one read-only cache probe used the npm directory rather than its `_cacache` root. Both probes were corrected without source changes and the exact final commands above exited `0`.

The known broad unit assertion expecting bare `pi` was not rerun or weakened; it is outside this feature correction and already fixed on main as stated in the brief.

## Exact source/host hashes

```text
8d4c3e0e9241b65d365f0d4c8ad4b9559c4d33d75d603d9c8e24053e9cb81446  extensions/anthropic-attribution.ts
a62d5a6b91d2a500d5b8e94f26aadc814033c0758ce480226f3a170dfae51841  src/extension.ts
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
b29e3ac34b5ad27bbad566813c9306234c351ff712c87a8d3f50df8f738aed59  tests/sdk/feature-selection-sdk.test.ts

2557e5874a8d56b93c6cfe36207f1d52040ce6ac587b60491ed69a68047bed0d  Pi 0.84 dist/core/model-runtime.js
b39d59b8f86693b9aca15f13e14f367fce9a0ad8ed7ce9ad17950906f226951d  Pi 0.84 dist/core/extensions/runner.js
91e72d5497f665e731cbd79da6a6e826d8cae7d2ce156a7dee39f8ca205e32c8  Pi 0.84 dist/core/agent-session.js

bae3c3feb7928c7702c3d98a3454660bee1647064dd449472fc6308c354fbc25  Pi 0.86 dist/core/model-runtime.js
07a94efe560e6a460a415b2188c1c3c69ca151bd163c9b5f05347caf8403ace2  Pi 0.86 dist/core/extensions/runner.js
edaff7055ced7d49d25135c92415fbbfd9c14c4a29be5a79510ab9216045d6d9  Pi 0.86 dist/core/agent-session.js
```

Accepted attribution core hash is unchanged exactly as required.

## Qualification bounds and cleanup

- Actual dynamic probes used Pi 0.84.0 and installed 0.86.0. Other declared versions/patches were inspected from integrity-addressed read-only npm cache bytes in memory; they were not installed or dynamically executed.
- No native Windows, compiled Bun, live provider/model, network, terminal/PTTY, or broad release claim is made. TUI/RPC/print binding behavior is characterized from actual 0.84 mode source plus the equivalent real SDK binding probe; those modes were not end-to-end UI-driven here.
- Docs finite-grammar semantics belong to the separate reviewer and are not recertified here.
- No source, docs, tests, index, history, parent, main checkout, or dependency target was modified. No fix or attestation stamp was written.
- Final worktree status is the preexisting untracked `node_modules` symlink only.
- Owned TMPDIR, HOME, and agent roots are empty (`0` descendants each). Report artifacts are bounded well below 200 MiB. No review probe/test child, watcher, server, fake Pi, delegate, Fusion child, or package task remains; only the assigned Sol/max agent process chain exists until delivery.

Cleanup evidence: `logs/cleanup.log`, exit `0`, SHA-256 `08586be834053c2948404ed0ca7c59051985309ce85791718cc80b37f686fcf3`.
