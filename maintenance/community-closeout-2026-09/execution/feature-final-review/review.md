# Final independent C1a package-fix and blocker review

## Verdict

| Scope | Verdict |
|---|---|
| Final package-owned corrections in `180536edd11306b15f983b998c3618c2bf310a6d` | **PASS** — no remaining package-owned finding reproduced. |
| Issue #20 across the accepted public SDK surface | **`BLOCKED_SCOPE`** — **not closure-ready**. |
| Parent integration decision | The package-owned fix may be integrated while #20 remains explicitly tracked as an upstream Pi lifecycle/API blocker. This review does not approve excluding bare, empty-binding, or mode-only SDK hosts. |

The corrected package restores exact no-prior provider-registration absence, rejects all seven finite-grammar counterexamples for their own structural reasons, and documents the initialized-host boundary without claiming #20 closure. The current Pi 0.84 public API still cannot let this package initialize the documented bare SDK path, rebuild after empty/mode-only reload, and simultaneously preserve provider ownership, initial command inventory, and cache initialization.

## Package-owned findings

**Remaining package-owned findings: none.**

### 1. Provider absence and ownership — PASS

`extensions/anthropic-attribution.ts:89-146` retains the existing public snapshot/token transaction. Cleanup first proves that the current legacy config object is the exact package token and that no native replacement exists. Only then does the no-prior branch call public `unregisterProvider("anthropic")` (`:111`). Postconditions require legacy/native absence, registered-ID absence, and exact captured built-in effective identity.

Independent Pi 0.84 public-API coverage at:

`/private/tmp/pi-bg-closeout-iNoltL/reports/feature-final-review/probes/provider-ownership-public.mts`

proved all of the following without private maps or prototype access:

- no prior dynamic owner: legacy absent, native absent, registered ID absent, exact built-in effective object restored;
- prior legacy owner: stream, API key, header, base URL, actual `ModelRuntime.streamSimple()` routing, context identity, and subsequent partial-merge behavior preserved;
- prior native owner: exact native/effective object restored;
- later legacy and later native owners survive package shutdown;
- immediate package installation failure publishes neither claim nor `/claude-cache` and leaves the host provider current;
- duplicate extension paths produce one claim and one command.

The permanent 18-case SDK suite independently retains external same-name tool provenance/activity, all 16 optional-capability subsets, reload inventory, duplicate ownership, failure, and routing controls. The only production file changed from `c4eb78c` is `extensions/anthropic-attribution.ts`; accepted attribution core and orchestration sources are byte-identical.

There is no blind deletion: the public name-wide unregister operation is reached only after exact package-token and no-later-native checks. No Pi core, dependency, private field, or provider implementation was changed.

### 2. Seven finite-grammar gaps — PASS

The retained independent review probe now exits 0. It uses the byte-for-byte real `src/core/config.ts` parser in six cases and mutates only that parser in the dedicated hidden-return case.

| Counterexample | Independent final rejection reason |
|---|---|
| Registration-owner parameter initializer throws | `registration-owning parameter initializer contains unsupported throw or control flow` |
| Captured config mutation in `session_start` | `finite config binding config escapes its validated availability condition` |
| Fake duplicate-owner protocol | must emit exact `pi-anthropic-attribution:claim:v1` channel |
| Unknown computed registration host | computed `registerCommand` uses an unsupported host |
| Destructured default unknown host | destructured `registerCommand` binding is unsupported |
| Shadowed imported parser | call must resolve to the unshadowed imported `parseBackgroundTasksConfig` binding |
| Hidden parser early return | parser must have exactly one final direct immutable return |

The permanent selftest additionally rejects wrong claim schema, extra/wrong probe structure, and a local pre-probe listener, while accepting the exact production channel/schema/closed probe. Returns in ordinary handlers remain accepted. Original default-host-alias, owner-return, config-mutation, and owner-throw controls remain rejected.

No filename or exported-function-name waiver and no generic JavaScript interpreter was added. The implementation is a finite AST recognizer. Current production extraction remains 32 surfaces / 52 governed sources.

Independent profile and contract evidence:

- 48/48 feature × dock profiles;
- 32 union surfaces, 31 default surfaces;
- process-only counts 16/16/15 and full counts 31/31/30 for default/alternate/off;
- exactly one `bg_result` iff delegate or Fusion is selected;
- 32 exact surface owners and 52 exact source owners;
- 11 tool root schemas and 46 schema IDs;
- manifest contract is byte-equivalent to `c4eb78c` after removing advisory `attestation_state`;
- payload closure remains 108 files.

