# Live execution state

Last updated: 2026-09-21.

## Current stage

**LOCAL CLOSURE CANDIDATE COMPLETE — package work, qualification, evidence, and cleanup finished.**

- Runtime integration/ancestry anchor: `ff1ddbc07c85a9edfd5d91d3241e322d6b8a9d67` (tree `40f789193734e57a65f3336a467a903dee7db124`); final HEAD adds only this closure dossier.
- Package version: `2.6.0` (operator-authorized post-closeout bump).
- Parent repository remains untouched.
- The operator subsequently authorized pushing package `main` with the 2.6.0 bump. No npm publish, tag, GitHub issue/PR mutation, remote closure, or parent-repository commit is authorized.
- No agents are running. After operator correction, final integration, P1b implementation, test repair, and qualification were performed directly by the parent agent.
- All 11 issues and 6 PRs now have either integrated package work or a precise upstream/environment blocker. “Closure-ready” remains local evidence vocabulary, not remote closure.

## Integrated work

| Unit | Tickets | Local state |
|---|---|---|
| Baseline gates | release prerequisite | Integrated: compiler-backed type safety, file-URL dataflow, lifecycle-free real offline dependency archives, npm 10/11 policy, Windows-equivalent launch fixtures |
| Attribution | #13, #14, #19; PR #12, #17 | Integrated and locally verified: configurable account path, reload lineage recovery, lossless non-target forwarding, contributor credit retained |
| Delivery/runtime | #24; PR #25 | Integrated and locally verified: pending/delivered/abandoned truth, typed closure, bounded retries, admission cancellation, process-tree and durable-write ownership |
| Launcher | PR #9, #23 | Integrated and locally verified: executable POSIX route, named installed-package fallback, Windows structured launcher fixtures, contributor credit retained |
| Fusion docs | #15 | Integrated and locally verified |
| Features/shell | #11, #16, package-owned #20 | Integrated and locally verified: finite capabilities, derived result surface, mandatory child attribution, configurable/off dock, compatible explicit POSIX shell policy |
| Reload survival | #6 | Integrated at `71114b0`, `4557978`, `a1c5a44`: opt-in same-process ordinary shell ownership survives real POSIX reload; final three settlement races corrected |
| Lazy startup | #21; PR #22 | Integrated at `8225f48`, `78be81f`, `cc80b2b`, `c6c2c94`, `154e97f`: lazy execution/verifier/UI/attested/attribution lanes plus compiled JS distribution; PR credit retained |
| Integration seam | #6 + #21 | `de98ee0`: one synchronous close fence performs eligible reload handoff and closes all lazy lanes before awaited cleanup |

## Final local verification completed

Both Node lines used isolated `HOME`, `TMPDIR`, `PI_CODING_AGENT_DIR`, cache, offline/version/telemetry suppression, `CI=1`, and `GIT_ALLOW_PROTOCOL=file`.

| Gate | Node 24.16.0 | Node 22.19.0 |
|---|---:|---:|
| Typecheck | PASS | PASS |
| Type safety | 4/4 | 4/4 |
| Unit | 588/588 | 588/588 |
| SDK | 90/90 | 90/90 |
| RPC | 10/10 | 10/10 |
| Component | 12/12 | 12/12 |
| Package | 77/77 | 77/77 |
| Hook contract | 7/7 | 7/7 |
| Default total | **788/788** | **788/788** |
| PTY | 9/9 | 9/9 |
| Scripted-provider agent loop | 35/35 | 35/35 |
| Compiled smoke | PASS | PASS |
| Large-context smoke | PASS | not repeated |
| Docs generate/verify/tests | 32 surfaces / 60 sources; 8/8 | verify PASS |
| Payload | 236 files | 236 files |
| Pack dry run | 1.4 MB tarball / 5.8 MB unpacked | not repeated |

Two PTY cases initially failed on the unchanged baseline because fixed delays sent keys before async output/terminal settlement. Their harness now waits for actual output/terminal evidence; the full real PTY suite passes on both Node lines. One first integrated default run was invalidated by an unawaited direct call after the extension factory became async; the call was corrected and the complete SDK/default matrices pass.

## Remaining blockers and unsupported boundaries

| Ticket/surface | State | Precise boundary |
|---|---|---|
| #18 | `BLOCKED_UPSTREAM` | Pi exposes no atomic post-permission effective-Bash execution/cancellation lease. A package replacement would lose host settings or competing overrides; kill/restart/adoption is rejected. |
| #20 bare/empty SDK | `BLOCKED_UPSTREAM` | Bare `createAgentSession()`, empty-binding reload, and mode-only reload have no guaranteed fresh post-bind callback/provider owner token. Normal initialized TUI/RPC/print/JSON modes pass. |
| #6 Windows | `BLOCKED_ENVIRONMENT` | Native Windows unavailable. Mocks do not certify Windows process/pipe/handle continuity. |
| #6 host lifecycle | `BLOCKED_UPSTREAM` | Empty/mode-only reload and direct `AgentSession.dispose()` omit required lifecycle events. `AgentSessionRuntime.dispose()` is supported. |
| Crash/restart survival | unsupported by design | No PID/file adoption, hard-crash recovery, process restart, VM/realm replacement, or synthesized exit truth. |
| Vendor compiled Bun | `BLOCKED_ENVIRONMENT` | Bun 1.3.4 exists, but no vendor-compiled Pi binary is available; Node/Jiti compiled-JS evidence is not that certification. |
| pnpm gate | `BLOCKED_ENVIRONMENT` | No pnpm executable is installed. |
| exact Pi 0.81–0.84 compatibility reinstall | pending environment decision | The release script is offline-only; no isolated task-owned cache containing all exact package closures is currently available. Do not borrow the user cache or use network. |

## Final cleanup state

- Final 30-sample source/compiled receipts and platform blockers are committed under `execution/final-performance/` and `execution/final-platform/`.
- Ticket-by-ticket disposition is committed in `CLOSURE.md`.
- Reload tip `354dbdf` and lazy tip `60e3889` are ancestors of main through tree-preserving ancestry merges `994fb68` and `ff1ddbc`; both merge commits retain tree `40f7891` unchanged.
- The reload worktree's owned dependency symlink was verified against the main package dependency directory and unlinked; both auxiliary package-only worktrees were then removed normally without force.
- Both `closeout/*` branches were deleted with `git branch -d`; worktree prune reports no stale entries.
- Shared package `node_modules` remains intact.
- `/private/tmp/pi-bg-closeout-iNoltL` (225 MiB before cleanup) was removed after all final receipts were committed. No matching process remains.
- The package has one worktree, no closeout branches, no running agents/tests, and a clean main checkout before this final state commit.

Historical implementation/review receipts are retained under `execution/`. They document rejected intermediate states as well as accepted corrections; the current table above is authoritative for live state.
