# npm lifecycle characterization policy — final report

## Result

**PASS — narrow one-file policy correction complete; no commit created.**

- Package: `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks`
- HEAD observed before and after: `7bca31b7ca6c040076a2fa1ac8d397a5a12d4bfa` (`test(docs): align EventBus close contract guard`)
- Route verified before work: `openai-codex/gpt-5.6-sol`, reasoning `max`
- Qualified pairs: Node `22.19.0` / npm `10.9.3`; Node `24.16.0` / npm `11.13.0`
- Repository change is intentionally unstaged for the parent mechanical commit. No index write or commit was performed.

## Policy correction

`tests/package/package.test.ts` now applies one source-bound pure policy to both synthetic controls and the real sentinel observation:

1. The existing supported-toolchain floor remains npm major 10 or newer, and malformed version output fails with the received value.
2. Exit `0` with zero lifecycle markers is accepted for every supported npm version, including a hypothetical fixed npm `10.10.0`.
3. The upstream unsafe shape is accepted only for exact npm `10.9.3`: exit `1`, output containing `sentinel lifecycle executed: prepare`, and exactly one `prepare` marker.
4. Every other status/output/marker/version combination fails loudly and reports the observed version, status, markers, and output.

Pure controls bind this same function to known `10.9.3`, known-safe `11.13.0`, future-safe `10.10.0`, future-version prepare execution, successful execution with a marker, extra hooks, wrong exit, wrong failure text, marker-free failure, malformed version text, and the npm-below-10 floor.

The corrected dependency archive and consumer assertions remain unconditional: their marker list must be empty on every version. No helper fallback or npm-version branch was added. Direct unsafe lifecycle characterization remains confined to the task-owned sentinel; the shared Turndown/Domino source was only traversed by the lifecycle-free archive helper.

## Exact owned diff and hashes

The owned package diff is exactly one mode-`100644` path:

| Path | Baseline SHA-256 | Final SHA-256 | Numstat |
|---|---|---|---:|
| `tests/package/package.test.ts` | `d6f11545e0199108ae877013536343e88873cb085399360727199703bdc1214b` | `7b9bed7aca457c7bdbcd88168adc2d09658e0589c84f3e397bc2ea0ef24048c6` | `+85/-13` |

- Final patch SHA-256 (`git diff -- tests/package/package.test.ts`): `1202f72652a16ba20cc78fbf94c96f290040c1679bc6f2216dd8252b1933b516`
- `git diff --check -- tests/package/package.test.ts`: exit `0`
- Final scoped status: ` M tests/package/package.test.ts` (unstaged)
- Invariant helper SHA-256, unchanged: `tests/helpers/offline-npm-registry.ts` = `fc5162d01c67757f2c1a784403741466f55c0358a4a86242b7c8442cdefea022`
- No production, helper, docs, manifest, lockfile, generated file, or other package file was changed.

## Isolated command environment

Every substantive command used `env -i`. The exact common environment was:

```text
PATH=<the selected Node version bin>:/usr/bin:/bin
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/npm-version-policy
USERPROFILE=/private/tmp/pi-bg-closeout-iNoltL/home/npm-version-policy
XDG_CONFIG_HOME=/private/tmp/pi-bg-closeout-iNoltL/home/npm-version-policy/config
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/npm-version-policy
TMP=/private/tmp/pi-bg-closeout-iNoltL/tmp/npm-version-policy
TEMP=/private/tmp/pi-bg-closeout-iNoltL/tmp/npm-version-policy
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/npm-version-policy
PI_OFFLINE=1
PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
CI=1
GIT_ALLOW_PROTOCOL=file
NPM_CONFIG_CACHE=npm_config_cache=/private/tmp/pi-bg-closeout-iNoltL/home/npm-version-policy/cache
NPM_CONFIG_USERCONFIG=npm_config_userconfig=/private/tmp/pi-bg-closeout-iNoltL/home/npm-version-policy/config/user.npmrc
NPM_CONFIG_GLOBALCONFIG=npm_config_globalconfig=/private/tmp/pi-bg-closeout-iNoltL/home/npm-version-policy/config/global.npmrc
NPM_CONFIG_REGISTRY=npm_config_registry=http://127.0.0.1.invalid/
```

