# B0 bounded URL base/key follow-up report

## Result

Both independently reviewed URL-policy misses are corrected in one local follow-up commit on primary `main`:

```text
2f03dd218cb9c62eb639b04fd3fe6c35a46040d0
parent 4219d9a9d2ec61eee3334cbb4816fc5c394e559d
tree   ebbb0110dc959806796890d8fc027cc9828aa0f9
test(package): close URL base and key guard gaps
```

The commit contains exactly the five assigned package paths. Unrelated parent-owned `maintenance/community-closeout-2026-09/STATE.md` and untracked maintenance execution directories remain unstaged and untouched. No production, generated docs/index/manifest, type-safety test, offline-npm helper, package manifest/lock, Fusion, launcher, or maintenance-state path is in the commit.

Effective route observed before substantive work:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

All mechanical commands used task-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` plus `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, and `GIT_ALLOW_PROTOCOL=file`.

## Minimal correction

The accepted completion algebra, WHATWG preprocessing, `for...of` handling, and compiler-symbol shadowing model were not redesigned.

1. **Known file base:** a generic unknown first value now retains `URL_UNKNOWN` and, only when a base is explicit, joins the base-derived alternatives because the value may be relative. This preserves uncertainty rather than fabricating a definite protocol. Proven absolute file/non-file strings and URL objects still bypass the base. Static template heads beginning exactly `./` or `../` are definitely relative; other non-absolute dynamic heads stay unknown. The syntax-wide pass continues to classify only self-contained hazards, while state-sensitive unknown/base joins remain in the ordered flow pass; this prevents an empty syntax state from turning a flow-proven HTTPS alias into a file false positive.
2. **Computed intrinsic key:** lowercase `url` for `import.meta['url']` and uppercase `URL` for intrinsic constructor access now have distinct lattice bits. `globalThis.URL`, `globalThis['URL']`, and a flow-traced `const key = 'URL' as const` agree. The existing compiler-symbol check still rejects parameter/local fake `globalThis` objects.

The helper changed from 1,398 lines / 47,990 bytes to 1,424 lines / 48,817 bytes (**+26 lines / +827 bytes**). No completion kind, loop rule, exception rule, or heap/interprocedural feature was added.

## Exact finding red/green evidence

The independent probes were run unchanged before package edits. Exit 0 means each probe's defect assertions reproduced the reviewed miss.

| Finding | Exact red command | Exit and observation | Corrected-expectation command | Exit and observation |
|---|---|---|---|---|
| HIGH known-file-base | `./node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/url-guard-review/probes/module-relative-regression-probe.ts` | 0; unknown inline `[]`, unknown assigned `[]`, relative template `[]`; static relative literal `[1]`; absolute HTTPS literal/template `[]` | `./node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/url-base-key-fix/module-relative-regression-green-probe.ts` | 0; unknown inline `[2]`, assigned `[3]`, relative template `[2]`, static relative `[1]`; both absolute HTTPS controls remain `[]` |
| MEDIUM uppercase computed intrinsic | `./node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/url-guard-review/probes/computed-global-this-regression-probe.ts` | 0; only dot line `[1]`, bracket and const-key alias omitted | `./node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/url-base-key-fix/computed-global-this-regression-green-probe.ts` | 0; dot/literal-bracket/const-key lines `[1,2,4]`; parameter/local bracket shadows remain clean |

The green probe copies differ from the exact reviewer probes only in comments and corrected expected lines. Runtime observations remain unchanged: module-relative values against a file base produce `file:` and `/C:/...`, absolute HTTPS values produce `https:`, and all three intrinsic constructor spellings produce `file:`.

Both exact reviewer fixtures passed strict TypeScript before and after the correction:

```text
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --skipLibCheck --allowUnreachableCode false \
  <module-relative-regression-fixture.ts>                     exit 0

./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --skipLibCheck --allowUnreachableCode false \
  <computed-global-this-regression-fixture.ts>                exit 0
```

