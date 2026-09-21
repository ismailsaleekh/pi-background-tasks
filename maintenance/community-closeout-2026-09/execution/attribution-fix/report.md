# Attribution review corrections report

## Route, branch, and commit

- Effective route observed from the shell before work and again at closeout: `openai-codex/gpt-5.6-sol`, reasoning `max`.
- Worktree/branch: `/private/tmp/pi-bg-closeout-iNoltL/attribution`, `closeout/attribution`.
- Reviewed starting commit: `8d55ae57c4ed6535ded1326b75cb08142d9926b8`.
- Follow-up commits:
  - `e6d757e0be87fcf714255f02e15d6209de84edf5` — `fix(attribution): bind receipts and preserve host streams`.
  - `f9ee1f5ddb3e8f14e9aedac31e5eb455297891a6` — `test(attribution): typecheck Pi 0.86 forwarding proof`.
- Both are ancestry-preserving direct follow-ups (`8d55ae5` → `e6d757e` → `f9ee1f5`); the reviewed commit was not amended or rewritten.
- Parent `8d55ae5` still carries the original PR #17 head/author credit (`9b46c9dd...`, LordMelkor) and PR #12 head/author credit (`31c1de4e...`, Dev Agent), including both `Co-authored-by` trailers.
- Pre-change design: `/private/tmp/pi-bg-closeout-iNoltL/reports/attribution-fix/design.md`.

Committed paths:

1. `src/core/anthropic-attribution.ts`
2. `tests/unit/anthropic-attribution-lineage.test.ts`
3. `tests/sdk/anthropic-attribution-lifecycle.test.ts`
4. `tests/unit/anthropic-attribution-forwarding.test.ts`
5. `tests/fixtures/anthropic-forwarding-loader.ts`
6. `tests/fixtures/anthropic-forwarding-pi086.ts`
7. `docs/subsystems/anthropic-attribution.md`
8. `docs/operations/configuration.md`

No package/lock/peer range, generated documentation, shared test helper/plan/state, launcher, unrelated production module, or read-only shared dependency was changed.

## Corrections by finding

### 1. Latest-assistant receipt binding and recoverable reset

A receipt now becomes trusted only when it binds to its containing assistant across all authority-bearing fields:

- exact provider `anthropic`, API `anthropic-messages`, and model;
- terminal success state `stop`, `length`, or `toolUse`;
- non-blank and equal assistant/receipt response IDs;
- exact assistant-content SHA-256.

Receipt parsing also rejects a blank source model, response ID, or non-null previous response ID. The same binding predicate gates both lane/`previous_message_id` selection and signed/redacted replay.

A latest relevant assistant with a missing, malformed, or mismatched receipt derives the existing deterministic `untrusted-lineage-reset` boundary. It cannot fall backward to an older lane receipt: chaining is null and the non-inheriting reprojection converts visible old reasoning to text while omitting stale signed/redacted blocks. A failed/aborted attempt with no receipt remains skippable so legitimate retry recovery still works. Re-anchoring still occurs only after strict successful SSE completion. Existing middleware topology, concurrency, account/session/route, and strict SSE tests remain green.

The persistent lifecycle regression now shuts down a real SDK session, removes thinking from the **latest** persisted assistant, reopens with `SessionManager.open(..., reason:"resume")`, and uses a strict mock that rejects stale `msg_lifecycle_2` chaining. Reviewed code attempted `['msg_lifecycle_2', 'msg_lifecycle_2']`; fixed code sends `[null, 'msg_lifecycle_3']`, succeeds on both resumed turns, suppresses stale signatures on the reset, and replays only the new trusted signature on the next turn.

### 2. Actual old/new host forwarding contexts

The package-owned context/message validator was removed. Non-target traffic passes the model, context, and options objects unchanged to `anthropicMessagesApi().streamSimple` from `@earendil-works/pi-ai/compat`.

Pi's extension loader aliases that import to its own SDK version in ordinary Node and bundled runtimes. Consequently:

- declared old hosts continue to supply their legacy top-level `Context` contract;
- installed Pi 0.86 supplies its normalized `TranscriptContext` with `role:"system"` prompt/tool state;
- the direct factory is the matching host implementation, not the registered global dispatcher, so there is no recursion;
- no eval/new-Function import or unexported package subpath exists.

