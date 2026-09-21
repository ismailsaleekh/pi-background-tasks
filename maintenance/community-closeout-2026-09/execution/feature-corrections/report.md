# C1a feature corrections report

## Result

**CORRECTED for the supported, bound Pi 0.81.1–0.84.x extension lifecycle, with two explicit missing-host-API limits recorded below.** The unsafe name-wide provider deletion is gone; preexisting legacy/native providers and later owners are preserved through public source/instance snapshots, failed provider application publishes no owner or command, unrelated same-name tools remain active, and the docs grammar now rejects all three decisive mismatch classes. I do **not** claim the two impossible host guarantees described under “Remaining blockers and limits.”

Effective route was verified before work and again post-commit:

```text
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.6-sol
PI_REASONING_LEVEL=max
```

No model/provider call, external network/GitHub action, install, push, publish, parent/other-worktree edit, extra checkout, Fusion invocation, or paid API was used.

## Commit and owned paths

Follow-up commit:

- `c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541` — `fix: preserve feature registration ownership`
- parent `e3c0b065c52862e3889c9c5c24841a9d162fb338`

Runtime/docs engine/tests:

- `extensions/anthropic-attribution.ts`
- `src/extension.ts` (C1 registration reconciliation only)
- `scripts/docs/lib.mjs`
- `scripts/docs/selftest.mjs`
- `tests/sdk/feature-selection-sdk.test.ts`
- `tests/package/docs-contract.test.ts`
- new `tests/fixtures/anthropic-attribution-copy.ts`
- new `tests/fixtures/feature-tool-collisions.ts`

Authored docs:

- `docs/operations/configuration.md`
- `docs/subsystems/anthropic-attribution.md`
- `docs/subsystems/docs-freshness-gate.md`
- `docs/subsystems/host-ui-and-telemetry.md`

No forbidden production file changed. In particular, `src/core/anthropic-attribution.ts`, registry/common, attested, launcher, durable/Windows, Fusion engines, package/lock, and shared TESTING/TEST_PLAN/STATE files are unchanged.

## Finding 1 — provider ownership

### Public API facts and design

Read-only inspection covered Pi 0.84.0, installed 0.86.0, and cached declarations/implementations for every declared peer line 0.81.1/0.82.1/0.83.0/0.84.0 (`logs/declared-provider-api-surfaces.log`). All expose the relevant public API:

- factory-time `pi.registerProvider` is queued and reports no success;
- post-bind provider calls are immediate;
- `ctx.modelRegistry` exposes `getProvider`, `getRegisteredProviderConfig`, `getRegisteredNativeProvider`, both `registerProvider` overloads, and name-wide `unregisterProvider`;
- legacy registration creates a fresh merged config object and removes native registration;
- native registration removes legacy registration and stores the supplied provider object;
- unregister is name-wide and has no owner token or conditional/CAS form.

The ambient wrapper now activates at `session_start`, after binding. It snapshots the public effective, legacy, and native provider state, calls the accepted attribution factory with the real Pi facade, and records ownership only after observing a new current legacy-config object. That object is the instance token.

Shutdown compares the current config object by identity. A later legacy/native owner causes an inert cleanup. Otherwise restoration uses public replacement APIs, never deletion:

- prior native → restore the exact native object;
- prior legacy → install the captured effective provider natively to clear only the current package layer, then reapply the captured legacy config from an empty legacy layer;
- no prior dynamic registration → restore the captured effective provider natively.

Provider-application failure throws before the accepted factory registers `/claude-cache`, hooks, or its claim responder. Duplicate copies still produce exactly one successful owner.

### Red evidence

Required environment prefix was used for every command.

| Command | Exit/result | Evidence |
|---|---:|---|
| focused preexisting-host SDK test | `1`, 0/1; host legacy stream became `undefined` after disable | `logs/red-provider-preexisting.log` |
| focused later-owner + failed-registration SDK tests | `1`, 0/2; later owner deleted and no post-bind installation error existed | `logs/red-provider-later-failure.log` |

### Green evidence

