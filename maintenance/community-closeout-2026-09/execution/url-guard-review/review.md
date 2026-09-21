# Targeted independent URL-guard review

## Verdict

**CHANGES REQUESTED — 1 HIGH and 1 MEDIUM remaining finding.**

The typed completion/syntax separation is a substantive correction rather than a relocation of the original abrupt-flow defect. The exact prior probes, all 8 permanent URL fixtures, the 10-finding systematic fixture, an independent 16-case root-class matrix, the current full-tree scan, and project typecheck all pass. WHATWG absolute-first handling, explicit completion propagation, static direct-array `for...of` destructuring, and dot-form `globalThis.URL` symbol shadowing are verified within the documented bounded model.

Two bounded static forms still bypass the Windows file-URL protection:

1. a relative-or-unknown first input with an explicitly observed file base is discarded instead of retained as may-file provenance; and
2. the valid static computed intrinsic constructor `globalThis['URL']` is not recognized, although dot access is.

Effective route was verified before substantive work:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

No fix, source/docs/test/index/history edit, semantic stamp, checkout/worktree/package copy, install, npm proof, network/GitHub action, push/publish, paid API, Fusion run, or delegated agent was used. Review artifacts are confined to `reports/url-guard-review/` under the assigned private root.

## Findings

### HIGH — BR1/module-relative regression — an observed file base is ignored for unknown and safely relative template first inputs

**Files/lines:**

- `tests/helpers/typescript-source-guards.ts:304-309` (`templateValue` maps every non-absolute template head to `VALUE_UNKNOWN`)
- `tests/helpers/typescript-source-guards.ts:419-443` (`newUrlValue`; `VALUE_UNKNOWN` adds only `VALUE_URL_UNKNOWN` and never considers the explicit base)
- missing controls near `tests/package/package.test.ts:1322` and `:1422-1431`
- conflicting policy wording at `docs/operations/testing.md:32`, `TESTING.md:190`, and `TEST_PLAN.md:128`

The absolute-first rule is correct for a value proven to be absolute HTTPS, but it does not follow that an unknown first string is definitely absolute/non-file. In this bounded module-resolution pattern, an explicit `import.meta.url` base is observed file provenance and the unknown input may be relative. A safe static head such as `` `./fixtures/${name}.json` `` is definitely relative regardless of the interpolation.

Current observations:

```ts
function nativePath(relativeName: string): string {
  return new URL(relativeName, import.meta.url).pathname;
} // scanner []

const resolved = new URL(relativeName, import.meta.url);
resolved.pathname; // scanner []

new URL(`./fixtures/${fixtureName}.json`, import.meta.url).pathname; // scanner []

new URL('./fixtures/case.json', import.meta.url).pathname;          // scanner [1]
new URL('https://example.com/request/path', import.meta.url).pathname; // scanner []
new URL(`https://${host}/request/path`, import.meta.url).pathname;     // scanner []
```

Reproduction:

```text
./node_modules/.bin/tsx reports/url-guard-review/probes/module-relative-regression-probe.ts
exit 0 (defect assertions reproduced)
```

Runtime with a known `file:///C:/workspace/pkg/module.ts` base produced:

```text
unknown relative input: file:, /C:/workspace/pkg/child.ts
relative template:       file:, /C:/workspace/pkg/fixtures/case.json
absolute HTTPS literal:  https:
absolute HTTPS template: https:
```

The fixture also passes strict TypeScript with `allowUnreachableCode:false` (exit 0). Thus this is not arbitrary string-content inference: it is the finite may-relative alternative created by a visible file base. Proven absolute HTTPS controls continue to ignore that base.

This is also a concrete preservation regression, not a new requirement invented from prose:

- The pre-B0 package guard at `c0ba665^` matched every inline `new URL(...).pathname` and separately matched an indirect `new URL(...)` binding followed by `.pathname`; both ordinary module-relative forms above were protected (along with unwanted HTTPS false positives).
- At `3f76654`, a nonempty non-scheme template head was classified as `VALUE_STRING_RELATIVE`. The target changed that to unknown, so the safe `./...${...}` template bypass is specifically introduced by `f8d74b9`.
- The unknown identifier form was already lost when the original broad guard was replaced; `f8d74b9` leaves that prior safety regression in place. Calling all unknown strings an exclusion does not preserve the original module-relative contract.

This permits the exact `.pathname` conversion that yields `/C:/...` rather than a Windows native path. Restoring this bounded may-file case does not require interprocedural, call, heap, or arbitrary dynamic-string analysis and does not require restoring the old blanket HTTPS false positives.

Evidence: `module-relative-regression-probe.log`, `module-relative-regression-typecheck.log`, and `history-and-code-evidence.log`.

### MEDIUM — globalThis root-class gap — valid static computed `URL` keys miss the intrinsic constructor

**Files/lines:**

