# L1 launcher report

Status: implementation committed and focused local verification complete.

## Route and boundaries

- Worker shell observed `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`; `GIT_ALLOW_PROTOCOL=file` remained set.
- Started from primary-main `1b3d48d833554ced807c729cab354dd7cc73b79d`.
- No network/GitHub/provider calls, installs, Fusion, extra worktree, package/lock/generated-doc edit, or parent-repository edit.
- Frozen dossier verification: 49/49 hashes OK (the first invocation was from the wrong cwd and only demonstrated path lookup failure; the corrected check from the dossier directory exited 0).

## Commit and owned paths

Commit: `8550a1a61ef7a9915d7c3a372b342451b80c806b` (`fix(core): verify Pi child launch routes`)

Committed owned paths:

- `src/core/pi-launch.ts`
- `tests/unit/pi-launch.test.ts`
- `tests/sdk/delegate-sdk.test.ts`
- `docs/subsystems/child-launch-durability-and-safety.md`

No fake-child helper needed modification. In particular, `tests/helpers/fusion-fake-pi.ts` already supplied a correctly named manifest/bin fixture; forbidden `tests/sdk/fusion-sdk.test.ts` remained untouched. Parent-owned maintenance/B0 dirt and untracked review dossiers were preserved.

Contributor credit recorded in the commit:

- PR #9 / `b3711557859f2f2624c27d4264c89cdb75b317e5`; tickernelz; Zhafron `<zhafronadani@gmail.com>`.
- PR #23 / `6aa4d58adbea9187eda1666d0c41e271471c2d51`; boggylp; Bogambe `<bogambe@gmail.com>`.

## Implemented decisions

- POSIX searches PATH in order and accepts only a canonical regular candidate that passes `X_OK`; invalid candidates do not mask a later valid one. It retains the compatible bare-`pi` spawn shape after that concrete check.
- With no qualifying POSIX PATH candidate, only the canonical declared bin of an exact named `@earendil-works/pi-coding-agent` running host can launch through Node/Bun. Arbitrary JavaScript and another file inside the Pi package are rejected.
- Manifest walking skips only valid nameless sub-manifests. Malformed/unreadable/non-object/malformed-name manifests are hard package boundaries; the nearest foreign named boundary is not crossed.
- Windows never uses PATH shims. A verified running Pi host is authoritative (global-Pi case); a genuinely foreign SDK host may use module resolution. A broken host claiming the Pi identity cannot silently fall back to another install. Direct and package-entry module results also require exact package identity.
- Every package route checks canonical manifest/root/bin, lexical and canonical containment, a regular target, valid `bin.pi`/npm bin, and host/bin equality where host-derived. Absolute, drive-qualified, escaping, outside-symlink, nonfile, `.cmd/.bat/.ps1`, extensionless, and unknown targets fail.
- JavaScript package bins require a generic `node`/`nodejs`/`bun` runtime and structured argv. Windows `.exe/.com` bins remain direct with no shell and retain the historical package kind for compatibility.
- Bun virtual hosts and executables actually named `pi`/`pi.exe`/`pi.com` use a distinct direct `compiled-host` route; arbitrary native app executables do not. This is mechanics, not compiled-distribution certification.
- Windows command-line quoting/UTF-16 limit logic and no-secret error behavior remain unchanged.
- Delegate SDK fake-child setup now creates the equivalent scoped named Pi host package, points `process.argv[1]` at its declared CJS bin, gives PATH only empty directories, restores argv/env, and asserts the child entry. It has no Windows skip and no production test hook.

## Red evidence

