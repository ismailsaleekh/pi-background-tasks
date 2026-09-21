# Independent C1a runtime review — Sol 5.6/max OAuth

## Verdict

**CHANGES REQUIRED.** The core capability, shortcut, child-path, and single-producer behavior passes focused controls, but two ownership bugs prevent C1a runtime acceptance: one **HIGH** Anthropic-provider teardown defect and one **MEDIUM** active-tool reconciliation defect.

Reviewed frozen state:

- HEAD: `e3c0b065c52862e3889c9c5c24841a9d162fb338`
- implementation: `da2f6fccfc4014f3310c63d7c6ad530f4ab3374d`
- base: `bc25e9a8d8be74bd38899e56bb7ab2266629969c`
- implementation tree: `a26e8fb0c3d25d4c5359a44c8ad5b8f3bb8660a7`
- observed route: `openai-codex/gpt-5.6-sol`, reasoning `max`
- installed Pi SDK/TUI/AI: `0.84.0`

## Findings

### HIGH — Ambient shutdown removes the current Anthropic override, not the provider registration this instance actually owns

**Location:** `extensions/anthropic-attribution.ts:16-25`, especially line 25.  
**Contradicted authored claim:** `docs/subsystems/anthropic-attribution.md:16`.

The wrapper treats “no compatible claim responder existed before startup” as proof that its provider registration succeeded and remains the registration it owns. It then calls the name-wide API:

```ts
if (!existingOwner) pi.unregisterProvider('anthropic');
```

That ownership inference is not valid in the installed SDK:

- factory-time `registerProvider` is queued and applied later;
- `ModelRuntime.registerProvider()` merges into one provider-name entry;
- `ModelRuntime.unregisterProvider()` deletes the whole extension/native entry for that name, with no owner token or identity check.

Consequently:

1. A provider registered directly by an embedding SDK host before package load is not restored by a real enabled → disabled `AgentSession.reload()`; the dynamic host registration is deleted and only the built-in provider remains.
2. A legitimate dynamic owner that registers after this package is deleted by this package's shutdown callback.
3. If application of this package's queued provider registration fails, the package still publishes its claim and registers `/claude-cache`/hooks; shutdown then deletes the untouched host provider even though this instance never successfully installed a provider.

**Concrete actual-SDK repro (no model/network call):**

```text
./node_modules/.bin/tsx ../reports/feature-runtime-review/probes/provider-ownership.mts
```

Exit `0`; salient output:

```json
{
  "enabledToDisabled": {
    "hostRegistrationPresentAfterDisable": false,
    "extensionRegistrationPresentAfterDisable": false,
    "effectiveHostProviderRestoredByIdentity": false
  },
  "laterOwner": {
    "laterWasCurrent": true,
    "laterSurvivedPackageShutdown": false
  },
  "failedRegistration": {
    "packageRegistrationFailures": 1,
    "hostStillCurrentAfterFailure": true,
    "cacheCommandRegistered": true,
    "hostSurvivedPackageShutdown": false
  }
}
```

The first two branches use unmodified SDK registration/teardown. The third injects a provider-application failure into the real SDK path to exercise the failure invariant. Evidence: `provider-ownership.log`, SHA-256 `613fb148a10f8aa2eae20a9562dad55c06a0c974ea797448ff45acd0bb96acc6`.

This is a routing/auth ownership defect, not merely cleanup bookkeeping: disabling attribution can silently replace an embedding host's provider behavior. The existing feature test only proves fallback to the built-in provider; it does not seed a host-owned dynamic provider, a later owner, or registration failure. The accepted core attribution file remained untouched; resolution must preserve its required hash and establish source/instance-aware teardown at the wrapper/host boundary.

### MEDIUM — Process-only reconciliation deactivates unrelated tools that share a feature-controlled name

**Location:** `src/extension.ts:91-100` and `src/extension.ts:300-305`.  
**Contradicted authored characterization:** `docs/subsystems/host-ui-and-telemetry.md:24` calls these “stale” package names, but the implementation has no ownership check.

The final `session_start` handler filters active tools solely by string membership in `FEATURE_CONTROLLED_TOOL_NAMES`. With `PI_BG_FEATURES=process`, an unrelated extension's registered and active `bg_delegate` is removed even though this package did not register that tool. The same issue applies to every listed advanced name, including `fusion_brainstorm`.

**Concrete actual-SDK repro:**

```text
./node_modules/.bin/tsx ../reports/feature-runtime-review/probes/active-tool-collision.mts
```

Exit `0`; observed:

```json
{
  "definitionLabel": "External Delegate Fixture",
  "bgDelegateRegistered": true,
  "bgDelegateActiveBefore": true,
  "bgDelegateActiveAfter": false,
  "externalControlActiveAfter": true
}
```

