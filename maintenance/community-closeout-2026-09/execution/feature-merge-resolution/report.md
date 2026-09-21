# C1a + shell/R1 merge-resolution report

- Completed: 2026-09-20T10:53:46Z
- Result: **PASS — merge conflicts resolved and staged; no commit created**
- Package: `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks`
- Ours: `bf13bb3af3acc30fe6d6b6c522dac7b35954f0e3`
- Theirs / `MERGE_HEAD`: `180536edd11306b15f983b998c3618c2bf310a6d`
- Route: `openai-codex/gpt-5.6-sol`, reasoning `max`
- Test runtime: Node `v22.19.0`, npm `10.9.3`

## Resolved source

`src/extension.ts` is the minimized semantic union:

- SHA-256: `cf82add15763535cfb7dd43450474aabbbb9c1f66fc4864dd82626531216e13c`
- Git blob: `144025b4a841eaffc8f6a788de8716fa3e16627c`
- Index and worktree blobs match.

Exact composition choices:

1. `parseBackgroundTasksConfig()` runs first. The dock hint and immutable shell policy are then resolved before any package registration.
2. Exactly one dedicated `before_agent_start` shell-guidance handler is registered, and the same immutable `shellPolicy` object is passed to `BackgroundTaskRegistry`.
3. The accepted R1 synchronous shutdown/publication barrier remains registered before managed-workflow shutdown handlers. The accepted `disposed` guards, admission drain, EventBus closure, retry/timer suppression, and idempotent cleanup ordering are unchanged.
4. Fusion registration is conditional inside that preserved lifecycle seam. Delegate registration, derived `bg_result`, attested registration, and dock shortcut registration retain C1a's finite conditions. `bg_result` is registered exactly once iff delegate or Fusion is enabled.
5. Process surfaces remain unconditional, so shell guidance is present for every valid feature profile.
6. C1a's external-tool collision behavior is retained: no package-wide name subtraction/filter was restored.
7. Ambient attribution remains the feature-aware parent entrypoint; the separate always-on child entrypoint and central child attribution path remain unchanged. No fallback was invented for the SDK lifecycle blocker.
8. No command, tool, renderer, shortcut, or lifecycle listener was duplicated.

One existing R1 retention regression test required a mechanical integration adaptation after C1a split the shared result registrar from the delegate registrar: `tests/unit/registry.test.ts` now calls `registerBackgroundResultExtension()` directly. Runtime behavior and assertions are unchanged.

A new union-only integration test, `tests/sdk/feature-shell-union-sdk.test.ts`, was required because the independently accepted suites did not exercise both seams in one real session. It proves a real full → process-only → delegate-only `AgentSession.reload()` sequence while changing the inherited shell each activation. An actual offline scripted provider observes exactly one shell section plus cooperative peer guidance and the exact active feature tool inventory; EventBus launches then prove guidance = registry receipt = durable metadata = real fake-Nu argv. It also proves ambient attribution/provider presence in full mode and exact removal in process/delegate modes.

## Generated documentation resolution

All 18 generated or mixed generated conflicts were first resolved to temporary ours bytes. Authored feature prose was then restored outside generated regions before generation. In particular:

- C1a prose was retained in `docs/commands/claude-cache.md`, `docs/commands/task-manager.md`, `docs/reference/shortcuts-and-dock.md`, and `docs/subsystems/docs-freshness-gate.md`.
- `docs/tools/bg_run.md` retains both the accepted shell-policy sections and C1a's always-on child-attribution path wording.
- `docs/commands/bg.md` retains the accepted shell-policy prose.

The 18 originally conflicted documentation paths were:

