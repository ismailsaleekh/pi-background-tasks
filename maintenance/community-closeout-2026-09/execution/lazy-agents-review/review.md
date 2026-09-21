# Independent P1a delegate/Fusion lazy-load review

## Verdict

**REJECT — P1a is not safe to integrate at `0ad75ed23ca26912294ebeb0b33cf26a331f91e2`.**

The basic lazy state machine, subtype routing, ordinary producer/result behavior, packed missing-module failure, static checks, and benchmark arithmetic all verified. However, shutdown is not fenced across the composed facade handlers, a real reload can leave a complete unregistered delegate artifact tree, and a stale result call can irreversibly consume Fusion usage without returning it. These violate explicit P1a lifecycle and exact-usage acceptance.

Reviewed range: base `fcf2af0950c8047ebf90b802e8049781fd3136fb` (tree `0ee3654012711f4a213dc79ca93f56fe30724ab7`) through target `0ad75ed23ca26912294ebeb0b33cf26a331f91e2` (tree `5b04b3985c0f9aae54cf501e8294a557555a9caf`).

## Findings

### HIGH — Composed shutdown awaits Fusion cleanup before closing delegate/result loaders, and in-flight delegate preparation survives closure

**Locations:**

- `src/extension.ts:267-297` registers the core barrier, then the complete Fusion registrar, then delegate and result registrars.
- `src/fusion-extension.ts:835-837,1368-1371` registers a synchronous Fusion close handler and then an async cleanup handler.
- `src/delegate-extension.ts:441-443,651-657` registers delegate/result close handlers only after both Fusion handlers.
- `src/delegate-extension.ts:530-553` merely brackets the artifact-producing `prepareDelegateLaunch()` await with open checks; it neither cancels nor rolls back preparation when shutdown occurs.
- The generated behavioral claim at `docs/subsystems/delegation.md:40` is therefore false for the composed extension.

