# Local community closeout report

Date: 2026-09-21

Package: `pi-background-tasks@2.6.0`
Integrated main: `ff1ddbc07c85a9edfd5d91d3241e322d6b8a9d67` (tree `40f789193734e57a65f3336a467a903dee7db124`)

This is a **local closure candidate**, not a GitHub closure, release, push, tag, or publication.

## Ticket disposition

| Ticket | Local disposition | Evidence / boundary |
|---|---|---|
| #11 | `CLOSURE_READY_LOCAL` | Explicit compatible POSIX shell policy and matching prompt/receipt behavior; `5a30cd0`, merge `bf13bb3`; Node 22/24 + scripted Nu/Bash gates pass |
| #13 | `CLOSURE_READY_LOCAL` | Validated configurable attribution path and loud errors integrated in attribution chain ending `bc25e9a` |
| #14 | `CLOSURE_READY_LOCAL` | Reload/resume lineage recovery with real lifecycle proof; attribution chain ending `bc25e9a` |
| #15 | `CLOSURE_READY_LOCAL` | Candidate/evaluator/repair/merger roles and tradeoffs documented/tested; `0a69a4f`, `7628f4d` |
| #16 | `CLOSURE_READY_LOCAL` | Validated configurable/off dock shortcut, truthful hints and conflict dispatch; `da2f6fc`, `180536e`, merge `fcf2af0` |
| #18 | `BLOCKED_UPSTREAM` | Pi has no atomic effective-Bash execution/cancellation lease. Package replacement would lose host settings/overrides; kill/restart/adoption rejected. Receipt: `execution/bash-transfer/review.md` |
| #19 | `CLOSURE_READY_LOCAL_WITH_PLATFORM_GAP` | Lossless non-target Anthropic-protocol forwarding passes Node and real host fixture proof. Installed Pi 0.86 fails under Bun before extension load; no vendor compiled-Bun claim |
| #20 | `PACKAGE_SCOPE_COMPLETE_UPSTREAM_BLOCKED` | Finite independent capabilities, derived `bg_result`, mandatory child guards and reload inventory pass. Bare/empty/mode-only SDK hosts lack a guaranteed post-bind/provider-owner callback |
| #21 | `CLOSURE_READY_LOCAL_WITH_WINDOWS_GAP` | PR #22 lazy lanes plus P1b compiled distribution/conditional facades/UI/attested/attribution integrated through `154e97f`; lifecycle, damaged payload and 30-sample benchmarks pass. No native-Windows timing claim |
| #24 | `CLOSURE_READY_LOCAL` | Truthful pending/delivered/abandoned publication, typed closure, bounded retries and cleanup ownership integrated through `58c15e8` |
| #6 | `POSIX_CLOSURE_READY_LOCAL_WINDOWS_BLOCKED` | Opt-in same-live-process reload ownership, gap completion, controls, original timeout/cap and three settlement-race fixes integrated through `a1c5a44`; native Windows unavailable; crash/process restart unsupported |

## PR disposition and credit

| PR | Local disposition |
|---|---|
| #9 | Revised/integrated with executable validation and safe package fallback; contributor provenance retained in launcher history |
| #12 | Cross-provider tool-id/image regression integrated in attribution test history |
| #17 | Lineage recovery adapted/integrated with contributor provenance retained |
| #22 | Adapted in `8225f48`; original head named and `Co-authored-by: bufan <821869798@qq.com>` retained; lifecycle corrections and P1b follow-ups integrated |
| #23 | Combined with #9 into verified POSIX/Windows installed-layout resolver; provenance retained |
| #25 | Adapted into truthful publication lifecycle rather than false published-on-abandon semantics; provenance retained |

## Integrated acceptance evidence

Both supported Node lines ran under isolated offline state:

- Node 24.16.0: default **788/788**, PTY **9/9**, scripted provider **35/35**.
- Node 22.19.0: default **788/788**, PTY **9/9**, scripted provider **35/35**.
- Zero failures/skips in accepted final runs.
- Compiled entrypoint smoke: pass on both Node lines.
- Large-context smoke: pass.
- Docs: 32 public surfaces / 60 production sources, deterministic verify pass, docs tests 8/8.
- Payload: 236 files; packed compiled damaged-module test passes.
- Dry-run tarball: 1.4 MB packed / 5.8 MB unpacked.
- Final controlled benchmark: 30 fresh processes per scenario for source and compiled states; raw receipts under `execution/final-performance/`.

## Performance truth

The final source-vs-compiled comparison is mixed on macOS/Pi-Jiti: compiled loading improves direct facade imports and several first-use/result paths, while process/default startup and selector first-use are slower than the same final source. Against the earlier frozen pre-edit distributions, published compiled startup remains materially lower across process/default/delegate/Fusion/selector profiles, but that cross-run comparison is contextual rather than causal.

Therefore the package claims a verified compiled distribution and removal of unnecessary static startup graphs—not a universal millisecond guarantee or a native-Windows result.

## Explicit unavailable gates

- Native Windows: unavailable; `test:windows` deliberately exits non-zero off Windows.
- Vendor compiled Pi/Bun: unavailable; local Bun cannot start installed Pi 0.86 because Pi's bundled Undici fails before extension loading.
- pnpm: executable unavailable.
- Exact Pi 0.81.1–0.84.0 reinstall: not rerun because no isolated offline cache contains every dependency closure. User cache/network were not used.

These limitations remain visible blockers and are not converted into passes.

## Unsupported by design

- Hard crash, SIGKILL, power-loss or process-restart survival.
- Cross-process PID/file/JSON adoption or synthesized process exit truth.
- Silent route substitution, silent fallback, or restart-based built-in Bash takeover.

## Cleanup and remote state

Both auxiliary branch tips are retained as main ancestors through tree-preserving merge commits. Their package-only worktrees and merged branches were removed normally, the 225 MiB task scratch root was deleted after receipt preservation, shared dependencies remain intact, and no matching process remains.

After this local closure, the operator authorized pushing package `main` with the `2.6.0` version bump. No npm publish or tag is included; no GitHub issue/PR is closed or modified, and the parent repository is not committed.
