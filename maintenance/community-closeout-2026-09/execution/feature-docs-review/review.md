# Independent C1a finite-docs-contract review

## Verdict

**Finding present; the finite docs grammar is not fail-closed enough for C1a acceptance.** The checked-in source and generated inventory agree for the current registration shapes, but the extractor accepts ordinary TypeScript mutations that make runtime registrations diverge from the manifest without failing `docs:verify` or the existing docs mutation suite.

No fixes, generated writes, or semantic attestation receipts were made.

## Findings

### HIGH — Imported-registrar aliases and control flow can silently hide or invent public surfaces

**Locations:** `scripts/docs/lib.mjs:629-697`, `scripts/docs/lib.mjs:798-828`, `scripts/docs/lib.mjs:1295-1341`; missing negative controls in `scripts/docs/selftest.mjs:184-264`.

`collectRegistrationsInFunction()` treats only the first declared parameter as the Pi host and traverses only `fn.body`. It does not inspect registrar parameter initializers. A second parameter defaulted to the Pi parameter is therefore an untracked host alias: its real registration is ignored rather than rejected. Separately, `registrationAvailability()` checks a call's syntactic parent but not control flow before the call, so a top-level early return can make an extracted registration unreachable while it is still published with inherited feature availability. Mutation attempts such as `Object.defineProperty(config.features, ...)` against the supposedly immutable config object are likewise accepted by extraction.

Decisive scratch-only synthetic repro (Node 22.19.0):

```text
node /private/tmp/pi-bg-closeout-iNoltL/reports/feature-docs-review/decisive-repro.mjs
exit 0

{
  "hidden_alias": {
    "extractor": [],
    "runtime": ["command:hidden"]
  },
  "early_return": {
    "extractor": ["command:never-registered"],
    "runtime": []
  },
  "mutated_config": {
    "extractor": ["command:startup-never-reaches-registration"],
    "runtime": [],
    "runtime_error": "TypeError"
  }
}
```

The key accepted fixtures were equivalent to:

```ts
export function registerFeature(pi: Host, host: Host = pi) {
  host.registerCommand("hidden", {});
}

export function registerFeature(pi: Host, enabled: boolean) {
  if (!enabled) return;
  pi.registerCommand("never-registered", {});
}
```

Both are called as imported registrars under the recognized `config.features.delegate` branch. The first yields an undeclared runtime command; the second yields a manifest command that never registers. The existing positive fixture also defines `parseBackgroundTasksConfig()` as `return {} as any`, so it proves exported constant names but not an immutable/parser-semantic binding.

**Impact:** future source can pass deterministic generation with wrong surface counts, ownership, availability, defaults, and profile inventories. This directly violates the requested hidden/aliased/mutable-registration rejection and inherited-availability guarantees. The current green snapshots do not exercise these cases.

## Current-tree assessment

### Strictness and registration truth

- Runtime/docs constants currently match exactly: features `process,delegate,fusion,attested,attribution`; default all five; dock values `shift+down,ctrl+alt+b,off`; default `shift+down`.
- The implemented exact feature atoms, canonical delegate-or-Fusion result expression, two registrable dock literals, illegal `off` guard, ordinary config alias, unknown feature, nested condition, local wrapper, computed host access, and repeated imported registrar controls are present and their existing selftests pass.
- Current source conditions are correctly extracted: delegate, Fusion, attested, attribution, and `any(feature:delegate,feature:fusion)`; `bg_result` appears once. The private always-on Anthropic child entrypoint is source-owned but is not counted as a public always-on command/provider surface.
- The high finding above means this strictness does not survive all required source mutations.

### Default/profile matrix

An independent manifest evaluator covered all 16 optional-capability subsets across all three dock states (48 combinations):

- union: 32 surfaces; default inventory: 31;
- 11 commands, 11 tools, 3 shortcut variants, 2 renderers, 1 EventBus surface, 4 workflows;
- full profile counts: 31 (`shift+down`), 31 (`ctrl+alt+b`), 30 (`off`);
- process-only counts: 16, 16, and 15 respectively;
- `bg_result` count is exactly 0 or 1 according to delegate/Fusion presence;
- `off` has neither dock key, while unconditional `ctrl+alt+c` remains;
- `process` is present in every evaluated profile.

These are coherent for the checked-in manifest and runtime constants. The focused config test independently passed all 16 parser subsets and all three shortcut values.

### Generated docs, ownership, manifest, and payload