- `docs/INDEX.md`
- `docs/manifest.json`
- `docs/commands/bg-clear.md`
- `docs/commands/bg-update.md`
- `docs/commands/bg.md`
- `docs/commands/claude-cache.md`
- `docs/commands/jobs.md`
- `docs/commands/kill.md`
- `docs/commands/logs.md`
- `docs/commands/task-manager.md`
- `docs/reference/runtime-contracts.md`
- `docs/reference/shortcuts-and-dock.md`
- `docs/subsystems/docs-freshness-gate.md`
- `docs/tools/bg_kill.md`
- `docs/tools/bg_logs.md`
- `docs/tools/bg_run.md`
- `docs/tools/bg_run_pi_attested.md`
- `docs/tools/bg_status.md`

`npm run docs:generate` was invoked **exactly once**, after the combined source and authored prose were ready. It reported **32 public surfaces / 53 production sources**. Generated facts now also report 31 default surfaces. No generated fact was hand-patched and no attestation receipt was written; attestation state remains advisory with nine non-passing/stale receipts.

There are 37 staged README/documentation paths after combined generation:

- `README.md`
- `docs/INDEX.md`, `docs/manifest.json`, `docs/read-before-edit.md`
- `docs/api/eventbus-v1.md`
- `docs/choose-a-workflow.md`, `docs/getting-started.md`
- `docs/operations/configuration.md`
- `docs/reference/runtime-contracts.md`, `docs/reference/shortcuts-and-dock.md`
- `docs/commands/{bg-clear,bg-update,bg,claude-cache,fusion-models,fusion,jobs,kill,logs,task-manager}.md`
- `docs/subsystems/{anthropic-attribution,attested-pi-runs,delegation,docs-freshness-gate,fusion,host-ui-and-telemetry}.md`
- `docs/tools/{bg_delegate,bg_kill,bg_logs,bg_result,bg_run,bg_run_pi_attested,bg_status,fusion_investigate,fusion_reason,fusion_research,fusion_validate}.md`

`docs:verify` confirms deterministic generation; `payload:check` confirms 109 packed files.

## Package-local report removal

The worker-added `reports/features/**` directory was removed from both the merge index and worktree. Relative to `MERGE_HEAD`, all eight paths are deletions:

- `reports/features/design.md`
- `reports/features/report.md`
- six `reports/features/evidence/*.log` files

Proof: `git ls-files reports/features` returns zero paths and the directory is absent. The authoritative parent maintenance copies were not touched.

## Commands and results

All mechanical checks used isolated `TMPDIR`, `HOME`, `XDG_CONFIG_HOME`, and `PI_CODING_AGENT_DIR` under the assigned roots, with `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, `GIT_ALLOW_PROTOCOL=file`, and npm offline mode.

### Integration catches and corrections

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` (first composed source) | 2 | Correctly exposed the R1 registry test's stale use of the pre-C1a combined delegate/result dependency interface (3 diagnostics). |
| `npm run typecheck` after registrar test adaptation | 0 | Clean. |
| `npm run docs:generate` | 0 | Run once; 32 surfaces / 53 sources. |
| `npm run typecheck` with initial union test | 0 | Clean. |
| `tsx --test --test-concurrency=1 tests/sdk/feature-shell-union-sdk.test.ts` (first attempt) | 1 | Test-only race: argv witness was read before terminal metadata; production behavior had launched successfully. |
| Same union test after waiting for terminal metadata | 0 | 1/1. |
| Final simplified union test | 0 | 1/1, 0 skipped. |

### Final focused qualification

