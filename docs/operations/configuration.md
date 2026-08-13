---
doc_id: operations/configuration
audience: maintainer
mode: authored
review_policy: contract
stability: stable
covers_surfaces: []
covers_sources: []
---
# Configuration

This page lists operator-facing configuration found in source. It intentionally does not invent undocumented environment variables.

## Update check

At `session_start`, the extension performs a one-shot, time-boxed npm latest-version lookup. Failures are offline-safe: the footer simply shows no update segment.

| Variable | Effect |
|---|---|
| `PI_BG_DISABLE_UPDATE_CHECK=1` | Skip the update check. |
| `PI_OFFLINE=1` | Skip the update check. |
| `PI_BG_REGISTRY_URL=<url>` | Use a registry mirror instead of `https://registry.npmjs.org`. |

`/bg-update` only prints update commands; it does not install or self-update.

## Shell selection

### POSIX

For ordinary `bg_run` and `/bg` shell commands, non-Windows platforms use `SHELL` when it is set, otherwise `/bin/sh`.

### Windows

Windows defaults to `cmd.exe`/`ComSpec`. The generic `SHELL` variable is ignored on Windows so existing `cmd` syntax does not silently change language.

| Variable | Effect |
|---|---|
| `PI_BG_SHELL=cmd` | Use Windows `cmd` dialect. |
| `PI_BG_SHELL=bash` | Use POSIX-style `bash -c` on Windows. |
| `PI_BG_SHELL_PATH=<absolute .exe/.com>` | Explicit shell path; requires `PI_BG_SHELL`. |

Invalid Windows shell settings fail loudly instead of falling back. `bash` is invoked with `-c`, not `-lc`.

## Output and log caps

| Setting/surface | Value/behavior |
|---|---|
| `PI_BG_MAX_OUTPUT_BYTES` | Optional environment override for task output cap. Default is 20 MiB. Exceeding it fails/kills the task rather than claiming success. |
| `bg_logs.maxBytes` / `/logs <id> [maxBytes]` | Bounded model-visible read. The package cap is 50 KiB. |
| Full output | Written under `.pi/tasks/<session-id>-<pid>/<task-id>.output`. |

Bounded logs are for context safety; they point to the full local output file when more bytes exist.

## Pi-agent telemetry opt-out

| Variable | Effect |
|---|---|
| `PI_BG_DISABLE_PI_TELEMETRY=1` | Do not wrap shell commands that appear to launch `pi -p ...` or `pi --mode json ...` when `isAgent:true`. Raw stdout is preserved. |

Telemetry wrapping is best-effort and task-owned. Missing telemetry is reported as unavailable, never as zero. Under Windows `cmd`, safe interception is unavailable and the command is left unchanged.

## Global Anthropic attribution and caching

Normal package installation loads the package-owned Anthropic attribution/sanitization extension before the background-task extension. Non-Anthropic sessions are unchanged. Anthropic sessions require Pi's subscription OAuth route; the provider refuses metered Anthropic credentials and reads `userID` plus `oauthAccount.accountUuid` from `~/.claude.json` without writing it.

| Variable/command | Effect |
|---|---|
| `PI_CACHE_RETENTION=long` | Default to one-hour Anthropic cache breakpoints where the model supports them. This is the package default when unset. |
| `PI_CACHE_RETENTION=short` | Default to ordinary ephemeral cache breakpoints without a one-hour TTL. |
| `PI_CACHE_RETENTION=none` | Do not add default cache breakpoints. Explicit call-level policy remains authoritative. |
| `/claude-cache status` | Show the effective cache-retention policy for the current session. |
| `/claude-cache short\|long\|default` | Store or clear a branch-local session override. |

Invalid retention values and malformed persisted overrides fail loudly. The extension also removes only the three reviewed exact-match Pi system-prompt lines rejected by Anthropic; it has no external sanitizer dependency. See [Anthropic attribution](../subsystems/anthropic-attribution.md) and [`/claude-cache`](../commands/claude-cache.md).

## Fusion model configuration

Fusion model slots are stored globally under the Pi agent directory as:

```text
fusion-models.json
```

Use `/fusion-models` in TUI mode to configure five slots:

- Candidate 1
- Candidate 2
- Candidate 3
- Evaluator
- Merger

Missing config means all five slots are `$current`. Config entries are qualified `provider/model` selections or `$current`; malformed config, stale explicit models, unavailable current models, and concurrent selector conflicts fail loudly before child inference.

