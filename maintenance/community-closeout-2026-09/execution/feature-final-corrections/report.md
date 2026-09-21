# C1a final package-owned corrections report

## Result

**PACKAGE-FIXABLE FINDINGS CORRECTED; #20 REMAINS `BLOCKED_SCOPE` / SDK-COMPATIBILITY BLOCKED.**

The no-prior-provider cleanup now restores exact public dynamic-registration absence. All seven residual finite-grammar counterexamples reject for their own structural reasons. Documentation now states the initialized-host contract and does not claim bare `createAgentSession()`, empty-binding reload, or mode-only reload support.

This is not a #20 closure claim and does not reduce its accepted scope. A complete SDK resolution still needs a guaranteed post-core-bind/reload lifecycle callback or an owner-token provider-registration API from Pi. Normal Pi TUI, RPC, print, and JSON modes remain the proven supported host paths.

Effective route was verified before work:

```text
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.6-sol
PI_REASONING_LEVEL=max
```

No model/provider request, paid API, network/GitHub action, install, dependency copy, Fusion/agent invocation, push, publish, extra checkout, parent/main/other-worktree write, private SDK mutation, or P1 work occurred.

## Commit and owned paths

Starting point:

- commit `c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541`
- tree `c21e75f14fe4ae6ef502ef6942dc95275c72293c`

Follow-up commit:

- `180536edd11306b15f983b998c3618c2bf310a6d` — `fix: close package-owned feature corrections`
- tree `91a7e1d4e54b71a214a17072be75a2301b64cffe`
- parent exactly `c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541`

Committed paths:

- `extensions/anthropic-attribution.ts`
- `scripts/docs/lib.mjs`
- `scripts/docs/selftest.mjs`
- `tests/sdk/feature-selection-sdk.test.ts`
- `tests/package/docs-contract.test.ts`
- `README.md`
- `docs/api/eventbus-v1.md`
- `docs/commands/claude-cache.md`
- `docs/getting-started.md`
- `docs/operations/configuration.md`
- `docs/subsystems/anthropic-attribution.md`
- `docs/subsystems/docs-freshness-gate.md`
- `docs/manifest.json`

Design was written before code at:

`/private/tmp/pi-bg-closeout-iNoltL/reports/feature-final-corrections/design.md`

No forbidden production/shared path changed. In particular, core attribution, config, extension orchestration, delegate/result implementation, child path, common/registry/attested/durable/launcher, Fusion engines, package/lock, `TESTING.md`, `TEST_PLAN.md`, and maintenance state are unchanged from `c4eb78c`.

## Finding 1 — exact no-prior provider absence

### Change

Cleanup retains the existing public ownership transaction:

1. compare the exact current package legacy-config token;
2. require no current native replacement;
3. return inertly if a later legacy or native owner replaced the package;
4. restore the captured prior source kind.

The no-prior branch now calls public `unregisterProvider("anthropic")` only after steps 1–2. Postconditions require:

- no legacy registration;
- no native registration;
- no `anthropic` entry in `getRegisteredProviderIds()`;
- the exact captured built-in effective provider object;
- its stream identity.

Prior native restoration still registers the exact native object. Prior legacy restoration still clears only the current package layer with the captured effective provider and reapplies the captured legacy config, preserving registered stream/config semantics and future incremental merge behavior. There is no blind deletion, private map/prototype access, or built-in-provider fabrication.

### RED

On exact starting commit `c4eb78c`:

```text
tsx ../reports/feature-runtime-review-2/probes/provider-public-state.mts
+ exact-absence assertion
```

The characterization probe exited 0, but the required assertion exited 1 on both Pi 0.84 and 0.86:

```json
{
  "legacyAbsent": true,
  "nativeAbsent": false,
  "registeredIdsContainAnthropic": true,
  "residualNativeIsCapturedBuiltin": true
}
```

Evidence: `logs/red-provider-exact-absence.log`.

