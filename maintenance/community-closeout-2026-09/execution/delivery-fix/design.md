# R1 correction design / red plan

Effective route verified before inspection: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`. Correction base is `a54bb8eeae39c02382fc0f5f3838180589701bc7` on `closeout/delivery`.

## Decisions

1. **One-way task admission closure.** `BackgroundTaskRegistry` will acquire a counted admission lease in every starter (`startTask`, `startManagedTask`, `startDelegateTask`, and `startAttestedPiTask`). Shutdown closes admissions synchronously, and its asynchronous cleanup waits for all pre-existing leases to settle before enumerating running tasks. Every starter rechecks after asynchronous preflight and immediately before registry insertion and spawn. A starter interrupted before ownership cleans up its stream/files and cancels managed work; a child spawned before closure is already registry-owned, cannot produce a post-close EventBus success, and is included after the admission drain. Admissions never reopen on an old activation.
2. **Late activation continuations are inert.** `session_start` will recheck the one-way activation state after `ensureRuntimeDir()` and immediately before status interval/update-check creation. Teardown will always clear handles even on repeated calls rather than returning merely because disposal was already marked, so a racing handle remains disposable.
3. **Bounded, recency-preserving retention.** Recent-task pruning will continue to evict the oldest terminal task, including an old publication-pending task. Before deleting a pending task, the registry will truthfully abandon and dispose its gate/retry ownership with a distinct retention-limit reason. This keeps terminal-result lookup recency correct, keeps task retention bounded (apart from necessarily retained running tasks), and avoids a separate unbounded pending-publication set. A completed managed Fusion result must remain resolvable and retrievable through the actual `bg_result` tool when an older pending publication crosses the limit.
4. **Exactly-once emission settlement.** A synchronous terminal emit is a settlement phase. Closure clears queued gates/retries but defers abandonment, diagnostics, and pruning for the currently emitting task. A normal emitter return settles delivered; a throw settles according to closure or retry policy. No path may log abandonment and then overwrite it as delivery. Service-level listeners that call `close()` and either return or throw will be covered.
5. **Real Pi lifecycle qualification.** Replace synthetic lifecycle claims with installed SDK APIs: exercise `AgentSession.reload()` (fresh extension runner on the same session) and `AgentSessionRuntime.newSession()`, `switchSession()`, and `dispose()` (new sessions/runners), all with one shared EventBus. Assert old-runner invalidation, fresh binding/response/publication, ordinary task shutdown ownership, and managed Fusion cancellation. Synthetic delayed lifecycle seams remain only for the precise late-start/admission races and will be described as synthetic.
6. Preserve R1’s three total attempts at 100 ms, typed closed-service error, at-least-once listener semantics, durable terminal metadata/waiters, notification independence, and default kill-on-reload. No persistence/handoff work is introduced.

## Red-first proof

Before production edits:

- Re-run all five independent reviewer repro scripts against `a54bb8e` and retain bounded logs.
- Add durable tests for: delayed EventBus admission plus shutdown drain/no success/no spawn; all starter admission boundaries and managed cancellation; genuinely overlapping `session_start`/shutdown timer creation; recency pruning plus actual `bg_result`; reentrant service close on successful and throwing terminal listeners; actual `AgentSession.reload()` and `AgentSessionRuntime` new/switch/dispose with shared EventBus and old-runner invalidation.
- Run only those new test names on unchanged production and retain the expected failures. Lifecycle tests must identify which calls are real SDK APIs and which race seam is synthetic.

## Green verification

Run focused registry/EventBus/lifecycle/SDK tests, the full owning unit files, relevant Fusion SDK tests, full SDK suite when practical, `npm run typecheck`, and all five reviewer repros. Generated-doc freshness remains integrator-owned; authored owning docs will be updated, generated docs will not be hand edited.

All mechanical commands use `TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery-fix`, `HOME=/private/tmp/pi-bg-closeout-iNoltL/home/delivery-fix`, `PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/delivery-fix`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, and `GIT_ALLOW_PROTOCOL=file` with absolute npm filesystem operands only.