Mechanical environment for all substantive commands: task-owned `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/launcher`, with `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

| Command | Baseline result |
|---|---|
| `tsx --test tests/unit/pi-launch.test.ts` after test changes, before production | exit 1; 22 tests: 6 pass / 16 fail. Missing PATH verification/canonical inspection, POSIX host identity, Windows host walk/precedence, exact package identity, compiled distinction, and boundary checks. |
| `tsx --test --test-concurrency=1 tests/sdk/delegate-sdk.test.ts` with named-host/no-PATH fixture, before production | exit 1; 13 tests: 7 pass / 6 fail. Child launch was `spawn pi ENOENT`, matching the fixture/Windows-equivalent gap. |

Logs: `reports/launcher-evidence/red-launcher-unit.log`, `red-delegate-sdk.log`.

## Green evidence

| Command | Result |
|---|---|
| `./node_modules/.bin/tsx --test tests/unit/pi-launch.test.ts` | exit 0; 22/22 |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/delegate-sdk.test.ts` | exit 0; 13/13 |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/fusion-sdk.test.ts` | exit 0; 11/11 |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/sdk.test.ts` | exit 0; 18/18 |
| `./node_modules/.bin/tsx --test tests/rpc/rpc.test.ts tests/rpc/fusion-rpc.test.ts` | exit 0; 10/10 |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/scripted-provider/delegate-child-guard.test.ts tests/scripted-provider/fusion-reason.test.ts` | exit 0; 17/17 |
| `./node_modules/.bin/tsx --test tests/unit/fusion-pi-child.test.ts` | exit 0; 72/72 (after retaining bare POSIX spawn compatibility) |
| `tsx --eval` resolver probe with PATH intentionally empty and host `/usr/local/bin/pi` | exit 0; resolved Node + `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js` as `package-node-cli` |
| `tsc --noEmit -p <task-owned launcher-only config>` | exit 0 |
| `npm run typecheck` (final tree after the concurrent B0 worker exited) | exit 0 |
| `git diff --check HEAD^ HEAD` | exit 0 |

Final bounded logs are under `/private/tmp/pi-bg-closeout-iNoltL/reports/launcher-evidence/`.

Additional honest controls:

- `tests/windows/windows-integration.test.ts` was invoked on macOS and exited 1 with 0/9 because every case requires `win32`; this is environment evidence, not a product regression or a skip/pass.
- One exploratory full `test:unit` invocation reached the expected generated-doc freshness failure after the authored doc edit and was killed at the 300s harness bound before completion. Generated docs were intentionally not regenerated per lane ownership. Focused relevant unit/SDK/RPC/scripted gates above are complete.
- One full-tree typecheck during an active parent-owned B0 rewrite exited 2 on incomplete `tests/helpers/typescript-source-guards.ts` symbols. L1's isolated strict typecheck stayed green, the parent edit settled, and the post-commit full package typecheck exited 0.
- An initial Fusion child unit run exposed an existing consumer assertion requiring bare `pi`; it failed one case and then hit the harness timeout because that failed case left its fake child unsettled. The implementation was corrected to validate a concrete PATH executable while preserving the established bare spawn contract; the complete file then passed 72/72.

## Qualification limits and reviewer attack points

- **No native Windows certification.** Windows discovery, argv, package layouts, native bins, and drive/UNC rejection are fixture/mocked branches. The real Windows suite explicitly refused to run on Darwin.
- **No vendor compiled-Pi certification.** Compiled-host branches are mocked. Bun 1.3.4 was not used to conflate this work with attribution-forwarding #19.
- The POSIX compatibility choice returns bare `pi` after validation. Validation and production spawn use the same process PATH, but a validation-to-spawn PATH mutation remains a narrow TOCTOU reviewer target.
- Exact host/bin canonical equality is intentionally stricter than merely finding any JS file inside the Pi package. Review wrappers/rebranded launchers against that policy.
- Windows host-first precedence is intentional: an exact running host wins over a module-visible peer copy; a foreign SDK host may use modules; malformed boundaries and claimed-Pi invalid bins fail hard. Review that three-way classification closely.
- Compiled host identity is necessarily weaker than package identity and is limited to Bun virtual script shape or the executable basename `pi`; review whether a future official distribution uses another basename/virtual path.
- The delegate SDK fixture mutates process-wide `process.argv[1]`; the suite is explicitly non-concurrent and the package SDK command uses test concurrency 1, with restoration in teardown.
- The existing forbidden Fusion SDK file still contains its pre-existing native-Windows PATH-fixture skip. This lane did not broaden or add that skip; its named fake package resolver case and all 11 macOS Fusion SDK cases pass. Native-Windows Fusion SDK qualification remains an integrator/platform dependency.
- Authored-doc generated hash/provenance is intentionally stale until the integrator runs the docs engine and independent review; no self-attestation was generated.

## Cleanup

- Removed exact task-owned mechanical directories `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/launcher` after checks; the first inventory held about 10 MiB + 36 KiB + 8 KiB and 253 fixture/cache files. A post-amend rerun recreated about 4.5 MiB of TMP residue, which was also removed.
- Retained 20 bounded evidence logs (about 144 KiB) plus `design.md` and this report. No tarball, install cache, dependency copy/symlink, auxiliary worktree, or branch was created.
- Final process inventory found zero live L1 test/fake-child processes. The authorized launcher worker itself and parent-owned workers were not treated as disposable children.
- Final Git status contains only parent-owned B0/testing/maintenance dirt and review dossier files; all four L1 paths are committed and clean.
