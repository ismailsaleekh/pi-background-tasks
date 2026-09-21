# Mission B0 correction design

## Route, boundary, and source base

- Observed before work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.
- Primary checkout HEAD observed as `1b3d48d833554ced807c729cab354dd7cc73b79d`; the seven owned B0 paths are byte-identical to correction base `c0ba66543c67a468a67a859b7ff2d267d48b2e26`.
- Only the seven paths named in the brief will be edited. No index or Git-history operation will be used. Concurrent launcher, maintenance, generated-doc, attribution, and production-source changes remain untouched.
- All commands use task-owned roots under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/baseline-fix`, offline/telemetry suppression, `CI=1`, and `GIT_ALLOW_PROTOCOL=file`. npm filesystem operands will be absolute.

## Regression-first plan

1. Add permanent focused fixtures before helper changes and capture each red result against the `c0ba665` implementation:
   - URL absolute-first cases for URL objects, `import.meta.url`, and static-scheme templates, with file positives and HTTPS negatives.
   - Use-site flow cases: later writes cannot change earlier reads, mutually exclusive branches merge to may-file, and a definite HTTPS overwrite kills prior file provenance.
   - Destructuring assignment and computed `pathname` aliases, plus HTTP and shadowing negatives.
   - Direct nested assertions hidden by one or more `satisfies`/parenthesis wrappers, while a separately validated `unknown` alias boundary remains allowed.
   - npm configuration precedence showing a controlled hostile scoped global setting wins in an intentionally vulnerable environment but is absent from the task-isolated environment; this probe resolves configuration only and performs no hostile request. It also pins explicit task-owned user/global config and `GIT_ALLOW_PROTOCOL=file`.
2. Run the focused tests individually and preserve red logs under `reports/baseline-fix/` before changing either helper.

## Source-guard correction

Replace whole-file assignment collection with a finite, flow-sensitive abstract interpretation over each source file:

- Track a bounded bit-set per compiler-bound symbol for static string protocol classes, relative strings, `import.meta`, URL objects (file/non-file/unknown), URL/path-to-file-URL callables, and the static keys needed for property resolution.
- Evaluate declarations and assignments in execution order. An assignment overwrites prior state. Unknown-condition branches run from the same incoming state and merge only continuing outcomes; literal true/false branches are pruned. Conditional/logical expressions and bounded loop passes conservatively join possible values. Later writes therefore cannot affect earlier uses, branch-local file provenance survives a merge, and definite HTTPS overwrites remove stale file provenance.
- Apply WHATWG absolute-first semantics: a statically absolute first string, a URL object, or `import.meta.url` determines the result and ignores the base. Static template heads with a scheme are classified without evaluating substitutions. Relative known strings inherit a known base; wholly dynamic values remain unknown rather than being fabricated from an unrelated base.
- Detect `.pathname`, computed access whose key may statically be `pathname`, object binding declarations, and object destructuring assignments. Continue using compiler symbols so local shadowing is respected.
- Deduplicate findings by syntax position. This is intentionally a conservative, bounded source guard, not a whole-program JavaScript proof: it does not execute calls, model heap mutation/proxies, or infer arbitrary dynamic strings. A finding requires an explicit statically traced file provenance; any feasible tracked file branch is enough.

For type safety, unwrap only type-transparent parentheses and `satisfies` expressions between directly nested assertion nodes. Do not trace assertions through identifiers or ban single assertions at validated `unknown` boundaries; the guard remains a syntactic package policy, not a whole-program type-soundness claim.

## npm isolation correction

- Create explicit empty task-owned user and global npmrc files and point both uppercase/lowercase npm config variables at them. Keep task-owned HOME/XDG/cache, an explicit registry, and hard-set `GIT_ALLOW_PROTOCOL=file` in every subprocess allowlist.
- Run package and dependency `npm pack` from task-created package-bearing cwd directories with empty project `.npmrc` files. Pass absolute package directories and absolute pack destinations, with lifecycle scripts disabled.
- Keep cache preparation/install consumers in task-owned project roots with explicit empty project config. Prove effective generic/scoped/global/user config via `npm config get`; the controlled hostile URL is only parsed by the config probe and is never contacted.
- Preserve the real installed `turndown@7.2.4` / `@mixmark-io/domino@2.2.0` closure, initially empty-cache `ENOTCACHED` control, complete loopback request assertions, registry shutdown before offline install, exact-version checks, real module load/conversion, and `finally` cleanup.

## Documentation and verification

Update only the B0 testing-policy passages in `docs/operations/testing.md`, `TESTING.md`, and `TEST_PLAN.md`. State the direct-assertion alias boundary and bounded URL-analysis limits explicitly; do not claim complete dataflow/type soundness.

After implementation, run focused adversarial guards, npm isolation/config proof, the package file/suite, `test:type-safety`, and `typecheck` when stable, plus the independent reviewer probes adapted to expect corrected outcomes. Classify the known attribution double assertion and any concurrent launcher failures exactly. Run docs checks and `git diff --check`, record source hashes/base, remove task scratch, and verify zero lane-owned npm/registry/test processes. No commit or staging operation will be performed.
