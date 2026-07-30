# pi-background-tasks Test Plan

This package follows:

- [`../EXTENSION_PACKAGE_STANDARD.md`](../EXTENSION_PACKAGE_STANDARD.md)
- [`../EXTENSION_QA_STANDARD.md`](../EXTENSION_QA_STANDARD.md)
- [`../EXTENSION_TESTING_PLAYBOOK.md`](../EXTENSION_TESTING_PLAYBOOK.md)

## Package

| Field | Value |
|---|---|
| Package | `pi-background-tasks` |
| Extension entrypoint | `extensions/background-tasks.ts` |
| Public commands | `/bg`, `/jobs`, `/logs`, `/kill`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update`, `/fusion`, `/fusion-models` |
| Public tools | `bg_run`, `bg_run_pi_attested`, `bg_status`, `bg_logs`, `bg_kill`, `fusion_brainstorm` |
| Extension EventBus API | `pi-background-tasks:request:v1`, `pi-background-tasks:response:v1`, `pi-background-tasks:terminal:v1`; schemas exported from `src/core/extension-api.ts` |
| Shortcuts | `Shift+Down`; optional fallback `Ctrl+Alt+C` |
| Custom UI | footer status + focused bottom dock overlay |
| Custom provider | no |
| Runtime files/state | `.pi/tasks/<session-id>-<pid>/<task-id>.output`, `.pi/tasks/<session-id>-<pid>/<task-id>.json`; attested Pi opt-in adds `.pi-events.jsonl`, `.stderr`, `.pi-telemetry-wrapper.cjs`, `.attestation.json`; Fusion adds private `.pi/fusion/<session-id>-<pid>/<run-id>/` manifests/prompts/events/stderr/responses/evaluation/merged/error artifacts plus global `fusion-models.json` |

## Required gates

| Gate | Command | Required in default `npm run test`? | Status |
|---|---|---:|---|
| Typecheck | `npm run typecheck` | yes | implemented |
| Unit | `npm run test:unit` | yes | implemented |
| SDK | `npm run test:sdk` | yes | implemented |
| RPC | `npm run test:rpc` | yes | implemented |
| Component | `npm run test:component` | yes | implemented |
| Package | `npm run test:package` | yes | implemented |
| PTY/TUI | `npm run test:pty` | full gate | implemented (answers pi's Kitty keyboard-protocol negotiation; auto-skips with a loud reason on hosts that cannot deliver raw-mode Node stdin via `/usr/bin/expect`) |
| Scripted provider | `npm run test:agent-loop` | full gate | implemented |
| Pack dry run | `npm run pack:dry-run` | release gate | implemented |
| Smoke | `npm run smoke` | no | implemented; isolated load-only |
| Compatibility | `npm run test:compat` | release gate | implemented; exact Pi `0.75.5`, `0.81.1`, `0.82.1` pack/install plus `/jobs`, `/fusion`, and `/fusion-models` surfaces, followed by a current-host real `fusion_brainstorm` session-stat and replay witness |

## Feature coverage matrix

| Feature | Public surface | Unit | SDK | RPC | Component | PTY | Package | Scripted provider | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Start background command from UI command | `/bg` | yes |  | yes |  | yes |  |  | Unit covers `--name` and `--agent`; RPC/PTY start real processes. |
| List tasks | `/jobs` |  |  | yes |  |  |  |  | RPC asserts running and killed task rows. |
| Show bounded logs | `/logs <id> [maxBytes]` | yes |  | yes |  |  |  |  | Unit covers bounded reads; RPC verifies output/path. |
| Kill running task | `/kill <id>` |  | yes | yes |  |  |  |  | SDK tool and RPC slash command. |
| Open task manager fallback | `/tasks`, `/bg-tasks` |  |  | discovery | yes | yes |  |  | Component covers dock; PTY covers `/tasks` and `/bg-tasks`. |
| Start background command from LLM tool | `bg_run` | yes | yes |  |  |  |  | yes | Unit derives all notification/wake modes from one typed helper. SDK exercises the registered tool's effective system prompt, descriptions, non-terminating behavior, and all four launch-receipt combinations. The scripted provider verifies a default launch yields without sleep/status/log polling before one terminal-event follow-up. |
| Attested direct Pi producer | `bg_run_pi_attested` | yes | yes |  |  |  | type/schema |  | Unit covers 128-bit ids, exact direct argv, raw events/stderr, provider/model/session capture from Pi JSON, OAuth observation via ModelRegistry, prompt/report/source hash laws, completion visibility only after durable sidecar creation, malformed-event rejection, and no sidecar for ordinary tasks. SDK runs a fake Pi CLI through the public tool and verifies one complete flat attestation. |
| Inspect task status | `bg_status` |  | yes |  |  |  |  | yes | SDK uses exact IDs for deterministic lifecycle observations and verifies the model-facing contract calls status a point-in-time inspection rather than a wait primitive. Scripted-provider ordinary waiting makes zero status calls. |
| Read task logs | `bg_logs` | yes | yes |  |  |  |  | yes | SDK verifies bounded content and the model-facing no-wait-loop contract. Scripted-provider ordinary waiting makes zero log calls. |
| Stop task from LLM tool | `bg_kill` |  | yes |  |  |  |  |  | Covers running kill and already-finished loud failure. |
| Fusion command direct result | `/fusion`, `fusion-result` custom message | yes | yes | yes |  | yes | yes |  | Core unit covers deterministic full text-transcript context construction, explicit image omission markers without raw image data, direct final-text child argv/stdin/compact-metadata parsing, exact multi-block answer reconstruction, artifacts, pre-abort handling, and orchestration. SDK runs real `/fusion` against a fake child `pi`, verifies exactly five child text-mode invocations, hidden prompt persistence, visible exact merged custom message, no parent assistant rewrite, renderer output, progress/status behavior, no-argument editor flow, editor cancellation, and malformed config causing zero children. RPC verifies command discovery, `/fusion <prompt>` with U+2028/U+2029 content, custom-message result emission, no parent `agent_start`, no-argument editor protocol, malformed config/child failure visibility, and child isolation flags. PTY verifies `/fusion` renders the exact merged answer directly in a real TUI. Compatibility smoke runs `/fusion` through every supported Pi version with the installed package entrypoint. |
| Fusion tool result | `fusion_brainstorm({prompt})` | yes | yes |  |  | current-host stats/replay | yes | yes | Tool is registered at load and re-added on `session_start`; no eligibility/quota/routine/justification gates are implemented. BUG-182 unit/SDK coverage pins the exact host `Usage` contract, complete cost-component aggregation, rejection of legacy `costTotal`, v2 child/result/manifest schemas, exact merged text, progress, context exclusion, and final details. The release compatibility gate drives a real current-host RPC agent through the tool, verifies persisted tool usage, invokes the same session-stat path used by the footer, then reopens the durable session and verifies identical stats. Scripted-provider coverage proves normal parent consumption and evaluator schema repair. |
| Fusion model selector | `/fusion-models`, `fusion-models.json`, `FusionModelSelector` | yes | yes | yes | yes | yes | yes |  | Unit covers strict config parsing, duplicates, slash-containing model IDs, stale model failures, `$current`, atomic save, inter-process lock/revision compare-and-swap, and deterministic concurrent-save conflict. Component covers all five slots, duplicate selection, searchable model list, stale display, reset/save/cancel, persistence errors, and width safety. SDK drives the real command in a synthetic TUI context without `ctx.mode` to cover old Pi compatibility and verifies duplicate `$current`/explicit model persistence; SDK also verifies headless no-UI rejection. RPC verifies non-TUI notification without hanging, PTY verifies the real selector opens in a TUI, and compatibility smoke verifies print-mode rejection for every supported Pi version. |
| Fusion child isolation/lifecycle | child `pi --mode text`, private compact metadata extension, shutdown cleanup, `.pi/fusion` artifacts | yes | yes | yes |  | current-host stats/replay | yes |  | BUG-180 coverage proves final-text transport, reasoning exclusion, strict response reconstruction, unchanged caps, isolation, process cleanup, failure artifacts, and lifecycle semantics. BUG-182 upgrades the private compact metadata and artifact manifest to v2, preserves all token and cost components, centralizes clone/add/empty operations, rejects missing/legacy/unknown/non-finite cost shapes, and proves successful plus failed/cancelled attempt costs aggregate exactly once. SDK/RPC verify public child isolation; session shutdown tracks initializing and live runs. |
| Extension request/response service | `pi-background-tasks:request:v1` → `pi-background-tasks:response:v1` | yes | yes |  |  |  | yes |  | Unit covers closed-frame validation, capability handshake, unknown keys, unknown operation, duplicate request IDs, missing `session_start`, shutdown refusal, strict `run.payload`, strict malformed frames, and unsubscribe. SDK loads the real extension with a shared `createEventBus()`, starts `printf api-ok`, reads bounded logs, lists status, starts and kills a real sleep task, and checks malformed/unknown/duplicate controls without model/provider calls. Package tests assert `src/core/extension-api.ts` ships. |
| Terminal EventBus publication | `pi-background-tasks:terminal:v1` | yes | yes |  |  |  | yes |  | Registry unit proves exactly-one terminal snapshot after durable metadata and loud/retriable EventBus delivery failure; extension API unit proves one strict terminal frame correlated by task id after the run response for immediate, normal, failed, timeout, and killed tasks; SDK observes one terminal event for a completed task and one for a killed task through the real extension service. |
| Completion notification | custom message `background-task-notification` | yes | yes |  | renderer via typecheck |  |  | yes | BUG-181 unit/SDK coverage pins the durable-terminal guidance and truthful effective delivery receipts. Scripted provider loads the shipped extension, conditionally attempts the old `bg_status` poll when the real system prompt/descriptions/receipt are incomplete, and proves the fixed contract instead yields with exactly one `bg_run`, one terminal notification, and one default follow-up. Notification-only, notification-disabled, failed-task, and display-only `/bg` paths remain covered. |
| Footer status | `ctx.ui.setStatus` |  | load path + clear command/shortcut + mixed states/focused label |  | render semantics | yes |  |  | SDK verifies `/bg-clear` hint, failed/stopped/done combinations, running combinations, and focused label; PTY verifies Shift+Down dock path after footer-visible task. |
| Explicit agent classification | required `bg_run.isAgent`, `/bg --agent`, task metadata | yes | yes |  |  |  |  | yes | `isAgent:true` is required only for LLM/agent tasks and enables Pi-agent telemetry wrapping when the command invokes plain `pi`; `isAgent:false` is required for scripts/non-agents and prevents wrapping even if the command text looks like `pi -p ...`. |
| Per-task context usage | task row/detail + `bg_status`/metadata/notification snapshots | yes | yes |  | yes |  |  |  | SDK verifies task-owned telemetry is captured, explicitly marked background `pi` invocations are wrapped to emit telemetry, and parent `ctx.getContextUsage()` is not used; component verifies list/detail rendering plus `ctx —` placeholder. |
| Per-task token usage | background Pi-agent telemetry + `bg_status`/metadata/dock row/detail | yes | yes |  | yes |  |  |  | SDK verifies cumulative input/output/cache read/cache write/total token usage from explicit telemetry, fake `isAgent:true` wrapped child events, and real child `pi --mode json` with scripted provider; component verifies row/detail rendering. |
| Per-task tool-use counts | background Pi-agent telemetry + `bg_status`/metadata/dock row/detail | yes | yes |  | yes |  |  |  | SDK verifies total/failed/by-name tool counts from fake and real child Pi `tool_execution_start/end` events, including failed tools; component verifies row/detail rendering. |
| Per-task agent model | background Pi-agent telemetry + `bg_status`/metadata/dock row/detail | yes | yes |  | yes |  |  |  | Unit verifies `formatModelSummary`/snapshot-list rendering and telemetry ingestion of `model`; SDK verifies the model is captured from explicit telemetry, fake `isAgent:true` wrapped child `message_end` events (qualified `provider/model`), and a real child `pi --mode json` run (bare child model re-qualified from `--model`), plus that non-agent tasks report no model; component verifies compact `model <id>` row, fully-qualified `Model:` detail, and the “not reported by this background task” placeholder. |
| Agent activity transcript | wrapped Pi-agent output file + dock detail tail + `bg_logs` | yes | yes |  |  |  |  |  | Unit covers `parseAgentActivity`/`formatAgentActivityLine` for assistant text, reasoning, tool start (arrow + collapsed/truncated arg summary), and tool end (silent success, `✗ tool failed[: error]`), plus blank/invalid/non-activity narrowing. Registry unit verifies wrapped-agent stdout is reconstructed across split chunks into the transcript, `background-task-telemetry`/`-context-usage`/`-activity` control lines are stripped from the output file while still updating telemetry fields, child stderr passes through verbatim, and the trailing partial line is flushed on finalize. SDK verifies fake and real child `pi --mode json` runs render `→ tool`, `✗ tool failed`, and assistant text in `bg_logs` while keeping the telemetry/activity control JSON out of the visible output. |
| Focused dock list | overlay component |  |  |  | yes | yes |  |  | Selection/actions/history tested; PTY covers arrows, page keys, ordering with multiple tasks, failed/unread badges, and `/bg-tasks` fallback. |
| Focused dock detail | overlay component |  |  |  | yes | yes |  |  | Tail read, output box, and return-to-list tested. Component also verifies output-tail scrolling: ↑/↓ + PageUp/PageDown move through the loaded window, scrolling up pauses the live tail and shows a `lines X–Y of N` position, paging back to the bottom resumes follow, and output that fits the window never enters scroll mode. PTY drives the real arrow/page scroll keys in the detail tail. |
| Dock stop selected | `k` |  |  |  | yes |  |  |  | Component. |
| Dock stop all | `a`/`K` |  |  |  | yes | yes |  |  | Component and PTY confirmation. |
| Dock rerun | `R` |  |  |  | yes | yes |  |  | Component plus PTY running/completed/failed/killed rerun paths. |
| Dock close | `x`/`Esc`/`q` |  |  |  | yes | yes |  |  | Component + PTY. |
| Shortcut opens dock | `Shift+Down` |  | registration |  |  | yes |  |  | PTY sends xterm `ESC [ 1 ; 2 B`. |
| Clear finished notices | `/bg-clear`, optional `Ctrl+Alt+C` fallback |  | yes | yes |  |  |  |  | `/bg-clear` is the canonical terminal-independent path and is advertised in the footer. SDK invokes the slash-command handler and verifies fallback shortcut registration; RPC verifies `/bg-clear` clears finished notices; finished notices remain until explicit clear. |
| Update-available footer notice | `⬆ v<latest> /bg-update` footer segment + `/bg-update` command | yes | yes | yes |  |  |  |  | Unit covers semver parse/compare/precedence, `isNewerVersion`, `formatUpdateSegment`, npm/`package.json` payload narrowing, injected-fetch success/404/throw/timeout, and `package.json` read/degrade. SDK uses a localhost registry to verify the idle and append-to-active footer segment, `/bg-update` non-installing instructions, and that opt-out (`PI_BG_DISABLE_UPDATE_CHECK=1`), offline (`PI_OFFLINE=1`), already-current, and registry-failure paths render no segment and never throw. RPC verifies `/bg-update` discovery and offline non-installing instructions. The check is one-shot per `session_start`, time-boxed, offline-safe, and never runs on the status tick. |
| Runtime output files | `.pi/tasks/...output` | yes | yes |  |  |  |  |  | SDK asserts existence. |
| Runtime metadata files | `.pi/tasks/...json` | yes | yes |  |  |  |  |  | SDK asserts shape/status/name/context usage; registry unit tests cover metadata failure/update ordering. |
| Timeout kills task | `timeoutSeconds` |  | yes |  |  |  |  |  | SDK. |
| Output cap kills task | `PI_BG_MAX_OUTPUT_BYTES` |  |  | yes |  |  |  |  | RPC runs with a low cap and asserts failed status/log notice. |
| Shutdown cleanup | `session_shutdown` | yes | yes |  |  |  |  |  | SDK asserts multiple running tasks become killed; registry tests cover shared stop/wait behavior. |
| Process lifecycle/races | registry core | yes | yes | yes |  | yes |  | yes | Unit tests cover process-group fallback, Windows fallback, SIGKILL escalation, duplicate finalization/notification races, notification/metadata failures, pruning, malformed telemetry, split telemetry chunks, large telemetry records above the old 16KiB buffer, and wrapped-agent transcript/telemetry separation with split-chunk and trailing-partial flush; SDK/RPC cover runtime spawn/timeout/output-cap/shutdown; scripted provider covers wakeup integration. |
| Package manifest | `package.json` |  |  |  |  |  | yes |  | Keywords, `pi.extensions`, files, local smoke/compat scripts, and direct-completion import bans. |
| Pack contents | `npm pack --dry-run` |  |  |  |  |  | yes |  | Runtime files included; tests, fake child helpers, release-only scripts, artifacts, nested tarballs, and `node_modules` excluded. Default tarball install test uses isolated HOME/XDG/npm cache and offline peer-ignore install from the local tarball. |

## Residual hardening coverage

Lane A residual hardening is now covered by automated tests. No remaining hardening-only gaps are intentionally left open in this plan. Future feature work should add new rows instead of weakening these gates.

| Hardened area | Coverage |
|---|---|
| Extracted process registry | `src/core/registry.ts` has direct unit coverage for state transitions and injected spawn/kill/platform behavior. |
| Agent/script classification | Unit tests cover `isAgent:true` wrapping, `isAgent:false` non-wrapping, `PI_BG_DISABLE_PI_TELEMETRY`, and non-interceptable path-qualified `pi`; SDK verifies required tool schema/runtime validation and real marked Pi telemetry. |
| Process lifecycle/races | Unit tests cover duplicate error/close finalization, output-cap races, duplicate-notification prevention, waiter resolution via stop paths, metadata failure logging, and notification failure reset. |
| Process-tree kill safety | Unit tests cover POSIX process-group kill, child fallback, both-fail loud errors, SIGTERM idempotency, SIGKILL escalation, and Windows child-kill/shell invocation. |
| Pruning | Unit tests cover oldest-finished pruning while preserving running tasks. |
| Completion follow-up turns | `test:agent-loop` registers a deterministic scripted provider against the shipped extension path and verifies event-driven `bg_run` yielding with no sleep/status/log polling, passive completion with no default wakeup, exactly one opt-in wakeup for `triggerOnCompletion:true`, `/bg` display-only behavior, `notifyOnCompletion:false`, and failed notification error fields. |
| PTY secondary keys | `test:pty` covers arrows, page keys, `a`/`K`, `R`, `c`, `/bg-tasks`, failed/unread badges, multiple-task ordering, and rerun paths for running/completed/failed/killed tasks. |
| Footer/status combinations | SDK tests cover failed/stopped/done/running combinations, explicit clear, and focused label. |

## Acceptance checklist

- [x] `npm run test` passes offline in isolated temp dirs.
- [x] `npm run test:full` validates baseline real TUI/PTY behavior.
- [x] `npm run pack:dry-run` passes.
- [x] README claims and all plausible edge cases are exhaustively mapped in this test plan, including Fusion command/tool/model-selector public surfaces and the text-only image omission limitation.
- [x] Every listed edge case has automated coverage at the lowest reliable layer.
- [x] No real LLM/API/network dependency in default tests.
- [x] No dependency on user/global `~/.pi/agent` for SDK/RPC/PTY tests.
- [x] Volatile output is normalized in snapshot-style assertions where applicable.