The peer range remains exactly the declared 0.81–0.84 range. This change does not claim general 0.86 support or widen metadata.

### 3. Lossless host stream/result/event forwarding

The fixed serialization allowlist and local forwarding stream were deleted. The non-target branch returns the host stream itself. This preserves by identity:

- every event and terminal message;
- the shared live `partial` object;
- reasoning usage and future usage members;
- response optionals and diagnostics;
- tool-call metadata;
- payload/response callbacks and original model identity;
- host done/error settlement.

The focused regression uses the real 0.84 adapter with mocked SSE and observes reasoning usage `5`, signed thinking, text, tool arguments, `responseId`, and `rawStopReason`. It also adds representative host-owned optional fields (`providerThinkingLevel`, `endTurn`) and tool `namespace` to the live object during streaming and proves they remain on the exact terminal/result object. The error test proves one error terminal and that `.result()` resolves to that same error message. Success callbacks see the original model object.

The source uses narrow intersection assertions only at this host-aliased cross-version boundary. There is no double assertion, explicit top-type escape, event clone, payload clone, dispatcher lookup, or compatibility framework.

## Red evidence on `8d55ae5`

Tests/fixtures were added first while production remained at reviewed commit `8d55ae5`. Common environment for every command was:

```text
GIT_ALLOW_PROTOCOL=file
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/attribution-fix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/attribution-fix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/attribution-fix
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
```

| Finding | Command | Red result |
|---|---|---|
| Receipt/content/ID/state binding | `/private/tmp/pi-bg-closeout-iNoltL/attribution/node_modules/.bin/tsx --test /private/tmp/pi-bg-closeout-iNoltL/attribution/tests/unit/anthropic-attribution-lineage.test.ts` | exit 1; **24/33 passed, 9/33 failed**. Changed latest content and provider/API/model/state/response-ID/blank-ID mutations retained stale chaining (`msg_2`, including one empty ID) instead of null. `red-lineage.log`. |
| Persistent latest-response resume | same `tsx`, `--test --test-concurrency=1 tests/sdk/anthropic-attribution-lifecycle.test.ts` | exit 1; **0/1 passed**. Two resumed requests were `['msg_lifecycle_2','msg_lifecycle_2']`. `red-lifecycle-latest.log`. |
| Lossless forwarding | same `tsx`, `--test tests/unit/anthropic-attribution-forwarding.test.ts` | exit 1; **2/5 passed, 3/5 failed**. Fixed serializer still existed, reasoning usage was `undefined` instead of `5`, and partial identities differed. `red-forwarding-lossless.log`. |
| Real Pi 0.86 transcript | same `tsx`, `tests/fixtures/anthropic-forwarding-pi086.mts` (the red-run name; committed as typechecked `.ts`) | exit 1; **0/2 routes completed**. MiniMax failed before transport with `non-target anthropic-messages context is missing required host SDK fields`; Kimi was not reached. `red-forwarding-pi086.log`. |

These are permanent attribution-specific tests/fixtures, not report-only repro scripts.

## Green evidence

All commands used the same isolated/offline environment above. No command made a live provider request; every transport was mocked.

| Check | Result |
|---|---|
| Four focused attribution unit files | exit 0; **53/53 tests**, 4/4 suites. This includes all reviewed **41/41** tests plus 12 correction regressions. `green-attribution-unit.log`. |
| Real persistent Pi lifecycle | exit 0; **1/1** using actual package-0.84 `DefaultResourceLoader`, `AgentSession.reload()`, persisted JSONL, shutdown, `SessionManager.open()`, and resume. `green-attribution-lifecycle.log`. |
| Real package-0.84 Node loader fixture | exit 0; one mocked MiniMax fetch, legacy `systemPrompt`/`tools` context, reasoning usage `4`, shared partial identity true. `green-forward-loader-node.log`. |
| Bun 1.3.4 compiled loader | build exit 0 (2,980 modules; disposable 72,004,688-byte binary), run exit 0; actual package-0.84 `DefaultResourceLoader`, one fetch, reasoning usage `4`, shared partial identity true. Binary removed. `green-forward-loader-bun-{build,run}.log`. |
| Real installed Pi 0.86 loader | exit 0; actual global-0.86 `DefaultResourceLoader` plus host `normalizeContext`; MiniMax and Kimi both completed, **2 mocked fetches**, leading system/tool state retained, reasoning usage `[1,1]`, Kimi `providerThinkingLevel:"high"`, exact callback model identity, and no Claude attribution rewrite. `green-forwarding-pi086.log`. |
| TypeScript | `npm --prefix /private/tmp/pi-bg-closeout-iNoltL/attribution run typecheck`; exit 0, including the installed-0.86 `.ts` fixture and its concrete host SDK types. `green-typecheck.log`. |
| Focused package contract | exit 0; **1/1** package-owned attribution test. `green-package-attribution.log`. |
| Payload closure | exit 0; **106** packed files satisfy policy. `green-payload-check.log`. |
| Forbidden-pattern/direct-adapter scan + `git diff --check` | exit 0; no double/top assertion pattern, eval/new-Function, unexported `/anthropic` import, forwarding serializer, or context validator. `green-static-and-diff.log`. |
| Commit checks | `git show --check e6d757e` and `git show --check f9ee1f5` exit 0; merge-base with reviewed commit is `8d55ae5`, with two follow-up commits. |

