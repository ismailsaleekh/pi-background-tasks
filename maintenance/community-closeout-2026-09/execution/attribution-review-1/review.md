# Independent A1+A2 attribution review

## Verdict

**Findings present; do not treat `8d55ae57c4ed6535ded1326b75cb08142d9926b8` as closure-ready for #14/#19 yet.**

Reviewed frozen commit `8d55ae57c4ed6535ded1326b75cb08142d9926b8` against `14afc33e3967a142758169d3217a4e63b4b3ec94` in the standalone package worktree. Effective review route was observed, not inferred: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.

## Findings

### HIGH — A syntactically valid receipt attached to a changed latest assistant is still treated as trusted, so recovery keeps a stale response chain

**Locations:** `src/core/anthropic-attribution.ts:2134-2149`, `src/core/anthropic-attribution.ts:2168-2173`, `src/core/anthropic-attribution.ts:2201-2238`; test gap at `tests/sdk/anthropic-attribution-lifecycle.test.ts:86-110,235`.

`targetLineageState()` labels the latest target-model assistant receipt `trusted` after parsing and checking only `source_model`. It does **not** bind that receipt back to the assistant's actual `provider`, `api`, non-empty/equal `responseId`, successful terminal state, or `assistant_content_sha256`. Those checks happen later only while deciding whether to replay that individual assistant's thinking; `prepareAnthropicLineageDetails()` independently reuses the unverified receipt for `previous_message_id` and epoch selection.

Consequently, if reload/resume reconstruction or an integrity edit changes the **latest** assistant body but leaves its valid-shaped receipt attached:

1. the receipt's request-prefix hash still matches, because it describes the request *before* that latest response;
2. the implementation does not open a non-inheriting reset epoch;
3. it sends the changed history with the old latest `previous_message_id`; and
4. an older signed block from that epoch can reappear.

The direct repro produced:

```json
{"thirdStopReason":"stop","previousMessageId":"msg_2","signatures":["sig-msg_1"],"expectedSafeBoundary":{"previousMessageId":null,"signatures":[]}}
```

The real SDK repro used the package's actual `DefaultResourceLoader`, a persistent session, `SessionManager.open(..., reason:"resume")`, and removal of the latest persisted thinking block. A mock of Fable's strict prefix rejection then showed two successive public failures, both still chained to `msg_2`:

```json
{"previousMessageIds":["msg_2","msg_2"],"publicStopReasons":["error","error"]}
```

This recreates the permanent-failure shape #14 is meant to remove. The committed lifecycle test misses it because `removeFirstPersistedThinking()` deliberately changes the **earlier** assistant; that invalidates the latest receipt's request-prefix hash and takes the working reset path.

**Repros:**

- `repro-latest-receipt.mts` / `repro-latest-receipt.log`
- `repro-latest-receipt-sdk.mts` / `repro-latest-receipt-sdk.log`

Both exited 0 while reporting the unsafe observed behavior.

**Remedy direction:** Before a receipt can select a lane or authorize `previous_message_id`, validate its basic binding to the containing assistant: exact Anthropic source tuple/model, accepted successful stop reason, non-empty equal response ID, and exact assistant-content hash. Treat a mismatch as an explicit integrity error or as the documented deterministic untrusted/non-inheriting boundary; either policy must clear chaining and suppress all prior-epoch signed/redacted blocks. Add a real resume test that mutates the latest response and proves a retry cannot remain pinned to the stale receipt. Also reject empty required receipt IDs during field narrowing.

### MEDIUM — The non-target context validator rejects Pi 0.86's real provider context before transport

**Locations:** `src/core/anthropic-attribution.ts:2688-2728`, especially `isBuiltInForwardingContext()` at line 2713; coverage uses only the old shape in `tests/fixtures/anthropic-forwarding-loader.ts` and `tests/unit/anthropic-attribution-forwarding.test.ts:70-126`.

