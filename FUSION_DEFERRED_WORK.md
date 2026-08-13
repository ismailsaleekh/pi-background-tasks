# Fusion Deferred Work

Issues 3–7 and 9 below are intentionally deferred: no implementation is currently
authorized for any of them. Issues 1–2 were implemented separately; Issue 8 is
implemented and retained below as a closed record.

## Issue 3: Per-child caps

- **Current behavior (verified):** Per-child caps are 550 provider requests,
  600 tool calls, 32 MiB aggregate tool-result bytes, and 50 minutes absolute /
  35 minutes idle.
- **Risk:** Caps can be exhausted mid-task, truncating useful work with no
  graceful wind-down.
- **Future direction:** Per-workflow bounded work budgets, plus a reserved
  no-tool finalization turn so a child can summarize before hard cutoff.
- **Invariant:** Capacity expansions must move the related request/tool/byte/watchdog
  envelope coherently and retain loud terminal evidence; never use a timeout-only
  increase to hide an unbounded-loop defect.

## Issue 4: Provider failure surfacing

- **Current behavior (verified):** Provider failures such as Anthropic 429
  can surface as generic child exit errors, losing the original cause.
- **Risk:** Operators cannot distinguish rate-limiting, auth, or transient
  network failures from genuine task failures.
- **Future direction:** Sanitized failure classifications that preserve
  actionable signal without leaking raw provider payloads.
- **Invariant:** Only same-route, zero-work retries are permitted; never
  retry onto a different route.

## Issue 5: Concurrent candidate launch

- **Current behavior (verified):** Three candidates launch concurrently with
  no provider/account scheduling.
- **Risk:** Simultaneous launches can concentrate load on a single
  provider/account, increasing correlated failure risk.
- **Future direction:** A semaphore or staggering mechanism to smooth launch
  timing.
- **Invariant:** Any scheduling change must preserve exact routes and must
  never substitute models.

## Issue 6: Validation reviewer cancellation

- **Current behavior (verified):** An operational candidate failure cancels
  healthy validation reviewers, discarding otherwise-good work.
- **Risk:** Losing 2/3 or 3/3 good results due to one unrelated failure.
- **Future direction:** All-slot settlement with strict 3/3 success, or an
  explicit `completed_with_limitations` status for 2/3.
- **Invariant:** Do not silently present partial completions as full
  success.

## Issue 7: Partitioning

- **Current behavior (verified):** No partition API exists.
- **Risk:** Large scopes/sources may be handled inconsistently or dropped
  without notice.
- **Future direction:** A deterministic split plan or caller-declared
  scope/source partitions.
- **Invariant:** Never truncate silently.

## Issue 8: Failure artifacts and reporting — implemented

- **Implemented behavior:** Failed/cancelled stored runs write the manifest-bound
  `pi-background-tasks.fusion-failure-summary.v1` after durable `error.json` and
  terminal manifest publication. `bg_result` returns a bounded typed no-answer
  terminal view with verified evidence refs only.
- **Guarantee:** Partial artifacts are never presented as final answers, never
  inlined, and never used to claim delivered-answer usage.
- **Boundary:** Provider-failure classification remains Issue 4 work and is not
  inferred by the summary.

## Issue 9: `/fusion-models` topology warnings

- **Current behavior (verified):** `/fusion-models` lacks weak-topology
  warnings.
- **Risk:** Operators may unknowingly select topologies with fan-in
  bottlenecks or provider/account concentration.
- **Future direction:** Warnings for fan-in capacity, provider/account
  concentration, and measurable downstream pressure.
- **Invariant:** Warnings must never change routes.
