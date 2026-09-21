# Independent D2 host-API challenge

## Verdict

**Outcome B — independently confirmed missing extension-host capability. Status: `BLOCKED_SCOPE`.**

Pi 0.84.0 and 0.86.0 do not give an ordinary package extension a supported, load-order-safe way to wrap the currently effective `bash` definition, start it exactly once, and detach that same execution from foreground cancellation while retaining its exact output/result/timeout/owner semantics. The package runtime could consume such a lease, but it cannot create the lease from current public APIs.

This is not an environment blocker. Windows/PowerShell availability, Bun compilation, and model access are irrelevant to the API absence. Editing Pi or the parent repository is outside this task's authorization, so #18 must not be represented as implemented.

I did find a closer package-only construction than the architecture report spells out: a package-owned `bash` replacement could combine `createBashToolDefinition()`, custom `BashOperations`, `createLocalBashOperations()`, a provisional spool, and an owner `AbortController`. That can keep **one process** alive after the replacement tool returns. It is still noncompliant because it manufactures a replacement tool rather than wrapping the effective host-selected tool, cannot obtain the host's actual `SettingsManager` instance/config closure, and cannot safely coexist with all supported dynamic/custom overrides.

## Route, versions, and provenance

The route was checked before substantive inspection:

```text
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.6-sol
PI_REASONING_LEVEL=max
```

Environment: macOS Darwin 24.6.0 arm64; Node v24.16.0; Bun 1.3.4.

| Surface | Exact version / provenance |
|---|---|
| Package | `pi-background-tasks` 2.5.0; inspected checkout `HEAD=1b3d48d833554ced807c729cab354dd7cc73b79d`, tree `bebc4c410c58110d3deb20140000b73e9ece8702` |
| Package Pi | `@earendil-works/pi-coding-agent` 0.84.0 and nested `pi-agent-core` 0.84.0; lock integrity `sha512-oxEU7BT9xuVT6UKNwUNDzNP5dVGb+DZRGfaEyMyAab8dRlqTSxxyhSlMAxmYsu//YOeasj9E8n2+px1BzIai0g==` |
| Installed host Pi | `@earendil-works/pi-coding-agent` 0.86.0 and nested `pi-agent-core` 0.86.0; `/usr/local/bin/pi` resolves to `dist/bundle/cli.js` |
| Inspected-source hash manifest | `reports/bash-transfer-probes/source-sha256.txt`, SHA-256 `7543c9b3a933fcf1b05fdae01b2980eb5e8e37c7aaed426cbe1447b9acfd8286` (15 manifest/package/Bash/types/runner/session/settings/agent-loop/bundle files) |
| Actual host bundle chunk | `dist/bundle/chunks/chunk-7YM6BE7Y.js`, SHA-256 `8091e2b1cefd6b2962c2af09cb2b1359eac6a4200e5047cf61eaddddb0345abd`; targeted literals confirm the inspected timeout/settings/tool-loop code is bundled |
| Challenged design | `/private/tmp/pi-bg-closeout-iNoltL/reports/feature-design.md`, SHA-256 `2f43fb418534fe826ac6ee859bf899b5d9b48fedf051f2ea5e9dfff4b29ebbfa` |

Frozen evidence verification was 49/49, exit 0. Thread #18 SHA-256 is `9b12dfab077cb0e2f67f7cede9bf442f299216d0909ff8184b26f27929b2ac69`; `ACCEPTANCE.md` SHA-256 is `0d5d5ff03bbe211739f531179f7c81e3f905f0f3318038878747b3c110b440f2`.

Path aliases below:

- **P84**: package-local `node_modules/@earendil-works/pi-coding-agent`
- **H86**: `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent`

## Direct findings

### 1. The observable events cannot return the foreground call early

The public execution events contain call id/name/args and partial/final results only. They carry neither a child/execution handle nor a controlling return value (P84 `dist/core/extensions/types.d.ts:578-600`; H86 `:609-631`). `tool_call` can mutate arguments or block; `tool_result` can patch a result only after execution (P84 `:648-790`; H86 `:679-846`).

The actual agent loop orders operations as follows:

1. emit `tool_execution_start`;
2. validate and run all `beforeToolCall` / extension `tool_call` hooks;
3. call the selected tool's `execute` and await it;
4. run `afterToolCall` / extension `tool_result`;
5. emit `tool_execution_end`.

See P84 nested `pi-agent-core/dist/agent-loop.js:300-305,393-457,483-523` and H86 `:341-346,443-511,537-577`.

Consequences:

- `tool_execution_start` occurs before permission/block hooks and cannot safely launch a replacement.
- `tool_execution_update` can observe partial output but cannot settle the tool call.
- `tool_result` and `tool_execution_end` are too late: foreground execution has already settled.
- Starting package work from `tool_call` can precede later-loaded permission handlers; there is no supported “after all preflight handlers, now wrap execution” phase.

