---
doc_id: subsystems/anthropic-attribution
audience: maintainer
mode: authored
review_policy: behavioral
stability: evolving
covers_surfaces: []
covers_sources: [extensions/anthropic-attribution-child.ts, extensions/anthropic-attribution.ts, src/core/anthropic-attribution-path.ts, src/core/anthropic-attribution.ts]
---
# Anthropic attribution subsystem

This subsystem owns the package-wide Anthropic subscription attribution provider, exact-match system-prompt sanitization, cache-retention command, the feature-aware ambient parent entrypoint, and the distinct always-on extension path shared by isolated child Pi processes.

## Global package behavior

`package.json.pi.extensions` loads the compiled `dist/extensions/anthropic-attribution.js` entrypoint before the compiled background-task entrypoint; `extensions/anthropic-attribution.ts` remains its authoritative source. The light entrypoint statically resolves the host-owned `anthropicMessagesApi` through Pi's alias-aware extension loader, parses the complete shared configuration, and then dynamically loads the attribution transport with that adapter injected. The deferred core has no runtime import of a Pi host package, so a native dynamic import cannot look for a private `@earendil-works/pi-ai` beside a production-only package installation. With the default `attribution` capability, the wrapper activates the accepted implementation from `session_start`, after Pi has bound its public provider runtime; without that token the transport module is not imported and no parent provider, attribution lifecycle hooks, duplicate-owner responder, or `/claude-cache` command is registered. Invalid feature or dock configuration fails before ambient activation.

Before activation, the wrapper snapshots the effective provider plus the public legacy/native registration through `ctx.modelRegistry`. The accepted factory's provider call is then immediate rather than queued. A thrown application failure occurs before its command, hooks, or claim responder are published. A successful installation is owned only after a new current legacy-config object and changed effective provider are observed; that exact config object is the instance token. On shutdown the wrapper acts only while that token is still current. A later legacy or native owner is left untouched. Otherwise it restores the prior native registration directly, clears the package layer with the captured effective provider before reapplying a prior legacy config, or—when there was no prior dynamic registration—uses public unregister only after the exact token/later-owner checks to restore dynamic-registration absence. Postconditions verify the complete public registration state and a usable effective provider; they do not require a stale built-in object identity because Pi may legitimately refresh its host-owned provider while the package overlay is active. The wrapper never blindly deletes another owner's provider and never reads private host state. A subsequent real reload with attribution disabled therefore restores the host's prior public registration state. When enabled, the transport remains provider-gated: non-Anthropic sessions and payloads are unchanged.

## Initialized-host SDK contract and blocker

Normal Pi TUI, RPC, print, and JSON modes supply counted bindings and satisfy the initialized-host contract. SDK embedders must call `bindExtensions()` with at least one counted UI/command/shutdown/error binding; after reload, that binding causes Pi to emit `session_start`. Empty or mode-only bindings require an explicit `bindExtensions()` call after every reload.

**BLOCKED_SCOPE / SDK compatibility:** bare `createAgentSession()` never emits the activation event, and empty or mode-only binding state does not make `reload()` emit it. On those paths the selected ambient provider, `/claude-cache`, hooks, persisted cache initialization, and duplicate-owner responder remain absent until an explicit bind. There is no safe package-only repair through the current public API: factory-time provider registration is queued and gives no success/owner token. Closure still requires a guaranteed post-core-bind/reload callback or owner-token registration API; excluding these SDK hosts is not approved. Generated availability describes the initialized-host contract and is not a pre-bind availability guarantee.

For Anthropic sessions it registers the package-owned `anthropic` provider transport. Mandatory attribution is owned inside that transport from each request's Pi-supplied `options.sessionId`; when a caller omits that optional field (for example an extension-owned side-question request), the transport mints a fresh request-local UUID, like Pi does for its own one-off requests, instead of failing, while a supplied empty or blank value is still refused. `before_provider_request` remains optional middleware and is never an identity initializer. The transport applies the Claude Code subscription request contract:

- subscription OAuth token transport only; metered Anthropic credentials are refused, the bearer token is sent only to the exact official Anthropic HTTPS origin, and HTTP redirects are disabled;
- Claude Code session, account, device, beta, user-agent, and system-identity attribution;
- model-specific fixed/adaptive thinking policy;
- the conservative 200K subscription context policy;
- provenance-aware cross-provider history projection and Fable 5.1 thinking binding;
- system, final-tool, and final-conversation cache surfaces;
- provider-authoritative usage, cache diagnostics, and one-hour cache-write accounting when reported;
- strict SSE completion: matching event names, one `message_start`, closed content blocks, a recognized terminal stop reason, and one `message_stop` are required before success or lineage persistence.

