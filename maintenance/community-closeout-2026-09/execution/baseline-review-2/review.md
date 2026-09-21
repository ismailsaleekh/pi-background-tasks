# Targeted independent B0 correction review

## Verdict

**CHANGES REQUESTED.** The correction fixes the five exact reproductions from the first review, and BR-4/BR-5 are resolved within their stated boundaries. However, the replacement URL source-policy interpreter has **1 high and 3 medium** remaining defects in forms that the corrected docs explicitly claim to support. These findings use only static literals, compiler-bound locals, ordinary control flow, and direct destructuring; none relies on calls, interprocedural/later-closure effects, arbitrary dynamic strings, proxies, or heap mutation.

Effective route was verified before substantive work:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

No source fix, docs attestation, index operation, commit, checkout/worktree/copy, GitHub or external-network action, publish, agent, Fusion run, or paid API was performed by this review. The parent mechanically committed the frozen seven bytes during review as `3f7665486e1ace62dfbd018493fbe8f07f7116dc`; the commit bytes and final working bytes still match the correction receipt exactly.

## Findings

### HIGH — BR2-R1 — Abrupt control flow drops reachable file provenance and even skips reachable `finally` code

**Files/lines:**

- `tests/helpers/typescript-source-guards.ts:911-928` (`scanSwitchPath`)
- `tests/helpers/typescript-source-guards.ts:969-972` (return/throw collapse to `continues:false`)
- `tests/helpers/typescript-source-guards.ts:1022-1045` (switch/try/catch/finally joins)
- related logical-feasibility error at `tests/helpers/typescript-source-guards.ts:719-732`
- missing controls near `tests/package/package.test.ts:1394-1466`

`FlowResult.continues` conflates `break`, `continue`, `return`, and `throw`. A direct switch `break` is special-cased, but the same break inside a block is returned as non-continuing and discarded by `continuingFlow`. A catch starts from the pre-try state instead of retaining a value assigned before a known throw. Most directly, `finally` is scanned only when the try/catch result continues, although JavaScript always runs `finally` after return/throw.

The executable probe records three false negatives:

```ts
// Scanner []; runtime file:
let target = 'file:///C:/work/file.ts';
switch (mode) {
  case 'keep': { break; }
  default: target = 'https://example.com/request/path';
}
new URL(target).pathname;

// Scanner []; runtime file:
let target = 'https://example.com/request/path';
try {
  target = 'file:///C:/work/file.ts';
  throw new Error('caught');
} catch {}
new URL(target).pathname;

// Scanner []; the direct file pathname access runs at runtime:
function inspect(): void {
  try { return; } finally {
    new URL('file:///C:/work/file.ts').pathname;
  }
}
```

The same probe also records the opposite feasibility error: `false && (target = 'file:///...')` is merged as live, so a subsequent definitely-HTTPS read is reported at line 3 even though runtime remains `https:`.

Reproduction:

```text
node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/baseline-review-2/source-guard-regression-probe.ts
exit 0; assertions pin scanner observations []/[]/[]/[3] and runtime file:/file:/file:/https:

node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext \
  --moduleResolution Bundler --skipLibCheck --allowUnreachableCode false \
  /private/tmp/pi-bg-closeout-iNoltL/reports/baseline-review-2/source-guard-regression-fixtures.ts
exit 0
```

This is inside the claimed bounded flow domain: the implementation explicitly scans switches, try/catch/finally, logical expressions, and function bodies. It is not a request for whole-program JavaScript analysis. The direct `finally` form also regresses the broad syntax traversal's basic safeguard: an explicit `new URL('file:...').pathname` can now be skipped entirely.

### MEDIUM — BR1-R1 — Static absolute strings disagree with WHATWG preprocessing when they have leading ASCII whitespace

**Files/lines:** `tests/helpers/typescript-source-guards.ts:263-283`; missing controls near `tests/package/package.test.ts:1367-1392`; overclaim in `docs/operations/testing.md:31`, `TESTING.md:187`, and `TEST_PLAN.md:128`.