| Command | Exit/result |
|---|---:|
| `tsx --test --test-concurrency=1 tests/sdk/feature-selection-sdk.test.ts` | `0`, 15/15 |
| real provider cases inside that suite | preexisting legacy restore, exact native restore, later-owner survival, failed-install no claim/command, duplicate-copy one-owner all pass |
| original reviewer `provider-ownership.mts` | `0`; host registration restored, later owner survives, failed install leaves host and registers no command |
| same provider probe against installed Pi 0.86.0 | `0`; same corrected results |
| real Anthropic reload/resume lifecycle | `0`, 1/1 |

Primary logs: `green-feature-sdk.log`, `reviewer-runtime-probes.log`, `provider-ownership-pi086.log`, `green-attribution-lifecycle.log`.

The original probe now reports:

```text
hostRegistrationPresentAfterDisable=true
laterSurvivedPackageShutdown=true
cacheCommandRegistered=false
hostSurvivedPackageShutdown=true
effectiveHostProviderRestoredByIdentity=false  (exact API limit below)
```

## Finding 2 — active-tool ownership

The package-level `FEATURE_CONTROLLED_TOOL_NAMES` subtraction/re-addition handler was removed. Pi’s real registry rebuild already drops active names with no current definition and activates current extension definitions. The package therefore no longer deactivates another extension merely because its tool is named `bg_delegate`, `fusion_brainstorm`, or another capability-controlled name.

### Red/green

| Command | Exit/result |
|---|---:|
| focused external-collision test before source fix | `1`, 0/1; external `bg_delegate` was inactive | `logs/red-active-tool-provenance.log` |
| permanent real-SDK collision test | included in feature suite `0`, 15/15; external `bg_delegate`, `fusion_brainstorm`, and control remain registered, active, and externally sourced |
| original reviewer `active-tool-collision.mts` | `0`; `bgDelegateActiveAfter=true`, control remains active |

The same feature suite also proves stale package cleanup on full → process/off → delegate reload and preserves default parity.

## Finding 3 — finite docs grammar

The grammar remains finite rather than becoming an interpreter. It now:

- validates the actual parser structure: frozen returned config and exact frozen feature record;
- uses the real `src/core/config.ts` in the positive fixture instead of `return {} as any`;
- inspects registration-owner parameter initializers and rejects default/destructured host aliases;
- rejects registration methods on unknown hosts;
- checks every config-binding use and rejects aliases, writes, mutation calls, and argument escapes;
- rejects unmodeled returns and throws in registration-owning scopes;
- traverses direct registration-owning `session_start` callbacks and imported registrars with inherited availability;
- permits only the structurally exact synchronous duplicate-owner guard (empty acknowledgement array, direct EventBus emit, exact acknowledgement append, adjacent positive-length bare return);
- leaves unrelated returns inside command/tool/event handlers legal.

Permanent decisive controls execute the synthetic runtime side and then require extraction rejection for the default-parameter hidden command, early-return invented command, frozen-config mutation, and mutable fake parser.

### Red/green

| Command | Exit/result |
|---|---:|
| `node scripts/docs/selftest.mjs` before extractor fix | `1`; “imported registrar parameter default host alias did not throw” | `logs/red-docs-decisive.log` |
| Node 22.19 `node scripts/docs/selftest.mjs` | `0` |
| Node 22.19 `npm run test:docs` | `0`, 7/7 |
| Node 22.19 `npm run docs:generate` | `0`, 32 surfaces / 52 sources |
| Node 22.19 `npm run docs:verify` | `0`, deterministic; attestations advisory |
| original docs reviewer decisive repro | now exits nonzero immediately at its unsupported fake parser instead of returning mismatched inventories |
| permanent manifest matrix | all 16 optional-feature subsets × 3 dock states = 48 exact profiles pass |

Evidence: `logs/green-docs-node22.log`.

## Other required verification

All commands used the offline isolated environment and task-owned TMPDIR/HOME/agent roots.

