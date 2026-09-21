# Mission B0 final report

## Result

- Initial HEAD: `14afc33e3967a142758169d3217a4e63b4b3ec94`
- Local commit: `c0ba66543c67a468a67a859b7ff2d267d48b2e26` (`test(package): make verification guards trustworthy`)
- Observed route before work: `openai-codex/gpt-5.6-sol`, reasoning `max`
- No push, publish, tag, package/lock change, production-source change, generated-doc change, worktree creation, Fusion/agent delegation, or semantic attestation.
- Final package status contains only the pre-existing, unstaged, unowned `maintenance/community-closeout-2026-09/STATE.md` modification. The index is empty.

Committed paths:

1. `tests/package/type-safety.test.ts`
2. `tests/package/package.test.ts`
3. `tests/helpers/typescript-source-guards.ts`
4. `tests/helpers/offline-npm-registry.ts`
5. `TESTING.md`
6. `TEST_PLAN.md`
7. `docs/operations/testing.md`

## Guard behavior and controls

### TypeScript safety

The full-tree roots remain `extensions`, `src`, `tests`, and `scripts`; production non-null scanning remains `extensions`, `src`, and `scripts`. There is no source-file allowlist.

The guard now uses TypeScript syntax/compiler metadata:

- `SyntaxKind.AnyKeyword` identifies actual explicit `any` types, not prose or identifiers/properties named `any`.
- Nested `as` and angle-bracket assertion expressions are found through parentheses and line breaks.
- `NonNullExpression` identifies production non-null bypasses without confusing ordinary negation.
- TypeScript-recognized comment directives identify `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck` while inert mentions in comments, quoted strings, templates, and regular expressions remain clean.

Direct fixtures cover multiline/parenthesized assertions, both assertion syntaxes, ordinary comment words, string/template/regex contents, all three real suppression directives, and parenthesized/direct non-null expressions.

### File URL pathname

The package guard now follows compiler-bound provenance rather than treating every `URL.pathname` as a filesystem conversion. It rejects `.pathname`, bracket access, and destructuring when the URL is proven to derive from:

- inline or variable `new URL(..., import.meta.url)`;
- aliases of `import.meta`, `import.meta.url`, URL objects, assignments, and URL constructors;
- `node:url` constructor/`pathToFileURL` aliases;
- static `file:` URLs, including `file:///C:/...`, `file:///D:/...`, and UNC forms.

Negative controls allow unknown/configured URLs, inline and based HTTPS URLs, an absolute HTTPS URL overriding an `import.meta.url` base, `fileURLToPath(new URL(...))`, request-path rendering from a URL parameter, and the real Anthropic HTTPS origin/path validation. Strings/comments/regex text are inert. The full source-tree guard is green and continues to cover Windows-unsafe file URL conversions.

### Offline packed consumer

The test uses two distinct empty isolated npm caches:

1. The negative-control cache runs the packed tarball with `--offline` before preparation and must fail `ENOTCACHED` naming `turndown`.
2. The success cache is asserted empty, then seeded only from a loopback registry assembled by recursively reading and repacking the real installed production closure with lifecycle scripts disabled: `turndown@7.2.4` and `@mixmark-io/domino@2.2.0`.

The fixture asserts all four package metadata/tarball inputs were requested and every registry response was present. It then closes the registry before installing the package tarball with `--offline`. The installed manifests must retain the exact versions/dependency edge, and a child Node process loads both packages and performs a real Turndown HTML-to-Markdown conversion. Test environments contain only task-owned HOME/config/cache coordinates and a minimal PATH; no user npm cache is read.

## Red and green evidence

All reported test and verification commands used:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/baseline
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/baseline
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/baseline
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
```

### Baseline red reproductions at initial HEAD

| Command | Exit | Counts / result |
|---|---:|---|
| `npm run test:type-safety` | 1 | 2 tests: 1 pass, 1 fail; false comment `any` at attribution line 83 plus true double assertion at line 1493. |
| `tsx --test --test-name-pattern='converts file URLs to native paths' tests/package/package.test.ts` | 1 | 1 test: 0 pass, 1 fail; falsely reported `src/core/anthropic-attribution.ts` HTTPS pathname validation. |
| `tsx --test --test-name-pattern='local tarball installs with the expected package files' tests/package/package.test.ts` | 1 | 1 test: 0 pass, 1 fail; `ENOTCACHED` for `https://registry.npmjs.org/turndown`. |

### Final-tree verification

| Command | Exit | Counts / result |
|---|---:|---|
| `npm run typecheck` | 0 | PASS. |
| `tsx --test --test-name-pattern='classifies syntax\|file URL pathname guard distinguishes' tests/package/type-safety.test.ts tests/package/package.test.ts` | 0 | 2/2 direct adversarial controls pass. |
| `tsx --test tests/package/package.test.ts` | 0 | 24/24 pass, including file-URL full-tree and self-contained packed-install tests. |
| `npm run test:type-safety` | 1 expected inherited red | 3 tests: 2 pass, 1 fail; sole finding is the genuine attribution double assertion. |
| `npm run test:package` | 1 expected inherited red | 52 tests: 51 pass, 1 fail; same sole attribution double assertion. All 24 tests in `package.test.ts` pass. |
| `npm run docs:verify` | 0 | 31 surfaces, 50 sources, deterministic generation OK; attestations advisory. |
| `npm run test:docs` | 0 | 5/5 pass. |
| `git diff --check` and staged `git diff --cached --check` | 0 | PASS. Explicit staged-path review contained only the seven owned paths. |

Logs are under `/private/tmp/pi-bg-closeout-iNoltL/logs/baseline/`.

## Unresolved true violation

`src/core/anthropic-attribution.ts:1493` still contains:

```ts
details as unknown as AnthropicLineageDetails
```

The semantic full-tree gate intentionally remains red for this real double assertion. It was not waived, hidden, or edited; attribution-lane integration is expected to remove it through validated narrowing.

## Cleanup and process state

- Test-created consumers, fixture registry, repacked dependency tarballs, npm caches, and the exploratory probe were removed.
- Retained task roots are empty: `tmp/baseline` 0 B, `home/baseline` 0 B, `agent/baseline` 0 B.
- Preserved bounded logs were 108 KiB at cleanup; reports are small text files.
- Peak observed lane scratch before cleanup was 7.6 MiB, below the approximately 400 MiB limit.
- No auxiliary worktree or dependency copy was created; repository `node_modules` was only read/packed with scripts disabled.
- Owned live test/npm/registry processes: zero. The active Pi harness process and sibling workers are not lane-owned cleanup targets.

## Boundary note

One discarded pre-implementation scratch probe passed `node_modules/turndown` to `npm pack` without an absolute/`./` path. npm misparsed it as git shorthand and invoked `git ls-remote ssh://git@github.com/node_modules/turndown.git`; it exited 128 with `Repository not found`, and fetched/installed no package input. This was preserved in `logs/baseline/exploratory-probe-failure.log`. Every red/green verification run used an invalid registry, the task-owned loopback fixture registry, or offline cache mode; no remote package data or model/API request was used.