Pi 0.86's public provider contract passes a normalized `TranscriptContext`: prompt/tool state is represented by `role:"system"` messages. The implementation validates only `user`, `assistant`, and `toolResult` messages and imports/types the older top-level `Context` shape. Through the installed global Pi 0.86.0 `DefaultResourceLoader`, a legitimate MiniMax request with a leading system message returned:

```json
{"hostPiVersion":"0.86.0","loader":"DefaultResourceLoader","stopReason":"error","errorMessage":"Anthropic attribution could not delegate non-target provider \"minimax\": non-target anthropic-messages context is missing required host SDK fields","fetchCalls":0}
```

Thus the worker's global-0.86 `--list-models` load check does not qualify actual forwarding. This does not prove a failure on the package's currently declared 0.81–0.84 peer lines; it is a concrete compatibility blocker if the integration candidate is expected to operate on the installed 0.86 host or widen support.

**Repro:** `repro-forwarding-pi086.mts` / `repro-forwarding-pi086.log` (exit 0).

**Remedy direction:** Bridge the host's actual provider context rather than enforcing a frozen local approximation. Support the old `Context` contract on declared old lines and normalized transcript/system-message contexts on newer hosts, while invoking the adapter from the matching host SDK version. Add a mocked-fetch request through the real 0.86 loader (MiniMax and Kimi), not merely extension discovery. Otherwise explicitly keep 0.86 unsupported and avoid using its loader-only success as forwarding evidence.

### MEDIUM — The forwarding event adapter is lossy on declared versions

**Locations:** `src/core/anthropic-attribution.ts:2770-2867`, especially `localForwardedMessage()` at line 2797.

Instead of relaying the host stream, the wrapper reconstructs every content block, message, and event through a fixed allowlist. The installed/cached 0.81–0.84 Anthropic adapters legitimately report `usage.reasoning`; the wrapper omits it. A no-network 0.84 request reported five thinking tokens in the provider event, but the package result lost them:

```json
{"fetchCalls":1,"provider":"minimax","output":7,"forwardedReasoningUsage":null,"adapterReportedReasoningUsage":5}
```

The same reconstruction also drops newer legitimate fields such as `providerThinkingLevel`, `endTurn`, and tool-call `namespace` when present, and replaces the host's shared live `partial` object with a new snapshot per event. This contradicts the unchanged-forwarding contract and makes the adapter brittle as Pi evolves.

**Repro:** `repro-forwarding-usage.mts` / `repro-forwarding-usage.log` (exit 0).

**Remedy direction:** Return or pipe the host `AssistantMessageEventStream` without reserializing it (the installed Pi custom-provider example forwards events directly), or use a lossless structural bridge that preserves every field and the live partial-object semantics. Add result/event/error tests for reasoning usage, current optional fields, tool metadata, and partial identity—not only a text-only success.

## Checks and counter-evidence

Common mechanical environment was `GIT_ALLOW_PROTOCOL=file PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1` with review-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR`.

| Command/check | Exit / result |
|---|---|
| `shasum -a 256 -c evidence/SHA256SUMS` from the frozen maintenance directory | 0; all 49 entries OK (`frozen-evidence-hashes.log`) |
| `./node_modules/.bin/tsx --test tests/unit/anthropic-attribution.test.ts tests/unit/anthropic-attribution-lineage.test.ts tests/unit/anthropic-attribution-config.test.ts tests/unit/anthropic-attribution-forwarding.test.ts` | 0; 41/41 pass (`focused-unit.log`) |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/anthropic-attribution-lifecycle.test.ts` | 0; 1/1 pass (`focused-sdk.log`) |
| `./node_modules/.bin/tsx reports/attribution-review/verify-lineage-blocks.mts` (absolute report path used) | 0; foreign visible text retained, foreign opaque/redacted omitted, and trusted empty/redacted/non-BMP blocks replayed exactly (`verify-lineage-blocks.log`) |
| `npm run typecheck` | 0 (`typecheck.log`) |
| `npm run test:type-safety` | 1; only the known branch-owned regex false positive on the prose word `any` at source line 93; 1/2 pass (`type-safety.log`) |
| forbidden-cast/import scan plus `git diff --check 14afc33..8d55ae5` | 0; the lineage double assertion, `new Function`, and unexported `/anthropic` subpath are absent (`static.log`) |
| explicit → provider env → process env → home account-path probe | 0, all precedence assertions pass (`config-precedence.log`) |
| direct cached `@earendil-works/pi-ai/compat` import/factory probe for 0.81.1, 0.82.1, 0.83.0, 0.84.0 | 0 for all four (`pi-ai-compat-runtime-evidence.log`) |
| direct `anthropicMessagesApi().streamSimple` mocked-fetch probe for those four versions | 0 for all four, one fetch and successful MiniMax result each (`pi-ai-compat-direct-stream-evidence.log`) |
| registry-sentinel probe followed by direct factory call | 0; `registryCalls=0`, `fetchCalls=1` (`pi-ai-direct-no-registry.log`) |

