---
doc_id: subsystems/anthropic-attribution
audience: maintainer
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [extensions/anthropic-attribution.ts, src/core/anthropic-attribution-path.ts, src/core/anthropic-attribution.ts]
---
# Anthropic attribution subsystem

This subsystem owns the package-wide Anthropic subscription attribution provider, exact-match system-prompt sanitization, cache-retention command, and the package extension path shared by isolated child Pi processes.

## Global package behavior

`package.json.pi.extensions` loads `extensions/anthropic-attribution.ts` for every normal `pi-background-tasks` installation, before the background-task entrypoint. The extension is provider-gated: non-Anthropic sessions and payloads are unchanged.

For Anthropic sessions it registers the package-owned `anthropic` provider transport. Mandatory attribution is owned inside that transport from each request's Pi-supplied `options.sessionId`; `before_provider_request` remains optional middleware and is never an identity initializer. The transport applies the Claude Code subscription request contract:

- subscription OAuth token transport only; metered Anthropic credentials are refused, the bearer token is sent only to the exact official Anthropic HTTPS origin, and HTTP redirects are disabled;
- Claude Code session, account, device, beta, user-agent, and system-identity attribution;
- model-specific fixed/adaptive thinking policy;
- the conservative 200K subscription context policy;
- provenance-aware cross-provider history projection and Fable 5.1 thinking binding;
- system, final-tool, and final-conversation cache surfaces;
- provider-authoritative usage, cache diagnostics, and one-hour cache-write accounting when reported;
- strict SSE completion: matching event names, one `message_start`, closed content blocks, a recognized terminal stop reason, and one `message_stop` are required before success or lineage persistence.

The extension reads `userID` and `oauthAccount.accountUuid` from `~/.claude.json` without writing it. Missing/malformed account data, unsupported model policy, malformed payload/cache controls, and non-OAuth transport fail loudly.

## Cross-provider history and cache lineage

Assistant messages carry their producing `provider`, `api`, and `model`. The transport never parses an opaque reasoning signature. Foreign visible thinking is projected deterministically as text; foreign opaque, redacted, and signature-only blocks are omitted. Claude thinking is replayed only when a successful direct-Anthropic response carries a matching `anthropic-cache-lineage` diagnostic binding response ID, source tuple, assistant-content hash, system/tools attribution profile, effective cache retention, request-message count, and request-prefix hash. Empty, redacted, and valid non-BMP Unicode Claude blocks are preserved byte-for-byte. Fable 5.1 accepts lineage-proven earlier Claude blocks; reverse replay is denied.

Every target model has an independent append-only lane. Before transport, the adapter proves the prior successful wire history remains an exact prefix and that model, sanitized system, canonical tools, thinking/effort, beta profile, and effective retention are unchanged. Unexpected drift fails before network. An intentional TTL change starts a cryptographically named signature epoch and suppresses prior-epoch signed thinking permanently, including after a later short→long return. A canonical leading Pi compaction summary likewise opens one hash-bound signature epoch only; retaining that old marker cannot excuse later unrelated history drift. Tool IDs, schemas, arguments, user messages, and text-only tool results have deterministic block-shaped serialization, so advancing the final cache marker does not rewrite prior content. Optional payload middleware runs exactly once after transport-owned attribution and cannot change the protected model/stream route, account/device/session metadata, billing identity, cache-control placement/value topology, four-breakpoint limit, or already-authorized message/static/profile/retention lineage.

Fable 5.1 always sends `thinking-binding-controls-2026-08-01` with prefix mismatch set to `error`, plus `cache-diagnosis-2026-04-07`. The previous successful response ID is chained within the same model lane; provider diagnostics and `input_transformations` are persisted outside model context. There is no automatic signature retry or silent thinking drop.

## Sanitization

The package has no runtime dependency on `@ravshansbox/pi-anthropic-sps`. Its three reviewed exact-match prompt-line rules are implemented locally in `src/core/anthropic-attribution.ts`, with the upstream MIT notice retained in `THIRD_PARTY_NOTICES.md`.

Only complete matching lines are removed. Other system text, non-text blocks, custom block fields, and valid cache controls are preserved. The rules cover both Pi documentation-list variants—with and without `environment-variables.md`—plus the cross-reference instruction line.

## Duplicate-owner protocol

A package extension and an independent project/user copy can otherwise register duplicate provider hooks and `/claude-cache` commands. The factory therefore probes `pi-anthropic-attribution:claim:v1` on Pi's shared EventBus before registration. The first successfully registered copy installs one responder; later compatible copies become inert.

Ownership is published only after all hooks and the command register. Extension loading is sequential and EventBus listener invocation is synchronous at the probe boundary, so a failed first factory cannot strand a false claim. The responder lives for the shared EventBus runtime, matching the extension registrations it protects.

## Isolated package children

Ambient discovery is insufficient for child paths that use `--no-extensions`. `resolveAnthropicAttributionExtensionPath()` is the single package path seam used by:

- Fusion Anthropic children, before the Fusion runtime governor;
- Anthropic delegate children, before the delegate guard;
- Anthropic attested Pi children.

Non-Anthropic child argv does not resolve or add this extension. Missing package extension bytes fail before child creation; no route substitution or sanitizer fallback is attempted.

Arbitrary shell commands started through `bg_run` are not rewritten. An Anthropic child `pi` launched this way must keep normal extension discovery enabled. If the command deliberately uses `--no-extensions`, it must also explicitly load this package's `extensions/anthropic-attribution.ts` with `-e`/`--extension`; otherwise attribution and sanitization are bypassed and the launch is unsupported. The package does not parse or override arbitrary shell authority.

## Cache retention

`PI_CACHE_RETENTION=none|short|long` selects process/provider policy. `/claude-cache status|short|long|default` stores a branch-local session override as a custom entry that does not enter model context. Registered subscription sessions default to one hour even when Pi supplies its generic five-minute provider default; an intentional short policy must come from the session command or environment. Call-level `cacheRetention:none` remains authoritative for one-off compaction and branch-summary requests and emits no cache markers. Pi gives those standalone requests a fresh routing `options.sessionId`; that exact ID is used consistently in metadata, headers, and request-local lineage without coupling the one-off request to the parent cache lane.

## Related docs

- [`/claude-cache`](../commands/claude-cache.md)
- [Configuration](../operations/configuration.md)
- [Fusion subsystem](fusion.md)
- [Delegation subsystem](delegation.md)
- [Attested Pi runs](attested-pi-runs.md)
