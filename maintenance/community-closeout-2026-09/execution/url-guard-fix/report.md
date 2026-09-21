# B0 URL-guard design-correction report

## Result and boundary

All four remaining URL-policy finding classes are corrected and the five package paths remain **unstaged and uncommitted** for independent targeted verification. I used no Git index/history command, commit, additional checkout/worktree/package-tree copy, network/GitHub action, publish, install, paid API, Fusion, or delegated agent. Temporary formatter render files under the owned scratch root were used only for local comparison and removed during cleanup.

Effective route verified before substantive work:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

Named correction base: `3f7665486e1ace62dfbd018493fbe8f07f7116dc`. Entry hashes matched the second-review receipt for that base. A concurrent disjoint Fusion-doc lane was allowed to settle; no Fusion source/doc/test was edited here.

## Architecture choice and complexity change

The design was recorded before package edits in `reports/url-guard-fix/design.md`. The correction has three deliberately bounded layers:

1. **WHATWG classification:** static strings/no-substitution templates use `node:url`'s real `URL` parser. Static template heads are tested with a fixed harmless witness only when the head itself establishes the protocol. This replaces the scheme regex and gets leading C0/space plus TAB/CR/LF preprocessing from the same parser as runtime.
2. **Syntax-wide intrinsic discovery:** a control-flow-independent AST pass finds self-contained file-URL pathname accesses/destructuring. Thus an explicit direct hazard cannot disappear because a statement path stopped.
3. **Explicit bounded completions:** the provenance walker now carries exactly `normal`, `break(label?)`, `continue(label?)`, `return`, and `throw` states. Switches/labels/loops consume only their own completions; catches receive explicit throw states; `finally` runs over every incoming completion and either resumes or overrides it. Logical `&&`, `||`, and `??` scan only statically feasible right sides.

This is not another set of incident regexes. The helper grew from 1,097 lines / 37,961 bytes to 1,398 lines / 47,990 bytes (**+301 lines / +10,029 bytes**) because the ambiguous Boolean completion was replaced with a typed five-state algebra and an independent syntax pass. Conceptual branching is now keyed by completion kind/label rather than ad hoc `continues` exceptions; loops still use the existing finite eight-pass cap. Tests grew from 1,974 lines / 78,469 bytes to 2,380 lines / 92,709 bytes to carry paired completion, parser, short-circuit, for-of, and shadowing matrices.

## Finding-by-finding correction

### HIGH BR2-R1 — abrupt completion, catch/finally, and short-circuit feasibility

- A block-nested switch `break` is retained and consumed by the switch rather than discarded.
- Ordinary/labeled break and continue are distinct from return and throw.
- Catch input comes from explicit throw completions, preserving assignments made before the throw.
- `finally` is scanned for normal, break, continue, return, and throw input; a normal finally resumes the prior completion with its new state.
- Direct self-contained hazards are found syntax-wide even if provenance flow terminates.
- Static `false &&`, `true ||`, and non-nullish `??` skip the right side; `true &&`, `false ||`, and nullish `??` evaluate it.

Permanent controls pair file and HTTP outcomes across normal completion, nested/labelled break, ordinary/labelled continue, return, caught/uncaught throw, and finally after normal/break/continue/return/throw.

### BR1-R1 — WHATWG preprocessing and absolute-first behavior

- Static classification now invokes the WHATWG parser rather than approximating schemes with a regex.
- Permanent cases cover leading NUL/unit-separator/space, embedded TAB/CR/LF normalization, and static-head templates for both file and HTTPS.
- URL-object/static-absolute first alternatives still override bases.
- A dynamic scheme remains unknown; a union containing an observed static file alternative retains that file provenance even with an HTTPS base.

### BR3-R1 — for-of destructuring

- `for...of` computes a bounded element value for direct static arrays and applies it to object assignment/declaration patterns before scanning the body.
- File assignment and declaration destructuring report; HTTPS controls and a shadowed local `URL` constructor stay clean.

### Shadowed `globalThis.URL`

