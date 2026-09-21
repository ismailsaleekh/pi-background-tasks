---
doc_id: tools/bg_delegate
audience: agent
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [tool:bg_delegate]
covers_sources: []
---
# `bg_delegate`

<!-- pi-docs:begin name="tool-contract-bg_delegate" generator="scripts/docs/generate.mjs" -->
- Label: **Background Delegate**
- Source: `src/delegate-extension.ts:500`
- Availability: `feature:delegate`
- Available by default: **yes**
- Description: Launch one background Pi agent seeded with a frozen projection of the current conversation, then return a launch receipt immediately. The child has its own session, a route pinned at launch that is never substituted, and read-only tools. Extension discovery is isolated by default; ambient mode supports extension-registered providers but executes arbitrary discovered extension code. Retrieve its verified answer with bg_result.
- Root schema: `object`; additionalProperties: `false`

| Field | Required | Type | Description | Constraints |
| --- | --- | --- | --- | --- |
| `autoDeliver` | no | `string` | Whether the completion notification carries the answer: never \| when_small \| always. Default never; retrieve with bg_result. |  |
| `capability` | no | `string` | Capability profile. Only "inspect" (read/search/list, no shell, no writes, no network, no recursion) is supported. |  |
| `extensionMode` | no | `string` | Extension discovery: isolated \| ambient. Default isolated. Ambient is for extension-registered providers and executes arbitrary discovered extension code, weakening process isolation. |  |
| `maxToolCalls` | no | `number` | Maximum tool calls. Default 120. |  |
| `maxTurns` | no | `number` | Maximum agent turns. Default 24. |  |
| `name` | yes | `string` | Short human-readable task name shown in the bg footer dock. Use 2-6 words. |  |
| `notifyOnCompletion` | no | `boolean` | Deliver the durable terminal notification. Default true. |  |
| `prompt` | yes | `string` | Authoritative instruction for the delegate. The projected conversation is supporting background only. |  |
| `route` | no | `object` | Explicit route. Defaults to the current model. | additionalProperties: false |
| `route.model` | yes | `string` | Exact provider-local model id to pin. |  |
| `route.provider` | yes | `string` | Exact provider name to pin. |  |
| `timeoutSeconds` | no | `number` | Wall-clock timeout. Default 1200. |  |
| `triggerOnCompletion` | no | `boolean` | Let that notification start a follow-up turn. Default true. |  |

<details>
<summary>Normalized TypeBox contract</summary>


```json
{
  "additionalProperties": false,
  "properties": {
    "autoDeliver": {
      "description": "Whether the completion notification carries the answer: never | when_small | always. Default never; retrieve with bg_result.",
      "type": "string"
    },
    "capability": {
      "description": "Capability profile. Only \"inspect\" (read/search/list, no shell, no writes, no network, no recursion) is supported.",
      "type": "string"
    },
    "extensionMode": {
      "description": "Extension discovery: isolated | ambient. Default isolated. Ambient is for extension-registered providers and executes arbitrary discovered extension code, weakening process isolation.",
      "type": "string"
    },
    "maxToolCalls": {
      "description": "Maximum tool calls. Default 120.",
      "type": "number"
    },
    "maxTurns": {
      "description": "Maximum agent turns. Default 24.",
      "type": "number"
    },
    "name": {
      "description": "Short human-readable task name shown in the bg footer dock. Use 2-6 words.",
      "type": "string"
    },
    "notifyOnCompletion": {
      "description": "Deliver the durable terminal notification. Default true.",
      "type": "boolean"
    },
    "prompt": {
      "description": "Authoritative instruction for the delegate. The projected conversation is supporting background only.",
      "type": "string"
    },
    "route": {
      "additionalProperties": false,
      "description": "Explicit route. Defaults to the current model.",
      "properties": {
        "model": {
          "description": "Exact provider-local model id to pin.",
          "type": "string"
        },
        "provider": {
          "description": "Exact provider name to pin.",
          "type": "string"
        }
      },
      "required": [
        "model",
        "provider"
      ],
      "type": "object"
    },
    "timeoutSeconds": {
      "description": "Wall-clock timeout. Default 1200.",
      "type": "number"
    },
    "triggerOnCompletion": {
      "description": "Let that notification start a follow-up turn. Default true.",
      "type": "boolean"
    }
  },
  "required": [
    "name",
    "prompt"
  ],
  "type": "object"
}
```

