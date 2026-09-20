---
doc_id: read-before-edit
audience: agent
mode: generated
review_policy: contract
stability: stable
covers_surfaces: []
covers_sources: []
---
# Read before editing production sources

Every production file under `src/**` and `extensions/**` has exactly one primary behavioral documentation owner. This file is generated from authored ownership frontmatter and owns no production source itself.

## Source ownership

| Source | Primary behavioral owner |
| --- | --- |
| `extensions/anthropic-attribution.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `extensions/background-tasks.ts` | [subsystems/host-ui-and-telemetry](./subsystems/host-ui-and-telemetry.md) |
| `extensions/delegate-child.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `extensions/fusion-child.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/anthropic-attribution-path.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `src/core/anthropic-attribution.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `src/core/attested-pi-run.ts` | [subsystems/attested-pi-runs](./subsystems/attested-pi-runs.md) |
| `src/core/common.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/context/parent-snapshot.ts` | [concepts/context-projection-and-budgeting](./concepts/context-projection-and-budgeting.md) |
| `src/core/context/token-budget.ts` | [concepts/context-projection-and-budgeting](./concepts/context-projection-and-budgeting.md) |
| `src/core/context/visible-conversation-v2.ts` | [concepts/context-projection-and-budgeting](./concepts/context-projection-and-budgeting.md) |
| `src/core/delegate/artifacts.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/budget.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/hook-contract-evidence.json` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/hook-contract.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/launch.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/result-package.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/runner.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/seed.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/types.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/durable-fs.ts` | [subsystems/child-launch-durability-and-safety](./subsystems/child-launch-durability-and-safety.md) |
| `src/core/extension-api.ts` | [api/eventbus-v1](./api/eventbus-v1.md) |
| `src/core/fusion/artifacts.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/budget.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/child-protocol.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/claude-cache.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/clean-context.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/config.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/context.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/evaluation.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/orchestrator.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/output-contract.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/pi-child.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/prompts.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/result-package.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/source-policy.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/types.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/web-fetch.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/workflows.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/pi-launch.ts` | [subsystems/child-launch-durability-and-safety](./subsystems/child-launch-durability-and-safety.md) |
| `src/core/registry.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/store-root.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/update-check.ts` | [subsystems/host-ui-and-telemetry](./subsystems/host-ui-and-telemetry.md) |
| `src/core/windows-taskkill.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/delegate-child-extension.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/delegate-extension.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/extension.ts` | [subsystems/host-ui-and-telemetry](./subsystems/host-ui-and-telemetry.md) |
| `src/fusion-child-extension.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/fusion-extension.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/ui/background-tasks-manager.ts` | [subsystems/host-ui-and-telemetry](./subsystems/host-ui-and-telemetry.md) |
| `src/ui/fusion-model-selector.ts` | [subsystems/fusion](./subsystems/fusion.md) |

## Public surfaces

- `command:bg`
- `command:bg-clear`
- `command:bg-tasks`
- `command:bg-update`
- `command:claude-cache`
- `command:fusion`
- `command:fusion-models`
- `command:jobs`
- `command:kill`
- `command:logs`
- `command:tasks`
- `eventbus:background-task-v1`
- `renderer:background-task-notification`
- `renderer:fusion-result`
- `shortcut:ctrl+alt+c`
- `shortcut:shift+down`
- `tool:bg_delegate`
- `tool:bg_kill`
- `tool:bg_logs`
- `tool:bg_result`
- `tool:bg_run`
- `tool:bg_run_pi_attested`
- `tool:bg_status`
- `tool:fusion_investigate`
- `tool:fusion_reason`
- `tool:fusion_research`
- `tool:fusion_validate`
- `workflow:investigate`
- `workflow:reason`
- `workflow:research`
- `workflow:validate`
