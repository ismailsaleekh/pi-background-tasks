# Independent L1 review — commit `8550a1a`

## Verdict

**Findings: 1 high, 3 medium, 1 low.** The focused suites are green, but the POSIX PATH result is not bound to the executable that was admitted, embedded SDK hosts are classified inconsistently, and one Windows host-I/O failure silently selects another installation.

Reviewed `8550a1a61ef7a9915d7c3a372b342451b80c806b` against parent `1b3d48d833554ced807c729cab354dd7cc73b79d`. I made no package-source, index, or commit changes and made no documentation attestation.

## Findings

### HIGH — L1-1 — POSIX validation can spawn a different, unvalidated `pi`

**Location:** `src/core/pi-launch.ts:429-453`; contradicted contract wording at `docs/subsystems/child-launch-durability-and-safety.md:16-18`.

The resolver canonicalizes a concrete PATH candidate, verifies regular-file status and `X_OK`, then discards `candidateReal` and returns the bare name `pi`. Child callers do not bind the later lookup to the admission context: for example, delegate resolution happens before an `await` and spawn uses `cwd: ctx.cwd` plus `env: request.env` (`src/core/registry.ts:1107-1155`). Relative PATH entries therefore resolve against another cwd, and PATH/env can also differ or change between admission and spawn.

The native Darwin repro kept the identical PATH string `bin`: resolution admitted `<admitted>/bin/pi`, while the structured, shell-free spawn in another cwd executed `<child>/bin/pi` and printed `UNVALIDATED`. Thus ordered/canonical/executable validation does not establish which file runs. A child can receive the package's inherited environment and Pi credentials while executing a file that passed none of those checks.

**Repro:** `repros/resolver-adversarial.mts` / `repros/resolver-adversarial.log`, case `bare-path-reselection`; exit 0 means the mismatch was reproduced and asserted.

### MEDIUM — L1-2 — Any Bun-virtual SDK application is treated as compiled Pi

**Location:** `src/core/pi-launch.ts:316-351,464-466`; inaccurate exclusion claim at `docs/subsystems/child-launch-durability-and-safety.md:34`.

A non-generic executable is accepted as `compiled-host` whenever `process.argv[1]` has the `/$bunfs/root/` shape. There is no Pi package, CLI-entry, or Pi process-marker check, and this branch runs before PATH/host/module discovery. Arbitrary applications embedding the documented Pi SDK can also be Bun-compiled and have that virtual-script shape; the resolver then relaunches the application itself with Pi CLI arguments instead of using an exact installed Pi package or failing loudly. This can fail, recurse, or hang every child-backed feature.

The fixture repro supplied an executable named `custom-sdk-application`, a Bun virtual app path, and a valid exact-name Pi package. Resolution returned the arbitrary application as `compiled-host` and performed **zero** package lookups. This is mocked resolver evidence on Darwin, not a compiled-Bun or vendor-binary run.

**Repro:** `repros/resolver-adversarial.log`, case `arbitrary-bun-sdk-misclassified`.

### MEDIUM — L1-3 — Windows treats running-host realpath failure as permission to substitute a module installation

**Location:** `src/core/pi-launch.ts:228-237,485-503`.

Every running-host source `realpath` error—including `EACCES`, not just absence/foreign identity—is rewritten as `HostIsNotPiError`. The Windows branch interprets that class as permission to continue to module resolution. Consequently a broken or unreadable running host can silently launch a different visible Pi installation; the successful result omits the host failure entirely. This is weaker than the stated host-authoritative/no-silent-substitution policy.

The repro used a lexically genuine named Pi host whose source realpath returned `EACCES` and a second valid module package. The resolver returned the second package's CLI. This exercises the injected win32 branch on Darwin; native-Windows behavior remains unqualified.

**Repro:** `repros/resolver-adversarial.log`, case `broken-windows-host-substituted`.

### MEDIUM — L1-4 — The exact package route is unreachable for a POSIX embedded SDK host

**Location:** `src/core/pi-launch.ts:471-481` (module lookup is reached only after the Windows branch at `:485-503`).

Pi's installed SDK documentation supports embedding sessions and extensions in another Node application. With no PATH `pi`, a foreign POSIX SDK host is rejected after host-package classification without considering the exact named, contained Pi package that is already installed for the SDK. The equivalent Windows host does use that validated module route. All delegate, Fusion, and attested child launches therefore fail in this otherwise launchable POSIX package/SDK layout unless the application modifies PATH or impersonates the Pi CLI in `process.argv[1]`.

The same fixture produced zero module lookups and `pi_executable_resolution_failed` on POSIX, but one lookup and a valid `package-node-cli` result on the mocked Windows branch.

**Repro:** `repros/resolver-adversarial.log`, case `posix-sdk-package-route-unreachable`.

### LOW — L1-5 — The SDK fixture does not restore all process environment it mutates

**Location:** `tests/sdk/delegate-sdk.test.ts:185-205` (assigned keys are defined in `tests/helpers/normalize.ts:1-6`).

`Object.assign(process.env, isolatedTestEnv, ...)` writes `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY`, and `CI`, but `previous`/`restore()` preserve only PATH, the scenario key, and `process.argv[1]`. The four shared keys remain changed after disposal. The new argv mutation itself is restored and setup failures call `restore()`, but the report's blanket global-env restoration claim is not true. This can mask later same-process checks under a different runner. The `isolatedTestEnv` assignment predates this commit; the modified fixture retains the acceptance gap. It is masked here because the mandated outer environment already had the same four values.

No test-only production bypass or new skip was found.

## Hang assessment

