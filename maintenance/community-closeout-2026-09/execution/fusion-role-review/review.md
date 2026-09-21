# Independent F1 Fusion role review

## Verdict

**CHANGES REQUIRED — one high-severity test defect.** The authored Fusion role documentation is code-grounded and covers issue #15 accurately; however, the committed focused test does not typecheck under the package's strict configuration.

Reviewed commit `0a69a4fbf8a011db0bf761d3026105d7aefd1e16` against `3f7665486e1ace62dfbd018493fbe8f07f7116dc`. The commit delta is exactly the two owned docs and the new package test.

## Finding

### High — committed package test fails the TypeScript gate

- **Location:** `tests/package/fusion-model-roles-docs.test.ts:144:15`
- **Evidence:** `boundedEvaluationErrors` returns `readonly string[]` (`src/core/fusion/evaluation.ts:481-499`). With package option `noUncheckedIndexedAccess: true` (`tsconfig.base.json:12`), `validationErrors[0]` is `string | undefined`, but line 144 dereferences `.length` without narrowing.
- **Reproduction:** the required scratch config extends the package `tsconfig.json`, has an absolute `files` entry containing only this F1 test (with its imports followed normally), and an empty `include`. TypeScript 5.9.3 exits 2 with only:

  ```text
  tests/package/fusion-model-roles-docs.test.ts(144,15): error TS2532: Object is possibly 'undefined'.
  ```

  The worktree and committed test blobs were both `b4e0e58051d20dbfc749b7cb3abd2d1dd7b14658`, so this is the committed F1 test, not concurrent B0 work.
- **Impact:** `tsconfig.json:13` includes `tests/**/*.ts`; therefore `npm run typecheck` (`package.json:51`) and the default test chain that begins with it (`package.json:58`) are deterministically blocked.
- **Minimum fix direction (not applied):** narrow the first element before dereferencing it, for example:

  ```ts
  const firstValidationError = validationErrors[0];
  assert.ok(firstValidationError !== undefined);
  assert.ok(firstValidationError.length <= 500);
  ```

  Then rerun the same scratch typecheck and the focused three tests.

No other finding was identified in the frozen F1 scope.

## Code-grounded semantic assessment

The tests were treated as drift guards, not semantic proof. Independent source inspection supports the prose as follows:

- **Candidate roles and parallelism:** all three slots receive one canonical candidate prompt and one workflow profile policy (`src/core/fusion/prompts.ts:31-39`, `src/core/fusion/workflows.ts:61-129`, `src/core/fusion/orchestrator.ts:980-1067`). They use separate resolved slot routes but are launched as one promise wave and awaited with `Promise.allSettled`. The docs correctly describe identical purpose rather than specialties, fixed per-workflow tools, heuristic diversity, valid duplicate routes, and slowest-successful-candidate wave latency.
- **Blind evaluator and repair:** slots are randomly mapped to A/B/C before the blind payload is built (`src/core/fusion/orchestrator.ts:405-474,806-829`; `src/core/fusion/prompts.ts:299-320`). The evaluator contract excludes provider/model/slot/completion identity and winner/rank fields (`src/core/fusion/prompts.ts:113-160`); the closed validator rejects unknown keys (`src/core/fusion/evaluation.ts:411-458`). Invalid JSON/schema gets one repair containing the original blind input, invalid output, and bounded errors (`src/core/fusion/orchestrator.ts:1070-1129`; `src/core/fusion/evaluation.ts:481-499`). Both attempts use `input.models.evaluator` (`src/core/fusion/orchestrator.ts:1131-1161`). Evaluator and repair tool lists are empty.
- **Merger and validate exception:** the merge payload contains canonical input, all prepared anonymous responses, and validated evaluation (`src/core/fusion/prompts.ts:326-343`; `src/core/fusion/orchestrator.ts:840-875`). The merger is the final no-tool model stage. Reason/investigate/research return its text; `fusion_validate` instead host-renders validated finding accounting after that stage (`src/core/fusion/orchestrator.ts:876-892`; `src/core/fusion/evaluation.ts:735-783`). The existing validation section also retains the narrower fenced-JSON/minority-report normalization caveat.
- **Quality, speed, schema, and context tradeoffs:** each route has independently derived usable input capacity (`src/core/fusion/budget.ts:280-344`). Forecasts reserve three candidate contracts for evaluation, those plus evaluation for merge, and candidate/evaluation/diagnostic contracts for repair (`src/core/fusion/budget.ts:785-860`; limits at `src/core/fusion/output-contract.ts:4-7`). Reservation pressure is warning evidence, while exact rendered prompts are checked before each stage (`src/core/fusion/budget.ts:528-549,1048-1111`). The docs correctly explain candidate outlier latency, sequential evaluator/merger latency, schema reliability, and why nominal strength cannot compensate for inadequate context.
- **Five/six/zero and attempts versus calls:** the ordinary path creates three candidates, one evaluator, and one merger; one schema repair adds the sixth child. Initial budget preflight occurs before child creation (`src/core/fusion/orchestrator.ts:764-794`). A transient pre-creation spawn failure may be retried once (`src/core/fusion/orchestrator.ts:307-313,1231-1264`), while a child can contain multiple provider-result records (`src/core/fusion/pi-child.ts:1516-1555`). The docs accurately distinguish child invocations, launch attempts, completed children, and provider requests.
- **Configuration and channels:** the documented all-`$current` duplicate example exactly matches the five-slot default and passes the closed parser (`src/core/fusion/config.ts:38-45,99-128`). Resolution does not require uniqueness (`src/core/fusion/config.ts:350-370`). The docs explicitly preserve the runtime caveat that `$current` must exist and be available. Frontier admission permits only trusted Anthropic or `openai-codex` subscription OAuth routes and rejects metered frontier channels (`src/core/fusion/config.ts:189-290`). No unavailable fixed model alias was introduced.

## Focused checks

All mechanical checks exported `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` under the assigned review roots plus `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

| Check | Result |
|---|---|
| `tsx --test tests/package/fusion-model-roles-docs.test.ts` | **PASS**, 3/3 |
| Scratch `tsc --project .../config/tsconfig.f1-test.json --pretty false` | **FAIL**, exit 2, TS2532 at committed line 144 |
| Focused docs parser/link probe | **PASS**: 42 governed docs parsed; links, anchors, and reachability valid |
| F1 frontmatter/generated-region comparison against parent | **PASS**: both frontmatters and all owned generated-region bytes unchanged |
| Focused Prettier and ESLint on the new test | **PASS** |
| `git diff --check` on the three-file F1 range | **PASS** |

Logs and the scratch config are under `reports/fusion-role-review/{logs,config,probes}`. Full/default/root suites and full docs verification were intentionally not run.

## Isolation, hashes, and limitations

- Effective route observed: `openai-codex / gpt-5.6-sol / max`.
- No Fusion run, model/provider child, live inference, network request, paid API, installation, user config/auth/session access, semantic stamp, source edit, or commit was performed.
- Before/after SHA-256 inventories cover tracked `docs/**`, `src/**`, `tests/**`, package files, and tsconfigs. The only changed hash was concurrent B0-owned `tests/package/package.test.ts`; the three F1 paths and all cited runtime authority remained byte-identical. F1 scope also remained identical to commit `0a69a4f`.
- Scratch peaked at 12,324 KiB, below 50 MiB. Assigned `tmp`, `home`, and `agent` roots were cleaned to 0 KiB and recreated empty. Process probes found zero processes using those roots before and after cleanup.
- Semantic conclusions are static/code-grounded and limited to the frozen three-file F1 scope; no live Fusion behavior was exercised, as required.
