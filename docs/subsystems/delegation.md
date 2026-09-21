---
doc_id: subsystems/delegation
audience: maintainer
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [extensions/delegate-child.ts, src/core/delegate/artifacts.ts, src/core/delegate/budget.ts, src/core/delegate/facade-contract.ts, src/core/delegate/hook-contract-evidence.json, src/core/delegate/hook-contract.ts, src/core/delegate/launch.ts, src/core/delegate/result-package.ts, src/core/delegate/runner.ts, src/core/delegate/seed.ts, src/core/delegate/types.ts, src/core/lazy-module.ts, src/delegate-child-extension.ts, src/delegate-extension.ts]
---
# Delegation subsystem

This document is the primary behavioral owner for delegation runtime code:

- `src/delegate-extension.ts`
- `src/delegate-child-extension.ts`
- `extensions/delegate-child.ts`
- every current file under `src/core/delegate/**`, including `hook-contract-evidence.json`
- the internal activation-local loader in `src/core/lazy-module.ts`, shared with the Fusion facade

It does **not** claim ownership of shared `common`, `registry`, `pi-launch`, or `durable-fs`; delegation consumes those integration points.

## Behavioral contract

Delegation provides one background child Pi agent, one directive, one pinned route, and read-only inspection tools. It is registered only when `PI_BG_FEATURES` includes `delegate`. The parent gets a launch receipt immediately and later retrieves a verified answer through `bg_result`.

`bg_result` is a shared derived surface, not part of the delegate toggle: it is registered exactly once when delegate or Fusion is enabled. Delegate-only and Fusion-only configurations therefore retain the correct verifier/retrieval path, while process-only has neither a producer nor `bg_result`.

The design deliberately separates:

- launch admission (no side effects on refusal),
- child isolation and runtime guards,
- child answer commit (`result.json`),
- parent adjudication (`outcome.json`),
- user retrieval (`bg_result`).

## Lazy facade activation

Enabled schemas, descriptions, argument preparation, renderers, and tool registration are immediate. Delegate launch/seed/budget/runner code is imported only on the first valid `bg_delegate` execution. `bg_result` has independent delegate and Fusion verifier loaders and selects one only after task facts identify the producer; a running result imports neither verifier.

Each loader is activation-local and single-flight: simultaneous cold calls await one module import but continue as independent runs. Its states are `unloaded`, `loading`, `loaded`, `failed`, and `closed`. An import failure is wrapped with a bounded module-specific diagnostic and remains sticky for that activation. The entrypoint constructs one activation-local synchronous close fence and explicitly gives it to every enabled core, Fusion, delegate, and result lane. Its first shutdown handler closes every loader, advances Fusion generation, aborts Fusion controllers, and aborts delegate preparation before any later handler can await cleanup. A module arriving after closure is discarded before its operation can create an artifact, task, or child or touch stale host APIs. Reload constructs a new facade and may retry; the closed instance is never reopened, and no process-global cache stores `pi` or host context.

The main entrypoint dynamically imports the lightweight delegate/result facade only when delegate or Fusion is enabled. Process-only startup therefore imports neither advanced facade nor verifier/producer code. Published Pi entrypoints execute precompiled JavaScript from `dist/`; authoritative TypeScript remains shipped for source/API compatibility and development tests. The compiled `dist/src/**` files are private chunks reached through those Pi entrypoints, not standalone Node entrypoints. Packed-package tests exercise successful delegate/result first use without any package-local Pi SDK peer.

## Seed and context policy

The seed schema is `pi-background-tasks.delegate-seed.v2`. It wraps the frozen `visible-conversation-ledger-v2` projection under delegate policy id `delegate-inspect-v1`; it never emits Fusion input schemas or claims Fusion provenance. The exact selected `extension_mode` is hash-bound into the seed, and is also recorded in launch details, task facts, and `manifest.json`.

Projection behavior:

| Source content | Delegate seed behavior |
|---|---|
| user text | included verbatim |
| assistant text | included verbatim |
| user images | marker text only |
| assistant thinking | omitted; ledger row with bytes/hash/count |
| tool-call arguments | omitted; ledger row with bytes/hash/tool name/call id |
| tool-result text | omitted; ledger row with bytes/hash/tool name/call id |
| tool-result images | ledger-only omission with bytes/hash/mime |
| unknown blocks | projection failure; no child |

The assistant message containing the active `bg_delegate` call is excluded as a whole. Therefore sibling tool calls in the same assistant message are not visible to any child launched by that batch.

`directive.text` is stored exactly, hashed, and marked `authority: "explicit_text"`. The child prompt and system prompt state that the directive is authoritative and projected history is untrusted supporting context. Omitted parent tool output cannot be recovered by the child; the child is instructed to say so rather than guess.

## Launch and isolation

Public admission first loads hook evidence and resolves the requested/current route; launch preparation then resolves the package-owned child guard extension. Inside `preflightDelegateLaunch()`, the hook-contract gate runs before capability/tool policy, limit checks, seed construction, and launch budget admission. All of these checks complete before child process, child session directory, or artifact root creation. Route, guard-extension, hook-contract, or later admission refusal therefore leaves zero child processes and zero delegate artifacts; do not rely on one absolute error-precedence order across those pre-preflight resolutions.

Preparation remains uncommitted until the registry accepts task ownership. It receives the activation abort signal and checks it around every awaited artifact/session write. A complete prepared value carries an idempotent producer-owned rollback. If shutdown wins before registration, the facade waits for that rollback and removes the run root plus only empty delegate parent directories before rejecting; no seed, projected context, child-session directory, or starter survives. If a starter rejects, the facade checks the exact task id in the registry and rolls back only when it is unregistered. Registered task artifacts stay under the existing registry lifecycle and are never deleted by preparation rollback. Cleanup failure is bounded, logged, and propagated rather than hidden.

The child launch:

- direct Pi spawn through the registry, not a shell;
- prompt bytes over stdin, not a positional/shell argument;
- separate random `--session-id`;
- task-owned `--session-dir` under the artifact directory;
- parent session/provider/model/reasoning env keys stripped;
- skill/template/theme/context discovery always disabled;
- extension discovery disabled by default in `extensionMode:"isolated"`;
- extension discovery deliberately enabled only by `extensionMode:"ambient"`;
- non-Anthropic children explicitly load the package-owned child guard in both modes;
- Anthropic children explicitly load the always-on `extensions/anthropic-attribution-child.ts` safety entrypoint first, then the child guard, in both modes, regardless of the parent ambient-attribution capability.

Ambient mode exists for providers registered by user/project Pi extensions. It omits only `--no-extensions`; it accepts no caller-supplied extension paths and performs no provider fallback or route substitution. Ambient discovery executes arbitrary trusted-location extension code in the child process. That code has Node process privileges and is not sandboxed by Pi's model-visible tool allowlist, so ambient mode deliberately weakens the inspect-only process-isolation guarantee. It must not be described as safe or equivalent to isolated mode.

The only v1 capability is `inspect`. Allowed model-visible tools are exactly `read`, `grep`, `find`, `ls`, and `delegate_read_artifact`; forbidden tools deny shell, writes, background task controls, recursive delegation, attested Pi launch, and Fusion. This tool boundary remains argv/tool-registry enforced in both extension modes, but it is not a sandbox for ambient extension initialization or handlers. Missing Anthropic attribution bytes are a pre-artifact `delegate_isolation_unsupported` refusal; no un-attributed child or alternate route is launched.

## Route and budget

Routes are pinned once:

- omitted route → parent current model;
- extension-only routes still must be visible in the parent registry and require explicit `extensionMode:"ambient"` so the fresh child can load their implementing extension;
- explicit route → exact registry entry;
- unavailable/unknown-capacity routes fail;
- no substitution, fallback, or retry on a different route.

