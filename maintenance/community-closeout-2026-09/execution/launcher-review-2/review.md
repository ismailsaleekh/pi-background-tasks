# Targeted independent L1 correction review — `6c314ab`

## Verdict

**PASS — all five reviewed findings are resolved; no remaining in-scope severity finding.**

I reviewed correction commit `6c314ab3eb2c6835b2d81b8db8a29a419315e9e2` against the previously reviewed launcher bytes at `8550a1a61ef7a9915d7c3a372b342451b80c806b`, restricted to the frozen five paths. The intervening B0/F1 commits are disjoint from those paths. I made no package source, docs, tests, index, history, or semantic-attestation changes.

## Finding-by-finding disposition

### L1-1 HIGH — resolved: PATH admission is bound to the spawned object

- `resolveExecutableOnPosixPath()` still walks PATH in order, canonicalizes each candidate, requires a regular file and `X_OK`, and skips missing, non-file, and non-executable candidates (`src/core/pi-launch.ts:421-455`).
- The successful plan now returns `candidateReal`, not bare `pi` (`src/core/pi-launch.ts:451`).
- Existing production consumers preserve the plan without reconstructing the command: delegate (`src/core/registry.ts:1107,1147`), Fusion (`src/core/fusion/pi-child.ts:1941-1943`), attested Pi (`src/core/attested-pi-run.ts:480-482`), and the telemetry wrapper (`src/core/registry.ts:492-494`). All remain shell-free and append arguments structurally through `piLaunchArgv()`.
- The independent real-POSIX probe used a relative PATH containing missing, directory, non-executable, and symlink candidates. Resolution returned the symlink target's canonical absolute path. Spawning from a different cwd with the same relative PATH and spawning with an entirely changed PATH both printed `PINNED|argument with spaces|$(printf must-not-run)` from the admitted target.
- `tests/unit/pi-launch.test.ts:113-242` independently covers canonical return, invalid-candidate order, symlink canonicalization, different child cwd, changed environment PATH, and literal argv.

This is a pathname/launch-plan identity contract. It correctly does **not** claim protection against a malicious replacement of the canonical filesystem object after admission.

### L1-2 MEDIUM — resolved: Bun virtual paths no longer establish Pi identity

- Direct compiled-host authority now requires the non-generic executable basename to be exactly `pi` on POSIX or `pi.exe`/`pi.com` on Windows; regular-file plus POSIX `X_OK`/Windows native-extension checks remain (`src/core/pi-launch.ts:313-351`). The `/$bunfs/root/...` shape is no longer an authority input.
- In the independent probe, `custom-compiled-sdk` plus a Bun virtual script performed one exact package lookup, then refused because that foreign executable is not a generic JS runtime. It was never returned as `compiled-host` or relaunched with Pi CLI argv. An executable actually named `pi` resolved to its canonical direct route.
- The module route can still launch a verified package-native `.exe`/`.com` on Windows or a JS bin through a generic Node/NodeJS/Bun runtime; it cannot use the arbitrary compiled application as that runtime (`src/core/pi-launch.ts:353-417`).
- The owning prose explicitly says virtual paths grant no authority, renamed compiled Pi binaries are unsupported, and fixture mechanics are not vendor certification (`docs/subsystems/child-launch-durability-and-safety.md:36`).

### L1-3 MEDIUM — resolved: Windows host I/O failures remain hard

- `LaunchPathOperationError` retains the underlying path cause (`src/core/pi-launch.ts:93-105`). Only source-realpath `ENOENT`/`ENOTDIR` is converted to `HostIsNotPiError`; `EACCES`, `EIO`, and other failures propagate to `PiLaunchResolutionError` (`src/core/pi-launch.ts:230-246`).
- Host-first resolution permits the module route only for deliberate absent/foreign classification. Once a named Pi host is found, malformed manifests, invalid bins, containment failures, and host/bin mismatch remain fatal (`src/core/pi-launch.ts:458-500`).
- The independent injected-win32 probe tested `EACCES` and `EIO` separately: both were loud and performed **zero** module lookups. A genuine `ENOENT` source performed one exact lookup and succeeded. A source that reached an exact named Pi manifest with a missing declared bin failed with **zero** module lookups.
- Unit coverage is at `tests/unit/pi-launch.test.ts:485-522`, with existing claimed-host integrity coverage immediately following it.