The extension reads `userID` and `oauthAccount.accountUuid` without writing account configuration. The loader precedence is: an explicit `loadClaudeAttributionAccount(path)` argument (the programmatic/test seam), then `PI_ANTHROPIC_ACCOUNT_CONFIG_PATH`, then `~/.claude.json`. An explicit selection must be a non-empty absolute file path. The selected file must be readable JSON with both non-empty fields; failures identify the selected path and field without fabricating account data. The package does not infer a Claude config-directory convention. Package-owned children inherit the path variable unchanged without copying account contents into their environment.

The registered provider can be reached with a non-`anthropic` model that uses the `anthropic-messages` API. That path passes the host-owned model, context, and options by identity to the gateway-injected matching host SDK's supported `anthropicMessagesApi().streamSimple` implementation and returns its event stream directly. A missing injected adapter fails loudly rather than resolving or reconstructing a private fallback. The package neither validates against a frozen transcript shape nor reconstructs events/results: legacy top-level `Context` and normalized system-message `TranscriptContext` contracts remain owned by the host version, including shared live partial identity, optional fields, tool metadata, usage, callbacks, and terminal error settlement. It does not receive account, identity, cache, endpoint, or header rewriting and does not dispatch through the registered API adapter again. Missing/malformed account data on the target route, unsupported model policy, malformed payload/cache controls, and non-OAuth target transport fail loudly.

## Pi transcript compatibility

The target transport accepts legacy `Context` and Pi 0.86 `TranscriptContext`. Both package gateways resolve Pi's optional `getCurrentSystemPrompt`/`getCurrentTools` exports through the host-aware loader and inject them alongside the Anthropic adapter; the lazy core still imports no host SDK at runtime. Older hosts need no transcript helpers for legacy input. A system-bearing transcript without both helpers, malformed system state, or invalid helper results fails before middleware/network instead of silently sending an empty prompt or tool list.

Pi's helpers replay text additions, named section replacement/removal, and tool addition/removal/redefinition. For a legacy base plus later system deltas, the base is prepended as Pi's initial system state before replay. System messages are then removed from the conversation sequence before message conversion and all lineage/compaction checks. This also groups adjacent tool results correctly across a system update. A leading system checkpoint does not hide the following compaction summary. Unknown message roles fail loudly; they can neither enter a non-advancing tool-result loop nor be silently skipped. Effective prompt/tool changes retain the existing non-inheriting signature-epoch behavior.

The diagnosis and helper-replay direction originated in community issue #27 / PR #28 by Mirko Bozzetto; this integration retains the package's gateway injection and fail-closed lineage boundaries.

## Cross-provider history and cache lineage

Assistant messages carry their producing `provider`, `api`, and `model`. The transport never parses an opaque reasoning signature. Foreign visible thinking is projected deterministically as text; foreign opaque, redacted, and signature-only blocks are omitted. Claude thinking is replayed only when a successful direct-Anthropic response carries a matching `anthropic-cache-lineage` diagnostic binding response ID, source tuple, assistant-content hash, system/tools attribution profile, effective cache retention, request-message count, and request-prefix hash. Empty, redacted, and valid non-BMP Unicode Claude blocks are preserved byte-for-byte. Fable 5.1 accepts lineage-proven earlier Claude blocks; reverse replay is denied.

Every target model has an independent append-only lane. Before a receipt can select a lane, authorize `previous_message_id`, or authorize signed/redacted thinking replay, it must bind completely to its containing assistant: exact Anthropic provider/API/model, a supported successful terminal state, equal non-empty response IDs, and the exact assistant-content hash. Blank required receipt IDs are malformed. Before transport, the adapter also proves the prior successful wire history remains an exact prefix and that model, sanitized system, canonical tools, thinking/effort, beta profile, and effective retention are unchanged. If resume/reload reconstruction, edited history, or a changed profile breaks that proof, the adapter silently starts a deterministic non-inheriting signature epoch and clears `previous_message_id` instead of permanently blocking the session. It re-projects before transport: prior-epoch visible thinking becomes text, while stale signed/redacted blocks are omitted. A successful response persists the reset epoch and request fingerprint, so the next unchanged turn chains normally. Failed HTTP/SSE attempts, incomplete streams, middleware tampering, and concurrent continuations do not anchor an epoch. Returning to an old profile/history starts another reset rather than resurrecting old signatures. A latest relevant assistant with a missing, malformed, or mismatched lineage receipt is also a non-inheriting boundary, not permission to search backward and revive an older epoch.