The static string/template classifier anchors its scheme regex at the first source character. WHATWG URL parsing strips leading ASCII whitespace before parsing. Consequently, the base is incorrectly applied to an already-absolute static first argument:

```text
source:  new URL(' file:///C:/work/file.ts', 'https://example.com/base').pathname
scanner: []
runtime: file:

source:  new URL(' https://example.com/request/path', import.meta.url).pathname
scanner: [1]
runtime: https:
```

Reproduction is the same `source-guard-regression-probe.ts` command above. These are fixed string literals, not arbitrary runtime strings. This narrowly contradicts the corrected claim that statically absolute first arguments follow WHATWG absolute-first semantics.

### MEDIUM — BR3-R1 — A real `for...of` destructuring assignment still bypasses pathname detection

**Files/lines:** `tests/helpers/typescript-source-guards.ts:1009-1019`; coverage gap near `tests/package/package.test.ts:1469-1498`; overclaim in `docs/operations/testing.md:31`, `TESTING.md:187`, and `TEST_PLAN.md:128`.

The ordinary `=` object assignment path calls `scanObjectAssignment`, but the implemented `for...of` path merely scans the iterable and invalidates the assignment target. It never checks the object assignment pattern against the statically known URL value:

```ts
let pathname: string;
for ({ pathname } of [new URL('file:///C:/work/file.ts')]) {
  break;
}
```

The scanner returns `[]`; runtime assigns `'/C:/work/file.ts'`. The fixture typechecks with strict TypeScript and `allowUnreachableCode:false` (exit 0). This is a compiler-represented destructuring assignment in a loop form the bounded interpreter already handles, so it is within the unqualified “declaration/assignment destructuring” claim.

### MEDIUM — BR1 negative-control regression — Shadowed `globalThis.URL` is treated as the real constructor by identifier text

**Files/lines:** `tests/helpers/typescript-source-guards.ts:423-430`; missing control near `tests/package/package.test.ts:1487-1497`; overclaim in `docs/operations/testing.md:31` / `TESTING.md:187` / `TEST_PLAN.md:128` that shadowed constructors remain clean.

Unlike direct `URL` identifiers, the `globalThis.URL` branch does not consult the bound symbol for `globalThis`; it accepts the raw identifier spelling. A parameter can legally shadow it:

```ts
function local(globalThis: {
  URL: new (value: string) => { pathname: string };
}): string {
  return new globalThis.URL('file:///C:/not-a-url').pathname;
}
```

The scanner reports line 2. Runtime with a local fake constructor returns `not-a-native-path`, and the fixture typechecks cleanly. This is a false positive in a stated negative control, not heap/proxy reasoning.

## Prior finding disposition

| Prior finding | Disposition |
|---|---|
| BR-1 absolute-first URL object / `import.meta.url` / static-scheme template | **Exact original cases resolved.** Adjusted reviewer probe gets file lines `[2]`, `[1]`, `[2]` and clean HTTPS object/template results. **Not fully resolved** because of BR1-R1 and the shadowed-`globalThis` negative control above. |
| BR-2 use-site ordering, branch joins, overwrite | **Exact original cases resolved.** Earlier file reads survive later HTTPS writes; later file writes do not poison earlier HTTPS reads; may-file `if` joins report; definite HTTPS overwrite clears provenance. **Not resolved overall** because abrupt completion and logical feasibility remain unsound (HIGH BR2-R1). |
| BR-3 destructuring assignments / static computed pathname aliases | **Exact original cases resolved.** Ordinary object assignment and static computed key both report. **Not resolved overall** because `for...of` assignment destructuring bypasses the guard. |
| BR-4 `satisfies`-transparent direct assertions | **Resolved.** The exact wrapper returns one `double assertion`; nested wrappers pass permanent controls. Identifier-separated and validated-`unknown` boundaries remain intentionally outside this direct syntax rule, with no whole-program claim. |
| BR-5 npm user/global/project isolation, Git protocol, real closure/offline load | **Resolved on this host.** Explicit owned user/global configs, empty project configs, `GIT_ALLOW_PROTOCOL=file`, absolute pack/install inputs, real Turndown/Domino closure, closed-server `--offline` install, and real conversion all passed. |

