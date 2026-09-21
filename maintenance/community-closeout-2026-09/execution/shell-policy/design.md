# C1b issue #11 shell-policy design

## Scope and baseline

- Worktree: `/private/tmp/pi-bg-closeout-iNoltL/shell`, branch `closeout/shell`, baseline `ab474d649274b6722abe7ed290c3f51c72236f69`.
- Effective route verified before inspection: `openai-codex/gpt-5.6-sol`, reasoning `max`.
- This slice implements only C1.3 shell resolution, task-policy observability, telemetry eligibility, and a dedicated agent-guidance hook. It does not alter R1 admission/publication/termination design or C1a feature/capability/shortcut registration.
- Default compatibility is mandatory: on non-Windows, a non-empty inherited `SHELL` remains the executable and `/bin/sh` remains the fallback; both receive `-c`. Windows keeps the existing `PI_BG_SHELL`, `PI_BG_SHELL_PATH`, `ComSpec`, cmd quoting, and `windowsVerbatimArguments` behavior.

## Immutable activation policy

Resolve exactly one frozen shell-policy object while the extension factory is activated, before registry construction or surface registration. Pass that same object to the dedicated `before_agent_start` guidance registrar and to `BackgroundTaskRegistry`. Direct registry consumers resolve once in the constructor unless they inject a policy explicitly. Later mutation of shell-selection environment variables cannot change an activation; a real Pi reload creates a new extension instance and resolves a new policy.

The observable policy contains only non-secret launch facts:

```ts
{
  policy: "inherit" | "bash" | "sh" | "cmd",
  executable: string,
  argvPrefix: readonly string[],
  dialect: "bash" | "posix" | "cmd" | "user-non-posix"
}
```

An internal frozen capability, `supportsPosixFunctionWrapper`, controls telemetry wrapping. Ordinary shell task snapshots and durable task metadata carry the public policy facts. This is an additive optional field on `BgTaskSnapshot`, so existing v1 request frames and capabilities remain closed and unchanged; EventBus responses/terminal frames can observe the same additive task fact that `bg_run` details and metadata expose. Delegate, Fusion, managed, and attested direct-spawn tasks do not claim an ordinary shell policy.

## POSIX resolution

`PI_BG_POSIX_SHELL` is read only on non-Windows:

- unset: `inherit`;
- `inherit`: preserve the exact legacy executable choice, non-empty `SHELL` else `/bin/sh`, and use `-c`;
- `bash`: use a valid explicit `PI_BG_POSIX_SHELL_PATH`, else search executable `/bin/bash` first and then `bash` in `PATH` order;
- `sh`: use a valid explicit path, else search executable `/bin/sh` first and then `sh` in `PATH` order.

Any present value other than exact `inherit`, `bash`, or `sh`, including an empty or whitespace-padded value, fails with `pi_bg_shell_invalid`. `PI_BG_POSIX_SHELL_PATH` is legal only with explicit `bash` or `sh`; it must be non-empty, absolute, resolve via `stat` to a regular file, and pass execute access. A bad explicit override fails without search fallback. It is used only as the structured spawn executable and never interpolated into the command.

PATH candidates are checked as regular executable files. Relative PATH entries are resolved against activation cwd before validation so the selected executable does not drift when task cwd differs. Empty entries are skipped. Search failure reports bounded candidate diagnostics and never substitutes another dialect.

Inherited shell classification is conservative. Basename `bash` is Bash; reviewed Bourne-family names (`sh`, `dash`, `ash`, `ksh`, `ksh93`, `mksh`, `pdksh`, `zsh`, `yash`, `posh`) are POSIX-function compatible; `nu`, `fish`, `csh`, `tcsh`, and every unknown basename are `user-non-posix`. Inherit deliberately does not add validation or fallback, preserving legacy spawn behavior. Explicit `bash` and `sh` are classified according to the requested route after executable validation.

Windows ignores both new POSIX variables, including malformed values. Its existing policy is represented observably as cmd or Bash without changing invocation bytes.

## Invocation and telemetry

`common.ts` owns pure resolution, executable checks, dialect classification, and invocation construction. Registry shell launch uses `shellInvocationForPolicy(command, immutablePolicy)` both before and after any telemetry transformation, so it cannot re-read mutated shell variables.

