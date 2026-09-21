# Independent B0 review — `c0ba665` vs `14afc33`

## Verdict

**CHANGES REQUESTED.** The real-source controls and the isolated offline happy path work, but the new guards still admit real forbidden forms and reject some legitimate HTTP forms. I found **2 high** and **3 medium** issues.

I reviewed only the seven B0 paths at commit `c0ba66543c67a468a67a859b7ff2d267d48b2e26`. They still matched that commit byte-for-byte at the final check. Concurrent launcher/maintenance changes outside those paths were not interpreted as B0 changes.

Effective route verified before substantive work:

```text
openai-codex/gpt-5.6-sol, reasoning=max
```

No model/provider call, GitHub action, push, publish, worktree, copy, Fusion, or agent delegation was used.

## Findings

### HIGH — BR-1 — Absolute first URL values are classified from the base instead of from their own protocol

**Files/lines:** `tests/helpers/typescript-source-guards.ts:222-229`, `:431-489`; coverage gap at `tests/package/package.test.ts:1327-1330`; overclaim at `docs/operations/testing.md:32`.

`isFileUrlObject()` asks `protocolFromExpression(first)` and, when that returns unknown, classifies the result from the second argument. That is not WHATWG `URL` semantics when the first argument is already absolute: the base is ignored. `protocolFromExpression()` does not understand URL-object expressions, `import.meta.url`, or a `TemplateExpression` with a statically known scheme.

The review probe establishes runtime truth and the opposite guard result:

```ts
const absoluteFile = new URL('file:///C:/work/file.ts');
new URL(absoluteFile, 'https://example.com/base').pathname; // runtime file:, guard []

const absoluteHttps = new URL('https://example.com/request/path');
new URL(absoluteHttps, import.meta.url).pathname;            // runtime https:, guard [2]

new URL(import.meta.url, 'https://example.com/base').pathname; // runtime file:, guard []
new URL(`file://${host}/share/file.ts`).pathname;               // runtime file:, guard []
new URL(`https://${host}/v1`, import.meta.url).pathname;         // runtime https:, guard [2]
```

Reproduction: run `source-guard-probe.ts`; see `runtimeUrlSemantics` and the five corresponding `urlCases` in `source-guard-probe.log`.

**Impact:** an actual Windows-unsafe file-URL `.pathname` conversion can pass the full-tree gate, while a legitimate HTTPS pathname can fail. This directly violates the intended safety semantics and weakens the prior broad guard for these executable forms.

### HIGH — BR-2 — Assignment provenance is whole-file and order-dependent

**Files/lines:** `tests/helpers/typescript-source-guards.ts:262-276`, `:321-342`, `:431-453`, `:497-503`; missing controls near `tests/package/package.test.ts:1296-1341`.

All assignments for a symbol are collected without use-site ordering. URL-object provenance then uses existential `some()`, while string protocol provenance returns the first recognized protocol; assignments are placed before the declaration initializer. Consequently, unrelated later assignments can either mask a real file hazard or poison an earlier/definitively HTTP read.

Observed by `source-guard-probe.ts`:

```ts
let target = 'file:///C:/work/file.ts';
const nativePath = new URL(target).pathname;
target = 'https://example.com/request/path';
// Expected line 2; actual [] — later HTTPS assignment masks the file use.

let target2: string;
if (condition) target2 = 'https://example.com/request/path';
else target2 = 'file:///C:/work/file.ts';
const maybeNativePath = new URL(target2).pathname;
// Expected line 4 because one live branch is file:; actual [].

let parsed = new URL('./module.ts', import.meta.url);
parsed = new URL('https://example.com/request/path');
const requestPath = parsed.pathname;
// Definitively HTTPS at the read; actual [3].
```

Reproduction output fields: `laterStringAssignmentMasksFileHazard`, `conditionalMayBeFileButHttpsAssignmentComesFirst`, and `reassignedToHttpsBeforeRead`.

**Impact:** the result depends on source ordering rather than value provenance at the read. Both a real regression and the same class of harmless HTTP code B0 was meant to permit can fail to be distinguished.

### MEDIUM — BR-3 — Valid pathname access aliases and destructuring assignments bypass the URL guard

**Files/lines:** `tests/helpers/typescript-source-guards.ts:244-250`, `:507-514`, `:539-550`; coverage gap at `tests/package/package.test.ts:1296-1341`.

The guard recognizes only literal `['pathname']` element access and object binding in a `VariableDeclaration`. It misses valid, statically resolvable forms:

```ts
let pathname: string;
({ pathname } = new URL('file:///C:/work/file.ts')); // actual []