### 3. Initialized-host documentation — PASS

README, Getting started, Configuration, Anthropic attribution, `/claude-cache`, and EventBus v1 consistently say that generated/default availability is an **initialized-host** fact, not a pre-bind guarantee. They explicitly identify:

- normal TUI/RPC/print/JSON as counted host paths;
- bare `createAgentSession()` as uninitialized;
- empty/mode-only reload as uninitialized until an explicit rebind;
- #20 as `BLOCKED_SCOPE` / SDK compatibility;
- exclusion of those SDK hosts as unapproved;
- the required upstream lifecycle or owned-registration contract.

No closure-ready or broad bare-SDK claim was found. `docs:verify` confirms deterministic generated bytes. No attestation was written; nine behavioral receipts are non-passing/stale as generated.

## Separate #20 blocked-scope classification

### Actual Pi 0.84 lifecycle matrix

The independent asserted matrix used the installed package dependency `@earendil-works/pi-coding-agent@0.84.0`:

| Host path | Initial state | Enabled → disabled | Re-enabled by `reload()` | Explicit rebind |
|---|---|---|---|---|
| Bare documented `createAgentSession()` | no claim, command, hook, legacy/native provider | n/a | n/a | initializes when the host binds |
| `bindExtensions({})` | complete attribution state | exact dynamic absence | remains absent | complete state restored |
| `{ mode: "print" }` | complete attribution state | exact dynamic absence | remains absent | complete state restored |
| `abortHandler` only | complete attribution state | exact dynamic absence | remains absent | complete state restored |
| `onError` | complete attribution state | exact dynamic absence | complete state restored | not needed |
| `shutdownHandler` | complete attribution state | exact dynamic absence | complete state restored | not needed |
| `commandContextActions` | complete attribution state | exact dynamic absence | complete state restored | not needed |
| `uiContext` | complete attribution state | exact dynamic absence | complete state restored | not needed |

“Complete attribution state” here means one owner claim, `/claude-cache`, `session_tree` hook, and package legacy provider, with no native registration. The retained cache probe also proves Pi 0.84 restores the persisted five-minute override on counted and explicit-rebind paths.

A further public lifecycle observation is relevant to the exact upstream contract: direct `AgentSession.dispose()` invalidates the runner but does **not** emit `session_shutdown`. After a direct counted bind, the package provider remains registered in a reused `ModelRuntime` (`direct-session-dispose.log`). Standard modes use `AgentSessionRuntime.dispose()`, which does emit shutdown. Thus a direct SDK workaround is qualified for startup/reload only unless the host also uses the runtime lifecycle or otherwise drives proper shutdown. This reinforces the host-scope blocker; it is not a defect in the corrected owner-conditional cleanup branch.

### Public API/source evidence

Primary evidence is Pi 0.84; Pi 0.86 was inspected/run only as supplemental comparison.

1. Pi's SDK guide and examples document extension-bearing `createAgentSession()` followed directly by `prompt()` and eventually `session.dispose()` without `bindExtensions()` (`docs/sdk.md:504,618`; `examples/sdk/01-minimal.ts:10`; `examples/sdk/06-extensions.ts:40`).
2. `createAgentSession()` constructs/core-binds `AgentSession` but never calls `bindExtensions()` (`dist/core/sdk.js`).
3. A direct `bindExtensions()` always emits `session_start` (`dist/core/agent-session.js:1741-1763`).
4. `reload()` emits the rebuilt runner's `session_start` only when one of `uiContext`, `commandContextActions`, `shutdownHandler`, or `onError` is retained (`dist/core/agent-session.js:2052-2074`). `mode`, `abortHandler`, and `{}` do not count. `beforeSessionStart` is inside the same guard.
5. Factory-time `pi.registerProvider()` queues work until core bind. Its public return type is `void`; queued application errors are reported, but there is no successful result, owner token, or compare-and-swap lease (`extensions/types.d.ts:1006-1021,1154-1179`; `runner.js:188-247`).
6. The extension factory API exposes no `ModelRegistry`, post-core-bind callback, or host binding state. `ctx.modelRegistry` exists only once an event is emitted.
7. Public `AgentSessionRuntime.setRebindSession()` is a host-supplied callback for session replacement, not an extension API and not a same-session empty-binding reload callback.
8. `AgentSession.dispose()` does not emit shutdown; `AgentSessionRuntime.dispose()` does.

