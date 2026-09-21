# C1a design — capability selection, dock shortcut, finite docs variants

## Authority, environment, and boundary

- Base: `bc25e9a8d8be74bd38899e56bb7ab2266629969c` on `closeout/features`.
- Effective route environment verified before work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.
- Package-only worktree and shared dependency symlink were verified; no install, network, provider inference, other worktree write, or parent-repository write is part of this unit.
- C1a owns registration/configuration/docs extraction only. It does not change registry/common/lifecycle execution semantics, shell policy, persistence, auto-backgrounding, or P1 lazy/performance behavior.
- The required pre-edit deterministic refresh ran first: `npm run docs:generate` and `npm run docs:verify` both exited 0. Its five stale generated files remain in this worktree and will be committed only with the real C1a consumer change.

## Runtime configuration

A new `src/core/config.ts` will export one closed runtime contract:

- `PI_BG_FEATURE_VALUES = process,delegate,fusion,attested,attribution`.
- Default: all five values.
- `PI_BG_FEATURES` is parsed as exact lowercase, unique, comma-delimited tokens. Empty input/entries, whitespace, duplicate or unknown tokens, and omission of mandatory `process` throw `pi_bg_config_invalid` with a bounded value excerpt and accepted values. There is no malformed-value fallback.
- `bg_result` is not a token. It is derived and registered once iff `delegate || fusion`.
- `PI_BG_DOCK_SHORTCUT` accepts exactly `shift+down` (default), `ctrl+alt+b`, or `off`; malformed values fail before registration.
- Both package entrypoints parse the complete configuration before registering anything. Configuration is read once per activation and naturally re-read by a real Pi reload.
- Footer text is derived from the parsed shortcut enum: `Shift↓`, `CtrlAltB`, or `/tasks`. `/tasks` and `/bg-tasks` remain unconditional; `ctrl+alt+c` remains unconditional.

Registration topology:

| Capability | Runtime registrations |
| --- | --- |
| `process` | Existing process commands/tools, task renderer/UI, EventBus, dock/footer, and clear shortcut. Mandatory. |
| `delegate` | `bg_delegate`. |
| `fusion` | `/fusion`, `/fusion-models`, four Fusion tools, and `fusion-result`. |
| `attested` | `bg_run_pi_attested`. |
| `attribution` | Ambient parent Anthropic provider/hooks and `/claude-cache`. |
| derived `delegate || fusion` | Exactly one `bg_result` registrar. |

`registerBackgroundResultExtension` will be split from the existing delegate registrar without changing its retrieval implementation. Existing Fusion shutdown/start lifecycle code remains byte-for-byte unchanged. Existing host session lifecycle blocks remain unchanged; a separate final active-tool reconciliation callback removes stale package advanced names and adds only currently registered/enabled names. Registration absence—not `setActiveTools` alone—is authoritative.

## Anthropic child safety

- `extensions/anthropic-attribution.ts` becomes the ambient, feature-aware parent entrypoint.
- New `extensions/anthropic-attribution-child.ts` directly exports the accepted attribution implementation and never consults ambient feature selection.
- `resolveAnthropicAttributionExtensionPath()` remains the single child path seam but resolves the always-on child entrypoint.
- Delegate, Fusion, and attested launchers remain untouched and therefore retain their current attribution-before-guard/governor order while receiving the safer central path.
- `PI_BG_FEATURES=process,...` without `attribution` removes parent provider/hooks/cache command, but an explicitly isolated Anthropic child still loads mandatory attribution.

## Finite docs grammar

The docs extractor will gain one deliberately closed conditional-registration grammar, not a general conditional evaluator:

1. A top-level immutable config binding must be initialized by the imported `parseBackgroundTasksConfig()` function.
2. A registration or imported registrar may be the direct statement in a top-level `if` block only when its condition is exactly one of:
   - `config.features.delegate|fusion|attested|attribution`;
   - the exact derived disjunction `config.features.delegate || config.features.fusion`;
   - `config.dockShortcut === 'shift+down'` or `config.dockShortcut === 'ctrl+alt+b'`.
3. The extractor reads runtime feature/shortcut/default constants from the parser module and compares them with its closed documentation enum. Additions, removals, reordered/drifted defaults, `dock:off` registration, unknown conditions, nested conditions, aliases, loops, computed names, hidden helpers, and repeated registrars fail closed.
4. Availability is canonicalized as `always`, `feature:<name>`, `any(feature:delegate,feature:fusion)`, or `dock:<literal>`. Every surface also receives `default_available` computed from the runtime defaults.
5. Manifest, INDEX/read gate, README facts, tool/command/shortcut generated contracts, EventBus facts, and Fusion workflow facts will expose availability/default status. The manifest also carries the exact default public-surface ID list.

