# B0 URL-guard design correction

## Verified route, base, and boundary

- Effective worker route observed before substantive work: `openai-codex/gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.
- URL correction base named by the brief: `3f7665486e1ace62dfbd018493fbe8f07f7116dc`. The current checkout may contain a later disjoint Fusion-doc commit; no Git index/history operation will be used.
- Writable package paths are limited to the URL-policy portion of `tests/helpers/typescript-source-guards.ts`, URL fixtures/assertions in `tests/package/package.test.ts`, and B0 URL prose in `docs/operations/testing.md`, `TESTING.md`, and `TEST_PLAN.md`.
- Accepted BR4/BR5 files and behavior are frozen: no edit to `tests/package/type-safety.test.ts`, `tests/helpers/offline-npm-registry.ts`, or npm/type policy prose.
- Commands use the owned `tmp/home/agent/url-guard-fix` roots, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, and `GIT_ALLOW_PROTOCOL=file`.

## Red reproduction before source edits

The exact second-review probe was run unchanged:

```text
node_modules/.bin/tsx reports/baseline-review-2/source-guard-regression-probe.ts
exit 0
```

Its assertions reproduced all unsafe scanner observations: leading-preprocessed file `[]`, leading-preprocessed HTTPS `[1]`, block-nested switch break `[]`, assignment-before-caught-throw `[]`, reachable finally after return `[]`, statically skipped `false &&` write `[3]`, shadowed `globalThis` `[2]`, and for-of destructuring `[]`. Its runtime controls observed `file:`, `https:`, `file:`, `file:`, `file:`, `https:`, the fake pathname, and the actual file pathname respectively. The strict fixture compile also exited 0 with `--strict --allowUnreachableCode false`. Logs: `red-reviewer-regression-probe.log` and `red-reviewer-regression-typecheck.log`.

## Chosen minimal architecture

This correction will not add URL regex exceptions. It separates three responsibilities and gives the already-supported flow subset an explicit completion model.

### 1. WHATWG-backed static input classification

Static string literals/no-substitution templates will be classified by the platform WHATWG `URL` parser. This gives the guard the same leading C0/space preprocessing and TAB/CR/LF removal behavior as runtime URL construction. Template expressions will be classified as absolute only when their static head establishes a protocol under the same parser with a harmless fixed witness; otherwise they remain unknown, not guessed relative and not fabricated from a base. URL-object and statically absolute first alternatives continue to override the base.

### 2. Syntax-wide intrinsic hazard discovery

A small AST-wide pass will inspect every pathname extraction whose file provenance is self-contained at that syntax site (for example direct `new URL('file:...').pathname` and direct destructuring). It does not interpret control flow or chase aliases. This pass is deliberately independent of statement completion, so an explicit direct file hazard in a reachable `finally`—or elsewhere in syntax the bounded walker does not reach—cannot disappear because a flow path stopped. Compiler symbols still decide whether `URL`, including `globalThis.URL`, is actually the built-in binding.

### 3. Bounded provenance with an explicit completion algebra

The ordered provenance pass remains finite but replaces the Boolean `continues` flag with explicit `normal`, `break(label?)`, `continue(label?)`, `return`, and `throw` completions, each carrying its abstract state. Branches merge only like completion kinds/labels.

- Statement lists advance only normal paths and retain abrupt paths.
- Switches consume only their own ordinary breaks; nested blocks therefore cannot erase a live branch.
- Loops consume their own breaks/continues (including a directly associated label) and propagate return/throw/foreign labels.
- Catches start from states attached to explicit throw completions, preserving writes before the throw.
- A finally block runs over every incoming completion; a normally completing finally resumes the prior completion with its updated state, while an abrupt finally replaces it.
- Logical `&&`, `||`, and `??` scan only statically feasible right-hand paths and merge only when feasibility is unknown.

This is a five-kind completion-state model, not a general JavaScript framework. It does not execute calls, infer implicit exceptions, model interprocedural/later-closure effects, mutate heaps/proxies, or prove arbitrary dynamic strings. The value lattice and loop iteration cap remain finite.

## Targeted regressions before helper changes

Permanent tests will first pin red outcomes for:

1. the exact reviewer cases;
2. paired WHATWG preprocessing controls (leading C0/space, embedded TAB/CR/LF normalization, file positives and HTTP(S) negatives, strings and static-head templates);
3. a compact completion matrix: ordinary and labeled break, continue, return, throw-to-catch, and finally after normal/return/throw, with file-positive and definitely-HTTP negative paths;
4. short-circuit pairs for skipped/evaluated `&&`, `||`, and `??` branches;
5. for-of assignment/declaration destructuring over file versus HTTPS arrays and a shadowed constructor;
6. built-in versus parameter/local-shadowed `globalThis.URL`.

All prior package URL positives and negatives remain unchanged and must continue passing.

## Verification and stopping point

After green implementation: run the exact reviewer probe with corrected expectations, the strict fixtures, focused permanent URL tests, the full current-tree URL scan, project typecheck (classifying unrelated live-file failures exactly), and the relevant focused package test file without repeating the accepted expensive npm proof unnecessarily. Record commands/exits, source hashes, line-count/complexity change, unchanged accepted-path hashes, scratch/process cleanup, and analysis limits in `reports/url-guard-fix/report.md`. Leave package changes unstaged and uncommitted for independent targeted verification.
