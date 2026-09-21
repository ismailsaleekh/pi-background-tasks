# Narrow integrated attested launcher test consumer fix

## Result

**PASS.** The existing attested-registry consumer now tests the two distinct launch planes without changing production behavior:

- actual POSIX spawn executable: an independently canonicalized, executable filesystem fixture target;
- attestation evidence argv: the stable logical `['pi', ...]` invocation.

Effective injected route for this work was **`openai-codex/gpt-5.6-sol/max`** (`PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`). No Fusion/agent delegation, provider request, paid API, network access, install, push, or publish was used.

## Commit and exact diff

- Parent/reviewed main: `e1c9da681a992261fbb87fafa3f852dd8a22c27b`
- Commit: `3f4d4f8660aa0be9e9bcf89b71ac956c3653f240`
- Subject: `test: pin attested Pi launch target`
- Sole committed path: `tests/unit/registry.test.ts`
- Diffstat: `72 insertions, 24 deletions`
- Committed file SHA-256: `37d18e28536ad957ea43c9d6777e78914cb3e900d1ac4b7491f0d36f875fbb3d`
- Exact patch: `exact.diff` (141 lines, 6,237 bytes), generated with:

```bash
git show --format= --binary 3f4d4f8660aa0be9e9bcf89b71ac956c3653f240 -- tests/unit/registry.test.ts
```

- Exact patch SHA-256: `667ed9f3aebc045427a0614418f767ac2bf0689efd486bf5986be55502ade7dc`
- Checksum file: `exact.diff.sha256`

`git show --check 3f4d4f8` passed. The pre-existing maintenance state remained outside the index and outside this commit.

## Independent pinning oracle and retained contract checks

The POSIX branch now creates an executable target outside the temporary PATH bin and exposes it through a `pi` symlink. The expected executable is computed with Node's filesystem `realpathSync(admittedPi)`, not with `resolvePiLaunch()` or any production resolver helper. Assertions require:

- the recorded spawn command equals that independently canonicalized target;
- it differs from the admitted symlink pathname, proving canonical-target use rather than bare-name or symlink reuse;
- `spawn.options.shell === false`;
- the pre-existing Windows assertions remain the Node-plus-`cli.js` package route.

The fixture bin is prepended to the inherited PATH, leaving real Git reachable for authority preflight. PATH is restored in `finally`, including rejected setup. The fake child receives its complete JSON event stream and stderr and is closed before launch assertions; an outer `finally` also settles any still-running fake child before deleting the harness root.

The case retains its existing checks for:

- exact Pi args and logical attestation argv beginning with `pi`;
- stripped direct/metered API environment;
- report creation and successful sidecar production;
- raw event, stderr, and human-output contents;
- schema/lifecycle/session/provider/model/OAuth/direct-key facts;
- output, stderr, and transcript artifact/source-hash equality;
- durable sidecar visibility and parseable metadata/byte count.

No bare-`pi` resolver behavior was restored, and no assertion was deleted or exempted.

## RED evidence on reviewed main

Common isolated environment:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/attested-launch-test
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/attested-launch-test
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/attested-launch-test
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
PATH=<package>/node_modules/.bin:<Node-bin>:<inherited-PATH>
```

At `e1c9da681a992261fbb87fafa3f852dd8a22c27b`, Node `v22.19.0`:

```bash
/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/node \
  node_modules/tsx/dist/cli.mjs --test \
  --test-name-pattern='produces a direct-spawn attested Pi sidecar with raw events, stderr, hashes, and exact argv' \
  tests/unit/registry.test.ts
