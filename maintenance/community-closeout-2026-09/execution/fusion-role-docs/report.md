# F1 Fusion role documentation report

This is an implementation/evidence report, not an independent semantic approval.

## Route and commit

- Observed at entry: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.
- Source HEAD: `3f7665486e1ace62dfbd018493fbe8f07f7116dc`.
- Commit: `0a69a4fbf8a011db0bf761d3026105d7aefd1e16` (`docs: explain Fusion model roles`).
- Commit contains exactly:
  - `docs/commands/fusion-models.md`
  - `docs/subsystems/fusion.md`
  - `tests/package/fusion-model-roles-docs.test.ts` (new)
- Existing/concurrent maintenance changes were left unstaged and unmodified.

## Implemented contract

- Candidate 1/2/3 are documented as independent parallel attempts over the same canonical input and fixed workflow policy, not specialties. The guide covers slowest-candidate wave latency, heuristic (not guaranteed) diversity from different routes, and similarity risk with duplicates.
- The blind, no-tool evaluator is documented as consuming canonical input plus anonymous A/B/C responses and producing the closed synthesis plan. Exactly one repair reuses the same evaluator slot/resolved model and receives the original blind input, invalid output, and bounded errors.
- The no-tool merger is documented as consuming canonical input, all candidate responses, and validated evaluation on the final sequential stage. The `fusion_validate` host-rendering exception is stated accurately.
- Quality-first and speed-first advice covers candidate outliers, evaluator schema reliability, merger synthesis, stage context capacity, and fan-in. Frontier routes remain subscription OAuth only; metered APIs are explicitly not a tradeoff option.
- `$current`, duplicates, explicit available registry keys, and 5-child ordinary success / 6-child repaired success / 0-child fatal preflight are distinguished from distinct models, launch attempts, and provider-request counts.
- The user guide links to `#fusion-runtime-limits` and `#budgets-and-output-contracts` rather than inventing knobs.

## Runtime authority reviewed

- Five-slot default, closed config parser, exact three-candidate tuple, and duplicate-permitting resolution: `src/core/fusion/config.ts:38-45`, `99-128`, `350-373`.
- Subscription-route/provider/endpoint/OAuth admission: `src/core/fusion/config.ts:212-290`.
- Fixed candidate tool policies and empty evaluator/merger tool lists: `src/core/fusion/workflows.ts:41-134`.
- Identical-purpose candidate instruction, blind evaluator schema, repair framing, and final synthesis framing: `src/core/fusion/prompts.ts:29-39`, `95-160`.
- Blind, repair, and merge payload builders: `src/core/fusion/prompts.ts:268-343`.
- Candidate parallel wave and `Promise.allSettled`: `src/core/fusion/orchestrator.ts:980-1067`.
- One conditional repair and reuse of `input.models.evaluator`: `src/core/fusion/orchestrator.ts:1070-1177`.
- Merger input/model and sequential launch: `src/core/fusion/orchestrator.ts:840-887`.
- One transient pre-child spawn retry: `src/core/fusion/orchestrator.ts:307-313`, `1220-1278`.
- Closed evaluation validation and bounded repair diagnostics: `src/core/fusion/evaluation.ts:411-503`.
- Per-route capacity, stage fan-in reservations, preflight, and exact rendered-stage checks: `src/core/fusion/budget.ts:280-344`, `785-860`, `1048-1111`.
- Output contracts: candidate 48 KiB, evaluator 64 KiB, merger 64 KiB JSON-rendered UTF-8 bytes; diagnostics 8 KiB: `src/core/fusion/output-contract.ts:3-32` and `src/core/fusion/budget.ts:849-857`.

## Red / green evidence

Every mechanical command used:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/fusion-role-docs
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/fusion-role-docs
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/fusion-role-docs
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
```

No `npx`, installation, provider, or Fusion command was used.

1. RED, before documentation edits:

   ```sh
   ./node_modules/.bin/tsx --test tests/package/fusion-model-roles-docs.test.ts
   ```

   Exit `1`: 3 tests, 1 passed and 2 failed. Named failures were the missing role/tradeoff prose contract and missing `### Valid repeated-route example`. The pure runtime fan-in/schema/tool-policy test already passed, so it was a guard rather than defect evidence. Log: `/private/tmp/pi-bg-closeout-iNoltL/logs/fusion-role-docs/red.log`.

2. GREEN, after documentation edits and final test cleanup:

   ```sh
   ./node_modules/.bin/tsx --test tests/package/fusion-model-roles-docs.test.ts
   ```

   Exit `0`: 3/3 passed. Log: `/private/tmp/pi-bg-closeout-iNoltL/logs/fusion-role-docs/green-focused.log`.

3. Focused docs validation used the repository docs parser/link functions to load frontmatter, verify links/anchors, enumerate generated regions, and byte-compare owned frontmatter/generated regions with `HEAD`. Exit `0`; frontmatter and generated regions were unchanged. Log: `/private/tmp/pi-bg-closeout-iNoltL/logs/fusion-role-docs/docs-check.log`.

4. Final focused static checks:
   - Prettier check on the new TypeScript test: exit `0`.
   - ESLint on the new TypeScript test: exit `0`.
   - `git diff --check` on the three owned paths: exit `0`.
   - Combined log: `/private/tmp/pi-bg-closeout-iNoltL/logs/fusion-role-docs/focused-static-checks.log`.

An earlier exploratory Prettier check across both mixed/generated Markdown files and the initial test exited `1`; no Markdown formatter write was performed because that could alter generated or unrelated authored regions. The test was formatted precisely, and the ownership-aware docs check above is green. Per mission, full/default/root suites and full `docs:verify` were not run; known combined generated provenance was neither regenerated nor hand-patched, and no attestation was recorded.

## Example validation and limits

The test extracts the exact JSON fence under `### Valid repeated-route example`, parses it with production `parseFusionModelConfig`, and compares it with `defaultFusionModelConfig`. It proves this exact closed document is parser-valid and contains one duplicated selection across all five roles:

```json
{
  "schema_version": "pi-background-tasks.fusion-models.v1",
  "candidates": ["$current", "$current", "$current"],
  "evaluator": "$current",
  "merger": "$current"
}
```

This is syntax/schema validation, not route admission: at run time `$current` must exist, be available to child Pi, have positive context/output capacity, and—when frontier-class—use a trusted Anthropic or Codex subscription OAuth route. Explicit-selection guidance intentionally directs users to selector-displayed `provider/model-id` keys rather than fixed aliases that may not exist.

The pure source-contract test additionally verifies A/B/C blind fan-in, repair serialization with bounded errors, rejection of an added `winner` field by the closed evaluator validator, merger fan-in by object identity, and all four workflow candidate/evaluator/merger tool policies. Budget source reserves 3 × 48 KiB upstream candidate output for evaluation; merger reserves 3 × 48 KiB + 64 KiB evaluation; conditional repair reserves those plus 8 KiB diagnostics. Actual rendered prompts are rechecked per stage and route.

## Isolation and cleanup

- Peak task-owned scratch observed: 11,104 KiB, below the 50 MiB cap.
- Final task-owned `tmp`, `home`, and `agent` roots were cleaned and recreated empty (`0 KiB` each).
- Preserved logs were 32 KiB before this report; report/log storage remains bounded.
- Task-owned process probe after tests found `0` processes using the task `tmp/home/agent` roots. No Fusion run artifacts were created, and no live Fusion/model child was launched by the tests.
- No user/global config, auth, or session was read or written; no network, paid API, publish, push, extra checkout, or package install was used.