The newly added permanent focused SDK tests also ran red before the source fix: 0/2 for exact absence and the host matrix because cleanup still left the native registration. Evidence: `logs/red-permanent-provider-host-contract.log`.

### GREEN public state

Permanent Pi 0.84 coverage is part of the 18/18 feature SDK suite. A supplemental public-API probe ran the exact state against Pi 0.84 and installed 0.86:

| Host | Legacy absent | Native absent | Registered ID absent | Exact built-in effective object |
|---|---:|---:|---:|---:|
| Pi 0.84.0 | yes | yes | yes | yes |
| Pi 0.86.0 supplemental | yes | yes | yes | yes |

Command:

```text
tsx ../reports/feature-final-corrections/probes/provider-exact-absence.mts
```

Exit 0; evidence `logs/green-provider-exact-absence.log`.

The full feature SDK suite also proves:

- prior legacy config, exact registered stream, API-key auth, headers, base URL, public routing, and future partial-merge behavior;
- exact prior native/effective object restoration;
- later legacy owner survival;
- later native owner survival;
- failed immediate installation leaves the host current and publishes no command/claim;
- duplicate copies publish one command and one owner;
- external `bg_delegate`, `fusion_brainstorm`, and control tools retain external provenance and activity.

The Pi-composed effective wrapper identity for restored legacy config is intentionally not asserted. Public legacy reapplication recomposes it; this remains the accepted nondefect. Behavioral routing/config/auth/stream/future-merge semantics are asserted instead.

## Finding 2 — all seven finite-grammar controls

The docs extractor remains a finite structural recognizer, not an interpreter.

### RED

On `c4eb78c`:

```text
node ../reports/feature-docs-review-2/probes/finite-grammar-negative-controls.mjs
```

Exit 1 as expected: all seven required negative fixtures were accepted. Evidence: `logs/red-docs-seven-controls.log`.

After permanent tests were added but before the extractor fix, `node scripts/docs/selftest.mjs` exited 1 at the first residual case (`registration-owner parameter initializer control flow did not throw`). Evidence: `logs/red-permanent-docs-controls.log`.

### GREEN controls

The same independent review probe now exits 0 with `residual_expected_rejections_accepted: []`. Each case rejects for its actual reason:

| Review fixture | Final rejection |
|---|---|
| `registration-owner-parameter-initializer-throw` | parameter initializer contains unsupported throw/control flow |
| `captured-config-mutation-in-session-start` | lexical finite config binding escapes its validated condition |
| `fake-duplicate-owner-channel` | guard does not emit the exact production claim channel |
| `unknown-host-computed-registration` | computed `registerCommand` uses an unsupported host |
| `destructured-default-unknown-host` | destructured registration binding is unsupported |
| `shadowed-imported-config-parser` | parser call does not resolve to the unshadowed imported parser |
| `hidden-early-return-in-config-parser` | parser does not have exactly one final direct immutable return |

Additional permanent controls require the exact production claim schema and closed `{ schema_version, acknowledge }` probe, reject a local pre-probe claim listener, reject captured config closure escape, and carry config authority through supported direct callbacks and independently validated imported registrars. Aliases, destructuring, writes, updates, mutations, argument/closure escapes, unknown property/computed hosts, and nested parser return paths fail closed.

The exact production claim channel/schema/probe remains accepted. Current production extraction succeeds at 32 public surfaces / 52 governed sources. Returns in unrelated command handlers remain legal. The original three decisive controls continue to reject independently with the real parser.

Evidence: `logs/green-docs-node22.log`.

## Finding 3 — truthful initialized-host boundary

Authored getting-started, configuration, attribution, `/claude-cache`, README, and EventBus API docs now state:

- generated availability describes the **initialized-host contract**, not a pre-bind guarantee;
- normal Pi TUI, RPC, print, and JSON modes provide counted bindings;
- an SDK host must provide at least one counted UI/command/shutdown/error binding so reload emits `session_start`, or explicitly bind again after reload when using empty/mode-only bindings;
- bare `createAgentSession()` does not emit `session_start`;
- `{}` and mode-only bindings initialize on the direct bind but do not make subsequent reload emit `session_start`;
- there is no private or factory-time fallback that can safely claim successful provider ownership.

The permanent docs guard initially failed red because none of this prose existed (`logs/red-initialized-host-doc-guards.log`) and now passes within `test:docs`.

### Initialized-host matrix

Actual Pi 0.84 observations after the package fix:

| Host path | Initial attribution | Disabled state | Re-enabled after reload | Classification |
|---|---|---|---|---|
| bare `createAgentSession()` | 0 claim; no command/hook/provider | n/a | n/a | `BLOCKED_SCOPE` |
| `bindExtensions({})` | 1 claim; command/hook/provider present | exact dynamic absence | 0 claim; absent | blocked until explicit rebind |
| empty binding + explicit post-reload `bindExtensions({})` | present | exact absence | 1 claim; present | initialized after explicit rebind |
| mode-only `{ mode: "print" }` | present | exact absence | 0 claim; absent | `BLOCKED_SCOPE` after reload |
| counted `{ mode: "print", onError }` | present | exact absence | 1 claim; present | supported representative binding |
| normal Pi TUI/RPC/print/JSON | counted host bindings | exact absence when disabled | lifecycle restored | supported/proven standard modes |

The retained runtime-review probe confirms the same state on Pi 0.84 and supplemental 0.86. On 0.84, persisted cache override restoration is present on normal/explicit binding. Pi 0.86 remains outside the peer range and retains its handler-snapshot qualification; no compatibility expansion is claimed.

Evidence: `logs/green-sdk-initialized-host-matrix.log` and the permanent feature SDK characterization.

### Exact remaining blocker — no scope reduction

Pi's current public SDK has neither:

1. a guaranteed callback after core provider binding and after every reload independent of host bindings; nor
2. successful owner-token/CAS provider registration usable safely at factory time.

Factory-time registration is queued and has no success result, so it cannot safely gate claim/command/hook publication. A `before_agent_start` fallback would still not provide correct initial inventory or persisted cache initialization. Therefore bare/empty/mode-only SDK compatibility remains an acceptance blocker for #20. This package correction does not mark those paths passing and does not approve their exclusion.

## Verification commands and counts

All commands used the owned roots and:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

Docs/config commands used Node `v22.19.0` / npm `10.9.3`; runtime checks used Node `v24.16.0` / npm `11.13.0`.

| Command/scope | Result |
|---|---:|
| `npm run docs:generate` | 0; 32 surfaces / 52 sources |
| `node scripts/docs/selftest.mjs` | 0; all mutation fixtures |
| `npm run test:docs` | 0; 8/8 |
| `npm run docs:verify` | 0; deterministic, attestations advisory |
| independent seven-control docs probe | 0; 7/7 residual negatives reject; originals reject; handler control accepts |
| independent manifest/profile audit | 0; 48/48 profiles, 32 exact surface owners, 52 exact source owners |
| `tsx --test tests/unit/config.test.ts` | 0; 4/4 |
| `npm run payload:check` | 0; 108 packed files |
| full focused feature SDK | 0; 18/18, including all 16 optional-capability subsets |
| exact absence probe, Pi 0.84 + 0.86 supplemental | 0; 2/2 exact public states |
| SDK lifecycle binding characterization | 0; bare/empty/mode-only blocked states and counted/rebind states observed |
| delegate-only producer → `bg_result` | 0; 1/1 |
| Fusion-only producer → `bg_result` | 0; 1/1 |
| forced attribution/delegate/Fusion/attested child/path controls | 0; 15/15 |
| attribution reload/resume lifecycle | 0; 1/1 |
| `npm run typecheck` | 0 |
| `npm run test:type-safety` | 0; 4/4 |
| `git diff --check` | 0 |