</details>
<!-- pi-docs:end name="tool-contract-bg_delegate" -->

`bg_delegate` launches one background Pi child for one read-only investigation and returns a launch receipt immediately. Retrieve the answer later with [`bg_result`](bg_result.md).

## Public arguments

Required:

- `name: string` — non-empty after trimming. Used for task display.
- `prompt: string` — non-blank after trimming. The exact string is preserved as `directive.text` and is authoritative.

Optional:

- `route: {provider: string, model: string}` — exact route pin. If omitted, the parent session's current `ctx.model.provider` and `ctx.model.id` are used.
- `capability: "inspect"` — default `"inspect"`; this is the only v1 capability.
- `extensionMode: "isolated" | "ambient"` — default `"isolated"`. Use `"ambient"` only when the pinned provider is implemented by an auto-discovered user/project extension. Ambient mode executes arbitrary discovered extension code and weakens process isolation.
- `maxTurns: positive integer` — default `24`.
- `maxToolCalls: positive integer` — default `120`.
- `timeoutSeconds: positive integer` — default `1200`.
- `autoDeliver: "never" | "when_small" | "always"` — default `"never"`. Current runtime records and reports this setting in launch/task facts; retrieval remains through `bg_result`. The generic terminal notification path does not currently inline delegate answers.
- `notifyOnCompletion: boolean` — default `true`.
- `triggerOnCompletion: boolean` — default `true`; only meaningful when notification is enabled.

The TypeBox schema is closed (`additionalProperties: false`), and preparation validates required/enum/integer fields before launch.

## What the child sees

The child receives a frozen delegate seed built from `visible-conversation-ledger-v2`:

- user text: verbatim;
- assistant text: verbatim;
- user images: marker text only, not raw bytes;
- assistant thinking, tool-call arguments, tool-result text/images: omitted from visible context and recorded in a hash-accounted omission ledger;
- unknown block types: loud projection failure;
- the assistant message containing the active `bg_delegate` call is excluded as a whole, so sibling tool calls in that same message are also excluded.

The prompt/directive has explicit authority over projected history. Projected history is supporting, untrusted context. Facts that existed only in omitted parent tool output are not available to the child; restate them in `prompt`.

## Isolation and route guarantees

The child does not share the parent session. Launch argv gives it a random `--session-id` (`delegate-<32 hex>`) and a task-owned `--session-dir` under the delegate artifact directory.

Route resolution is pin-only:

- omitted `route` pins the parent current model;
- explicit `route` must exactly exist in the current model registry;
- no unavailable route is substituted;
- no fallback list or retry-on-other-model exists;
- routes with no declared context window are refused before child creation;
- the child records provider/model attestations for assistant messages, and a mismatch prevents a successful result commit.

## Inspect-only tool boundary and extension modes

The v1 model-visible capability is enforced by child argv and Pi's tool registry, not merely by prompt text:

- enabled tools: `read`, `grep`, `find`, `ls`, `delegate_read_artifact`;
- `--no-builtin-tools` is used with the explicit allowlist;
- forbidden tools include shell/write/background/delegate/Fusion surfaces (`bash`, `edit`, `write`, `bg_run`, `bg_delegate`, `bg_result`, `bg_run_pi_attested`, Fusion tools, etc.);
- skills, prompt templates, themes, and context files remain disabled in both extension modes;
- the package-owned delegate guard is loaded explicitly in both modes; Anthropic routes first load the package attribution/sanitization extension.

`extensionMode:"isolated"` adds `--no-extensions` and is the default. Use it for built-in providers and whenever ambient provider code is unnecessary.

