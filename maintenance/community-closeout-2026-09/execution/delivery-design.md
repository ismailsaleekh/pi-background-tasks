# R1 delivery design / red plan

Observed worker route before inspection: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max` (all exact). Package HEAD is `14afc33e3967a142758169d3217a4e63b4b3ec94` on `closeout/delivery`; production baseline is `14aa4ef382952f073bd4d540f57d6e8e3c2789a2`. Frozen evidence hashes: 49/49 OK.

## Behavioral design

- Keep terminal task durability, waiter release, notification delivery, and EventBus publication as independent facts. EventBus publication has an explicit internal state: `pending`, `delivered`, or `abandoned`. `terminalPublished` remains delivery truth only and is never set for abandonment.
- Make registry publication closure one-way for an activation. Shutdown and EventBus-service disposal close publication, clear every retry timer and gate reference, and abandon pending publication without changing task terminal metadata, waiters, or notification truth. A replacement activation gets a fresh registry/service; an old activation cannot be reopened.
- Add an explicit typed EventBus-service closed error/state. The registry detects the typed error, never message substrings.
- Race terminal gates against registry publication closure. Re-check publication lifecycle after either gate resolution or rejection. Closure wins before emission; gate rejection is a non-recoverable abandoned outcome; late gate settlement cannot emit or schedule retries and does not keep an old async registry continuation waiting indefinitely.
- Retry genuine synchronous `EventBus.emit` failures at 100 ms, at most 3 total emit attempts. Log at most once per failed attempt, include bounded error text, and mark exhausted delivery `abandoned`. A later successful attempt marks `delivered`. Because an earlier listener may receive before a later listener throws, retries remain at-least-once and consumers must deduplicate terminal frames by task id.
- Shutdown keeps the existing kill-on-reload policy and suppresses completion notification as before. No process persistence or #6 architecture is introduced.

## Red-first proof plan

1. Extend `tests/unit/registry.test.ts` before production edits to prove:
   - closed/shutdown abandonment is not false delivery and pending retry handles are cancelled;
   - persistent genuine publisher failure is capped at 3 attempts/diagnostics;
   - transient failure still retries and delivers once;
   - late resolving/rejecting gates after disposal cannot emit or re-arm (ordinary and managed tasks);
   - terminal metadata and waiters/notification behavior remain independent.
2. Extend `tests/unit/extension-api.test.ts` before production edits to prove typed closed-service failure, service disposal of registry retries, listener-failure dedup semantics, and ordinary immediate/normal/error/timeout/kill ordering remains inherited.
3. Add a narrow SDK lifecycle regression in `tests/sdk/sdk.test.ts` for repeated old-activation shutdown/new-activation replacement on a shared EventBus, proving old services unsubscribe and the fresh activation alone responds/publishes without post-shutdown terminal flood.
4. Run the new defect-focused tests against unchanged production and retain failing assertions/exit. Then implement only `src/core/common.ts`, `src/core/registry.ts`, `src/core/extension-api.ts`, and lifecycle-only `src/extension.ts` if needed.
5. Run focused registry/EventBus/SDK lifecycle tests, full inherited registry/EventBus files, and `npm run typecheck` in the required isolated offline environment. Record inherited type-safety issues separately; do not modify shared baseline gates.

All mechanical commands use `TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/delivery`, `HOME=/private/tmp/pi-bg-closeout-iNoltL/home/delivery`, `PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/delivery`, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`.
