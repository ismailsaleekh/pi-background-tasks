# C1 / P1 / D1 / D2 feature design

## Inspection receipt and decision summary

- Effective worker route was read from the shell environment before inspection: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`.
- Read-only inspection began at the requested package `HEAD=14afc33e3967a142758169d3217a4e63b4b3ec94`; production `src/**` and `extensions/**` remained unchanged. At entry only the pre-existing `maintenance/community-closeout-2026-09/STATE.md` was dirty. During inspection the authorized concurrent baseline worker committed only its test guards/helpers and testing docs as `c0ba66543c67a468a67a859b7ff2d267d48b2e26` (`tests/package/{package,type-safety}.test.ts`, `tests/helpers/{offline-npm-registry,typescript-source-guards}.ts`, `docs/operations/testing.md`, `TESTING.md`, `TEST_PLAN.md`), advancing the primary checkout HEAD. This worker changed none of those package paths and changed no production source, authored feature doc, generated doc, manifest, or stamp; final `git diff HEAD -- src extensions package.json` is empty.
- Frozen evidence verification passed 49/49 (`shasum -a 256 -c maintenance/community-closeout-2026-09/evidence/SHA256SUMS`).
- Package Pi is 0.84.0; installed host Pi is 0.86.0. Bun 1.3.4 is present. No native Windows, Nushell, pwsh/PowerShell, pnpm, or compiled Pi binary is available locally. Those are qualification gaps, not architecture blockers. No tests, network requests, model calls, or user config/auth/session reads were performed; commands were limited to local read-only characterization and evidence hashing.

| Item | Decision |
|---|---|
| C1 feature selection | Implementable. Add one strict process-wide feature-set variable; keep current full surface as default; derive `bg_result` from delegate/Fusion dependencies; ambient attribution is independently disableable but isolated Anthropic children keep mandatory attribution. |
| C1 dock shortcut | Implementable as a **finite**, docs-verifiable enum: default `shift+down`, alternate `ctrl+alt+b`, or `off`. `/tasks` and `/bg-tasks` always remain. |
| C1 shell discrepancy | Implementable without changing the default. Preserve legacy POSIX `$SHELL`; add explicit POSIX automation-shell selection and inject the resolved policy into the model-visible prompt and launch receipt. |
| C1 Fusion docs | Documentation-only and implementable. Explain candidates/evaluator/repair/merger and role-specific fan-in, latency, quality, and repeated-route caveats. |
| P1 lazy loading | Implementable by adapting PR #22, but add single-flight loading, lifecycle generation checks, actual first-use failure/race tests, feature-aware imports, and reproducible measurements. Do not claim that this solves raw-TS compilation or Windows cold start. |
| D1 reload survival | Implementable for opt-in `isAgent:false` ordinary shell tasks. Use a living same-process execution owner handed between real reload activations; never reconstruct ownership or exit status from task JSON/PID. |
| D2 same built-in Bash promotion | **Blocked on a missing host execution-transfer API, not on environment or package complexity.** Pi 0.84/0.86 exposes before/after observations and replacement registration, but no handle for the currently selected Bash execution, no `next` middleware, and no cancellation/output ownership transfer. A package-only override cannot preserve effective shell settings or another extension’s override. Do not ship a kill/restart, command-rewrite, or silent-takeover approximation. The complete design after the minimal host API is specified below. |

## What the current code and SDK establish

1. The package eagerly imports the dock, Fusion, and delegate implementations and registers both advanced subsystems unconditionally (`src/extension.ts:43-50`, `src/extension.ts:232-249`). It also hard-registers `shift+down` and renders `Shift↓` in the footer (`src/extension.ts:309`, `src/extension.ts:590-595`).
2. POSIX background commands currently use non-empty `$SHELL`, else `/bin/sh`; Windows has the separate `cmd|bash` policy (`src/core/common.ts:712-746`). Pi’s own Bash tool instead resolves `/bin/bash`, PATH Bash, then `sh` on Unix (`node_modules/@earendil-works/pi-coding-agent/dist/utils/shell.js:58-103`). The mismatch is real.
3. Current shutdown ignores event reason and kills every running task with the same reload/shutdown message (`src/extension.ts:486-513`). The registry’s task map and child handles are in memory; JSON snapshots are writes, not an adoption protocol (`src/core/registry.ts:791-972`, `src/core/registry.ts:1619-1631`).
4. A reliable reload/quit boundary **does exist** in supported Pi. Pi 0.84 types declare `session_shutdown.reason` as `quit|reload|new|resume|fork` (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:463-468`). Its actual reload emits `reason:"reload"` before invalidating the old runner, rebuilds resources, then emits `session_start.reason:"reload"` (`.../dist/core/agent-session.js:2052-2073`); runtime disposal emits `reason:"quit"` (`.../dist/core/agent-session-runtime.js:288-293`). Host 0.86 does the same at `agent-session.js:2319-2340`. D1 therefore must use this real field, not infer reload from a session file.
5. Pi invalidates old runtime APIs and unsubscribes tracked EventBus listeners after replacement (`node_modules/.../dist/core/extensions/loader.js:138-183`). A surviving process owner must not retain old `pi`, `ctx`, UI, or EventBus closures.
6. Pi permits runtime tool registration and refreshes it immediately (`installed docs/extensions.md:1408`), but its documented “dynamic tool loading” still registers every tool and merely changes the active set (`installed docs/extensions.md:2404-2412`). That is unsuitable for #20 because disabled tools remain configured/advertised.
7. The package docs engine currently requires registration calls to be immediate top-level statements (`scripts/docs/lib.mjs:643-653`, `1048-1088`) and intentionally rejects conditional direct registration (`scripts/docs/selftest.mjs:185-189`). Conditional features need a strict new extraction grammar and generated availability facts, not hidden registrations or a gate bypass.
8. For D2, Pi’s execution events contain only ids, args, partial/final results (`node_modules/.../dist/core/extensions/types.d.ts:578-600`); `tool_call` can mutate/block and `tool_result` runs after completion (`.../types.d.ts:648-724`). `BashOperations.exec` returns only `{exitCode}` (`.../tools/bash.d.ts:18-35`), while the local implementation privately owns spawn, timeout, and kill (`.../tools/bash.js:39-111`). `createBashToolDefinition` closes over effective `operations`, `shellPath`, and `commandPrefix` (`.../tools/bash.js:221-237`). `getAllTools()` exposes metadata, not the executable definition (`.../extensions/types.d.ts:943-945`), and competing extension tools are collapsed with first registration per name winning (`.../extensions/runner.js:280-292`). Host 0.86 has the same limits (`runner.js:351-363`, `tools/bash.d.ts:23-40`).

## Public configuration contract

All defaults preserve 2.5.0 behavior. Parse configuration before any registration in each package entrypoint. A malformed value throws `pi_bg_config_invalid: <specific reason>`; there is no fallback to defaults. Environment is read once per extension activation and re-read on `/reload`.

| Name / field | Default | Accepted values and behavior |
|---|---|---|
| `PI_BG_FEATURES` | `process,delegate,fusion,attested,attribution` | Strict comma-separated set drawn from those five exact lowercase tokens. No blanks, whitespace, duplicates, or unknown tokens. `process` is mandatory. `bg_result` is derived and is not a token: it is registered iff `delegate` or `fusion` is enabled. |
| `PI_BG_DOCK_SHORTCUT` | `shift+down` | Exactly `shift+down`, `ctrl+alt+b`, or `off`. `off` registers no dock shortcut. Arbitrary KeyIds are intentionally not accepted in v1 so generated public-surface extraction can enumerate every variant truthfully. |
| `PI_BG_POSIX_SHELL` | `inherit` | Non-Windows only: `inherit`, `bash`, or `sh`. `inherit` preserves current `$SHELL` then `/bin/sh` behavior. `bash` follows Pi’s `/bin/bash` then executable PATH lookup and fails if unresolved. `sh` resolves `/bin/sh` then executable PATH lookup and fails if unresolved. |
| `PI_BG_POSIX_SHELL_PATH` | unset | Non-Windows only; requires `PI_BG_POSIX_SHELL=bash|sh`; must be absolute, a regular file, and executable. It is passed as argv executable with `-c`, never interpolated into a shell command. |
| `PI_BG_SHELL`, `PI_BG_SHELL_PATH` | unchanged | Existing Windows-only `cmd|bash` contract stays byte-compatible. POSIX ignores these as it does today. |
| `bg_run.surviveReload` | `false` | Optional boolean. Accepted only with `isAgent:false`. `true` survives **real reload only**. |
| `/bg --survive-reload` | absent / false | Opt-in equivalent for user-launched ordinary shell jobs. `--agent` plus `--survive-reload` is rejected before spawn. |
| Proposed D2 `PI_BG_AUTO_BACKGROUND_BASH` | `0` | Reserved for implementation only after the host API exists; exact `0|1`. |
| Proposed D2 `PI_BG_AUTO_BACKGROUND_BASH_THRESHOLD_MS` | `5000` | Reserved with D2; integer 100–3,600,000. Setting it while the mode is not `1` is an error, avoiding dormant mistyped configuration. |

Existing `PI_BG_MAX_OUTPUT_BYTES`, update, telemetry, cache, and Windows shell variables are unchanged.

## C1 design

### C1.1 Feature topology and honest registration (#20)

Use five capabilities with these boundaries:

| Capability | Registered surfaces | Dependencies / exclusions |
|---|---|---|
| `process` | `/bg`, `/jobs`, `/logs`, `/kill`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update`; `bg_run`, `bg_status`, `bg_logs`, `bg_kill`; task renderer, EventBus service, footer/dock | Mandatory base. Does not import delegate/Fusion/attested execution modules in process-only mode. |
| `delegate` | `bg_delegate` | Implies shared `bg_result`; does not imply Fusion or attested runs. |
| `fusion` | `/fusion`, `/fusion-models`, four `fusion_*` tools, `fusion-result` renderer | Implies shared `bg_result`; does not imply delegate. Workflows remain fixed. |
| `attested` | `bg_run_pi_attested` | Independent of delegate/Fusion. Its implementation is loaded only on first invocation. |
| `attribution` | ambient package-owned Anthropic provider and `/claude-cache` | Controls only ordinary parent-session ambient attribution. It does **not** disable mandatory attribution for package-owned isolated Anthropic children. |

Refactor `bg_result` into a light shared facade. It examines task facts and lazily loads only delegate-result or Fusion-result verification. Thus Fusion-only and delegate-only configurations both retrieve correctly, while process-only has neither producer nor retrieval tool.

Create `extensions/anthropic-attribution-child.ts`, which always registers mandatory attribution and is used by delegate/Fusion/attested Anthropic argv. The existing ambient entrypoint honors `PI_BG_FEATURES`. This prevents `PI_BG_FEATURES=process,fusion` from accidentally disabling attribution inside an explicitly isolated Anthropic Fusion child. Update all child path seams and the existing arbitrary-child guidance accordingly; never substitute an unattributed route.

Disabled features are not registered, do not appear in `getAllTools()`/active tools/commands, cannot execute by stale name, and do not auto-return after reload. Do not implement this with `setActiveTools()` alone.

### Docs-engine gate

Extend, rather than weaken, `scripts/docs/lib.mjs` with one narrow finite-variant grammar:

- recognize only top-level conditions built from the parsed immutable feature enum and dock-shortcut enum;
- allow a direct/imported registrar under such a branch and attach a normalized availability expression (`feature:delegate`, `feature:fusion`, `dock:shift+down`, etc.) to every extracted surface;
- continue rejecting arbitrary `if (enabled)`, aliased hosts, loops, computed names, nested helpers, and runtime strings;
- generate a default-surface inventory plus an “availability by configuration” column/table in `docs/INDEX.md`, `docs/manifest.json`, README facts, and tool/command/shortcut generated regions;
- add mutation fixtures proving an unlisted feature value, untagged conditional, drift between runtime enum and docs enum, or hidden registration fails closed.

The finite shortcut enum is deliberate. Supporting every `KeyId` would require changing the public-surface identity model from concrete shortcut keys to logical actions; that is a larger docs-engine/API migration and is not needed to close #16.

### C1.2 Dock shortcut (#16)

- Register only the configured literal branch. `off` performs no registration, so Pi cannot report a conflict.
- Footer hint is derived from the same parsed enum: `Shift↓`, `CtrlAltB`, or `/tasks`; never hard-code `Shift↓` after this change.
- `/tasks` and `/bg-tasks` remain the canonical fallback in every configuration and mode; non-TUI behavior remains the current textual guidance.
- Keep `ctrl+alt+c` as the separately documented optional clear-notices fallback.
- Pi’s actual conflict policy warns and lets the later extension shortcut win (`node_modules/.../dist/core/extensions/runner.js:319-345`). The conflict acceptance test must load a fixture extension with `shift+down`, configure this package to `ctrl+alt+b` or `off`, assert no conflict warning, and dispatch both surviving keys to the correct owner. Do not merely change the footer text.

### C1.3 Shell policy (#11)

Preserve the default but make it predictable and visible:

1. Resolve one immutable `ShellPolicy` per activation and pass that same object to both the registry and model guidance. Record `{policy, executable, argvPrefix, dialect}` in task metadata/launch receipts.
2. `inherit` uses the existing bytes: non-empty `$SHELL`, otherwise `/bin/sh`, with `-c`. Classify known Bourne-family basenames as POSIX-compatible; classify `nu`, fish, csh, and unknown names as `user-non-posix`. Do not call an unknown user shell “POSIX”.
3. `bash` and `sh` use executable checks and structured spawn argv. No `-lc`, no command interpolation, no fallback after an explicit selection fails.
4. Add stable `before_agent_start` guidance generated from the resolved policy, for example: `bg_run executes with {"executable":"/path/to/nu","dialect":"user-non-posix","argv":["-c"]}; do not assume Bash syntax`, or the corresponding Bash/cmd text. Include remediation (`PI_BG_POSIX_SHELL=bash`) for a non-POSIX inherited shell. The static tool description points to this exact per-session policy.
5. Telemetry wrapping must use a capability such as `supportsPosixFunctionWrapper`, not today’s misleading `dialect === "posix"`; unknown inherited shells remain unwrapped with an explicit reason.
6. Windows behavior and `windowsVerbatimArguments:true` stay unchanged.

This closes the discrepancy without silently changing existing commands. A native Nushell executable is not present here, so use an executable fake-`nu` fixture for argv/guidance and leave native Nu syntax qualification explicit.

### C1.4 Fusion model-role docs (#15)

Update authored `docs/commands/fusion-models.md` (primary), `docs/subsystems/fusion.md`, and the short configuration cross-reference with:

- **Candidate 1/2/3:** three independent, parallel attempts over the same canonical input and fixed workflow tools. They are not specializations. Candidate quality and diversity drive the evidence pool; the slowest candidate controls wave latency. Different capable routes can increase diversity, while repeating one route is allowed but may yield similar answers.
- **Evaluator:** receives the original input plus anonymous A/B/C answers, has no tools, compares strengths/conflicts/risks, and emits a closed synthesis plan. It is sequential after all candidates and has greater fan-in. If its output is invalid, exactly one repair call uses the **same evaluator slot/model** with the blind input, invalid output, and bounded validation errors.
- **Merger:** receives original input, all three anonymous answers, and the validated evaluation; it has no tools and produces the only final user answer. It is the final sequential critical path and commonly has the greatest synthesis/context burden.
- Quality-first example: diverse strong candidates, strong schema-following evaluator, strongest synthesis model as merger. Speed-first example: fast candidates (especially avoid one slow outlier), fast reliable evaluator, and a capable fast merger. State that actual context admission is measured per stage and a nominally stronger small-context model can be unusable.
- Frontier routes remain subscription OAuth only. “Expensive” means latency/quota/token use here, not permission to use metered API routes.
- Five slots do not mean five distinct models. Duplicates and `$current` are valid (`src/core/fusion/config.ts:22-44`). A normal success is five child invocations; evaluator repair makes six; preflight can make zero, and retries/failures alter attempts (`src/core/fusion/orchestrator.ts:792-855`, `1070-1125`).

## P1 lazy-loading design (#21 / PR #22)

### Module boundary

Adapt PR #22 (`055306d...`) with contributor credit, but do not apply it unchanged. The patch correctly defers the dock and several delegate/Fusion execution modules, while retaining schemas at registration. It lacks dedicated cold-first-use/lifecycle tests and its `if (!orchestrator) await import()` pattern can construct more than one orchestrator under simultaneous cold calls.

Use light facades and heavy implementations:

- process facade: command/tool schemas, renderers, registry wiring; lazy dock component;
- delegate facade: `bg_delegate` schema/receipt only; lazy launch/runner/result implementation;
- result facade: schema and dispatch only; lazy delegate/Fusion verifiers independently;
- Fusion facade: schemas, fixed profiles, renderer/command metadata only; lazy context/config/orchestrator/model selector;
- attested facade: schema only; lazy attested implementation and launch helpers;
- attribution: remains eager **when enabled**, because provider registration must be complete before model use; process-only skips the ambient entry entirely.

Remove accidental facade-to-heavy edges (for example hash/canonical helpers imported from the attested producer) by extracting byte-identical small pure helpers or using type-only imports. Golden/equivalence tests must prove no Fusion artifact-byte drift.

### Loader state machine

Add a small internal `LazyModule<T>` (not a public framework) with states `unloaded | loading | loaded | failed | closed`:

- first call stores one promise before invoking `import()`;
- concurrent calls await that same promise;
- failure is wrapped once with feature/module identity and retained for that activation; repeated calls return the same bounded cause, and `/reload` creates a fresh attempt;
- every call captures the activation generation and checks `closed/generation` both before and after import and before the first side effect;
- `session_shutdown` closes the activation and aborts active feature controllers. Dynamic import itself need not be abortable; a late module is discarded and cannot spawn a child, create artifacts, register a task, or touch stale `pi/ctx`;
- enabled surfaces register during the awaited extension factory, before `session_start`. Lazy loading delays implementation, never the truthful schema/command inventory.

### Reproducible benchmark

Add `scripts/benchmark-cold-load.mjs` plus a fresh-process SDK worker. It must:

1. use the real selected Pi `DefaultResourceLoader` against packed/package entrypoints, isolated pre-created cwd/agent/session roots, and `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1`;
2. record package commit/tree, Pi/Node/Bun version, OS/arch, exact feature set, entrypoints, sample count, and whether the package is source TS or compiled;
3. define “cold” honestly as **fresh process + empty JS/Jiti module cache**, not flushed filesystem cache;
4. run one excluded warm-up then at least 30 interleaved rounds in deterministic AB/BA order for no-extension control, process-only, and default-full; compare baseline commit and candidate under the same host/dependency/cache conditions;
5. emit raw samples and median, p90, MAD, min/max as JSON. Do not make timing a flaky unit-test threshold; use deterministic import-graph/first-use tests as CI gates;
6. benchmark first invocation separately for delegate, Fusion, result, dock, and attested paths so startup gains are not hidden by unacceptable first-use cost;
7. make no Windows claim without native Windows runs and no compiled-Bun claim without the distributed compiled loader. Bun 1.3.4 source/pack characterization is useful but is not compiled-Pi certification.

Precompiled JS/bundling remains a separate #21 release decision. Lazy loading does not solve raw TypeScript transpilation, and bundling must not be added until payload paths, Jiti aliases/virtual modules, sourcemaps, dynamic chunks, Node, and compiled Bun are proven.

## D1 reload-surviving ordinary shell jobs (#6)

### Public behavior

Only `bg_run({isAgent:false,surviveReload:true,...})` and `/bg --survive-reload ...` opt in. Default remains kill-on-reload. Delegate, Fusion, attested, managed, and `isAgent:true` shell tasks reject survival rather than silently downgrading. Dock rerun preserves the explicit shell task flag.

### Minimal ownership architecture

Do **not** scan JSON and “adopt” a PID. Introduce a narrow process-global `ReloadableShellExecutionOwnerV1`, stored under a versioned `Symbol.for(...)`, for opted-in ordinary shell executions only.

- The owner holds the actual Node `ChildProcess` object, output stream, timeout deadline/timer, byte counter/cap state, process-group/tree control, final close event, random 128-bit launch nonce, and terminal result. The authoritative identity is `(owner object identity, launch nonce, child handle, child pid/start record)`, not PID alone.
- Persist audit fields (`surviveReload`, owner PID, child PID, launch nonce, spawn time, POSIX process-group root or Windows tree root, owner generation), but explicitly label metadata non-authoritative without the living owner.
- Keep R1’s activation registry/publication closure one-way. Split the narrow shell execution owner from activation-local host delivery. On reload, the old activation transfers only eligible execution objects into a handoff slot; it never reopens its closed registry/EventBus service. The new activation creates fresh UI/EventBus/delivery bindings and claims those objects under an exclusive monotonically increasing lease.
- Host callbacks are detachable. The owner never stores old `pi`, `ctx`, UI, renderer, EventBus service, or notification closures. During the gap, output/finalization continues and terminal completion is queued in the owner.
- `session_shutdown(reason:"reload")`: stop new starts, detach host delivery first, close the old typed EventBus service, kill/settle every non-survivor and every typed/managed task, and place eligible executions in handoff without waiting for them to finish.
- `session_start(reason:"reload")`: verify protocol, same host PID, same session id, and cwd realpath; claim the lease, import running or gap-terminal executions, bind the new adapter, then flush queued terminal completion.
- Start a bounded handoff deadline (30 seconds, source constant, not public config). If no compatible claimant appears—extension removed, load/config failure, incompatible owner protocol—kill the owned process tree, finalize truthfully, and mark host publication `abandoned` under the integrated R1 vocabulary. Never leave a hostless survivor indefinitely.
- Timeout is an absolute launch deadline and output bytes are cumulative across reload. Neither resets. Kill uses the retained handle/group/tree. Exit status comes only from the retained child `close` event; liveness probes never synthesize `0`, nonzero, or a signal.

This is deliberately not an external daemon, generic persisted-job framework, or crash-resume system. It is the smallest sound bridge across same-process extension replacement.

### Completion ownership and R1 integration

- Use one terminal sequence/completion id per task, e.g. `<task-id>:1`.
- Lease transfer is synchronous and exclusive: old delivery is quiesced before new delivery can bind. A terminal race either finishes under the old successful delivery or is pending for the new activation, never both.
- Preserve R1 distinctions: `terminalPublished` means successful EventBus emission only; `abandoned` is not success; retry timers and old gates are cleared on detach; closure is rechecked after every gate. During a valid reload handoff, the execution’s logical terminal remains pending rather than falsely abandoned, then receives a fresh activation-local delivery record.
- One successful `sendMessage` invocation is allowed. EventBus remains its documented at-least-once transport when a later listener throws; consumers still deduplicate by task id. “Exactly once” here means one logical terminal completion and one successful host notification, not a false claim that a throwing multi-listener EventBus can provide physical exactly-once delivery.

### Explicit lifecycle matrix

| Host transition | `surviveReload:true` ordinary task |
|---|---|
| `/reload` / `ctx.reload()` | Handoff; same process, task id, output file, timer, byte count, and close-derived result. |
| `/quit`, Ctrl-D/C graceful exit, SIGHUP/SIGTERM graceful path | Kill and settle before exit. No survival. |
| `/new` | Kill; do not move work into the new session. |
| `/resume` / switch session | Kill; do not attach work to another session/cwd. |
| `/fork` or `/clone` | Kill; do not duplicate or transfer ownership. |
| hard crash / SIGKILL / power loss | Unsupported. A later process never adopts from metadata/PID and never forges terminal status. Detached OS residue is possible and must be described honestly. |
| typed delegate/Fusion/attested task | Explicit refusal for survival; current shutdown cancellation remains. |

## D2 same built-in Bash promotion (#18)

### Precise host blocker

A compliant implementation must start the effective Bash tool once, preserve its configured `shellPath`, `shellCommandPrefix`, env/session injection, output accumulator/result details, timeout, current permission hooks, and any compatible override, then transfer cancellation/output/kill ownership after a threshold. Pi 0.84 and 0.86 expose none of:

- an around-tool `next()` middleware for the currently selected definition;
- the effective executable tool definition through `getAllTools()`;
- a running Bash child/execution handle;
- a way to detach the tool-call AbortSignal and replace it with task ownership;
- an atomic conflict/ownership claim for a tool name.

Therefore these package-only alternatives are noncompliant:

- racing `tool_execution_*` events cannot make the host tool return early;
- `tool_call` command rewriting changes semantics and can bypass/order permission or remote/sandbox overrides;
- registering `bash` with `createBashTool()` loses the host’s effective settings and first-wins can silently hide another extension (`runner.js:280-292`);
- racing the returned Bash promise gives no kill handle and leaves it tied to the foreground signal;
- killing and relaunching duplicates side effects and is forbidden;
- using private `Registry.waitForEnd` (`src/core/registry.ts:2179`) only waits for package-owned tasks and is not adoption.

This is a missing host API / scope decision. It is not a Windows/Bun/environment blocker. No D2 production flag should be documented or registered until the API exists.

### Minimal required host contract

Request one narrow supported host facility (names illustrative):

```ts
pi.interceptToolExecution("bash", async ({ input, ctx, signal, onUpdate, next }) => {
  const execution = await next.startOnce();
  // execution.result: exact effective tool result/error
  // execution.transferCancellation(newSignal): atomic foreground -> owner handoff
  // execution.cancel(reason): same effective execution
  // execution.onOutput / identity: enough to persist and manage the same process
});
```

Required guarantees:

1. all `tool_call` mutation/permission/block handlers finish before the interceptor;
2. `next.startOnce()` invokes the currently effective Bash implementation exactly once, including another extension’s override;
3. the host says whether that implementation supports ownership transfer; an unsupported override is preserved and produces one loud “auto-background unavailable for current Bash owner” diagnostic, never silently replaced;
4. result/error/update/render details remain the effective tool’s ordinary values when not promoted;
5. cancellation transfer is atomic and the execution may outlive the foreground tool call;
6. no later `tool_result` is emitted for a hidden second execution.

If upstream instead chooses a built-in-only lease, it must atomically reject registration when Bash is overridden and expose the **effective** shell settings. Either contract is sufficient; current APIs are not.

### Package design once the API exists

- Parse the two D2 variables above. Disabled mode installs no interceptor and is byte-for-byte ordinary Bash.
- Start a hidden provisional record at the same instant as `next.startOnce()`. Mirror output to a private spool but do not expose a task, metadata, footer row, or notification yet.
- Race terminal result, foreground cancellation, and threshold with one compare-and-swap state: `foreground -> terminal | cancelled | promoting -> background`.
  - terminal wins: remove spool; return the exact ordinary result/error; no task ever appears;
  - cancellation wins before committed promotion: cancel through the original execution and return ordinary cancellation;
  - threshold wins: transfer cancellation synchronously, durably promote the same spool/execution into an ordinary task, then return one background receipt.
- If completion and threshold are ready in the same event-loop turn, callback order determines the single CAS winner and is recorded. There is never a restart or duplicate.
- Promotion is not acknowledged until running metadata/output path is durable and the task is visible. A terminal-publication gate holds notification/EventBus delivery until the Bash tool result containing the task id has finalized. Immediate post-promotion completion is queued behind that gate.
- Before promotion, preserve the built-in output/truncation behavior. At promotion, initialize package cap accounting from all bytes already observed; if already over cap, the promoted task fails and cancels the same execution. Timeout remains the original Bash absolute timeout, not a fresh task timeout.
- After the receipt, agent-turn cancellation no longer owns the process; `bg_kill`, timeout, output cap, and session lifecycle do. Output has no gap/duplication at the spool rename boundary.
- Promoted Bash jobs set `surviveReload:false`. A real reload kills them under built-in-compatible session cancellation semantics. Combining auto-promotion with D1 would require a separate explicit public option and host guarantee; do not infer it.
- Permission denials create no provisional task. A competing override is invoked through `next` if transferable or left untouched with a loud diagnostic if not.

## Exact red-first acceptance scenarios

### C1

1. **Default parity:** fresh SDK inventory with no new env has the current commands/tools/renderers/shortcuts and active-tool behavior.
2. **Process-only:** `PI_BG_FEATURES=process` yields exactly the process table above; calls/discovery for `bg_delegate`, `bg_result`, attested, Fusion, `/fusion*`, `/claude-cache`, and ambient provider ownership are absent, not “disabled” errors.
3. **Dependency matrix:** `process,delegate` has `bg_delegate+bg_result` only; `process,fusion` has Fusion+`bg_result` only; both share one `bg_result`; attested and attribution toggle independently.
4. **Malformed:** blank entries, whitespace, duplicate, unknown token, or missing `process` makes extension load fail with `pi_bg_config_invalid` and no partial registration from that entrypoint.
5. **Reload:** process-only inventory remains process-only after actual `AgentSession.reload()`; stale advanced active tools disappear. Changing the test process env before reload changes to the exact newly selected variant once, with no duplicate registrations.
6. **Child attribution:** ambient attribution disabled + an Anthropic delegate/Fusion/attested fixture still has the mandatory child attribution entry first; ordinary ambient parent attribution is absent.
7. **Shortcut default/alternate/off/invalid:** inspect registration and footer text for all three variants; invalid fails load. `/tasks` works with `off`.
8. **Conflict/dispatch:** fixture extension owns `shift+down`; this package configured alternate/off produces no shortcut-conflict diagnostic. SDK and PTY key dispatch prove the fixture receives Shift+Down and package receives Ctrl+Alt+B only in alternate mode.
9. **Shell:** pure resolver covers inherited zsh, inherited fake `nu`, absent `$SHELL`, explicit Bash/sh, missing/non-executable/relative path, and unchanged Windows cmd/Bash argv. A scripted provider must observe guidance matching the exact executable/dialect used by the spawned task. Fake `nu` records `-c` argv; no native-Nu claim.
10. **Fusion docs:** package docs test requires role definitions, same-evaluator repair, parallel/serial latency, fan-in, duplicate-model caveat, 5-or-6/zero invocation wording, valid examples, and subscription-only policy.

### P1

1. Enabled tools/commands are present immediately after loader completion and before `session_start`; disabled ones are absent.
2. Startup import tracing proves process-only loads no delegate/Fusion/attested/ambient-attribution implementation; default full loads facades but not orchestrator/runner/dock until use.
3. Two simultaneous first Fusion calls and two simultaneous first delegate calls cross an injected import barrier: importer count is one, both calls proceed independently after release, and no singleton run state leaks.
4. Deferred import rejection returns a stable feature-specific error to every waiter, launches zero children/tasks/artifacts, and a real reload creates a fresh loader that may succeed.
5. Shutdown/reload while import is blocked, then resolve it: old calls fail stale/cancelled, zero side effects occur, old APIs are not touched, and the new activation works.
6. Dock first open and `/fusion-models` first open load UI modules once; cancel paths do not preload orchestrators.
7. Packed-copy test removes one deferred module: package startup/inventory remains honest, first invocation fails loudly, payload closure test prevents such a missing file in a real tarball.
8. Benchmark emits complete provenance and distributions. Functional tests never assert a machine-specific millisecond win.

### D1

1. **Real reload continuity:** launch a process that writes `before`, waits across `session.reload()`, writes `after`, exits 0. Assert same task id, launch nonce, child PID/handle identity, output path, cumulative bytes, one terminal notification, one logical terminal id, real exit 0, and no kill/restart spawn.
2. **Gap completion:** block new activation claim, complete with nonzero exit during the gap, then claim. New activation reports the actual nonzero close result once; old activation emits nothing.
3. **Threshold races:** completion immediately before/after handoff, EventBus gate pending, and transient/persistent listener failures retain R1’s delivered/abandoned truth and bounded retries without duplicate successful notification.
4. **Control after reload:** `/jobs`, dock, `bg_status`, `bg_logs`, and `bg_kill` operate on the same execution; POSIX group kill and native Windows tree kill are exercised.
5. **Absolute enforcement:** timeout expires at original deadline through reload; output cap includes bytes from both sides; cap/timeout produce failed, user/quit kill produces killed.
6. **Handoff failure:** no new claimant by injected short deadline kills the tree, clears timers, records abandonment, and leaves no owner/global slot.
7. **Lifecycle matrix:** actual runtime `quit`, `new`, `resume`, and `fork/clone` each kill despite opt-in; only actual reload survives.
8. **Refusals:** `isAgent:true`, delegate, Fusion, attested, managed, malformed boolean, and EventBus v1 (unless deliberately extended in a separately versioned contract) cannot request survival.
9. **Crash/PID forgery:** copy a running JSON record into a fresh Pi process and use a live unrelated/reused PID. It is never adopted, killed, or marked completed from liveness. Clean up the fixture process explicitly.
10. Native Windows qualification is required before closure; mocked Windows branches are not certification.

### D2, after host API

1. Disabled mode is deep-equal to ordinary Bash for fast success, nonzero failure, timeout, abort, truncation/full-output path, env, shell prefix/path, rendering, and hook order.
2. Fast completion creates one OS execution and zero task/notification/artifact rows.
3. Deterministic completion-vs-threshold barriers prove either exact foreground result or one promoted receipt, never both executions.
4. Output bytes before/after promotion are contiguous and unique; cap and original timeout act on the same execution.
5. Abort before/during promotion cancels foreground; abort after committed receipt does not; `bg_kill` then owns cancellation.
6. Permission block means `next.startOnce()` is never called. A transferable override is invoked exactly once; a nontransferable override remains effective and gets one loud incompatibility diagnostic.
7. Immediate completion after promotion cannot notify before the receipt/tool result identifies the task.
8. Reload kills the promoted task once; feature-disabled/process-configuration errors cannot leave an interceptor or provisional execution.

### Red execution protocol

Add tests before each production slice, then run them against the unchanged production files from `14afc33e...` (the concurrent baseline test-only commit may remain). Use the isolated mechanical environment required by `EXECUTION.md`.

| Focused command after tests are added | Named red expectation on old production |
|---|---|
| `npx tsx --test tests/unit/config.test.ts tests/sdk/feature-selection-sdk.test.ts` | `process-only omits advanced surfaces`, `derived result dependency matrix`, `malformed feature config fails transactionally`, and shortcut alternate/off all fail because no parser/conditional registration exists. |
| `npx tsx --test tests/unit/core.test.ts tests/scripted-provider/shell-policy-guidance.test.ts` | `fake Nu guidance equals launched dialect` and explicit POSIX Bash/sh selection fail; unchanged Windows controls stay green. |
| `npx tsx --test tests/package/docs-contract.test.ts tests/unit/docs-gate.test.ts` | recognized finite conditional fixture and generated availability assertions fail while existing arbitrary-conditional rejection stays green. Fusion role prose assertions fail. |
| `npx tsx --test tests/unit/lazy-module.test.ts tests/sdk/lazy-loading-sdk.test.ts tests/package/lazy-payload.test.ts` | import graph, single-flight, deferred failure, and shutdown-during-import cases fail on eager baseline; ordinary inventory controls stay green. |
| `npx tsx --test --test-concurrency=1 tests/unit/reload-shell-owner.test.ts tests/sdk/reload-survival-sdk.test.ts` | real `AgentSession.reload()` case observes baseline `killed`; gap/identity/timeout/cap tests fail because no living handoff exists. Quit/new/resume/fork kill controls stay green. |
| Future host + package: `npx tsx --test --test-concurrency=1 tests/sdk/bash-promotion-sdk.test.ts tests/scripted-provider/bash-promotion.test.ts` | Current host-characterization assertion first proves no transferable execution API. Do not fake green package behavior; only switch to behavioral red/green tests once the supported host contract is installed. |

A test that is already green on baseline is a guard, not defect evidence. Preserve baseline-red excerpts, then rerun focused files, relevant full SDK/scripted/PTY gates, docs verify/payload/pack, exact supported Pi compatibility, and native Windows/compiled-Bun qualification as applicable.

## Implementation units, ownership, and dependency order

| Unit | Exact ownership | Depends on / stopping boundary |
|---|---|---|
| G1 finite docs variants | `scripts/docs/lib.mjs`, `scripts/docs/selftest.mjs`, `tests/unit/docs-gate.test.ts`, `tests/package/docs-contract.test.ts`; generated files only via `docs:generate` by integrator | First. Must remain fail-closed; no authored semantic receipt. |
| C1 config/surface facade | new `src/core/config.ts`; `extensions/background-tasks.ts`, ambient/new child attribution entrypoints; `src/extension.ts`; light delegate/Fusion/result/attested facade boundaries; focused unit/SDK/package tests | After attribution lane integrates, because entry/path wiring overlaps it. One surface owner also owns P1 facade edits; do not parallel-edit these files. |
| C1 shell | `src/core/common.ts`, shell-facing slice of `src/core/registry.ts`, `tests/unit/core.test.ts`, registry/SDK/scripted-provider shell cases; authored configuration/runtime/bg docs | After config parser. Must preserve Windows behavior and current default. |
| C1 Fusion docs | `docs/commands/fusion-models.md`, authored explanatory sections in `docs/subsystems/fusion.md` and `docs/operations/configuration.md`, focused docs contract test | Independent of production, but generated regions remain integrator-owned. |
| P1 lazy implementations/benchmark | execution-only imports in `src/delegate-extension.ts`, `src/fusion-extension.ts`, registry attested seam, dock seam; new `src/core/lazy-module.ts`; lazy unit/SDK/package tests; `scripts/benchmark-cold-load.mjs` and worker | After C1 surface topology. Preserve PR #22 credit. Stop before bundling/precompiled distribution. |
| R1 prerequisite | Integrate the terminal-delivery worker’s `common.ts`, `registry.ts`, `extension-api.ts`, lifecycle edits/tests first | D1 must use truthful pending/delivered/abandoned state, typed closure, cleared timers, bounded retries. |
| D1 reload owner | new `src/core/reload-shell-owner.ts` (and a small process-identity helper if needed), reload-specific `common.ts`/`registry.ts`/`extension.ts`, SDK runtime + registry/platform tests; authored runtime/completion/config/tool/command docs | After R1 and P1. Scope ends at real reload for opt-in ordinary non-agent shell jobs. No daemon, restart/resume/fork/crash, or typed-task survival. |
| D2 host contract | Outside this standalone package; Pi extension/tool execution API and host tests | Hard stopping boundary. Parent repo/network edits are unauthorized here. |
| D2 package consumer | future `src/core/bash-promotion.ts`, extension/config wiring, unit/SDK/scripted-provider/PTY tests and docs | Start only after a supported host release exposes the transfer contract. Do not ship the override workaround. |
| Final integration | parent/integrator: generated docs/manifest/README regions, full inventory, contributor credit, compatibility and release gates | Run on integrated tree. Native Windows and compiled-Bun claims require their own evidence. |

## Rejected alternatives

- **Change POSIX default to Bash:** directly addresses #11 but breaks documented/default command semantics; operator required compatibility. Explicit Bash plus truthful guidance is the compatible path.
- **Arbitrary shortcut string now:** runtime-validatable, but current docs extraction identifies concrete literal keys and rejects conditional/dynamic registration. The finite enum closes the reported conflict without making docs untruthful.
- **Register disabled tools and deactivate them:** they remain in `getAllTools()` and command inventory and can be reactivated; fails #20.
- **Apply PR #22 as-is:** useful direction, but no cold-first-use/lifecycle evidence and no single-flight orchestrator construction.
- **Reattach D1 from `.json` + `process.kill(pid,0)`:** PID reuse, no exit code, no child handle/tree ownership, and snapshots do not prove a living process. Unsound.
- **External supervisor/daemon for D1:** could support crash recovery but is a much larger cross-platform framework than reload-only semantics require.
- **Reuse/reopen the old R1 registry:** violates one-way activation closure and risks stale host APIs. Transfer only living execution ownership into a fresh activation.
- **Override Bash for D2:** loses effective host settings and can silently replace/lose another extension. Explicit opt-in does not make those incompatibilities acceptable.
- **Kill then restart at threshold:** duplicates side effects and violates “same execution.”
- **Claim bundling speedups:** unproven for package payload, aliases, dynamic chunks, and compiled Bun; outside this lazy-loading slice.

## Local-output/cleanup note

No task-owned worktree, copy, install, model call, or source edit was created. Four host shell-tool truncation files were created automatically while reading very large installed bundles/rg output; total observed size is about 5.95 MiB (below the 10 MiB limit) and they were not deleted because writes/deletions outside the two authorized reports were not authorized:

- `/var/folders/qh/g_4pxrqd2_1c0x08bnlc6y840000gn/T/pi-bash-ae629693eaa798d3.log`
- `/var/folders/qh/g_4pxrqd2_1c0x08bnlc6y840000gn/T/pi-bash-a2bcb842fd1f47a0.log`
- `/var/folders/qh/g_4pxrqd2_1c0x08bnlc6y840000gn/T/pi-bash-63951aaa33410d2c.log`
- `/var/folders/qh/g_4pxrqd2_1c0x08bnlc6y840000gn/T/pi-bash-fe9f2dbafa402ba8.log`
