# Independent attribution correction review 2

## Verdict

**One blocking portability finding remains.** The three substantive runtime findings from the first review are resolved at `f9ee1f5ddb3e8f14e9aedac31e5eb455297891a6`, but the new Pi 0.86 qualification fixture makes the ordinary repository typecheck depend on this machine's absolute global installation. Do not treat this correction as closure-ready until that fixture is made optional/portable without moving it out of normal TypeScript checking.

Reviewed ancestry is exactly:

```text
8d55ae57c4ed6535ded1326b75cb08142d9926b8
  -> e6d757e0be87fcf714255f02e15d6209de84edf5
  -> f9ee1f5ddb3e8f14e9aedac31e5eb455297891a6
```

The observed review route was `openai-codex/gpt-5.6-sol`, reasoning `max`.

## Remaining finding

### HIGH — The normal package typecheck is coupled to one developer's absolute global Pi 0.86 layout

**Locations:**

- `tests/fixtures/anthropic-forwarding-pi086.ts:3-6`
- `tests/fixtures/anthropic-forwarding-pi086.ts:7-12`
- `tests/fixtures/anthropic-forwarding-pi086.ts:198`
- `tsconfig.json:13`
- `package.json:51`

The fixture statically imports both the coding-agent and its nested pi-ai dependency from `/usr/local/lib/node_modules/...`. Because normal `tsconfig.json` includes `tests/**/*.ts`, ordinary `npm run typecheck` must resolve those external files even when nobody requested Pi 0.86 qualification. A normal checkout with its declared local Pi 0.84 development dependencies but no global package at that exact Unix prefix therefore fails. This also cannot work as written on Windows, an NVM/global prefix, or a valid installation whose pi-ai dependency is hoisted rather than nested.

This is not a hypothetical path-style concern:

- On this machine, `npm run typecheck` exits 0 because those exact paths happen to contain Pi/pi-ai 0.86.0.
- `portability-typecheck-probe.mjs` runs the real TypeScript 5.9 compiler over the normal parsed `tsconfig`, while modeling only the absence of that unrelated `/usr/local` installation. It confirms that the fixture is a normal root file and produces exactly two `TS2307` diagnostics at lines 6 and 12. See `portability-typecheck-probe.log`.
- The fixture has no supplied host-package path. Its reported `hostPiVersion: '0.86.0'` is a literal at line 198 rather than a value checked from the package it loaded, so a compatible later package at the hard-coded location could also be mislabeled as 0.86 evidence.

A correction should keep the fixture's own source under normal `.ts` checking, but resolve an explicitly supplied host package only in the opt-in qualification invocation, verify that package's actual version/layout, and fail loudly when that requested host is unavailable. The default cross-platform package typecheck must not require an undeclared global installation.

## Resolution of the first review's findings

### 1. Latest-assistant receipt binding and recovery — RESOLVED

`parseAnthropicLineageDetails()` now rejects blank source/response IDs and blank non-null previous IDs (`src/core/anthropic-attribution.ts:1511-1579`). `lineageBindsContainingAssistant()` (`:1581-1595`) requires the exact Anthropic provider/API/model, a successful terminal state, equal nonblank assistant/receipt response IDs, and the current assistant-content hash.

That same predicate protects both authority paths:

- signed/redacted replay in `isTrustedReplayableAnthropicAssistant()` (`:1675-1702`); and
- lane selection/chaining in `targetLineageState()` (`:2167-2199`).

The latest relevant malformed/missing/mismatched receipt returns an immediate untrusted state; it cannot search backward to revive an older receipt. The derived non-inheriting epoch removes prior signatures and clears `previous_message_id`. A complete successful response then anchors that epoch, allowing the next unchanged turn to chain normally.

Executed evidence:

- Focused attribution tests: **53/53 pass**, including source/API/model/state/content/ID mutations, missing/malformed latest receipts, reset/re-anchor, strict EOF, middleware protection, and concurrency.
- Actual package-0.84 SDK lifecycle: **1/1 pass**. A persistent JSONL session is reloaded, the latest persisted assistant is changed, `SessionManager.open(..., reason: "resume")` reconstructs it, and the two resumed turns assert `[null, "msg_lifecycle_3"]`; both complete successfully.
- The first review's direct repro now reports `previousMessageId:null` and `signatures:[]`.
- The first review's SDK repro now observes `[null,"msg_3"]`, not repeated stale `msg_2`. Its second public result is intentionally still an error because that old repro's mock rejects *every* non-null ID after resume, including the legitimate new `msg_3`; the committed lifecycle regression uses the correct stale-only rejection and proves both resumed requests complete.
- Independent `receipt-policy-probe.mts` confirms the intended distinction: a failed/aborted attempt **without** a lineage receipt is retry-skippable and retains the prior proven chain; a failed message **with** a receipt is an untrusted boundary (`previous_message_id:null`, no signatures). A whitespace-only receipt ID likewise resets, and a whitespace-only transport response ID fails with no persisted lineage.