### 2. `getAllTools()` identifies the winner but deliberately hides execution

The extension API returns only `name`, `description`, `parameters`, `promptGuidelines`, and `sourceInfo` (P84 `dist/core/extensions/types.d.ts:943,1137-1140`; H86 `:1003,1208-1211`; installed docs `extensions.md:1716-1736`). It omits `execute`, renderers, execution mode, operations, shell settings, and cancellation state.

Pi itself has `AgentSession.getToolDefinition()` and `ExtensionRunner.getToolDefinition()` internally/publicly for an SDK holder (P84 `dist/core/agent-session.js:622`; runner `:293`; H86 session `:687`; runner `:364`). An extension is not handed either object. Importing the classes does not provide the current instance. Patching prototypes or reaching through private closures would be private-internal use, not a supported package route.

### 3. Effective shell configuration is closed over before extensions run

The host reads its actual `settingsManager.getShellCommandPrefix()` and `getShellPath()`, then builds the base Bash definition with those values (P84 `dist/core/agent-session.js:2019-2029`; H86 `:2286-2296`). `createBashToolDefinition()` closes over the passed operations, prefix, path, spawn hook, output accumulator, timeout, and signal handling (P84 `dist/core/tools/bash.js:221-238,321-327`; H86 `:145-161,244-250`).

`SettingsManager.create()` is only a new file-backed manager, while `inMemory()` and `applyOverrides()` are supported effective configurations (P84 `dist/core/settings-manager.js:144-169,297-298`; H86 `:161-195,323-324`). The current manager is not in `ExtensionContext` or `ExtensionAPI`.

The isolated probe passed an in-memory host manager with:

```json
{"shellPath":"/host-only/shell","shellCommandPrefix":"HOST_ONLY_PREFIX"}
```

An independently reopened manager saw neither value, and `getAllTools()` exposed no replacement field. This passed identically on P84, H86 unbundled, and H86's actual bundled entrypoint. Therefore rereading settings files cannot preserve SDK-injected settings, `applyOverrides()`, or a non-default SDK agent directory.

### 4. Bash factories/operations are constructors, not adoption APIs

`BashSpawnHook` receives only `{command,cwd,env}`. `BashOperations.exec` receives output callback/signal/timeout/env and resolves only `{exitCode}` (P84 `dist/core/tools/bash.d.ts:18-67`; H86 `:23-85`). The local implementation privately creates the child, attaches timeout and abort-to-tree-kill behavior, awaits close, and then returns the exit code (P84 `dist/core/tools/bash.js:39-111`; H86 `:33-113`).

Thus:

- `spawnHook` cannot expose or detach the selected host child.
- Supplying custom operations affects only a newly constructed tool.
- Resolving `BashOperations.exec` at the threshold with a fabricated exit code violates its settlement contract and changes result/error semantics.
- Racing an existing execute promise, even if one were obtainable, does not transfer the signal, kill path, output accumulator, or timeout owner.

### 5. Tool ownership is not atomically composable

Among extensions, the first extension registration for a name wins (P84 `dist/core/extensions/runner.js:280-294`; H86 `:351-365`). AgentSession then overlays SDK `customTools`, which can win over extension registrations (P84 `dist/core/agent-session.js:1946-1993`; H86 `:2213-2260`).

A nuance missing from the challenged report: **static extension-extension conflicts are diagnosed**, not always silent. Resource loading adds `Tool "..." conflicts with ...` diagnostics (P84 `dist/core/resource-loader.js:458-463,838-853`; H86 `:459-464,839-854`). That does not solve D2:

- diagnostics are computed during resource loading;
- post-bind `registerTool()` merely updates the extension map and refreshes tools (P84 `dist/core/extensions/loader.js:215-221`; H86 `:220-229`);
- there is no `unregisterTool`, registration observer, loser inventory, or compare-and-swap “wrap only while built-in remains effective.”

The probe's decisive late-conflict scenario was:

1. package-like extension sees `<builtin:bash>` during `session_start` and dynamically registers `bash`;
2. a later extension dynamically registers its own `bash` in the same lifecycle;
3. package Bash remains effective, the competitor is absent from `getAllTools()`, and loader diagnostics remain empty.

That result was identical on Pi 0.84.0, Pi 0.86.0 unbundled, and Pi 0.86.0 bundled. A conditional “register only if currently built-in” strategy therefore still silently ignores a supported later override in one load order. Reversing load order makes the other owner win; there is no load-order-independent package solution.

### 6. Package `waitForEnd` cannot adopt host work

