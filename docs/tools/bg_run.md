---
doc_id: tools/bg_run
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:bg_run]
covers_sources: []
---
# `bg_run`

<!-- pi-docs:begin name="tool-contract-bg_run" generator="scripts/docs/generate.mjs" -->
- Label: **Background Run**
- Source: `src/extension.ts:927`
- Availability: `always`
- Available by default: **yes**
- Description: Start a named long-running shell command in the background and return immediately with a task ID and output path. By default, completed, failed, or killed terminal state is delivered automatically as <background-task-notification> and starts a follow-up agent turn; do not sleep or poll merely to wait. Output is written to .pi/tasks and model-visible logs are bounded to 50.0KB.
- Root schema: `object`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `command` | yes | `string` | Shell command to start in the background |  |
| `description` | no | `string` | Optional longer human-readable context for the task |  |
| `isAgent` | yes | `boolean` | Required. Set true only when this background task launches an LLM/agent process, such as a child `pi -p ...` or `pi --mode json ...`, so Pi-agent telemetry can be collected. Set false for scripts, tests, servers, sleeps, and ordinary shell commands. |  |
| `name` | yes | `string` | Short human-readable task name shown in the bg footer dock. Required; use 2-6 words, not the raw command. |  |
| `notifyOnCompletion` | no | `boolean` | Whether to deliver the durable terminal notification. Default: true; disable only when deliberately taking over completion monitoring. |  |
| `surviveReload` | no | `boolean` | Opt in to retaining this exact ordinary isAgent:false shell execution across a real same-process Pi reload. Default: false. Unsupported for agent, managed, delegate, Fusion, and attested tasks. |  |
| `timeoutSeconds` | no | `number` | Optional timeout; task is failed and killed when exceeded |  |
| `triggerOnCompletion` | no | `boolean` | Whether that notification should automatically trigger a follow-up agent turn. Default: true for bg_run; requires notifyOnCompletion. |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "properties": {
    "command": {
      "description": "Shell command to start in the background",
      "type": "string"
    },
    "description": {
      "description": "Optional longer human-readable context for the task",
      "type": "string"
    },
    "isAgent": {
      "description": "Required. Set true only when this background task launches an LLM/agent process, such as a child `pi -p ...` or `pi --mode json ...`, so Pi-agent telemetry can be collected. Set false for scripts, tests, servers, sleeps, and ordinary shell commands.",
      "type": "boolean"
    },
    "name": {
      "description": "Short human-readable task name shown in the bg footer dock. Required; use 2-6 words, not the raw command.",
      "type": "string"
    },
    "notifyOnCompletion": {
      "description": "Whether to deliver the durable terminal notification. Default: true; disable only when deliberately taking over completion monitoring.",
      "type": "boolean"
    },
    "surviveReload": {
      "description": "Opt in to retaining this exact ordinary isAgent:false shell execution across a real same-process Pi reload. Default: false. Unsupported for agent, managed, delegate, Fusion, and attested tasks.",
      "type": "boolean"
    },
    "timeoutSeconds": {
      "description": "Optional timeout; task is failed and killed when exceeded",
      "type": "number"
    },
    "triggerOnCompletion": {
      "description": "Whether that notification should automatically trigger a follow-up agent turn. Default: true for bg_run; requires notifyOnCompletion.",
      "type": "boolean"
    }
  },
  "required": [
    "command",
    "isAgent",
    "name"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-bg_run" -->

Start a named long-running shell command in the background and return immediately.

## Schema


Required public fields:

- `name: string` — concise 2-6 word task name for the footer dock.
- `command: string` — shell command to run.
- `isAgent: boolean` — explicit telemetry control; `true` only for LLM/agent processes such as child `pi -p ...` or `pi --mode json ...`.

Optional fields:

- `description: string`
- `timeoutSeconds: number`
- `notifyOnCompletion: boolean`
- `triggerOnCompletion: boolean`
- `surviveReload: boolean` — opt in only for ordinary `isAgent:false` shell work that must keep the same live execution across a supported real reload.

Legacy argument preparation can derive a missing `name` from `description` or `command`, but the public schema remains strict and requires `name`, `command`, and `isAgent`.

## When to use

Use for long-running tests, builds, servers, watchers, sleeps, and child agent work. Do not use normal foreground shell tools for commands expected to outlive the current turn.

For an Anthropic child `pi`, keep normal extension discovery enabled when parent ambient attribution is enabled. Do not pass `--no-extensions` unless the command also explicitly loads this package's always-on `extensions/anthropic-attribution-child.ts` with `-e`/`--extension`.

## Defaults

- `notifyOnCompletion`: `true`.
- `triggerOnCompletion`: `true`.
- `timeoutSeconds`: absent means no timeout.
- `isAgent`: no default in the tool contract; callers must provide a boolean. It is not inferred from command text.
- `surviveReload`: `false`. True is valid only with `isAgent:false` and never changes the default for other launches.

## Shell selection and guidance

The extension resolves one immutable shell selection per activation. Before the model generates a command, agent guidance states the exact executable, dialect, and argument shape used by `bg_run`. The same facts appear in the returned task's `shellPolicy` and durable metadata. Guidance never includes the full environment.

The compatible POSIX default is `PI_BG_POSIX_SHELL=inherit`: use non-empty `SHELL`, otherwise `/bin/sh`, with `-c`. To deliberately request the Bash syntax models commonly generate, set `PI_BG_POSIX_SHELL=bash` before starting or reloading Pi. `PI_BG_POSIX_SHELL=sh` selects portable sh. An optional `PI_BG_POSIX_SHELL_PATH` is valid only for explicit Bash/sh and must be an absolute regular executable. Bash/sh use `-c`, not a login shell. See [Configuration](../operations/configuration.md) for exact `/bin`-then-`PATH` search and validation.

Inherited Nu, fish, csh, and unknown shells remain the default when selected through `SHELL`, but are labeled `user-non-posix`, not POSIX or Bash. Their guidance says not to generate Bash syntax and gives explicit Bash remediation. Windows keeps its separate `PI_BG_SHELL` policy and ignores the POSIX variables.

## Lifecycle

The tool returns a task id, current `running` status, pid if known, output path, completion-delivery guidance, and structured task details including the actual shell policy. Terminal statuses are exactly `completed`, `failed`, or `killed`. With default delivery, terminal state is sent as `<background-task-notification>` and starts a follow-up agent turn; after launching, do not sleep or poll merely to wait.

An opted ordinary task crosses a supported real same-process reload as the same living child, task id, PID, launch nonce, completion id, output path/stream, shell policy, absolute timeout, launch-time cap, cumulative byte count, and tree authority. Completion in the hostless gap queues for the fresh activation. Status/logs/kill/commands/dock continue against that same object. Hard crash/process restart, new/resume/fork/clone/quit, and SDK reload without a fresh counted binding are not survival paths.

## Examples

```json
{"name":"Docs build","command":"npm run docs","isAgent":false}
```

```json
{"name":"Child summary","command":"pi -p 'summarize changes'","isAgent":true,"timeoutSeconds":600}
```

```json
{"name":"Manual server","command":"npm run dev","isAgent":false,"notifyOnCompletion":false,"triggerOnCompletion":false}
```

```json
{"name":"Reload-safe watcher","command":"npm run watch","isAgent":false,"surviveReload":true}
```

## Output/result

Text result:

```text
Started background task <name> (<id>)
Status: running
PID: <pid|unknown>
Output: .pi/tasks/.../<id>.output
Terminal notification: enabled.
Automatic follow-up turn: enabled.
...
```

Structured details include `task`, a snapshot with command, status, output path, cwd, timing, pid, byte count, `isAgent`, `surviveReload`, optional non-authoritative `reloadSurvival` audit facts, delivery flags, the non-secret `shellPolicy` (`policy`, `executable`, `argvPrefix`, `dialect`) for ordinary shell tasks, telemetry fields when available, and error when present.

## Errors

- Missing/non-object args in preparation: `bg_run arguments must be an object`.
- Missing command: `bg_run requires command string`.
- Missing `isAgent`: loud error explaining true/false use.
- Empty command at execution: `Background command is empty`.
- Invalid explicit POSIX shell mode/path or an unavailable requested Bash/sh route fails loudly without fallback.
- A malformed survival value fails as `pi_bg_survive_reload_invalid`; true with `isAgent:true` fails as `pi_bg_survive_reload_requires_non_agent`, both before side effects.
- Missing/stale/conflicting/incompatible activation ownership fails with a stable `pi_bg_reload_owner_*` code. A handoff that receives no compatible claimant reaches fixed-deadline cleanup as `pi_bg_reload_handoff_expired`.
- Shell/spawn/timeout/output-cap failures become loud task failures.

## Runtime artifacts

Creates `.pi/tasks/<session-id>-<pid>/<task-id>.output` and `.json`; the JSON records the actual ordinary-task shell policy. If `isAgent:true`, the command matches an interceptable `pi -p`, `pi --print`, or `pi --mode json` invocation, and the resolved shell supports POSIX function syntax, a temporary telemetry wrapper file is also written in the task directory. Unknown/non-POSIX inherited shells are left unwrapped with a diagnostic.

## Safety boundaries

The command runs through the platform shell and is not sandboxed. Use `isAgent:true` only to request Pi-agent telemetry wrapping; setting it does not make execution safer. Model-visible logs are bounded and point to the full output path.

`bg_run` does not parse or repair arbitrary child `pi` argv. An Anthropic command that uses `--no-extensions` without explicitly loading the attribution extension bypasses the package's attribution/sanitization contract and is unsupported.

## Related docs

- [Completion delivery](../concepts/completion-delivery.md)
- [`bg_status`](bg_status.md)
- [`bg_logs`](bg_logs.md)
- [`bg_kill`](bg_kill.md)
- [`/bg`](../commands/bg.md)
- [Background task runtime](../subsystems/background-task-runtime.md)
- [Anthropic attribution](../subsystems/anthropic-attribution.md)

## Source ownership/reference

Tool registration lives in `src/extension.ts`; runtime lifecycle is owned by [background-task-runtime](../subsystems/background-task-runtime.md).