Pi 0.84 dispatches handlers sequentially and awaits each handler (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:579-594`). If a Fusion run is still settling, the handler at `fusion-extension.ts:1368` pauses dispatch before the later delegate and `bg_result` close handlers execute. Calls retained from that activation can still enter those lanes after shutdown has begun.

Independently, even when delegate closure runs promptly, a delegate already inside preparation can finish writing after a real `AgentSession.reload()`. The post-await check rejects the call, but the successful preparation is not discarded because no task was admitted to own it.

**Reproductions (Node 22.19.0, exit 0 because the probes assert the defect):**

```bash
node --unhandled-rejections=strict --import ./node_modules/tsx/dist/loader.mjs \
  /private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/probes/composed-shutdown-order.mts
node --import ./node_modules/tsx/dist/loader.mjs \
  /private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/probes/delegate-prepare-shutdown.mts
```

The composed probe recorded `shutdown_was_paused:true` and `delegate_runtime_calls_during_shutdown:1`; only after Fusion was released did the same retained delegate tool begin returning `lazy_module_closed`. The real-reload probe used production `prepareDelegateLaunch()`: the tool rejected with `lazy_module_closed`, no starter ran, but a run directory remained containing `manifest.json`, `seed.json`, `context-omission-ledger.json`, `budget-plan.json`, `child-prompt.txt`, `child-session/`, and `spill/`.

Logs:

- `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/logs/composed-shutdown-order-probe.log`
- `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/logs/delegate-prepare-real-reload-probe.log`

This breaks the required synchronous all-lane shutdown barrier and zero-artifact guarantee, and can persist projected conversation/directive bytes without a registered task.

### HIGH — A stale `bg_result` can consume the one-time Fusion usage claim and then return no usage

**Locations:** `src/delegate-extension.ts:784-786`; interacting unchanged code at `src/core/registry.ts:1613-1626`.

The result facade verifies openness, awaits `claimFusionUsage()`, and only then checks openness again. The registry sets `task.fusion.usageDelivered = true` before its durable metadata await. Shutdown during that await closes the facade; the claim completes and is durable, then the result invocation throws `lazy_module_closed`. A later retrieval sees the claim as already delivered and carries no `usage`, although no successful retrieval attached it.

**Reproduction (exit 0):**

```bash
node --import ./node_modules/tsx/dist/loader.mjs \
  /private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/probes/result-usage-shutdown.mts
```

Observed: old invocation rejected with `lazy_module_closed`; `durable_claim_flag:true`; fresh retrieval reported `usage_delivered:false` and `fresh_has_usage:false`.

Log: `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/logs/result-usage-shutdown-probe.log`.

This violates the contract that the first **successful** retrieval attaches complete Fusion usage exactly once.

### MEDIUM — Fusion commands touch old host context before checking activation closure

**Locations:** `src/fusion-extension.ts:1082-1108,1115-1123`.

`/fusion` can call `ctx.ui.editor()`, `ctx.waitForIdle()`, and its error-path `ctx.ui.notify()` before `launchFusionTask()` reaches the `shuttingDown` check. `/fusion-models` performs mode handling and can notify before entering `modelSelectorRuntime.run()`. During the composed shutdown pause above, Pi has not invalidated the old runner yet, so these are real old-activation host effects rather than merely a different error message.

The composed probe recorded `waitForIdle` plus two `ui.notify` calls after shutdown began. The focused stale-command probe additionally observed the empty `/fusion` path call `ui.editor`, `waitForIdle`, and `ui.notify` after closure.

Log: `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/logs/fusion-stale-commands-probe.log`.

No task was started in the probe, but the documented claim that stale calls are rejected before touching old host context is not true.

## Independent functional verification

All independent test commands used Node `v22.19.0` / npm `10.9.3`, isolated `HOME`, `TMPDIR`, and `PI_CODING_AGENT_DIR`, plus `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, and `GIT_ALLOW_PROTOCOL=file`.

| Command / scope | Exit | Result |
|---|---:|---:|
| lazy unit + import graph | 0 | 9/9 |
| real-SDK lazy facade tests, serial | 0 | 7/7, including blocked-import shutdown and real reload retry |
| real packed damaged-module regression | 0 | 1/1 |
| delegate/Fusion artifact, budget, launch, result, context, golden, equivalence, orchestrator units | 0 | 216/216 |
| delegate + Fusion real SDK producer/result suites | 0 | 26/26 |
| relevant delegate/Fusion scripted-provider loops | 0 | 20/20 |
| delegate mutation guard | 0 | 17/17 |
| `npm run typecheck` | 0 | clean |
| type-safety | 0 | 4/4 |
| docs contract/gate tests | 0 | 8/8 |
| `npm run docs:verify` | 0 | 32 surfaces / 56 sources |
| `npm run payload:check` | 0 | 112 packed files |
| frozen closeout hashes | 0 | 49/49 |

Logs are under `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/logs/`. Two preliminary typecheck attempts with reviewer-imposed 192 MiB and 248 MiB V8 heap caps exited 134 from V8 OOM; the ordinary Node 22 typecheck then exited 0. These were harness-limit failures, not compiler diagnostics.

I also ran a strict unhandled-rejection/reentrancy probe. A reentrant first `load()` received the exact stored promise, the importer ran once, a late rejecting import after close yielded the sticky close error, and `unhandled_rejections` remained zero. Log: `logs/lazy-reentrant-unhandled.log`.

Worker evidence was inspected rather than treated as the verdict: final default unit `567/567`, SDK `75/75`, initial package `76/76`, follow-up package `77/77`, and scripted-provider `35/35` are present with the hashes claimed in the implementation report.

## Independent import-graph verification

I used a separate TypeScript-AST walker that follows runtime `import`, runtime re-export, import-equals, and literal `require` edges while excluding only explicit type imports. It did not rely on the new package test's forbidden list.

- Delegate facade static graph: **5 files / 96,418 TypeScript bytes** — `delegate-extension`, `common`, delegate `types`, `facade-contract`, and `lazy-module`.
- Fusion facade static graph: **13 files / 257,420 TypeScript bytes**.
- `src/extension.ts` static graph: **24 files / 544,661 TypeScript bytes**.
- Named deferred roots were genuinely absent from facade static graphs: delegate launch/budget/seed/runner/result and Fusion context/clean-context/config/orchestrator/result/selector.
- Literal deferred targets resolve under shipped `src/`; actual SDK and packed tests proved Jiti resolution.
- The extracted delegate constants remain exactly `24`, `120`, `1200`, and `48*1024`; `$current` and the default config bytes/shape are unchanged.
- No accidental runtime edge came from the new type-only imports or re-exports.

The independent graph also makes the remaining limitation concrete: the Fusion facade still eagerly reaches `source-policy`, `workflows`, `prompts`, `output-contract`, `attested-pi-run`, `durable-fs`, `pi-launch`, and `windows-taskkill`. This is consistent with the explicitly deferred P1b/attested seam rather than evidence of complete startup isolation.

Receipt: `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/graph.json`.

## Independent benchmark/stat verification

`verify-bench.mjs` recomputed count, median, nearest-rank p90, MAD, min, and max directly from every raw array. All embedded statistic objects matched exactly; every scenario had rounds 0–29 exactly once. All 30 delegate/Fusion samples in each state were completed and committed, every Fusion sample recorded five fake children, and every selector sample entered UI once.

### Genuinely pre-edit v1

Driver/worker hashes were byte-identical between base and candidate: `b9a24dc…` / `30408637…`. Raw hashes matched the receipts: base `29f227f0…`, candidate `dbe02063…`.

Selected independently recomputed medians (ms):

- default-full load `289.142 -> 121.949`
- delegate-profile load `280.559 -> 114.863`; first launch `82.495 -> 145.785`; first result `15.860 -> 19.991`
- Fusion-profile load `283.739 -> 113.855`; first launch `85.319 -> 196.285`; first result `16.725 -> 29.850`
- selector-profile load `287.257 -> 113.178`; first selector `0.256 -> 19.845`

### Final v2 controls

Driver/worker hashes were identical at both source states: `2c6af054…` / `926752d0…`. Raw hashes matched: base `3449c927…`, candidate `895b1119…`.

| Metric | Base median / p90 / MAD ms | Candidate median / p90 / MAD ms |
|---|---:|---:|
| no-extension loader | 1.026 / 1.557 / 0.098 | 1.222 / 1.486 / 0.181 |
| process-only package load | 299.116 / 499.140 / 20.251 | **144.226 / 161.491 / 15.426** |
| default-full package load | 326.749 / 508.006 / 38.725 | 135.276 / 165.911 / 16.235 |
| first delegate launch | 85.028 / 96.891 / 3.010 | 159.425 / 192.918 / 12.179 |
| first Fusion launch | 87.269 / 104.894 / 4.302 | 211.002 / 246.865 / 16.143 |
| first selector | 0.264 / 0.378 / 0.017 | 19.547 / 24.550 / 0.626 |

The final process-only cost remains about **144 ms versus 1 ms with no extension**. First-use costs moved upward and are not hidden.

Reflog confirms the v2 sequence: commit final candidate, checkout the frozen base in the same worktree, then restore `closeout/lazy-agents`; no third worktree/copy was made and final HEAD/tree are restored. The v1 baseline predates tracked implementation; its external driver/worker bytes equal the candidate commit's scripts. Baseline and candidate were necessarily sequential, not AB/BA. SDK-import drift and the v2 direct-delegate regression are disclosed. The evidence supports no deterministic threshold or causal millisecond guarantee and is not filesystem-cold, native-Windows, compiled-Bun, or precompiled-distribution evidence.

Full recomputation: `/private/tmp/pi-bg-closeout-iNoltL/reports/lazy-agents-review/bench-verification.json`.

## Scope, provenance, and hashes

The three commits are coherent and preserve PR credit. `05e34b8` names `PR #22 head 055306d01f6575ce5d3cbbc6588f2bdf6e2c252a` and contains `Co-authored-by: bufan <821869798@qq.com>`; the frozen snapshot identifies contributor `821869798`, author `bufan <821869798@qq.com>`. Frozen evidence verified 49/49.

Selected target SHA-256 values:

- `src/core/lazy-module.ts` — `7690944fad0026d788164659005f89feb578475e960d8ec925787f1d274dfa3b`
- `src/core/delegate/facade-contract.ts` — `b9a6a9a3cffdf570b342b1e8f0b8b4b62b0e6f22320ba448695fa5392bd7a095`
- `src/core/delegate/budget.ts` — `2cb26d166347ef7cb3cf17f41bde9b9802394186976b6762bdc0212d0704b9b3`
- `src/core/fusion/facade-contract.ts` — `fd6129b61337d4fd825719c1ddb0b3e753e353b0cfbd374280ab583357ef4b0d`
- `src/core/fusion/config.ts` — `4cdbc540f0cbfa230f782f243963d673514a7e11ad06a4089e838a27d1ba49b4`
- `src/delegate-extension.ts` — `04af577e94456189e6b31a4aae44931532d54dacc9fce9c5cbfbb2534e8267a1`
- `src/fusion-extension.ts` — `efcfafa93fa76454c0b3a6a9363c2495531fdeadb94ce6e0f858a5034508bddc`
- packed missing-module test — `4bf826da388dd6f915e649e03aa55e4e94cd8fa36ffcdb69caf6d4076fb2df01`

`git diff --check` passed. There is no target diff in `src/extension.ts`, common, registry, EventBus, attested, durable I/O, launcher, UI, `extensions/`, `package.json`, `package-lock.json`, `TESTING.md`, or `TEST_PLAN.md`. Package/lock hashes are `b4d4d9aa…` / `65cc9d89…`; reports are outside the shipped payload.

## Remaining P1b and platform boundary

Even after the findings are corrected, this remains P1a only. `src/extension.ts` statically imports facade source; the ordered attribution entrypoint, dock/UI, attested/registry/process graph, and raw TypeScript/Jiti remain eager. Precompilation/bundling, loader/chunk/sourcemap qualification, native Windows, and compiled Bun remain P1b/release work. Issue #21 and PR #22 are **not closure-ready**.

Review host: macOS 15.7.3 / Darwin 24.6.0 arm64. Package Pi was 0.84.0; installed host/docs were 0.86.0. Bun 1.3.4 was present but no compiled-Bun test was run. No native Windows, pwsh, Nushell, pnpm, compatibility install, PTY, network, live provider, subscription inference, or user auth/config/session state was used.

Effective reviewer route was verified as `openai-codex/gpt-5.6-sol` with reasoning `max`. No Fusion or delegated agents were used. No source, docs, index, history, or attestation stamp was changed. Final worktree status remains only the pre-existing restored `node_modules` symlink; owned TMP/HOME/agent roots are 0 B, retained review evidence is under 1 MiB, and no review/test child remains.
