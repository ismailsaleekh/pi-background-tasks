# Independent npm 10/11 offline-fixture review

## Verdict

**CHANGES REQUESTED — one MEDIUM portability finding remains in the permanent npm-version characterization.**

The lifecycle-free archive implementation itself passed on both required runtime pairs. It uses the same public `tar.c()` path, preserved the real Turndown/Domino closure, executed no hook, and completed the closed-server offline consumer flow. The remaining issue is in the sentinel assertion: every npm 10 release is required to retain npm 10.9.3's upstream bug, so a future fixed npm 10 would fail the package/default gate despite exhibiting the safe behavior.

Reviewed range and route:

- Base: `3f4d4f8660aa0be9e9bcf89b71ac956c3653f240`
- Target: `3eb14782d84487998b507321b2b742c1366d8791`
- Main at substantive start: `ab474d649274b6722abe7ed290c3f51c72236f69`
- Final main observed: `7bca31b7ca6c040076a2fa1ac8d397a5a12d4bfa` (`test(docs): align EventBus close contract guard`), a one-path disjoint commit
- Effective route: `openai-codex/gpt-5.6-sol`, reasoning `max`
- Target parent is exactly the stated base. The range is exactly five paths, `+401/-64`; all five final current bytes still equal the target.

No package source, docs, tests, generated files, index, history, or semantic attestation was changed by this review.

## Finding

### MEDIUM — NFR-1 — The test requires npm 10's defect to remain present in every future npm 10

**Location:** `tests/package/package.test.ts:2325-2331,2367-2376`; exact-version claims at `docs/operations/testing.md:33`, `TESTING.md:192`, and `TEST_PLAN.md:130`.

The test reads the installed version but reduces it to only its major:

```ts
const npmMajor = Number.parseInt(npmVersion.stdout, 10);
...
if (npmMajor === 10) {
  assert.notEqual(ignoredAttempt.status, 0, 'npm 10 must expose its prepare-script defect');
  ...
  assert.deepEqual(markerEvents(), ['prepare']);
} else {
  assert.equal(ignoredAttempt.status, 0, ignoredAttempt.stderr);
  assert.deepEqual(markerEvents(), []);
}
```

This correctly characterizes installed npm `10.9.3` and `11.13.0`, but it rejects the safe outcome for any later fixed 10.x: direct `npm pack --ignore-scripts` exits 0 and creates no marker. The source-bound counterexample in `future-fixed-npm10.log` shows:

- known `10.9.3`, exit 1 + `prepare` marker: accepted;
- known `11.13.0`, exit 0 + no marker: accepted;
- hypothetical future fixed `10.10.0`, exit 0 + no marker: **rejected** with `npm 10 must expose its prepare-script defect`.

Impact is a false package/default-gate failure on a safe npm update, before the lifecycle-free helper's good path can establish its own invariant. It does not make the current helper unsafe, and both mandated versions pass, but support is incorrectly coupled to an upstream bug.

A narrow correction should key the defect expectation to exact known `10.9.3`; all other versions should accept the fully suppressed exit-0/no-marker shape and fail loudly on any unexpected lifecycle shape. The archive helper must remain version-independent and fallback-free.

## Changed-boundary review

The target changes only:

1. `tests/helpers/offline-npm-registry.ts`
2. the npm fixture sections of `tests/package/package.test.ts`
3. authored fixture prose in `docs/operations/testing.md`, `TESTING.md`, and `TEST_PLAN.md`

The helper no longer calls npm's directory-pack path for installed dependencies. Its child bridge resolves bare public `tar` relative to the absolute selected npm CLI and checks `tar.c` before using one common configuration on both versions: `package/` prefix, portable mode, gzip level 9, fixed file mtime, and nested-`node_modules` filtering. There is no npm-version branch, retry, lifecycle flag, package-manifest rewrite, dependency substitution, or Rollup installation in that path.

Installed API inspection established:

| Runtime | npm | bundled `tar` | Public surface |
|---|---:|---:|---|
| Node 22.19.0 | 10.9.3 | 6.2.1 | root `tar.c`/`tar.t` functions |
| Node 24.16.0 | 11.13.0 | 7.5.13 | exported root `tar.c`/`tar.t` functions |

Absence of the bare module or of callable `tar.c` fails the bridge and parent helper loudly; there is no fallback. The permanent test explicitly refuses npm below major 10. A custom npm distribution that does not bundle this public API is therefore unsupported loudly rather than silently routed elsewhere.

