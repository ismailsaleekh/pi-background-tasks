# Attribution A1+A2 implementation report

## Route and repository

- Effective route observed before work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.
- Worktree: `/private/tmp/pi-bg-closeout-iNoltL/attribution`, branch `closeout/attribution`.
- Starting HEAD: `14afc33e3967a142758169d3217a4e63b4b3ec94`; production baseline: `14aa4ef382952f073bd4d540f57d6e8e3c2789a2`.
- Frozen evidence integrity: all 49 entries in `maintenance/community-closeout-2026-09/evidence/SHA256SUMS` passed before implementation.
- Design/red plan: `/private/tmp/pi-bg-closeout-iNoltL/reports/attribution-design.md`.

## Commit

- `8d55ae57c4ed6535ded1326b75cb08142d9926b8` — `fix(attribution): recover lineage and harden host integration`
- The commit is a direct descendant of `14afc33e` and records both frozen heads:
  - PR #17: `9b46c9ddc476f36261cf359ba7fbf60b4f556fbb`; co-author `LordMelkor <kray@squareup.com>`.
  - PR #12: `31c1de4ecc373315f0cfdb9e00fa5cce04dbad8a`; co-author `Dev Agent <dev@format43.ru>`.

Exact committed paths:

1. `src/core/anthropic-attribution.ts`
2. `tests/unit/anthropic-attribution.test.ts`
3. `tests/unit/anthropic-attribution-lineage.test.ts`
4. `tests/unit/anthropic-attribution-config.test.ts`
5. `tests/unit/anthropic-attribution-forwarding.test.ts`
6. `tests/sdk/anthropic-attribution-lifecycle.test.ts`
7. `tests/fixtures/anthropic-forwarding-loader.ts`
8. `docs/subsystems/anthropic-attribution.md`
9. `docs/operations/configuration.md`

No package metadata, lockfile, generated docs/index/manifest, shared test helper, `TESTING.md`, `TEST_PLAN.md`, or unrelated source was edited.

## Behavioral decisions and implementation

### #14 / PR #17 — lineage recovery (`VERIFIED_LOCAL`)

- Adapted PR17 into a two-pass projection. The first projection checks the latest successful target-model receipt, protected profile, and exact prior wire prefix. Legitimate reconstruction/history/profile drift derives a deterministic `lineage-reset` epoch with `inheritsPrior:false`, clears response chaining, and re-projects before transport.
- Visible old thinking becomes text. Prior-epoch signed and redacted blocks are omitted. Returning to an earlier profile/history causes another reset rather than restoring an old epoch.
- A latest target assistant with a missing or malformed lineage receipt is now itself a deterministic non-inheriting boundary. This closes an additional stale-signature resurrection found while adapting PR17.
- The successful response appends the new epoch only after strict SSE completion. HTTP failure, missing `message_stop`, middleware mutation, and a concurrent continuation cannot establish an anchor.
- Existing protected model/stream route, account/device/session metadata, billing identity, cache topology/limit, lineage profile, concurrency, and strict SSE checks remain active.
- The SDK test uses Pi's real `DefaultResourceLoader`, persistent `SessionManager`, `AgentSession.reload()`, extension shutdown/start rebinding, JSONL reopening with `SessionManager.open()`, and `reason:"resume"`. It removes one persisted earlier thinking block to reproduce reconstructed-history drift, then proves one reset and normal next-turn chaining.

### PR #12 — cross-provider tool linkage (`VERIFIED_LOCAL`)

- Integrated the contributor's invalid `call_x|fc_y` normalization regression.
- It proves the normalized `tool_use.id` remains linked to `tool_result.tool_use_id`, a valid ID remains unchanged, arguments/results survive, and an image block is preserved.
- This was regression coverage for behavior already present in 2.5.0, so its baseline run was green rather than represented as a new defect red.

### #13 — account config path (`VERIFIED_LOCAL` on this POSIX host)