| Scope | Exit/result | Evidence |
|---|---:|---|
| 16 capability profiles, default/alternate/off shortcuts, encoded dispatch, real reload, provider cases | `0`, 15/15 | `green-feature-sdk.log` |
| forced attribution child / delegate / Fusion / attested argv controls | `0`, 15/15 | `green-forced-child-controls.log` |
| full delegate SDK including producer → `bg_result` | `0`, 14/14 | `green-delegate-sdk.log` |
| full Fusion SDK including producer → `bg_result` | `0`, 11/11 | `green-fusion-sdk.log` |
| Anthropic real reload/resume lifecycle | `0`, 1/1 | `green-attribution-lifecycle.log` |
| typecheck | `0` | `green-static-payload.log` |
| type-safety | `0`, 4/4 | `green-static-payload.log` |
| payload closure | `0`, 108 files | `green-static-payload.log` |
| focused package manifest/attribution/Fusion/payload | `0`, 4/4 | `green-package-focused.log` |
| full unit observation | `1`, 520/521 | `unit-full-observation.log` |
| `git diff --check HEAD^..HEAD` | `0` | `green-static-payload.log` |

The sole broad-unit failure is the known inherited stale assertion at `tests/unit/registry.test.ts:1231`: it expects bare `pi`, while the accepted resolver returns the canonical installed CLI path. Parent commit `3f4d4f8` already fixes that assertion; this branch intentionally does not weaken the resolver or touch forbidden registry/L1 ownership.

## Generated files

Written only by `npm run docs:generate`:

- `docs/INDEX.md`
- `docs/manifest.json`
- `docs/commands/{bg,bg-clear,bg-update,jobs,kill,logs,task-manager}.md`
- `docs/reference/{runtime-contracts,shortcuts-and-dock}.md`
- `docs/tools/{bg_kill,bg_logs,bg_run,bg_run_pi_attested,bg_status}.md`

No semantic attestation receipt/stamp was written.

## Remaining blockers and limits

### 1. No public API can preserve both legacy source state and composed-adapter identity

`provider-api-limit-probe.mjs` ran against Pi 0.84.0 and 0.86.0 (`logs/provider-api-limit-084-086.log`). In both versions:

- restoring the legacy source preserves the host registration and its exact registered `streamSimple`, but Pi recomposes a new effective adapter function;
- restoring the captured effective provider natively preserves that adapter identity, but necessarily deletes the host legacy config and breaks its future incremental merge behavior.

There is no public owner token, conditional removal, exact registration-state setter, or provider stack. The explicit product choice is to preserve the host’s public registration kind/config, exact host stream function, and future merge behavior. The transient Pi-composed wrapper identity is not claimed. Satisfying both simultaneously requires a host API change; private-map mutation is forbidden and was not used.

### 2. Empty-binding SDK reload omits `session_start`

Pi 0.84 `AgentSession.reload()` emits the new `session_start` only when the embedding host supplied at least one UI/command/shutdown/error binding. The original reviewer reload probe calls `bindExtensions({})`; after enabled → disabled → re-enabled it therefore reports claim acknowledgements `1/0/0`. A normally bound host (the permanent real-reload test supplies `onError`) reports `1/0/1` and exact inventories.

Factory-time registration cannot safely fill this gap: it is queued and has no success callback, which is the original ownership defect. There is no public post-bind/reload callback independent of `session_start`. Fabricating a claim from queued intent would violate the finding. This exact embedding-host lifecycle gap remains a blocker pending a host API/event fix; it is recorded rather than hidden.

### 3. Version qualification

The provider facade methods and replacement semantics are the same in installed 0.86.0, and the three ownership cases pass there. The package peer range remains unchanged at 0.81.1–0.84.x. Pi 0.86 snapshots event handlers at dispatch start, unlike declared lines, so no unqualified 0.86 first-start persisted-cache-override claim is made.

No native Windows, compiled Bun, live provider/model, external network, or full release qualification is claimed.

## Integrity and cleanup

Accepted core remained byte-identical:

```text
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
```

Post-commit status is clean. The untracked read-only `node_modules` symlink was unlinked without touching its target. Owned TMPDIR/HOME/agent roots are empty, report scratch is about 164 KiB, and no test/probe child, watcher, server, or package process remains. See `logs/cleanup.log` and `logs/commit-boundary.log`.
