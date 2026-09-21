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
| `extensions/anthropic-attribution-child.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `extensions/anthropic-attribution.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `extensions/background-tasks.ts` | [subsystems/host-ui-and-telemetry](./subsystems/host-ui-and-telemetry.md) |
| `extensions/delegate-child.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `extensions/fusion-child.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/anthropic-attribution-path.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `src/core/anthropic-attribution.ts` | [subsystems/anthropic-attribution](./subsystems/anthropic-attribution.md) |
| `src/core/attested-pi-contract.ts` | [subsystems/attested-pi-runs](./subsystems/attested-pi-runs.md) |
| `src/core/attested-pi-run.ts` | [subsystems/attested-pi-runs](./subsystems/attested-pi-runs.md) |
| `src/core/canonical-json.ts` | [subsystems/child-launch-durability-and-safety](./subsystems/child-launch-durability-and-safety.md) |
| `src/core/common.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/config.ts` | [subsystems/host-ui-and-telemetry](./subsystems/host-ui-and-telemetry.md) |
| `src/core/context/parent-snapshot.ts` | [concepts/context-projection-and-budgeting](./concepts/context-projection-and-budgeting.md) |
| `src/core/context/token-budget.ts` | [concepts/context-projection-and-budgeting](./concepts/context-projection-and-budgeting.md) |
| `src/core/context/visible-conversation-v2.ts` | [concepts/context-projection-and-budgeting](./concepts/context-projection-and-budgeting.md) |
| `src/core/delegate/artifacts.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/budget.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/delegate/facade-contract.ts` | [subsystems/delegation](./subsystems/delegation.md) |
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
| `src/core/fusion/facade-contract.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/orchestrator.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/output-contract.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/pi-child.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/prompts.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/result-package.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/source-policy.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/types.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/web-fetch.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/fusion/workflows.ts` | [subsystems/fusion](./subsystems/fusion.md) |
| `src/core/lazy-module.ts` | [subsystems/delegation](./subsystems/delegation.md) |
| `src/core/pi-launch.ts` | [subsystems/child-launch-durability-and-safety](./subsystems/child-launch-durability-and-safety.md) |
| `src/core/registry.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/reload-shell-owner.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/shell-policy.ts` | [subsystems/background-task-runtime](./subsystems/background-task-runtime.md) |
| `src/core/task-durable.ts` | [subsystems/child-launch-durability-and-safety](./subsystems/child-launch-durability-and-safety.md) |
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

| Surface | Availability | Default |
| --- | --- | --- |
| `command:bg` | `always` | yes |
| `command:bg-clear` | `always` | yes |
| `command:bg-tasks` | `always` | yes |
| `command:bg-update` | `always` | yes |
| `command:claude-cache` | `feature:attribution` | yes |
| `command:fusion` | `feature:fusion` | yes |
| `command:fusion-models` | `feature:fusion` | yes |
| `command:jobs` | `always` | yes |
| `command:kill` | `always` | yes |
| `command:logs` | `always` | yes |
| `command:tasks` | `always` | yes |
| `tool:bg_delegate` | `feature:delegate` | yes |
| `tool:bg_kill` | `always` | yes |
| `tool:bg_logs` | `always` | yes |
| `tool:bg_result` | `any(feature:delegate,feature:fusion)` | yes |
| `tool:bg_run` | `always` | yes |
| `tool:bg_run_pi_attested` | `feature:attested` | yes |
| `tool:bg_status` | `always` | yes |
| `tool:fusion_investigate` | `feature:fusion` | yes |
| `tool:fusion_reason` | `feature:fusion` | yes |
| `tool:fusion_research` | `feature:fusion` | yes |
| `tool:fusion_validate` | `feature:fusion` | yes |
| `shortcut:ctrl+alt+b` | `dock:ctrl+alt+b` | no |
| `shortcut:ctrl+alt+c` | `always` | yes |
| `shortcut:shift+down` | `dock:shift+down` | yes |
| `renderer:background-task-notification` | `always` | yes |
| `renderer:fusion-result` | `feature:fusion` | yes |
| `eventbus:background-task-v1` | `always` | yes |
| `workflow:investigate` | `feature:fusion` | yes |
| `workflow:reason` | `feature:fusion` | yes |
| `workflow:research` | `feature:fusion` | yes |
| `workflow:validate` | `feature:fusion` | yes |