```

Exit: **1** (`0 pass / 1 fail`). The captured assertion was exactly the obsolete expectation:

```text
actual:   /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
expected: pi
at tests/unit/registry.test.ts:1231:16
```

Log: `red-node22-focused.log`, SHA-256 `1121017a33a910dd10c3b1ef9e2b8278b0efa825c37cd66931a625aea1259c3b`.

This agrees with the retained default Node 22 gate (`/private/tmp/pi-bg-closeout-iNoltL/logs/default-node22/default-gate.log`, SHA-256 `9317fec9d48378e729b73a53b45bc2ee3bc624235e9af28fd8c9f3660e4da85a`): typecheck passed, type-safety passed 4/4, unit passed 516/517, and this was the sole failure.

## GREEN verification

All GREEN runs used the common isolated environment above and the exact bytes committed as `3f4d4f8`.

| Runtime | Command | Exit/result | Log SHA-256 |
|---|---|---:|---|
| Node 22.19.0 | focused command shown above | 0; 1/1 | `361cecf93b832b9e04daa27840cb21fa395d8eaddbdcfb801dcdb85836b1497e` |
| Node 22.19.0 | `/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/node node_modules/tsx/dist/cli.mjs --test tests/unit/registry.test.ts` | 0; 30/30 | `cbdf50399dc5edaae98708e8f08141392c987ff36d45aef013edcaf31be50c51` |
| Node 22.19.0 | `/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/npm run typecheck` | 0 | `1de5eb880e5c5c5408c019bd2082aa86a7023fd2149730c053c5934857be3db3` |
| Node 22.19.0 | `/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/npm run test:type-safety` | 0; 4/4 | `462cb936e451af3e0bdb385b30d5522c6a82369e0d2d153c35d614c08f0b0477` |
| Node 24.16.0 | focused command with the Node 24 binary | 0; 1/1 | `d2f442a8d98d724c119a851c4d4a8beb84a657a93e894b2d45c12fc8d5b6c0e7` |
| Node 24.16.0 | `/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/node node_modules/tsx/dist/cli.mjs --test tests/unit/registry.test.ts` | 0; 30/30 | `f403ccd2d6c37d90ed26c662da322b5b3d923f639548f390f30a1fe20f717124` |
| Node 24.16.0 | `/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/npm run typecheck` | 0 | `c94e87225272b235d36b26de4cde13a12d610a894bdc49c8db229895c7fc1138` |
| Node 24.16.0 | `/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/npm run test:type-safety` | 0; 4/4 | `4f509cb9eb2b058405975f017a9768178448d61b5af9f3608e945639987d59cf` |

The default/full suite was intentionally not rerun, per the narrow brief.

## No-production-change and accepted-L1 proof

`git diff-tree --no-commit-id --name-status -r 3f4d4f8` reports only:

```text
M tests/unit/registry.test.ts
```

The commit has zero paths outside that test. It changes no source, schema, API, docs, generated file, runtime, manifest, R1 admission path, or other registry behavior/test.

The independently accepted L1 launcher source hash is unchanged across parent and commit:

```text
src/core/pi-launch.ts
parent SHA-256:  69e751caa70cb67109b9fb2990b7e06de5e5fd971ea47f608662ebb3ef6be85d
current SHA-256: 69e751caa70cb67109b9fb2990b7e06de5e5fd971ea47f608662ebb3ef6be85d
```

The retained independent PASS review bytes are unchanged: `reports/launcher-review-2/review.md` SHA-256 `deac2c56f57f9917f72feaa81e213bfe2df766e84b3a9f8e80091038571dc21f`.

## Cleanup and limits

- Peak observed task-owned scratch before cleanup: 7,124 KiB (about 6.96 MiB), below the 100 MiB cap.
- Removed exact task-owned TMP, HOME, and agent roots.
- Retained only report/log evidence under `reports/attested-launch-test/`.
- Post-cleanup owned test-process count: **0**; no registry/tsx test child remained.
- Cleanup log: `cleanup.log`, SHA-256 `9ba26b4c4b5389b12977462dab06a5549aa6cd1079e0d441378d59171b49fb9d`.

Stop point: committed the one-file test consumer correction and stopped; no broad fix or production change.