### Real old/new contract and stream proof

- **Old contract:** the package's installed 0.84 `DefaultResourceLoader` exercised the legacy context through both Node and a locally compiled Bun executable. The adapter returned one shared partial/result object and retained reasoning usage/tool content.
- **New contract:** the globally installed 0.86 loader and its own `normalizeContext()` created a leading system message with `toolsAdded`; both MiniMax and Kimi reached the matching 0.86 host adapter and mock fetch.
- **Losslessness:** direct host stream return is mechanically pinned by source scan, identity assertions across start/delta/end/done/result, optional/tool metadata retention, reasoning usage, callback identity, and error settlement.

## Expected integration-owned gate results

- `npm run test:type-safety`: exit 1, **1/2 passed**. The sole result remains the known independently owned regex false positive on the prose word `any` in the pre-existing projection-version comment (now source line 91). No new explicit top type, compiler suppression, non-null production bypass, or double assertion was added. `type-safety.log`.
- `npm run docs:verify`: exit 1 because generated `docs/commands/claude-cache.md` provenance remains stale after attribution source movement. Generated docs/index/read-before-edit/manifest were intentionally not hand-edited; the integrator owns `docs:generate` and reconciliation. `docs-verify.log`.

## Remaining platform/version gaps

- The package still declares Pi 0.81.1–0.84.0. This lane ran a real 0.84 loader. Reviewer cache evidence established the direct compat factory exists on 0.81.1/0.82.1/0.83.0, but those lines did not receive full loader/lifecycle qualification here.
- Installed Pi 0.86 behavior is directly proven for the two mocked forwarding requests only. The peer range was deliberately not widened, and this is not complete 0.86 package certification.
- Bun proof is a locally compiled 0.84 loader fixture, not the unavailable vendor-distributed compiled Pi binary. Native Windows was not available.
- No full/default package suite, packed-install matrix, live model/provider request, or external network check was run in this focused correction lane.

## Reviewer focus

1. `lineageBindsContainingAssistant()` and the latest-relevant-assistant scan, especially the case where the assistant model is changed but its receipt still claims the target lane.
2. The intentional distinction between failed/aborted messages without a receipt (retry-skippable) and a failed/aborted message carrying a receipt (untrusted boundary).
3. The narrow host-owned intersection boundary around direct `anthropicMessagesApi().streamSimple`; verify no host object is transformed and the installed loader aliases remain the intended version-selection mechanism.
4. The real latest-assistant JSONL mutation and two post-resume turns.
5. Integrator generation of stale source-provenance docs; no semantic attestation was self-awarded.

## Cleanup and final state

- Task-owned live subprocesses excluding the active Pi harness: **0**.
- Disposable Bun executable: absent after successful run.
- Scratch roots: `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/attribution-fix` are each **0 B**.
- Retained report/log directory: approximately **104 KiB** at final cleanup.
- Worktree status: only the pre-existing untracked read-only `node_modules` symlink. It was not staged, installed into, removed, or modified.
- No pushes, remotes, GitHub/network actions, installs, publishing, tags, live inference, user config/auth/session access, Fusion, or additional agents were used.
- Cleanup proof: `/private/tmp/pi-bg-closeout-iNoltL/reports/attribution-fix/cleanup.log`.
