# Independent C1b shell-policy runtime/guidance review

- Review time: 2026-09-20 UTC
- Target: `5a30cd022862f720432c68e36b393a019339dd0f` (`d4942465b04fbcaa469714e4dae134684193415a` tree)
- Base: `ab474d649274b6722abe7ed290c3f51c72236f69` (`b7a575c05b491fb094bd0eb0c3a2413508b4788f` tree)
- Diff: 30 files, +1647/-124
- Reviewer route: `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-5.6-sol`, `PI_REASONING_LEVEL=max`
- Primary tested host: Darwin arm64, macOS 15.7.3; Node 22.19.0 and 24.16.0

## Verdict

**PASS for the C1b target diff, with no C1b code finding.** The compatible default, explicit shell selection, execution/receipt/guidance identity, non-POSIX telemetry refusal, actual Pi hook composition, and real reload refresh all held under independent execution.

This is **not** an all-repository-green or cross-platform certification: `npm run test:docs` has one inherited base failure, and native Windows and native Nushell were unavailable. Pi 0.86 evidence is supplemental only; the package peer range remains through Pi 0.84.

## Findings

### C1b code findings

None.

### Inherited red gate — not introduced by C1b

- **Classification:** inherited/base issue, not charged to this diff
- **Files:** `tests/package/docs-contract.test.ts:61`, `docs/api/eventbus-v1.md`
- **Reproduction:** `npm run test:docs`
- **Result:** exit 1; 4/5 tests pass. The test requires `/later requests are not handled/`, while the API doc says “requests first emitted after close are not handled.”
- **Attribution proof:** `git diff --quiet ab474d6..5a30cd0 -- docs/api/eventbus-v1.md tests/package/docs-contract.test.ts` exits 0. Both base and target have expectation count 1 and exact-doc-phrase count 0. See `inherited-docs-red-proof.log` and `node22-docs-tests.log`.

This does not indicate an R1 runtime regression; the affected files are byte-unchanged by C1b, and the focused R1/EventBus runtime controls passed.

### Process/evidence facts

1. The implementation worker did **not** create the promised `/private/tmp/pi-bg-closeout-iNoltL/reports/shell-policy/report.md`. Only design, logs, hashes, and probes exist. This is a process omission, not a code defect.
2. The retained baseline-red log covers six early unit cases (2 pass, 4 fail). Four later-added unit cases plus SDK/scripted-provider tests have no retained baseline-red execution. Target behavior was therefore re-established independently rather than inferred from the commit or worker “green” filenames.
3. The worker's first broad core/registry run had 56/57 pass because an intermediate implementation resolved invalid Windows Bash in the registry constructor. The final source changed direct registry resolution to a frozen-env, first-task resolution; the later 113/113 focused unit log and this review's 87/87 run are green.

## Source review

### Policy and invocation

- `src/core/common.ts:639-653` defines the optional public snapshot and private capability-bearing resolved policy.
- `src/core/common.ts:769-912` validates explicit POSIX paths as absolute regular executable files, checks `/bin/<name>` before PATH, resolves relative PATH directories against activation cwd, classifies inherited basenames conservatively, and freezes the result/argv prefix.
- `src/core/common.ts:821-912` preserves non-Windows default bytes: exact non-empty `SHELL`, otherwise `/bin/sh`, with `-c`. `inherit|bash|sh` is strict; empty, padded, unknown, relative, missing, directory, and non-executable explicit values fail without fallback.
- `src/core/common.ts:821-868` retains the Windows `PI_BG_SHELL`, `PI_BG_SHELL_PATH`, `ComSpec`, cmd quoting, and `windowsVerbatimArguments` routes while ignoring both POSIX variables on Windows.
- `src/core/common.ts:914-927` builds structured argv from the already-resolved policy; no executable path is interpolated into command text.

### Single activation identity and metadata

