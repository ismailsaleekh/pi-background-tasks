---
doc_id: subsystems/attested-pi-runs
audience: maintainer
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [src/core/attested-pi-contract.ts, src/core/attested-pi-run.ts]
---
# Attested Pi runs subsystem

This document is the primary behavioral owner for `src/core/attested-pi-contract.ts` and `src/core/attested-pi-run.ts`.

It does **not** claim ownership of shared registry, Pi-launch, common task, or durable-fs modules. Those modules spawn the prepared request, store task metadata, publish terminal state, and provide atomic write primitives used by this subsystem.

## Purpose

Attested Pi runs are opt-in local-evidence tasks for a structured child Pi invocation. The `bg_run_pi_attested` tool is registered only when `PI_BG_FEATURES` includes `attested`; that capability is independent of delegate, Fusion, and ambient attribution. They are intended for cases where an operator wants local hashes and observed route/auth/session facts, not just a background output file.

They do not replace ordinary `bg_run`, and they do not provide remote cryptographic proof.

## Structured request and argv

The request shape is:

- `name`
- `provider`
- `model`
- `prompt`
- `reportPath`
- optional `extraPiArgs`
- optional `thinking`
- optional `timeoutSeconds`

Validation rejects blank `name`, `provider`, `model`, `reportPath`, and empty `prompt`. `reportPath` must resolve inside task cwd and may not target `.git` or `.pi/tasks`.

The logical argv always begins:

```text
pi --mode json --provider <provider> --model <model>
```

For an Anthropic request, the package then adds `--extension <package-owned-anthropic-attribution-child>` before optional thinking. This resolves the always-on child entrypoint and remains mandatory even when parent ambient attribution is disabled. Next come optional `--thinking <thinking>`, literal `extraPiArgs`, and the prompt as the final user prompt argument. Forbidden extra args are direct auth (`--api-key`, `--auth-file`), mode/print (`-p`, `--print`, `--mode`), and duplicate structured fields (`--provider`, `--model`, `--thinking`). Missing attribution bytes refuse an Anthropic launch before task creation.

The registry launches exactly one child through the resolved Pi executable with `shell:false`. The attestation records the stable logical argv (`['pi', ...]`), including any package-owned attribution extension, not platform-specific Windows Node/CLI shims. Attested tasks are created with generic background completion notification/wake disabled; terminal snapshots are still published through the task system.

## Auth and environment boundary

The child environment removes direct/metered API configuration:

- `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`
- `PI_API_KEY`, `PI_API_BASE_URL`, `PI_AUTH_FILE`

The producer observes auth through the model registry before spawn. The selected model must exist and `ModelRegistry.isUsingOAuth(selected)` must be available and true. Current accepted provider classes are:

- `openai-codex` → `pi-codex-oauth`, `subscription-codex`;
- `anthropic` → `pi-anthropic-oauth`, `subscription-anthropic`.

Any unsupported provider or non-OAuth route fails before attestation.

## Event parsing and observed route

Raw child stdout is captured as Pi JSON events. A successful stream must be newline-terminated and contain:

- exactly one `session` with id/cwd;
- exactly one `agent_start`;
- at least one assistant `message_end`;
- exactly one `agent_end`;
- the last assistant `stopReason` value reported in the stream is `stop`; messages that omit `stopReason` do not replace an earlier reported value;
- stable assistant provider/model across assistant messages;
- no assistant error.

The parsed provider/model must match the model selected from the registry. Token usage, cost total when present, tool usage, and a human transcript are derived from these events.

## Git authority

Before spawn, the subsystem records:

- git `HEAD` commit;
- git `HEAD^{tree}`;
- `git status --porcelain=v1 --untracked-files=all` cleanliness;
- repository root realpath;
- cwd realpath.

Startup Git commands share the admission's overall 30 second deadline and cancellation signal. Each command captures at most 4 MiB per stdout/stderr stream; crossing that limit fails explicitly rather than constructing authority from truncated bytes. Git is direct-spawned in a detached process group on POSIX. Admission cancellation or deadline sends TERM and then force-cleans that same group; Windows uses the shared bounded `taskkill /T` then `/T /F` helper. The producer waits for the direct Git child `close` before releasing admission ownership, and cancellation/timeout errors remain distinct from a genuine non-repository/nonzero Git result. There is no empty-authority fallback.

