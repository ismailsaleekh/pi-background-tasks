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
| Command | Description | Provenance |
| --- | --- | --- |
| `/fusion-models` | Open the five-slot global fusion model selector. | `src/fusion-extension.ts:1035` |
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

## UI behavior

The selector starts from the loaded config or the default all-`$current` config. It lists:

- `$current` first, with the current provider/model in the description when known;
- currently available registry models sorted by `provider/model`;
- configured-but-unavailable selections, marked unavailable, so stale configs can still be seen and replaced.

In the five-slot view, arrow keys move, Enter opens the model list, `r` resets the draft to defaults, `s` saves, and Esc or `q` cancels without saving. In the model-choice view, arrow keys move, typed text—including `q`—filters the list, Backspace edits the filter, Enter chooses and returns to the slots, and Esc returns to the slots without changing that slot.

## Persistence and conflicts

The config file is `fusion-models.json` in Pi's agent directory (`fusionModelConfigPath()`). Its schema is closed:

```json
{
  "schema_version": "pi-background-tasks.fusion-models.v1",
  "candidates": ["$current", "$current", "$current"],
  "evaluator": "$current",
  "merger": "$current"
}
```

Loads reject invalid JSON, unknown keys, wrong schema version, blank selections, surrounding whitespace, unqualified configured selections, and candidate arrays that do not contain exactly three entries.

Saves are durable and revision-safe: the parent captures the file revision hash on load, takes a lock next to the config, verifies the on-disk revision still matches, then atomically replaces the file. If another process changes the file first, the save fails with a config-conflict error shown inside the selector; it does not overwrite concurrent work. Lock acquisition times out loudly after 10 seconds.

## Route admission

At run time every slot is resolved through the available model registry. Frontier routes are accepted only through the Pi subscription OAuth path for `anthropic` or `openai-codex` and only on trusted subscription endpoints. Direct OpenAI/OpenRouter/Azure/frontier API-key routes, endpoint/header overrides of subscription auth, unavailable models, missing current model, and missing positive context windows fail before child creation. There is no fallback, model substitution, or tier bump.

## Related

- Command using the selected routes: [`fusion.md`](fusion.md)
- Behavioral owner/troubleshooting: [`../subsystems/fusion.md`](../subsystems/fusion.md)