### L1-4 MEDIUM — resolved: POSIX embedded SDK hosts can use the exact package route

- After POSIX PATH failure, both platforms perform host-first classification and then share `resolvePiManifestFromModules()` (`src/core/pi-launch.ts:276-310,458-500`).
- Common package validation still requires the exact package name, relative and canonically contained bin, regular target, supported extension/native form, and a generic runtime for JS (`src/core/pi-launch.ts:353-417`).
- The independent foreign-POSIX-host probe made exactly one `@earendil-works/pi-coding-agent/package.json` lookup and returned Node plus the independently canonicalized package CLI. `process.argv[1]` remained the unrelated sentinel `/reviewer/sentinel-sdk-host.js`; no argv impersonation was needed.
- Independent wrong-name and `../` escaping-bin controls both rejected. Unit coverage is at `tests/unit/pi-launch.test.ts:373-438`.
- This matches Pi 0.86's documented SDK embedding model (`docs/sdk.md` and `examples/sdk/*`) and its package shape (`bin.pi = dist/bundle/cli.js`; package root export plus package-entry fallback).

### L1-5 LOW — resolved: delegate fixture process globals are transactional

- The harness snapshots and restores PATH, fake scenario, `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY`, `CI`, and `process.argv[1]` (`tests/sdk/delegate-sdk.test.ts:149-236`). Restoration is idempotent and runs on setup failure.
- `dispose()` uses nested `finally` blocks, so restoration runs if shutdown or session disposal fails (`tests/sdk/delegate-sdk.test.ts:261-270`).
- The permanent non-concurrent regression uses sentinel values deliberately different from the mandated outer values and checks normal disposal plus failure after global mutation (`tests/sdk/delegate-sdk.test.ts:395-466`).
- My same-process wrapper independently installed different sentinels for all six environment keys plus argv, imported the complete suite, and observed the exact sentinels afterward: exit 0, 14/14.

## Fusion consumer regression

The former bare-name implementation assertion is gone. The consumer creates its own executable fixture, injects its PATH, and compares the spawn command to `realpathSync(admittedPi)` (`tests/unit/fusion-pi-child.test.ts:1693-1761`). It closes the fake child before awaiting the run and before command assertions, so a command regression reaches a terminal TAP failure instead of stranding timeout handles. My complete run ended normally at 72/72.

A repository search found no remaining test assertion requiring a bare `pi`; the only Fusion command assertions are the canonical fixture target and the intentional Windows Node package route.

## Independent execution

Common environment for every substantive execution:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/launcher-review-2
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/launcher-review-2
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/launcher-review-2
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

Absolute package-local tool paths were used.

| Command | Exit / observed result |
|---|---:|
| `tsx --test tests/unit/pi-launch.test.ts` | 0; 26/26, 0 skipped |
| `tsx --test --test-concurrency=1 tests/sdk/delegate-sdk.test.ts` | 0; 14/14, 0 skipped |
| `tsx --test tests/unit/fusion-pi-child.test.ts` | 0; 72/72, terminal TAP summary, 0 skipped |
| `tsx reports/launcher-review-2/probes/launcher-corrections.mts` | 0; six corrected observations covering L1-1 through L1-4 |
| `tsx --test --test-concurrency=1 reports/launcher-review-2/probes/delegate-global-restore.mts` | 0; 14/14 plus exact outer-sentinel assertion |
| `tsc --noEmit --pretty false -p <package>/tsconfig.json` | 0 |
| `shasum -a 256 -c maintenance/.../evidence/SHA256SUMS` | 0; 49/49 |
| `shasum -a 256 -c reports/launcher-review-2/expected-five.sha256` | 0; 5/5 |
| `git diff --check 8550a1a..6c314ab -- <five paths>` | 0 |
| `git diff --exit-code 6c314ab..HEAD -- <five paths>` | 0; empty |

