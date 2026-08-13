---
doc_id: subsystems/fusion
audience: maintainer
mode: mixed
review_policy: behavioral
stability: stable
covers_surfaces: [renderer:fusion-result, workflow:investigate, workflow:reason, workflow:research, workflow:validate]
covers_sources: [extensions/fusion-child.ts, src/core/fusion/artifacts.ts, src/core/fusion/budget.ts, src/core/fusion/child-protocol.ts, src/core/fusion/claude-cache.ts, src/core/fusion/clean-context.ts, src/core/fusion/config.ts, src/core/fusion/context.ts, src/core/fusion/evaluation.ts, src/core/fusion/orchestrator.ts, src/core/fusion/output-contract.ts, src/core/fusion/pi-child.ts, src/core/fusion/prompts.ts, src/core/fusion/result-package.ts, src/core/fusion/source-policy.ts, src/core/fusion/types.ts, src/core/fusion/web-fetch.ts, src/core/fusion/workflows.ts, src/fusion-child-extension.ts, src/fusion-extension.ts, src/ui/fusion-model-selector.ts]
---

# Fusion subsystem

<!-- pi-docs:begin name="fusion-workflows" generator="scripts/docs/generate.mjs" -->
| Workflow | Tool | Context | Candidate capability | Candidate tools | Evaluator/merger tools | Provenance |
| --- | --- | --- | --- | --- | --- | --- |
| `investigate` | `fusion_investigate` | `clean_task` | `inspect` | `read`, `grep`, `find`, `ls` | none | `src/core/fusion/workflows.ts:80` |
| `reason` | `fusion_reason` | `session_projection` | `reason` | none | none | `src/core/fusion/workflows.ts:61` |
| `research` | `fusion_research` | `clean_task` | `research` | `read`, `grep`, `find`, `ls`, `fusion_web_fetch` | none | `src/core/fusion/workflows.ts:99` |
| `validate` | `fusion_validate` | `clean_task` | `inspect` | `read`, `grep`, `find`, `ls` | none | `src/core/fusion/workflows.ts:118` |
<!-- pi-docs:end name="fusion-workflows" -->

This document is the primary behavioral owner for Fusion's package-owned source files listed in frontmatter. Shared parent-context and token-budget modules are referenced here only as dependencies; their behavior is not owned by this document.

## Public v1 surface

Fusion v1 exposes exactly two commands and exactly four public tools:

- `/fusion` — command shorthand for fixed-purpose `reason`.
- `/fusion-models` — TUI-only global five-slot model selector.
- `fusion_reason({prompt})`.
- `fusion_investigate({objective, background, deliverable, scope?, constraints?})`.
- `fusion_research({objective, background, deliverable, scope?, constraints?, sources})`.
- `fusion_validate({objective, background, changeSummary, scope, acceptanceCriteria, verification, knownLimitations?, exclusions?})`.

Every public tool schema is closed and has no public capability/mode switch. The retired `fusion_brainstorm` surface is never registered; session start removes it from active tools while preserving rendering of historical completed v4 result messages.

## Commands

`/fusion <prompt>` trims the command text and starts the reason workflow as a managed background task. `/fusion` with no arguments opens the multiline editor when UI is available; editor cancellation or blank edited text returns without child spawn. Durable preflight and task registration finish before the command returns; no loader remains open and no premature result message is appended. Terminal state uses the standard background notification, and `bg_result` verifies and retrieves the committed result.

`/fusion-models` requires TUI mode. It edits five slots (`Candidate 1`, `Candidate 2`, `Candidate 3`, `Evaluator`, `Merger`), allows duplicates, supports `$current`, shows unavailable configured choices, and persists `fusion-models.json` with schema `pi-background-tasks.fusion-models.v1`. Saves are lock-protected, atomic, and revision-safe: if the file changed after load, the selector reports a config conflict instead of overwriting concurrent work.

## Context contracts

Reason runs (`/fusion` and `fusion_reason`) receive session-projection canonical input (`pi-background-tasks.fusion-input.v5`). Visible user/assistant text is retained verbatim. Assistant thinking, tool calls, tool-result text, and tool-result images are not forwarded; they become deterministic omission receipts plus a local `context-omission-ledger.json`. User image blocks become marker text, and ledger-only image payloads never enter child prompts. Tool calls exclude the active Fusion leaf and sibling calls from the projected branch.

Investigate, research, and validate receive clean-task canonical input: exactly `schema_version`, `workflow`, `cwd`, `request`, and `context`. Clean tasks carry no parent system prompt, no conversation projection, no parent transcript, and no omission ledger. Their request text is the canonical JSON serialization of the structured public arguments and is fully authoritative.