- `tests/helpers/typescript-source-guards.ts:300` marks only lowercase static text `url` as `VALUE_STATIC_URL`
- `tests/helpers/typescript-source-guards.ts:484-493` reuses that lowercase marker when looking up the uppercase constructor property `URL`
- missing controls near `tests/package/package.test.ts:1763-1794`

The symbol correction works for dot access and rejects parameter/local `globalThis` bindings, but the equivalent valid static element access is not recognized:

```ts
new globalThis.URL('file:///C:/work/dot.ts').pathname;        // scanner [1]
new globalThis['URL']('file:///C:/work/bracket.ts').pathname; // scanner []
const constructorKey = 'URL' as const;
new globalThis[constructorKey]('file:///C:/work/key.ts').pathname; // scanner []
```

All three runtime constructors produce `file:`. Parameter- and local-shadowed bracket forms remain clean. The fixture passes strict TypeScript (exit 0), so this is a static key and compiler-bound object—not a dynamic property or heap inference request. The code added a computed `globalThis` branch in this correction, but its key predicate cannot recognize the actual uppercase built-in property.

Reproduction:

```text
./node_modules/.bin/tsx reports/url-guard-review/probes/computed-global-this-regression-probe.ts
exit 0 (only dot line 1 reported; bracket/key runtime protocols both file:)
```

Evidence: `computed-global-this-regression-probe.log` and `computed-global-this-regression-typecheck.log`.

## Root-class disposition

| Requested class | Resolution |
|---|---|
| Explicit normal/break/continue/return/throw, labels, switch, catch/finally, short circuit, syntax-wide direct hazards | **Resolved within the stated explicit-completion model.** `FlowCompletion` retains kind/label/state; switch and loop consumers are scoped; explicit throw state enters catch; `applyFinally` runs on every incoming completion and either resumes it with the final state or replaces it. Independent controls covered a switch break through `finally`, assignment in a thrown expression, normal-finally resumption after break/continue/throw, abrupt-finally override, HTTPS overwrites, negated static short circuits, and a direct hazard after return into `finally`. All matched expected positive/negative lines. |
| WHATWG static string/template preprocessing and absolute-first behavior | **Absolute/preprocessing correction resolved.** Real `node:url` parsing handled leading C0/space and embedded TAB/CR/LF file/HTTPS pairs, and file/HTTPS absolute first values ignored irrelevant bases. **BR1 remains unresolved overall** because safe relative template heads and unknown-may-relative first inputs lose an observed file base (HIGH above). |
| Static `for...of` destructuring assignment/declaration, computed key/provenance, shadowed constructor | **Resolved for the claimed direct static-array boundary.** Independent cases used a compiler-traced `pathname` key, a file/HTTPS conditional URL alias, assignment and declaration patterns, HTTPS controls, and a parameter-shadowed constructor. Expected file lines were reported and controls stayed clean. |
| Intrinsic versus parameter/local `globalThis` through compiler symbols | **Dot form resolved; root class incomplete.** Intrinsic `globalThis.URL` reports while parameter/local dot forms remain clean. Valid static computed intrinsic access still bypasses detection (MEDIUM above). |

The helper is now 1,398 lines / 47,990 bytes versus 1,097 / 37,961 at `3f76654`; the explicit five-kind completion algebra and independent syntax pass demonstrably cure the reviewed abrupt-flow failures. The remaining findings do not justify another general interpreter framework.

## Commands and results

Every substantive command used task-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` plus:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

| Command/evidence | Exit | Result |
|---|---:|---|
| Exact prior corrected probe, `baseline-review-2/source-guard-fixed-probe.ts` | 0 | Original BR1–BR4 expected outcomes remain fixed. |
| Exact second-review probe with corrected expectations, `reviewer-regression-green-probe.ts` | 0 | `[1], [], [10], [6], [3], [], [], [2]`; runtime file/HTTPS/fake outcomes agree. |
| Permanent URL name filter in `tests/package/package.test.ts` | 0 | 8/8 pass. |
| Current full-tree URL scan | 0 | 1/1 pass over `src`, `extensions`, `scripts`, and `tests`. |
| Worker systematic fixture/probe | 0 | Exactly 10 expected findings plus paired runtime file/HTTPS outcomes. |
| Strict compile of systematic fixture | 0 | PASS. |
| Strict compile of original second-review regression fixture | 0 | PASS. |
| Independent root-class controls | 0 | 16 completion/parser/for-of/global-symbol positive and negative cases match. |
| Module-relative regression probe | 0 | Defect reproduced; three missing findings, static-relative positive and absolute-HTTPS negatives pinned. |
| Strict compile of module-relative fixture | 0 | PASS. |
| Computed-globalThis regression probe | 0 | Defect reproduced; dot positive reported, two equivalent computed positives missed. |
| Strict compile of computed-globalThis fixture | 0 | PASS. |
| `tsc --noEmit --project tsconfig.json` | 0 | PASS on target HEAD `f8d74b9`. |
| Target-only `git diff --check` | 0 | PASS. |

Relevant logs and self-contained probes are under `reports/url-guard-review/`. The accepted expensive npm/packed-consumer proof was intentionally not rerun.

## Source identity and frozen bytes

Named comparison base and target:

```text
base   3f7665486e1ace62dfbd018493fbe8f07f7116dc
        tree 11eae1a336ca35e8c01081053e2c60b4357559f7