The owned user/global npmrc files were empty. Focused tests additionally created and removed their own empty project npmrc files and isolated caches beneath the owned TMP root.

Absolute executables and operands:

```text
NODE22=/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/node
NODE24=/Users/lizavasilyeva/.nvm/versions/node/v24.16.0/bin/node
TSX=/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/tsx/dist/cli.mjs
TEST=/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/package/package.test.ts
REVIEWER_PROBE=/private/tmp/pi-bg-closeout-iNoltL/reports/npm-fixture-review/probes/future-fixed-npm10.mjs
```

## RED reviewer counterexample (before fix)

Exact command, using the common environment and Node 24 PATH:

```text
$NODE24 $REVIEWER_PROBE $TEST
```

Exit: `0` (the probe successfully reproduced the defect). It accepted known npm `10.9.3` and `11.13.0`, rejected safe hypothetical npm `10.10.0` with `npm 10 must expose its prepare-script defect`, and bound the old branch at SHA-256 `41c2d2800cde0b2a4231219fb7558895d7ebfcc5e040a057c9086cc1c8c8d83e`.

Log: `/private/tmp/pi-bg-closeout-iNoltL/reports/npm-version-policy/red-reviewer-counterexample.log`

## GREEN source-bound pure controls

Exact command on each runtime, using the common environment and the matching runtime PATH:

```text
$NODE $TSX --test --test-name-pattern='characterizes npm --ignore-scripts without requiring future npm defects' $TEST
```

| Runtime | Exit | Result | Log |
|---|---:|---|---|
| Node 22.19.0 / npm 10.9.3 | 0 | 1/1 | `/private/tmp/pi-bg-closeout-iNoltL/reports/npm-version-policy/green-pure-node22-npm10.log` |
| Node 24.16.0 / npm 11.13.0 | 0 | 1/1 | `/private/tmp/pi-bg-closeout-iNoltL/reports/npm-version-policy/green-pure-node24-npm11.log` |

## GREEN actual lifecycle/archive/offline controls

Exact command on each runtime, using the common environment and the matching runtime PATH:

```text
$NODE $TSX --test --test-name-pattern='isolates npm user|denies dependency packing lifecycle|local tarball installs' $TEST
```

| Runtime | Exit | Result | Log |
|---|---:|---|---|
| Node 22.19.0 / npm 10.9.3 | 0 | 3/3 | `/private/tmp/pi-bg-closeout-iNoltL/reports/npm-version-policy/green-actual-focused-node22-npm10.log` |
| Node 24.16.0 / npm 11.13.0 | 0 | 3/3 | `/private/tmp/pi-bg-closeout-iNoltL/reports/npm-version-policy/green-actual-focused-node24-npm11.log` |

These actual checks retained the hostile-config isolation control, executable plain-pack lifecycle control, exact direct `--ignore-scripts` characterization, missing-input failure, zero-hook helper archive/install, source hash and script-bearing manifest preservation, real Turndown/Domino archive closure, empty-cache `ENOTCACHED` negative, loopback-only cache seed, registry closure before final `--offline` install, exact versions/dependency edge, and real Domino-backed conversion.

## Limits and cleanup

- No full, default, root, docs, compatibility, provider, or live-inference suite was run. URL/type and unrelated package assertions were not selected; their source remained untouched.
- No external network/GitHub, dependency install, shared dependency write, checkout, worktree, source copy, push, publish, paid API, Fusion, or agent delegation occurred. Fixture traffic was loopback-only; the default registry was invalid.
- Host: macOS; native Windows is not claimed. Qualification is limited to the two exact Node/npm pairs above. Future supported versions are accepted only for the fully suppressed shape; any lifecycle execution remains a loud failure.
- Maximum retained owned scratch observed after verification was `7,740 KiB`, below the `100 MiB` limit; test fixture scratch was removed by the tests.
- Final owned TMP, HOME/config/cache, and agent roots are absent. Retained evidence is under `/private/tmp/pi-bg-closeout-iNoltL/reports/npm-version-policy/` only.
- Final owned live Node/npm child processes: **zero**.
- Commit: **none**. The one-file change remains unstaged for the parent.