- `src/extension.ts:211-232` resolves once before registration, installs one dedicated hook, and injects the same object into `BackgroundTaskRegistry`.
- `src/core/registry.ts:1205-1293` uses that policy for base and wrapped invocations, persists a frozen non-secret snapshot, and chooses telemetry from `supportsPosixFunctionWrapper`, not a generic non-Windows label.
- `src/core/common.ts:73` makes `shellPolicy` optional on `BgTaskSnapshot`; `src/core/common.ts:969` carries it through snapshots. Ordinary shell tasks emit it; managed/delegate/attested tasks do not falsely claim one.
- EventBus request/capability schemas and `src/core/extension-api.ts` are unchanged. Existing closed-request tests and old snapshot consumers passed. The new task member is additive/optional at the TypeScript contract and truthful in response, terminal, tool details, and durable metadata.

### Guidance and hook composition

- `src/core/shell-policy.ts:35-65` emits only policy, selected executable, dialect, and argv shape, plus dialect-specific advice.
- `src/core/shell-policy.ts:74-110` idempotently replaces a uniquely marked legacy block; on structured hosts it owns `pi_background_shell_policy` and also updates an already-forced full prompt.
- `src/core/shell-policy.ts:113-131` provides the dedicated handler/activation initializer.
- Pi 0.84's actual chained-string runner and Pi 0.86's structured-section runner were inspected. The implementation follows each host's real dispatch behavior rather than only testing a formatter.

## Independent runtime proof

### Execution = guidance = receipt

1. **Inherited fake Nu, Pi 0.84 actual provider, both hook orders:** the scripted provider observed `policy=inherit`, the exact fake executable, `dialect=user-non-posix`, and `args=["-c","<command>"]`; peer feature guidance survived. The real executable received exactly `['-c','shell_policy_probe Ω with spaces']`, completed, wrote its witness, and metadata/task receipt matched guidance.
2. **Explicit Bash:** the actual provider observed `/bin/bash`, `dialect=bash`, `['-c','<command>']`; the task receipt matched and a real Bash command emitted `real bash selected Ω with spaces`.
3. **Agent-marked fake Nu:** independent real-process probe launched `pi -p telemetry-proof` through an executable named `nu`. It received exactly `['-c','pi -p telemetry-proof']`; no function prelude or wrapper file existed; metadata recorded `user-non-posix-shell-cannot-safely-intercept-pi-argv`. Only `.json` and `.output` task files were present.
4. **Secret control:** a separate sentinel environment value was absent from guidance and policy; only the selected executable was exposed.

Evidence: `node22-scripted.log`, `fake-nu-agent.log`, `tests/scripted-provider/shell-policy-guidance.test.ts:178-265`, and `tests/unit/shell-policy.test.ts:268-319`.

### Telemetry truth

- `isAgent:false`, interceptable bare `pi`, path-qualified Pi, global telemetry opt-out, inherited non-POSIX, Windows cmd, and compatible POSIX wrapper controls all passed in the full registry file.
- The full SDK control also passed both synthetic task-owned telemetry and an actual offline child Pi JSON/tool telemetry run.
- Non-POSIX policy never calls `resolvePiLaunch()` for wrapping and never writes/injects the POSIX function. Compatible inherited Bourne-family policy still wraps.

Evidence: `node22-unit-controls.log` (87/87) and `node22-sdk.log` (22/22, 0 skipped).

### Reload and duplicate-handler control

- The committed SDK test used real `AgentSession.reload()`: mutation from one fake shell to another did not affect the first activation; reload selected the second executable; each real argv witness and terminal receipt matched.
- An independent model-visible reload probe observed the first `nu` policy, then the second `fish` policy after real reload. Each provider prompt contained exactly one shell-policy marker and exactly one peer-guidance block—no stale policy and no duplicate handler effect.

Evidence: `tests/sdk/shell-policy-sdk.test.ts:109-214`, `node22-sdk.log`, and `reload-guidance.log`.

### Actual Pi hook composition

- Pi 0.84 scripted-provider tests passed with peer guidance registered before and after this package (3/3 shell scenarios).
- Independent Pi 0.86 execution passed both orders using real structured sections/forced-prompt chaining, real fake-Nu spawn, terminal metadata, and provider-observed prompt. Each case made two provider calls and preserved both guidance blocks.
- Pi 0.86 remains supplemental: no peer-range or support claim was changed.