## Workflow and stage policy

All workflows use the same orchestrator shape:

1. plan budget and write artifacts before any child exists;
2. pause at a no-child-yet readiness barrier while the managed background-task receipt becomes durable;
3. run three candidate children in parallel;
4. anonymize candidate identities as A/B/C before evaluation;
5. run a blind no-tool evaluator;
6. run one no-tool evaluator-repair child only if the first evaluator JSON is invalid or schema-invalid;
7. run a no-tool merger;
8. durably commit `merged.md` plus manifest-bound `result.json`, then publish terminal task state.

Do not describe Fusion as unconditionally exactly five model calls. A completed run may use five or six child invocations, while preflight failures use zero; candidate failures, cancellation, spawn retry, output caps, or invalid repair alter observed attempts.

Candidate tool policies are fixed by workflow:

| Workflow    | Candidate capability | Candidate tools                                  |
| ----------- | -------------------: | ------------------------------------------------ |
| reason      |             `reason` | none (`--no-tools`)                              |
| investigate |            `inspect` | `read`, `grep`, `find`, `ls`                     |
| research    |           `research` | `read`, `grep`, `find`, `ls`, `fusion_web_fetch` |
| validate    |            `inspect` | `read`, `grep`, `find`, `ls`                     |

Evaluator, evaluator-repair, and merger always use capability `reason` and empty tool lists. Tool-enabled children run with built-in tools disabled and an explicit allowlist plus a denylist that includes shell/write/edit, Fusion recursion, and background/delegate tools.

## Validation specifics

`fusion_validate` enforces a strict public verification contract: `provided` requires non-empty evidence and no reason; `not_run` requires a reason and empty/omitted evidence. Reviewers return exactly one bare, closed candidate-report JSON object. The host keeps its shared JSON parser strict; a single complete `json` fence can be removed only by the validation-specific audited recovery path, which writes a contract-event artifact and surfaces a limitation. One irrecoverable minority report is also recorded and surfaced as a limitation, while two invalid reports fail the workflow. The host assigns stable finding ids after anonymization, the evaluator must account for every source finding exactly once, and the host renders the final report from validated accounting after the merger. Validation is advisory and read-only: it never edits files, runs tests, gates a release, or replaces builds, linters, scanners, or human review.

## Research specifics

Research is targeted fetch, not search. The public caller declares exact non-duplicate public `http(s)` URLs and purposes. There is no browser, PDF reader, cache, search provider, page-recrawl loop, or domain allowlist.

`fusion_web_fetch` is private to research children and has a closed `{url, extract?}` schema. It rejects credentials, non-http schemes, localhost/known-metadata names, and enumerated private/reserved address classes; vets all DNS answers against that classifier; pins the request to a vetted address; checks the response socket address; follows at most five re-vetted redirects; accepts only HTML/XHTML/plain text/Markdown; caps response bytes at 4 MiB and extracted output at 32 KiB; uses one 90 second full-operation deadline across DNS, redirects, response transfer, and extraction; strips script/style/noscript; and extracts text or Markdown. Source-policy admission also rejects literal Azure service address `168.63.129.16`, but the transport classifier does not currently special-case a public DNS/redirect target resolving to that address.

Research intentionally combines read-only file tools and network fetch in one child. This supports source-backed synthesis but is security-sensitive: operators must not supply secret-bearing URLs or ask children to put private data in URL strings. The package blocks common SSRF targets and credential URLs, but its deny rules are not an exhaustive network sandbox; fetched content remains untrusted and caller-declared public URLs can still disclose access through remote logs/timing.

Inspect/research candidates write sealed tool-call audit logs. The log contains schema version, ordinal, tool name, argument/result byte counts and SHA-256 digests, status, duration, and fetch provenance. Raw arguments, raw results, page content, and rejected raw URLs are not persisted. The parent requires the log and seal, verifies hashes/counts/ordinals/status, independently enforces both the 600-call and 32 MiB aggregate result-byte caps, and rejects non-allowlisted tools. A child may attempt at most 600 tool calls; crossing that limit aborts the run, emits structured refusal evidence, and prevents a complete audit seal.

## Child process isolation

