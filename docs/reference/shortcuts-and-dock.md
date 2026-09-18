---
doc_id: reference/shortcuts-and-dock
audience: user
mode: mixed
review_policy: contract
stability: stable
covers_surfaces: ['shortcut:ctrl+alt+c', 'shortcut:shift+down']
covers_sources: []
---
# Shortcuts and dock reference

<!-- pi-docs:begin name="shortcut-contracts" generator="scripts/docs/generate.mjs" -->
| Shortcut | Description | Provenance |
| --- | --- | --- |
| `ctrl+alt+c` | Clear finished background task footer notices (terminal-dependent fallback for /bg-clear) | `src/extension.ts:599` |
| `shift+down` | Open focused background task footer dock | `src/extension.ts:592` |
<!-- pi-docs:end name="shortcut-contracts" -->

## Registered shortcuts

| Shortcut | Behavior |
|---|---|
| `Shift+Down` | Open the focused background task footer dock / task manager. |
| `Ctrl+Alt+C` | Clear finished background task footer notices; this is an optional terminal-dependent fallback for [`/bg-clear`](../commands/bg-clear.md). |

If a terminal does not deliver `Ctrl+Alt+C`, use `/bg-clear`. It is the canonical command path.

## Footer states

The footer appears when there are running tasks, unseen finished tasks, or an update segment. Count labels are:

- `running` for active tasks;
- `failed` for status `failed`;
- `stopped` for status `killed`;
- `done` for status `completed`.

Examples:

```text
bg 1 running · Shift↓
bg 1 done · Shift↓ · /bg-clear
bg 1 running · 1 failed · 1 stopped · 1 done · Shift↓ · /bg-clear
bg 1 running · Shift↓ · ⬆ v999.0.0 /bg-update
bg 1 running · focused
```

The `/bg-clear` hint is hidden while the dock is open, where the entry hint becomes `focused`. A finished task's badge is marked seen when its detail view opens; `/bg-clear` or `Ctrl+Alt+C` marks all currently unseen finished tasks seen. Merely opening the list view or closing the dock does not clear badges.

## Dock entry points

- `Shift+Down`
- [`/tasks`](../commands/task-manager.md)
- [`/bg-tasks`](../commands/task-manager.md)

All open the same task manager when an interactive UI is available.

## Dock output detail

The detail view follows a UI-only 128 KiB tail buffer, refreshes once per second while following, and shows 12 output lines. Scrolling up pauses following; reaching the bottom or pressing `r` resumes it.

## Related docs

- [`/bg-clear`](../commands/bg-clear.md)
- [`/tasks` and `/bg-tasks`](../commands/task-manager.md)
- [`/bg-update`](../commands/bg-update.md)
- [Host UI and telemetry](../subsystems/host-ui-and-telemetry.md)

## Source ownership/reference

Shortcut and footer implementation is owned by [host-ui-and-telemetry](../subsystems/host-ui-and-telemetry.md).
