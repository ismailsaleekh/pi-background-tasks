---
doc_id: operations/testing
audience: maintainer
mode: authored
review_policy: contract
stability: evolving
covers_surfaces: []
covers_sources: []
---
# Testing operations

Package entry docs: `TESTING.md` and `TEST_PLAN.md`. This page explains how to choose gates without losing the detailed coverage matrix.

## Isolation defaults

Automated package tests should use isolated temp project/agent/session directories and these defaults unless a test intentionally overrides them:

```bash
PI_OFFLINE=1
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
CI=1
```

Never point tests at the user's real `~/.pi/agent`.

## Trustworthy package-verification controls

Package source guards are compiler-driven rather than text-only:

- `test:type-safety` parses TypeScript syntax trees to reject explicit `any` types, directly nested/double assertions (including intervening parentheses and type-transparent `satisfies` expressions), and production non-null expressions while ignoring inert words in comments, strings, templates, and regular expressions. TypeScript-recognized `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck` comments remain forbidden. The double-assertion rule is deliberately syntactic: assertions separated through an identifier are not treated as directly nested, so validated `unknown` boundaries remain legal; this is not a whole-program type-soundness proof.
- `test:package` separates syntax-wide discovery of self-contained file-URL `pathname` hazards from bounded, flow-sensitive provenance. Static strings and static-head templates are classified by the WHATWG URL parser, including leading C0/space preprocessing and TAB/CR/LF removal; absolute first arguments override bases, while `./` and `../` template heads use the explicit base. The flow layer tracks distinct normal, break, continue, return, and explicit-throw completions, runs `finally` for every incoming completion, and covers direct/computed access plus declaration, assignment, and statically known `for...of` destructuring. Exact static keys distinguish lowercase `import.meta['url']` from uppercase intrinsic `globalThis['URL']`, with compiler symbols retaining lexical shadowing controls. Any explicitly traced may-file branch is rejected. An unknown dynamic first value remains unknown, but when a base is explicit it also retains that base's possible provenance because the value may be relative; known absolute HTTP(S) values still ignore file bases. The guard does not execute calls, infer implicit exceptions or interprocedural/later-closure effects, or model heap mutation and proxies, so it is a conservative source-policy check rather than a complete JavaScript dataflow proof.
- The packed-consumer test starts with a separate empty-cache negative control. It archives the already-published files of the real installed production dependency closure through npm's bundled portable `tar` API, without entering npm's directory-pack lifecycle, then exposes only those inputs through a loopback fixture registry and seeds a fresh task-owned npm cache. An executable task-owned `prepack`/`prepare`/`postpack` sentinel characterizes npm 10.9.3's unsafe `--ignore-scripts` prepare behavior and npm 11.13.0's denial, while the fixture path executes no hook, preserves script-bearing manifest bytes, and leaves source hashes unchanged. npm receives explicit task-owned user and global config files, runs from task-owned projects with empty project config, hard-sets `GIT_ALLOW_PROTOCOL=file`, and uses absolute archive/pack/install inputs. A configuration-only hostile scoped-registry control proves ambient global/project precedence cannot divert preparation; it sends no hostile request. The registry is stopped before the tarball is installed with `--offline`; the test loads Turndown and its Domino transitive dependency. It never reads the user's npm cache or config, and absent closure inputs fail loudly.

## Current package scripts

From current `package.json`:

| Lane | Script | Meaning |
|---|---|---|
| Runtime build | `npm run build:runtime` | Compile authoritative extension/runtime TypeScript into the shipped `dist/` JavaScript closure. |
| Typecheck | `npm run typecheck` | `tsc --noEmit`. |
| Type safety package tests | `npm run test:type-safety` | Package/type-safety tests. |
| Unit | `npm run test:unit` | Pure/unit coverage, including durable fs, budgets, projection, Fusion/delegate core. |
| SDK | `npm run test:sdk` | Real package entrypoint through SDK-style harnesses. |
| RPC | `npm run test:rpc` | RPC command/tool surface. |
| Component | `npm run test:component` | TUI component rendering/key behavior. |
| Package | `npm run test:package` | Manifest/payload/mutation/package guards. |
| Hook contract | `npm run test:hook-contract` | Real Pi hook characterization evidence comparison. |
| Default | `npm run test` | Typecheck + type-safety + unit + SDK + RPC + component + package + hook-contract. |
| PTY | `npm run test:pty` | Real expect/TUI scenarios; full gate only. |
| Agent loop | `npm run test:agent-loop` | Scripted-provider real agent-loop behavior; full gate only. |
| Full | `npm run test:full` | Default + PTY + agent-loop. |
| Smoke | `npm run smoke` | Isolated load-only `/jobs`. |
| Large context smoke | `npm run smoke:large-context` | Offline Fusion context/budget reproduction; no inference/child spawn. |
| Compatibility | `npm run test:compat` | Release-only exact Pi version install/compat plus current-host witness. |
| Pack | `npm run pack:dry-run` | Release payload preview. |
| Docs generate | `npm run docs:generate` | Regenerates generated docs regions/index/manifest. |
| Docs verify | `npm run docs:verify` | Offline, read-only deterministic docs freshness verification; renders generated files twice in memory and reports semantic receipt freshness without requiring it. |
| Strict docs attestation verify | `npm run docs:verify:attestations` | Optional strict mode that additionally requires every behavioral receipt to match current prose and sources. |
| Docs attestation | `npm run docs:attest/record -- <doc_id> --reviewer <identity-after-semantic-review> --verdict PASS --notes <review-notes>` | Computes hashes and records an explicit semantic PASS receipt after review; `npm run docs:attest` is an alias and still needs args. |
| Docs unit/package gate | `npm run test:docs` | Docs-gate unit/package tests. |
| Payload check | `npm run payload:check` | Package payload policy check. |
| Cold-load benchmark | `node scripts/benchmark-cold-load.mjs --root "$PWD" --runtime <source|compiled> --label <label> --output <owned.json> --samples 30 --scratch <owned-dir>` | Fresh-process source or compiled-distribution load and first-use distributions; evidence only, never a CI timing threshold. |
| Release version check | `npm run release:check-version` | Tag-only version sanity; requires explicit `GITHUB_REF_TYPE=tag`/`GITHUB_REF_NAME=v$VERSION` and never publishes. |

