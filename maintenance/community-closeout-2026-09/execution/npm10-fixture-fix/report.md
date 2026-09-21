# npm 10/11 lifecycle-free offline fixture correction — final report

## Result

**PASS — narrow fixture correction complete; stop before the full default gate.**

- Start: `3f4d4f8660aa0be9e9bcf89b71ac956c3653f240`
- Follow-up commit: `3eb14782d84487998b507321b2b742c1366d8791` (`test(package): make offline fixture lifecycle-free`)
- Route: `openai-codex/gpt-5.6-sol`, reasoning `max`
- Runtimes proved: Node `22.19.0` / npm `10.9.3`; Node `24.16.0` / npm `11.13.0`
- No push, publish, history rewrite, worktree/checkout/tree copy, dependency install, GitHub/external network, real provider, paid API, Fusion, agent delegation, production/manifest/lock/generated-doc edit, or shared-dependency write occurred.
- Final owned live child processes: **zero**. Agent/Fusion children created: **zero**.

## Root cause

The failure was not a missing test dependency. npm 10.9.3's directory-pack path does not fully honor `--ignore-scripts`:

1. Its `libnpmpack@8.0.1` checks `opts.ignoreScripts` around `prepack` and `postpack`.
2. Its bundled `pacote@19.0.1` `DirFetcher.#prepareDir()` nevertheless invokes `prepare` whenever that script exists; there is no `ignoreScripts` check.
3. npm 11.13.0 includes `ignore-scripts` in the `pack` command parameters, and bundled `pacote@21.5.0` returns before `prepare` when `this.opts.ignoreScripts` is set.

The executable sentinel confirmed the actual CLI behavior before any package edit:

| Command/case | Node 22/npm 10.9.3 | Node 24/npm 11.13.0 |
|---|---|---|
| absolute-directory `npm pack --ignore-scripts` with `prepare` set to mark then fail | exit 1; only `prepare.attempted` | exit 0; no marker |
| plain absolute-directory `npm pack` | exit 0; `prepack`, `prepare`, `postpack` markers | exit 0; same three markers |
| absolute nonexistent operand | exit 254; no marker | exit 254; no marker |

Exact argv and output: `root-cause-sentinel.log`. Only the task-owned sentinel was used for unsafe characterization; the real shared Turndown source was never passed to that path.

## Correction

`tests/helpers/offline-npm-registry.ts` now avoids npm's directory-pack lifecycle entirely for installed fixture dependencies:

- It discovers the same exact installed production closure.
- It archives the already-published installed files with the public portable `tar.c()` API bundled with the selected absolute npm CLI. Both npm lines use the same method; there is no version fallback.
- Archives use the ordinary `package/` prefix, portable mode, gzip level 9, and npm's fixed package mtime. Nested `node_modules` are excluded because each dependency is represented by its own real closure archive.
- Original files and `package.json` are not copied, rewritten, faked, or stripped. SHA-1/SHA-512 metadata is computed from the resulting archive for the loopback packument.
- Before/after source snapshots bind names, types, modes, symlink targets, lengths, and bytes. Mutation fails loudly. Aggregate source and archive sizes must each remain below 100 MiB.
- Absolute paths, task-owned user/global/project config and cache, and `GIT_ALLOW_PROTOCOL=file` remain mandatory. Missing inputs and unavailable npm-bundled `tar.c()` fail without fallback.

The package test adds a permanent task-owned script-denial fixture. Its `prepack`, `prepare`, and `postpack` hooks all write markers and can fail. The test proves the hooks are executable, pins the npm 10.9.3 versus npm 11.13.0 direct-CLI behavior, rejects a missing installed input, then proves the corrected path creates and installs the archive with no marker, unchanged source hash, and byte-identical script-bearing manifest.

## Commit paths and immutable hashes

| Path | Git blob | SHA-256 |
|---|---|---|
| `TESTING.md` | `554ffe8140b6b2fe1e5c7e6ea8953d23bcad657f` | `f0480fe2f664b38908d65bcddcea603daea875e3b9d8bac31715b5d2ba263f6e` |
| `TEST_PLAN.md` | `cdadd7ed928bebd09dfa8079adcb63e6f9f982bf` | `9635fdeca5a01a22bd81f19a6e37adfb91c6b4a446eb7d85f8a9fced42b88d57` |
| `docs/operations/testing.md` | `57381c430fc9e0791eca5ee318712ce32dc7714e` | `7dc62189ba462d17786433c4184bb27f49c89b892b6d217bad06e1fa308172ee` |
| `tests/helpers/offline-npm-registry.ts` | `38cdc38bb941b7ce78768d80fc92bde58393c47d` | `fc5162d01c67757f2c1a784403741466f55c0358a4a86242b7c8442cdefea022` |
| `tests/package/package.test.ts` | `921ba7a2c610c0b2aa1e149fc9dc6791db00fe40` | `d6f11545e0199108ae877013536343e88873cb085399360727199703bdc1214b` |

The commit contains exactly these five paths. The index is empty. Pre-existing maintenance state/execution dirt remains unmodified and uncommitted.

## Exact test environment and commands

Every run used `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`, an owned HOME/agent/TMPDIR/cache, explicit empty owned user/global npmrc files, an invalid default registry, and absolute executables/operands. The permanent helper additionally constructs an empty project `.npmrc` for every npm cwd.

For Node 22, the absolute executable pair was:

