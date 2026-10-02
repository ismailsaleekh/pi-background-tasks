---
doc_id: commands/bg-display
audience: user
mode: authored
review_policy: contract
stability: stable
covers_surfaces: [command:bg-display]
covers_sources: []
---
# `/bg-display`

The background task footer can hide finished counts or disappear while tasks continue. The task manager remains available through [`/tasks` and `/bg-tasks`](task-manager.md).

## Synopsis

```text
/bg-display [status|all|running|off|default]
```

No argument or `status` reports the effective mode, its source, and its scope. Command arguments ignore surrounding whitespace and case. Invalid arguments report usage and save nothing.

| Argument | Effect |
|---|---|
| `all` | Show running and unseen finished counts, entry and clear hints, and any update notice. This is the package default. |
| `running` | Show running counts and the entry hint while tasks run. Hide finished counts and the clear hint. Keep any update notice, including when idle. |
| `off` | Clear only this package's keyed footer status and widget, including its update notice. |
| `default` | Reset the branch override to the activation environment default. |

The configured dock shortcut, task history, unread badges, notifications, wake turns, logs, and EventBus delivery do not depend on this mode. Hiding the footer does not acknowledge finished tasks. Returning to `all` shows their unseen badges again. Update checks still run when the footer is off.

## Precedence and scope

The latest valid selection on the current session branch overrides `PI_BG_FOOTER_DISPLAY`. The environment accepts exactly `all`, `running`, or `off` and defaults to `all` when unset. Empty, whitespace-bearing, uppercase, and unknown environment values fail activation with `pi_bg_config_invalid`. Environment changes take effect at the next activation or `/reload`, not on a status tick.

The command uses a versioned Pi custom session entry, excluded from model context. It changes no global file, user setting, or environment variable. Repeating the same selection writes no extra entry. An explicit mode equal to the environment default still creates a branch override.

Startup and tree navigation restore only the current branch. Resume and reload retain its override. A fork inherits selections on the copied path to its chosen entry, not later or sibling selections. A new session starts with the activation default. `default` records a reset rather than deleting history.

Pi owns persistence. In-memory and `--no-session` choices disappear on exit. Pi can defer writing a custom-only session until an assistant message exists, so setting the mode alone does not guarantee immediate disk persistence or fsync. SDK hosts must use the [initialized-host lifecycle contract](../operations/configuration.md#initialized-host-sdk-contract), including counted bindings after reload and awaited runtime disposal.

## Errors

A malformed matching entry reports `pi_bg_footer_entry_invalid` and hides this package's footer until a clean branch restores. No older branch state or default substitutes for corrupt state. `default` does not repair corrupt entries. Task execution and delivery continue.

A save failure reports an error without claiming success. Pi may have changed its in-memory branch before a disk write failed, so the command rereads the actual branch and makes no rollback guarantee.

## Examples

```sh
PI_BG_FOOTER_DISPLAY=running pi
```

```text
/bg-display off
/tasks
/bg-display default
/bg-display status
```

See [configuration](../operations/configuration.md) and [footer states](../reference/shortcuts-and-dock.md#footer-states).