Evidence: `active-tool-collision.log`, SHA-256 `654c49186f93045e914c4bc311b0015d438be3cc36ffa7a114c18c5fa9b4f1cd`.

Thus registration absence is correct for this package, but its reconciliation still disables another extension's executable/prompt-visible tool. Reconciliation needs package provenance/ownership, or must avoid deleting names it did not register.

## Invariant and ownership-delta review

| Area | Independent result |
|---|---|
| Defaults/parser | Pass: exact defaults are `process,delegate,fusion,attested,attribution` and `shift+down`; all 16 optional subsets and focused malformed/duplicate/whitespace/unknown/missing-process cases passed with no package registrations. |
| Surface absence | Pass for package-owned registrations: disabled tools, commands, renderers, providers, and dock shortcuts are absent, not inactive definitions. Finding 2 applies to unrelated same-name tools. |
| Shared result | Pass: inventory is exactly zero/one iff neither/either producer exists. Actual delegate-only (`process,delegate`) and Fusion-only (`process,fusion`) producer → `bg_result` retrieval each passed. |
| Child safety | Pass: ambient attribution can be off while the explicit child entry remains on; delegate/Fusion attribution precedes guards; attested argv uses the child entry. Accepted core hash remains `eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa`. |
| Shortcuts/footer | Pass: default/alternate/off registration, encoded dispatch, conflict fixture, `/tasks`/`/bg-tasks`, actual footer hints, and unconditional `ctrl+alt+c` passed. |
| Real reload/EventBus | Pass apart from Finding 1: enabled → disabled → re-enabled yielded claim acknowledgements `1,0,1` and exactly one process EventBus response in every state; no stale/duplicate service callback observed. |
| Auth/env/argv | Pass in focused delegate, Fusion, attested, and account-path controls; environment and `process.argv[1]` restoration passed. |
| Performance claim | Correctly absent. These flags still eagerly import advanced modules and make no P1 lazy-load/startup claim. |
| Ownership boundary | C1a changed only config/registration/facades/path wrapper. No registry/R1 execution lifecycle, Fusion engine, launcher, durability, or accepted attribution-core source was changed or globally certified. |

## Commands and exits

Every test/probe command below used this exact isolation prefix unless an inline feature value is shown:

```text
env TMPDIR=/private/tmp/pi-bg-closeout-iNoltL/tmp/feature-runtime-review HOME=/private/tmp/pi-bg-closeout-iNoltL/home/feature-runtime-review PI_CODING_AGENT_DIR=/private/tmp/pi-bg-closeout-iNoltL/agent/feature-runtime-review PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file
```

| Command after the prefix | Exit / observed result | Evidence SHA-256 |
|---|---:|---|
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/feature-selection-sdk.test.ts tests/unit/config.test.ts` | `0`, 12/12 | `fea8408252b62fd58d1ebdb7b00ffb5ade14d8954f1de8e5e34ef94efa880fcb` |
| `./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='adds package attribution to attested\|delegate child isolation\|loads package-owned Anthropic attribution\|resolves the package-owned global attribution\|builds exact v5 child argv' tests/unit/anthropic-attribution.test.ts tests/unit/delegate-launch.test.ts tests/unit/fusion-pi-child.test.ts tests/unit/fusion-v5-core.test.ts` | `0`, 15/15 | `340e1ffa51e96fb8832608301b79dca8e919952e628ff009382d81851bae6254` |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/sdk/anthropic-attribution-lifecycle.test.ts` | `0`, 1/1 | `fc8421939d26ed4b78dcea8379b908a5affd38e0cf102e0289e35f58383f88bf` |
| `PI_BG_FEATURES=process,delegate ./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='returns a launch receipt immediately and completes the whole loop' tests/sdk/delegate-sdk.test.ts` | `0`, 1/1 | `e7cd9cd193984515a53412e69236fcbfe655370c70bc2705440927366952296a` |
| `PI_BG_FEATURES=process,fusion ./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='BUG-182 returns exact merged text with host-valid usage' tests/sdk/fusion-sdk.test.ts` | `0`, 1/1 | `b4695acc03f167ffa4c9391e649766faeba9efb117a1e0ee10c99af8c6c7e6fc` |
| `PI_BG_FEATURES=process,delegate ./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='restores every mutated env key\|gives the child its own session and strips parent identity\|preserves the selected path in package-owned child environments\|strips metered API environment from attested Pi child process' tests/sdk/delegate-sdk.test.ts tests/unit/anthropic-attribution-config.test.ts tests/unit/registry.test.ts` | `0`, 4/4 | `bccb34f5c3398b524ac6db77eb948d327cda41dbd2d5bc1c93d5354828832170` |
| `PI_BG_FEATURES=process,fusion ./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='registers real public surfaces and /fusion launches a tracked background run' tests/sdk/fusion-sdk.test.ts` | `0`, 1/1 | `4de57f9aa04ca3f5cda9daa7cd2d3ef1e71ced1dc61d5204d87e4ec7f6c4fe7f` |
| `./node_modules/.bin/tsx ../reports/feature-runtime-review/probes/reload-eventbus-claims.mts` | `0`; claims `1/0/1`, responses `1/1/1` | `0b64f29fe193e58f0eaf3052ee6a99cbfbb4f386ba0f0849ac6f46c909943ba1` |
| `./node_modules/.bin/tsx ../reports/feature-runtime-review/probes/provider-ownership.mts` | `0`; reproduced Finding 1 | `613fb148a10f8aa2eae20a9562dad55c06a0c974ea797448ff45acd0bb96acc6` |
| `./node_modules/.bin/tsx ../reports/feature-runtime-review/probes/active-tool-collision.mts` | `0`; reproduced Finding 2 | `654c49186f93045e914c4bc311b0015d438be3cc36ffa7a114c18c5fa9b4f1cd` |
| `npm run typecheck` | `0` | `de7b3476a674364f1822569ad3668f3c2ef761c3963c8d06f19615e32b51519d` |
| `git diff --check bc25e9a..da2f6fc` | `0` | recorded in `source-hashes.log` |