```text
NODE=/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/node
NPM_CLI=/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/lib/node_modules/npm/bin/npm-cli.js
```

For Node 24:

```text
NODE=/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/node
NPM_CLI=/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/lib/node_modules/npm/bin/npm-cli.js
```

The absolute TSX CLI was:

```text
TSX=/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/tsx/dist/cli.mjs
```

With the corresponding absolute `NODE`, owned config paths, and version bin first in `PATH`, the same focused command was run on each line:

```text
$NODE $TSX --test --test-name-pattern='isolates npm user|denies dependency packing lifecycle|local tarball installs' /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/package/package.test.ts
```

Post-commit exits:

| Runtime | Exit | Result | Log |
|---|---:|---|---|
| Node 22.19.0/npm 10.9.3 | 0 | 3/3 | `postcommit-focused-node22-npm10.log` |
| Node 24.16.0/npm 11.13.0 | 0 | 3/3 | `postcommit-focused-node24-npm11.log` |

The full owned package file command on each line was:

```text
$NODE $TSX --test /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/package/package.test.ts
```

| Runtime | Exit | Result | Log |
|---|---:|---|---|
| Node 22.19.0/npm 10.9.3 | 0 | 35/35 | `full-package-file-node22-npm10-final.log` |
| Node 24.16.0/npm 11.13.0 | 0 | 35/35 | `full-package-file-node24-npm11-final.log` |

Safety and typecheck used the corresponding absolute command `$NODE $NPM_CLI run <script>`:

| Script | Node 22/npm 10 | Node 24/npm 11 |
|---|---|---|
| `test:type-safety` | exit 0, 4/4 | exit 0, 4/4 |
| `typecheck` | exit 0 | exit 0 |

Additional authored-doc checks: `npm run docs:verify` exit 0 (31 surfaces, 50 sources, deterministic generation); `npm run test:docs` exit 0 (5/5). No attestation was self-issued.

### Safe red receipt

After adding the permanent sentinel regression but before changing the helper, the exact focused test command above with pattern `denies dependency packing lifecycle scripts` produced:

| Runtime | Exit | Result |
|---|---:|---|
| Node 22.19.0/npm 10.9.3 | 1 | helper reached task-owned `prepare`; marker/failure `sentinel lifecycle executed: prepare` |
| Node 24.16.0/npm 11.13.0 | 0 | npm 11 already denied all sentinel hooks |

Logs: `red-safe-sentinel-node22-npm10.log` and `pre-fix-sentinel-node24-npm11.log`. After correction, both exact focused sentinel commands exited 0 (`green-safe-sentinel-node22-npm10-attempt1.log`, `green-safe-sentinel-node24-npm11-attempt1.log`).

## Retained real offline-consumer controls

The final 35/35 package-file runs on both npm versions retain and pass all of the following:

- package tarball input and all npm filesystem operands are absolute;
- a separate truly empty cache fails with `ENOTCACHED` naming `turndown`;
- real installed archives are made for exactly `turndown@7.2.4` and `@mixmark-io/domino@2.2.0`;
- the original Turndown manifest bytes, `prepare: "npm run build"`, and dependency edge `@mixmark-io/domino: "^2.2.0"` survive unchanged;
- loopback preparation receives only the two packuments and two exact tarballs, all HTTP 200;
- the registry is closed before final `npm install --offline`;
- final installed versions are exact, Domino loads, and real Turndown conversion returns Markdown containing `Offline` and `closure loaded`;
- absent closure input, lifecycle execution, cache-preparation failure, source mutation, and missing runtime dependency are loud failures;
- no Rollup or other dependency was installed and no shared hook/postinstall ran.

## Shared-byte integrity

A complete manifest of all shared `node_modules` entries was recorded before the first probe and again after the post-commit npm 10/npm 11 verification. Each regular file is SHA-256-bound with size and mode; directories and symlinks are also represented.

```text
shared entries: 40,978
before/after manifest SHA-256: 9ea08fc743ac585772198d9df67c1c2adc2f1b2005e41f399bf9d2b6c38de0a9
cmp: IDENTICAL

Turndown/Domino closure entries: 1,055
before/after manifest SHA-256: ed3000cb829bfcb5882643f2508b150aa9ea2c66b1ecb858c097400a5ad21b55
cmp: IDENTICAL
```

Evidence: `shared-integrity-comparison.log`, `shared-node-modules-{before,after}.tsv`, and `real-closure-{before,after}.tsv`.

## Limits, cleanup, and handoff

- Host was macOS; both mandated Node/npm lines were executed. Native Windows was not claimed.
- One Node 24 final launch used an overlong owned TMPDIR and failed before test discovery when TSX could not bind its Unix IPC socket (`EINVAL`). It was rerun unchanged with a shorter path inside the same mandated task root and passed 35/35. Receipt: `node24-long-tmpdir-harness-failure.log`.
- The full/default `npm run test` gate was intentionally **not** rerun. This report stops at focused pack/config, full owned package-file, safety, typecheck, and docs checks for narrow independent fixture review.
- Peak task-owned scratch plus reports observed before cleanup: 76.5 MiB, below 200 MiB. Final `tmp/npm10-fixture-fix`, `home/npm10-fixture-fix`, and `agent/npm10-fixture-fix` are each 0 B; retained reports are about 12 MiB. Repository-root tarballs: zero.
- Final owned npm/Node/registry/test processes: zero. The Pi harness and unrelated workers were not cleanup targets.