- `globalThis` is accepted only when its compiler symbol is the declaration-free intrinsic binding used by this no-lib source program.
- Parameter and local declarations are rejected as built-in provenance, while an actual `globalThis.URL('file:...').pathname` remains a positive control.

## Red/green evidence

All commands used task-owned roots plus:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

### Red first

| Command | Exit | Observation |
|---|---:|---|
| `tsx reports/baseline-review-2/source-guard-regression-probe.ts` (exact reviewer probe, unchanged) | 0 | The probe's defect assertions reproduced `[]`, `[1]`, `[]`, `[]`, `[]`, `[3]`, `[2]`, `[]` while runtime observed file/HTTPS truth. Exit 0 means the unsafe observations were reproduced. See `red-reviewer-regression-probe.log`. |
| Strict `tsc --noEmit --strict ... --allowUnreachableCode false source-guard-regression-fixtures.ts` | 0 | Every reported example was valid strict TypeScript. See `red-reviewer-regression-typecheck.log`. |
| Four new permanent test names against the old helper | 1 | 0/4 passed: WHATWG file cases returned `[]`; nested switch break returned `[]`; skipped short-circuit poisoned the HTTP read; for-of returned only the erroneous built-in-global line. See `red-permanent-url-controls.log`. |

### Green and systematic controls

| Command | Exit | Result |
|---|---:|---|
| Adapted exact reviewer probe, `reviewer-regression-green-probe.ts` | 0 | Corrected observations: `[1]`, `[]`, `[10]`, `[6]`, `[3]`, `[]`, `[]`, `[2]`; runtime truth unchanged. `green-reviewer-regression-probe.log`. |
| Prior correction probe, `source-guard-fixed-probe.ts` | 0 | All BR1–BR4 exact prior positives/negatives remain accepted. `green-prior-reviewer-probe.log`. |
| Focused package URL fixtures (`file URL pathname guard|file URL guard`) | 0 | 8/8 pass, including all prior controls and four systematic new tests. `green-focused-url-fixtures.log`. |
| Current full-tree URL scan (`converts file URLs to native paths`) | 0 | 1/1 pass over `src`, `extensions`, `scripts`, and `tests`. `green-full-tree-url-scan.log`. |
| Systematic strict fixture scanner + runtime probe | 0 | Ten expected file findings; paired runtime file/HTTPS outcomes for preprocessing, nested/labeled break, ordinary/labeled continue, catch, finally after return/break/continue, short circuit, for-of, and shadowed global. `systematic-url-fixtures-probe.log`. |
| Strict compile of systematic fixture | 0 | `--strict --allowUnreachableCode false` passes. `systematic-url-fixtures-typecheck.log`. |
| Strict compile of original reviewer fixture | 0 | Pass. `green-reviewer-regression-typecheck.log`. |
| Accepted direct-assertion fixture | 0 | 1/1 pass; BR4 behavior preserved. `green-accepted-type-fixture.log`. |
| Project `tsc --noEmit --project tsconfig.json` | 0 | Final integrated live tree passes. `typecheck.log`. |
| Owned-path whitespace/conflict check | 0 | Pass; no repository-root tarball. `static-check.log`. |

A preliminary project typecheck while the disjoint Fusion-doc writer was still active exited 2 only at `tests/package/fusion-model-roles-docs.test.ts:144:15` (`TS2532`, possibly undefined). No URL-owned path was cited; that worker subsequently settled the file, and the final typecheck above is exit 0. I did not edit it.

An optional focused ESLint run exited 1 on eight pre-existing/out-of-slice findings (`typescript-source-guards.ts:212,213,768`; `package.test.ts:198,251,301,329,1001`). None is in a newly added block; no broad lint cleanup was made. Receipt: `focused-eslint.log`.

The accepted isolated npm proof was intentionally not rerun: BR5 code was untouched and the brief prohibited reopening the expensive proof. No full/default package suite or generated-doc gate was run; verification stayed on the requested URL/type fixtures, full-tree URL scan, and project typecheck, and generated docs/manifest remain integrator-owned.

## Exact package changes and hashes

Only these package paths changed:

| Path | Entry SHA-256 (`3f76654` receipt) | Final SHA-256 |
|---|---|---|
| `tests/helpers/typescript-source-guards.ts` | `c9c90d11ce5fd21989b6d20f24e1944db0baf2f94b9aecb5015beb2c910695b9` | `5fee44fc1f45e90929d4c02e4485742a1d64c7daa5a23a0a08b83114f0c3812e` |
| `tests/package/package.test.ts` | `e18a398241364d6f404753ed9bc4dac0f7252605ecd5a73da1e2dc88321e140d` | `f1f4aba85fd8c7f3a583cc9170eb77cb8dd4c754e2066205a4067c5d888d1f2d` |
| `docs/operations/testing.md` | `11dd6f7dca285c096f6763745273b9c7495ca11f10fe4c9fdfec29e4ced641fe` | `e139d5897b4830bd0104aed4a40928ea35004849142cbb773fbf1b470bc43b38` |
| `TESTING.md` | `85aeb814a0dfbecebfe898ac58bc9b7f401efd3e0c452e8a74d194d5de2583a7` | `f6d8c05462d06406da31cb2158b52f793e4bc60a6c56f4f08bfb3d5b6119e61a` |
| `TEST_PLAN.md` | `4d7338c73d492952c77667d766438a2d5d24647f8a2cdb1ca7e101ad639a4db5` | `f513de4776002f8e7cba582a715518c923ca2d735ad56acd5677bdb04cb4badf` |

Receipt: `final-sha256.txt`. No production, generated docs/index/manifest, package manifest/lock, maintenance state, Fusion path, launcher, or other test path was edited.

### Accepted BR4/BR5 paths unchanged

| Path | Entry and final SHA-256 |
|---|---|
| `tests/helpers/offline-npm-registry.ts` | `97ef95ed3cbd6f1d5839eb1a3866bb76c5606df07f1b2d71ee7adbf5d4fa66b2` |
| `tests/package/type-safety.test.ts` | `13e48b97a5efe06a0fe8850a2231c8855572a0027d0ca731e77cfeeee91a0022` |

The type-safety logic in the shared helper was not changed; its only top-level change is the `node:url` import consumed by the URL classifier, with all remaining edits in URL provenance. Exact accepted-path hash comparison is in `accepted-paths-proof.log`.

## Explicit analysis limits

- The syntax-wide layer deliberately reports only self-contained compiler-resolved file hazards; it does not chase arbitrary aliases and is conservative irrespective runtime reachability.
- Flow provenance remains a finite source-policy analysis. It does not execute calls, infer implicit call/getter exceptions, perform interprocedural or later-closure analysis, or model heap mutation, proxies, and arbitrary runtime strings.
- Catch-state precision covers explicit `throw` completions. Potential implicit exceptions from calls remain outside the model.
- A dynamic template whose static head does not establish a protocol remains unknown. Unknown is neither inferred from a base nor treated as proof of file provenance; an explicitly observed file alternative is never discarded.
- Loop convergence remains capped at eight passes over a finite bit lattice.
- `tsc` remains the parse/type gate. Both original and systematic report fixtures pass strict compilation; malformed or type-invalid source is not waived by this guard.
- Runtime checks used Node 24.16.0 on macOS arm64. They validate WHATWG/file-URL semantics, not native Windows certification.

## Cleanup and handoff

- Peak owned scratch observed: 6,540 KiB, below the 150 MiB limit.
- Final `tmp/url-guard-fix`, `home/url-guard-fix`, and `agent/url-guard-fix`: 0 KiB each.
- `zerochildren: true`: test/npm/registry child processes and mechanical-root process matches are zero. The active Pi worker harness is the reporting process, not a spawned test child. Owned-root open files: zero. Repository-root tarballs: zero.
- Auxiliary worktrees, checkout copies, and package-tree copies: zero created. Transient formatter render files were removed.
- Small design, probes, strict fixtures, hashes, and logs remain only under `reports/url-guard-fix/`.
- Cleanup receipt: `cleanup.log`.

Suggested commit message:

```text
test(package): correct URL guard completion semantics
```

Stop here for independent targeted verification. No outside backlog work was performed.