`extensionMode:"ambient"` omits only `--no-extensions`, allowing Pi to discover trusted-location user/project extensions so a fresh child can resolve an extension-registered provider. It does **not** accept extension paths from the tool call, alter the pinned route, or provide fallback/substitution.

Ambient extensions execute arbitrary code in the child process with Node privileges. The read-only tool allowlist constrains tools exposed to the model; it does not sandbox extension initialization or event handlers. Therefore ambient mode weakens the inspect-only process-isolation guarantee even though the model-visible tool registry remains inspect-only.

There is no shell, edit/write, network tool, recursive delegation, or Fusion in the child tool set. That claim applies to registered model tools, not to arbitrary code loaded by ambient extensions.

## Admission, budgets, and artifacts

Public admission resolves the route, package-owned child guard, and—for Anthropic routes—the package attribution extension before entering `preflightDelegateLaunch()`. Within that preflight, the hook contract is checked before capability/limit/seed/budget admission. Every refusal still occurs before child process, child session directory, or artifact root creation, leaving zero child processes and zero delegate artifacts; callers should not depend on a single absolute error-precedence order across route, guard-extension, and hook checks.

Budgets and limits:

- route capacity is the declared context window minus reserves: `16,384` output, `8,192` framing, `4,096` safety tokens;
- minimum usable input is `8,192` tokens;
- launch admission measures the child system prompt plus the exact child prompt bytes that carry the seed;
- backed large prompts use route-family calibration; the plan also records a provable `1.00 B/token` counter-forecast for every byte class, including multibyte input;
- `32,768` input tokens are protected for finalization, with an `8,192`-token low-runway trigger;
- runtime context estimates are advisory and never masquerade as provider context truth;
- tool results spill above `64 KiB` or earlier when retaining them would consume protected runway;
- artifact range reads are bounded by remaining inline runway;
- aggregate raw tool-output cap: `64 MiB`;
- answer capture cap: `4 MiB`, enforced without committing a prefix;
- timeout defaults to `1200s`.

When protected runway becomes low, the child disables tools and is instructed to answer immediately from evidence already gathered. Pi and the provider—not the package estimator—own final live context admission. A genuine provider context rejection remains a loud failure and is never retried on another route.

Artifacts are under `.pi/delegate/<session-id>-<pid>/<task-id>/` and include `seed.json`, `child-prompt.txt`, `context-omission-ledger.json`, `budget-plan.json`, `manifest.json`, `child-session/`, `spill/`, `runtime-budget.json`, and later `result.json` / `outcome.json` when produced. Child stdout/stderr are captured through the background task output path; terminal failures report that real merged output path when it exists and do not claim absent delegate-local stream files.

## Spilled tool output

Oversized child tool results are written in full to `spill/...` artifacts and replaced in the transcript by receipts carrying path, byte length, SHA-256, content format, tool name, call id, turn sequence, and source call index. Single text blocks retain their exact UTF-8 bytes; malformed lone-surrogate text fails loudly instead of being substituted. Multi-block and image-bearing results use a structured JSON envelope preserving text, block boundaries, MIME type, and complete base64 image data. The raw oversized payload is not forwarded as a fallback and is not truncated.

Inside the child, `delegate_read_artifact({artifact, offset, length})` reads an exact byte range and returns those bytes as base64. It refuses path escape, negative/non-integer offsets, non-positive lengths, and reads past EOF rather than returning a short/clamped range. Base64 prevents a range that splits a UTF-8 sequence from being silently changed to replacement characters.

## Completion

`bg_delegate` returns a receipt with task id, route, child session id, artifact dir, seed hash/size, budget source, extension mode, limits, auto-deliver setting, and notification/wake settings. Ambient receipts include an explicit arbitrary-code/isolation warning. The mode is also hash-bound in `seed.json` and persisted in task facts and `manifest.json`. With default notification settings, the parent receives the generic durable `background-task-notification` after terminal state and may then call `bg_result`. Do not poll solely to wait.
