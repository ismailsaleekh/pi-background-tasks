# Attribution review corrections — design and red plan

Observed effective route before work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.

Starting commit: `8d55ae57c4ed6535ded1326b75cb08142d9926b8` on `closeout/attribution`.

## Behavioral decisions

### 1. Receipt-to-assistant integrity and recoverable lineage

A lineage receipt may select a target-model lane, authorize `previous_message_id`, or authorize signed/redacted thinking replay only when it binds completely to its containing assistant:

- the assistant and receipt both identify provider `anthropic`, API `anthropic-messages`, and the same non-empty model;
- the assistant has one of the successful terminal states this transport can persist (`stop`, `length`, or `toolUse`);
- both response IDs are non-empty and equal;
- the receipt's assistant-content hash exactly matches the containing content.

Parsing will also reject blank source/response IDs and a blank non-null previous ID. A latest relevant assistant with a missing, malformed, or mismatched receipt is an untrusted deterministic boundary. It derives a non-inheriting epoch from the observed assistant/receipt state, clears response chaining, and reprojects the whole request so old signed and redacted blocks cannot replay. Ordinary failed/aborted attempts without a receipt remain non-anchors so a legitimate retry can recover. Only a strictly completed successful response records the replacement receipt. Existing middleware, concurrency, route/account/session/cache, and SSE guards remain unchanged.

Permanent tests will cover a changed latest assistant, every binding field, blank IDs, stale-signature suppression, first successful recovery, and next-turn chaining. The SDK lifecycle test will mutate the latest persisted assistant after a real persistent session is shut down, reopen it with `SessionManager.open(..., reason:"resume")`, make the mock provider reject stale chaining, and prove the resumed request resets while the following request chains to the new response rather than repeatedly using `msg_2`.

### 2. Host-owned old/new forwarding contexts

Non-target `anthropic-messages` traffic will not be validated or rebuilt against a package-owned transcript schema. The callback arguments supplied by Pi will be passed by identity to the direct `anthropicMessagesApi().streamSimple` factory exported by the host-aliased `@earendil-works/pi-ai/compat` module. Pi's extension loader aliases that module to the matching host SDK in both Node and bundled runtimes. This preserves the declared 0.81–0.84 legacy `Context` contract and the installed 0.86 normalized `TranscriptContext` contract without widening peer ranges, importing an unexported subpath, or entering the global API dispatcher.

The existing package-0.84 `DefaultResourceLoader` Node/compiled-Bun fixture remains the old-context regression. A new attribution-specific fixture will use the real installed Pi 0.86 `DefaultResourceLoader`, construct normalized transcript contexts through the installed host SDK, and perform mocked MiniMax and Kimi requests with system/tool state. It must reach mock fetch twice and retain provider endpoint/auth/callback identity with no target-only Anthropic attribution rewrite.

### 3. Lossless forwarding stream

The non-target route will return the host adapter's stream directly. It will not reconstruct blocks, messages, usage, diagnostics, or events, and will not create snapshots of the host's shared live `partial`. The host stream therefore owns terminal event/result settlement and preserves current and future optional fields by identity. A narrow test dependency seam may supply a host stream for deterministic pass-through assertions; it will not alter normal registration or dispatch.

Regressions will verify:

- provider-reported reasoning usage;
- current optional response fields and tool-call metadata;
- exact stream/event/message identity, including one shared live partial across start/delta/end;
- done and error result settlement;
- payload/response callbacks and original model identity;
- no non-target endpoint/header/payload attribution rewrite;
- no eval import, unexported subpath, or registered-dispatch recursion.

No fixed serialization allowlist, double assertion, explicit top-type escape, custom compatibility framework, or optional default that masks data loss will be introduced.

## Owned files

Expected production/authored-doc scope:

- `src/core/anthropic-attribution.ts`
- `docs/subsystems/anthropic-attribution.md`
- attribution paragraphs in `docs/operations/configuration.md`

Expected tests/fixtures:

- `tests/unit/anthropic-attribution-lineage.test.ts`
- `tests/sdk/anthropic-attribution-lifecycle.test.ts`
- `tests/unit/anthropic-attribution-forwarding.test.ts`
- `tests/fixtures/anthropic-forwarding-loader.ts`
- one new attribution-specific installed-0.86 forwarding fixture if needed

Generated provenance docs remain integrator-owned and will not be hand-edited. Package metadata/locks, peer ranges, shared helpers, shared plans/state, launchers, and unrelated production modules remain untouched.

## Red sequence on `8d55ae5`

After adding only permanent tests/fixtures:

1. Run the focused lineage suite. The changed-latest and binding mutations must expose stale `previous_message_id` and/or signed replay; blank receipt IDs must be accepted by the old parser.
2. Run the real SDK lifecycle suite. The strict mock must show repeated stale `msg_2` attempts or an equivalent failed assertion after latest-assistant mutation.
3. Run focused forwarding tests. Reasoning/optional fields and shared partial identity must show the reconstruction loss.
4. Run the installed-0.86 loader fixture. MiniMax/Kimi normalized system-message contexts must fail before fetch on the reviewed code.

Logs will be retained under `/private/tmp/pi-bg-closeout-iNoltL/reports/attribution-fix/`. Commands will use `GIT_ALLOW_PROTOCOL=file`, absolute npm operands where npm is used, and isolated `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` under the task-owned `attribution-fix` roots with `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1`.

## Green/closeout sequence

- Existing four attribution unit files (the reviewed 41 tests plus new regressions).
- Real persistent SDK reload/reopen/resume lifecycle.
- Package-0.84 `DefaultResourceLoader` Node fixture and Bun 1.3.4 compiled fixture, deleting the executable afterward.
- Real installed-0.86 `DefaultResourceLoader` MiniMax/Kimi normalized-context fixture.
- `npm run typecheck` with an absolute `--prefix` operand.
- Focused static scans, `git diff --check`, commit checks, and docs verification (with expected generated provenance reconciliation reported rather than hand-edited).

No live provider calls, network, installs, user config/session access, publishing, pushes, semantic self-attestations, or additional agents will be used.