The static audit searched all Pi 0.84 public declarations plus SDK/extensions/custom-provider docs and all SDK examples. It found no alternate supported owner/lifecycle API. Pi 0.86 has the same missing lifecycle/ownership surfaces and is supplemental only.

### Why package-only fallbacks are not valid

- **Factory-time provider registration:** queued and result-less; the factory cannot snapshot prior legacy/native state or know application success. Publishing command/hooks/claim optimistically breaks failed-install atomicity and exact ownership restoration.
- **Factory-time command/claim plus lazy provider:** leaves an advertised command/owner after queued provider failure; Pi has no command/hook unregister transaction.
- **`before_agent_start` fallback:** too late for initial command inventory and persisted cache initialization, and provider/request ordering would be first-use rather than initialized-host truth.
- **`before_provider_request`:** occurs after route/payload selection and cannot replace the current provider transport safely.
- **`setActiveTools()`:** controls active tools only; it neither removes configured command/provider surfaces nor initializes cache state.
- **`reload({ beforeSessionStart })` or `setRebindSession()`:** caller-owned host facilities; the former is still suppressed by the empty-binding guard and neither is available to the package extension.
- **Timers, global symbols, private maps, prototype patches, or core monkeypatches:** unsupported cross-session/runtime guesses and expressly outside the accepted public-API/ownership boundary.

### Exact upstream contract required

One of these must be provided publicly, with equivalent guarantees:

1. **Paired lifecycle contract:** an awaited callback/event emitted exactly once for every extension runner **after core/provider binding**, before `createAgentSession()` returns or command inventory is consumed, and after every reload regardless of UI/mode bindings. It must supply the public model registry/session context and have a paired, guaranteed shutdown callback before disposal/invalidation.
2. **Owned provider-registration contract:** an atomic registration lease/token that reports successful application, captures/restores the prior legacy/native/absence source, conditionally disposes only while still current, never clobbers a later owner, and exposes a success point before dependent command/hooks/claim and cache restoration are published. A token without success ordering and teardown is insufficient.

Merely documenting that SDK callers should bind, or approving exclusion of bare/empty/mode-only hosts, does not close #20.

### User flows that work now

- **Normal Pi TUI, RPC, print, and JSON:** supported on Pi 0.84. Their actual mode implementations provide counted bindings, register rebind behavior, and dispose through `AgentSessionRuntime`.
- **SDK with an explicit counted binding:** startup and enabled/disabled/enabled reload work; the host must also provide proper shutdown/runtime lifecycle.
- **SDK with empty/mode-only/abort-only binding:** direct bind initializes; every reload requires an explicit rebind.
- **Bare direct SDK:** incomplete and blocked. Process/delegate/Fusion registrations may be present, but ambient attribution, `/claude-cache`, ownership hooks/cache initialization, and session-start context services are not.
- **Package-owned isolated Anthropic children:** unchanged; forced child/path controls pass and normal child Pi modes provide the standard bindings.

## Standard mode evidence

| Pi 0.84 mode | Actual source evidence | Result |
|---|---|---|
| TUI | `interactive-mode.js` binds UI + command actions + shutdown + error; sets runtime rebind; uses runtime disposal | counted |
| RPC | `rpc-mode.js` binds UI + command actions + shutdown + error; sets runtime rebind; uses runtime disposal | counted |
| Print | `print-mode.js` binds command actions + `onError`; sets runtime rebind; uses runtime disposal | counted |
| JSON | same `runPrintMode` implementation with mode `json` and the same counted bindings | counted |

This is source and focused SDK proof, not an end-to-end terminal/RPC transport qualification run.

## Verification commands and results

