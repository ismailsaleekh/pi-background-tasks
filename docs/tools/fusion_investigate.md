---
doc_id: tools/fusion_investigate
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:fusion_investigate]
covers_sources: []
---
# `fusion_investigate`

<!-- pi-docs:begin name="tool-contract-fusion_investigate" generator="scripts/docs/generate.mjs" -->
- Label: **Fusion Investigate**
- Source: `src/fusion-extension.ts:1305`
- Availability: `feature:fusion`
- Available by default: **yes**
- Description: Start a five-model Fusion investigation as a tracked background task and return immediately after durable preflight. Retrieve the verified result with bg_result after notification. Candidate children run in clean bounded read-only contexts.
- Root schema: `object`; additionalProperties: `false`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `background` | yes | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `constraints` | no | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `deliverable` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `objective` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `scope` | no | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "additionalProperties": false,
  "properties": {
    "background": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "constraints": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "deliverable": {
      "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
      "minLength": 1,
      "type": "string"
    },
    "objective": {
      "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
      "minLength": 1,
      "type": "string"
    },
    "scope": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    }
  },
  "required": [
    "background",
    "deliverable",
    "objective"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-fusion_investigate" -->

Fixed-purpose public Fusion tool for bounded read-only repository investigation.

## Signature

```ts
fusion_investigate({
  objective: string,
  background: string[],
  deliverable: string,
  scope?: string[],
  constraints?: string[]
})
```

The schema is closed. `objective`, `background`, and `deliverable` are required; every string trims to non-blank text. Optional `scope` and `constraints` normalize to `[]` when omitted. Unknown keys are rejected. There is no public capability or mode argument.

## Context and tools

Investigate uses clean-task canonical input (`pi-background-tasks.fusion-input.v5`) with policy `fusion-clean-task-v1`. Children receive only `workflow`, `cwd`, `request`, and clean context. They do **not** receive the parent transcript, parent system prompt, conversation projection, omission ledger, or hidden tool payloads.

Candidate children run with the fixed inspect policy: `read`, `grep`, `find`, and `ls` only, with built-in tools disabled and Fusion/background/write/shell tools denied. Evaluator, evaluator-repair, and merger run with no tools.

## Execution and delivery model

After durable no-child preflight, the tool returns a tracked background task receipt. Three inspect candidates independently re-derive repository facts, a blind evaluator compares anonymous candidate answers, and a merger synthesizes the final answer. One evaluator-repair child is run only when the first evaluator response is invalid JSON or fails the evaluation schema.

Wait for the terminal notification, then call `bg_result({taskId})` once. Retrieval verifies the committed result and never truncates. Repository reads are live, so continue only independent work and do not mutate the investigated scope while the task runs.

## Failure behavior

Malformed structured input fails before child creation. Prompt-budget failures name the blocking stage and remediation. Tool-enabled children must produce a sealed tool-call audit; missing, partial, unsealed, non-contiguous, over-budget, or non-allowlisted tool traces fail loudly.

## Related

- Behavioral owner/troubleshooting: [`../subsystems/fusion.md`](../subsystems/fusion.md)