## Commands and exits

Every test command used:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/baseline-review-2
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/baseline-review-2
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/baseline-review-2
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

Filesystem operands passed to npm in the package test and independent probe were absolute. Tarballs were created only below the owned scratch root.

| Command | Exit | Result |
|---|---:|---|
| environment/route receipt | 0 | `openai-codex/gpt-5.6-sol`, `max` |
| focused permanent BR1–BR5 name filter across `type-safety.test.ts` + `package.test.ts` | 0 | 5/5 pass |
| adjusted original reviewer probe, `source-guard-fixed-probe.ts` | 0 | all exact corrected expectations pass |
| adversarial finite-flow probe, `source-guard-regression-probe.ts` | 0 | assertions reproduce all four remaining findings and runtime truth |
| strict compile of adversarial fixtures | 0 | valid TypeScript; no preceding-`tsc` escape hatch |
| current full source-policy scans (file URL + type escape + production non-null) | 1 | 2/3 pass; only failure is the known genuine unowned `src/core/anthropic-attribution.ts:1493` double assertion |
| focused local packed-consumer test | 0 | 1/1 pass |
| independent offline install probe, first attempt | 1 | reviewer-harness-only assertion expected a trailing slash from `npm config get registry`; install/load had completed; assertion corrected without source changes |
| independent offline install probe, corrected | 0 | empty-cache `ENOTCACHED`; four loopback 200s; closed-server offline install/load pass |
| package project typecheck | 2 | unowned current-tree `tests/package/fusion-model-roles-docs.test.ts:143:15 TS2532`; no reviewed B0 path cited |
| `git diff --check` on seven reviewed paths | 0 | pass |
| final expected hash / HEAD-byte / working-byte comparison | 0 | all seven match |

Relevant logs/repros are all under `reports/baseline-review-2/`:

- `focused-five.log`
- `source-guard-fixed-probe.{ts,log}`
- `source-guard-regression-probe.{ts,log}`
- `source-guard-regression-fixtures.ts` and `source-guard-regression-typecheck.log`
- `full-source-scan.log`
- `offline-install-focused.log`
- `offline-install-probe.mts`, `offline-install-probe-attempt1.log`, and `offline-install-probe.log`
- `typecheck.log`
- `initial-source-hashes.log`, `final-source-hashes.log`, and `cleanup.log`

### Independent offline result

The final independent probe used npm `11.13.0` and recorded:

```text
empty-cache negative: exit 1, ENOTCACHED for turndown
closure: @mixmark-io/domino@2.2.0, turndown@7.2.4
loopback requests: /turndown, /@mixmark-io/domino, and both exact tarballs; all 200
registry closed before final install: true
final install --offline: exit 0
real require/conversion: exit 0; "Offline ... closure loaded"
GIT_ALLOW_PROTOCOL: file
scratch before finally cleanup: 32,272 KiB
```

The effective user/global config paths were inside the task-owned install root. The permanent no-request config control separately demonstrated hostile scoped global and project precedence, then proved it absent from the isolated environment. No hostile request was sent. All observed HTTP was to the owned `127.0.0.1` registry; the server was closed before the final offline install.

## Source identity and byte freeze

Correction base:

```text
c0ba66543c67a468a67a859b7ff2d267d48b2e26
base tree 53004f0129109869082a671750fbad13c8ccc3e5
```

The correction receipt `reports/baseline-fix/source-hashes.txt` itself hashes to `89efb27c5b159c59db3e0612232c5050933a0b64c073e297de22e65010ab95d8`, matching its report.