Budgeting separates admission from package-owned runtime growth. Constants currently documented by source/tests:

- reserved output: `16,384` tokens;
- framing reserve: `8,192` tokens;
- safety reserve: `4,096` tokens;
- minimum usable input: `8,192` tokens;
- protected finalization input runway: `32,768` tokens;
- finalization trigger inside retained-growth runway: `8,192` tokens;
- default turns/tools/timeout: `24` / `120` / `1200s`;
- per-result transcript cap: `64 KiB`;
- aggregate raw tool-output cap: `64 MiB`;
- answer capture cap: `4 MiB`, enforced before result packaging;
- inline answer cap: `48 KiB`.

Launch admission measures the child system prompt plus the exact child prompt carrying the seed. Backed large prompts use the shared family calibration; prompts or routes below the calibration domain and unknown/unbacked routes use the provable `1.00 B/token` profile. `budget-plan.json` v3 also records the provable conservative counter-forecast, protected finalization reserve, and retained-growth budget.

After launch, token measurements are advisory. Fusion BUG-185 proved that a package-local estimate must not reject a live provider payload after subtracting hypothetical output. Delegate therefore does not self-report provider exhaustion from that estimate. Pi and the provider own live context handling; a genuine provider context error remains loud. Package-owned growth is controlled before transcript entry: a tool result spills whenever it exceeds the per-result cap **or** retaining it would consume protected final-answer runway. Conservative false positives therefore create explicit hash receipts rather than failed tasks. Near the end of the runway the child disables tools and injects one finalization instruction so it can answer from evidence already gathered.

## Child guard and commit discipline

The child verifies seed hash, task id, and launch nonce at extension load before the first model call. It then enforces:

- advisory retained-context measurement before every provider call, without a BUG-185-style token abort;
- route-runway-aware and per-result spill receipts before tool output enters the transcript, including structured preservation of image-bearing results;
- bounded artifact range reads returned as lossless base64 against remaining inline runway;
- aggregate raw tool-output cap;
- protected no-tool finalization when retained-growth runway becomes low;
- turn and tool-call limits;
- route attestation for assistant messages;
- per-turn usage accumulation across the full agent loop; if any turn is missing/partial, aggregate usage is `unavailable` rather than understated or replaced by a later record;
- accepted final stop reason `stop` only, so provider `length` stops become `child_model_output_limit` rather than partial success;
- answer capture from only the final clean-stop assistant message, never intermediate tool-use narration;
- non-empty, non-whitespace answer text;
- the declared answer capture cap, with no partial result on overflow;
- well-formed UTF-8 answer blocks;
- durable `runtime-budget.json` evidence containing context measurements, retained/spilled bytes, finalization state, first-request observed usage, and calibration-underforecast evidence.

A terminal latch prevents later success commit after any degraded/refused condition. This avoids a hash-valid result built on silently modified context.

`result.json` is the single answer data plane. It is child-written by temp file, file fsync, and rename; POSIX then fsyncs the parent directory, while Windows skips directory fsync because Node does not provide the same portable guarantee there. Final-name presence is the child commit point. No final `result.json` means no accepted answer, regardless of process exit code. `child-terminal.json` records child-side terminal failures when no success package is committed.

After adjudication, the parent makes a best-effort durable write of `outcome.json`. This is separate from `result.json` so child and parent cannot race over one state field. An `outcome.json` write failure is currently ignored and does not change the returned adjudication, so the artifact may be absent even though evaluation completed. Child stdout/stderr are captured in the background task output file. Delegate-local `child.stdout.txt` and `child.stderr.txt` are not currently populated, and terminal reporting now lists only diagnostic paths that actually exist.

## Spill artifacts and `delegate_read_artifact`