Evidence: `node22-scripted.log` and `host086-independent.log`.

## Commands and outcomes

All mechanical runs used isolated roots under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/shell-policy-review` and `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`.

| Command | Runtime | Exit | Result |
|---|---:|---:|---|
| `tsx --test --test-concurrency=1 tests/unit/{shell-policy,core,posix-invariance,registry,windows-taskkill,extension-api}.test.ts` | Node 22.19.0 | 0 | 87/87 |
| `tsx --test --test-concurrency=1 tests/sdk/{shell-policy-sdk,lifecycle-sdk,sdk}.test.ts` | Node 22.19.0 | 0 | 22/22, 0 skipped |
| `tsx --test --test-concurrency=1 tests/scripted-provider/{shell-policy-guidance,follow-up}.test.ts` | Node 22.19.0 | 0 | 8/8 |
| focused new unit + SDK + scripted files | Node 24.16.0 | 0 | 14/14 |
| `npm run typecheck` | Node 22.19.0 | 0 | clean |
| `npm run test:type-safety` | Node 22.19.0 | 0 | 4/4 |
| `npm run docs:verify` | Node 22.19.0 | 0 | 31 surfaces, 51 sources, deterministic; attestations advisory |
| `npm run payload:check` | Node 22.19.0 | 0 | 107 packed files |
| `npm run test:docs` | Node 22.19.0 | 1 | 4/5; inherited mismatch described above |
| independent real fake-Nu agent telemetry probe | Node 22.19.0 | 0 | no wrapper; truthful reason/metadata |
| independent real reload prompt probe | Pi 0.84 / Node 22.19.0 | 0 | 2 activations; marker counts 1/1 |
| independent structured prompt/spawn probe | Pi 0.86 / Node 24.16.0 | 0 | 2/2 registration orders |
| cached Pi 0.81.1/0.82.1 hook surface inspection | Node 24.16.0 | 0 | both carry `systemPromptOptions`; no execution qualification |
| `git diff --check ab474d6..5a30cd0` | — | 0 | clean |
| worker `source-hashes.txt` verification | — | 0 | 30 file hashes OK; expected warning for trailing non-hash `commit ...` marker |

Detailed logs and the exact independent probe sources are in this report directory.

## Retained worker evidence reconstruction

No PASS was inferred from filenames. Content inspected:

- `red-shell-unit.log`: baseline 2/6 pass, 4/6 fail for explicit selection, Nu identity, malformed config, and unsafe Nu wrapper; default/Windows controls pass.
- `green-focused-unit-final.log`: 113/113 pass, including full registry, EventBus, launch, POSIX invariance, Windows helper, and shell policy.
- `postcommit-shell-focused.log`: 14/14 pass.
- `green-shell-sdk-final.log`: 1/1 real reload pass.
- `green-shell-scripted-final-2.log`: 3/3 actual provider/spawn pass.
- `green-existing-sdk-controls-attempt1.log`: 5/5 existing lifecycle/telemetry controls pass.
- `green-scripted-and-r1-controls-attempt1.log`: 8/8 completion + shell scripted controls pass.
- `postcommit-typecheck.log`, `type-safety-final-2.log`, `postcommit-docs-verify.log`, and `payload-check-final.log`: exits/results match the independently repeated gates.
- `green-docs-tests-attempt1.log`: 4/5, with the same inherited EventBus prose expectation; it was not silently counted green.
- Worker hashes match target bytes for all 30 listed files.

## Documentation/API inventory

- Operator knobs are present in authored configuration and generated runtime inventory: `PI_BG_POSIX_SHELL` and `PI_BG_POSIX_SHELL_PATH` appear in `docs/operations/configuration.md:26-41` and generated `docs/reference/runtime-contracts.md`.
- Runtime behavior, telemetry capability, metadata, and Windows isolation are documented in `docs/subsystems/background-task-runtime.md:43-69`.
- Actual model guidance is documented in `docs/subsystems/host-ui-and-telemetry.md:23-27`.
- Tool/command behavior is documented in `docs/tools/bg_run.md:109-162` and `docs/commands/bg.md:39-79`.
- `src/core/shell-policy.ts` has one generated primary owner in `docs/read-before-edit.md` and `docs/manifest.json`.
- Generated verification and payload closure pass; no semantic attestation was self-awarded. Changed authored docs remain correctly represented as stale for independent semantic receipt purposes.

## C1a merge-seam assessment

Read-only seam inspection used C1a head `c4eb78cd0c95d36a7bfd346dfbdba3cf1fe03541`; C1a was not reviewed or modified.

- C1b's production overlap with C1a is only the small `src/extension.ts` seam: imports, one activation policy, one dedicated hook, and the registry option. C1a's feature/background entrypoint currently has no `before_agent_start` handler, so there is no present feature-guidance replacement conflict.
- Correct semantic composition is straightforward: parse C1a's strict feature/shortcut config and initialize C1b's shell policy before any registration; retain the dedicated shell handler; pass the policy to the process registry. `process` is mandatory in C1a, so shell guidance remains relevant in every valid feature set.
- Environment names are disjoint (`PI_BG_FEATURES`/`PI_BG_DOCK_SHORTCUT` versus `PI_BG_POSIX_SHELL*`), and the shell variables do not collide with the finite C1a capability grammar.
- C1a is based on `bc25e9a`, while C1b is based on later accepted R1 `ab474d6`; a blind branch merge produces textual conflicts in `src/extension.ts`, authored docs, and generated docs. This is integration work, not a semantic blocker. Preserve the accepted R1 lifecycle source, compose the small extension seam, merge authored prose, then regenerate INDEX/read-gate/manifest/provenance once.
- Future feature guidance should continue to chain from the current prompt or use its own structured section. C1b's unique section and legacy upsert are order-safe for cooperative handlers, as proven with actual hosts.

## Qualification limits

- No native Nushell executable was available. Fake executables prove exact argv, identity, guidance, spawn, output, receipt, and telemetry refusal; they do not certify native Nu syntax.
- No native Windows or PowerShell/pwsh was available. Windows cmd/Bash/POSIX-knob and taskkill behavior here is source review plus mocked platform controls, not native certification.
- Pi 0.84 is the package dependency and fully exercised host. Pi 0.86 structured behavior is supplemental only. Cached 0.81.1/0.82.1 source confirms the fallback hook inputs exist, but those versions were not installed/executed in this review.
- No external network, live provider, paid API, Fusion, subagent, install, publish, push, GitHub action, or user auth/session state was used.

## Source hashes

```text
69df7491a20fff865873f854e47a2e3b3d6fc9d2f403cf20a141daf2fe7dbfbc  src/core/common.ts
704c7dba7f76f88cb8239272476429634f5da3ca877deca0583e9038721b546c  src/core/registry.ts
ad2cbad9fa0067019e49fdf740daa06e3ee0701e990ce3c0337ccbf1b813bfcc  src/core/shell-policy.ts
dbeaf04f1f89c4dad25de17c3ed49d3c16404dcc47b8de233b8e35c719ff4aa7  src/extension.ts
80506658d086a99c3added4bb2233e580edccda39465dbf213b467561bc3331c  tests/unit/shell-policy.test.ts
57bfebc4a4d2975d8f287578a4363cd9a2e6dfb2d63e63acbd73626f255273c2  tests/sdk/shell-policy-sdk.test.ts
912d25daa0d7fa6733e61fd104457d64c5ca5e32593df72e1e70a78e6df638f5  tests/scripted-provider/shell-policy-guidance.test.ts
ed9a8dead47bdb3f5f696e95dee83a8ba844e13566f30b32417afc4ba404a6e8  docs/manifest.json
```

## Cleanup and boundary

- Final worktree status remains `?? node_modules` only; it is the pre-existing read-only dependency symlink and was not staged, removed, or followed for deletion.
- No target source, docs, tests, index, history, other worktree, parent, or main checkout was written.
- Owned report/probe material is well below 200 MiB. Owned TMP/HOME/agent mechanical roots were emptied after testing.
- No review-spawned child remains; the only matching processes at closeout are the active reviewer Pi process and its telemetry wrapper parent chain, which terminate with this review response.
- No fixes or attestation stamps were made.
