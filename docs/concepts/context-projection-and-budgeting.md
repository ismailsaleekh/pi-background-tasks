---
doc_id: concepts/context-projection-and-budgeting
audience: agent
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [src/core/context/kiro-calibration.ts, src/core/context/kiro-tokenizer.ts, src/core/context/parent-snapshot.ts, src/core/context/token-budget.ts, src/core/context/visible-conversation-v2.ts]
---
# Context projection and budgeting

Primary sources: `src/core/context/parent-snapshot.ts`, `src/core/context/visible-conversation-v2.ts`, and `src/core/context/token-budget.ts`.

## Shared visible conversation transform

`VISIBLE_CONVERSATION_TRANSFORM_ID` is `visible-conversation-ledger-v2`. It is shared by Fusion reason and delegate seeding so each consumer gets the same disposition for the same parent session bytes.

The transform has no behavioral knobs:

- user text: retained verbatim;
- assistant text: retained verbatim;
- assistant thinking: omitted into the ledger;
- tool-call arguments: omitted into the ledger;
- tool-result text: omitted into the ledger;
- tool-result images: ledger-only;
- user images: marker-only text (`[Image omitted from fusion text transcript: <mime>]`);
- empty text blocks: counted, not serialized;
- unknown roles/block types: loud `UnsupportedConversationBlockError`.

Each omitted event records source ordinal, block ordinal, kind, payload byte length, payload SHA-256, and optional tool/mime metadata. The ledger root is hash-framed and independent of consumer envelopes, so Fusion and delegate can seal the same transform output into different schemas without changing the underlying omitted-event commitment.

## Parent snapshot and branch exclusion

`parent-snapshot.ts` adapts Pi `SessionManager` entries into LLM messages. Tool callers can exclude the active assistant leaf that contains the in-flight tool call; this prevents the child from seeing its own request and sibling calls as completed parent history. Commands do not exclude a leaf.

Pi 0.86 stores prompt sections and tool loadouts as `system` messages, including a leading checkpoint after compaction. The adapter removes only that known prompt-state role before `convertToLlm()` and captures `ctx.getSystemPrompt()` exactly once in the same synchronous snapshot. Delegate and Fusion keep this effective prompt in their existing envelope fields; historical prompt patches and tool declarations are not forwarded as conversation or granted child tools. Conversation ordinals/accounting refer to the filtered conversation sequence. The frozen v2 transform is unchanged and still rejects unknown roles/blocks; its pre-0.86 golden bytes are not regenerated.

Callers must snapshot once and complete downstream launch/admission from that frozen snapshot, including using its captured system prompt. Re-reading the parent session or prompt during launch would allow seed drift.

## Reason input vs clean input

- Fusion `reason` uses the parent visible-conversation projection. Its canonical input includes the system prompt, request authority, projection entries, accounting, and a separate `context-omission-ledger.json` artifact.
- Fusion `investigate`, `research`, and `validate` use clean-task input. They carry the explicit request and declared sources where applicable; they intentionally do not carry parent system prompt, conversation projection, or omission ledger.
- Delegate uses the shared projection inside its seed, but its directive text is marked authoritative and projected history is supporting/untrusted.

No path silently truncates parent context. Oversized projections or prompts must be rejected with budget details or represented by hashed artifact receipts where that consumer defines a receipt protocol.

## Token estimator concepts

`token-budget.ts` is byte arithmetic, not a tokenizer. It produces upper-bound style estimates from UTF-8 byte classes:

- `normal` known text/json bytes;
- `multibyte` bytes;
- `dense_ascii` bytes;
- `unknown_output_contract` bytes.

Families are `anthropic`, `openai-codex`, and `unknown`. Exact model overrides currently include Anthropic Opus/Fable routes and OpenAI Codex GPT routes. Unknown providers and unbacked models fall to a provable 1.00 B/token floor.

Calibration facts in code:

- calibration id: `pi-background-tasks.input-token-calibration.v1`;
- large-prompt floor: 50 KiB;
- affine fixed reserve: 512 tokens;
- observed large Fusion prompt corpus: 882 prompts, dated 2026-08-02;
- Anthropic configured rate: 1.73 B/token after haircut;
- OpenAI Codex configured rate: 2.89 B/token after haircut;
- delegate launch uses backed family calibration only for large prompts on routes that can hold the calibration domain; small prompts/routes, unbacked models, unknown providers, and dense-ASCII out-of-domain cases use conservative/floor rates;
- delegate runtime context estimates are advisory, while a separate provable `1.00 B/token` retained-growth budget drives explicit spilling and no-tool finalization.

The dense-ASCII gate is explicitly a low-whitespace heuristic proxy, not a tokenizer guarantee. Calibration applies only when the input is in the measured domain and the route capacity can hold that domain.

### Kiro delegate surrogate forecast

Delegates on exactly `kiro/claude-opus-4-5` with a declared 200,000-token window can use the separate measured profile in `kiro-calibration.ts`. It counts the complete child prompt and child system prompt independently with pinned `js-tiktoken` `cl100k_base`, then applies the measured integer multiplier and fixed reserve. This is a surrogate forecast, **not** the Claude tokenizer, an exact Kiro count, or a universal upper bound. The route and UTF-8 size domain must match the recorded corpus; other models, providers, windows and sizes keep the existing byte estimator.

The profile was selected from predetermined training samples with a 20% uplift on the worst observed Kiro/local-token ratio, rounded upward, plus 512 fixed tokens. Held-out samples were evaluated without fitting them. The committed synthetic corpus records exact prompt/system hashes, local counts, provider/catalog versions, thinking mode, transport integrity checks, raw context percentage, count origin and coverage. When the provider supplies no input token counters, occupancy is derived by rounding the reported context percentage upward against the catalog window; it is never relabeled as exact usage.

`tokenizer_forecast` in budget plans, task receipts and runtime measurements identifies the active estimator and its corpus hash. The legacy `estimate`, `route.rate_source` and `conservative_estimate` remain byte-estimator diagnostics; they do not identify the active estimator when `tokenizer_forecast` is present. Admission and the child's initial investigation runway use the same surrogate counter over the complete retained text. Subsequent tool-result growth is still charged at one byte per token and spills losslessly before consuming protected final-answer runway. Nothing is removed, summarized or routed to another model to make a forecast fit.

The package still subtracts its output, framing and safety reserves before admission. A successful forecast does not guarantee provider acceptance: a real rejection remains a loud failure. Forecast refusal reports no fictitious linear minimum byte reduction, because token density depends on the actual text.

## Budget invariants

- `allowedInputTokens()` returns a signed number and never clamps unusable routes to zero.
- Callers must reject unusable or too-small context windows before spawning children.
- Multibyte bytes cannot bypass accounting; delegate's published provable counter-forecast charges them at the same `1.00 B/token` ceiling as every other byte class.
- Unknown output contracts are charged separately; future output cannot be assumed to be cheap.
- Rate-source warnings are part of the contract and should be surfaced in refusal details.
- A package-local estimate must not reject a live provider payload by subtracting hypothetical output; Fusion BUG-185 established this as a false-refusal shape. Use conservative estimates for lossless spill decisions, where a false positive preserves bytes rather than failing work.

## No silent truncation

Model-visible context may be compacted only by explicit policy receipts with exact accounting and hashes. It must never be clipped, head/tail previewed, route-substituted, or hidden behind a fallback estimator without reporting the source and limitation.