All executable checks used isolated owned roots plus:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file npm_config_offline=true
```

Docs/config checks used Node `v22.19.0` / npm `10.9.3`; runtime checks used Node `v24.16.0` / npm `11.13.0`.

| Command / scope | Exit and result |
|---|---|
| `node scripts/docs/selftest.mjs` | 0; mutation fixtures passed |
| `npm run test:docs` | 0; 8/8 |
| `npm run docs:verify` | 0; 32 surfaces / 52 sources, deterministic |
| retained seven-control probe | 0; all 7 residual negatives reject for their own reasons; original/handler controls correct |
| retained 48-profile audit | 0; 48/48, 32 surface owners, 52 source owners |
| `tsx --test tests/unit/config.test.ts` | 0; 4/4 |
| `npm run payload:check` | 0; 108 files |
| focused `feature-selection-sdk.test.ts` | 0; 18/18 |
| independent public provider-ownership probe | 0; absence/legacy/native/later/failure/duplicate/routing/future merge |
| exact-absence probe | 0; Pi 0.84 primary + Pi 0.86 supplemental |
| retained SDK lifecycle matrix | 0; bare/empty/mode-only/counted/rebind on 0.84 + supplemental 0.86 |
| independent binding-count matrix | 0; bare + 7 binding forms asserted on Pi 0.84 |
| delegate producer → `bg_result` | 0; 1/1 |
| Fusion producer → `bg_result` | 0; 1/1 |
| forced child/path controls | 0; 15/15 |
| attribution reload/resume lifecycle | 0; 1/1 |
| `npm run typecheck` | 0 |
| `npm run test:type-safety` | 0; 4/4 |
| public host API/source audit | 0; Pi 0.84 primary, 0.86 supplemental |
| direct SDK dispose characterization | 0; confirms missing shutdown emission |
| `git diff --check` and `git diff --check c4eb78c..HEAD` | 0 |

Primary evidence directory:

`/private/tmp/pi-bg-closeout-iNoltL/reports/feature-final-review/logs`

Checksums for retained logs/probes:

`/private/tmp/pi-bg-closeout-iNoltL/reports/feature-final-review/logs/evidence-sha256.txt`

No broad full-release suite was run, as requested.

## Frozen boundary and hashes

```text
base commit  c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541
base tree    c21e75f14fe4ae6ef502ef6942dc95275c72293c
HEAD commit  180536edd11306b15f983b998c3618c2bf310a6d
HEAD tree    91a7e1d4e54b71a214a17072be75a2301b64cffe
```

Whole tracked-file manifest SHA-256 before and after review was identical:

```text
771b202397b272b5f9094f831af25f284b64358e7abf9583e67590de54c77012
```

Key reviewed hashes:

```text
80873b2bec21ecb812059aa41246d4a4351ad6d56e0fe8091852d6a9e9725caf  extensions/anthropic-attribution.ts
61ed7dbaa6bc54a20e5d6270cc909e6a59b39070b6996cc1aafb2197f69a6c41  scripts/docs/lib.mjs
758f23288c1c422ae471468c151cb4ac7bfdad24a8ecdd6c523cb6b410eb461b  scripts/docs/selftest.mjs
77e7c7844f479b8873aab750f33b09063b474741dad45ad7b86fb8f51c6d25c2  tests/sdk/feature-selection-sdk.test.ts
695354d5c0fb2c2d1d1f881232eb2e4f8b11b99188a329fd8b2f15e20ffa0f2f  docs/manifest.json
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts (unchanged)
24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111  src/core/config.ts (unchanged)
a62d5a6b91d2a500d5b8e94f26aadc814033c0758ce480226f3a170dfae51841  src/extension.ts (unchanged)
```

Pi 0.84 host evidence includes `agent-session.js` SHA-256 `91e72d5497f665e731cbd79da6a6e826d8cae7d2ce156a7dee39f8ca205e32c8` and extension runner SHA-256 `b39d59b8f86693b9aca15f13e14f367fce9a0ad8ed7ce9ad17950906f226951d`.

## Environment, limits, and cleanup

- Injected route verified: `openai-codex/gpt-5.6-sol`, reasoning `max`.
- Host: macOS arm64. Native Windows and compiled-Bun behavior were not qualified and are not claimed.
- Pi 0.84.0 is primary. Installed Pi 0.86.0 is supplemental only; its handler-snapshot behavior still leaves persisted cache restoration until a second bind, so no peer-range expansion is implied.
- No live model/provider request, network/GitHub operation, install, paid API, Fusion/agent launch, push, publish, source/doc/test/index/history write, attestation, worktree, or parent/main edit occurred.
- Final tracked bytes equal the initial frozen manifest. Worktree status remains only the pre-existing untracked `node_modules` symlink.
- Review-owned report/probes/logs are about 300 KiB. Owned TMP, HOME, and agent roots are empty (0 descendants / 0 B).
- No review-owned test, probe, server, watcher, package task, delegate, Fusion child, or other child process remains.