Permanent cases were added before the helper change. The focused two-test command exited 1 with 0/2 passing: file-base cases reported only the three already-proven absolute-file lines instead of all nine expected lines, and computed keys reported `[1,6]` instead of `[1,2,4,6]`. The same command then exited 0 with 2/2 passing:

```text
./node_modules/.bin/tsx --test \
  --test-name-pattern='retains explicit bases|distinguishes uppercase constructor' \
  tests/package/package.test.ts
```

Receipts: `red-module-relative-reviewer-probe.log`, `green-module-relative-reviewer-probe.log`, `red-computed-global-this-reviewer-probe.log`, `green-computed-global-this-reviewer-probe.log`, `red-permanent-base-key-cases.log`, and `green-permanent-base-key-cases.log`.

## Bounded paired controls

The permanent and report fixtures cover:

- unknown inline, declaration, and assignment inputs against `import.meta.url`, static file literals/templates, and file URL objects;
- the same unknown inputs against HTTPS literals/objects as clean controls;
- `./` and `../` template heads against file versus HTTPS bases;
- a known-HTTPS/unknown first-value union, reporting with a possible file base and remaining clean with a known HTTPS base;
- proven absolute file and HTTPS first values as literals, static-head templates, and URL objects, all ignoring the opposite-protocol base;
- dot, uppercase literal-bracket, and uppercase const-key intrinsic constructors;
- lowercase const-key `import.meta['url']`, plus non-conflation controls for lowercase `globalThis['url']` and uppercase `import.meta['URL']`;
- parameter- and local-shadowed bracket `globalThis` controls.

`bounded-base-key-fixture.ts` passes strict TypeScript (exit 0). Its scanner probe exits 0 with the exact 12 expected file findings and all HTTPS/shadow/key controls clean. Runtime pairs confirm file/HTTPS outcomes for unknown relative values, both safe template heads, all six absolute-first forms, and all three intrinsic constructor forms. Receipts: `bounded-base-key-fixture-typecheck.log` and `bounded-base-key-probe.log`.

## Preservation and verification

| Command | Exit | Result |
|---|---:|---|
| `./node_modules/.bin/tsx --test --test-name-pattern='file URL pathname guard|file URL guard' tests/package/package.test.ts` | 0 | 10/10 pass: the prior 8 URL fixtures plus 2 new bounded fixtures. The formerly unknown dynamic-template/file-base case is now intentionally a may-file finding. |
| `./node_modules/.bin/tsx --test --test-name-pattern='converts file URLs to native paths' tests/package/package.test.ts` | 0 | Current full scan of `src`, `extensions`, `scripts`, and `tests`: 1/1 pass, no offenders. |
| `./node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/url-guard-review/probes/root-class-controls.ts` | 0 | The unchanged 16-case completion/parser/for-of/global-symbol matrix matches exactly. |
| `./node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/url-guard-fix/systematic-url-fixtures-probe.ts` | 0 | Prior 10 expected findings and paired runtime outcomes unchanged. |
| Strict compile of prior systematic fixture | 0 | Valid with `--strict --allowUnreachableCode false`. |
| Prior `source-guard-fixed-probe.ts` | 0 | Accepted BR1–BR4 outcomes unchanged. |
| Prior `reviewer-regression-green-probe.ts` | 0 | `[1], [], [10], [6], [3], [], [], [2]` unchanged. |
| `./node_modules/.bin/tsc --noEmit --project tsconfig.json` | 0 | Project typecheck passes. |
| Focused accepted direct-assertion type fixture | 0 | 1/1 pass; URL edits did not alter type-safety behavior. |
| Five-path `git diff --check` / staged `git diff --cached --check` | 0 | Clean. |