Fusion accepts frontier-model routes only through Pi Anthropic or Codex subscription OAuth where `ModelRegistry.isUsingOAuth` confirms the route. Metered frontier API-key/base-URL paths are rejected before child creation, and relevant metered environment variables are stripped from Fusion children. Anthropic children explicitly load the same package-owned global attribution/sanitization extension because Fusion disables ambient extension discovery. Missing or malformed attribution data fails loudly before Anthropic transport. Its subscription request policy is 200K, so Fusion clamps Anthropic budget capacity to 200K even when Pi's model catalog advertises a larger context.

## Fusion Claude prompt caching

| Variable | Effect |
|---|---|
| `PI_CACHE_RETENTION=long` | Request `ttl: "1h"` on Pi-selected Anthropic cache breakpoints. This is Fusion's default when the variable is unset. |
| `PI_CACHE_RETENTION=short` | Use normal ephemeral retention without a `ttl` field (approximately five minutes). |
| `PI_CACHE_RETENTION=none` | Remove Anthropic cache breakpoints from normal Fusion provider payloads. Pi compaction payloads that already contain no breakpoints remain unmarked under every policy. |

Fusion children are isolated with `--no-session --no-extensions`, so a parent session's persisted `/claude-cache` override is not inherited; use `PI_CACHE_RETENTION` for Fusion. When the variable is absent, Fusion sets `long` in the Anthropic child environment before provider serialization. The shared attribution provider therefore creates `ttl: "1h"` cache controls on the system prompt, final tool, and final conversation surface rather than relying only on a late payload rewrite. Explicit call-level `cacheRetention="none"` still takes precedence for compaction. The final governor validates the controls, preserves at most Anthropic's four supported breakpoints, adds the subscription prompt-caching-scope beta idempotently, and records requested/effective **payload** policy in each child result event. Invalid values fail before provider transport, and models that explicitly reject long retention use short retention instead.

Provider usage is preserved without inventing one-hour tokens. Positive `cacheWrite1h` is definitive evidence of a one-hour write, but zero is inconclusive on subscription OAuth: 2026-08-04 normal-spawn and Fusion-child controls accepted `ttl: "1h"`, reported `cacheWrite1h = 0`, and still returned their unique cache hits after 370 idle seconds—beyond the documented five-minute lifetime. The payload observation proves what was sent; `cacheRead` proves reuse; neither alone proves a full hour. One-hour cache creation, when itemized by the provider, has a higher write price than short retention.

## Fusion runtime limits

These are source constants, not documented operator env knobs:

| Limit | Value |
|---|---:|
| Child absolute timeout | 50 minutes |
| Child stale-output watchdog | 35 minutes |
| Child stdout cap | 32 MiB |
| Child stderr cap | 16 MiB |
| Provider requests per child | 550 |
| Tool calls per child | 600 |
| Aggregate candidate tool-result bytes | 32 MiB |
| Candidate output contract | 48 KiB JSON-rendered bytes |
| Evaluator output contract | 64 KiB JSON-rendered bytes |
| Merger output contract | 64 KiB JSON-rendered bytes |
| `fusion_web_fetch` timeout | 90 seconds |
| `fusion_web_fetch` response body cap | 4 MiB |
| `fusion_web_fetch` returned content cap | 32 KiB |
| `fusion_web_fetch` redirect cap | 5 hops |

Oversized Fusion outputs fail loudly and are preserved in local artifacts where applicable. They are not forwarded or silently truncated. Post-launch Fusion requests are not admitted or refused by estimating live input tokens and subtracting the model's possible output from its context window; Pi/provider context handling remains authoritative after Fusion's pre-spawn stage-budget checks.

## Offline behavior

- Update checks skip when `PI_OFFLINE=1` and degrade to no footer update segment on any lookup failure.
- Background shell commands may still do whatever the command does; the package does not block their network access.
- Fusion child model calls require configured Pi model routes. `fusion_research` additionally requires network access to the caller-supplied public URLs it fetches.

## Durability and platform note

Task metadata, delegate/Fusion artifacts, attestation sidecars, and `fusion-models.json` use durable write helpers. Ordinary task `.output` streams are ended and drained before terminal publication but are not explicitly fsynced. POSIX performs directory `fsync` after atomic replacement. Windows still flushes replaced file contents before rename and treats rename failures as fatal, but it does not get the same portable directory-entry crash-durability guarantee.
