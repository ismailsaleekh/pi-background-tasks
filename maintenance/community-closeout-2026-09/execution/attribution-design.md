# Attribution A1+A2 design / red plan

Observed route before work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.

## Decisions

- **#14 / PR17:** adapt PR17 as a two-pass request build. Start with the lane's current epoch, compare the projected request prefix and protected profile to the latest successful lineage, and on legitimate history/profile drift derive a deterministic `lineage-reset` epoch with `inheritsPrior:false`. Re-project before transport so visible thinking remains text and old signed/redacted blocks are absent. Clear response chaining for the reset request. Persist the new epoch only by appending lineage after strict, valid SSE completion; failed/tampered/concurrent requests do not anchor. Returning to an old profile/history is another reset, never authorization to revive an old epoch.
- **PR12:** adopt the contributor's transport regression for invalid cross-provider tool IDs, linked results, a valid ID, and image preservation. Production normalization is already present.
- **#13:** add one package-owned operator variable, `PI_ANTHROPIC_ACCOUNT_CONFIG_PATH`. A non-empty **absolute file path** selected by that variable takes precedence over `~/.claude.json`; when unset, the existing home default remains. A direct loader argument (test/programmatic seam) takes precedence over both. Empty/relative selections, unreadable/invalid JSON, and missing/blank `userID` or `oauthAccount.accountUuid` fail with the selected path/source identified. No Claude-specific directory convention is inferred. Existing child env construction copies this package variable unchanged while continuing to strip metered credentials; tests will pin that inheritance without logging file contents.
- **#19:** statically import the supported `@earendil-works/pi-ai/api/anthropic-messages` adapter and call that adapter directly for non-`anthropic` models. Do not use eval/new-Function, the unexported `/anthropic` path, or the global API registry (which could recurse into this override). Forward the original model/context/options identity and auth semantics unchanged. Prove mocked zero-network forwarding in Node and in a `bun build --compile` fixture; report that this locally compiled fixture is not the upstream distributed Pi binary.
- **Type safety:** replace the lineage-details double assertion with field-by-field validated typed construction. Do not alter the shared regex gate or its unrelated comment false positive.

## Owned files

- Production: `src/core/anthropic-attribution.ts` only unless an attribution-specific companion becomes necessary (the existing attribution owning doc already covers it).
- Tests/fixtures: attribution-specific files under `tests/unit`, `tests/sdk`, and `tests/fixtures`; extend `tests/unit/anthropic-attribution.test.ts` for PR12/config coverage.
- Authored docs: `docs/subsystems/anthropic-attribution.md` and the attribution paragraphs/table in `docs/operations/configuration.md`.
- No generated docs/manifests, shared helpers, package metadata/locks, broad test plans, or unrelated source.

## Red evidence plan

With tests added but baseline production retained, under isolated `HOME`, `PI_CODING_AGENT_DIR`, `TMPDIR`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`:

1. Focus lineage recovery tests: baseline must fail profile/history reconstruction before fetch with the persistent divergence error.
2. Real Pi lifecycle test: create a persistent SDK session through the actual package extension and mocked SSE transport, exercise `AgentSession.reload()`, reopen its JSONL with `SessionManager.open()` for resume, characterize reconstructed messages, and force a persisted-history drift representative of the reported reload loss; baseline must fail while the fixed transport reanchors and chains on the next completed turn.
3. Account path tests: baseline must ignore `PI_ANTHROPIC_ACCOUNT_CONFIG_PATH` and/or accept a relative direct path; fixed code must select the absolute override, reject empty/relative values, validate fields, and show child env inheritance.
4. Non-target forwarding: baseline must return `ERR_PACKAGE_PATH_NOT_EXPORTED` with zero fetches; fixed Node test must reach the supported adapter's mocked fetch exactly once with the non-target provider/base URL/auth untouched. A fixture compiled with installed Bun must do the same.
5. PR12 regression may be green on baseline by design; retain it as coverage rather than claiming defect red evidence.

## Green / guard plan

- Focused attribution unit, lineage, forwarding/config, and SDK lifecycle files with deterministic concurrency/failure/middleware/SSE checks.
- `npm run typecheck`.
- `npm run test:type-safety` (expect only the independently owned comment-regex baseline finding after removing the real double assertion).
- Relevant package/static loader checks, `git diff --check`, and docs verification; generated-doc freshness failures will be reported for integrator reconciliation rather than hand-edited.
- Bun 1.3.4 compile/run where available; retain bounded logs and delete compiled binaries afterward.
- No live provider calls, real user config/session access, npm install, full monorepo suites, or network.
