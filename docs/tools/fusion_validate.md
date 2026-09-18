---
doc_id: tools/fusion_validate
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:fusion_validate]
covers_sources: []
---
# `fusion_validate`

<!-- pi-docs:begin name="tool-contract-fusion_validate" generator="scripts/docs/generate.mjs" -->
- Label: **Fusion Validate**
- Source: `src/fusion-extension.ts:1248`
- Description: Start an advisory, read-only Fusion validation review as a tracked background task and return immediately after durable preflight. Retrieve the verified result with bg_result after notification. It is not a build/test/lint substitute and never modifies files.
- Root schema: `object`; additionalProperties: `false`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `acceptanceCriteria` | yes | `string[]` |  | minItems 1 |
| `background` | yes | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `changeSummary` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `exclusions` | no | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `knownLimitations` | no | `string[]` | Array of non-empty strings. Runtime normalization trims every item. |  |
| `objective` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `scope` | yes | `string[]` |  | minItems 1 |
| `verification` | yes | `object` |  | additionalProperties: false |
| `verification.evidence` | no | `object[]` |  |  |
| `verification.evidence[].check` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `verification.evidence[].outcome` | yes | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `verification.reason` | no | `string` | Non-empty string. Runtime normalization trims and rejects whitespace-only text. | minLength 1 |
| `verification.status` | yes | `string` | Google-compatible enum. Use 'provided' only with evidence; use 'not_run' only with reason and no evidence. | enum `provided` \| `not_run` |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "additionalProperties": false,
  "properties": {
    "acceptanceCriteria": {
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "minItems": 1,
      "type": "array"
    },
    "background": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "changeSummary": {
      "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
      "minLength": 1,
      "type": "string"
    },
    "exclusions": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "knownLimitations": {
      "description": "Array of non-empty strings. Runtime normalization trims every item.",
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "type": "array"
    },
    "objective": {
      "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
      "minLength": 1,
      "type": "string"
    },
    "scope": {
      "items": {
        "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
        "minLength": 1,
        "type": "string"
      },
      "minItems": 1,
      "type": "array"
    },
    "verification": {
      "additionalProperties": false,
      "properties": {
        "evidence": {
          "items": {
            "additionalProperties": false,
            "properties": {
              "check": {
                "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
                "minLength": 1,
                "type": "string"
              },
              "outcome": {
                "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
                "minLength": 1,
                "type": "string"
              }
            },
            "required": [
              "check",
              "outcome"
            ],
            "type": "object"
          },
          "type": "array"
        },
        "reason": {
          "description": "Non-empty string. Runtime normalization trims and rejects whitespace-only text.",
          "minLength": 1,
          "type": "string"
        },
        "status": {
          "description": "Google-compatible enum. Use 'provided' only with evidence; use 'not_run' only with reason and no evidence.",
          "enum": [
            "provided",
            "not_run"
          ],
          "type": "string"
        }
      },
      "required": [
        "status"
      ],
      "type": "object"
    }
  },
  "required": [
    "acceptanceCriteria",
    "background",
    "changeSummary",
    "objective",
    "scope",
    "verification"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-fusion_validate" -->

Fixed-purpose public Fusion tool for advisory read-only validation of completed work.

## Signature

```ts
fusion_validate({
  objective: string,
  background: string[],
  changeSummary: string,
  scope: string[],
  acceptanceCriteria: string[],
  verification: {
    status: 'provided' | 'not_run',
    evidence?: Array<{ check: string, outcome: string }>,
    reason?: string
  },
  knownLimitations?: string[],
  exclusions?: string[]
})
```

The schema is closed. `scope` and `acceptanceCriteria` must be non-empty arrays. Optional `knownLimitations` and `exclusions` normalize to `[]`. Legacy `{prompt}` calls fail with an actionable migration error. There is no public capability or mode argument.

## Verification cross-field contract

`verification` is intentionally strict:

- `status: 'provided'` requires non-empty `evidence:[{check,outcome}]` and forbids `reason`.
- `status: 'not_run'` requires `reason` and forbids non-empty evidence.

The enum strings are Google-compatible and the runtime enforces the cross-field contract after schema preparation.

## Context and tools

Validate uses clean-task canonical input with no parent transcript, parent system prompt, conversation projection, or omission ledger. Candidate reviewers always use the inspect policy (`read`, `grep`, `find`, `ls`) so they can verify the repository as it exists. Evaluator, evaluator-repair, and merger always run with no tools.

## Validation workflow

Each candidate must return closed JSON (`pi-background-tasks.fusion-validation-candidate.v1`) listing findings, verified statements, and limitations. The host assigns stable source finding ids after anonymization. The blind evaluator must copy the host-assigned source findings exactly into `validation_accounting`, then account for every source finding exactly once as included or excluded. Included decisions require a group; excluded decisions forbid a group. Groups must exactly match included decisions.

After the no-tool merger child runs, the host renders the final validation report from validated accounting so included findings are preserved, duplicate groups are merged deterministically, excluded findings are listed only as exclusions, and candidate labels/source ids are sanitized from rationale text.

## Background delivery and advisory limitation

After durable no-child preflight, the tool returns a tracked background task receipt. Wait for the terminal notification, then call `bg_result({taskId})` once; retrieval verifies the committed report and never truncates. The repository is read live, so do not mutate the reviewed scope while the task runs.

`fusion_validate` never modifies files, never runs builds/tests/linters/security scanners, and does not gate anything. It is an advisory read-only review. Supply real verification evidence when available, and state known limitations/exclusions explicitly.

## Related

- Behavioral owner/troubleshooting: [`../subsystems/fusion.md`](../subsystems/fusion.md)