Telemetry function injection is permitted only when `supportsPosixFunctionWrapper` is true. `isAgent:false` and disabled/non-matching agent commands remain unchanged. A matching `isAgent:true` command under cmd retains the existing Windows diagnostic. A matching command under `user-non-posix` remains unwrapped and records a new truthful diagnostic; no Bash/POSIX function is injected into Nu, fish, csh, or an unknown shell.

## Agent-visible guidance and hook composition

A new small `src/core/shell-policy.ts` module owns policy formatting and the dedicated hook registrar; the authored runtime doc will claim this source in frontmatter. `src/extension.ts` receives only a minimal import, one initialization/registration call, and the registry option.

The guidance is installed through `before_agent_start`, before model command generation. It states the exact executable, dialect, and structured args (`argvPrefix` plus `<command>`), says whether Bash syntax is valid, and for inherited non-POSIX shells gives the explicit reload-time remediation `PI_BG_POSIX_SHELL=bash` (optionally with the absolute path override).

Composition must work on both the package's Pi 0.84 SDK and installed Pi 0.86 behavior:

- where structured `systemPromptOptions.sections` exists, set a uniquely named shell-policy section;
- if another handler has already forced a full prompt, append/replace the shell section in that forced prompt too;
- on older SDKs without structured sections, return a replacement derived from the current chained `event.systemPrompt`;
- use stable markers/idempotent replacement so duplicate registration cannot duplicate guidance.

A real SDK test loads a separate feature/background guidance fixture before and after this package and proves both guidance blocks reach the provider in either load order. This seam does not edit C1a's future feature-guidance block.

## Red-first test plan

Add tests before production changes, then run them against baseline and preserve logs under `/private/tmp/pi-bg-closeout-iNoltL/reports/shell-policy/`.

1. New pure shell-policy unit tests: default parity, inherited Bash/zsh/fake Nu, missing `SHELL`, explicit Bash/sh, `/bin` then PATH order where controllable, valid custom paths containing spaces/Unicode, relative/empty/non-regular/non-executable overrides, unknown/empty modes, immutable policy after env mutation, and unchanged Windows cmd/Bash/POSIX-knob controls.
2. Focused registry additions: exact spawn executable/argv equals task policy, durable metadata/snapshot policy equality, fake Nu skips telemetry with the non-POSIX diagnostic, script (`isAgent:false`) remains unwrapped, and existing Windows cmd/Bash behavior remains intact.
3. New focused SDK test: activation captures a fake shell, post-activation env mutation does not drift, and actual `AgentSession.reload()` refreshes the selected executable.
4. New scripted-provider test and provider fixture: provider reads guidance, emits a `bg_run` command carrying spaces/Unicode, the selected executable records real argv and runs the command, and the returned task policy plus output/argv witness match the guidance. A fake executable named `nu` proves inherited Nu classification/argv without claiming native Nu support; a real explicit Bash route proves actual Bash execution. Feature-guidance fixture ordering proves hook composition.

Expected baseline reds: no POSIX policy parser, explicit selection ignored, inherited fake Nu mislabeled/wrapped as POSIX, no shell policy in snapshots/metadata, no shell guidance, activation env mutation changes later spawns, and reload has no policy refresh contract. Existing default and Windows controls should remain green.

## Documentation and validation

Authored updates are limited to background runtime, host/guidance, configuration, `bg_run`, and `/bg`. They document default compatibility, exact search/validation, no login shell, immutable activation/reload semantics, non-POSIX guidance/remediation, telemetry capability, metadata observability, and Windows isolation. Generated index/read-gate/manifest/README regions are changed only by `npm run docs:generate`; no attestation is self-awarded.

Focused green gates use Node 22.19 with isolated `TMPDIR`, `HOME`, and `PI_CODING_AGENT_DIR` roots under `/private/tmp/pi-bg-closeout-iNoltL/{tmp,home,agent}/shell-policy`, plus `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 CI=1 GIT_ALLOW_PROTOCOL=file`. Run shell/core/registry, new SDK/scripted-provider proofs, relevant existing launch/telemetry/Windows controls, typecheck/type-safety, docs generate/verify, and payload checks. No full repository test run, installs, network, native-Nu claim, or native-Windows claim.