Logs and probe sources are under `/private/tmp/pi-bg-closeout-iNoltL/reports/launcher-review-2/`.

### Red/green evidence inspected

The correction worker's preserved RED evidence is coherent with the source delta:

- original four-case adverse probe: exit 0, all old failures reproduced;
- outer-sentinel env repro: exit 1, 13 pass / 1 fail;
- new launcher cases against old production: exit 1, 18 pass / 8 fail;
- delegate restoration regression against old fixture: exit 1, 13 pass / 1 fail;
- pinned Fusion consumer against old production: exit 1, 0 pass / 1 fail **with a terminal TAP summary**.

Its retained GREEN logs record launcher 26/26, delegate 14/14, Fusion child 72/72, Fusion SDK 11/11, ordinary SDK 18/18, RPC 10/10, and scripted child 17/17, all exit 0. I independently reran the required 26/14/72 and adverse cases. I did not run broader suites because no concrete issue emerged.

## Frozen boundary and hashes

Correction commit `6c314ab` itself contains exactly the five frozen paths. Initial review HEAD was `7628f4d`; concurrent authorized work advanced HEAD first to `f8d74b9c308dabd6a1c7bc8e3a9bf1472feaadf0` (unrelated package-test paths) and then to merge `bc25e9a8d8be74bd38899e56bb7ab2266629969c` (independently reviewed attribution repairs). The frozen five remained clean, byte-identical to `6c314ab`, and unchanged in `6c314ab..HEAD`.

| Frozen path | SHA-256 |
|---|---|
| `src/core/pi-launch.ts` | `69e751caa70cb67109b9fb2990b7e06de5e5fd971ea47f608662ebb3ef6be85d` |
| `tests/unit/pi-launch.test.ts` | `1f511d5075fa476b3c00617b4392777cda6ae0dabac9ba75f96a2d0c4748121e` |
| `tests/sdk/delegate-sdk.test.ts` | `2a81b4a2bbd9c05875008a72ba611bdbf26bc6c2a48b27fa92dbcefbf6cc40d4` |
| `tests/unit/fusion-pi-child.test.ts` | `6631044220c4359fb3644a8f3c03cc56514a3bf7d85ab5fa6de62134fc2f7485` |
| `docs/subsystems/child-launch-durability-and-safety.md` | `a7d6d8350683263245ceb1297bf71ad0a3df794d12426e484c9d1ded70b4c9ac` |

## Qualification limits

- Host evidence: Darwin 24.6.0 arm64, Node 24.16.0, TypeScript 5.9.3, Bun 1.3.4.
- POSIX PATH identity used real files, permissions, symlinks, and real shell-free subprocesses.
- Windows discovery, error classification, native-bin rules, and argv behavior were injected/mocked on Darwin. **No native-Windows certification.**
- The pre-existing native-Windows Fusion SDK PATH-fixture skip at `tests/sdk/fusion-sdk.test.ts:75-82` remains unchanged qualification debt. No skip was added or broadened.
- Compiled-host checks used filesystem fixtures. No vendor compiled Pi was available or executed; renamed vendor binaries are explicitly unsupported, not certified.
- SDK/Fusion checks used deterministic fake children. No model/provider request, network access, real user auth, or real user session state was used.
- No docs attestation or semantic stamp was created.

## Route, scratch, and cleanup

- Effective injected route: `openai-codex/gpt-5.6-sol/max`.
- Peak retained review scratch before cleanup: about 4.9 MiB TMP plus 192 KiB reports; below the 150 MiB cap.
- Exact task-owned TMP/HOME/agent roots were removed. Reports/probes were retained.
- Process inventory before and after cleanup found zero owned launcher/delegate/Fusion test or probe processes. The authorized outer Pi/telemetry-wrapper process was not treated as disposable child residue.
- Final frozen-path worktree status and diff are empty.

Stop point: verified review only; no fixes or semantic stamps.