### Cold-load measurement discipline

The cold-load driver starts a new Node process for every sample and gives each worker isolated project, agent, session, HOME, and temporary roots with offline/telemetry suppression. It records raw samples plus median, p90, median absolute deviation, minimum, and maximum for direct delegate/Fusion facade imports; no-extension, process-only, and default-full real SDK loading; first delegate/Fusion launch and subtype result verification with deterministic fake children; and first model-selector invocation with mocked UI. One warm-up is excluded and at least 30 measured samples are expected for comparative evidence.

Here, **cold** means a fresh process and empty JavaScript/Jiti module cache. It does not mean a flushed filesystem cache. Baseline and candidate must use the same driver and worker bytes, Node/Pi/dependency tree, host, features, and root conditions. If worktree limits force sequential baseline-then-candidate collection rather than simultaneous AB/BA, record that host-drift risk; do not fabricate interleaving. There is no machine-specific pass threshold.

The benchmark requires an explicit `--runtime source|compiled` choice. Published package entrypoints select the compiled JavaScript distribution, while source mode remains an authoritative development control. Process-only startup no longer statically imports delegate/Fusion facades, dock UI, the attribution transport, or attested execution; enabled registrations still load their lightweight facade before the extension factory resolves. Neither mode supports a native-Windows or vendor compiled-Bun timing claim without separate runs.

The package gate separately walks literal deferred imports, verifies every source target, builds its compiled counterpart, and requires the complete `dist/` closure in the tarball. A packed-copy regression installs only the real production Turndown/Domino closure, proves all Pi SDK packages and TypeBox are absent beneath the package, and loads both compiled entrypoints through Pi's real SDK loader with default capabilities. Before damage injection it invokes `bg_delegate`, `bg_run_pi_attested`, `fusion_reason`, the task manager, and the Fusion selector; each must pass module loading and reach its expected post-import semantic boundary. It then removes one delegate producer module: startup and immediate inventory still work, the first producer invocation fails with the bounded module-specific error, and no delegate artifact is created. A source-graph guard also pins the host import on every internal dynamic-import issuer. This distinguishes supported package entrypoint traversal from unsupported direct Node imports of private `dist/src/**` chunks, without borrowing development dependencies or weakening the real payload-closure check.

Lazy lifecycle SDK coverage deliberately blocks Fusion cleanup while asserting the shared synchronous fence has already closed delegate, result, command/UI, and both Fusion lanes. A real `AgentSession.reload()` control lets production delegate preparation finish a complete artifact tree before returning, then proves the unregistered transaction is rolled back with no starter or residual run bytes. A separate claim race proves shutdown cannot consume Fusion usage without a successful retrieval, and a registered-task control proves rollback never deletes registry-owned artifacts.

Do not run full/default/root suites for documentation-only edits unless the operator explicitly asks. If the operator restricts verification to focused checks, report that `docs:verify`/attestation were not run.

## Evidence that must be preserved

`TESTING.md` and `TEST_PLAN.md` intentionally carry exhaustive QA knowledge. Do not replace them with generic summaries.

Preserve especially:

- Pi hook contract evidence and byte-identical shipped copy behavior;
- Fusion golden-byte and independent oracle coverage;
- delegate seed/budget/artifact/result/guard/mutation coverage;
- scripted-provider no-poll/no-sleep follow-up behavior;
- PTY keyboard-protocol negotiation notes;
- compatibility TypeBox peer/payload checks;
- live subscription evidence caveat: it is release-time, real inference, and subscription OAuth only.

## Focused docs checks

When a change is constrained to focused docs checks, use targeted checks such as:

```bash
python3 - <<'PY'
from pathlib import Path
for p in [*Path('docs').rglob('*.md'), Path('TESTING.md'), Path('TEST_PLAN.md'), Path('PUBLISHING.md')]:
    if p.exists(): print(p)
PY
```

Recommended focused checks for docs changes:

1. frontmatter schema on `docs/**/*.md`;
2. package-local markdown links resolve;
3. no standalone links to removed parent `../EXTENSION_*` standards;
4. docs workflow wording matches current `package.json` scripts;
5. version/tag references derive from `package.json` or observed git tags.

These checks are not substitutes for code gates when source behavior changes.

## Gate selection

- **Doc-only navigation/release wording:** focused link/frontmatter/version checks.
- **EventBus docs vs API changes:** EventBus unit/SDK targeted tests if code changed; otherwise focused docs checks.
- **Context projection/budget changes:** unit tests for projection/budget/golden/oracle; do not update goldens casually.
- **Durability/launch changes:** durable-fs, pi-launch, Windows argv targeted units.
- **Delegate guard changes:** hook contract, delegate unit/SDK/scripted-provider targeted gates.
- **Release candidate:** ordinary release checks in `docs/operations/releasing.md`; live subscription evidence only when explicitly certifying release behavior.
