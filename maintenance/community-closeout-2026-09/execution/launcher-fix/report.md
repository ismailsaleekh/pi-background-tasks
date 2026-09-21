# L1 launcher independent-review correction report

Status: **implemented, committed, and ready for targeted independent review**.

## Commit and owned paths

Follow-up commit:

- `6c314ab3eb2c6835b2d81b8db8a29a419315e9e2` — `fix(core): bind verified Pi child launch targets`
- Parent: `0a69a4fbf8a011db0bf761d3026105d7aefd1e16`
- Reviewed launcher commit `8550a1a61ef7a9915d7c3a372b342451b80c806b` remains an ancestor (`git merge-base --is-ancestor` exit 0), preserving its PR #9/#23 contributor credit.

Committed paths only:

- `src/core/pi-launch.ts`
- `tests/unit/pi-launch.test.ts`
- `tests/sdk/delegate-sdk.test.ts`
- `tests/unit/fusion-pi-child.test.ts`
- `docs/subsystems/child-launch-durability-and-safety.md`

Final SHA-256 values:

| Path | SHA-256 |
|---|---|
| `src/core/pi-launch.ts` | `69e751caa70cb67109b9fb2990b7e06de5e5fd971ea47f608662ebb3ef6be85d` |
| `tests/unit/pi-launch.test.ts` | `1f511d5075fa476b3c00617b4392777cda6ae0dabac9ba75f96a2d0c4748121e` |
| `tests/sdk/delegate-sdk.test.ts` | `2a81b4a2bbd9c05875008a72ba611bdbf26bc6c2a48b27fa92dbcefbf6cc40d4` |
| `tests/unit/fusion-pi-child.test.ts` | `6631044220c4359fb3644a8f3c03cc56514a3bf7d85ab5fa6de62134fc2f7485` |
| `docs/subsystems/child-launch-durability-and-safety.md` | `a7d6d8350683263245ceb1297bf71ad0a3df794d12426e484c9d1ded70b4c9ac` |

The index was empty before staging. Only these five paths were staged explicitly. Parent/B0/F1/maintenance dirty and untracked work remains unstaged and preserved. No amend, reset, rebase, history rewrite, parent-repository edit, install, network/GitHub action, push, publish, generated-doc edit, or attestation was performed.

## Finding-by-finding correction

### L1-1 HIGH — admitted PATH identity is now the spawn identity

- POSIX PATH search still walks entries in order, canonicalizes each candidate, requires a regular file and `X_OK`, and skips invalid entries.
- Success now returns the exact canonical absolute `candidateReal` as `launch.executable`; it never discards that identity for bare `pi`.
- Existing callers already pass `launch.executable` and `piLaunchArgv()` directly to shell-free `spawn`, so no out-of-scope caller/API edit was needed.
- Structured argv is retained. The durable subprocess test passes arguments containing spaces and shell syntax literally.
- The Fusion consumer's old bare-name assertion now uses an independently created executable fixture and checks its canonical target. It closes/settles the fake child before assertions, so a regression produces a terminal TAP summary rather than a 300-second hang.

**Actual spawn proof:** `postfix-adversarial.log` records an admitted canonical path under `admitted/bin/pi`. A shell-free spawn with the same relative PATH string `bin` under a different child cwd printed `ADMITTED:literal value`; another spawn with PATH changed to a different absolute bin directory also printed `ADMITTED:literal value`. Neither `CHILD` nor `CHANGED` was selected.

### L1-2 — Bun virtual shape no longer authorizes arbitrary compiled applications

- `/$bunfs/root/...` is no longer considered identity evidence.
- The direct `compiled-host` route is limited to a non-generic executable whose basename explicitly claims the established Pi CLI name: `pi` on POSIX, `pi.exe`/`pi.com` on Windows, followed by existing canonical file and execute/native-extension checks.
- An arbitrarily named compiled SDK application falls through to host/package discovery. With a valid installed JS Pi package but no generic JS runtime, it refuses loudly rather than relaunching the application.
- Authored prose states the limitation truthfully: renamed compiled binaries are not claimed, and fixture mechanics are not vendor-binary certification.

The post-fix probe observed one exact-package lookup for `custom-sdk-application` and then `pi_executable_resolution_failed` because that application was not a generic JS runtime; it was never returned as `compiled-host`.

### L1-3 — source realpath I/O/integrity failures are hard

- `LaunchPathOperationError` retains the original cause.
- Only `ENOENT`/`ENOTDIR` source absence is classified as `HostIsNotPi`; `EACCES`, `EIO`, and other source-realpath failures remain fatal.
- Manifest/bin/name/containment failures after a Pi host is identified remain fatal as before.
- The injected Windows fixture verifies `EACCES` and `EIO` separately and proves zero module lookups.

The post-fix probe records `moduleLookups: 0` and the original source-realpath/access-denied diagnostic.

### L1-4 — exact installed-package route is available to POSIX SDK hosts

- After POSIX PATH admission fails, POSIX and Windows now share host-first classification.
- A verified running Pi host remains authoritative.
- A genuinely absent or foreign host may use the exact module route: direct `@earendil-works/pi-coding-agent/package.json`, or package entry plus nearest named-manifest walk.
- Existing exact package name, canonical root/bin containment, regular-file, extension, host/bin equality, and generic-runtime checks remain unchanged.
- Positive and wrong-name negative POSIX SDK layouts use explicit host paths and resolver fixtures; they do not impersonate Pi through global `process.argv`.
- Broken host authority never reaches module fallback.

The post-fix probe used a foreign Node SDK host, made exactly one package lookup, and returned Node plus the independently canonicalized installed Pi CLI.

### L1-5 — delegate SDK fixture restores all process globals