`BackgroundTaskRegistry.startTask()` creates its own child, streams, timeout, metadata, and close handlers (`src/core/registry.ts:791-972`). `startManagedTask()` requires a package-owned completion/cancel pair (`:976-1068`). `waitForEnd()` is private and only waits on a `BgTask` already present in that registry (`:2179-2193`). Making it public would not produce a host execution handle, output source, or cancellation owner.

## Strongest package-only near-route and why it still fails

The best attempted route was:

1. wait until `session_start`, inspect `getAllTools()`;
2. if Bash appears built-in, dynamically register a package Bash definition;
3. create each call with `createBashToolDefinition()` and custom `BashOperations`;
4. delegate the actual spawn to `createLocalBashOperations()` using a package-owned abort signal;
5. bridge the foreground signal until a threshold CAS, mirror bytes into a provisional spool, then detach the bridge and register a managed package task.

This is materially better than kill/restart: it can run one process and retain that package-created process. It does not satisfy all #18 acceptance:

- it cannot supply the host's exact prefix/path for every supported SettingsManager configuration;
- it replaces rather than invokes the current effective definition;
- it cannot preserve permission/access behavior implemented inside another Bash override;
- it cannot detect or yield to every later dynamic override;
- static or explicit operator opt-in does not authorize silently losing such an override.

It could be a deliberately narrowed “package Bash replacement” feature for standard file-backed settings with declared incompatibilities, but that is a scope reduction, not #18.

## Why the other alternatives fail

| Alternative | Decisive failure |
|---|---|
| Execution-event race | Observation only; cannot settle early or acquire ownership. |
| `tool_call` rewrite/block | Rewriting changes shell/permission semantics; starting there can bypass later permission hooks; blocking cannot return an ordinary successful Bash result. |
| `tool_result` patch | Runs after completion, so it cannot background a still-running command. |
| `getAllTools()` + source guard | No executable/config/loser list; late dynamic conflict remains invisible. |
| `createBashTool()` / custom operations | Creates a replacement, not the selected effective tool. Exact host settings and override behavior are lost. |
| `spawnHook` | Input transform only; no child, result, output-owner, timeout-owner, or cancel lease. |
| Independent `SettingsManager.create()` | Does not reproduce the host's injected/in-memory/overridden manager. |
| SDK `session.agent.state.tools` / `getToolDefinition()` | Available to the embedding SDK holder, not to the package extension running in ordinary Pi. Requiring host wiring is not package-only. |
| Shell wrapping, PID discovery, monkey-patching spawn | Changes command semantics or relies on unsupported internals; cannot recover stdout/exit/tree ownership safely. |
| Abort then relaunch | Kills and duplicates side effects; expressly forbidden. |

## Shortest required host contract

The minimum is **one post-preflight around-execution hook with an atomically resolved, detachable execution lease**. A settings getter, definition getter, conflict warning, PID, or public `waitForEnd` alone is insufficient.

Illustrative shape (names are not prescribed):

```ts
pi.interceptToolExecution("bash", async (call, next) => {
  // This hook runs only after every tool_call mutation/permission handler.
  if (!next.capabilities.detachableBash) {
    return next.runForeground(); // exact current owner, unchanged
  }

  const owner = new AbortController();
  const execution = next.startOnce({
    signal: owner.signal,
    onOutputBytes(chunk) { /* ordered, lossless spool/cap accounting */ },
  });

  // execution.settled yields the exact effective result + isError.
  // The interceptor may await it for foreground completion or return a receipt
  // while it continues under the detached owner.
});
```

Required guarantees:

1. **Ordering:** interception occurs after all argument mutation, validation, permission, and block handlers; a blocked call never starts.
2. **Effective owner:** `next` is resolved atomically for that invocation and calls the currently effective Bash implementation exactly once. Dynamic overrides cannot be hidden by registration order.
3. **Capability/refusal:** built-in Bash advertises detachable, lossless-output capability. An override may opt in; otherwise it runs unchanged in foreground and the package can emit one loud incompatibility diagnostic.
4. **Exact settlement:** `execution.settled` carries the effective `AgentToolResult` and `isError`; fast success, nonzero, timeout, abort, truncation path, renderer updates, and custom result details are not reconstructed by the package.
5. **Cancellation ownership:** the supplied owner signal is the only execution signal. The package bridges foreground cancellation until its CAS commits promotion, then removes that bridge atomically. `cancel()`/owner abort uses the effective implementation's existing kill path.
6. **Output/limits:** transferable Bash supplies ordered raw output bytes (not merely throttled tail snapshots), plus original start/deadline metadata. This permits contiguous spool promotion and cap accounting without resetting the effective timeout.
7. **Detach lifecycle:** `next` is explicitly allowed to outlive the interceptor's foreground result; late settlement does not emit a second host `tool_result` or retain stale foreground cancellation.

