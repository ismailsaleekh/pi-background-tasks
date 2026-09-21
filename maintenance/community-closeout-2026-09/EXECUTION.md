# Execution and quality protocol

## Start and sequence

1. Read all authority/read-gate files and verify the frozen evidence hashes. Inspect live package status/history; preserve unrelated changes. The prep commit adds this directory only; production baseline remains `14aa4ef` until implementation commits land.
2. Establish current test/tool/runtime availability and record native Windows/compiled-Bun qualification access. Never interpret a missing environment as a passing test. Keep implementing independently testable work if an external environment is unavailable.
3. For each acceptance row, write the behavioral decision, exact owned files, red check, consumer, integration dependencies, and stopping boundary in `STATE.md` before assigning implementation. Existing defaults stay compatible, new invasive behavior is opt-in. Resolve shell/feature-selection/lifecycle semantics before their code; escalate only genuinely breaking/unauthorized choices.
4. Fix baseline gates without removing their protective intent. Keep defect/fix evidence separate from inherited baseline failures.
5. Stabilize attribution (#14/#17/#12, #13, #19) and terminal delivery (#24/#25). In parallel where file ownership allows, qualify launch resolution (#9/#23).
6. Add configuration/shortcuts/docs (#20/#16/#15/#11), then integrate startup optimization (#21/#22) against that public-surface policy.
7. Design and implement reload survival (#6) and automatic backgrounding (#18) as separate tested slices that share corrected lifecycle semantics. No infrastructure-only completion: every primitive must have its real consumer and proving scenario in the same coherent change.
8. Run integrated qualification, independent review, fix findings, rerun impacted gates, then execute cleanup and final closure report. Do not stop at the easy PRs or call a partial plan complete.

## Package-only worktrees and disk rules

Authoritative package checkout:

```text
/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks
```

Its common Git directory is beneath the parent administrative `.git/modules/packages/pi-background-tasks`, but it contains the **standalone package repository**. This is normal submodule storage, not permission to use the parent's Git repository.

- Always invoke worktree operations with `git -C "$PKG" ...`, where `git -C "$PKG" rev-parse --show-toplevel` is the package path and package.json.name is `pi-background-tasks`.
- **Never** run `git worktree add` from `ai-pipeline`, clone/copy the parent, initialize recursive submodules, or use a monorepo worktree as a shortcut.
- Maximum **two auxiliary package worktrees**, preferably one implementation worker plus one independent reviewer. Serialize overlapping ownership (especially attribution, registry, facade registration, and generated docs).
- Use one newly created task-owned scratch root outside the parent checkout, e.g. a unique `mktemp -d /tmp/pi-bg-closeout-XXXXXX`. Record its realpath, each worktree, branch, PID/task id, purpose and cleanup state before launch.
- Assert after creation: worktree Git common-dir equals the package common-dir; package name matches; tracked paths contain package `src/`, `extensions/`, etc.; no `orchestrator/`, `products/`, `knowledge/`, or `blocks/` copied from the parent. Baseline smoke proved a package worktree has 202 tracked files and occupies about 17 MiB without dependencies.
- The main entry of `git worktree list` on this host displays the submodule administrative directory, despite `--show-toplevel` correctly identifying the package checkout. **Never remove that main/admin entry.** Remove only exact auxiliary paths recorded by this task.
- Reuse the existing package dependency tree read-only via a task-owned symlink when versions match. Never run npm install/ci against that symlink. For install/compatibility testing use sequential disposable installs and one task-owned cache; no repeated parent/node_modules copies. Give mechanical tests existing task-owned `TMPDIR`/HOME/agent directories so their fixtures and logs remain attributable and removable; this test isolation is distinct from workers' authenticated subscription launch.
- Default scratch budget: **2 GiB total new task-owned worktrees/install caches/test artifacts**. Measure disk usage before/after each lane and compatibility install. At the budget boundary, stop allocating and clean proven disposable artifacts; ask before larger platform images/installations. Do not delete user caches or unrelated files to meet the budget.
- Preserve small reports, meaningful failure excerpts, commands, exit codes, source SHAs and hashes in this committed dossier. Remove bulky reproducible artifacts once the relevant evidence is retained. Avoid unbounded transcript/log duplication.

### Safe cleanup (mandatory, not optional polish)

For each worker: obtain terminal notification/result; ensure no owned process/watch/server is still using the worktree; inspect status; commit all intended work and preserve any unexpected/unintegrated changes; integrate and record the source→integrated commit mapping. Prefer an ancestry-preserving local merge where appropriate, making reachability checks straightforward. If cherry-picked, retain proof and do not forcibly delete a branch solely because `-d` refuses.

Then:

1. Remove only task-owned untracked dependency symlinks/artifacts after checking paths. Never follow a dependency symlink to delete its target.
2. Use `git -C "$PKG" worktree remove "$WT"` on the recorded clean auxiliary worktree. **No `--force` by default.** Dirty/unintegrated residue is a blocker to cleanup until preserved, not permission to discard.
3. Delete safe integrated worker branches with ordinary `git branch -d`; do not delete unrelated/pre-existing branches.
4. Inspect `git -C "$PKG" worktree prune --dry-run --verbose`; prune only confirmed task-owned stale metadata. If no stale metadata exists, removal already completed pruning and no broader command is needed.
5. Remove remaining exact recorded scratch directories after checking descendants/ownership and retaining evidence. Verify no owned auxiliary worktree, live process, mount, symlink, tarball or install cache remains. Record before/after sizes and final package status.

Cleanup must also run after failures/cancellation. Do not erase forensic evidence or incomplete implementation just to report zero disk usage.

## Subagent protocol

- Subagents run via `bg_run` with `isAgent:true` and an explicit package-only worktree cwd. Use native Pi route **`openai-codex/gpt-5.6-sol`**, `--thinking max`; verify model availability/OAuth and effective thinking before substantive work. Installed CLI accepts `max`; route/auth availability has NOT been certified by the prep step. No silent fallback or downgrade.
- Do not use `bg_delegate` for implementation (it is inspect-only and has no thinking-level argument). Do not use Fusion tools for package maintenance. Attested tools are not requested for this programme.
- Prefer isolated child discovery (`--no-extensions`, no ambient project context/skills/templates/themes) with an explicit self-contained brief carrying this authority and required file reads. Do not accidentally load the whole monorepo context or other provider extensions. Use task-owned session/report paths.
- Every brief names: package HEAD/tree; task id and acceptance rows; exact writable paths; forbidden areas; required red/green checks; dependency/consumer; expected report and local commits; no-push/no-GitHub boundary; max thinking/subscription route; disk/cleanup obligations; stopping boundary.
- Workers implement or review, not both certify their own solution. Independent reviewers inspect the final diff against acceptance criteria and challenge failure paths. Review never substitutes for execution and must not self-award doc semantic attestations.
- Parent is sole integrator and owns cross-lane API decisions/generated-doc reconciliation. Finish notifications are terminal truth; do not sleep/poll merely to wait. Continue independent work or yield.

## Per-change evidence

- Record the baseline failing command and its actual failure reason. Green tests that never fail on baseline do not alone prove a fix (test-only PR #12 is explicitly regression coverage for behavior already fixed).
- Test normal, malformed-input, failure, cancel, timeout, output-cap, corruption, duplicate/race and shutdown cases appropriate to the change. Cross-platform/path and real session replacement behavior need their own integration scenarios.
- Adopt contributor code only after inspecting it, preserving credit, and reconciling safety semantics with package doctrine. Do not blindly `git apply` and declare completion.
- Update authored owning docs and exhaustive `TESTING.md`/`TEST_PLAN.md` where behavior changes. Generated regions/manifests/indexes are written only with `npm run docs:generate`; final integration regenerates after all source changes. Do not weaken the docs engine or invent semantic PASS receipts.
- Small coherent local commits include code + consumers + tests + corresponding docs. Package-only commits; do not update the parent submodule pointer automatically. No remote pushes/tags/releases.

## Integrated qualification

Read package test/release instructions before execution. Isolate HOME/agent/session/project state; never test against real user sessions/credentials. Default mechanical environment: `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1`.

Required as applicable to the integrated release candidate:

- `npm run typecheck`, `npm run test:type-safety`, `npm run test:unit`, `npm run test:sdk`, `npm run test:rpc`, `npm run test:component`, `npm run test:package`, `npm run test:hook-contract` (default `npm test`).
- `npm run test:agent-loop`, `npm run test:pty` (or full `npm run test:full` without gratuitously duplicating all gates). Missing PTY capability is explicit, not a clean pass.
- `npm run smoke`, `npm run smoke:large-context`, `npm run docs:verify`, `npm run payload:check`, packed consumer installation, pnpm exotic-subdependency policy, and supported-Pi compatibility checks.
- Real native Windows process/tree/durability/installed-layout behavior and real compiled-Bun loader paths for changes that claim that support. Mocked platform branches cannot certify these. No GitHub workflow actions; use an already-authorized local/accessible environment or record a qualification blocker.
- Same-host repeated cold-start benchmark with identical versions/cache conditions and verified first-use behavior for #21/#22. Keep performance claims separate from functional correctness.
- A no-network synthetic transport/lifecycle suite is the first line for attribution. If live model acceptance is necessary, use only the authorized subscription channel, bounded prompts/no sensitive content, and preserve actual observations. Never use metered frontier APIs to make tests pass. Windows/Bun downloads/VMs must respect disk and authorization limits.
- `git diff --check`; source/public-contract compatibility and contributor-credit review; final clean package status; no unauthorized files or leftover workers/worktrees.

No root-wide ai-pipeline preflight/build/test scans for this standalone package task. If a truly necessary integration change lies outside the package (for example an independent monorepo attribution copy), report the exact boundary and request scope authorization instead of silently editing it.

## Completion vocabulary

Use `PENDING`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED_LOCAL`, `BLOCKED_ENVIRONMENT`, `BLOCKED_DECISION`, or `CLOSURE_READY` per item. `CLOSURE_READY` requires its full acceptance evidence and relevant integrated gates. It does not mean remotely closed or released. Keep unsafe alternatives, remaining failures, skipped coverage, and unknowns visible; do not describe incomplete qualification as perfection.
