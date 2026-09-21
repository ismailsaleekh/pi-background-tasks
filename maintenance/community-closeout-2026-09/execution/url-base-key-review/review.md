# Narrow independent B0 final base/key verification

## Verdict

**PASS — both remaining URL-guard findings are resolved at target `2f03dd218cb9c62eb639b04fd3fe6c35a46040d0`. No concrete finding remains within the assigned bounded contract.**

| Prior finding | Result |
|---|---|
| HIGH — unknown/relative first input lost an observed file base | **PASS** |
| MEDIUM — static computed intrinsic `globalThis['URL']` was missed | **PASS** |

The effective injected route was verified before substantive work as:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

Initial and final `HEAD` were the named target, with tree `ebbb0110dc959806796890d8fc027cc9828aa0f9`. The target changes exactly the five assigned paths and no production path. I made no package/source/doc/test/index/history change, fix, semantic stamp, checkout/worktree/package copy, install, network/GitHub action, push/publish, Fusion run, paid-API call, or delegated-agent call.

## Finding disposition

### 1. Explicit file-base provenance — PASS

The correction is finite and confined to the existing value lattice:

- `tests/helpers/typescript-source-guards.ts:306-318` classifies only dynamic template heads beginning exactly `./` or `../` as definitely relative after preserving the existing WHATWG absolute-head check.
- `tests/helpers/typescript-source-guards.ts:426-458` preserves an unknown first value as `URL_UNKNOWN` and, when an explicit base is present in flow analysis, also joins the analyzed base alternatives. It does not consult the base for proven absolute file/HTTP strings or URL objects.
- `tests/helpers/typescript-source-guards.ts:1043-1090` invokes expression evaluation with unknown/base joining disabled in the syntax-only pass. The ordered flow pass therefore supplies state-dependent base provenance, while a syntax-empty HTTPS alias cannot be turned into a file false positive.

The exact corrected reviewer probe produced:

```text
unknownDirect          [2]
unknownIndirect        [3]
relativeTemplateHead   [2]
staticRelativeLiteral  [1]
absoluteHttpsLiteral   []
absoluteHttpsTemplate  []
```

Its runtime witness produced `file:` and `/C:/workspace/pkg/...` for relative values against a file base, and `https:` for proven absolute HTTPS values.

An independent direct-control probe additionally established:

- unknown inline, declared, and assigned URL values plus `./`/`../` dynamic heads against observed file bases: exact findings `[3,5,8,9,11]`;
- unknown values against flow-proven HTTPS literal/object bases, and flow-proven HTTPS literal/template/object first aliases against `import.meta.url`: `[]`;
- proven absolute file literal/template/object aliases against HTTPS bases: exact findings `[2,5,7]`;
- runtime protocols for all file/HTTPS opposite-base pairs agreed with WHATWG absolute-first behavior.

The worker's bounded fixture was also rerun unchanged: it reported exactly the expected 12 lines `[2,7,13,17,27,45,46,47,54,55,57,59]`, with all paired runtime protocols matching.

### 2. Uppercase constructor key — PASS

The correction gives exact lowercase `url` and uppercase `URL` distinct lattice bits at `tests/helpers/typescript-source-guards.ts:233-241` and sets them independently at `:296-303`. Element access at `:497-520` uses lowercase only for `import.meta['url']` and uppercase only for compiler-proven `globalThis`/`node:url` constructor objects.

The exact corrected reviewer probe reported intrinsic dot, literal-bracket, and flow-traced const-key forms at `[1,2,4]`; parameter- and local-shadowed bracket forms remained absent. Runtime returned `file:` for all three intrinsic spellings.

The independent direct-control probe reported `[1,2,4,6]` for intrinsic dot, uppercase bracket, uppercase const key, and lowercase `import.meta` key. Wrong-case `globalThis['url']`, wrong-case `import.meta['URL']`, parameter-shadowed `globalThis`, and local-shadowed `globalThis` all remained clean (`[]`).

## Executed evidence

