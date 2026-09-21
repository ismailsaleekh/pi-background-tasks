---
doc_id: tools/bg_run_pi_attested
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:bg_run_pi_attested]
covers_sources: []
---
# `bg_run_pi_attested`

<!-- pi-docs:begin name="tool-contract-bg_run_pi_attested" generator="scripts/docs/generate.mjs" -->
- Label: **Attested Pi Run**
- Source: `src/extension.ts:1036`
- Availability: `feature:attested`
- Available by default: **yes**
- Description: Opt-in evidence-oriented direct Pi spawn. Launches exactly one `pi --mode json` child, records raw Pi events/stderr, hashes prompt/report/output, observes OAuth through ModelRegistry, and emits a strict attestation sidecar only after successful completion.
- Root schema: `object`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `extraPiArgs` | no | `string[]` |  |  |
| `model` | yes | `string` | Exact provider-local Pi model id to launch. |  |
| `name` | yes | `string` | Short human-readable name for this attested Pi task. |  |
| `prompt` | yes | `string` | Prompt bytes passed as the single user prompt to Pi. |  |
| `provider` | yes | `string` | Exact Pi provider to launch, for example openai-codex or anthropic. |  |
| `reportPath` | yes | `string` | Relative path, inside the task cwd, that the child Pi run must write as its report. |  |
| `thinking` | no | `string` | Optional Pi thinking level argument. |  |
| `timeoutSeconds` | no | `number` | Optional timeout; task is failed and killed when exceeded |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "properties": {
    "extraPiArgs": {
      "items": {
        "description": "Additional literal Pi argv entries; mode/provider/model/api-key args are rejected.",
        "type": "string"
      },
      "type": "array"
    },
    "model": {
      "description": "Exact provider-local Pi model id to launch.",
      "type": "string"
    },
    "name": {
      "description": "Short human-readable name for this attested Pi task.",
      "type": "string"
    },
    "prompt": {
      "description": "Prompt bytes passed as the single user prompt to Pi.",
      "type": "string"
    },
    "provider": {
      "description": "Exact Pi provider to launch, for example openai-codex or anthropic.",
      "type": "string"
    },
    "reportPath": {
      "description": "Relative path, inside the task cwd, that the child Pi run must write as its report.",
      "type": "string"
    },
    "thinking": {
      "description": "Optional Pi thinking level argument.",
      "type": "string"
    },
    "timeoutSeconds": {
      "description": "Optional timeout; task is failed and killed when exceeded",
      "type": "number"
    }
  },
  "required": [
    "model",
    "name",
    "prompt",
    "provider",
    "reportPath"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-bg_run_pi_attested" -->

`bg_run_pi_attested` is an opt-in evidence-producing Pi run. It is separate from `bg_run`: it never accepts a shell command and launches exactly one direct child Pi invocation in JSON mode.

## Public arguments

Required:

- `name: string` — concise task name; later validation rejects blank names.
- `provider: string` — exact Pi provider; later validation rejects blank provider.
- `model: string` — provider-local model id; later validation rejects blank model.
- `prompt: string` — prompt passed as the single Pi user prompt; empty string is rejected.
- `reportPath: string` — relative path inside task cwd that the child prompt/run is expected to write; blank, absolute, escaping, `.git/...`, and `.pi/tasks/...` targets are rejected.

Optional:

- `extraPiArgs: string[]` — literal extra Pi argv entries. Entries must be strings.
- `thinking: string` — structured Pi thinking level; if non-blank, emitted as `--thinking <value>`.
- `timeoutSeconds: number` — optional timeout; positive finite values are floored by the registry, non-positive/non-finite values are effectively not used as a timeout.

There are no provider/model/prompt defaults and no notification parameters on this tool. The registry creates attested tasks with background completion notification/wake disabled (`notifyOnCompletion:false`, `triggerOnCompletion:false`) while still publishing terminal snapshots through the task system. The current TypeBox declaration does not set `additionalProperties:false`; preparation reads only the fields above and validates their types.

Forbidden in `extraPiArgs`: `--api-key`, `--auth-file`, `-p`, `--print`, `--mode`, structured duplicates of `--provider`, `--model`, and `--thinking`.

## Launch shape

The logical argv is:

```text
pi --mode json --provider <provider> --model <model> [--thinking <thinking>] [...extraPiArgs] <prompt>
```

The registry resolves the platform-specific Pi executable and spawns without a shell (`shell:false`). On POSIX this is normally the `pi` executable; on Windows the package may launch Pi through the resolved Node/CLI path while the attested logical argv remains `['pi', ...]`.

The child environment strips metered/direct API variables including OpenAI, Anthropic, OpenRouter, `PI_API_KEY`, base URL overrides, and `PI_AUTH_FILE`. Authentication is not accepted from tool arguments.

## OAuth and route observation

Before spawn, the producer asks the model registry for the exact `provider/model` and requires `ModelRegistry.isUsingOAuth`. Supported observed OAuth classes are:

- `openai-codex` → `pi-codex-oauth`, channel `subscription-codex`;
- `anthropic` → `pi-anthropic-oauth`, channel `subscription-anthropic`.

The child Pi JSON event stream must later contain exactly one session, one `agent_start`, at least one assistant message, and one `agent_end`; assistant messages must report a stable provider/model, and the last assistant `stopReason` value reported in the stream must be `stop`. A later assistant message that omits `stopReason` does not clear an earlier reported value. The observed provider/model must match the selected registry model before attestation is accepted.

## Runtime files

Files live under the background task runtime directory:

```text
.pi/tasks/<session-id>-<pid>/<task-id>.output
.pi/tasks/<session-id>-<pid>/<task-id>.json
.pi/tasks/<session-id>-<pid>/<task-id>.pi-events.jsonl
.pi/tasks/<session-id>-<pid>/<task-id>.stderr
.pi/tasks/<session-id>-<pid>/<task-id>.pi-telemetry-wrapper.cjs
.pi/tasks/<session-id>-<pid>/<task-id>.attestation.json
```

For attested runs the wrapper file is an evidence note (`direct-spawn attested Pi task; no shell telemetry wrapper is used`), not a shell wrapper. Raw child stdout is captured as Pi JSON events; raw stderr is captured separately. Human-readable task output is reconstructed from assistant/tool events on success, or from stderr/error text on failure.

## Sidecar contents

Successful attestation sidecars use schema `phase2.pi_task_attestation.v1` and include:

- locator: session dir, task id, metadata/output/events/stderr/wrapper refs;
- source hashes for metadata, output, events, stderr, wrapper;
- lifecycle: status, agent flag, times, exit code/signal, bytes written;
- invocation: Pi session id, logical argv, cwd realpath, provider, model id, provider-scoped model id, API identity, auth class, credential kind, route class, channel, `direct_api_key:false`, final stop reason;
- authority: repo root realpath, start/finish commit and tree OIDs, clean-worktree booleans;
- artifacts: prompt hash, task output hash, stderr hash, transcript hash, report hash;
- `attestation_sha256`: hash of the canonical sidecar without that self field.

The worktree must be clean at start and finish, and the commit/tree must not change during the task.

## Durability and failure behavior

The sidecar is written only after successful child completion, event parsing, report hashing, git authority checks, and attestation construction. The final sidecar write uses durable same-directory replacement. In-memory terminal completion (`task.status = completed` plus terminal publication) happens after the sidecar write returns; the metadata file may have a completed snapshot staged earlier as part of the sidecar construction path.

If the child fails, times out, is killed, emits malformed/incomplete events, writes no required report, changes git authority, uses non-OAuth/unsupported auth, or fails attestation construction, the task is failed/killed and no successful sidecar is emitted. Existing raw evidence files (`*.pi-events.jsonl`, `*.stderr`, `*.output`, metadata) remain for diagnosis.

## Trust boundary

This is local, unsigned, same-user-writable evidence. It is useful for local auditability and reproducibility of what this extension observed, but it is not a remote cryptographic proof, not a signature, and not tamper-resistant against a user or process that can write the working tree or `.pi/tasks` directory.

## Intended use

Use `bg_run_pi_attested` when the user explicitly asks for an evidence-producing Pi child with local hashes and route/auth observation. Use ordinary `bg_run` for normal background commands or agent jobs that do not need this sidecar contract.