The preserved exploratory `green-unit-full.log` is **not** merely a docs failure: it records the known docs-gate failure and then stops after `fusion-orchestrator`; the next sorted unit file is `fusion-pi-child.test.ts`. The pre-correction `final-fusion-pi-child-unit.log` records the bare-name assertion failure and no terminal TAP summary, consistent with that assertion leaving its fake child/run unsettled. The corrected worker log and my independent run both complete the entire file at **72/72, exit 0**. I found no evidence of another unsettled launch consumer at the reviewed bytes, so I did not repeat the 300-second broad lane. This does not certify the unreported remainder of that exploratory unit run.

## Verification and limits

Common mechanical environment for substantive checks:

```text
GIT_ALLOW_PROTOCOL=file
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/launcher-review
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/launcher-review
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/launcher-review
```

Commands used absolute package tool paths; no npm command, install, network access, or user auth/session was used.

| Check (with the common environment above) | Exit / result |
|---|---:|
| `(cd maintenance/community-closeout-2026-09 && shasum -a 256 -c evidence/SHA256SUMS)` | 0; 49/49 OK |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsx --test /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/unit/pi-launch.test.ts` | 0; 22/22 |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsx --test --test-concurrency=1 /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/sdk/delegate-sdk.test.ts` | 0; 13/13 |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsx --test /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/unit/fusion-pi-child.test.ts` | 0; 72/72 |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsx --test --test-concurrency=1 /Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/tests/sdk/fusion-sdk.test.ts` | 0; 11/11 |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsx /private/tmp/pi-bg-closeout-iNoltL/reports/launcher-review/repros/resolver-adversarial.mts` | 0; all four adverse cases reproduced |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsx --eval "import { resolvePiLaunch } from './src/core/pi-launch.ts'; console.log(JSON.stringify(resolvePiLaunch({ platform: process.platform, path: '', hostScript: '/usr/local/bin/pi' })));"` | 0; Node + canonical global Pi 0.86 CLI |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsc --noEmit --pretty false -p /private/tmp/pi-bg-closeout-iNoltL/reports/launcher-review/tsconfig.owned.json` | 0 |
| `/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/.bin/tsc --noEmit --pretty false` (package cwd; observed twice) | 2; unrelated `tests/package/fusion-model-roles-docs.test.ts:144` |
| `git diff --no-ext-diff --check 1b3d48d833554ced807c729cab354dd7cc73b79d 8550a1a61ef7a9915d7c3a372b342451b80c806b` | 0 |

A first reviewer-owned tsconfig attempt exited 2 with `TS2688` because the config lived outside the package and lacked an explicit shared `typeRoots`; the corrected reviewer config above exited 0. Two full-tree `tsc --noEmit` observations exited 2 at unrelated `tests/package/fusion-model-roles-docs.test.ts:144` while another worker landed `0a69a4f`; that path is outside L1 and was not attributed to this commit.

Platform/runtime truth:

- Native host: Darwin 24.6.0 arm64, Node 24.16.0; package Pi 0.84.0; global Node-script Pi 0.86.0; Bun 1.3.4 available.
- The PATH reselection repro used a real POSIX filesystem and real local subprocess.
- Windows resolver coverage was injected/mocked on Darwin. No native Windows product proof exists. The worker's macOS invocation of the native suite yielded 0/9 because win32 is required; that is not a product failure or pass.
- Compiled-host coverage was fixture-only. No vendor-compiled Pi or compiled-Bun launcher claim is made.
- SDK/Fusion checks used fake child processes and made zero model/provider calls.
- The pre-existing native-Windows Fusion SDK skip at `tests/sdk/fusion-sdk.test.ts:75-79` remains explicit qualification debt; L1 did not add or broaden it.
- Authored/generated docs freshness and semantic attestation were not certified in this review.

## Frozen boundary and cleanup

Effective injected route was verified before substantive work:

```text
PI_PROVIDER=openai-codex
PI_MODEL=gpt-5.6-sol
PI_REASONING_LEVEL=max
```

Initial HEAD was `3f7665486e1ace62dfbd018493fbe8f07f7116dc`; unrelated concurrent work advanced final HEAD to `0a69a4fbf8a011db0bf761d3026105d7aefd1e16`. The four frozen paths remained byte-identical to reviewed commit `8550a1a` and clean before/after:

| Path | SHA-256 | Git blob |
|---|---|---|
| `src/core/pi-launch.ts` | `0913b2ec7ce5dd0d45bdeef9969194038431e230ce7b30a0fc8c98d34aa13f4d` | `698d60c8ed7603ad0ecc3e1f0c50cba47681b92c` |
| `tests/unit/pi-launch.test.ts` | `2a74f0e6f5e9a39b645bfdb012cef22c4303ef71bccc412b10587e1bcbb8729f` | `4712fb830e2af5b82769b5dedda88051dbb30bd6` |
| `tests/sdk/delegate-sdk.test.ts` | `8a379b46ecb74515a41f9c26d8128a8cdd5830685a3ac9081efc7d150fbccc63` | `76630229c5ebdf5e760e97895f2b0e7c2a0fb096` |
| `docs/subsystems/child-launch-durability-and-safety.md` | `de564472dc7db83ad74f78a68eae26027efe83ed731a863251e0b7894914e232` | `476e2c51a1a95b8a1ba4130b97c4001312a943ca` |

`boundary-final.log` records an empty target-to-final-HEAD diff and empty worktree status for these paths. Peak owned mechanical scratch was about 5.4 MiB, below 150 MiB. Exact owned TMP/HOME/agent roots were removed; reports/repros were retained. Final owned live subprocess count: **0**.