- The harness now snapshots/restores `PATH`, `PI_BG_DELEGATE_FAKE_SCENARIO`, `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY`, `CI`, and `process.argv[1]`.
- Restoration is idempotent, runs on setup failure, and is nested so it still runs if session disposal throws.
- A non-concurrent regression uses sentinel values deliberately different from the mandated outer environment, checks normal disposal, forces failure after mutation, and checks failure teardown.

The independent same-process wrapper failed before the fix because `PI_OFFLINE` remained `1`; after the fix it completed with 14/14.

## RED evidence

Common mechanical environment for substantive checks:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/launcher-fix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/launcher-fix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/launcher-fix
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

Absolute package tool paths were used.

| Command | Exit / result |
|---|---:|
| `tsx reports/launcher-review/repros/resolver-adversarial.mts` against reviewed bytes | 0; all four adverse assertions reproduced |
| `tsx --test --test-concurrency=1 reports/launcher-fix/repro-env-restore.mts` against reviewed bytes | 1; 13 pass / 1 fail; leaked `PI_OFFLINE=1` instead of sentinel |
| `tsx --test tests/unit/pi-launch.test.ts` after new tests, before production edit | 1; 26 total, 18 pass / 8 fail |
| `tsx --test --test-concurrency=1 tests/sdk/delegate-sdk.test.ts` before restoration edit | 1; 14 total, 13 pass / 1 fail; all four shared keys shown leaked |
| `tsx --test --test-name-pattern='pipes the prompt through stdin' tests/unit/fusion-pi-child.test.ts` before production edit | 1; 0/1; actual command `pi`, expected canonical fixture path; terminal TAP summary present |

Logs: `baseline-adversarial.log`, `baseline-env-restore.log`, `red-launcher-unit.log`, `red-delegate-env-restore.log`, and `red-fusion-pinned-consumer.log`.

## GREEN verification

| Command | Exit / result |
|---|---:|
| `tsx --test tests/unit/pi-launch.test.ts` | 0; 26/26 |
| `tsx --test --test-concurrency=1 tests/sdk/delegate-sdk.test.ts` | 0; 14/14 |
| `tsx --test tests/unit/fusion-pi-child.test.ts` | 0; 72/72, terminal TAP summary |
| `tsx --test --test-concurrency=1 tests/sdk/fusion-sdk.test.ts` | 0; 11/11 |
| `tsx --test --test-concurrency=1 tests/sdk/sdk.test.ts` | 0; 18/18 |
| `tsx --test tests/rpc/rpc.test.ts tests/rpc/fusion-rpc.test.ts` | 0; 10/10 |
| `tsx --test --test-concurrency=1 tests/scripted-provider/delegate-child-guard.test.ts tests/scripted-provider/fusion-reason.test.ts` | 0; 17/17 |
| `tsx --test --test-concurrency=1 reports/launcher-fix/repro-env-restore.mts` | 0; 14/14 |
| `tsx reports/launcher-fix/postfix-adversarial.mts` | 0; four corrected cases asserted, including two real POSIX spawns |
| `tsx --eval ...resolvePiLaunch({ path:'', hostScript:'/usr/local/bin/pi' })` | 0; real global Pi 0.86 host resolved to Node + canonical `dist/bundle/cli.js` |
| `tsc --noEmit --pretty false -p <package>/tsconfig.json` | 0 |
| `git diff --check` on owned diff and on `HEAD^..HEAD` | 0 |
| Frozen evidence `shasum -a 256 -c evidence/SHA256SUMS` | 0; 49/49 |

Final logs are retained under `/private/tmp/pi-bg-closeout-iNoltL/reports/launcher-fix/`. The full-tree typecheck was stable and green; the warned F1 `TS2532` condition was not present in the final tree, so no scoped workaround or out-of-scope edit was required.

## Qualification limits

- Host: Darwin 24.6.0 arm64, Node 24.16.0, Bun 1.3.4.
- The PATH identity regression and post-fix proof used real local POSIX subprocesses and filesystem paths.
- Windows host classification, package layout, and native-bin behavior remain injected/mocked on Darwin. **No native-Windows certification claim.**
- Compiled-host coverage is filesystem fixture-only. No vendor compiled Pi was available or executed, and no renamed compiled binary support is claimed.
- Delegate/Fusion SDK and scripted checks use deterministic fake/no-network children; no real model/provider request, real user auth, or user session state was used.
- The pre-existing native-Windows Fusion SDK skip remains unchanged qualification debt; no skip was added or broadened.
- Generated documentation is known integrator-owned/stale after authored prose changes. No generated file was hand-edited, no docs attestation was created, and docs freshness is not claimed here.
- No out-of-scope API dependency was encountered. All production callers already honor the returned launch plan.

## Cleanup and boundary

- Effective injected route throughout: `openai-codex/gpt-5.6-sol/max`.
- Peak retained task roots before cleanup: about 6.3 MiB TMP, 8 KiB agent, 140 files; below the 300 MiB limit.
- Exact task-owned `tmp/launcher-fix`, `home/launcher-fix`, and `agent/launcher-fix` roots were removed.
- Retained reports/probes including this final report: 28 files, about 144 KiB (the cleanup snapshot itself recorded 27 files/132 KiB before this report was written).
- Process inventory before and after cleanup found **zero** live launcher unit, delegate SDK fake-child, Fusion child test, or adversarial-probe processes. The authorized launcher worker itself was not treated as disposable test residue.
- The five owned package paths are clean after commit. All unrelated dirty/untracked work remains present and unstaged.

Stop point: targeted independent review of commit `6c314ab3eb2c6835b2d81b8db8a29a419315e9e2`.