const key = 'pathname' as const;
const nativePath = new URL('file:///C:/work/file.ts')[key]; // actual []
```

Reproduction output fields: `destructuringAssignment` and `aliasedComputedProperty` in `source-guard-probe.log`.

**Impact:** source can perform the exact forbidden native-path conversion while the package gate stays green.

### MEDIUM — BR-4 — A type-transparent `satisfies` wrapper defeats double-assertion detection

**Files/lines:** `tests/helpers/typescript-source-guards.ts:85-89`, `:125-129`; missing control at `tests/package/type-safety.test.ts:72-100`.

Only parentheses are unwrapped between the outer and inner assertion. `satisfies` does not change the expression's type, so this remains a real nested unknown-to-target escape but reports no violation:

```ts
const wrapped = ((value as unknown) satisfies unknown) as Target;
```

The same probe also records that splitting the two assertions through an alias is not tracked:

```ts
const intermediate = value as unknown;
const split = intermediate as Target;
```

`source-guard-probe.log` reports `wrappedAndSplitAssertions: []`. By contrast, the probe confirms that direct parenthesized/multiline/angle assertions, `any` aliases, template-expression violations, real compiler directives, and production `NonNullExpression` nodes are detected; prose/string/raw-template/regex text remains inert.

**Impact:** a valid, direct double-assertion spelling passes the claimed compiler-tree policy. At minimum the type-transparent wrapper needs coverage; alias/data-flow scope should be made explicit rather than implied.

### MEDIUM — BR-5 — The npm fixture still inherits npm's real global configuration and drops the mandated Git protocol guard

**Files/lines:** `tests/package/package.test.ts:352-374`, `:1538-1575`; documentation claim at `docs/operations/testing.md:33`.

`isolatedNpmEnv()` redirects HOME, userconfig, and cache, but does not set `NPM_CONFIG_GLOBALCONFIG`. Under the exact equivalent environment on this host, npm still resolves its global config outside the task root:

```text
equivalent-env-default-globalconfig=/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/etc/npmrc
```

A safe local config probe also showed that a scope-specific entry in such a global file overrides the environment's generic loopback registry:

```text
generic-registry=http://127.0.0.1:12345/
scoped-registry=http://127.0.0.1:9/
```

Thus a real global `@mixmark-io:registry=...` can make cache preparation contact that registry before the later request assertions fail. The current host's default global npmrc was absent, so this review did not make such a request; the issue is the fixture's non-hermetic behavior across hosts.

The same environment allowlist omits `GIT_ALLOW_PROTOCOL=file`, so an outer setting is not propagated to the package/dependency `npm pack` subprocesses. The current dependency helper does use absolute package directories, and my probe used only absolute operands, so no Git lookup occurred; nevertheless the mandated defense is not present in the committed fixture.

**Impact:** the test is independent of the user cache and user npmrc, but not of npm's real global configuration, and it cannot guarantee the stated loopback-only preparation on a configured host.

## What worked

- AST controls correctly separated actual `any`, direct nested/angle assertions, recognized suppression comments, and `NonNullExpression` nodes from prose, strings, raw template text, regexes, property names, and logical negation.
- Imported `node:url` aliases, namespace imports, single-source assignment aliases, shadowed local names, literal absolute HTTPS overrides, drive URLs, UNC URLs, and direct destructuring declarations behaved as covered.
- The full current source tree had no reported file-URL pathname conversion.
- The independent offline probe used real installed `turndown@7.2.4` and `@mixmark-io/domino@2.2.0`, two initially empty task-owned caches, a loopback-only registry, and absolute npm-pack operands. The empty-cache control failed with `ENOTCACHED`; all four expected registry inputs returned 200; the registry was closed; offline install then exited 0; both exact packages loaded and produced real Markdown.
- Normal and assertion-failure cleanup in the reviewed packed-install test is under `finally`; the independent run left no child npm/registry process or tarball.
- Docs verification and docs tests passed. No semantic attestation was created.

## Commands and exits

All substantive review commands used:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/baseline-review
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/baseline-review
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/baseline-review
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

| Command | Exit | Result |
|---|---:|---|
| route environment receipt | 0 | `openai-codex/gpt-5.6-sol`, `max` |
| `./node_modules/.bin/tsc --noEmit` | 0 | PASS |
| focused direct AST + URL controls | 0 | 2/2 pass |
| `tsx --test tests/package/type-safety.test.ts` | 1 | 2/3 pass; sole tree finding is the pre-existing real `src/core/anthropic-attribution.ts:1493` double assertion |
| focused full-tree file-URL test | 0 | 1/1 pass on current tree |
| `source-guard-probe.ts` | 0 | known-good assertions pass; defect observations pinned in JSON |
| first `offline-install-probe.ts` launch | 1 | review-probe harness only: outside-package `.ts` was transformed as CJS and rejected top-level await; renamed to `.mts` |
| corrected `offline-install-probe.mts` | 0 | negative exit 1 `ENOTCACHED`; npm 11.13.0; offline install/load exits 0; registry closed first |
| npm global/scope config probe | 0 | reproduced global-config and scoped-registry precedence without network |
| `npm run docs:verify` | 0 | 31 surfaces, 50 sources, deterministic generation OK |
| `npm run test:docs` | 0 | 5/5 pass |
| target diff whitespace check | 0 | PASS |
| target source-ref/hash + working-path equality check | 0 | all seven paths match target |
| final cleanup/process/open-file check | 0 | zero owned probe processes/open files; mechanical roots empty |

I inspected the worker's preserved exact logs rather than claiming them as reviewer reruns:

- `final-package-file.log`: 24/24, exit 0.
- `final-package-suite-inherited-red.log`: 51/52, exit 1 solely at the actual attribution double assertion.
- `final-adversarial-controls.log`: 2/2, exit 0.
- `final-typecheck.log`: exit 0.

I did not rerun the exact 24-test file because its unchanged package-pack path temporarily writes the package tarball into the source checkout, contrary to this review's write-only scratch boundary. `offline-install-probe.mts` exercised the new helper and same cache/registry/install/load behavior while directing every package tarball to the authorized scratch root.

## Immutable source references

```text
base commit  14afc33e3967a142758169d3217a4e63b4b3ec94
base tree    b4f612a1c288d454523d3b43c9cd186678a8bed9
target commit c0ba66543c67a468a67a859b7ff2d267d48b2e26
target tree   53004f0129109869082a671750fbad13c8ccc3e5
```

| Reviewed path | Git blob | SHA-256 |
|---|---|---|
| `TESTING.md` | `587408c5fe2ab05290a23da145e413a855f4c966` | `1656604fdbb185e0722247f2e1007aab6d78bea9d840dbdd83aebc21ca80e8c6` |
| `TEST_PLAN.md` | `763400fc34d176165885d2dce3b2181caec8f962` | `7273d4f8e11060bb4af745d0b6171d3c69c2490f80eb4c09ae0f6d4e7aec99be` |
| `docs/operations/testing.md` | `2e64d52a80375a576976c2fae2e09f3c0ff53041` | `a5b8a424d714ddc02e8f0161a903b9146312a89a6a9f05fc9f8c2b331f1bb77c` |
| `tests/helpers/offline-npm-registry.ts` | `8b8e883707234f5072c6cda6fa0d08b413037807` | `8ee508e3043439d19e59da55583848c30e912effea7bf7a97f5fa2a4a97fccdc` |
| `tests/helpers/typescript-source-guards.ts` | `5ad043356def61efffb75ddce6d37cb0ee158298` | `36e4ee3f099f5efc5f5e94b2ca39e3ad65408b0cf18476e3275940bc001df704` |
| `tests/package/package.test.ts` | `c77436d1afedce4acfc7a7912227374d6c7ba61d` | `a147eb800b55657b7eba75b706bb16813644d3c8aed6cfd8b82111add508acc4` |
| `tests/package/type-safety.test.ts` | `a746ad1bc3bb3663f34e97cf096832743cab4ac7` | `e2898011f8d15e757cf800168558726b4374d292b48f7579627fb42fea4777b0` |

At final inspection the primary checkout HEAD was the unrelated maintenance commit `1b3d48d833554ced807c729cab354dd7cc73b79d`; all seven reviewed paths had zero diff from `c0ba665`.

## Incident, limits, and cleanup

- I acknowledge the worker's discarded probe accidentally treated `node_modules/turndown` as Git shorthand and attempted a failed GitHub SSH lookup. I did not repeat it. Every review `npm pack` operand was an absolute filesystem path, `GIT_ALLOW_PROTOCOL=file` was set, and the only registry traffic was owned loopback traffic.
- Review host: macOS 15.7.3 arm64, Node 24.16.0, npm 11.13.0, TypeScript 5.9.3. Native Windows and other bundled npm versions were not available; no Windows certification is claimed.
- The scanner also returns no finding for a parse-invalid source that has TypeScript parse diagnostic 1109. The default gate's preceding `tsc` catches this, so I record it as a limit rather than a separate severity finding.
- Unrelated generated-doc/attribution/launcher outcomes were excluded. The observed attribution double assertion is the known genuine violation, not a B0 regression.
- No hostile registry request was sent. The server binds only `127.0.0.1`; malformed-percent handling was not exercised because it is not on the owned npm-client path.
- The complete offline probe measured 24,732 KiB immediately before its `finally` cleanup, below the 100 MiB cap. Final task-owned `tmp`, `home`, and `agent` roots are each 0 KiB; reports/probes/logs are small text files.
- Owned npm, Node probe, and registry subprocesses: **zero**. Owned worktrees/copies/tarballs: **zero**. The active Pi harness and other workers were not cleanup targets.
