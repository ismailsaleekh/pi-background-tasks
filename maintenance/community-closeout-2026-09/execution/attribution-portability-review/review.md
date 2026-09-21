# Independent attribution fixture portability review

## Verdict

**PASS — the specific remaining portability finding is resolved at `94b36743513f5dda8f8114ac860996cd6fc03241`.**

The normal TypeScript graph retains the Pi 0.86 fixture and compiles without reading or resolving the undeclared `/usr/local` Pi tree. Optional execution now requires an explicit host path, verifies the actual host and pi-ai package identities and `0.86.x` manifest versions, resolves public entries and nested/hoisted pi-ai layouts, and refuses invalid selections before importing host code. The real supplied 0.86.0 host completed the MiniMax/Kimi mocked-forwarding proof with external networking denied.

No remaining severity finding was identified in this narrow scope. This verdict does not reopen the already accepted production-runtime review or claim general Pi 0.86 support.

## Reviewed boundary and route

- Worktree: `/private/tmp/pi-bg-closeout-iNoltL/attribution`
- Base: `f9ee1f5ddb3e8f14e9aedac31e5eb455297891a6`
- Reviewed commit: `94b36743513f5dda8f8114ac860996cd6fc03241`
- Merge base: exactly `f9ee1f5ddb3e8f14e9aedac31e5eb455297891a6`
- Injected route observed before review: `openai-codex/gpt-5.6-sol`, reasoning `max`
- Actual diff: exactly three paths:
  1. `tests/fixtures/anthropic-forwarding-host-resolution.ts` (added)
  2. `tests/fixtures/anthropic-forwarding-pi086.ts` (modified)
  3. `tests/unit/anthropic-attribution-fixture-portability.test.ts` (added)

I read the package gateway, generated index/read gate, package testing operations/docs and test plan, the prior review's sole portability finding, the portability design/report, and the complete three-file diff. No Pi SDK implementation assumption beyond the executed installed host was needed for this fixture-only review.

## Independent findings

### 1. Normal compiler portability — PASS

`tsconfig.json` still includes `tests/**/*.ts`; the fixture was not moved to an unchecked lane. The report-owned compiler-host probe hid the complete former absolute host tree while compiling the ordinary parsed tsconfig and asserted:

- all three reviewed files are normal roots;
- zero diagnostics overall and zero `TS2307` diagnostics;
- zero source files from the hidden global tree; and
- zero attempted compiler-host accesses to that tree.

Observed output:

```json
{"ts2307Count":0,"blockedGlobalSourceFiles":0,"attemptedBlockedPathAccesses":[]}
```

The worker's green absence probe was also re-executed unchanged and returned `fixtureDiagnostics: []`. Normal `npm run typecheck` exited 0.

A focused scan of the three reviewed files found no explicit top-type escape, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, or double assertion. The fixture crosses dynamic module boundaries through `unknown` plus runtime predicates (`anthropic-forwarding-pi086.ts:81-130`), rather than importing host declarations. There is no `/usr/local`, drive-absolute Pi import, or hard-coded nested global layout in any reviewed file.

Evidence:

- `logs/compiler-host-absence.log`
- `logs/reexecuted-worker-compiler-host-absence.log`
- `logs/normal-typecheck.log`
- `logs/static-integrity.log`

### 2. Explicit host selection and package resolution — PASS

The execution ordering is fail-closed for the qualification boundary:

- `parseQualificationHostArgument()` requires exactly `--host-package <path>` (`anthropic-forwarding-host-resolution.ts:170-180`).
- `resolveQualificationHost()` runs before either dynamic import (`anthropic-forwarding-pi086.ts:177-185`).
- Exact package names and observed `0.86.x` manifest lines are checked at `anthropic-forwarding-host-resolution.ts:131-157`.
- The host must declare `@earendil-works/pi-ai`; pi-ai is then found from the selected host entry with Node `findPackageJSON`, permitting nested or hoisted installation (`:183-214`).
- Root public entries are selected from `exports`/`main` and checked as existing package-contained files (`:89-128`), rather than guessed as `dist/index.js`.
- Reported host/pi-ai versions come from the resolved manifests (`anthropic-forwarding-pi086.ts:396-408`), not a fixture literal.

The focused committed regression passed **5/5**. It exercised an entry-file host selection, a nested pi-ai layout, a hoisted pi-ai layout with non-default public entry paths, no-default argument handling, and invalid package refusals.

I additionally drove the executable through 11 refusal cases. Every inner fixture invocation exited 1 as expected, created no package-import sentinel, and recorded zero external network attempts:

- no explicit host;
- missing host path;
- malformed host manifest;
- wrong host package identity;
- wrong host version line (`0.84.0`);
- missing pi-ai dependency declaration;
- missing host public entry;
- missing pi-ai package;
- wrong pi-ai version line (`0.84.0`);
- wrong pi-ai package identity; and
- malformed pi-ai manifest.

This establishes refusal before loader/API execution, not merely a helper error after loading. The scope remains the operator-selected local test host; I did not expand the review into a generic hostile-package resolver audit.

Evidence:

- `logs/fixture-portability-unit.log`
- `logs/explicit-refusal-matrix.log`
- `logs/actual-host-resolution.log`

### 3. Real supplied Pi 0.86 forwarding qualification — PASS

The explicitly supplied host resolved through its public entries to:

```text
@earendil-works/pi-coding-agent  0.86.0
@earendil-works/pi-ai            0.86.0
```

The actual installation was nested; the committed synthetic regression separately proved a hoisted dependency. Both actual manifests expose `exports["."].import`, and the resolver selected those entries.

The fixture was run twice successfully with independent network controls:

1. a report-owned fetch/HTTP(S)/TCP/TLS denial preload recorded zero external attempts; and
2. native macOS `sandbox-exec` ran the fixture under `(deny network*)` and still exited 0.

The two `fetchCalls` in the result are the fixture's in-process mocked MiniMax/Kimi fetches, not external requests. The successful result was:

```json
{
  "hostPiVersion": "0.86.0",
  "piAiVersion": "0.86.0",
  "providers": ["minimax", "kimi-coding"],
  "fetchCalls": 2,
  "normalizedSystemAndTools": true,
  "eventTypes": [
    ["start", "text_start", "text_delta", "text_end", "done"],
    ["start", "text_start", "text_delta", "text_end", "done"]
  ],
  "sharedPartialAndResultIdentity": true,
  "reasoningUsage": [1, 1],
  "kimiProviderThinkingLevel": "high"
}
```

Passing assertions also bind each payload/response callback to the exact model object, preserve provider/model identity and forwarded text, verify normalized leading system/tool state in the actual payload, and require the iterated partial, terminal done message, and `.result()` to be the same object (`anthropic-forwarding-pi086.ts:284-387`).

Evidence:

- `logs/real-host-pi086.log`
- `logs/real-host-network-summary.log`
- `logs/real-host-pi086-os-network-denied.log`
- `logs/environment-and-manifests.log`

### 4. Runtime and change integrity — PASS

The accepted production source is byte-identical at base, reviewed commit, and worktree:

```text
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
```

`git diff --check` and `git show --check` passed. The base-to-head changed-file count is three, exactly the declared fixture/helper/test paths. Final worktree status remains only the pre-existing untracked `node_modules` symlink.

Reviewed file SHA-256 values:

```text
c905f763fa95aef6c19ae08c1ed83914cb6900080e0c63e3f56ca44e5201d0f2  tests/fixtures/anthropic-forwarding-pi086.ts
44fb1db66ebe3e482ace7f232941e685182d0355b7a70801d48bb4c32daf8502  tests/fixtures/anthropic-forwarding-host-resolution.ts
9a9d683b4e8be579e87625729a86295e7ac5d621bb022a5e4aeda96c261b9caf  tests/unit/anthropic-attribution-fixture-portability.test.ts
```

Evidence:

- `logs/actual-3-file.diff`
- `logs/static-integrity.log`
- `logs/runtime-hash-boundary.log`

## Commands and exits

All substantive checks used review-owned HOME/TMPDIR/agent roots plus:

```text
GIT_ALLOW_PROTOCOL=file
PI_OFFLINE=1
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
CI=1
```

No install command was run.

| Check | Command form | Exit/result |
|---|---|---:|
| Independent absent-global compiler host | `node reports/attribution-portability-review/probes/compiler-host-absence.mjs` | 0; all three roots, 0 diagnostics/TS2307/accesses |
| Re-executed worker absence probe | `node reports/attribution-portability/portability-typecheck-green-probe.mjs` | 0; no fixture diagnostics |
| Normal typecheck | `npm --prefix attribution run typecheck` | 0 |
| Focused portability unit | `tsx --test tests/unit/anthropic-attribution-fixture-portability.test.ts` | 0; 5/5 |
| Direct refusal matrix | `node reports/attribution-portability-review/probes/refusal-matrix.mjs` | 0; 11 expected inner exit-1 refusals, no imports/network |
| Actual host resolver | network-denied `node --import tsx ...resolveQualificationHost(...)` | 0 |
| Real host fixture, instrumented network denial | `NODE_OPTIONS=--require=.../deny-network.cjs tsx ... --host-package /usr/local/.../pi-coding-agent` | 0; 0 external attempts |
| Real host fixture, OS network denied | `sandbox-exec -p '(version 1) (allow default) (deny network*)' node --import tsx ... --host-package ...` | 0 |
| Diff/static/hash boundary | focused `git diff/show --check`, scans, SHA-256 comparisons | 0 |
| Cleanup | process scan plus removal of owned HOME/TMPDIR/agent roots | 0 |

Harness note: two preliminary attempts at the report-owned JavaScript network guard exited 1 before fixture execution because the first guard revision also denied TSX's local Unix-domain IPC pipe. The guard was corrected to permit local IPC while denying external fetch/HTTP(S)/TCP/TLS, then passed. The separate OS-level network-denied run avoids reliance on that instrumentation.

## Limits and exclusions

- Host was Darwin 24.6.0 arm64, Node 24.16.0, npm 11.13.0, TypeScript 5.9.3, and tsx 4.22.3.
- The real proof used the available installed JavaScript packages at exactly Pi/pi-ai 0.86.0 with a nested dependency. A real hoisted installation was not available; hoisting was exercised synthetically through Node package resolution.
- No later 0.86 patch, native Windows/Linux host, Bun build/run, or official vendor-compiled Pi binary was available. Package provenance/signature verification was not performed.
- This is a narrow non-target-provider forwarding qualification, not a peer-range expansion or full Pi 0.86 certification.
- Per instruction, I did not rerun the already accepted 53-test production runtime set, broad/default/full package suite, Bun qualification, or the 0.81.1–0.84 matrix.
- No live model/provider request, paid API, real user auth/config/session access, GitHub/network operation, install, publish, push, tag, Fusion, delegated agent, docs generation, or semantic docs attestation occurred.
- Package-wide `test:type-safety` was not rerun; the exact three reviewed files received the focused forbidden-pattern scan, and normal strict typecheck passed.

## Cleanup

The review-owned scratch roots under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/attribution-portability-review` were removed. Process scans before and after cleanup found zero review-launched test/server/watcher children; only the mandated active Pi review harness remained. The retained report tree is far below the 100 MiB cap. Source/tests/docs/index/history were not edited.

Evidence: `logs/cleanup.log`.