The deadline bounds when process-tree termination begins; it cannot make an OS reap an uninterruptible process. If the kernel never reports child close even after force termination, admission drain continues to wait rather than claiming a fictitious reap or releasing an unowned late child. The real subprocess regression qualifies the ordinary local process-tree case, while Windows behavior is mock/injected coverage rather than a native-Windows claim.

The worktree must be clean at start. On successful child completion, finish commit/tree/cleanliness are checked again under the same bounded Git-command policy. Changed commit/tree or dirty worktree prevents attestation.

## Files and hashes

Runtime paths are allocated by the background registry under `.pi/tasks/<session-id>-<pid>/`:

- `<task-id>.output`
- `<task-id>.json`
- `<task-id>.pi-events.jsonl`
- `<task-id>.stderr`
- `<task-id>.pi-telemetry-wrapper.cjs`
- `<task-id>.attestation.json`

The wrapper file is a note that the task is direct-spawned and no shell telemetry wrapper is used. The sidecar hashes metadata, output, events, stderr, wrapper, prompt bytes, and the required report file.

The sidecar schema is `phase2.pi_task_attestation.v1`. It includes locator, source hashes, lifecycle, invocation/auth facts, git authority, artifact hashes, and a self hash (`attestation_sha256`) over canonical sidecar content excluding that self field.

## Durability and visibility

Initial output/events/stderr/wrapper files and metadata are created before spawn. Those admission-time durable writes receive admission cancellation, close any opened handle, and remove uncommitted temporary/partial task artifacts before the admission can drain. Cancellation overlapping an atomic rename completes the directory-durability phase before it reports that the replacement may have become visible; registry cleanup then removes the pre-insertion task artifact. On close, stdout/stderr buffers are fsynced to the events/stderr files. Successful event parsing rewrites task output from the parsed transcript; failures write diagnostics/stderr output.

For a completed child with parsed events, the registry asks this subsystem to build the attestation, then writes `<task-id>.attestation.json` using durable atomic replacement. Only after that write returns does the registry set in-memory `task.status` to `completed` and publish terminal state. The metadata file may receive a completed snapshot earlier in this path; terminal in-memory/UI visibility is held until after sidecar durability.

## Failure and no-partial-sidecar behavior

No successful sidecar is emitted when:

- request validation fails;
- route/auth observation fails;
- worktree is dirty at start;
- Git preflight is cancelled, exceeds its deadline/output cap, or returns a genuine Git/non-repository error;
- child spawn fails;
- child exits non-zero, times out, or is killed;
- stdout events are malformed, incomplete, not newline-terminated, route-drifted, or the last reported assistant stop reason is not `stop`;
- the expected report file is missing/unreadable;
- git authority changes or finish worktree is dirty;
- attestation construction or durable sidecar write fails.

Raw evidence files remain for diagnosis. Sidecar final-name writes use atomic replacement, so ordinary write failures do not create a truncated final sidecar that looks complete. If sidecar construction/write fails after earlier metadata work, the task is marked failed.

## Trust boundary

The sidecar is unsigned local evidence in a same-user-writable working tree/task store. It states what this extension observed and hashed locally. It is not a signature, not tamper-proof, not a remote cryptographic proof, and not evidence against an attacker who can modify the repository or `.pi/tasks` artifacts.

## Maintainer checklist

When changing this subsystem, re-check:

- forbidden auth/mode/provider/model/thinking args;
- OAuth-only observation and provider class mapping;
- stripped metered environment keys;
- JSON event strictness and route consistency;
- git clean/commit/tree checks at start and finish, including bounded cancellation/tree reaping;
- prompt/report/events/stderr/output/wrapper/metadata hash coverage;
- sidecar write ordering relative to terminal visibility;
- no sidecar on failure paths.
