# Independent C1a finite-grammar correction review

## Verdict

**FAIL — HIGH findings remain in the finite registration grammar.** The correction rejects the original three counterexamples when they are isolated behind the real supported parser, and the checked-in 48-profile inventory is coherent. However, the same extractor still accepts seven small structural mutations that either hide a runtime registration or publish one that runtime never reaches. This contradicts the fail-closed claims in `docs/subsystems/docs-freshness-gate.md:12-16`.

No source, docs, tests, generated output, history, or attestation receipt was changed.

## Findings

### HIGH — Destructured/computed unknown hosts and parameter-initializer control flow remain invisible

**Locations:** `scripts/docs/lib.mjs:1128-1150`, `scripts/docs/lib.mjs:1314-1363`, `scripts/docs/lib.mjs:1615-1627`, `scripts/docs/lib.mjs:1766-1768`.

The parameter pass examines only initializer expressions and only recognizes Pi-derived expressions or property accesses named `register*`/`events`; it does not reject a registration-looking destructured binding name. The general element-access rejection applies only when the receiver is the validated Pi identifier. Traversal then begins at `fn.body`, so other activation control flow in parameter initializers is not visited.

The retained probe demonstrates three accepted counterexamples:

- `{ registerCommand } = getRegistrationHost()` registers `hidden-destructured-host` at runtime, while extraction returns only `command:visible`.
- An imported unknown host using `otherHost['registerCommand'](...)` registers hidden + visible commands at runtime, while extraction returns only `command:visible`.
- A direct throwing default parameter prevents activation entirely, while extraction publishes `command:initializer-never-registers`.

These are finite AST shapes, not a request for general JavaScript interpretation. Unknown registration hosts and explicit initializer control flow should fail closed.

### HIGH — Config authority is not lexical or transitive across the supported activation callback, and parser return validation is incomplete

**Locations:** `scripts/docs/lib.mjs:402-445`, `scripts/docs/lib.mjs:815-833`, `scripts/docs/lib.mjs:912-970`, `scripts/docs/lib.mjs:1479-1547`.

Three independent accepted cases produce invented surfaces:

1. A validated outer `config` is captured in a direct `session_start` callback and mutated with `Object.defineProperty` before registration. Callback recursion constructs a fresh empty `configBindings` map, so the captured use is never checked. Extraction returns `command:captured-config-never-registers`; runtime throws `TypeError` and registers nothing.
2. A function parameter named `parseBackgroundTasksConfig` shadows the import. Name-only import lookup validates the real imported module even though runtime calls the default fake parser. Extraction returns `command:shadowed-parser-never-registers`; runtime registers nothing.
3. `assertImmutableVariantParser()` filters only direct body statements for returns. A nested early return before the reviewed frozen return is ignored. A parser with a reachable mutable/disabled return therefore authorizes `command:parser-early-return-never-registers`.

The current parser bytes do have the intended double freeze and exact feature fields, and actual parser tests pass. That does not make the mutation grammar fail closed. The report therefore distinguishes current runtime tests from structural parser validation and makes no general semantic-proof claim.

### HIGH — The duplicate-owner return waiver accepts an unrelated/fake claim protocol

**Locations:** `scripts/docs/lib.mjs:1365-1475`; positive fixture `scripts/docs/selftest.mjs:302-318`.

The waiver checks the empty acknowledgement array, callback append, adjacent emit, and positive-length return, but never validates `emit.arguments[0]`, the actual claim schema, or the exact probe property contract. Indeed, the positive fixture uses arbitrary `'fixture:claim'` and omits the production schema field.

A registrar that first installs its own unrelated listener and then emits `'unrelated:claim'` is accepted and publishes `command:fake-owner-suppressed`. At runtime that listener acknowledges the event but supplies no owner surface, so the registrar returns and runtime has no command. This self-contained fixture is exactly the arbitrary/fake-owner early-return condition that the exception was required not to authorize.

**Decisive evidence for all findings:**

```text
node /private/tmp/pi-bg-closeout-iNoltL/reports/feature-docs-review-2/probes/finite-grammar-negative-controls.mjs
exit 1 (intentional: expected rejections were accepted)

accepted expected-negative cases:
  registration-owner-parameter-initializer-throw
  captured-config-mutation-in-session-start
  fake-duplicate-owner-channel
  unknown-host-computed-registration
  destructured-default-unknown-host
  shadowed-imported-config-parser
  hidden-early-return-in-config-parser
```

Full extractor IDs, runtime observations, and rejection messages are in `/private/tmp/pi-bg-closeout-iNoltL/reports/feature-docs-review-2/logs/finite-grammar-negative-controls.log`.

## What the correction does prove

The same independent probe keeps the three original cases separate and uses the byte-for-byte real `src/core/config.ts` parser for each:

| Original case | Runtime observation | Corrected extractor |
| --- | --- | --- |
| imported default-parameter Pi alias | `command:hidden-default-alias` registers | rejects at `feature.ts:1` |
| imported registrar early return | no command | rejects at `feature.ts:1` |
| frozen config mutation | no command; `TypeError` | rejects at `entry.ts:5` |

It also confirms that an explicit throw in a registration-owner body is rejected while returns inside a non-registration command handler remain accepted. Direct config aliases, destructuring, writes, updates, mutation calls, and argument escapes are rejected. The selftest now reads the real parser at `scripts/docs/selftest.mjs:184`; it no longer uses the old `{} as any` positive fixture. The old review repro now exits at that obsolete fake parser, but this review did not treat that early failure as proof of the other guards.

For the checked-in tree, inherited availability is coherent:

- imported delegate/Fusion/result registrars produce `feature:delegate`, `feature:fusion`, and `any(feature:delegate,feature:fusion)`;
- the direct `session_start` attribution path produces `command:claude-cache` with `feature:attribution`;
- attested and dock surfaces retain `feature:attested`, `dock:shift+down`, and `dock:ctrl+alt+b`.

Existing alias, wrapper, computed-Pi, constructor, repeated-imported-registrar, unknown-condition, `off`, and metadata controls remain present and the stock selftest passes. The findings above show that unsupported syntax is still ignored at other structural boundaries.

## Profile, defaults, ownership, schema, and payload observations

Independent manifest evaluation covered all 16 optional-feature subsets under all three dock states (**48 profiles**):

- union: 32 surfaces; default profile: 31;
- kinds: 11 commands, 11 tools, 3 shortcuts, 2 renderers, 1 EventBus surface, 4 workflows;
- process-only counts: 16 (`shift+down`), 16 (`ctrl+alt+b`), 15 (`off`);
- full counts: 31, 31, and 30 respectively;
- `bg_result` occurs exactly once iff delegate or Fusion is selected;
- `off` has no dock shortcut; unconditional `ctrl+alt+c` remains;
- all 32 surfaces have exactly one owner; all 52 governed production sources have exactly one owner;
- all 11 tool roots have object schemas; code extraction reports 46 unique schema IDs;
- `extensions/anthropic-attribution-child.ts` is owned by the attribution doc but contributes no public/always-on surface;
- manifest schema remains `pi-background-tasks.docs-manifest.v2`;
- versus `e3c0b06`, no surface was added/removed and no contract changed after ignoring 17 source-line provenance shifts; defaults and configuration variants are unchanged;
- payload closure is 108 files and excludes reports/scripts/tests as required.

Actual runtime checks were kept distinct from structural extraction: config tests passed all 16 subsets and all three dock literals (4/4), and focused real-SDK registration tests passed the default profile, all 16 subsets, alternate/off key behavior, and all three footer hints (5/5). This is current-profile evidence, not a claim that the extractor proves arbitrary JavaScript semantics.

### Availability claim boundary

Generated README/command tables call `/claude-cache` a default-available `feature:attribution` command (`README.md:37-54`, `docs/commands/claude-cache.md:12-18`), while runtime registers it only after a supported bound host successfully emits `session_start`. The attribution/configuration prose does state that activation timing. Therefore the profile facts above are certified only for that documented initialized-host contract; they are **not** a pre-bind or empty-bind availability guarantee. Post-bind/empty-bind behavior remains the separate runtime review's scope.

## Commands and exits

All mechanical commands used Node `v22.19.0` / npm `10.9.3` with:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/feature-docs-review-2
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/feature-docs-review-2
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/feature-docs-review-2
```

| Command | Exit / result |
| --- | --- |
| route environment inspection | 0; `openai-codex/gpt-5.6-sol`, reasoning `max` |
| `git diff --check e3c0b06..HEAD` | 0 |
| `npm run docs:verify` | 0; 32 surfaces / 52 sources, deterministic, receipts advisory |
| `npm run test:docs` | 0; 7/7 |
| `node scripts/docs/selftest.mjs` | 0 |
| independent finite-grammar negative controls | 1 expected; original controls reject, seven residual controls are wrongly accepted |
| first review's `decisive-repro.mjs` | 1 at the old fake parser, as expected and not used as sole proof |
| independent 48-profile/owner/schema audit | 0 |
| `tsx --test tests/unit/config.test.ts` | 0; 4/4 |
| focused `feature-selection-sdk.test.ts` profile/shortcut cases | 0; 5/5 |
| `npm run payload:check` | 0; 108 files |
| independent manifest delta audit | 0; 0 added, 0 removed, 0 non-provenance contract changes |
| final tracked diff against `HEAD` | 0 / clean |

Logs and retained probes are under `reports/feature-docs-review-2/{logs,probes}`.

## Frozen boundary

Reviewed commit and tree:

```text
HEAD       c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541
HEAD tree  c21e75f14fe4ae6ef502ef6942dc95275c72293c
base       e3c0b065c52862e3889c9c5c24841a9d162fb338
base tree  6a2aae74884072abd94bbbc3cf6f891ef43632f8
```

Key SHA-256 values were unchanged at initial and final inspection:

```text
14d1b5926113eaaf331f3b91976405f0b2fbb32943cd31247cc6c961951cf531  scripts/docs/lib.mjs
5294c58f54bae7e499cfb5630231b6cde5490c0c7aad5be06a4742d920824e38  scripts/docs/selftest.mjs
ec4b9e9118b0dac888e722b58a533294704007c5fad6fcc5e61764b78eca47f3  tests/package/docs-contract.test.ts
b29e3ac34b5ad27bbad566813c9306234c351ff712c87a8d3f50df8f738aed59  tests/sdk/feature-selection-sdk.test.ts
a7f4a7f98176876d58cb40b73cf01cea12976647d4442a255755d1b0517a464c  docs/manifest.json
24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111  src/core/config.ts
```

The only worktree status item throughout was the harness-provided untracked read-only `node_modules` symlink. Tracked bytes remained equal to `HEAD`.

## Limits and cleanup

This was a docs/finite-grammar review, not the separate provider/runtime-ownership verdict. No full release suite, native Windows/Bun qualification, model/provider call, network/GitHub action, install, Fusion/agent invocation, push, or publish was performed. No general JavaScript interpreter or semantic-proof claim is made.

Effective review route was `openai-codex/gpt-5.6-sol` with `PI_REASONING_LEVEL=max` (Sol max). Owned scratch peaked well below 150 MiB. Final TMP/HOME/agent roots are 0 B, retained report evidence is under 1 MiB, no review-owned test/server/watcher child remains, and no generated writer or attestation recorder was run.
