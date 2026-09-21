# R1 merge-conflict resolution report

## Result

**PASS — conflict resolved and staged; no commit created.**

Effective route was verified from the injected process environment as **`openai-codex/gpt-5.6-sol/max`** (`PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`). No provider request, paid API, Fusion/agent delegation, network operation, install, push, publish, checkout, reset, abort, rebase, or commit was used.

## Merge identity and staged resolution

- Ours/main parent: `3eb14782d84487998b507321b2b742c1366d8791` (`test(package): make offline fixture lifecycle-free`)
- Theirs/accepted R1 parent: `ef3f1ac45116bbbb631352cac4cc4180bc4e8807` (`fix(core): retain POSIX process-group ownership`)
- Conflict stages read:
  - base/stage 1: `9dd0c16462d174757b893f2dd8245af5c5071858`
  - ours/stage 2: `cbc797c610b4fc8bc49095692952a7eebcaefe17`
  - theirs/stage 3: `b6008fd7056719edf1faac08f8ba22e20f0787db`
- Resolved staged blob: `f7638047144f88b25c90ce5ddbe2d2db2f1ba632`
- Resolved file SHA-256: `217752ff4634d7f61b49f66228c01fb4be00bee3af0f59822436adaaacd5a554`
- Resolved size: 2,950 lines.
- Staging action: `git add -- tests/unit/registry.test.ts` only.
- `git ls-files -u`: **0 entries**.
- Conflict markers: **none**.
- `git diff --cached --check`: exit 0.
- `git diff --check`: exit 0.

Delta accounting:

- Against ours/main test blob: `+1338/-12`; this is the accepted R1 admission, process-tree, publication, retention, and harness material integrated around the already-canonicalized fixture.
- Against theirs/R1 test blob: `+72/-24`; this is the independently accepted main fixture correction plus its required imports.
- Against the original stage-1 base blob: `+1410/-36`.

The only textual conflict was the import block. Its resolution keeps the union: R1's `chmod` plus main's `realpathSync`, `symlink`, and `delimiter`, while retaining all R1 imports and types.

## Preserved contracts

### Accepted R1

All stage-3 bytes outside the main fixture/import delta remain intact. In particular, the resolved test retains:

- all four-starter admission closure/drain coverage;
- managed pre-insertion cleanup ownership;
- bounded/cancellable attested Git preflight and real process-tree reaping;
- immutable detached POSIX group ownership, leader-close barriers, one-shot force/proof, ESRCH disarmament, loud leak failure, and delegate/attested barriers;
- safe injected group state and harness fields (`taskAdmissionTimeoutMs`, `attestedGitKillGraceMs`, `attestedGitSpawn`, captured group state, and fake-PID signal controls);
- EventBus delivered/pending/abandoned truth, typed publisher closure, bounded retry, late-gate shutdown, and retention abandonment;
- the managed `bg_result` retention regression.

The merged registry file executes 48/48 registry cases, including these accepted regressions.

### Main canonical executable fixture

The existing attested case retains the two separate launch planes:

- actual POSIX spawn target is an executable fixture independently canonicalized with `realpathSync` through a `pi` symlink;
- attestation evidence remains the stable logical `['pi', ...piArgs]` argv.

It also retains safe inherited-PATH prepending/restoration, `shell:false`, Windows Node-plus-`cli.js` assertions, fake-child settlement before launch assertions, outer failure cleanup, stripped direct/metered auth environment assertions, raw events/stderr/output checks, lifecycle/session/provider/model/OAuth/direct-key checks, source/artifact hash equalities, durable sidecar visibility, and metadata byte-count checks. No bare `assert.equal(spawn.shell, 'pi')` was restored and the pinned resolver contract was not weakened.

## Node 22.19.0 verification

Common isolation:

```text
TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/r1-merge-resolution
HOME=/private/tmp/pi-bg-closeout-iNoltL/home/r1-merge-resolution
PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/r1-merge-resolution
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1
GIT_ALLOW_PROTOCOL=file
Node v22.19.0; npm 10.9.3
```

| Check | Result |
|---|---|
| `/Users/lizavasilyeva/.nvm/versions/node/v22.19.0/bin/npm run typecheck` | exit 0 (`tsc --noEmit`) |
| `node node_modules/tsx/dist/cli.mjs --test tests/unit/{attested-pi-run,durable-fs,extension-api,pi-launch,posix-invariance,registry,windows-taskkill}.test.ts` | exit 0; **128/128**, 8 suites, 0 fail/cancel/skip/todo |
| Focused real SDK lifecycle pattern `AgentSession\.reload|overlapping late session_start|AgentSessionRuntime` over `fusion-sdk`, `lifecycle-sdk`, and `sdk` | exit 0; **4/4**, 3 suites, 0 fail/cancel/skip/todo |

Focused-unit breakdown: attested Git 6, durable-fs 28, EventBus 8, launcher 26, POSIX invariance 7, registry 48, Windows taskkill 5 = 128.

Logs:

- `typecheck-node22.log` — SHA-256 `582a199fe589bfb13dadc1b773ee175de02c8623395087ccae06ff69b407a26f`
- `focused-units-node22.log` — SHA-256 `3783281d9ab1c666bb25e4cbee0ea4649259e9bf379c34034d7117d57f1a2cfd`
- `focused-sdk-lifecycle-node22.log` — SHA-256 `8a4101a5fa38085fb83f5cc4d500d84e2f010117d36f6b281a3e450e25721020`

No default/full suite or docs generation/verification was run, as required. There are **no remaining integration errors in the requested focused scope**.

Two post-check shell wrappers had non-product bookkeeping exits: one aggregation command exited 129 after using an invalid blob-diff argument form (the corrected commands produced the delta figures above), and the first cleanup wrapper exited 1 because `grep` found the desired zero process matches under `set -e -o pipefail`. Neither ran a test or changed source; the explicit follow-up process check exited 0 with count 0.

## Integrity, index preservation, and cleanup

- A SHA-256 manifest of all 336 existing tracked/untracked worktree files outside `tests/unit/registry.test.ts` is byte-identical before and after (`f511252960823ee30477decea9ad1ebfd61669d4c20837560ebc21b008159aa1`). This includes the parent-maintained `STATE.md` and maintenance evidence.
- Raw index state excluding the resolved path is byte-identical before/after (`81edb6730518a57a3b5ed9ad79fcd23c4b8de6fbbc050d9eddbc6b459dc516da`). Thus no unrelated staging changed.
- Every auto-merged production index blob exactly equals accepted R1/MERGE_HEAD for `src/core/{attested-pi-run,common,durable-fs,extension-api,registry}.ts` and `src/extension.ts`.
- Exact task-owned TMP, HOME, and agent roots were removed after verification and are absent.
- Follow-up owned test-process scan: exit 0, **0 test children/processes**.
- Parent maintenance dirt and the pre-existing auto-merged index were otherwise preserved.

Stop state: resolved/staged merge with no unmerged entries. The parent integrator remains responsible for the merge commit.