Installed npm source and the owned executable sentinel independently confirmed the root cause: npm 10.9.3 `pacote@19.0.1` calls `prepare` without an `ignoreScripts` check, while npm 11.13.0 `pacote@21.5.0` returns early; both `libnpmpack` lines separately gate `prepack`/`postpack`. npm 10's `pack` parameter list omits `ignore-scripts`; npm 11 includes it.

## Archive and hook evidence

The independent control constructed an owned package containing four files (including a 2,097,175-byte payload and executable), one directory, one symbolic link, lifecycle scripts, and a nested `node_modules` exclusion. Both npm-bundled tar implementations produced byte-identical archives:

- archive SHA-256 `065fe91965dfcbf830e266a7223a292b5835246c83c308c8993545615459998d`;
- 6 entries: 4 files, 1 directory, 1 symlink;
- every entry under `package/`, with no `node_modules`, absolute path, or `..` component;
- every regular-file byte matched source; no truncation;
- executable and non-default source modes matched tar's documented portable normalization;
- symlink type, target `payload.bin`, and mode matched;
- files/symlink used `1985-10-26T08:15:00.000Z`; portable directories omitted mtime;
- uid/gid were `0:0`, owner names empty, and gzip header mtime zero.

The real archives were also byte-identical across tar 6.2.1 and 7.5.13:

| Package | Archive bytes | Entries | Payload bytes | Archive SHA-256 |
|---|---:|---:|---:|---|
| `turndown@7.2.4` | 20,359 | 12 | 191,636 | `e32ca150ce7a799dc4e170e2eb8d225bd2683d512f5c64ac387f7a58123daba8` |
| `@mixmark-io/domino@2.2.0` | 866,266 | 1,041 | 7,736,745 | `a1b8f51d30e18e8838ac083835a48a734870cd4ae9cc80d0bbe58f820bbf8553` |

Every real source entry except the intentionally excluded root/descendant `node_modules` was compared by path, type, portable mode, bytes, link target, owner metadata, and mtime policy. The actual closure contains no symlinks. The helper's accepted aggregate source and archive payloads are each strictly below 100 MiB, and it checks archive size before reading the archive into memory.

Lifecycle results on both versions:

| Control | npm 10.9.3 | npm 11.13.0 |
|---|---|---|
| plain directory pack, fail at `postpack` | exit 1; `prepack`, `prepare`, `postpack` markers | same |
| direct `--ignore-scripts`, fail at `prepare` | exit 1; only `prepare` marker | exit 0; no marker |
| corrected archive path | no marker | no marker |
| loopback seed + closed-server offline consumer | exit 0; no marker | exit 0; no marker |

Owned negative controls additionally proved that a missing installed dependency, missing callable `tar.c`, and a tar implementation that mutates owned source all fail loudly. The source-mutation check binds names, entry types, modes, file lengths/bytes, and symlink targets, not names alone.

The synthetic archive's symlink is present and correct in both archives. npm package extraction on this macOS host omitted that synthetic link; this is recorded rather than hidden. The actual Turndown/Domino closure has zero links, so its installed consumer is unaffected. Executable mode survived installation.

## Real offline consumer and integrity

Both independent runs proved:

- a separate initially empty cache exits 1 with `ENOTCACHED` naming `turndown`;
- closure is exactly `turndown@7.2.4` and `@mixmark-io/domino@2.2.0`;
- only four loopback inputs were needed: two packuments and two exact tarballs, all HTTP 200;
- registry was closed before the final `npm install --offline`;
- final offline install exited 0;
- source and installed Turndown manifest bytes are identical, SHA-256 `333b1738ad3079742aaf7be7d8b0f0bec2661c44fb49cfeff80b66ce4cb3e040`;
- source and installed Domino manifest bytes are identical, SHA-256 `2190c3aeea2de40b2a9afcbee22d0603e91b1a490ab2e24387b251e75a5ab77a`;
- Turndown retains `prepare: "npm run build"` and `@mixmark-io/domino: "^2.2.0"`;
- Domino loads and real conversion returns `Offline ... closure loaded`.

Independent pre/post closure snapshots were identical:

| Source | Entries including root | Payload bytes | SHA-256 |
|---|---:|---:|---|
| Turndown | 3 directories, 10 files | 191,636 | `139fa516c537083e3ab4a1434177779f126e4c00caeebfa81e0cae71c337c0b0` |
| Domino | 19 directories, 1,023 files | 7,736,745 | `7df48fdd3889aee84cc9ed9562be9bf4960d2abd623231f45d35fc4e84b186dc` |

