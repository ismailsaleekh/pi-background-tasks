# Attribution qualification fixture portability report

## Result

The remaining fixture-portability finding is corrected in follow-up commit:

```text
94b36743513f5dda8f8114ac860996cd6fc03241  test(attribution): make Pi 0.86 fixture portable
```

It is a direct child of the supplied branch head `f9ee1f5ddb3e8f14e9aedac31e5eb455297891a6`; the merge base is that same commit. No prior commit was rewritten.

Committed paths are exactly:

1. `tests/fixtures/anthropic-forwarding-pi086.ts`
2. `tests/fixtures/anthropic-forwarding-host-resolution.ts`
3. `tests/unit/anthropic-attribution-fixture-portability.test.ts`

Production attribution, package/lock files, tsconfig include lists, configuration behavior, accepted runtime/lifecycle tests, authored/generated docs, and shared testing/state files were not changed.

## Effective route

The Pi session header and closeout environment both identify:

```text
provider:  openai-codex
model:     gpt-5.6-sol
reasoning: max
```

Evidence: `environment.log`.

## Correction

- The normal `.ts` compile graph has no static absolute/global Pi imports.
- The qualification executable now requires `--host-package <explicit path>`. Missing input is an error; there is no local 0.84 or global-prefix fallback.
- The supplied path must belong to exactly `@earendil-works/pi-coding-agent` on the intended `0.86.x` line.
- Its public entry is selected from its package manifest. Its `@earendil-works/pi-ai` is located from the host entry with Node package resolution, then independently checked for exact identity, a valid observed version on `0.86.x`, and a public entry. Synthetic tests prove both nested and hoisted dependency layouts.
- Dynamic module values cross a small runtime-validated structural boundary. The fixture checks `DefaultResourceLoader`, `SettingsManager.inMemory`, `Type.Object`, `Type.String`, `normalizeContext`, provider registration, `streamSimple`, event-stream iteration, and `.result()` before relying on them. It uses no untyped `require`, compiler suppression, explicit `any`, double assertion, or `.mts` escape.
- Version output comes from the resolved package manifests.
- The real host proof retains normalized system/tool state, MiniMax and Kimi mocked forwarding, endpoint/auth/payload protections, callback model identity, provider/model fidelity, event order, shared partial/done/result identity, reasoning usage, and Kimi provider thinking level.

## Red and green compiler-host absence proof

### RED on the unchanged fixture

Command:

```text
node /private/tmp/pi-bg-closeout-iNoltL/reports/attribution-review-2/portability-typecheck-probe.mjs
```

Result: exit `0` from the asserting reviewer probe, with exactly two RED fixture diagnostics:

- `TS2307` at former fixture line 6 for the absolute coding-agent import;
- `TS2307` at former fixture line 12 for the hard-coded nested pi-ai import.

The probe also confirmed the fixture was a normal `tsconfig.json` root. Evidence: `red-portability-typecheck-probe.log`.

### GREEN with the same compiler-host absence simulation

Command:

```text
node /private/tmp/pi-bg-closeout-iNoltL/reports/attribution-portability/portability-typecheck-green-probe.mjs
```

Result: exit `0`; fixture remains in normal tsconfig and has `fixtureDiagnostics: []` while the entire unrelated `/usr/local/.../pi-coding-agent` tree is hidden from the TypeScript compiler host. Evidence: `green-portability-typecheck-probe.log`.

Normal package command:

```text
npm --prefix /private/tmp/pi-bg-closeout-iNoltL/attribution run typecheck
```

Result: exit `0`. Evidence: `normal-typecheck.log`.

## Durable resolution/refusal regression

Command:

```text
/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx --test /private/tmp/pi-bg-closeout-iNoltL/attribution/tests/unit/anthropic-attribution-fixture-portability.test.ts
```

Result: exit `0`, **5/5 tests**. The committed test pins:

- no absolute installation import in the optional fixture;
- mandatory explicit host selection and no default host;
- manifest-selected public entries;
- nested pi-ai resolution;
- hoisted pi-ai resolution;
- missing/malformed/wrong-package/wrong-host-line refusal;
- wrong pi-ai line refusal.

Evidence: `fixture-portability-unit.log`.

Direct opt-in refusal invocations also exited before loader/inference work:

| Case | Exit | Observed refusal |
|---|---:|---|
| no explicit host | 1 | usage requires `--host-package` |
| explicit missing path | 1 | supplied host path does not exist/is unreadable |
| explicit malformed package | 1 | host package manifest is malformed |
| explicit local 0.84 host | 1 | expected `0.86.x`, observed `0.84.0` |
| explicit wrong package | 1 | expected coding-agent identity, observed `pi-background-tasks` |

Evidence: `explicit-refusals-summary.log` and `refusal-*.log`.

## Real supplied-host mocked forwarding proof

Command:

```text
/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/attribution/tests/fixtures/anthropic-forwarding-pi086.ts --host-package /usr/local/lib/node_modules/@earendil-works/pi-coding-agent
```

Result: exit `0`. Manifest-observed runtime identities and versions were:

```text
@earendil-works/pi-coding-agent  0.86.0
@earendil-works/pi-ai            0.86.0
```

The fixture observed two mock fetches, MiniMax and Kimi providers, normalized system/tool payload state, callback fidelity, event sequences `start → text_start → text_delta → text_end → done` for both routes, shared partial/result identity, reasoning usage `[1,1]`, and Kimi `providerThinkingLevel: "high"`. No live provider request occurred. Evidence: `real-host-pi086.log`.

## Integrity and scope

Accepted runtime source remains byte-identical:

```text
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
```

Focused scans found no `/usr/local` or hard-coded nested host layout in the committed fixture/helper/test, no literal reported host version, no compiler suppression, no `as any`, no double assertion, and no `require(...)`. `git diff --check` and `git show --check` passed. Evidence: `static-and-hashes.log`, `commit-and-boundary.log`.

## Remaining environment gaps

- The real supplied proof used the available Darwin arm64 Node 24.16.0 installation with an actual nested Pi/pi-ai layout. Hoisted behavior is proven with package-resolution fixtures, not a second real installed host.
- No native Windows or Linux host was available.
- Only observed 0.86.0 received the real two-route API proof; the code rejects non-0.86 lines, and no later 0.86 patch was present to exercise.
- This remains narrow forwarding qualification, not a Pi peer-range expansion or general 0.86 package certification.
- Per instruction, no broad/default runtime suite, Bun suite, live subscription/provider inference, network, install, user auth/config/session access, docs generation/attestation, Fusion, extra agent, publish, push, or tag operation was run.

## Cleanup and handoff

- Test-launched live children at closeout: `0`.
- Task scratch roots under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/attribution-portability`: removed after evidence capture.
- Retained report directory: 86,016 bytes at final-state measurement (scratch roots excluded).
- Worktree status: clean except the pre-existing untracked read-only `node_modules` symlink.
- Cleanup evidence: `cleanup.log`.

Stopped here for narrow independent fixture verification before branch integration.