Fusion never calls direct completion APIs. It launches direct child `pi --mode text` processes and writes the prompt over stdin. Child argv includes `--no-session`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, and `--no-context-files`; explicit extensions still load. Non-Anthropic children receive only the package-owned compact metadata/runtime-governor extension. Anthropic children receive, in fixed order, the package-wide attribution/sanitization extension and the runtime governor. The same attribution implementation is globally loaded for ordinary package sessions; Fusion supplies its public extension entrypoint explicitly because ambient discovery is disabled. Attribution adds the Claude Code OAuth session header, linked account/device/session metadata, model-policy beta headers, system identity, beta-resource transport, cache surfaces, and model-aware cache usage pricing. It reads `userID` and `oauthAccount.accountUuid` from `~/.claude.json` without writing the file and fails loudly when required attribution data is absent or malformed. Its internal sanitizer removes all reviewed exact-match rejected prompt lines while preserving unrelated text and cache controls; no external sanitizer package is resolved.

Child text mode writes the final full answer to stdout. The private child extension emits compact reasoning-free metadata frames to stderr for finalized assistant messages: provider/model, stop reason, text block byte counts and hashes, aggregate text hash, the complete Pi `Usage` object (including Anthropic `cacheWrite1h` and provider-reported reasoning subsets), and a closed cache-policy observation. It governs every final `before_provider_request` payload after attribution and sanitization. For Anthropic routes, the child environment defaults `PI_CACHE_RETENTION` to `long` before provider serialization, so the attribution/Pi adapter creates system, final-tool, and final-conversation breakpoints with `ttl: "1h"`; inherited `PI_CACHE_RETENTION=short|none|long` remains explicit, and call-level `cacheRetention="none"` still wins for compaction. The final governor validates and normalizes those upstream-selected breakpoints, falls back to short when model compatibility rejects long retention, preserves no-marker compaction payloads, enforces Anthropic's four-breakpoint ceiling, and appends the subscription prompt-caching-scope beta idempotently. Its `effective_retention` field describes the final payload, not provider acceptance. Provider usage is preserved verbatim: `cacheWrite1h > 0` proves a one-hour write, but zero is inconclusive on subscription OAuth. Live normal-spawn and exact Fusion-child controls each observed a unique cache read after 370 idle seconds despite `cacheWrite1h = 0`; therefore payload observations prove request intent and `cacheRead` proves reuse, while neither zero telemetry nor a six-minute hit alone proves the full one-hour lifetime. Malformed controls or policy values abort before transport. Non-Anthropic payloads and child environments remain unchanged apart from the governor's existing JSON normalization.

After cache normalization, the governor validates a stable JSON-object serialization and enforces the 550-provider-request execution limit. It does not estimate live payload tokens, subtract possible model output from the context window, or reject a request by payload size; Pi and the provider own live context handling after the pre-spawn Fusion stage checks. A provider-side context rejection remains a loud child failure and is never route-substituted or hidden. Pi's provider-hook behavior is characterized through the same `openai-codex-responses` transport adapter used by subscription Codex routes in a real local HTTP agent loop: transforms chain in extension load order and `ctx.abort()` prevents transport for the retained cache-policy and execution-limit refusals. Cache observations use `pi-background-tasks.fusion-claude-cache-observation.v1`, state requested/effective retention, source, breakpoint count, and provider-request ordinal, and are hash-bound inside `pi-background-tasks.fusion-child-result.v4` attempt event artifacts. At terminal `agent_settled`, the extension emits exactly one `pi-background-tasks.fusion-child-settlement.v3` frame binding the complete ordered metadata stream by count and SHA-256, the final record/hash, recovered retry-marker ordinals, and any one recovered oversized-original ordinal. The parent validates closed cache/output-contract evidence and increasing request ordinals, reconstructs stdout against the final metadata, requires final stop reason `stop`, verifies model identity, and preserves usage/cost exactly. Non-final `toolUse` records remain normal. A non-final `error` is accepted only when it is a zero-content, empty-hash, zero-usage retry marker, a later final `stop` exists, and the terminal settlement hash/accounts for that exact ordinal. Exactly one non-final `stop` is accepted only as a hash-bound oversized candidate original immediately followed by its same-session replacement. `length`, `aborted`, `pending`, final `error`, error records carrying text or usage, unbound non-final `stop`, missing/duplicate/tampered settlement, and settlement before terminal idleness all fail loudly.

Fusion child environments strip session/model/provider variables plus metered credential/base-url variables for OpenRouter, OpenAI, Anthropic, Azure OpenAI, and generic Pi API credentials before launch. Frontier model routes are admitted only when the registry reports subscription OAuth for trusted `anthropic` or `openai-codex` endpoints. There is no fallback, model substitution, endpoint override, or metered API-key route.

## Budgets and output contracts