Receipt persistence remains after strict SSE completion only (`message_start`, nonblank ID, closed blocks, terminal stop, and `message_stop`, at `:2868-3141`). Protected metadata/cache topology and the per-session/model in-flight guard remain exercised by the green focused suite.

### 2. Host 0.84/0.86 context forwarding — RESOLVED within the stated narrow qualification

For a non-target provider, `forwardToBuiltInAnthropic()` (`src/core/anthropic-attribution.ts:2677-2696`) passes the original model, context, and options directly to the host-aliased `anthropicMessagesApi().streamSimple`. It no longer validates or rebuilds a package-owned transcript shape. Installed Pi 0.86's loader source confirms that extension imports of `@earendil-works/pi-ai/compat` are aliased to that host's own SDK implementation.

Executed evidence:

- Package Pi 0.84 `DefaultResourceLoader`: one mocked MiniMax fetch, reasoning usage `4`, and shared partial/result identity; exit 0.
- Bun 1.3.4 local compile of that real 0.84 loader: build and run exit 0 with the same result; the 72,004,688-byte executable was removed.
- Actual global Pi/pi-ai 0.86.0 `DefaultResourceLoader` plus its `normalizeContext()`: MiniMax and Kimi both complete through two mocked fetches; leading system/tool state reaches each payload, reasoning usage is `[1,1]`, Kimi retains `providerThinkingLevel:"high"`, callbacks receive the exact model objects, and no target-only Claude metadata/header rewrite appears.
- The original 0.86 failure repro now reaches mock fetch (`fetchCalls:1`) instead of failing the old context validator. Its result is an expected connection error because that old repro deliberately throws if fetch is reached; the committed two-route fixture supplies successful SSE.

The package peer range is unchanged at Pi 0.81.1-0.84.x. The 0.86 result is only a narrow forwarding qualification, not a general Pi 0.86 support claim. The portability finding above concerns how that optional evidence was wired into the default compiler gate, not the observed runtime result on this host.

### 3. Lossless host stream forwarding — RESOLVED

The non-target branch returns the host stream object itself (`:2691-2696`). There is no local event/message/content serializer, clone, or registered-provider dispatch. Consequently the host owns events, terminal settlement, callbacks, usage, and future optional fields.

Executed evidence includes:

- reasoning usage `5` now survives the first review's lossy-forwarding repro;
- one shared live partial is identical across start/delta/end, terminal event, and `.result()`;
- representative optional response fields and tool `namespace` survive on that same object;
- the error event and `.result()` carry the identical assistant object;
- payload/response callbacks receive the original model object; and
- static scans find no `localForwarded*`, eval/new-Function, unexported Anthropic subpath, or registry dispatcher.

The four host-boundary assertions at `:2692-2696` are single, narrow intersections around objects that are immediately passed to/returned from the matching host factory. They do not fabricate or inspect fields. Added-line scans find no double assertion, `as any`, explicit top-type annotation, or compiler suppression. The branch's `test:type-safety` failure is solely the already-known old regex matching the prose word “any” in the pre-existing projection-version comment at source line 91.

## Executed checks

All commands used `GIT_ALLOW_PROTOCOL=file`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, and review-owned HOME/TMPDIR/agent roots. npm was invoked as `/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/npm`; no install command was run.