The pre-B0 guard broadly matched every inline `new URL(...).pathname` and tracked a simple assigned URL binding, including ordinary module-relative conversions, but also produced HTTPS false positives. The corrected bounded guard again catches `new URL(relativeName, import.meta.url).pathname`, its declared/assigned form, and `./`/`../` templates while preserving clean proven-HTTPS literal/template/object cases. This restores the original file-URL safety contract without restoring the blanket regex behavior.

No npm/install proof was rerun, no full/default/release suite or broad lint was run, and generated docs/attestations were neither generated nor stamped. Those exclusions follow the narrow brief and integrator ownership.

## Commit paths and hashes

| Committed path | SHA-256 |
|---|---|
| `tests/helpers/typescript-source-guards.ts` | `0680afe2f34270c68d96a2e75cf11585447966981b47fd758e16b82b52ddbcb1` |
| `tests/package/package.test.ts` | `a47920c8399d778297b6fdc06668845210cf528f67f3e7db0c53caca3a36b46f` |
| `docs/operations/testing.md` | `47a3a7daeeb3204f418c9476885a41c2d49d12fe41ca635076f403028df42522` |
| `TESTING.md` | `92e2beea968e9132519a08a06d8d088aa1ebb9157db7d6dc77c267a6714ccce6` |
| `TEST_PLAN.md` | `aad1c601faebdc3ef0a79e9626a297a49ad8b4a87c7e6a1ae9c03ba9d541dd4a` |

Reviewed helper entry hash was `5fee44fc1f45e90929d4c02e4485742a1d64c7daa5a23a0a08b83114f0c3812e`.

### Accepted behavior hash proof

The frozen files are byte-identical between `f8d74b9`, entry, and committed HEAD:

| Path | SHA-256 |
|---|---|
| `tests/helpers/offline-npm-registry.ts` | `97ef95ed3cbd6f1d5839eb1a3866bb76c5606df07f1b2d71ee7adbf5d4fa66b2` |
| `tests/package/type-safety.test.ts` | `13e48b97a5efe06a0fe8850a2231c8855572a0027d0ca731e77cfeeee91a0022` |
| `package-lock.json` | `65cc9d897c12ccc7f3772ef924c26c16d7874f29efc01c167b863f6bfd49fe82` |

The helper diff starts in the URL lattice at line 230; no type-safety rule logic changed. Receipt: `final-integrity.log`.

## Meaningful remaining limits

- This remains a bounded source-policy analysis, not whole-program JavaScript execution. It does not infer calls, implicit call/getter exceptions, interprocedural or later-closure effects, heap/proxy mutation, or arbitrary runtime string contents.
- Unknown first values gain base provenance only from an explicit analyzed base and retain `URL_UNKNOWN`; an arbitrary dynamic value without observed file provenance is not declared file.
- Syntax-wide analysis remains limited to self-contained static hazards. State-dependent unknown/base inference is flow-sensitive; it is not a claim about dynamically sourced expressions hidden beyond unsupported/unreachable flow.
- Definitely relative dynamic templates are limited to exact cooked heads beginning `./` or `../`; other non-absolute heads remain unknown.
- Computed constructor recognition is limited to exact static `URL` literals/flow-traced aliases on the existing compiler-proven intrinsic object. It does not chase arbitrary object/property aliases.
- The existing finite eight-pass loop cap remains unchanged. Runtime protocol checks used Node 24.16.0 on macOS arm64 and are semantic WHATWG witnesses, not native Windows execution certification.

## Cleanup and handoff

- Peak owned mechanical scratch: 6,564 KiB; retained reports: 128 KiB before this report, below 100 MiB.
- Final `tmp/url-base-key-fix`, `home/url-base-key-fix`, and `agent/url-base-key-fix`: 0 KiB each.
- Non-harness test/npm/registry children: zero. The active Pi OAuth harness chain is the worker itself, not a spawned test child. Repository-root tarballs: zero.
- No network/GitHub action, push/publish, install, paid API, Fusion, delegated agent, additional checkout/worktree, or package-tree copy was used.

Stop here for narrow independent verification.