An intentional TTL change starts a cryptographically named signature epoch and suppresses prior-epoch signed thinking permanently, including after a later short→long return. A canonical leading Pi compaction summary likewise opens one hash-bound signature epoch only; later unrelated drift starts another epoch even while that marker remains. Tool IDs, schemas, arguments, user messages, and text-only tool results have deterministic block-shaped serialization, so advancing the final cache marker does not rewrite prior content. Optional payload middleware runs exactly once after transport-owned attribution and cannot change the protected model/stream route, account/device/session metadata, billing identity, cache-control placement/value topology, four-breakpoint limit, or already-authorized message/static/profile/retention lineage.

Fable 5.1 always sends `thinking-binding-controls-2026-08-01` with prefix mismatch set to `error`, plus `cache-diagnosis-2026-04-07`. The previous successful response ID is chained within the same model lane; provider diagnostics and `input_transformations` are persisted outside model context. There is no automatic retry after a provider signature rejection. Local recovery uses the provenance-aware projection, preserves visible reasoning as text, and records the non-inheriting epoch only after one complete, strictly valid transport response.

## Sanitization

The package has no runtime dependency on `@ravshansbox/pi-anthropic-sps`. Its three reviewed exact-match prompt-line rules are implemented locally in `src/core/anthropic-attribution.ts`, with the upstream MIT notice retained in `THIRD_PARTY_NOTICES.md`.

Only complete matching lines are removed. Other system text, non-text blocks, custom block fields, and valid cache controls are preserved. The rules cover both Pi documentation-list variants—with and without `environment-variables.md`—plus the cross-reference instruction line.

## Duplicate-owner protocol

A package extension and an independent project/user copy can otherwise register duplicate provider hooks and `/claude-cache` commands. During ordered `session_start` activation, the factory therefore probes `pi-anthropic-attribution:claim:v1` on Pi's shared EventBus before registration. The first successfully installed copy adds one responder; later compatible copies become inert.

Ownership is published only after the immediate provider application, all hooks, and the command register. EventBus listener invocation is synchronous at the probe boundary, so a failed first installation cannot strand a false claim and a later copy may still activate. The responder lives for the shared EventBus runtime, matching the extension registrations it protects.

## Isolated package children

Ambient discovery and the parent capability flag are both insufficient for child paths that use `--no-extensions`. `resolveAnthropicAttributionExtensionPath()` resolves the distinct `extensions/anthropic-attribution-child.ts` entrypoint and is the single package path seam used by:

- Fusion Anthropic children, before the Fusion runtime governor;
- Anthropic delegate children, before the delegate guard;
- Anthropic attested Pi children.

The child entrypoint resolves and injects the same host-owned adapter before directly invoking the accepted implementation, and deliberately does not consult `PI_BG_FEATURES`. Non-Anthropic child argv does not resolve or add it. Missing package extension bytes fail before child creation; no route substitution or sanitizer fallback is attempted. Delegate and Fusion keep attribution before their guard/governor, and attested Anthropic argv adds the same entrypoint before the prompt.

Arbitrary shell commands started through `bg_run` are not rewritten. An Anthropic child `pi` launched this way may keep normal extension discovery enabled when ambient attribution is enabled. If the command deliberately uses `--no-extensions`, it must explicitly load this package's always-on `extensions/anthropic-attribution-child.ts` with `-e`/`--extension`; otherwise attribution and sanitization are bypassed and the launch is unsupported. The package does not parse or override arbitrary shell authority.

## Cache retention

`PI_CACHE_RETENTION=none|short|long` selects process/provider policy. `/claude-cache status|short|long|default` stores a branch-local session override as a custom entry that does not enter model context. Registered subscription sessions default to one hour even when Pi supplies its generic five-minute provider default; an intentional short policy must come from the session command or environment. Call-level `cacheRetention:none` remains authoritative for one-off compaction and branch-summary requests and emits no cache markers. Pi gives those standalone requests a fresh routing `options.sessionId`; that exact ID is used consistently in metadata, headers, and request-local lineage without coupling the one-off request to the parent cache lane.

## Related docs

- [`/claude-cache`](../commands/claude-cache.md)
- [Configuration](../operations/configuration.md)
- [Fusion subsystem](fusion.md)
- [Delegation subsystem](delegation.md)
- [Attested Pi runs](attested-pi-runs.md)