Every substantive command used task-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR`, plus:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

`$ROOT` below is `/private/tmp/pi-bg-closeout-iNoltL`.

| Command / evidence | Exit | Observed result |
|---|---:|---|
| `tsx $ROOT/reports/url-base-key-fix/module-relative-regression-green-probe.ts` | 0 | Exact fixed reviewer expectations and runtime file/HTTPS truth matched. |
| `tsx $ROOT/reports/url-base-key-fix/computed-global-this-regression-green-probe.ts` | 0 | `[1,2,4]`; all three runtime protocols `file:`. |
| Strict compile of both original reviewer fixtures | 0 / 0 | Valid TypeScript with `--strict --allowUnreachableCode false`. |
| Independent `direct-base-key-controls.ts` | 0 | Exact file-base, HTTPS-alias, absolute-first, key, shadow, and runtime controls matched. |
| `tsx $ROOT/reports/url-base-key-fix/bounded-base-key-probe.ts` | 0 | Exactly 12 expected findings; 13 runtime protocol witnesses matched. |
| Strict compile of `bounded-base-key-fixture.ts` | 0 | PASS. |
| Focused two new permanent tests | 0 | **2/2 pass, 0 fail**. |
| Permanent URL fixture filter (`file URL pathname guard|file URL guard`) | 0 | **10/10 pass, 0 fail**. |
| Full-tree URL scan (`src`, `extensions`, `scripts`, `tests`) | 0 | **1/1 pass**, no offender. |
| Unchanged `root-class-controls.ts` | 0 | All **16** completion/parser/for-of/global-symbol cases matched exactly. |
| Prior `systematic-url-fixtures-probe.ts` | 0 | Exactly the prior **10** findings and paired runtime outcomes matched. |
| Strict compile of prior systematic fixture | 0 | PASS. |
| Prior `source-guard-fixed-probe.ts` | 0 | Accepted type/URL/flow outcomes unchanged. |
| Prior `reviewer-regression-green-probe.ts` | 0 | `[1], [], [10], [6], [3], [], [], [2]`; runtime controls matched. |
| `tsx --test` focused direct-assertion type fixture | 0 | **1/1 pass**. |
| `tsc --noEmit --project tsconfig.json` | 0 | PASS. |
| Target-only `git diff --check` | 0 | PASS. |

The historical red side of the worker's 0/2 → 2/2 claim cannot be rerun on the fixed target without a prohibited revert/source mutation. I inspected its actual assertion output rather than only checking file presence: against entry helper SHA-256 `5fee44fc1f45e90929d4c02e4485742a1d64c7daa5a23a0a08b83114f0c3812e`, the focused command exited 1 with **0 pass / 2 fail**, observing only `[16,17,19]` instead of the expected nine file-base lines and `[1,6]` instead of `[1,2,4,6]`. I independently reran the same focused command on the target; it exited 0 with **2 pass / 0 fail**. The target delta itself contains the corresponding tests and minimal helper changes.

Logs and the independent probe are retained under `reports/url-base-key-review/{logs,probes}/` in the assigned private root.

## Commit boundary and hashes

```text
parent 4219d9a9d2ec61eee3334cbb4816fc5c394e559d
       tree dd1129b1c51265cee52fb4481c987d85715567bc
target 2f03dd218cb9c62eb639b04fd3fe6c35a46040d0
       tree ebbb0110dc959806796890d8fc027cc9828aa0f9
```

The target commit contains exactly the five paths verified by `git diff-tree`:

```text
TESTING.md
TEST_PLAN.md
docs/operations/testing.md
tests/helpers/typescript-source-guards.ts
tests/package/package.test.ts
```

| Scoped path | Initial SHA-256 | Final SHA-256 |
|---|---|---|
| `tests/helpers/typescript-source-guards.ts` | `0680afe2f34270c68d96a2e75cf11585447966981b47fd758e16b82b52ddbcb1` | same |
| `tests/package/package.test.ts` | `a47920c8399d778297b6fdc06668845210cf528f67f3e7db0c53caca3a36b46f` | same |
| `docs/operations/testing.md` | `47a3a7daeeb3204f418c9476885a41c2d49d12fe41ca635076f403028df42522` | same |
| `TESTING.md` | `92e2beea968e9132519a08a06d8d088aa1ebb9157db7d6dc77c267a6714ccce6` | same |
| `TEST_PLAN.md` | `aad1c601faebdc3ef0a79e9626a297a49ad8b4a87c7e6a1ae9c03ba9d541dd4a` | same |

All five working files matched the named target content both before and after verification. Their scoped worktree diff and the index were empty.

Accepted type/npm bytes were identical at accepted target `f8d74b9`, the target parent, named target, initial working tree, and final working tree:

| Frozen path | SHA-256 |
|---|---|
| `tests/helpers/offline-npm-registry.ts` | `97ef95ed3cbd6f1d5839eb1a3866bb76c5606df07f1b2d71ee7adbf5d4fa66b2` |
| `tests/package/type-safety.test.ts` | `13e48b97a5efe06a0fe8850a2231c8855572a0027d0ca731e77cfeeee91a0022` |
| `package-lock.json` | `65cc9d897c12ccc7f3772ef924c26c16d7874f29efc01c167b863f6bfd49fe82` |

Unrelated parent-owned maintenance state and other agents' untracked execution directories remained outside the scoped paths and were not reviewed, edited, staged, or certified.

## Bounds and exclusions

This PASS is limited to the requested correction and its direct controls. It does not reopen the accepted completion/WHATWG/`for...of`/dot-shadow/type/npm work or claim a general JavaScript interpreter proof.

The documented intentional limits remain:

- calls and implicit call/getter exceptions are not executed or inferred;
- interprocedural and later-closure effects are not modeled;
- heap/proxy mutation and arbitrary runtime string content are not modeled;
- unknown first values without observed file provenance remain unknown rather than findings;
- syntax-wide discovery is for self-contained hazards, while unknown/base joining is ordered-flow evidence;
- the existing eight-pass loop cap remains unchanged;
- Node 24.16.0 on macOS arm64 supplies WHATWG protocol witnesses, not native Windows execution certification.

No full/default/release suite, docs generation/verification/attestation, npm install, packed-consumer proof, or broad lint was run; these were outside the narrow brief, and accepted npm bytes were hash-checked instead.

## Cleanup

- Peak owned retained/scratch usage observed was about 6.8 MiB, below 100 MiB.
- Final task-owned `tmp/url-base-key-review`, `home/url-base-key-review`, and `agent/url-base-key-review` were each 0 KiB.
- No spawned test/npm/registry child remained. Final process inspection found only the active Pi OAuth harness chain for this review, not a spawned verification child.
- Review evidence is confined to `/private/tmp/pi-bg-closeout-iNoltL/reports/url-base-key-review/`.

Stop after this targeted verification; no fixes were made.