| Command / scope | Exit | Tests/result |
|---|---:|---|
| `npm run typecheck` | 0 | Final clean TypeScript check. |
| `npm run test:type-safety` | 0 | 4/4, 0 skipped. |
| `tsx --test --test-concurrency=1 tests/sdk/feature-shell-union-sdk.test.ts` | 0 | 1/1, 0 skipped. |
| `tsx --test --test-concurrency=1 tests/sdk/feature-selection-sdk.test.ts` | 0 | 18/18, 0 skipped; includes all 16 optional-feature subsets, provider ownership, collision provenance, and real reload. |
| `tsx --test --test-concurrency=1 tests/unit/{config,anthropic-attribution,delegate-launch,fusion-pi-child,fusion-v5-core}.test.ts` | 0 | 121/121, 0 skipped. |
| Focused delegate producer → `bg_result` SDK case | 0 | 1/1, 0 skipped. |
| Focused `fusion_reason` producer → `bg_result` SDK case | 0 | 1/1, 0 skipped. |
| `tsx --test --test-concurrency=1 tests/unit/{shell-policy,core,posix-invariance,registry,windows-taskkill,extension-api}.test.ts` | 0 | 87/87, 0 skipped; includes R1 admission/publication/EventBus retention controls. |
| `tsx --test --test-concurrency=1 tests/sdk/{shell-policy-sdk,lifecycle-sdk,sdk}.test.ts` | 0 | 22/22, 0 skipped; includes real reload/runtime lifecycle. |
| `tsx --test --test-concurrency=1 tests/scripted-provider/{shell-policy-guidance,follow-up}.test.ts` | 0 | 8/8, 0 skipped. |
| `node scripts/docs/selftest.mjs` | 0 | Mutation fixtures passed. |
| `npm run test:docs` | 0 | 8/8, 0 skipped. |
| `npm run docs:verify` | 0 | 32 surfaces / 53 sources; deterministic; attestations advisory. |
| `npm run payload:check` | 0 | 109 packed files satisfy closure. |
| `git diff --cached --check` | 0 | Clean. |

Final non-overlapping test total: **271/271 passed, 0 skipped**. No broad full gate was run, as requested.

## Remaining blocker and qualification limits

Issue #20 remains **`BLOCKED_SCOPE`**, not closure-ready. Package-owned C1a behavior passes, but Pi's public lifecycle still cannot guarantee initialization for bare `createAgentSession()`, nor rebuilt `session_start` after empty/mode-only reload without explicit rebind, while preserving atomic provider ownership and paired shutdown. Direct `AgentSession.dispose()` also does not supply the runtime shutdown contract. This merge does not exclude those hosts, use private state, or invent a timer/lazy/provider fallback.

Platform limits remain explicit:

- Host was macOS arm64.
- No native Windows, Nushell, or PowerShell/pwsh qualification was available.
- Fake Nu proves exact argv, guidance, spawn, receipt, and metadata, but is not native Nu syntax certification.
- Windows behavior remains source/mocked coverage, not native execution certification.
- Compiled Bun was not qualified here.
- Pi 0.84 is the package dependency used by tests; reading installed 0.86 hook/SDK docs does not expand the declared peer range or constitute 0.86 qualification.

## Index, boundary, and cleanup proof

- `git ls-files -u`: **0 entries**.
- Staged paths: **58**.
- `src/extension.ts` staged blob: `144025b4a841eaffc8f6a788de8716fa3e16627c`.
- Conflict-marker scan over package source/docs/tests: none.
- `git diff --cached --check`: PASS.
- `MERGE_HEAD` remains `180536edd11306b15f983b998c3618c2bf310a6d`; no commit/reset/abort/rebase occurred.
- The pre-existing unstaged `maintenance/community-closeout-2026-09/STATE.md` change and untracked maintenance execution directories remain outside the index and untouched.
- Assigned `tmp/feature-merge-resolution`, `home/feature-merge-resolution`, and `agent/feature-merge-resolution` roots were removed: 0 descendants / 0 B.
- Retained report/evidence directory is about 176 KiB, far below 250 MiB.
- No test/task child remains. Only this worker's expected Pi/telemetry parent chain remains until the response exits.
- No install, network/GitHub operation, push, publish, paid API, Fusion tool/orchestrator used to perform this work, external agent, live provider request, user-state access, or attestation stamp occurred. The required Fusion producer test used only its local fake-child fixture, and the union-test provider was an in-memory offline fixture.

The index is ready for the parent to inspect and commit the merge.