target f8d74b9c308dabd6a1c7bc8e3a9bf1472feaadf0
        tree b410a3bf5ca006580842dd3263cbf0adf17c4c68
target parent 7628f4d7baf524234b14dbb9e5c7d418525ffe40
        tree f4845da6e71627959829812c2ba89c64e26d4ce2
```

The three intervening commits changed only Fusion docs/tests and launcher paths. The target commit changed exactly the five scoped paths.

| Path | Base SHA-256 (`3f76654`) | Target / initial / final SHA-256 |
|---|---|---|
| `tests/helpers/typescript-source-guards.ts` | `c9c90d11ce5fd21989b6d20f24e1944db0baf2f94b9aecb5015beb2c910695b9` | `5fee44fc1f45e90929d4c02e4485742a1d64c7daa5a23a0a08b83114f0c3812e` |
| `tests/package/package.test.ts` | `e18a398241364d6f404753ed9bc4dac0f7252605ecd5a73da1e2dc88321e140d` | `f1f4aba85fd8c7f3a583cc9170eb77cb8dd4c754e2066205a4067c5d888d1f2d` |
| `docs/operations/testing.md` | `11dd6f7dca285c096f6763745273b9c7495ca11f10fe4c9fdfec29e4ced641fe` | `e139d5897b4830bd0104aed4a40928ea35004849142cbb773fbf1b470bc43b38` |
| `TESTING.md` | `85aeb814a0dfbecebfe898ac58bc9b7f401efd3e0c452e8a74d194d5de2583a7` | `f6d8c05462d06406da31cb2158b52f793e4bc60a6c56f4f08bfb3d5b6119e61a` |
| `TEST_PLAN.md` | `4d7338c73d492952c77667d766438a2d5d24647f8a2cdb1ca7e101ad639a4db5` | `f513de4776002f8e7cba582a715518c923ca2d735ad56acd5677bdb04cb4badf` |

Accepted BR4/BR5 files remained byte-identical throughout:

| Path | Initial/final SHA-256 |
|---|---|
| `tests/helpers/offline-npm-registry.ts` | `97ef95ed3cbd6f1d5839eb1a3866bb76c5606df07f1b2d71ee7adbf5d4fa66b2` |
| `tests/package/type-safety.test.ts` | `13e48b97a5efe06a0fe8850a2231c8855572a0027d0ca731e77cfeeee91a0022` |

Initial HEAD was the target. During finalization, main advanced to disjoint attribution merge `bc25e9a8d8be74bd38899e56bb7ab2266629969c` (tree `291c89a0ef32bb3184644d492d2f225b23ad62b0`). All seven URL/accepted paths still equal their exact `f8d74b9` Git blobs; the concurrent attribution merge is not reviewed or certified here. Receipts: `initial-integrity.log`, `final-integrity.log`, `commit-boundary.log`, and `concurrent-head-boundary.log`.

## Analysis limits and exclusions

- This review does not demand whole-program JavaScript security proof. Calls, implicit call/getter exceptions, interprocedural/later-closure behavior, heap/proxy mutation, and arbitrary runtime string contents remain outside the model.
- The HIGH finding is narrower: unknown first input retains only its possible relative interpretation when a statically observed file base exists; safe `./` template heads are syntactically relative. The HTTPS controls demonstrate absolute-first precedence is preserved.
- The MEDIUM finding uses only a static literal/const property key and the same compiler-resolved `globalThis` symbol already analyzed by dot access.
- Syntax-wide self-contained discovery is intentionally conservative irrespective flow reachability; it does not chase arbitrary aliases. Flow analysis remains finite with an eight-pass loop cap. Static `for...of` evidence here is limited to direct array literals and compiler-traced element values.
- Runtime checks used Node 24.16.0 on macOS arm64. They establish WHATWG/file URL outcomes, not native Windows certification.
- No full/default/release suite, docs generation/verification, strict semantic attestation, or npm install proof was run. Generated-doc staleness and unrelated attribution state were not treated as URL findings.

## Cleanup

- Maximum retained owned scratch observed before cleanup: 4,648 KiB; final reports/probes/logs: 128 KiB, below the 100 MiB limit.
- Final `tmp/url-guard-review`, `home/url-guard-review`, and `agent/url-guard-review`: 0 KiB each.
- Non-harness test/npm/registry children matching the review roots: zero. Owned-root open files: zero. Repository-root tarballs: zero.
- The active Pi OAuth harness is the review process, not a spawned test child.

Stop at this narrow review; no fixes were made.