Budget planning is per route and per stage. Every configured candidate, evaluator, and merger route must have a usable context window. Anthropic routes are conservatively capped to the attribution provider's 200K subscription request policy even when Pi's catalog advertises a larger window; Fusion never budgets against a 1M mode that its attributed transport does not request. The affine estimator from the shared token-budget layer accounts for byte classes plus a 512-token intercept; backed model-family calibrations are used only where applicable, unknown/unbacked providers are reported in artifacts/result details, and multibyte/dense ASCII diagnostics are preserved. Post-run calibration compares that one-request forecast only with the first provider request; cumulative agent-loop and cache usage is retained as total usage but is never misclassified as a prompt under-forecast.

`budget-plan.json` uses `pi-background-tasks.fusion-budget-plan.v4` and records route capacities, stage forecasts for candidate/evaluation/evaluation-repair/merge, conditional repair reservation, warnings, blockers, empty-request counterfactuals, and remediation. Each route reserves the larger of Fusion's 32,768-token output contract reserve and the resolved model's declared maximum output; a model advertising a 128,000-token maximum therefore receives the full 128,000-token reserve. Fatal preflight blockers launch zero children. High utilization or worst-case reservation pressure is a warning when input still fits. Exact rendered prompt checks happen again immediately before candidate, evaluation, repair, and merge launches.

Every candidate system prompt discloses the exact 49,152 JSON-rendered UTF-8 byte hard maximum and requires explicit limitations when the requested scope cannot fit. Output contracts are checked after durable attempt recording: candidate responses up to 48 KiB JSON-rendered bytes, evaluator up to 64 KiB, merger/final report up to 64 KiB, diagnostics contract 8 KiB, child stdout cap 32 MiB, child stderr cap 16 MiB.

When a candidate's first complete `stop` response exceeds 48 KiB, the private child extension durably preserves that full original, removes all active tools, and queues one `followUp` user message before `agent_settled`. The same live Pi process, route, model, and in-memory conversation may only compress/restructure its immediately previous answer; it may not investigate again. Pi text mode then emits only the replacement to stdout. A conforming replacement proceeds normally. A second oversized response hard-fails as `child_output_cap`, preserves both the original artifact and replacement partial response, and never queues another continuation. Cancellation during compression preserves any hash-verified original already written. Fusion never clips, silently forwards, or repairs output in a new child session.

## Artifacts, usage, and lifecycle

Run artifacts are private local evidence under `.pi/fusion/<session-id>-<pid>/<run-id>/`. They include `manifest.json`, `canonical-input.json`, `budget-plan.json`, per-attempt prompts/events/stderr/responses, optional partial responses for failed attempts, optional tool-call logs/seals, `blind-candidates.json`, `evaluation.json`, `merged.md`, manifest-bound `result.json`, `error.json`, and workflow-specific context/source-policy artifacts. `bg_result` verifies manifest state, fixed artifact references, byte lengths, SHA-256 values, UTF-8, run/workflow identity, and result details before returning merged bytes.

Failed and cancelled stored runs additionally write the canonical `pi-background-tasks.fusion-failure-summary.v1` `failure-summary.json` after `error.json` and the terminal manifest transition. The manifest binds that summary's exact basename, byte length, and SHA-256; the summary never hashes `manifest.json`. It is evidence metadata, not an answer: it contains a closed no-answer assertion, bounded terminal-error metadata, durable progress and usage, capped attempt metadata, manifest-bound evidence refs, classifications, remediation identifiers, and explicit omission counts. It contains no candidate/evaluator/merger response text, partial response text, tool-result payload, or fetched content. Completion never writes this artifact.

Summary persistence is subordinate: Fusion writes terminal usage, error evidence, and the failed/cancelled manifest first, then attempts the summary exactly once from a fresh terminal manifest snapshot. A summary-write failure does not retry or suppress terminal publication; the failure channel records one bounded summary-unavailable note. A pre-store refusal has no summary, and an after-store/pre-registration refusal may leave its run directory without inventing a task index.

Artifact writes use durable private temp-file/fsync/rename. Manifests enforce legal state transitions and record config, resolved models, fixed capabilities, context policy, tool policy, anonymous map, attempts, artifact refs, cumulative usage, and errors. Successful, failed, and cancelled observed attempts preserve complete Pi usage/cost components, including optional `cacheWrite1h` and `reasoning` subsets; same-session compression includes both provider turns in that one attempt's aggregate; public tool results clone the same `Usage` shape without counting either subset as additional tokens. Terminal failures enrich their stage-local cause from the durable manifest after usage persistence: candidate/evaluator/merger progress reports completed, failed, cancelled, and not-started child facts plus exact usage so far. A late evaluator or merger budget refusal never claims that no child anywhere in the run was created.

