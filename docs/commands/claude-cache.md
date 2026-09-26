---
doc_id: commands/claude-cache
audience: user
mode: mixed
review_policy: contract
stability: evolving
covers_surfaces: [command:claude-cache]
covers_sources: []
---
# `/claude-cache`

<!-- pi-docs:begin name="command-contract-claude-cache" generator="scripts/docs/generate.mjs" -->
| Command | Availability | Default | Description | Provenance |
| --- | --- | --- | --- | --- |
| `/claude-cache` | `feature:attribution` | yes | Show or set Claude cache retention for this session (short, long, default) | `src/core/anthropic-attribution.ts:3579` |
<!-- pi-docs:end name="command-contract-claude-cache" -->

Show or change the Anthropic cache-retention preference for the current session. Under the initialized-host contract, the command is registered only when `PI_BG_FEATURES` includes the ambient `attribution` capability (enabled by default); disabling that capability removes the command together with the parent provider/hooks. Its generated default availability is not a pre-bind availability guarantee: bare SDK sessions and empty/mode-only reloads require the explicit binding described in [Anthropic attribution](../subsystems/anthropic-attribution.md#initialized-host-sdk-contract-and-blocker).

## Synopsis

```text
/claude-cache
/claude-cache status
/claude-cache short
/claude-cache long
/claude-cache default
```

## Behavior

- No argument and `status` show the effective preference.
- `short` requests normal ephemeral retention.
- `long` requests one-hour retention where the selected model supports it.
- `default` removes the session override and returns to the package's one-hour subscription policy unless `PI_CACHE_RETENTION` says otherwise.

The decision is persisted as a branch-local custom session entry and restored after reload, resume, and tree navigation. It does not enter model context.

Pi's generic five-minute provider default does not override this package's one-hour subscription policy. Use `/claude-cache short` or `PI_CACHE_RETENTION=short` for an intentional short lane. An explicit call-level `none` remains authoritative, so Pi compaction and branch-summary requests are not re-marked by the session default. Those standalone requests still receive complete subscription attribution from Pi's fresh request-scoped routing ID.

## Errors and boundaries

Unknown arguments fail with the accepted values. Malformed persisted entries and invalid `PI_CACHE_RETENTION` values fail loudly.

The command controls the package-owned Anthropic subscription provider only. It does not enable metered API credentials, alter non-Anthropic routes, or change isolated Fusion children; set `PI_CACHE_RETENTION` for isolated child processes.

## Related docs

- [Anthropic attribution subsystem](../subsystems/anthropic-attribution.md)
- [Configuration](../operations/configuration.md)