Primary green evidence:

- `logs/green-docs-node22.log`
- `logs/green-feature-sdk-18.log`
- `logs/green-provider-exact-absence.log`
- `logs/green-sdk-initialized-host-matrix.log`
- `logs/green-producers-child-lifecycle.log`
- `logs/green-static.log`

## Profiles, collisions, producer paths, and frozen behavior

- All 16 runtime optional-capability subsets pass exact inventory.
- All 16 subsets × 3 dock values pass the 48-profile manifest audit.
- Default/alternate/off shortcuts and footer behavior remain unchanged.
- External same-name tools remain registered, active, and externally sourced.
- Delegate-only and Fusion-only each expose one shared result path and complete producer → retrieval.
- Forced child/path controls pass 15/15; the always-on attribution child path is unchanged.
- No `src/extension.ts`, delegate implementation, config parser, attribution child/path, Fusion engine, or launcher change was made.

## Generated and authored documentation

`npm run docs:generate` was the only generated-doc writer. Git-visible generated changes are:

- `docs/manifest.json` — refreshed advisory attestation state/hashes;
- generated freshness count in `docs/subsystems/docs-freshness-gate.md` (`9` receipts not passing after truthful authored prose changes).

Authored host-boundary/grammar prose changed in README and the six docs listed in the commit paths. No attestation receipt/stamp was written; `docs/attestations.json` is unchanged. No INDEX/public-surface contract, profile, schema version, or surface inventory changed.

## Accepted hashes and frozen boundaries

Unchanged accepted bytes:

```text
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111  src/core/config.ts
a62d5a6b91d2a500d5b8e94f26aadc814033c0758ce480226f3a170dfae51841  src/extension.ts
90e48139f0458f93b477cf0496a1f79b888d3bb84db76b1b2b372a1a9f6b3209  src/delegate-extension.ts
c883fbb410e69ba0733b40e6002f15f0c58f1a2cc33fbeb9602f7ea814fd8763  src/core/anthropic-attribution-path.ts
0fd201f40396980ff583dc72535d208511798a4d7901d3285faef0873d8511db  extensions/anthropic-attribution-child.ts
f1b8ce9471b502f71e7aca1e0b4b95ce2eb8efcb23607a1b8e06c5625e1f96de  docs/subsystems/fusion.md
b4d4d9aa73c12fd774b558a457aafac1fef53e375ac315ab87fd095622d6521d  package.json
65cc9d897c12ccc7f3772ef924c26c16d7874f29efc01c167b863f6bfd49fe82  package-lock.json
```

Final changed-file hashes:

```text
80873b2bec21ecb812059aa41246d4a4351ad6d56e0fe8091852d6a9e9725caf  extensions/anthropic-attribution.ts
61ed7dbaa6bc54a20e5d6270cc909e6a59b39070b6996cc1aafb2197f69a6c41  scripts/docs/lib.mjs
758f23288c1c422ae471468c151cb4ac7bfdad24a8ecdd6c523cb6b410eb461b  scripts/docs/selftest.mjs
df122f48b4552bf7a1d085a795b60ae83ebf896eef3f71fb5298659d271ac16d  tests/package/docs-contract.test.ts
77e7c7844f479b8873aab750f33b09063b474741dad45ad7b86fb8f51c6d25c2  tests/sdk/feature-selection-sdk.test.ts
695354d5c0fb2c2d1d1f881232eb2e4f8b11b99188a329fd8b2f15e20ffa0f2f  docs/manifest.json
```

## Cleanup and final boundary

- Worktree status is clean except the harness-provided untracked read-only `node_modules` symlink.
- Owned TMP, HOME, and agent roots each have 0 descendants / 0 B.
- No test, probe, watcher, server, delegate, Fusion child, or package process remains.
- Report evidence is well below the 250 MiB cap.
- Cleanup evidence: `logs/cleanup.log`.

Work stops here for independent review. P1 was not started.