For tool-enabled children, the private audit journal remains open across every low-level `agent_end`, because Pi may still retry, compact and retry, or process a queued continuation. Only terminal `agent_settled` can exclusively publish the complete hash/count/byte seal. Runtime-guard refusal latches process failure, makes that seal incomplete, and forces the result settlement to failed. The child emits one closed `pi-background-tasks.fusion-runtime-guard.v2` stderr frame for malformed provider payloads, malformed Claude cache policy, provider-request loops, or tool-call loops. The frame contains the refusal code, route, request/tool ordinals, bounded payload byte/hash evidence where applicable, and a bounded message; it never emits the payload itself. The parent validates this frame and reports typed `child_runtime_limit_exceeded`, `child_runtime_payload_invalid`, or `child_cache_policy_invalid` instead of accepting a later clean-looking result or reducing it to an unexplained exit code. Tool activity after finalization, duplicate settlement, pre-settlement shutdown, extension diagnostics, malformed/duplicate runtime-guard frames, and missing/failed/stale seals are fatal. This lifecycle requires Pi 0.81.1 or newer; older Pi lines do not expose the required terminal event and are not claimed as compatible.

The four public Fusion tools return a background launch receipt after the readiness barrier. Tool-launched runs default to terminal notification plus follow-up wake; `/fusion` uses notification-only. The first successful `bg_result` retrieval durably claims and attaches complete Fusion usage exactly once; repeated retrieval returns the answer without duplicating session accounting. Running retrieval never waits.

Cancellation and shutdown are loud and durable when a run store exists. The extension tracks active runs, managed tasks own their abort controllers, `bg_kill` and session shutdown abort them, and terminal task publication waits for workflow settlement. Child processes have a 50 minute wall timeout, 35 minute idle watchdog, SIGTERM grace, SIGKILL wait, process-group kill on POSIX, bounded stdout/stderr, and cleanup-error propagation.

## Troubleshooting

- `/fusion-models requires Pi TUI mode`: run from the TUI, not RPC/print/JSON.
- `$current` unavailable or model unavailable: choose explicit available subscription routes with `/fusion-models`.
- Frontier/API route rejected: use Pi Anthropic or Codex subscription OAuth, not OpenAI/OpenRouter/Azure/API-key routes.
- `prompt_budget_exceeded_forecast`: inspect `budget-plan.json`; the error says whether shortening the request can help or whether session history/scope/model context window is the blocker.
- `prompt_budget_exceeded_measured`: an exact rendered prompt exceeded capacity after upstream output was known; split the workflow or choose a larger-context subscription route.
- `child_runtime_limit_exceeded`: a child crossed the 550-provider-request or 600-tool-call execution limit. Inspect the failed tool seal and split an unbounded task rather than raising limits blindly.
- `child_runtime_payload_invalid`: the final provider payload could not be normalized as one stable JSON object. Fix the payload/provider integration; no fallback serialization is attempted.
- `child_cache_policy_invalid`: `PI_CACHE_RETENTION` or Claude cache-control evidence was malformed. Use exactly `none`, `short`, or `long`; do not bypass cache-policy validation.
- `child_output_cap` after candidate compression: inspect the final candidate response, its `response.oversized.*` original, and v4/v3 child protocol evidence. The single same-session no-tool compression attempt also exceeded 49,152 JSON-rendered bytes; split the task rather than truncating or starting a repair child.
- `evaluation schema repair failed`: both evaluator attempts failed the closed JSON contract; inspect `evaluation.attempt-*.response.txt` and errors.
- `tool-call log invalid`: inspect the candidate `*.tool-calls.jsonl` and `*.seal.json`; missing/partial/unsealed logs, non-allowlisted tools, hash/count mismatches, and over-budget tool output fail by design.
- Research fetch failures are typed and do not retry via other URLs or extraction modes; verify the declared URL is public, reachable, supported content, and within caps.

Related user docs: [`../commands/fusion.md`](../commands/fusion.md), [`../commands/fusion-models.md`](../commands/fusion-models.md), [`../tools/fusion_reason.md`](../tools/fusion_reason.md), [`../tools/fusion_investigate.md`](../tools/fusion_investigate.md), [`../tools/fusion_research.md`](../tools/fusion_research.md), [`../tools/fusion_validate.md`](../tools/fusion_validate.md).