- Added package-owned `PI_ANTHROPIC_ACCOUNT_CONFIG_PATH`.
- Precedence is: explicit `loadClaudeAttributionAccount(path)` argument, then the variable (provider-scoped `options.env` before process environment), then `~/.claude.json`.
- Explicit selections must be non-empty absolute file paths. The selected path is reported for read/JSON errors; `userID` and `oauthAccount.accountUuid` must be non-empty strings.
- No undocumented Claude directory convention or fabricated identity is used.
- Fusion, delegate, and attested child environment constructors were characterized and preserve the path variable. Tests use fake data and do not print account contents.

### #19 — non-target forwarding (`VERIFIED_LOCAL`; official binary gap below)

- Removed `new Function`, eval-style import behavior, and the unexported `@earendil-works/pi-ai/anthropic` subpath.
- Uses the host-exported `@earendil-works/pi-ai/compat` surface and calls `anthropicMessagesApi().streamSimple` directly. It does not call the registered/global `streamSimple` dispatcher, avoiding recursive re-entry into the package override.
- Validates the real host model/context boundary, forwards original provider/options callbacks, and adapts host stream events/results without Anthropic-target attribution rewriting.
- Mock transport proves one request to the non-target endpoint with its API key and custom header, original `minimax` identity, one payload callback, one response callback, and no billing metadata, Claude Code session header, or target endpoint rewrite.

### Type safety baseline item

- Replaced `details as unknown as AnthropicLineageDetails` with field-by-field narrowing and a validated typed object construction.
- Added malformed lineage-receipt coverage.
- Did not alter the shared regex test or the unrelated comment containing the word it falsely detects.

## Red evidence

All commands used isolated `HOME`, `PI_CODING_AGENT_DIR`, and `TMPDIR` under the task root plus `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1`. Logs are retained in `/private/tmp/pi-bg-closeout-iNoltL/reports/attribution-evidence/`.

| Item | Command (focused suffix shown) | Baseline outcome |
|---|---|---|
| #14 synthetic drift | `tsx --test tests/unit/anthropic-attribution-lineage.test.ts` | exit 1; 2/17 passed, 15/17 failed with persistent history/profile divergence before transport (`red-lineage.log`). |
| #14 real Pi reconstruction | `tsx --test --test-concurrency=1 tests/sdk/anthropic-attribution-lifecycle.test.ts` | exit 1; 0/1, exact `message history is not append-only` after JSONL reopen (`red-lifecycle.log`). |
| #14 stale receipt | focused lineage suite after added missing-receipt case | exit 1; 22/23 passed; old `sig-msg_1` and redacted bytes resurfaced (`red-stale-receipt.log`). |
| #13 | `tsx --test tests/unit/anthropic-attribution-config.test.ts` | exit 1; 2/6 passed, 4/6 failed because the variable was ignored and negative selection checks were absent (`red-config.log`). |
| #19 Node | `tsx --test tests/unit/anthropic-attribution-forwarding.test.ts` | exit 1; 0/1, zero fetches and `ERR_PACKAGE_PATH_NOT_EXPORTED` (`red-forward-node.log`). |
| #19 Node fixture | `tsx tests/fixtures/anthropic-forwarding-loader.ts` (initial direct fixture) | exit 1 with the same unexported subpath failure (`red-forward-loader-node.log`). |
| #19 Bun | `bun build --compile ...` then executable | build exit 0; run exit 1 under Bun 1.3.4 because `@earendil-works/pi-ai/anthropic` could not resolve from `/$bunfs/root` (`red-forward-bun-{build,run}.log`). |
| PR #12 | `tsx --test tests/unit/anthropic-attribution.test.ts` | exit 0; 7/7, expected because normalization already shipped (`red-pr12-regression.log`). |

## Green evidence