The correction worker's broader receipts were inspected, not rerun: full package file 35/35 on each runtime, safety 4/4 on each, typecheck exit 0 on each, and byte-identical 40,978-entry shared `node_modules` manifests (`9ea08fc...`) plus 1,055-entry real-closure manifests (`ed3000cb...`).

## Commands and exits

Every substantive subprocess used `env -i` with owned HOME/TMPDIR/agent/cache, explicit empty owned user/global npmrc files, task-owned project `.npmrc`, invalid default registry, `PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, `PI_TELEMETRY=0`, `CI=1`, and `GIT_ALLOW_PROTOCOL=file`. No auth/session/provider variables were passed to npm or probes. Network-visible fixture traffic was only the recorded owned `127.0.0.1` registry.

| Runtime / command | Exit | Result |
|---|---:|---|
| Node 22.19.0: `$NODE $TSX --test --test-name-pattern='isolates npm user\|denies dependency packing lifecycle\|local tarball installs' $ABS_TEST` | 0 | 3/3 |
| Node 24.16.0: same command | 0 | 3/3 |
| Node 22.19.0: `$NODE $TSX reports/npm-fixture-review/probes/archive-offline-control.mts` | 0 | archive, hooks, loud failures, real closure, offline conversion all pass |
| Node 24.16.0: same control | 0 | same; archive hashes match Node 22 |
| Node 24.16.0: `future-fixed-npm10.mjs $ABS_TEST` | 0 | decisive policy reproduction; safe hypothetical fixed 10.x rejected |
| target `git diff --check` and five-path target/current comparison | 0 | clean; no five-path drift |

The first Node 22 independent-probe attempt exited 1 on a reviewer-only assertion that npm extraction must retain the synthetic symlink. Archive inspection had already shown the link was correct. The probe—not package source—was narrowed to the requested archive invariant and rerun cleanly; details are retained in `independent-node22-attempt1-harness-note.log`.

The full/default package gate was intentionally not rerun.

## Frozen five-path bytes

Before and after review, all modes were `0644` and all bytes matched target:

| Path | SHA-256 | Git blob |
|---|---|---|
| `TESTING.md` | `f0480fe2f664b38908d65bcddcea603daea875e3b9d8bac31715b5d2ba263f6e` | `554ffe8140b6b2fe1e5c7e6ea8953d23bcad657f` |
| `TEST_PLAN.md` | `9635fdeca5a01a22bd81f19a6e37adfb91c6b4a446eb7d85f8a9fced42b88d57` | `cdadd7ed928bebd09dfa8079adcb63e6f9f982bf` |
| `docs/operations/testing.md` | `7dc62189ba462d17786433c4184bb27f49c89b892b6d217bad06e1fa308172ee` | `57381c430fc9e0791eca5ee318712ce32dc7714e` |
| `tests/helpers/offline-npm-registry.ts` | `fc5162d01c67757f2c1a784403741466f55c0358a4a86242b7c8442cdefea022` | `38cdc38bb941b7ce78768d80fc92bde58393c47d` |
| `tests/package/package.test.ts` | `d6f11545e0199108ae877013536343e88873cb085399360727199703bdc1214b` | `921ba7a2c610c0b2aa1e149fc9dc6791db00fe40` |

Concurrent worktree dirt outside these paths, including maintenance metadata, was neither created nor reviewed here. The parent committed the unrelated `tests/package/docs-contract.test.ts` edit as `7bca31b` near review close; none of the five frozen paths changed.

## Limits and cleanup

- Host: macOS 15.7.3 arm64. Exact Node/npm pairs above are qualified; native Windows is not claimed.
- The archive API evidence is exact for npm-bundled tar 6.2.1 and 7.5.13. Future/custom npm without callable public `tar.c` fails loudly.
- No GitHub/external-network action, install into shared dependencies, Rollup install, provider call, paid API, Fusion, agent delegation, push, publish, worktree, or source copy occurred.
- Review evidence occupied about 116 KiB before this report. Version runs were sequential; scratch was cleaned after each. Final owned TMP/HOME/agent roots are absent, repository-root tarballs are zero, and owned live child processes/open files are zero.
- No fix or semantic verification stamp was issued. Review stops at this narrow finding.