The first draft of the active-tool probe used `.ts` with top-level await and exited `1` in the probe harness before package execution (`tsx` selected CJS); it was renamed to `.mts` and the exact successful rerun above produced the finding. Both attempts remain in the bounded log.

## Exact source hashes

```text
eada9afaa9105ce19106e82d63e111604d657985d8f18b7a22d5693a8feededa  src/core/anthropic-attribution.ts
24b368933cf9fe136cba3bb81505e872dcdc23fc8a0b17cccb90de35312c3111  src/core/config.ts
38ef27a8f8b7b8fd1c748ab88a046563078e0c21ad52749314b32a9dec8abab3  src/extension.ts
90e48139f0458f93b477cf0496a1f79b888d3bb84db76b1b2b372a1a9f6b3209  src/delegate-extension.ts
d3fe1fe28184b1946b5a9520303da380cccb15760bda915cb7b830ea9883241f  extensions/anthropic-attribution.ts
0fd201f40396980ff583dc72535d208511798a4d7901d3285faef0873d8511db  extensions/anthropic-attribution-child.ts
c883fbb410e69ba0733b40e6002f15f0c58f1a2cc33fbeb9602f7ea814fd8763  src/core/anthropic-attribution-path.ts
38d70dc6511cd35638ade7ec564e31748756eab5b5f6defe15ccda425488d382  tests/sdk/feature-selection-sdk.test.ts
689ba560039edd2a9a42928cafb0d08afb265a7160da6488a14211a6a1cf2be5  tests/unit/config.test.ts
```

Installed Pi 0.84.0 implementation hashes used for provider/lifecycle comparison:

```text
2557e5874a8d56b93c6cfe36207f1d52040ce6ac587b60491ed69a68047bed0d  dist/core/model-runtime.js
0fd56e37765a0e436d8f55d7ca8c76ab933c41e1bd4974a5fe2cbba690cde900  dist/core/extensions/loader.js
b39d59b8f86693b9aca15f13e14f367fce9a0ad8ed7ce9ad17950906f226951d  dist/core/extensions/runner.js
91e72d5497f665e731cbd79da6a6e826d8cae7d2ce156a7dee39f8ca205e32c8  dist/core/agent-session.js
```

## Qualification gaps and integration debt

- I did not run the broad unit/release matrix. I independently reproduced the reported inherited integration failure with:

  ```text
  ./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='produces a direct-spawn attested Pi sidecar' tests/unit/registry.test.ts
  ```

  It exited `1` at `tests/unit/registry.test.ts:1231`: expected bare `pi`, observed canonical `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`. This is the stale L1/registry assertion, not permission to weaken the canonical executable resolver. The harness used a fake child and its `finally` removed its temporary root; no OS child or task artifact survived. Evidence SHA-256: `36470504d6429e5c73d565f4b60fbe2ffcd30fb3961feb4ad7b3a25150e1f0e0`.
- The worker's transient generated-doc staleness was not re-created or semantically certified; docs-engine semantic review is a separate lane.
- Qualification is local macOS/Node with Pi SDK 0.84.0. No native Windows, compiled Bun, real terminal/PTTY, older Pi line, live provider, or external-network claim is made.
- No broad R1 lifecycle/publication claim is made; R1 changes are not merged.

## Cleanup

- No production source, docs, tests, index, history, parent, or worktree file was modified.
- Worktree status remained the pre-existing untracked `node_modules` symlink only.
- Review artifacts are confined to `reports/feature-runtime-review/`; mechanical `tmp`, `home`, and `agent` review roots were emptied after execution.
- No surviving test/probe subprocess, watcher, server, package child, `.pi` task tree, or external install was observed.
