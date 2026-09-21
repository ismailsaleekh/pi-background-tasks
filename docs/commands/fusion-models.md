---
doc_id: commands/fusion-models
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:fusion-models]
covers_sources: []
---
# `/fusion-models`

<!-- pi-docs:begin name="command-contract-fusion-models" generator="scripts/docs/generate.mjs" -->
| Command | Availability | Default | Description | Provenance |
| --- | --- | --- | --- | --- |
| `/fusion-models` | `feature:fusion` | yes | Open the five-slot global fusion model selector. | `src/fusion-extension.ts:1123` |
<!-- pi-docs:end name="command-contract-fusion-models" -->

Open the global Fusion model selector.

## Availability

`/fusion-models` is **TUI-only**. RPC, JSON, print, and other non-TUI modes reject it; non-UI command contexts throw an error instead of relying on a no-op notification path.

## Slots

The selector edits exactly five global slots:

1. `Candidate 1`
2. `Candidate 2`
3. `Candidate 3`
4. `Evaluator`
5. `Merger`

Duplicate model selections are allowed. `$current` is the default for every slot and resolves at run time to Pi's current model; it is available only when a current model exists and is available to child Pi. Slash-containing model ids are stored as `provider/model-id` strings.

## What each role does

Fusion follows one fixed pipeline: preflight, three candidates in parallel, an evaluator, an optional evaluator repair, then a merger.

### Candidate 1, Candidate 2, and Candidate 3

The candidates are three independent attempts over the same canonical input, with the same workflow instruction and fixed workflow tools. They are not assigned specialties: Candidate 1 is not inherently a researcher, Candidate 2 a critic, or Candidate 3 a writer. A tool-enabled workflow lets every candidate use that workflow's same allowlist; `reason` gives all three no tools.

The candidate wave must finish before evaluation, so the slowest candidate controls successful wave latency. Choosing different capable routes can improve answer diversity, but route diversity does not guarantee different reasoning or coverage. Repeating one route is valid and can still produce useful independent attempts, but the answers may be similar—especially when that route behaves deterministically.

### Evaluator

The evaluator starts after all candidates complete. It receives the original canonical input and the three anonymous answers labeled A, B, and C, with no provider, model, slot, or completion-order identity. It has no tools. It compares strengths, limitations, agreements, conflicts, risks, and useful contributions, then emits closed JSON containing a constrained `synthesis_plan`; it does not select a winner or write the user-facing answer.

If that JSON is invalid or schema-invalid, Fusion makes exactly one repair attempt using the same evaluator slot and resolved model. The repair receives the original blind input, the invalid output, and bounded validation errors. A second invalid result fails the run; Fusion does not switch models or add another repair.

### Merger

The merger starts only after a valid evaluation. It receives the original canonical input, all three candidate outputs, and the validated evaluation. It has no tools and the merge stage produces the sole final user-facing answer; candidates and evaluator output are never returned as the answer. For `fusion_validate`, the host renders the final report from validated finding accounting after the no-tool merger rather than forwarding unverified merger prose.

This is the final sequential stage and normally has the greatest synthesis burden: it must reconcile all upstream material rather than retrieve new facts.

## Choosing models

There is no universally best assignment. Use only routes currently listed as available by the selector, and account for both capability and context capacity.

| Goal | Candidates | Evaluator | Merger |
| --- | --- | --- | --- |
| **Quality-first** | Choose three strong task-capable routes; use different routes when their genuine differences are useful, while remembering that diversity is not guaranteed. | Prefer strong comparison and schema reliability. It must absorb the input plus all three answers, and one failed schema attempt adds repair latency. | Prefer the strongest available synthesis route with enough context for every upstream answer and the evaluation. |
| **Speed-first** | Choose fast routes for all three; one slow outlier delays the whole parallel wave. Repeating one fast route is allowed. | Choose a fast, schema-reliable route so the sequential stage is short and the optional repair is unlikely. | Choose a capable fast synthesizer; its latency is added after the complete candidate and evaluator stages. |

Context capacity can outweigh nominal model strength. Each candidate sees the canonical input; the evaluator fans in that input plus three bounded candidate outputs; the merger additionally receives the validated evaluation. Conditional repair has the widest evaluator input because it also includes the invalid evaluation and validation errors. Fusion measures each rendered stage against that slot's route before launch, so a stronger small-context route can still be unusable. See [Fusion runtime limits](../operations/configuration.md#fusion-runtime-limits) and [budget behavior](../subsystems/fusion.md#budgets-and-output-contracts).

For frontier models, every role must remain on Pi's Anthropic or Codex subscription OAuth channel. Here “expensive” can mean latency, subscription quota, and token/context use; it is not permission to move a role to a metered API route.

## Slots are not calls

Five role slots do not promise five distinct models or five provider calls. `$current` and explicit selections may be duplicated across any slots. An ordinary success without repair uses five child invocations: three candidates, one evaluator, and one merger. A successful evaluator repair makes six child invocations. A preflight rejection creates zero children. Failed or cancelled runs can stop with fewer completed children, transient pre-creation spawn failures can change launch attempts, and each child Pi process can make multiple provider requests within its runtime limits.

## UI behavior

The selector starts from the loaded config or the default all-`$current` config. It lists:

- `$current` first, with the current provider/model in the description when known;
- currently available registry models sorted by `provider/model`;
- configured-but-unavailable selections, marked unavailable, so stale configs can still be seen and replaced.

In the five-slot view, arrow keys move, Enter opens the model list, `r` resets the draft to defaults, `s` saves, and Esc or `q` cancels without saving. In the model-choice view, arrow keys move, typed text—including `q`—filters the list, Backspace edits the filter, Enter chooses and returns to the slots, and Esc returns to the slots without changing that slot.

## Persistence and conflicts

The config file is `fusion-models.json` in Pi's agent directory (`fusionModelConfigPath()`). Its schema is closed.

### Valid repeated-route example

This is both a valid configuration and the missing-file default. It deliberately demonstrates `$current` and duplicates; at run time the current route must still be available and pass admission for child Pi.

```json
{
  "schema_version": "pi-background-tasks.fusion-models.v1",
  "candidates": ["$current", "$current", "$current"],
  "evaluator": "$current",
  "merger": "$current"
}
```

For explicit selections, save only exact `provider/model-id` keys shown as available by `/fusion-models`; no model aliases are implied by the quality-first or speed-first recipes above. Reusing the same exact key in multiple slots is valid.

Loads reject invalid JSON, unknown keys, wrong schema version, blank selections, surrounding whitespace, unqualified configured selections, and candidate arrays that do not contain exactly three entries.

Saves are durable and revision-safe: the parent captures the file revision hash on load, takes a lock next to the config, verifies the on-disk revision still matches, then atomically replaces the file. If another process changes the file first, the save fails with a config-conflict error shown inside the selector; it does not overwrite concurrent work. Lock acquisition times out loudly after 10 seconds.

## Route admission

At run time every slot is resolved through the available model registry. Frontier routes are accepted only through the Pi subscription OAuth path for `anthropic` or `openai-codex` and only on trusted subscription endpoints. Direct OpenAI/OpenRouter/Azure/frontier API-key routes, endpoint/header overrides of subscription auth, unavailable models, missing current model, and missing positive context windows fail before child creation. There is no fallback, model substitution, or tier bump.

## Related

- Command using the selected routes: [`fusion.md`](fusion.md)
- Behavioral owner/troubleshooting: [`../subsystems/fusion.md`](../subsystems/fusion.md)