| Check | Outcome |
|---|---|
| `npm run typecheck` | exit 0 (`green-typecheck.log`). |
| Four focused attribution unit files | exit 0; **41/41 tests**, 4/4 suites (`green-attribution-unit.log`). |
| Real Pi SDK reload/resume lifecycle | exit 0; **1/1** (`green-attribution-lifecycle.log`). |
| Node `DefaultResourceLoader` forwarding fixture | exit 0; loader executed factory, exactly one mocked fetch, provider `minimax` (`green-forward-loader-node.log`). |
| Bun 1.3.4 compiled loader fixture | build exit 0 (2,980 modules, 72,004,688-byte disposable binary); run exit 0 with actual installed Pi `DefaultResourceLoader`, external extension loading, one mocked fetch, provider `minimax`; binary removed (`green-forward-loader-bun-{build,run}.log`). |
| Installed global Pi 0.86.0 Node loader | `pi --no-extensions ... -e <attribution> --list-models`, offline isolated state, exit 0; “No models available” was expected with no credentials (`green-global-pi-086-loader.log`). |
| Focused package attribution test | exit 0; **1/1** (`green-package-attribution.log`). |
| `npm run payload:check` | exit 0; 106 packed files satisfy policy (`green-payload-check.log`). |
| Forbidden pattern scan + `git diff --check` | exit 0; no `new Function`, unexported subpath, eval call, or lineage double assertion (`green-static-and-diff.log`). |
| `git show --check HEAD` | exit 0. |

Total focused automated tests reported above: **43 passed** (41 attribution unit + 1 SDK lifecycle + 1 package test), plus Node/Bun/global-loader executable checks.

## Honest failures / integration dependencies

- `npm run test:type-safety`: exit 1, **1/2 passed**. Its only finding is the known independently owned regex false positive at `src/core/anthropic-attribution.ts:93` on the prose word `any`; the real double assertion is gone. See `type-safety.log`.
- `npm run docs:verify`: exit 1 because generated `docs/commands/claude-cache.md` provenance is stale after source line movement. Per scope, no generated region, `docs/INDEX.md`, `docs/read-before-edit.md`, or `docs/manifest.json` was edited. Integrator must run/reconcile `npm run docs:generate`, then verify. See `docs-verify.log`.
- `TESTING.md` and `TEST_PLAN.md` were explicitly outside this lane; integrator owns any shared coverage-matrix reconciliation.
- No semantic attestation was recorded or self-awarded.
- No default/full package suite, compatibility-install matrix, native Windows run, live model request, or network request was performed.

## Limitations and reviewer focus

- The Bun proof locally compiled the installed Pi 0.84.0 SDK loader and exercised its real compiled `DefaultResourceLoader` virtual-module path. It is stronger than a mocked Bun import, but it is **not** the vendor-distributed Pi single-file binary reported in #19. The available global Pi 0.86.0 executable is a Node script, not a compiled Bun binary. Official-distribution qualification remains an environment gap.
- Declared Pi 0.81–0.84 compatibility installs were not rerun; package peer ranges were intentionally untouched. Review `@earendil-works/pi-ai/compat` / `anthropicMessagesApi()` availability across those exact lines during the integration compatibility lane.
- Native Windows absolute-path behavior was not executed; path validation uses Node's platform-native `isAbsolute`.
- Review the two reset derivations (`lineage-reset` and `untrusted-lineage-reset`), especially old-profile returns and malformed latest receipts.
- Review the non-target host model/context validator and event/result adapter for forward compatibility with newer host message fields.
- Review acceptance of the package-owned variable name and precedence; no external Claude convention was assumed.

## Final state / cleanup

- Owned live subprocesses: **0** (checked after all runs).
- Disposable 72 MB Bun executable: removed.
- Task-owned `/tmp`, `HOME`, and agent scratch under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/attribution`: emptied; **0 B each**. Nothing remains to clean there.
- Small retained evidence logs remain under `/private/tmp/pi-bg-closeout-iNoltL/reports/attribution-evidence/`.
- Worktree status has only the pre-existing untracked read-only `node_modules` symlink. It was not staged, installed into, unlinked, or modified; its target was untouched.
- No pushes, remote operations, tags, releases, GitHub interactions, user/global config changes, live inference, or edits outside the authorized worktree/report/scratch roots occurred.