- `docs:verify` under the declared minimum Node 22.19.0 reproduced 32 surfaces / 52 governed sources and byte-deterministic first/second renders.
- Every current manifest surface has string availability, boolean `default_available`, and exactly one owner. Every one of 52 governed sources has exactly one owner. New `src/core/config.ts` and `extensions/anthropic-attribution-child.ts` have the intended owners.
- README contains all 17 non-`always` surface rows. Tool, command, shortcut, EventBus, workflow, INDEX, read-gate, runtime-contract, and manifest outputs carry the current availability/default facts.
- The child attribution entrypoint does not supply a public manifest registration; ambient `/claude-cache` remains `feature:attribution`.
- Manifest v2 changes are additive for existing consumers: no old surface ID was removed, all 31 old surface contracts are unchanged after ignoring provenance plus new availability/default fields, and the sole new ID is `shortcut:ctrl+alt+b`. New root fields are `configuration_variants` and `default_public_surface_ids`.
- Payload closure passed with 108 files. `reports/features/**` does not ship. The new child entrypoint and config source do ship.
- F1 model-role/tradeoff prose is unchanged; only generated availability and genuine child-attribution/feature context changed.
- No attestation receipt was added. Advisory state remains visibly non-passing for eight behavioral owners.

## Frozen state and hashes

```text
HEAD                 e3c0b065c52862e3889c9c5c24841a9d162fb338
HEAD tree            6a2aae74884072abd94bbbc3cf6f891ef43632f8
implementation       da2f6fccfc4014f3310c63d7c6ad530f4ab3374d
implementation tree  a26e8fb0c3d25d4c5359a44c8ad5b8f3bb8660a7
base                  bc25e9a8d8be74bd38899e56bb7ab2266629969c
base tree             291c89a0ef32bb3184644d492d2f225b23ad62b0
merge-base            bc25e9a8d8be74bd38899e56bb7ab2266629969c
```

Key SHA-256 values:

```text
4277a344dce362e075c4603d6cb7338fb23bed7eed73a7ae4c0c3a536dcc7afb  scripts/docs/lib.mjs
76eb7bf54c7aefac1dac540a852016003e1bb3d636e03f73beb01c300d6bab8b  scripts/docs/selftest.mjs
24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111  src/core/config.ts
0366d4a353ecd0cea88b71c378f8eb379b06eed6e653fd0e066155fbb1c70131  docs/manifest.json
```

The six worker evidence-log hashes match `reports/features/report.md`; this review treated those logs as inspected evidence, not as an independent verdict. `da2f6fc..HEAD` changes only the worker report/evidence files; production/docs/tests bytes at HEAD equal the implementation commit.

## Commands run

All mechanical commands used:

```text
PATH=/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin:$PATH
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/feature-docs-review
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/feature-docs-review
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/feature-docs-review
```

| Command | Exit / result |
| --- | --- |
| route environment inspection | 0; `openai-codex/gpt-5.6-sol`, reasoning `max` |
| frozen commit/tree/merge-base and SHA-256 inspection | 0 |
| `git diff --check bc25e9a..da2f6fc` | 0 |
| `npm run docs:verify` | 0; 32 surfaces, 52 sources, deterministic |
| `npm run test:docs` | 0; 6/6 |
| `npx --no-install tsx --test tests/unit/config.test.ts` | 0; 4/4 |
| `npm run payload:check` | 0; 108 files |
| scratch `manifest-matrix.mjs` | 0; 16 profiles × 3 shortcut states |
| scratch `generated-truth-check.mjs` | 0; 32 surfaces / 52 exact source owners / 17 variant rows |
| retained `reports/feature-docs-review/decisive-repro.mjs` | 0; reproduced all three extractor/runtime mismatches above |
| final package status/diff boundary inspection | 0; only the pre-existing untracked `node_modules` symlink |

No full repository/root suite, full SDK suite, model call, network action, install, push, publish, or source mutation was performed. Native Windows, compiled Bun, PTY behavior, and full release qualification were outside this docs-only review. Worker SDK logs (8/8 feature selection and 19/19 config/child checks) were read and hash-checked but not duplicated.

## Route and cleanup

Effective review route was `openai-codex/gpt-5.6-sol` with `PI_REASONING_LEVEL=max`. Peak owned scratch remained far below 150 MiB. No model call, watcher, server, or long-lived background worker was launched; final cleanup removed owned temporary logs/caches, retained only the bounded report/repro, and left zero review-owned child processes. The package worktree was not edited; its only untracked item remains the pre-existing read-only `node_modules` symlink.