Oversized tool results are durably written in full under `spill/` and replaced with receipts. A single text block is stored as exact UTF-8; malformed lone-surrogate text is rejected rather than silently converted to U+FFFD. Multi-block or image-bearing content is stored in a closed JSON envelope that preserves block boundaries, MIME types, text, and complete base64 image data. New receipts record `content_format`; historical v1 receipts without that optional field remain readable. A failed spill withholds the original payload and latches a terminal failure; no uncommitted artifact is claimed by receipt.

`delegate_read_artifact` requires:

- `artifact: string` relative to the delegate artifact root;
- `offset: non-negative safe integer`;
- `length: positive safe integer`.

It reads the whole artifact file, verifies the requested range is in bounds, and returns the exact bytes as base64 plus offset/length metadata. Arbitrary ranges are never decoded as UTF-8, so a range that splits a multibyte sequence remains byte-exact rather than becoming U+FFFD. Path escape and short reads fail loudly.

## Retrieval contract

`bg_result` verifies committed packages before returning bytes. It checks identity, seed hash, route and route attestations, schema, usage shape, strict base64, per-block hashes, aggregate hash, byte lengths, and UTF-8 round trip. Running tasks return a not-ready view (`state:"running"`, `delivery:"none"`) without blocking.

Default delivery inlines answers up to `48 KiB`; larger answers return artifact metadata. Explicit oversized inline requests fail with `result_too_large_for_inline`. Answers are never truncated.

Current `autoDeliver` status: `bg_delegate` accepts and records `never | when_small | always` and includes it in launch facts/details. The registry's generic terminal notification currently does not evaluate delegate results or include answer text, so `bg_result` remains the retrieval path.

`extensionMode` accepts only `isolated | ambient`, defaults to `isolated`, and is surfaced in receipt text and durable metadata. Ambient receipts include an explicit arbitrary-code/isolation warning.

## User-oriented failure taxonomy

Admission / no child:

- `delegate_hook_contract_unsupported`
- `delegate_isolation_unsupported`
- `route_unresolved`
- `route_capacity_unknown`
- `seed_projection_failed`
- `seed_budget_exceeded`
- `seed_persist_failed`
- `invalid_arguments`

Launch / execution:

- `child_spawn_failed`
- `child_startup_failed`
- `child_timeout`
- `child_cancelled`
- `child_turn_limit`
- `child_tool_call_limit`
- `child_exited_without_commit`

Budget / limits:

- `provider_context_budget_exhausted` (legacy terminal records only; current children do not infer provider exhaustion from an advisory estimate)
- `aggregate_tool_output_cap`
- `child_model_output_limit`
- `child_capture_limit`

Integrity / artifacts:

- `child_result_invalid`
- `child_result_encoding_invalid`
- `route_attestation_missing`
- `route_mismatch`
- `seed_hash_mismatch`
- `answer_hash_mismatch`
- `artifact_spill_failed`
- `artifact_read_failed`
- `artifact_error`

Retrieval:

- `result_not_ready`
- `result_unavailable`
- `result_too_large_for_inline`
- `task_unknown`

Each `DelegateError` renders code, message, child-created flag, artifact location when known, preserved evidence, and remediation.

## Hook-contract compatibility gate

The child guard relies on Pi hook behavior proven by `tests/scripted-provider/pi-hook-contract.test.ts`; shipped evidence is byte-identical to `src/core/delegate/hook-contract-evidence.json`.

Required guarantees include context hook ordering, returned context messages reaching the provider, abort blocking transport, abort terminating the run, context throw isolation, tool-result replacement before transcript entry, replacement identity preservation, and extension load order.

Exact-version evidence covers both supported abort modes: Pi 0.81.1–0.83.0 invoke the provider with an already-aborted signal, while Pi 0.84.0 propagates that signal through auth resolution and skips provider invocation. Context throws still do not block dispatch. The guard is built fail-closed across both modes: it aborts and returns a suppressed message set, so the original oversized content is not dispatched even if a provider ignored the aborted signal. Missing/malformed/unsupported evidence fails with `delegate_hook_contract_unsupported`; the guard is not weakened at runtime.
