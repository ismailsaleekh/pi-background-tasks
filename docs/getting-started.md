---
doc_id: getting-started
audience: user
mode: authored
review_policy: contract
stability: stable
covers_surfaces: []
covers_sources: []
---
# Getting started

This guide gets from install to useful background work in a few minutes.

## 1. Install

```bash
pi install npm:pi-background-tasks@latest
```

For a project-local install:

```bash
pi install npm:pi-background-tasks@latest -l
```

For current repository state rather than a release tag:

```bash
pi install git:github.com/ismailsaleekh/pi-background-tasks@main
```

For a local checkout/package path:

```bash
pi install .
pi install . -l
```

## SDK embedding requirement

**Initialized-host contract:** package resources that require post-bind initialization are available in normal Pi TUI, RPC, print, and JSON modes. An SDK embedder must call `bindExtensions()` with at least one counted binding for lifecycle restoration—such as `onError`, UI/command actions, or shutdown handling—so `session_start` is emitted again by `reload()`. If the embedder uses an empty or mode-only binding, it must explicitly call `bindExtensions()` again after every reload.

Bare `createAgentSession()` does not emit `session_start`; `{}` or `{ mode: "print" }` binds once but does not make a later reload emit it. Post-bind resources such as ambient Anthropic attribution, `/claude-cache`, and session-context EventBus readiness are therefore unavailable on those bare/reloaded paths until an explicit bind. This is a current public Pi SDK blocker, not supported package behavior. The generated availability tables describe this initialized-host contract; they are not a pre-bind availability guarantee.

## 2. Start your first `/bg` task

Inside a project, run:

```text
/bg --name "Docs server" npm run docs:dev
```

`/bg` starts a tracked shell command, returns a task id, and writes output under `.pi/tasks/...`. The command is still an ordinary local shell command; the package tracks it but does not sandbox it.

## 3. Observe completion

Use the footer dock or commands:

```text
/jobs
/logs <task id> 20000
```

Press the configured dock key (**Shift↓** by default, or **Ctrl+Alt+B**) when the `bg ...` footer appears. With `PI_BG_DOCK_SHORTCUT=off`, use `/tasks` or `/bg-tasks`. `/bg-clear` acknowledges finished-task footer notices.

## 4. Start an agent-launched background task

When Pi itself should start a long command, use the `bg_run` tool with the strict schema:

```json
{
  "name": "Typecheck",
  "command": "npm run typecheck",
  "isAgent": false
}
```

`bg_run` defaults `notifyOnCompletion:true` and `triggerOnCompletion:true`, so Pi should not sleep or poll merely to wait. The terminal notification is the wake-up path.

Set `isAgent:true` only when the shell command launches a child Pi/LLM agent, such as `pi -p ...` or `pi --mode json ...`.

## 5. Delegate read-only investigation

Use `bg_delegate` when the worker needs the current conversation as background but should not block the parent:

```json
{
  "name": "Config audit",
  "prompt": "Inspect package configuration and report where background-task output limits are defined. Include file paths and concise evidence.",
  "capability": "inspect",
  "extensionMode": "isolated",
  "autoDeliver": "never"
}
```

The child receives a frozen visible-conversation projection, its own session id/session directory, and read/search/list tools only. It has no shell, no write/edit tools, no network, no recursive delegate, and no Fusion.

After the completion notification, retrieve the committed answer:

`extensionMode:"isolated"` is the default and disables ambient extension discovery. If the pinned provider is registered only by a user/project extension, use `extensionMode:"ambient"` explicitly. Ambient mode executes arbitrary discovered extension code; the inspect tool allowlist does not sandbox it, so process isolation is weakened. No caller-supplied extension path or route fallback is supported.

```json
{
  "taskId": "<task id from bg_delegate>",
  "delivery": "inline"
}
```

`bg_result` is point-in-time: a running task returns a typed not-ready state and never blocks. A committed answer is hash-verified before bytes are returned and is never silently truncated.

## 6. Run first Fusion reasoning

For self-contained synthesis:

```json
{"prompt":"Compare a foreground command, bg_run, and bg_delegate for a ten-minute repository audit."}
```

Call this with `fusion_reason`, or use:

```text
/fusion Compare a foreground command, bg_run, and bg_delegate for a ten-minute repository audit.
```

Fusion returns a tracked background-task receipt after durable no-child preflight. It then runs three candidates, blind evaluation, optional bounded repair only if evaluator JSON is invalid, and merger. Wait for the terminal notification and call `bg_result` once; do not poll. `/fusion` and `fusion_reason` receive a versioned conversation projection; investigate/research/validate receive clean task input only.

## Next links

- [Choose a workflow](choose-a-workflow.md)
- [Configuration](operations/configuration.md)
- [README landing page](../README.md)
