# L1 independent-review corrections — design written before package edits

## Verified route, authority, and baseline

- Effective route observed before substantive work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`, `GIT_ALLOW_PROTOCOL=file`.
- Package HEAD at design time: `0a69a4fbf8a011db0bf761d3026105d7aefd1e16`; reviewed launcher commit `8550a1a61ef7a9915d7c3a372b342451b80c806b` remains in its ancestry.
- Existing non-L1 dirt is preserved: parent-owned maintenance files and B0 helper/package-test edits are neither edited nor staged.
- Native host is Darwin. Windows behavior will remain injected/filesystem-fixture evidence only. No native-Windows or vendor-compiled-Pi certification will be claimed.
- Read before this design: package gateway, generated index/read gate, owning child-launch doc, delegation and Fusion docs; maintenance README/acceptance/execution/baseline, frozen PR 9/23 threads and patches; original L1 brief/design/report; independent FULL review and adversarial source/log; actual launcher, delegate SDK fixture, Fusion child consumer, launch callers; installed Pi 0.86 README, SDK, SDK examples, package, quickstart, RPC, session-format, and extension documentation plus package manifests.

## Baseline reproductions (before edits)

All commands used task-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/launcher-fix`, with `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

1. The independent reviewer repro was rerun with the package's absolute `tsx` path and exited **0**, meaning all four adverse assertions reproduced. Log: `reports/launcher-fix/baseline-adversarial.log`.
   - `bare-path-reselection`: resolution admitted `<admitted>/bin/pi`, returned bare `pi`, and a shell-free spawn with the identical relative PATH string under another cwd ran `UNVALIDATED`.
   - `broken-windows-host-substituted`: injected source `realpath` `EACCES` was downgraded to foreign-host status and a second module installation was returned.
   - `arbitrary-bun-sdk-misclassified`: a non-Pi `custom-sdk-application` plus `/$bunfs/root/...` was returned as `compiled-host`; exact Pi package lookups stayed at zero.
   - `posix-sdk-package-route-unreachable`: a foreign Node SDK host with no PATH Pi made zero exact-package lookups and failed, while the same layout's injected Windows branch resolved the valid named package.
2. A same-process wrapper set all four shared environment keys to values deliberately different from the mandated outer environment, imported the real delegate SDK suite, and asserted restoration after its 13 tests. The suite cases passed, then the wrapper failed as expected (**exit 1, 13 pass / 1 fail**) because `PI_OFFLINE` remained `1` rather than `sentinel-offline`. Log/source: `reports/launcher-fix/baseline-env-restore.log` and `repro-env-restore.mts`. This demonstrates that the outer environment had previously masked the teardown gap.

## Root-cause policy

This correction binds authority at resolution time. Platform branches choose discovery mechanisms, but neither a later PATH lookup nor a virtual-path shape may create fresh launch authority.

1. **A PATH admission returns the admitted object.** POSIX PATH search still honors entry order, canonicalizes symlinks, requires a regular file and `X_OK`, and skips invalid candidates. On success it returns the canonical absolute executable that passed those checks, with an empty argv prefix and `kind: "path"`. It never discards that identity for bare `pi`. A child cwd change, a relative PATH entry, or a different spawn environment/PATH therefore cannot reselect another file. Arguments remain structured arrays and no shell is introduced.
2. **Bun virtual paths are evidence of packaging mechanics, not Pi identity.** `/$bunfs/root/...` alone will no longer authorize direct relaunch. The direct compiled route is retained only for the established Pi CLI executable authority already recognized by this package: exact executable basename `pi` on POSIX or `pi.exe`/`pi.com` on Windows, followed by canonical regular-file and execute/native-extension checks. An arbitrarily named compiled SDK application falls through to verified host/package discovery; if no safely runnable exact Pi package route exists, resolution refuses. This intentionally does not claim support for renamed vendor binaries or certify a compiled distribution.
3. **Host classification is three-way, not catch-all fallback.** A genuinely absent host path (`ENOENT`/`ENOTDIR`), no named boundary, or a nearest foreign named package is `HostIsNotPi` and may permit an exact module route. Source `realpath` `EACCES`, `EIO`, and other I/O/integrity failures remain hard errors. Once a named Pi host is found, any manifest/bin/containment/identity failure is also hard. Broken authority is never hidden by a second installation.
4. **The exact installed-package route is platform-neutral for embedded SDK hosts.** After POSIX PATH fails, both POSIX and Windows inspect the running host first. A verified Pi host wins. A genuinely absent/foreign host may use `@earendil-works/pi-coding-agent/package.json`, or the package-entry walk when the manifest export is unavailable. The existing exact name, canonical root/bin containment, regular-file, extension, and generic-runtime checks remain mandatory. Thus a legitimate Node/Bun SDK app can use its installed Pi module without impersonating the CLI in `process.argv[1]`; malformed/unreadable host authority cannot.
5. **Fixture globals are transactional.** The delegate SDK harness snapshots and restores every key it writes (`PATH`, scenario, `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY`, `CI`) plus `process.argv[1]`, idempotently on normal disposal and setup failure. Tests use sentinel values that differ from the outer mechanical environment so leakage cannot be masked.

## RED-first durable tests

### `tests/unit/pi-launch.test.ts`

- Convert existing PATH expectations from bare `pi` to independently computed canonical fixture paths.
- Add the reviewer's real POSIX subprocess regression: the same relative PATH string exists under admission and child cwd with different executables; also change the spawn PATH. The structured shell-free spawn must still execute the independently expected admitted path and preserve literal argv.
- Add arbitrary Bun-virtual compiled SDK coverage: an executable not named Pi must not become `compiled-host`; package lookup/failure must be observable. Keep a mocked exact-name `pi` compiled route as limited compatibility evidence.
- Add Windows `EACCES` and non-missing I/O source-realpath cases proving zero module fallback and a loud host error.
- Add positive POSIX foreign-SDK-host + exact named/contained module-package coverage, without mutating `process.argv`; add wrong-name and broken-host negative layouts proving no unsafe fallback.
- Keep existing package name/bin/containment/symlink/argv cases and update only assertions invalidated by stronger identity binding.

Expected red against current production: canonical PATH assertions and subprocess target fail; arbitrary Bun app is returned directly; Windows host `EACCES` substitutes the module; POSIX module lookup stays at zero.

### `tests/sdk/delegate-sdk.test.ts`

- Extend the harness snapshot to all mutated keys.
- Add one non-concurrent test that installs deliberately different sentinels, verifies restoration after normal `dispose`, then forces a setup failure after mutation and verifies the same env/argv restoration. Its outer state is restored in `finally` even if an assertion fails.

Expected red against the current fixture: all four shared keys remain the isolated values after normal disposal (the external wrapper already proves this).

### `tests/unit/fusion-pi-child.test.ts`

- Replace the historical `record.command === "pi"` implementation assertion with a real executable fixture passed through `piLaunchDependencies` and an assertion against that fixture's independently canonicalized path.
- Settle/close the fake child before command assertions so a failed assertion cannot strand timers or suppress terminal TAP output.

Expected red against current production: the resolver returns bare `pi`, not the pinned fixture target.

## Owned edits and boundaries

Planned package edits are limited to:

- `src/core/pi-launch.ts`
- `tests/unit/pi-launch.test.ts`
- `tests/sdk/delegate-sdk.test.ts`
- `tests/unit/fusion-pi-child.test.ts` (narrow obsolete bare-name consumer assertion only)
- `docs/subsystems/child-launch-durability-and-safety.md`

No production caller/registry/common/facade/extension/attribution file, forbidden SDK file, B0 helper/package test, generated doc, test-plan/state file, package manifest, or lockfile will be edited. No helper-file edit is currently needed. The existing native-Windows Fusion SDK skip remains unchanged qualification debt.

No out-of-scope caller API change is currently required: every caller already spawns `launch.executable` with `piLaunchArgv()` and structured argv. If testing reveals a caller that discards the returned executable, that exact dependency will be reported rather than patched outside ownership.

## Verification plan

1. Add focused tests/expectation corrections only; run launcher unit, focused Fusion child test, and delegate env-restoration case to capture RED logs with terminal TAP summaries.
2. Implement the root policy in `pi-launch.ts`; update authored owning prose (never generated files).
3. Run green launcher unit, delegate SDK, complete `fusion-pi-child` unit file, relevant SDK/RPC/scripted child consumers, and typecheck. If the concurrent F1 test still causes TS2532, record it as unowned and run a scoped strict L1 config; do not edit F1.
4. Run a post-fix real subprocess probe proving the actual spawned executable is the admitted canonical path despite child cwd/env PATH changes; record exact command/output.
5. Run `git diff --check`, inspect only owned paths, stage explicit owned paths, and make coherent follow-up commit(s) without amend/rewrite. Retain bounded evidence under `reports/launcher-fix`, remove task-owned TMP/HOME/agent residue, and verify zero live owned children.