Existing arbitrary conditional/hiding mutation controls remain and new controls cover recognized positive variants, unrecognized conditions, enum drift, illegal `off` registration, nested/aliased forms, and derived-expression mutation.

## Source ownership

Planned production edits:

- New `src/core/config.ts` — owned by `docs/subsystems/host-ui-and-telemetry.md` and described in `docs/operations/configuration.md`.
- `src/extension.ts` — configuration parse, conditional registrations, active advanced-tool reconciliation, literal shortcut branches, footer hint only. Existing session start/shutdown blocks stay unchanged.
- `src/delegate-extension.ts` — split delegate and shared-result registration; retrieval behavior unchanged.
- `extensions/anthropic-attribution.ts`, new `extensions/anthropic-attribution-child.ts`, and `src/core/anthropic-attribution-path.ts` — ambient gate and always-on child seam only. `src/core/anthropic-attribution.ts` is not edited.
- `scripts/docs/lib.mjs` and `scripts/docs/selftest.mjs` — finite variant extraction/generation and fail-closed mutations.
- No production Fusion engine, registry, common, attested implementation, durable filesystem, Windows kill, or launcher edit.

Authored docs to update: configuration, host UI, delegation, Fusion, attribution, attested runs, docs freshness, shortcut/dock reference, task-manager and result/tool guidance, plus README configuration/safety references. Generated files are changed only by `npm run docs:generate`; no attestation receipt is written.

Exact shared `tests/package/package.test.ts` changes (registration/manifest/entry cases only):

1. Add existence/payload assertions for `src/core/config.ts` and `extensions/anthropic-attribution-child.ts` in the existing manifest, pack, and installed-consumer file lists.
2. Extend the existing registration-source assertions to require the shared result registrar and conditional capability consumers.
3. Do not touch URL, npm/offline, type-safety, helper, or B0 guard sections.

Other tests are new focused files or narrow child-path expectation updates.

## Red-first and green test matrix

Tests are added before production edits and run against this base. Baseline-red evidence must be behavioral (missing feature selection/finite grammar/alternate shortcut), not merely a missing new-module import.

| Area | Scenarios |
| --- | --- |
| Default parity | Actual SDK loader/session has the current full commands, tools, renderers, active tools, default Shift+Down, clear fallback, and ambient cache command. |
| 16 feature subsets | Cheap real `DefaultResourceLoader` activation for every subset of `delegate,fusion,attested,attribution` with mandatory `process`; assert exact commands/tools/renderers, one derived `bg_result`, and no disabled registrations. |
| Invalid features/shortcut | Empty, blank token, whitespace, duplicate, unknown/manual `bg_result`, missing process, invalid shortcut, and oversized input all fail with bounded `pi_bg_config_invalid` diagnostics and zero package partial registration. |
| Shared result | Delegate-only and Fusion-only inventories each expose exactly one `bg_result`; existing real delegate/Fusion SDK producer/retrieval suites prove both unchanged execution paths. |
| Attribution | Ambient-off SDK inventory has no `/claude-cache`; direct child entrypoint remains registered with ambient off; delegate/Fusion/attested argv expectations use the child entry and retain attribution-first ordering. |
| Real reload | `AgentSession.reload()` transitions full → process/off → delegate/alternate, proving commands/tools/renderers/shortcuts and active tools are rebuilt exactly with no stale executable names. |
| Shortcut | Default, alternate, off, invalid; footer hint from actual running-task status; `/tasks` and `/bg-tasks` in off mode; `ctrl+alt+c` unchanged. A fixture owns Shift+Down. Host-resolved shortcut diagnostics and encoded-key dispatch (`Shift+Down` and `Ctrl+Alt+B`) prove alternate/off avoid conflict and route each key to the correct owner. |
| Docs grammar | Positive feature, derived-result, and shortcut branches; unchanged arbitrary conditional rejection; unknown condition, alias, loop/nesting, illegal `dock:off`, runtime/docs enum drift, unknown feature, and changed derived expression all fail closed. Generated manifest/INDEX/README/surface docs are mutation-checked for canonical availability and default facts. |
| Public/package gates | Focused unit/SDK/docs/package cases, typecheck, docs generate/verify, payload check, and default public-surface checks. No model/provider calls. |

Planned focused commands use `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file` and the task-owned TMPDIR/HOME/agent roots. Full release/platform gates remain integrator work; this slice makes no cold-start, Windows, compiled-Bun, or P1 performance claim.
