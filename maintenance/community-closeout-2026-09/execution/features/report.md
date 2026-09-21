# C1a implementation report

## Result

**VERIFIED_LOCAL for the owned C1a functional slice.** Capability selection, configurable/disabled dock registration, independent ambient attribution, mandatory child attribution, real reload rebuilding, shared-result derivation, and finite truthful docs variants are implemented. This does not claim integrated release closure, P1 startup improvement, native Windows/compiled-Bun qualification, or completion of R1/C1b/D1/D2.

Effective worker environment was verified before work:

```text
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.6-sol
PI_REASONING_LEVEL=max
```

No model/provider inference call, network/GitHub action, push, publish, install, parent write, or other-worktree write was made.

## Commits and owned paths

Implementation commit:

- `da2f6fccfc4014f3310c63d7c6ad530f4ab3374d` — `feat: add strict capability and dock selection`
- tree `a26e8fb0c3d25d4c5359a44c8ad5b8f3bb8660a7`
- base `bc25e9a8d8be74bd38899e56bb7ab2266629969c`

The final report/evidence is committed in the immediate successor (the commit containing this file); this self-referential report does not attempt to embed its own commit hash.

Production/configuration:

- new `src/core/config.ts`
- `src/extension.ts`
- `src/delegate-extension.ts`
- `extensions/anthropic-attribution.ts`
- new `extensions/anthropic-attribution-child.ts`
- `src/core/anthropic-attribution-path.ts`

The accepted implementation `src/core/anthropic-attribution.ts` was not edited. No forbidden registry/common/attested/durability/launcher/Windows-kill production file changed.

Docs engine and tests:

- `scripts/docs/lib.mjs`, `scripts/docs/selftest.mjs`
- new `tests/sdk/feature-selection-sdk.test.ts`
- new `tests/unit/config.test.ts`
- new `tests/fixtures/shortcut-owner.ts`
- `tests/package/docs-contract.test.ts`
- registration/manifest/payload-only portions of `tests/package/package.test.ts`
- narrow child-path expectations in `tests/unit/{anthropic-attribution,delegate-launch,fusion-pi-child,fusion-v5-core}.test.ts`

Authored behavior/reference docs changed in README and `docs/{choose-a-workflow,getting-started,operations/configuration,reference/shortcuts-and-dock,subsystems/{anthropic-attribution,attested-pi-runs,delegation,docs-freshness-gate,fusion,host-ui-and-telemetry},commands/{claude-cache,task-manager},tools/{bg_result,bg_run}}.md`.

Generated output was written only by `npm run docs:generate`: README generated facts; `docs/{INDEX,read-before-edit,manifest}.json|md`; EventBus, command, shortcut, runtime, freshness, Fusion-workflow, and all public tool generated regions. The initial required pre-code refresh corrected the five stale base outputs (`docs/INDEX.md`, `docs/commands/claude-cache.md`, `docs/manifest.json`, `docs/reference/runtime-contracts.md`, `docs/subsystems/docs-freshness-gate.md`) and is retained with the real consumer change. No attestation receipt/stamp was written.

## Configuration and availability decisions

### `PI_BG_FEATURES`

Default is exactly:

```text
process,delegate,fusion,attested,attribution
```

The parser accepts only unique exact lowercase comma tokens from that list. It rejects empty input/entries, any whitespace, duplicates, unknown tokens (including manual `bg_result`), and missing mandatory `process`. Errors begin `pi_bg_config_invalid`, include accepted values/remediation, and bound hostile value excerpts. There is no default fallback after malformed input.

Registrations are absent, not merely inactive:

| Selection | Surface |
|---|---|
| mandatory `process` | `/bg`, `/jobs`, `/logs`, `/kill`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update`; `bg_run`, `bg_status`, `bg_logs`, `bg_kill`; task renderer/UI/EventBus/footer |
| `delegate` | `bg_delegate` |
| `fusion` | `/fusion`, `/fusion-models`, four Fusion tools, Fusion renderer/workflows |
| `attested` | `bg_run_pi_attested` |
| `attribution` | ambient parent Anthropic provider/hooks and `/claude-cache` |
| derived `delegate || fusion` | one `bg_result` registration |

A final process-owned session-start reconciliation removes stale advanced active names and adds only enabled registered names. It supplements registration absence; it is not the feature gate.

### `PI_BG_DOCK_SHORTCUT`

Accepted values are exactly:

- `shift+down` (default) → registers only Shift+Down; footer `Shift↓`
- `ctrl+alt+b` → registers only Ctrl+Alt+B; footer `CtrlAltB`
- `off` → no dock shortcut; footer `/tasks`

`/tasks`, `/bg-tasks`, and `ctrl+alt+c` remain unconditional. Invalid input fails before package registration.

### Attribution safety

The ambient entrypoint parses all C1a config before registration. When attribution is disabled it installs no provider, attribution hook, owner responder, or cache command. When enabled it tracks whether it won the existing duplicate-owner protocol and unregisters only its won provider during shutdown; a real enabled→disabled reload therefore restores the host Anthropic provider. The new child entrypoint directly invokes the accepted implementation and never consults ambient feature selection. The central resolver now returns that child entrypoint, preserving attribution before delegate/Fusion guards and for attested Anthropic argv.

## Red-first evidence

All commands used the required offline/isolated environment (`PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file` plus task-owned TMPDIR/HOME/agent roots).

| Base command after tests were added | Exit/result | Meaningful base failure |
|---|---:|---|
| `tsx --test --test-concurrency=1 tests/sdk/feature-selection-sdk.test.ts` | 1; 1/8 pass, 7/8 fail | Process-only still exposed every advanced surface; malformed input fell back implicitly; ambient attribution stayed present; reload retained full inventory; alternate/off key and footer behavior absent. |
| `node scripts/docs/selftest.mjs` | 1 | Recognized finite conditional registration was still rejected as non-top-level. |
| `tsx --test tests/package/docs-contract.test.ts` | 1; 2/3 pass, 1/3 fail | Manifest had no default/availability facts. |
| focused `fusion-pi-child` resolver case | 1; 0/1 pass | Resolver still selected ambient `anthropic-attribution.ts`, not the mandatory child entrypoint. |

Bounded logs and hashes:

- `reports/features/evidence/red-feature-sdk.log` — `098110c99870fb1d08f1d7777ba4c49aba9bdc9fc2b3a923c1be861eb9346bb0`
- `red-docs-selftest.log` — `0444129d608d16b65a2588cc16dbe07c32f722bf2ebda5d4638776d4fd4eb5d7`
- `red-docs-contract.log` — `88824f8d43ac796541489c11e16eec69817c35def9e02cff5b23d7275b853e2e`
- `red-child-path.log` — `a2e489097be30f9d1f0aff5e3586fab3b5d1fd1234f3f5b79d2fb8eb4c5d43ce`

## Green verification

| Command/scope | Exit/result |
|---|---:|
| feature SDK suite | 0; 8/8 |
| focused config + child argv/path suite | 0; 19/19 |
| full existing delegate SDK | 0; 14/14 |
| full existing Fusion SDK | 0; 11/11 |
| final focused delegate producer→`bg_result` | 0; 1/1 |
| final focused Fusion producer→`bg_result` | 0; 1/1 |
| Anthropic real SDK reload/resume lifecycle | 0; 1/1 |
| default host SDK registration/footer cases | 0; 3/3 |
| component suite | 0; 11/11 |
| `npm run test:docs` | 0; 6/6 |
| focused package registration/default/Fusion/payload cases | 0; 4/4 |
| `npm run typecheck` | 0 |
| `npm run test:type-safety` | 0; 4/4 |
| `npm run docs:generate` | 0; 32 configured surfaces / 52 production sources |
| `npm run docs:verify` | 0; deterministic, attestations advisory |
| `npm run payload:check` | 0; 108 packed files |
| `git diff --check` | 0 |

Final bounded green logs:

- `reports/features/evidence/green-feature-sdk.log` — `9e9a2644825a39ceea84073ad4e42fe17c8ca1e223911a1eb5165cf7bc18f59b` (8/8)
- `green-config-child.log` — `c4fdf0675c201a9d5a770d2cd5a87e1bc90b5572f1f79ba181188ae4c35a52e1` (19/19)

A broad `npm run test:unit` observation exited 1 with 519/521: the docs case was run between a source edit and final regeneration and passed 3/3 immediately after regeneration; the remaining isolated failure is the inherited launcher/registry expectation that POSIX spawn uses literal `pi`, while this base resolves the installed host CLI path. It reproduces alone, is unrelated to C1a (openai-codex attested case, no changed C1a path), and its source is in explicitly forbidden L1/R1 ownership. It was not hidden or “fixed” here. Full integrated gates remain parent/integrator work.

## Runtime proof details

- **16 combinations:** the real Pi `DefaultResourceLoader` activated every subset of `delegate,fusion,attested,attribution` with fixed `process`; each exact commands/tools/renderers inventory matched, and `bg_result` count was 0 or 1 according to its two producers.
- **Real reload/stale execution:** one bound `AgentSession` changed default-full → `process`/shortcut-off → `process,delegate`/alternate. Advanced tool definitions, commands, renderers, shortcuts, active names, attribution `session_tree` hook, and package provider implementation disappeared after the process-only reload; delegate plus one result returned on the next reload, with Fusion and cache command still absent.
- **Result producer paths:** the unchanged real delegate SDK loop committed and retrieved its verified answer; the real fake-child Fusion SDK run returned exact merged text and usage through the same split result registrar. Single-capability inventories each expose one result tool.
- **Shortcut/conflict/dispatch:** a real fixture extension owns Shift+Down. With alternate mode, Pi's actual `ExtensionRunner.getShortcuts()` emitted no conflict diagnostic; encoded Shift+Down (`ESC [ 1 ; 2 B`) matched/dispatched to the fixture and encoded Ctrl+Alt+B (`ESC`, control-B) matched/dispatched to the package dock. With `off`, Shift+Down remained fixture-owned, Ctrl+Alt+B had no dispatch target, no conflict was reported, and both task commands opened the package UI. Actual running-task status showed `Shift↓`, `CtrlAltB`, and `/tasks` from the corresponding config.
- **Process/EventBus:** process-only retained the background renderer/UI commands and completed a real EventBus capabilities request/response.
- **Child safety:** ambient-off loader inventory had zero cache command, provider registrations, or attribution handlers. Loading the child entry under the same environment still registered the Anthropic provider/command/hooks. Delegate/Fusion/attested argv tests bind the new child path and preserve attribution-first ordering.

## Docs strictness controls

The extractor permits only direct top-level registrations/registrars under:

- `config.features.delegate|fusion|attested|attribution` from a validated immutable parser binding;
- exact `delegate || fusion` derived availability;
- exact dock equality for `shift+down` or `ctrl+alt+b`.

It emits canonical `always`, `feature:*`, `any(feature:delegate,feature:fusion)`, and `dock:*` expressions plus source-derived `default_available`. Runtime features, shortcut values, and defaults are compared with closed docs enums. Selftests retain all prior alias/computed/nested/wrapper/repeated-registrar controls and add positive finite consumers plus mutation failures for feature and shortcut enum drift, unknown feature, `off` registration, changed derived expression, and aliased config. Manifest, INDEX/read gate, README, runtime registry, commands, tools, shortcuts, EventBus, and Fusion workflow docs now expose availability/default facts.

## Limits and unresolved dependencies

- Flags do **not** solve eager import weight. This slice makes no startup latency/import-graph claim; P1 owns facades, single-flight deferred imports, lifecycle cancellation, and benchmarks.
- No shell policy, persistence/reload-survival, auto-backgrounding, registry admission/publication, or production execution-engine work was performed.
- No native Windows, compiled Bun, or full interactive PTY qualification was available or claimed. Shortcut dispatch is actual SDK conflict resolution plus encoded key matching/handler dispatch, not a native-terminal certification.
- Full release/default/package/platform gates and integration with the separate R1/L1 work remain parent responsibilities.

## Source hashes and cleanup

Key SHA-256 values at implementation commit:

```text
24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111  src/core/config.ts
38ef27a8f8b7b8fd1c748ab88a046563078e0c21ad52749314b32a9dec8abab3  src/extension.ts
90e48139f0458f93b477cf0496a1f79b888d3bb84db76b1b2b372a1a9f6b3209  src/delegate-extension.ts
d3fe1fe28184b1946b5a9520303da380cccb15760bda915cb7b830ea9883241f  extensions/anthropic-attribution.ts
0fd201f40396980ff583dc72535d208511798a4d7901d3285faef0873d8511db  extensions/anthropic-attribution-child.ts
c883fbb410e69ba0733b40e6002f15f0c58f1a2cc33fbeb9602f7ea814fd8763  src/core/anthropic-attribution-path.ts
4277a344dce362e075c4603d6cb7338fb23bed7eed73a7ae4c0c3a536dcc7afb  scripts/docs/lib.mjs
76eb7bf54c7aefac1dac540a852016003e1bb3d636e03f73beb01c300d6bab8b  scripts/docs/selftest.mjs
38d70dc6511cd35638ade7ec564e31748756eab5b5f6defe15ccda425488d382  tests/sdk/feature-selection-sdk.test.ts
0366d4a353ecd0cea88b71c378f8eb379b06eed6e653fd0e066155fbb1c70131  docs/manifest.json
```

`src/core/anthropic-attribution.ts` is byte-identical to base: `eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa`. A base→implementation name diff over all forbidden production paths was empty.

Cleanup completed:

- all SDK/unit temporary roots and task-owned TMPDIR/HOME/agent directories removed;
- no surviving test subprocess, watcher, server, or package child;
- only the assigned Sol worker process chain remains until this terminal response;
- untracked `node_modules` symlink was verified, unlinked only, and its shared target remains present/untouched;
- no dependency copy, install cache, tarball, `.pi` task artifact, or extra worktree was created/left;
- package worktree without shared dependencies is approximately 18 MiB.