At the initial hash check, HEAD was the independently advanced launcher commit `8550a1a61ef7a9915d7c3a372b342451b80c806b` (tree `c261c1b8e8f3c1cdd56505ca357c3a9618d33a59`) and all seven paths were unstaged. During review the parent mechanically committed those exact bytes. Introducing source reference:

```text
commit 3f7665486e1ace62dfbd018493fbe8f07f7116dc
tree   11eae1a336ca35e8c01081053e2c60b4357559f7
subject test(package): harden source guards and npm isolation
```

After report drafting, HEAD independently advanced again to `0a69a4fbf8a011db0bf761d3026105d7aefd1e16` (tree `b99d65ea529a39bfc9cb151995a722a9d2e4f616`, `docs: explain Fusion model roles`). A post-report check found all seven paths clean with the same hashes; that disjoint commit is not certified here.

| Reviewed path | Git blob at final commit | Initial and final SHA-256 |
|---|---|---|
| `tests/helpers/typescript-source-guards.ts` | `ab6c1f8c2b69aed272c177e6e470e66b151cace7` | `c9c90d11ce5fd21989b6d20f24e1944db0baf2f94b9aecb5015beb2c910695b9` |
| `tests/helpers/offline-npm-registry.ts` | `1cedb672bd319fe4f31052a8ff211705e638348a` | `97ef95ed3cbd6f1d5839eb1a3866bb76c5606df07f1b2d71ee7adbf5d4fa66b2` |
| `tests/package/type-safety.test.ts` | `a1624faff55ed1440b0b3fc59f184d6c71d88a18` | `13e48b97a5efe06a0fe8850a2231c8855572a0027d0ca731e77cfeeee91a0022` |
| `tests/package/package.test.ts` | `a75d459ff696bd6254bec78bd362be7faa59a642` | `e18a398241364d6f404753ed9bc4dac0f7252605ecd5a73da1e2dc88321e140d` |
| `docs/operations/testing.md` | `a10b5c2c2b6398440dc8d78372018dcc9ea4cf28` | `11dd6f7dca285c096f6763745273b9c7495ca11f10fe4c9fdfec29e4ced641fe` |
| `TESTING.md` | `aecda50dc9575a52c94d8ae5d2c3a1501c648012` | `85aeb814a0dfbecebfe898ac58bc9b7f401efd3e0c452e8a74d194d5de2583a7` |
| `TEST_PLAN.md` | `77961a7330ee72027285b9087f3196ca663aa370` | `4d7338c73d492952c77667d766438a2d5d24647f8a2cdb1ca7e101ad639a4db5` |

Final working bytes equal final commit bytes, and all seven paths are clean. Other concurrent files/history were not reviewed or certified.

## Limits, exclusions, and cleanup

- Review host: macOS 15.7.3 arm64, Node 24.16.0, npm 11.13.0, TypeScript 5.9.3. No native Windows or other npm-version certification is claimed.
- I did not demand arbitrary dynamic-string, call, interprocedural/later-closure, heap, or proxy inference. The remaining repros are finite static forms handled or claimed by this scanner.
- No full/default/release suite was rerun. The focused package controls, full source scans, and real offline consumer path were selected as requested.
- Docs verification was not rerun: the known generated `docs/reference/runtime-contracts.md` staleness follows the disjoint launcher source change and is integrator-owned, not treated as a B0 defect. No semantic receipt was created.
- The known attribution double assertion remains genuinely red on this main state. The separate project typecheck failure in `fusion-model-roles-docs.test.ts` came from the concurrently evolving docs lane (later committed as `0a69a4f`) and is outside the seven reviewed paths. Neither was waived or reported as a B0 pass.
- Maximum measured independent fixture scratch was 32,272 KiB, below 100 MiB. Final task-owned `tmp`, `home`, and `agent` roots are 0 KiB each.
- Final repository-root tarballs: zero. Owned npm/Node/test/registry processes: zero. Owned-root open files: zero. The active Pi harness was not a cleanup target.
