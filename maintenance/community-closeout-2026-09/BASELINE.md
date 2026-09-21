# Frozen baseline and review findings

## What is proven, and what is not

Production baseline: `14aa4ef382952f073bd4d540f57d6e8e3c2789a2`, version 2.5.0. Review checks used disposable package-only snapshots on macOS with package Pi dependency 0.84.0. Local host Pi is 0.86.0. No paid/live provider requests were used. Native Windows, compiled Bun, and Sol-worker route/auth qualification have not been performed by this baseline preparation.

The 2026-09-19/20 GitHub inventory contained 15 issues and 10 PRs total (11 issues/6 PRs open), 26 stars and 23 forks. All six open PRs' latest CI runs awaited approval (`action_required`). PR #23 had one Copilot `COMMENTED` recommendation, not human approval. New items had no maintainer resolution. All recorded patch assessments are against frozen head SHAs, not future remote changes.

GitHub main and npm latest were both 2.5.0. No releases existed and tags stopped at v0.6.0. No branch protection/rulesets were observed. Do not interact with GitHub to change or refresh any of this under the present authorization.

## Existing main failures

1. `npm run test:type-safety`: one test fails with two findings in `src/core/anthropic-attribution.ts`:
   - Line 83: regex falsely treats the word `any` in a comment as an explicit TypeScript top type.
   - Line 1493: genuine prohibited double assertion, `details as unknown as AnthropicLineageDetails`.
   Preserve safety intent while making type checks semantic and fixing actual unsafe assertions.
2. `tests/package/package.test.ts` file-URL guard: falsely flags `.pathname` in HTTPS origin/path validation. Independently reproduced on baseline with `tsx --test --test-name-pattern='converts file URLs to native paths' tests/package/package.test.ts`. Do not delete the endpoint/path validation or Windows file-URL regression coverage.
3. Offline packed-install test: fresh isolated cache cannot supply production dependency `turndown`; fails `ENOTCACHED`. The test must arrange its offline dependency inputs explicitly, not silently rely on a warm user cache or permit network.
4. Windows delegate SDK fixture: PATH-based fake Pi cannot intercept the manifest-based Windows launch route, producing six SDK failures reported by CI/contributor controls. This has not been rerun on native Windows here; distinguish it from a new PR failure.

Latest observed main CI run was `33832119776`. All six OS×Node default jobs failed at type-safety before deeper gates; two dedicated Windows integration jobs passed. The earlier all-unit 447/447 result was real but did not prove the full gate or lifecycle correctness. Never reuse it as release certification.

## Focused independent PR verification

Typecheck passed in every six patched variants. Docs verification passed for baseline and PRs 17/22/23/25, where run. Full default/full platform suites were not run on every variant.

| Variant | Executed result |
|---|---|
| Baseline | typecheck PASS; docs PASS; type-safety FAIL as above |
| PR #9 | launcher unit 10/10 PASS |
| PR #12 | attribution unit 7/7 PASS |
| PR #17 | combined attribution + lineage 23/23 PASS |
| #17 tests with baseline production code | 2 PASS / 15 FAIL of 17; confirms missing recovery |
| PR #22 | SDK 42/42 PASS; package 47 PASS / 3 FAIL (URL guard, offline install, type-safety—all in unchanged baseline areas) |
| PR #23 | launcher unit 11/11 PASS (mock Windows branch on macOS, not native OS certification) |
| PR #25 | registry unit 32/32 PASS |
| #25 new tests with baseline production code | 0 PASS / 2 FAIL; expected abandonment absent |

Commands, per-command exits and bounded logs are preserved under `evidence/`. The runner's own exit 0 means all requested checks finished, NOT all tests passed. Its first setup attempt failed because host Python lacked `tarfile.extractall(filter=...)`; it ran zero tests. The corrected harness used the system tar command and produced the evidence above. No repository worktree source was modified by this review.

## Source-based assessment

- #17 is the preferred #14 approach: it resets/reprojects signature epochs, not just previous-response IDs. Real session lifecycle coverage remains necessary.
- #25 fixes the demonstrated flood but falsely overloads `terminalPublished` for abandonment and uses an error-message substring. Revise lifecycle state, disposal, bounded retries and delayed gate tests.
- #23 is a strong Windows global-install resolver candidate. Preserve named-package/realpath/bin validation and test errors; do not assume contributor single-case ARM64 evidence qualifies the platform.
- #9 addresses a separate POSIX gap. Its PATH probe lacks executable-permission checking and its host-self route trusts arbitrary JavaScript filenames. Coordinate with #23 rather than applying inconsistent resolver policies.
- #12 contributes useful transport-level invalid/valid tool-ID linkage and image preservation coverage, despite the production normalization already existing.
- #22 defers heavy implementations while keeping schemas/registration immediate. It does not implement feature flags or compiled packaging and has no added cold-first-use regression. Claimed Windows timings are not independently established.

## Independent additional finding for #19

A no-network main-source probe of `streamAnthropicViaBetaMessages` with provider `minimax` / API `anthropic-messages` returned `stopReason: error`, **0 network calls**, and `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@earendil-works/pi-ai/anthropic`.

Thus replacing `new Function(...)` with real `import()` alone is insufficient on the installed dependency. Check actual exported/host-aliased SDK surfaces and compiled virtual-module availability. This is stream forwarding for non-target Anthropic-protocol providers, not a claim that all non-Anthropic `bg_delegate` routes fail.

## Worktree boundary proof

A detached worktree was created with `git -C <package> worktree add --detach <owned-temp>/package-only HEAD`:

- Common Git dir matched the standalone submodule Git dir.
- package.json.name was `pi-background-tasks`.
- 202 tracked files, tree `456a8238476a56771d01f2ab68797750f39f0def`, about 17 MiB without node_modules.
- No parent `orchestrator`, `products`, `knowledge`, or `blocks` directories.
- Worktree clean; ordinary `git worktree remove` succeeded; scratch root removed; package prune dry-run empty.

The remaining initial worktree-list entry looks like the submodule administrative directory on this host. It is not an owned auxiliary worktree and must never be removed.

## Evidence integrity

From this directory: `shasum -a 256 -c evidence/SHA256SUMS`.

The manifest covers frozen snapshots, PR patches, threads, review outputs and environment receipt, not the evolving plan/state files. Log normalization replaces only review/package absolute path roots; outcomes and diagnostics are preserved. There is no semantic self-attestation in this dossier. Local test evidence is not platform certification, GitHub approval, remote closure, or proof against a compromised local machine.
