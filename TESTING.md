# pi-background-tasks Testing

This package follows the repo-wide Pi extension QA standard:

- [`../EXTENSION_QA_STANDARD.md`](../EXTENSION_QA_STANDARD.md)
- [`../EXTENSION_TESTING_PLAYBOOK.md`](../EXTENSION_TESTING_PLAYBOOK.md)
- [`TEST_PLAN.md`](TEST_PLAN.md)

## Current commands

Default gate:

```bash
npm run test
```

This runs:

```bash
npm run typecheck
npm run test:type-safety
npm run test:unit
npm run test:sdk
npm run test:rpc
npm run test:component
npm run test:package
```

Full interactive gate:

```bash
npm run test:full
```

This runs the default gate plus:

```bash
npm run test:pty
npm run test:agent-loop
```

Smoke/release checks:

```bash
npm run smoke
npm run pack:dry-run
npm run test:compat
```

Current smoke is `tsx scripts/smoke.ts`. It creates a temporary Pi agent/session directory, sets offline/telemetry-suppression environment variables, and runs the package entrypoint with `/jobs`.

Smoke proves loadability only; completion requires `npm run test`, `npm run test:full`, `npm run pack:dry-run`, and the release-only compatibility gate when preparing a release.

## Required isolated environment

Automated tests run with isolated temp project/agent/session directories and should use:

```bash
PI_OFFLINE=1
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
CI=1
```

Tests must not use the user's real `~/.pi/agent`.


Fusion-specific targeted gates:

```bash
npm run typecheck
npm run test:type-safety
npm run test:unit
npm run test:component
npm run test:sdk
npm run test:rpc
npm run test:agent-loop
```

The Fusion SDK/RPC/scripted-provider tests install a deterministic fake child `pi` in a temp `PATH` from `tests/helpers/fusion-fake-pi.ts`. Parent Pi remains the real SDK/RPC runtime; only direct child `pi --mode text` calls with the package-owned private compact metadata extension are intercepted. `PI_CODING_AGENT_DIR` is pointed at the temp agent directory so `fusion-models.json` is never read from the user's real global Pi directory. Fusion context coverage is intentionally text-transcript coverage: tests verify long text is not summarization-truncated and image-containing session entries are represented by `[Image omitted from fusion text transcript: <mime-type>]` markers without forwarding raw image bytes/base64 to child Pi prompts. The release-only `npm run test:compat` packs the package, installs exact supported Pi versions, runs `/jobs`, runs `/fusion` through the installed package entrypoint with the fake child Pi, verifies five child invocations, and verifies `/fusion-models` rejects non-TUI mode. It then drives the current host Pi through a real RPC `fusion_brainstorm` parent-agent loop, checks the persisted tool result carries the complete Pi `Usage.cost` object, invokes `get_session_stats` (the same aggregation boundary used by the TUI footer), reopens the durable session, and verifies identical token/cost totals. All parent and child inference remains deterministic and local.

## Coverage summary

Implemented coverage includes:

- tools: `bg_run`, `bg_run_pi_attested`, `bg_status`, `bg_logs`, `bg_kill`, `fusion_brainstorm`, including required `isAgent` schema/runtime validation, the event-driven no-sleep/no-poll system-prompt contract, truthful launch receipts for all four notification/wake combinations, non-terminating `bg_run` compatibility, point-in-time status/log guidance, durable terminal-notification authority, attested direct Pi spawn validation, Fusion exact merged tool result delivery/progress/details/context exclusion, text-transcript image omission markers with raw image data excluded from child prompts, unknown/ambiguous IDs, completed-kill failure, legacy no-name preparation, head/tail truncation, and notification on/off behavior
- commands: `/bg`, `/jobs`, `/logs`, `/kill`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update`, `/fusion`, `/fusion-models` discovery, happy paths, `/fusion` direct custom-message delivery, `/fusion` editor/cancel flow, `/fusion-models` TUI save and non-TUI rejection, `/bg --agent` parsing, finished-notice clearing, malformed `/bg`, unknown/ambiguous IDs, completed-task `/kill`, byte-limit normalization, and RPC no-hang fallback behavior
- update-available notice: semver parse/compare/precedence, `formatUpdateSegment`, npm/`package.json` payload narrowing, and injected-fetch success/404/throw/timeout (unit); localhost-registry footer segment (idle + appended to an active footer), `/bg-update` non-installing instructions, and opt-out/offline/already-current/registry-failure no-segment-and-no-throw paths (SDK); `/bg-update` discovery and offline instructions (RPC). The check is one-shot on `session_start`, time-boxed, offline-safe, gated by `PI_OFFLINE`/`PI_BG_DISABLE_UPDATE_CHECK`, and `PI_BG_REGISTRY_URL` overrides the registry endpoint
- shortcut/UI: component coverage for focused dock list/detail/key handling, detail output-tail scrolling (arrow/page scroll, follow-pause-on-scroll, `lines X–Y of N` position indicator, resume-follow-at-bottom, and no-scroll when output fits), empty/history/unread states, paging, close aliases, stop/stop-all/rerun/path actions, missing output files; SDK coverage for explicit `/bg-clear` finished-notice clearing, `/bg-clear` footer hinting, optional `Ctrl+Alt+C` fallback shortcut registration, and mixed failed/stopped/done/focused footer status; RPC coverage that `/bg-clear` works as a terminal-independent clear path; and PTY coverage for `/tasks`, `/bg-tasks`, real `Shift+Down`, arrows, page keys, detail/back/history/stop/stop-all/rerun/path/close, failed unread badges, and running/completed/failed/killed rerun paths
- runtime files: output and metadata files under `.pi/tasks/`, Fusion private `.pi/fusion/<session-id>-<pid>/<run-id>/` artifacts plus global `fusion-models.json`, persisted `isAgent` classification, task-owned context-window telemetry snapshots, cumulative background Pi-agent token usage, tool-use counts, agent model identifier (preferring the fully-qualified `provider/model` form), explicit `isAgent:true` telemetry wrapping for background `pi` agents, `isAgent:false` non-wrapping for scripts, attested Pi flat siblings (`.pi-events.jsonl`, `.stderr`, `.pi-telemetry-wrapper.cjs`, `.attestation.json`), real child `pi --mode json` tool-event parsing for background-agent telemetry, split/large telemetry ingestion, metadata after completion/failure, Fusion v2 compact final-only metadata and explicitly marked partial-response artifacts, and Fusion manifest token plus complete cost-component aggregates equal to the sum of successful and observed failed/cancelled attempts
- extension EventBus API: unit coverage for `pi-background-tasks:request:v1`/`response:v1` closed-frame validation, exact capability handshake, malformed payload rejection, unknown keys, unknown operations, duplicate request IDs, missing `session_start`, shutdown refusal, unsubscribe, strict terminal frame shape, and response-barrier ordering; registry coverage for exactly-one terminal publication after durable metadata plus loud/retriable terminal delivery failure; SDK coverage with a shared real `createEventBus()` loading the actual extension, starting `printf api-ok`, reading bounded logs, observing exactly one terminal event after the run response, and killing a real sleep task without model/provider calls
- attested Pi producer: unit/SDK coverage for 128-bit attested task ids, exact direct argv/cwd, ModelRegistry OAuth observation without secrets, raw Pi session/message events, separate stderr, prompt/report/source hashes, authority start/finish commit/tree/clean checks, atomic metadata serialization, completion visibility only after the sidecar is durable, malformed event rejection, and no attestation sidecar for ordinary tasks
- agent activity transcript: pure `parseAgentActivity`/`formatAgentActivityLine` coverage (assistant text, reasoning, tool start with arg summary, silent successful tool end, `✗ tool failed` errors, truncation, invalid/non-activity narrowing); registry-unit coverage that wrapped-agent stdout is reconstructed across split chunks into the human-readable transcript while telemetry/activity control JSON is stripped from the output file (telemetry fields still updated), stderr passes through, and the trailing partial line is flushed on finalize; SDK coverage that fake and real child `pi --mode json` runs surface `→ tool`/`✗ tool failed`/assistant text in `bg_logs` with no control JSON leaking into the visible output
- safety: kill, already-finished kill failure, timeout failure, spawn failure, low output-cap failure, multi-task shutdown cleanup, process-group kill fallback, Windows child-kill behavior, Windows-compatible writable-handle `fsync` for atomic metadata, SIGKILL escalation, duplicate finalization/notification races, metadata/notification failure handling, and pruning
- agent loop: deterministic scripted-provider coverage against `extensions/background-tasks.ts` for actual event-driven `bg_run` behavior. The provider observes the effective system prompt, public tool descriptions, and real launch receipt and deliberately emits the pre-fix `bg_status` poll if any contract layer is absent. Coverage proves one launch with no sleep/status/log polling, passive completion without an unsolicited provider turn by default, and exactly one follow-up turn when `triggerOnCompletion:true` is explicit. It also covers `/bg` display-only behavior, `notifyOnCompletion:false`, failed-task notification error fields, and parent-model `fusion_brainstorm` tool use followed by normal parent response
- package: manifest, docs, `pi.extensions`, exported `src/core/extension-api.ts`, peer dependency/import parity, packed runtime files, tarball-install smoke, direct-completion import bans, test/helper/script/artifact exclusion, isolated offline npm installation, exact-version compatibility, and current-host persisted/replayed tool-usage safety

## PTY notes

`test:pty` uses `/usr/bin/expect` to drive a real pseudo-terminal. It verifies:

- `/tasks` and `/bg-tasks` open the focused dock and close with `x`.
- A named `/bg` task appears in the dock when opened with xterm `Shift+Down` (`ESC [ 1 ; 2 B`).
- Secondary dock keys work in a real TUI: arrows, page keys, detail/back, history, stop selected, stop-all confirmation, rerun, output path, and failed/unread history surfacing.
- Detail output-tail scrolling works with real arrow/page keys: opening a 60-line task's detail and pressing `↑` shows the `lines X–Y of N` position indicator and pauses the live tail.
- Fusion TUI surfaces work end to end: `/fusion <prompt>` renders the exact fake merged answer directly in the real TUI, and `/fusion-models` opens the five-slot selector.

The detail-view `Model:` line and the compact `model <id>` dock row are also exercised deterministically by the component layer (`tests/component/background-tasks-manager.test.ts`), which is the lowest reliable layer for dock rendering.

### Terminal keyboard-protocol negotiation

`pi` enables the Kitty keyboard protocol at startup by emitting `ESC[>7u ESC[?u ESC[c` and briefly intercepts stdin until that negotiation completes. The expect harness therefore must not key on a bare `>` (which matches the `ESC[>7u` push instantly and fires input before pi is listening); instead it waits for the steady-state status marker `(auto)`, answers the keyboard-protocol query (`ESC[?0u`, i.e. legacy keyboard) and the device-attributes query (`ESC[?1;2c`), and settles briefly before sending keys. This makes legacy keystrokes reach pi deterministically rather than racing the 150 ms negotiation fallback.

### Interactive-stdin capability probe

`test:pty` begins with a one-shot probe (`ptyInputSupported()`) that spawns a minimal raw-mode Node stdin reader under the same `/usr/bin/expect` driver and checks that a sent byte is received. Some hosts cannot deliver stdin to a raw-mode Node TUI through expect (a plain `cat` receives input but Node `process.stdin` does not). On such hosts every PTY case is skipped with a loud reason instead of failing; where stdin is deliverable the full interactive dock scenarios run for real. The deterministic SDK/RPC/component layers remain the authoritative gates in `npm run test` either way.

## Artifact policy

Use package-local or repo-level artifacts if future snapshot/log persistence is needed:

```text
artifacts/pi-extension-tests/pi-background-tasks/
├── summary.json
├── rpc-events.jsonl
├── tui-ansi.log
├── screen.normalized.txt
└── snapshots/
```

Normalize volatile values before snapshotting: task IDs, session IDs, PIDs, timestamps, durations, temp paths, and `.pi/tasks/<session-pid>/...` run directories.

## Remaining full exhaustive coverage work

The Lane A residual hardening items, Fusion repair hardening, and the explicit `isAgent` agent-vs-script classification are covered by default unit/SDK/RPC/component/package gates plus full PTY and scripted-provider gates. `TEST_PLAN.md` remains the source of truth for future edge-case additions, especially any new telemetry surfaces added after this baseline.
