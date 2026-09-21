# L1 launcher design (written before code changes)

## Route and constraints observed

- Effective worker route was verified before substantive work: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`; `GIT_ALLOW_PROTOCOL=file` remains set.
- Frozen evidence hashes: 49/49 OK when checked from `maintenance/community-closeout-2026-09`.
- Source base: `1b3d48d833554ced807c729cab354dd7cc73b79d` in the primary package checkout. The pre-existing dirty `maintenance/community-closeout-2026-09/STATE.md` is parent-owned and will not be staged or edited.
- Native Windows is unavailable. Windows branches and installed-layout behavior will be fixture/mocked evidence only, not platform certification. Bun 1.3.4 is unrelated to this resolver slice and will not be used to claim the attribution-forwarding/compiled-Bun work in #19.

## Chosen launch policy

Resolution is one policy with platform-specific safe routes, not PR #9 and PR #23 pasted as independent fallbacks.

1. **Compiled host is a distinct route.** A non-generic runtime executable paired with either a Bun virtual host script (`/$bunfs/root/...`) or an executable basename `pi` (`pi.exe`/`pi.com` on Windows) is relaunched directly as a canonical regular executable (`compiled-host`), rather than incorrectly passing a virtual JavaScript path to that executable. Other arbitrary native hosts are not accepted. Generic runtimes are `node`, `nodejs`, or `bun` (including `.exe`). POSIX additionally requires execute access. This branch is unit-characterized only and is not compiled-Bun certification.
2. **POSIX PATH is preferred, but verified.** Search PATH entries in order for `pi`; each candidate must realpath successfully, be a regular file, and pass `X_OK`. Invalid/non-executable candidates are diagnosed and skipped so a later valid candidate can win. After validating the concrete canonical candidate, retain the established bare `pi` spawn shape so existing consumers and the real process PATH contract remain compatible.
3. **POSIX host fallback is package-verified.** If no PATH candidate is executable, canonicalize the running host script, walk upward, skip only valid nameless sub-manifests, stop at the nearest named package boundary, and require exact package name `@earendil-works/pi-coding-agent`. Malformed, unreadable, non-object, or malformed-name manifests are hard boundary failures rather than permission to walk outward. Resolve and validate that manifest's `bin.pi`; the canonical host script must equal the canonical bin target. Thus an arbitrary `.js/.cjs/.mjs` host is never accepted merely for its extension.
4. **Windows never uses PATH shims.** First inspect the running host using the same exact named-package policy. A valid running Pi host is authoritative and supports the global-Pi/extension-prefix layout from PR #23. A host that is simply foreign/not Pi allows the existing SDK/module route; a host manifest claiming to be Pi but having invalid identity/bin/containment is a hard failure and is not silently replaced by another installation.
5. **Windows module fallback remains for SDK/embedded hosts.** Resolve the Pi manifest directly, then (only if direct resolution is unavailable) resolve the package entry and walk to its nearest named manifest. Every accepted manifest, including direct module results, must contain the exact Pi package name. Invalid resolved manifests do not silently fall through.
6. **Common package validation.** Canonicalize manifest/package root and bin target; require exact package identity and a nonblank npm `bin` string or `bin.pi`; reject absolute/escaping targets; require target containment and a regular file. JavaScript targets (`.js/.cjs/.mjs`) run as structured argv through a generic runtime. Windows `.exe/.com` package bins run directly with an empty argv prefix while retaining the historical `package-node-cli` kind for compatibility; `.cmd/.bat/.ps1` remain rejected (no shell interpolation). Host-derived routes require canonical host/bin equality. Symlinks are judged by canonical destinations.
7. **Arguments remain arrays.** `piLaunchArgv()` remains concatenation-only. Windows command-line accounting continues to quote the exact executable/prefix/args and enforce 32,767 UTF-16 units without including argument contents in errors. Paths containing spaces and quotes are tests, not string-built shell commands.
8. **Failure policy.** Resolution remains `pi_executable_resolution_failed`; diagnostics identify attempted PATH/host/module routes. There is no route/model substitution, invalid override fallback, or shell fallback.

This precedence deliberately makes the actual recognized Pi host authoritative on Windows, while preserving module resolution for legitimate non-Pi SDK hosts. On POSIX, module proximity alone is not enough to turn an arbitrary application script into Pi: after PATH, only a verified running Pi package (or the explicit compiled-host shape) is accepted.

## Test and fixture plan (red first)

### Unit red cases in `tests/unit/pi-launch.test.ts`

- POSIX executable PATH candidate wins and is canonical.
- A non-executable first `pi` is skipped; a later executable candidate wins.
- PATH symlink resolves to its canonical executable target.
- No-PATH host symlink succeeds only when it resolves to the exact `bin.pi` of a correctly named Pi package.
- Arbitrary JavaScript host, foreign nearest named package, host script other than declared bin, malformed/unreadable/non-object/name-malformed manifests, and an inner named package boundary fail closed.
- A valid nameless `dist/package.json` is skipped to the named Pi package.
- Direct/module and host manifests both reject wrong package names.
- Missing/malformed bin, absolute/escaping bin, symlink escape, non-file target, unsupported shim/script extension, and non-generic runtime plus JS target fail.
- Canonical in-package bin symlinks succeed.
- Windows host discovery wins over a different module installation; foreign host can use a valid named module package; a broken claimed Pi host cannot silently use it.
- Native `.exe/.com` and mocked Bun virtual compiled-host routes remain distinct.
- Spaced/quoted paths remain separate argv elements and command-length rendering accepts them without interpolation.

Expected baseline red: new POSIX PATH validation/host identity tests and Windows host-walk/identity/precedence tests fail against `1b3d48d`; existing production accepts bare POSIX `pi`, lacks host discovery, and does not check manifest name.

### SDK fake-child red case in `tests/sdk/delegate-sdk.test.ts`

Replace the PATH-only delegate fake installation with an equivalent host installation under a genuine test `@earendil-works/pi-coding-agent/package.json` whose `bin.pi` points at the fake child. Save/restore `process.argv[1]`, point it at that package bin, and deliberately provide no executable `pi` on PATH. Existing end-to-end delegate launch/result cases then exercise the production host-package route on POSIX now and the same route on native Windows when available. There is no production test hook and no Windows skip.

Expected baseline red: the successful delegate child cases fail to spawn because baseline POSIX blindly returns bare `pi` from the empty fixture PATH; baseline Windows ignores fake PATH and resolves another package.

### Exact fixture ownership before editing

Planned fixture/test edits:

- `tests/sdk/delegate-sdk.test.ts` — install/activate/restore the named fake host package and use `node:path.delimiter`.
- No new helper file is currently necessary.
- `tests/helpers/fusion-fake-pi.ts` was inspected and will remain unchanged: it already creates a correctly named package + `bin.pi` and exposes a resolver seam used by its existing launcher unit in `fusion-sdk.test.ts`. The forbidden `tests/sdk/fusion-sdk.test.ts` will not be edited.
- No RPC/scripted-provider helper is planned for modification. Those suites will be run as consumers after the resolver change. If an unforeseen fixture seam proves necessary, this report will be amended with the exact path before that file is edited.

Production/doc edits are limited to:

- `src/core/pi-launch.ts`
- `tests/unit/pi-launch.test.ts`
- `tests/sdk/delegate-sdk.test.ts`
- `docs/subsystems/child-launch-durability-and-safety.md`

No B0 file, package manifest/lock, generated doc, registry/caller/facade, `tests/sdk/{sdk,fusion-sdk}.test.ts`, package test, `TESTING.md`, `TEST_PLAN.md`, or maintenance state file will be edited.

## Planned evidence commands

All commands use task-owned `TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/launcher`, `HOME=/private/tmp/pi-bg-closeout-iNoltL/home/launcher`, `PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/launcher`, plus `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1` and inherited `GIT_ALLOW_PROTOCOL=file`.

1. Red: focused launcher unit file after adding cases, before production edit.
2. Red: focused delegate SDK file with named-host/no-PATH fixture, before production edit.
3. Green: launcher unit, then delegate SDK.
4. Relevant consumers: Fusion SDK (unchanged), RPC (`rpc.test.ts` and `fusion-rpc.test.ts`), and scripted child fixtures (`delegate-child-guard.test.ts`, `fusion-reason.test.ts`, plus focused Fusion child tests if needed).
5. `npm run typecheck`, `git diff --check`, owned-path/status review.

Logs will be bounded under `/private/tmp/pi-bg-closeout-iNoltL/reports/launcher-evidence/`; temporary fixture roots are test-cleaned and task-owned HOME/TMP/agent caches will be removed after evidence is retained.

## Contributor credit

The coherent local commit will preserve both sources of reused work:

- PR #9, head `b3711557859f2f2624c27d4264c89cdb75b317e5`, GitHub author `tickernelz`, commit author `Zhafron <zhafronadani@gmail.com>`.
- PR #23, head `6aa4d58adbea9187eda1666d0c41e271471c2d51`, GitHub author `boggylp`, commit author `Bogambe <bogambe@gmail.com>`.

The commit message will name both PR/head SHAs and include co-author trailers for the original commit authors.
