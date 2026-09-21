# npm 10/11 lifecycle-free offline fixture correction — design

## Identity, boundary, and observed red

- Package: `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks`
- Starting HEAD: `3f4d4f8660aa0be9e9bcf89b71ac956c3653f240`
- Route: `openai-codex/gpt-5.6-sol`, reasoning `max`
- Owned package paths: `tests/helpers/offline-npm-registry.ts`; only the offline-pack/npm-environment sections of `tests/package/package.test.ts`; relevant npm-fixture prose in `docs/operations/testing.md`, `TESTING.md`, and `TEST_PLAN.md`.
- Reports and scratch stay under `/private/tmp/pi-bg-closeout-iNoltL/{reports,tmp,home,agent}/npm10-fixture-fix`. No production, manifest, lock, generated-doc, URL/type-guard, maintenance-state, worktree, dependency-install, network, provider, or shared-`node_modules` write is in scope.

Before any package edit, a task-owned package with `prepack`, `prepare`, and `postpack` scripts was packed using the same absolute-operand command and isolated npm configuration on both supported runtimes. Each hook writes an external marker, and `prepare` can fail deliberately.

| Runtime | `npm pack --ignore-scripts ... <absolute sentinel dir>` | Markers |
|---|---:|---|
| Node 22.19.0 / npm 10.9.3 | exit 1 | `prepare.attempted` |
| Node 24.16.0 / npm 11.13.0 | exit 0 | none |

A plain `npm pack` lifecycle-attempt control exited 0 and wrote all three markers on both versions. An absolute nonexistent input exited 254 with no marker on both versions. Exact commands and output are retained in `root-cause-sentinel.log`; the real Turndown tree was not used for this unsafe characterization.

## Root cause

This is an npm 10 directory-packing lifecycle defect, not a missing Rollup dependency:

1. npm 10.9.3's `libnpmpack` checks `opts.ignoreScripts` around `prepack` and `postpack`, and the sentinel proves those hooks are suppressed.
2. Its bundled `pacote@19.0.1` `DirFetcher.#prepareDir()` unconditionally invokes `prepare` whenever the manifest declares it. The option is not checked there. npm 10's `pack` command documentation/parameter list also does not advertise `ignore-scripts` for this command.
3. npm 11.13.0 adds `ignore-scripts` to the `pack` command parameters, and bundled `pacote@21.5.0` explicitly returns before `prepare` when `this.opts.ignoreScripts` is true.
4. Therefore passing `--ignore-scripts` through npm 10 can suppress `prepack`/`postpack` while still executing `prepare`. Turndown's real `prepare -> build -> rollup` exposed that behavior. Installing Rollup, weakening Node support, retrying by npm version, or trusting the flag text would hide rather than fix the unsafe fixture path.

## Implementation

Replace directory `npm pack` only for installed production dependencies. Main-package packing remains the existing npm command because it is package-owned and separately covered.

The dependency helper will:

1. Discover the exact installed production closure exactly as today from immutable package manifests. Missing required inputs remain loud.
2. Snapshot each installed package tree before archive creation, including relative names, entry types, modes, symlink targets, file lengths, and file bytes. Exclude nested `node_modules`; dependencies are represented by their own exact closure tarballs. Enforce an aggregate source/archive bound below 100 MiB.
3. Create a normal `package/`-prefixed gzip tarball directly from the already-published installed files using the public `tar.c()` API bundled with the selected npm CLI. A narrow task-owned CommonJS bridge resolves `tar` relative to the absolute npm CLI path. It uses the portable npm/pacote archive settings (`portable`, gzip level 9, fixed package mtime) and never invokes npm lifecycle machinery. There is one method for npm 10 and npm 11, no version test or silent fallback.
4. Preserve every archived byte, including the original unmodified `package.json` and lifecycle metadata. No fake package, script stripping, dependency substitution, or recursive `node_modules` copy is used.
5. Snapshot the source again and fail if bytes or relevant metadata changed. Compute SHA-1 and SHA-512 integrity from the resulting archive for the loopback packument.
6. Keep all npm subprocesses on the existing isolated HOME/cache/user/global/project config and `GIT_ALLOW_PROTOCOL=file` environment. All filesystem operands remain absolute.

## Permanent regression and controls

Add a narrow package test in the owned offline section:

- Build only a task-owned sentinel dependency whose `prepack`, `prepare`, and `postpack` hooks write markers and can fail.
- A plain-pack lifecycle-attempt negative control must run the hooks and fail at the selected hook, proving the fixture is executable.
- The exact direct `--ignore-scripts` characterization must pin npm 10's `prepare` attempt and npm 11's denial using the active CLI, while never touching a shared dependency.
- A missing installed dependency must fail loudly before registry service.
- The corrected helper must package and install the sentinel with no lifecycle marker, preserve its script-bearing manifest verbatim, and leave its source-tree digest unchanged.

Retain and strengthen the existing real consumer case:

- Assert the shared Turndown/Domino tree digest is unchanged across preparation.
- Assert Turndown's real `prepare` metadata remains present after offline installation, proving scripts were not stripped.
- Retain the separate truly empty-cache `ENOTCACHED` negative, exact `turndown@7.2.4 -> @mixmark-io/domino@^2.2.0` edge, four loopback inputs, server closure before final `--offline` install, and actual HTML-to-Markdown conversion with Domino loaded.

## Verification plan

Use only the mandated task roots and environment:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/npm10-fixture-fix
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/npm10-fixture-fix
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/npm10-fixture-fix
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
```

For both Node 22.19.0/npm 10.9.3 and Node 24.16.0/npm 11.13.0, run the focused script-denial/config/packed-consumer tests with the same arguments and isolated configs, then the complete `tests/package/package.test.ts`. Run package typecheck and safety/package gates as needed. Record exact commands/exits, marker state, archive/install facts, source hashes, and process cleanup. Compare a full pre/post shared-`node_modules` byte/metadata manifest. Stop after the coherent explicit-path commit and narrow fixture verification; do not rerun the full default gate.