The 0.81–0.84 compatibility probes used pre-existing npm-cache tarballs (hashes in `pi-ai-compat-cache-evidence.log`) and the existing read-only dependency tree; they made no install or network request. They qualify the exported compat/factory surface and direct dispatch, not the complete Pi/coding-agent matrix. The implementation correctly avoids the old unexported subpath and registry recursion. The focused request also showed no Claude billing/session/endpoint rewrite on the MiniMax route. Account-path behavior and child inheritance passed; no account contents were put into environment variables or logs. The field-by-field lineage parser removed the actual double assertion without a replacement `as unknown as`/`as any` escape.

The owning contract deliberately defines independent per-target-model lanes. I treated an away/back model replay as non-stale only when its successful lane and exact prior wire prefix remain proven; cache/profile/history return tests correctly keep non-inheriting epochs. Finding 1 is different: the selected latest receipt no longer proves the containing assistant at all.

Source and changed-file SHA-256 values are retained in `source-hashes.txt`; primary source SHA-256 is `4dde8a53b8ea202250bd48e149efcbf4e875a1931f6c791d36e119d5f76d9657`.

## Review limits and known integration items

- Host: Darwin 24.6.0 arm64, Node 24.16.0; package Pi 0.84.0; installed global Pi 0.86.0.
- No live model/provider request, external network access, GitHub action, install, publish, push, tag, semantic attestation, or real user config/session access occurred.
- I did not rerun a Bun compile. I inspected the worker's Node/Bun 1.3.4 real-0.84-loader evidence; it is not official vendor-binary qualification. No native Windows test was available.
- No full/default package suite or packed-install matrix was run. Generated docs remain intentionally stale for integrator generation. The type-safety regex false positive and generated-doc failure are known integration work, not findings against this lane's owned behavior.
- Existing tests plus the independent block probe exercise foreign visible/redacted reasoning, trusted empty/redacted/non-BMP blocks, malformed receipts, middleware mutations, concurrency, HTTP failure, and strict EOF. The blocking latest-assistant case above is distinct from those passing controls.

## Provenance and cleanup

- Commit under review: `8d55ae57c4ed6535ded1326b75cb08142d9926b8`.
- Comparison base: `14afc33e3967a142758169d3217a4e63b4b3ec94`; merge-base equals that base.
- Contributor heads/credit in the commit match frozen PR #17 (`9b46c9dd...`, LordMelkor) and PR #12 (`31c1de4e...`, Dev Agent).
- Worktree source was not modified. Final status remains only the pre-existing untracked `node_modules` symlink.
- Review-owned scratch roots `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/attribution-review` were removed after retaining small logs/repros. Cached-package extracts and dependency symlinks were removed with that scratch.
- Review-launched live subprocesses at closeout: **0**. A broad process probe briefly observed an unrelated concurrent `launcher` lane (`TMPDIR/HOME/agent` under `*/launcher`); it was not owned, signalled, or modified. No review-owned Bun executable, server, watcher, child Pi, temporary install, or worktree was left behind.
