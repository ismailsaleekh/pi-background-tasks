---
doc_id: commands/bg-update
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: [command:bg-update]
covers_sources: []
---
# `/bg-update`

<!-- pi-docs:begin name="command-contract-bg-update" generator="scripts/docs/generate.mjs" -->
| Command | Availability | Default | Description | Provenance |
| --- | --- | --- | --- | --- |
| `/bg-update` | `always` | yes | Show how to update pi-background-tasks to the latest published version | `src/extension.ts:801` |
<!-- pi-docs:end name="command-contract-bg-update" -->

Show update instructions for `pi-background-tasks`.

## Synopsis


`/bg-update`

## When to use

Use this when the footer shows an update segment such as `⬆ v999.0.0 /bg-update`, or whenever you want the package's install/update commands printed without performing an install.

## Defaults

No arguments. The command reads the installed package name/version and any latest version found by the session update check.

## Lifecycle

The update check is one-shot per extension runtime, started after `session_start`, and is not awaited on the session-start path. It is skipped when:

- `PI_BG_DISABLE_UPDATE_CHECK=1`,
- `PI_OFFLINE=1`, or
- the installed package version is unavailable.

The registry request is time-boxed by `fetchLatestVersion` and failures resolve to no update segment. `/bg-update` itself only prints instructions; it never installs, self-updates, or mutates package files.

## Examples

```text
/bg-update
```

## Output/result

The notification includes current installed version and, when known, latest published version, then prints:

```text
pi install npm:pi-background-tasks@latest
pi install npm:pi-background-tasks@<version>
pi install git:github.com/ismailsaleekh/pi-background-tasks@main
For a pinned git release, first verify the tag exists, then use git:github.com/ismailsaleekh/pi-background-tasks@<existing-tag>.
This command only prints update instructions; it does not install or self-update.
```

If no latest npm version is known, `<version>` is printed for the pinned npm command. The command never derives a git tag from the npm version: npm releases and repository tags are independent, and a pinned git tag must be verified separately.

## Errors

The command has no task-resolution errors. Update-check network, timeout, bad status, and malformed payload failures are offline-safe and do not throw into the UI.

## Runtime artifacts

No task artifacts. The footer segment is UI state only.

## Safety boundaries

Instruction-only. It does not run `pi install`, `npm`, `git`, or any package manager.

## Related docs

- [Shortcuts and dock](../reference/shortcuts-and-dock.md)
- [Host UI and telemetry](../subsystems/host-ui-and-telemetry.md)

## Source ownership/reference

Surface registration lives in `src/extension.ts`; update lookup is implemented in `src/core/update-check.ts` and owned by [host-ui-and-telemetry](../subsystems/host-ui-and-telemetry.md).