A built-in-only form is sufficient and smaller: the host may bypass this interceptor whenever effective Bash is overridden. It must make that owner check atomic per invocation. Generic transfer of arbitrary overrides is optional unless an override advertises the lease capability.

With that contract, package-side work is straightforward: provisional invisible spool; one CAS among settle/abort/threshold; durable task registration before receipt; release notification publication at the matching `turn_end`; original timeout and pre-threshold byte count retained; package `bg_kill` owns the detached signal; shutdown cancels once.

## Decisive host/package proving scenarios

Before accepting a future host API:

1. Permission block and argument mutation fixtures prove interception is post-preflight and `startOnce()` is called zero/one times respectively.
2. Built-in settings fixture uses an injected in-memory `SettingsManager`; fast results are deep-equal to ordinary Bash, including prefix/path/env/nonzero/timeout/abort/truncation.
3. Deterministic settle-vs-threshold-vs-abort barriers prove exactly one foreground result or one promoted receipt, with one OS execution.
4. Raw output before/after promotion is byte-contiguous; cap and original timeout cancel that same lease.
5. Static, SDK, and late dynamic overrides are either invoked once through an advertised lease or remain the effective untouched foreground tool with one incompatibility diagnostic.
6. Immediate post-promotion completion cannot publish a notification before the receipt's tool result has reached `turn_end`; reload/shutdown cancels once.

Current Pi must first fail a contract-characterization test because no interceptor/lease exists. A package test that mocks this capability would not remove the scope blocker.

## Evidence, commands, and change audit

Key commands (all local/no-network):

| Command | Exit / result |
|---|---|
| `printf 'PI_PROVIDER=%s\nPI_MODEL=%s\nPI_REASONING_LEVEL=%s\n' "$PI_PROVIDER" "$PI_MODEL" "$PI_REASONING_LEVEL"` | 0; exact route shown above |
| `(cd maintenance/community-closeout-2026-09 && shasum -a 256 -c evidence/SHA256SUMS)` | 0; 49/49 lines `OK` |
| `node /private/tmp/pi-bg-closeout-iNoltL/reports/bash-transfer-probes/characterize.mjs > /private/tmp/pi-bg-closeout-iNoltL/reports/bash-transfer-probes/characterize.jsonl` with `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0` | 0; three equivalent records for P84, H86 unbundled, and H86 bundled |
| `git diff --name-only -- src extensions package.json package-lock.json docs README.md TESTING.md TEST_PLAN.md` | 0; empty |
| `node --version; bun --version; uname -srm` | 0; `v24.16.0`, `1.3.4`, `Darwin 24.6.0 arm64` |

Evidence probe:

```text
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 \
node /private/tmp/pi-bg-closeout-iNoltL/reports/bash-transfer-probes/characterize.mjs \
  > /private/tmp/pi-bg-closeout-iNoltL/reports/bash-transfer-probes/characterize.jsonl
EXIT=0
```

Probe output SHA-256: `2a988180c0c1133ee040d1045a7791c82c8e8ce66df0ab1f46d9cfab216a3cd9`. Probe source SHA-256: `c6f6ed678afd690b5a7b11c3b5225cb64c27c3584cbc76f1084b11cb12c4626d`. It used explicit task-owned cwd/agent/auth/model-store paths, no provider calls, no network, no user config/auth/session data, and executed no shell command under test.

**Evidence:** API declarations, implementation ordering, bundled-host characterization, and probe outcomes above. **Inference:** the nonexistence conclusion is based on the complete public extension surface plus those implementations; the proposed lease is a required contract design, not an existing hidden API.

No tests or model calls were run. This task changed no package source, tests, manifests, docs, user files, parent repository, or worktrees. The production/manifest/docs diff command above was empty. Concurrent backlog work changed the checkout during this review: the two test modifications below appeared after an earlier clean-for-tests check and were not written or inspected by this task. Final observed unrelated state was:

```text
 M maintenance/community-closeout-2026-09/STATE.md
 M tests/sdk/delegate-sdk.test.ts
 M tests/unit/pi-launch.test.ts
?? maintenance/community-closeout-2026-09/execution/attribution-design.md
?? maintenance/community-closeout-2026-09/execution/attribution-report.md
```

Task-owned probes occupy 56 KiB. Two oversized search outputs caused the shell harness to create files outside `TMPDIR` despite each command exporting the task-owned `TMPDIR`; they were not removed because that path is outside authorized writes:

- `/var/folders/qh/g_4pxrqd2_1c0x08bnlc6y840000gn/T/pi-bash-6451aa45301818e6.log` (3.9 MiB)
- `/var/folders/qh/g_4pxrqd2_1c0x08bnlc6y840000gn/T/pi-bash-596e55127f2e7c7e.log` (1.2 MiB)
