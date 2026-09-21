---
doc_id: concepts/completion-delivery
audience: agent
mode: authored
review_policy: contract
stability: stable
covers_surfaces: [renderer:background-task-notification]
covers_sources: []
---
# Completion delivery

Background tasks can finish silently, notify the terminal, or notify and wake the agent. The flags are task-owned.

## Delivery modes

| `notifyOnCompletion` | `triggerOnCompletion` | Actual mode |
|---|---:|---|
| `true` | `true` | Durable terminal notification and automatic follow-up turn. Default for [`bg_run`](../tools/bg_run.md). |
| `true` | `false` | Durable terminal notification only; no provider follow-up. Default for [`/bg`](../commands/bg.md). |
| `false` | `true` | Manual monitoring; `triggerOnCompletion` has no effect without a notification. |
| `false` | `false` | Manual monitoring. |

## Critical behavior

- `/bg` is display-only by default: it sets `notifyOnCompletion:true` and `triggerOnCompletion:false`.
- `bg_run` defaults to durable notification plus follow-up turn: `notifyOnCompletion:true` and `triggerOnCompletion:true`.
- `bg_status` and `bg_logs` are point-in-time inspection tools, not polling primitives.
- Tool-launched Fusion tasks default to notification plus follow-up wake and are retrieved once with `bg_result`; `/fusion` uses notification-only.
- A received `<background-task-notification>` is metadata-backed terminal-status truth. The output stream has finished/closed; after a requested POSIX tree stop, the originally owned process group has also been observed gone, while a force/proof failure is delivered as `failed` rather than a successful kill. Ordinary `.output` bytes are not explicitly fsynced. Do not call `bg_status` only to reconfirm status; call `bg_logs` only if output bytes are needed.

## Notification payload

When enabled and not during shutdown, terminal completion sends a custom message with:

- `<task-id>`
- `<task-name>`
- `<status>` (`completed`, `failed`, or `killed`)
- optional `<exit-code>`
- optional `<error>`
- `<output-file>`
- `<summary>`
- `<guidance>` that says terminal state and output metadata are durable and not to reconfirm with `bg_status`.

The structured details contain the task snapshot, including delivery flags and `notified` state.

## Agent guidance

After default `bg_run`, continue only independent useful work. If there is no such work, briefly acknowledge and end the turn; the follow-up notification will wake the agent. Do not sleep, poll `bg_status`, or repeatedly read `bg_logs` merely to wait.

If either completion flag was intentionally disabled, manual inspection is allowed when deliberate, but still avoid tight polling.

## Failures and suppression

Completion notification receipt and terminal EventBus publication are independent facts. EventBus publication can be pending, delivered, or abandoned without changing durable task status or `notified`. At the retention boundary, an oldest pending publication is abandoned and disposed before that old task is pruned; it cannot evict a newer notified Fusion result before `bg_result` retrieval. If the EventBus service alone is disposed, an otherwise enabled notification may still be sent. During ordinary Pi shutdown, notifications are suppressed and old publication is abandoned.

A live opted ordinary reload survivor is different: detach transfers its logical publication ledger and notification latch without sending through the old host. Completion during the gap queues. The fresh activation resumes at the same cumulative EventBus attempt count and sends at most one successful host notification; a reload never resets `notified`. Physical EventBus delivery remains at-least-once under listener failure and consumers still deduplicate by task id.

If notification send fails, the task resets `notified:false` and logs the error; it does not silently pretend delivery happened. Likewise, EventBus abandonment—including `reload_handoff_expired` when no fresh activation claims an owner—never becomes successful publication or rewrites the real terminal status.

## Related docs

- [`bg_run`](../tools/bg_run.md)
- [`bg_status`](../tools/bg_status.md)
- [`bg_logs`](../tools/bg_logs.md)
- [`/bg`](../commands/bg.md)
- [Background task runtime](../subsystems/background-task-runtime.md)
- [Host UI and telemetry](../subsystems/host-ui-and-telemetry.md)

## Source ownership/reference

Delivery receipt text is derived by runtime helpers and sent by extension registration; primary behavioral ownership is split between [background-task-runtime](../subsystems/background-task-runtime.md) and [host-ui-and-telemetry](../subsystems/host-ui-and-telemetry.md).