| Check | Result | Log |
|---|---:|---|
| Four focused attribution unit files | exit 0; 53/53 | `focused-unit.log` |
| Persistent reload/reopen/resume SDK lifecycle | exit 0; 1/1 | `focused-lifecycle.log` |
| Independent failed-receipt/blank-ID policy probe | exit 0 | `receipt-policy-probe.log` |
| Original latest-receipt repro | exit 0; null chain, no signatures | `original-repro-latest-receipt.log` |
| Original persistent SDK repro | exit 0; stale `msg_2` gone; old mock rejects legitimate second chain as described above | `original-repro-latest-receipt-sdk.log` |
| Original lossy-usage repro | exit 0; reasoning 5 retained | `original-repro-forwarding-usage.log` |
| Original 0.86 validator repro | exit 0; reaches fetch once | `original-repro-forwarding-pi086.log` |
| Real package-0.84 Node loader | exit 0 | `loader-pi084-node.log` |
| Bun 1.3.4 compile and run of package-0.84 loader | exits 0/0; binary removed | `loader-pi084-bun-{build,run}.log` |
| Actual global-0.86 MiniMax/Kimi loader fixture | exit 0; 2 fetches | `loader-pi086-global.log` |
| Normal `npm run typecheck` on this host | exit 0 | `typecheck-current-host.log` |
| Normal compiler with only `/usr/local` host absent | probe exit 0 after asserting two TS2307 failures | `portability-typecheck-probe.log` |
| Focused forbidden-pattern scan + `git diff --check` | exit 0 | `static-and-diff.log` |
| Branch `npm run test:type-safety` | exit 1; 1/2, known old prose-regex false positive only | `type-safety-branch.log` |
| `git show --check` for both follow-ups | exits 0/0 | observed during review |

Core executed command forms were:

```text
/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx --test tests/unit/anthropic-attribution.test.ts tests/unit/anthropic-attribution-lineage.test.ts tests/unit/anthropic-attribution-config.test.ts tests/unit/anthropic-attribution-forwarding.test.ts
/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/anthropic-attribution-lifecycle.test.ts
/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx tests/fixtures/anthropic-forwarding-loader.ts
/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx tests/fixtures/anthropic-forwarding-pi086.ts
/Users/lizavasilyeva/.bun/bin/bun build tests/fixtures/anthropic-forwarding-loader.ts --compile --outfile <owned-TMPDIR>/anthropic-forwarding-loader-bun
/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/npm --prefix /private/tmp/pi-bg-closeout-iNoltL/attribution run typecheck
/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/npm --prefix /private/tmp/pi-bg-closeout-iNoltL/attribution run test:type-safety
/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/node /private/tmp/pi-bg-closeout-iNoltL/reports/attribution-review-2/portability-typecheck-probe.mjs
```

The original repro and independent policy scripts were each executed with the same absolute package `tsx` binary; their absolute script paths are recorded in their logs.

Reviewed file SHA-256 values:

```text
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
f45771d2c5a2b9f1c66b3285fa9a969b962020c5371048a3f2dddb91506968f8  tests/fixtures/anthropic-forwarding-pi086.ts
cb37fb00fb149ebdd762eb7fdf557b8fac8625258519ff7d753f050f14339dc3  tests/fixtures/anthropic-forwarding-loader.ts
d6eb3a2a242f542f6565ab380b4cacf544d6d4a1a95f1f7852a5b6b54ea86d86  tests/unit/anthropic-attribution-lineage.test.ts
c614233503b52dd098e321011991f03f75ab56fee27f49a5b2566c16984c5f4b  tests/unit/anthropic-attribution-forwarding.test.ts
d035956a50ff6da28bb1c119c3281916dd057cddd57504b0aa7326e63bad3bee  tests/sdk/anthropic-attribution-lifecycle.test.ts
```

Exact runtime versions are in `environment-and-shas.log`.

## Portability and qualification limits

- Host: Darwin 24.6.0 arm64, Node 24.16.0, npm 11.13.0, Bun 1.3.4.
- A real package Pi 0.84 loader was run in Node and a locally compiled Bun executable. Full loader/lifecycle qualification was not rerun for 0.81.1, 0.82.1, or 0.83.0.
- Global Pi/pi-ai 0.86.0 was exercised only for the two mocked non-target forwarding routes. The peer range was not widened.
- No official vendor-compiled Pi binary, native Windows host, or full version matrix was available; those remain unqualified.
- No live model/provider call, network/GitHub access, real user auth/config/session state, install, publish, push, tag, full/default programme suite, or semantic documentation attestation occurred.
- Generated-doc/source-line staleness and the branch-old type-safety regex are the stated integrator-owned items; this review did not regenerate or attest docs.

## Source integrity and cleanup

Source/tests/docs/index/history were not edited. Final worktree status remains only the pre-existing untracked read-only `node_modules` symlink. Review-owned probes and logs are confined to this report directory.

The disposable Bun executable is absent. Exact review-owned `tmp`, `home`, and `agent` roots were removed (0 bytes retained). The closeout process scan found only the mandated active Pi wrapper/runtime for this review and **zero review-launched test/server/watcher/compiled-binary children**. See `cleanup.log`.
