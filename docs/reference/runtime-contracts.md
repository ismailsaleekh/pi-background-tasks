---
doc_id: reference/runtime-contracts
audience: maintainer
mode: mixed
review_policy: contract
stability: evolving
covers_surfaces: []
covers_sources: []
---
# Runtime contracts reference

This generated registry lists production environment-variable references, runtime paths/artifacts, schema identifiers, and status vocabularies extracted from package source. It intentionally excludes incidental source-code literals such as package metadata import paths.

<!-- pi-docs:begin name="runtime-contracts" generator="scripts/docs/generate.mjs" -->
### Environment variable references

| Name | Access | Provenance |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `ANTHROPIC_AUTH_TOKEN` | remove | `src/core/fusion/pi-child.ts:100` |
| `ANTHROPIC_BASE_URL` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_AD_TOKEN` | remove | `src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_API_KEY` | remove | `src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_API_VERSION` | remove | `src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_BASE_URL` | remove | `src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | remove | `src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_ENDPOINT` | remove | `src/core/fusion/pi-child.ts:100` |
| `AZURE_OPENAI_RESOURCE_NAME` | remove | `src/core/fusion/pi-child.ts:100` |
| `ComSpec` | read | `src/core/common.ts:726`<br>`src/core/common.ts:737` |
| `OPENAI_API_KEY` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `OPENAI_BASE_URL` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `OPENROUTER_API_KEY` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `OPENROUTER_BASE_URL` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `path` | read | `src/core/common.ts:681` |
| `Path` | read | `src/core/common.ts:681` |
| `PATH` | read | `src/core/common.ts:681` |
| `PI_API_BASE_URL` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_API_KEY` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_AUTH_FILE` | remove | `src/core/attested-pi-run.ts:135`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_BG_DELEGATE_ARTIFACT_DIR` | read, write | `src/core/delegate/launch.ts:353`<br>`src/delegate-child-extension.ts:384` |
| `PI_BG_DELEGATE_LAUNCH_NONCE` | read, write | `src/core/delegate/launch.ts:357`<br>`src/delegate-child-extension.ts:388` |
| `PI_BG_DELEGATE_SEED_PATH` | read, write | `src/core/delegate/launch.ts:354`<br>`src/delegate-child-extension.ts:385` |
| `PI_BG_DELEGATE_SEED_SHA256` | read, write | `src/core/delegate/launch.ts:355`<br>`src/delegate-child-extension.ts:386` |
| `PI_BG_DELEGATE_TASK_ID` | read, write | `src/core/delegate/launch.ts:356`<br>`src/delegate-child-extension.ts:387` |
| `PI_BG_DISABLE_PI_TELEMETRY` | read | `src/core/registry.ts:195` |
| `PI_BG_DISABLE_UPDATE_CHECK` | read | `src/extension.ts:455` |
| `PI_BG_MAX_OUTPUT_BYTES` | read | `src/core/registry.ts:69` |
| `PI_BG_REGISTRY_URL` | read | `src/extension.ts:464` |
| `PI_BG_SHELL` | read | `src/core/common.ts:722` |
| `PI_BG_SHELL_PATH` | read | `src/core/common.ts:723` |
| `PI_CACHE_RETENTION` | read, write | `src/core/anthropic-attribution.ts:587`<br>`src/core/fusion/claude-cache.ts:57`<br>`src/core/fusion/pi-child.ts:273`<br>`src/core/fusion/pi-child.ts:274` |
| `PI_FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH` | read, remove, write | `src/core/fusion/pi-child.ts:100`<br>`src/core/fusion/pi-child.ts:1879`<br>`src/fusion-child-extension.ts:599` |
| `PI_FUSION_RESEARCH_ENABLED` | read, remove, write | `src/core/fusion/pi-child.ts:100`<br>`src/core/fusion/pi-child.ts:1902`<br>`src/fusion-child-extension.ts:608` |
| `PI_FUSION_SOURCE_POLICY_PATH` | read, remove, write | `src/core/fusion/pi-child.ts:100`<br>`src/core/fusion/pi-child.ts:1903`<br>`src/fusion-child-extension.ts:555` |
| `PI_FUSION_SOURCE_POLICY_SHA256` | read, remove, write | `src/core/fusion/pi-child.ts:100`<br>`src/core/fusion/pi-child.ts:1904`<br>`src/fusion-child-extension.ts:556` |
| `PI_FUSION_TOOL_CALL_LOG_PATH` | read, remove, write | `src/core/fusion/pi-child.ts:100`<br>`src/core/fusion/pi-child.ts:1891`<br>`src/fusion-child-extension.ts:598` |
| `PI_MODEL` | remove | `src/core/delegate/launch.ts:330`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_OFFLINE` | read | `src/extension.ts:456` |
| `PI_PROVIDER` | remove | `src/core/delegate/launch.ts:330`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_REASONING_LEVEL` | remove | `src/core/delegate/launch.ts:330`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_SESSION_FILE` | remove | `src/core/delegate/launch.ts:330`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_SESSION_ID` | remove | `src/core/delegate/launch.ts:330`<br>`src/core/fusion/pi-child.ts:100` |
| `PI_SKIP_VERSION_CHECK` | write | `src/core/delegate/launch.ts:352`<br>`src/core/fusion/pi-child.ts:272` |
| `PIPELINE_ANTHROPIC_ATTRIBUTION_AUDIT_PATH` | read | `src/core/anthropic-attribution.ts:1013` |
| `SHELL` | read | `src/core/common.ts:718` |
| `SystemRoot` | read | `src/core/windows-taskkill.ts:96` |
| `WINDIR` | read | `src/core/windows-taskkill.ts:101` |

### Runtime paths and artifacts

| Kind | Path/artifact | Provenance |
| --- | --- | --- |
| config | `fusion-models.json` | `src/core/fusion/config.ts:21` |
| delegate-artifact | `budget-plan.json` | `src/core/delegate/artifacts.ts:44` |
| delegate-artifact | `child-prompt.txt` | `src/core/delegate/artifacts.ts:48` |
| delegate-artifact | `context-omission-ledger.json` | `src/core/delegate/artifacts.ts:43` |
| delegate-artifact | `error.json` | `src/core/delegate/artifacts.ts:50` |
| delegate-artifact | `manifest.json` | `src/core/delegate/artifacts.ts:45` |
| delegate-artifact | `outcome.json` | `src/core/delegate/artifacts.ts:46` |
| delegate-artifact | `result.json` | `src/core/delegate/result-package.ts:28` |
| delegate-artifact | `seed.json` | `src/core/delegate/artifacts.ts:42` |
| delegate-artifact | `spill/<receipt-named-file>` | `src/core/delegate/artifacts.ts:54` |
| directory | `.pi/delegate/<session-id>-<pid>/<task-id>/` | `src/core/delegate/artifacts.ts:160` |
| directory | `.pi/fusion/<session-id>-<pid>/<run-id>/` | `src/core/fusion/artifacts.ts:563` |
| directory | `.pi/tasks/<session-id>-<pid>/` | `src/core/registry.ts:784` |
| fusion-artifact | `<attempt-prefix> = candidate-<slot>.attempt-<n> \| evaluation.attempt-<n> \| merge.attempt-<n>` | `src/core/fusion/artifacts.ts:248` |
| fusion-artifact | `<attempt-prefix>.calibration-violation.json` | `src/core/fusion/artifacts.ts:263` |
| fusion-artifact | `<attempt-prefix>.events.jsonl` | `src/core/fusion/artifacts.ts:804` |
| fusion-artifact | `<attempt-prefix>.prompt.txt` | `src/core/fusion/artifacts.ts:803` |
| fusion-artifact | `<attempt-prefix>.stderr.txt` | `src/core/fusion/artifacts.ts:805` |
| fusion-artifact | `blind-candidates.json` | `src/core/fusion/artifacts.ts:708` |
| fusion-artifact | `budget-plan.json` | `src/core/fusion/artifacts.ts:704` |
| fusion-artifact | `candidate-<slot>.attempt-<n>.response.md \| candidate-<slot>.attempt-<n>.response.partial.md` | `src/core/fusion/artifacts.ts:258` |
| fusion-artifact | `candidate-<slot>.attempt-<n>.tool-calls.jsonl` | `src/core/fusion/artifacts.ts:623` |
| fusion-artifact | `candidate-<slot>.attempt-<n>.tool-calls.jsonl.seal.json` | `src/core/fusion/child-protocol.ts:22` |
| fusion-artifact | `canonical-input.json` | `src/core/fusion/artifacts.ts:674` |
| fusion-artifact | `context-omission-ledger.json` | `src/core/fusion/artifacts.ts:683` |
| fusion-artifact | `error.json` | `src/core/fusion/artifacts.ts:733` |
| fusion-artifact | `evaluation.attempt-<n>.response.txt \| evaluation.attempt-<n>.response.partial.txt` | `src/core/fusion/artifacts.ts:258` |
| fusion-artifact | `evaluation.json` | `src/core/fusion/artifacts.ts:383` |
| fusion-artifact | `merge.attempt-<n>.response.md \| merge.attempt-<n>.response.partial.md` | `src/core/fusion/artifacts.ts:258` |
| fusion-artifact | `merged.md` | `src/core/fusion/artifacts.ts:387` |
| fusion-artifact | `result.json` | `src/core/fusion/artifacts.ts:647` |
| fusion-artifact | `source-policy.private.json` | `src/core/fusion/artifacts.ts:690` |
| task-file | `.pi/tasks/<session-id>-<pid>/<task-id>.attestation.json` | `src/core/attested-pi-run.ts:592` |
| task-file | `.pi/tasks/<session-id>-<pid>/<task-id>.json` | `src/core/registry.ts:812` |
| task-file | `.pi/tasks/<session-id>-<pid>/<task-id>.output` | `src/core/registry.ts:811` |
| task-file | `.pi/tasks/<session-id>-<pid>/<task-id>.pi-events.jsonl` | `src/core/attested-pi-run.ts:589` |
| task-file | `.pi/tasks/<session-id>-<pid>/<task-id>.pi-telemetry-wrapper.cjs` | `src/core/attested-pi-run.ts:591` |
| task-file | `.pi/tasks/<session-id>-<pid>/<task-id>.stderr` | `src/core/attested-pi-run.ts:590` |

### Schema identifiers

| Schema | Provenance |
| --- | --- |
| `phase2.pi_task_attestation.v1` | `src/core/attested-pi-run.ts:20` |
| `pi-background-tasks.delegate-budget-plan.v3` | `src/core/delegate/types.ts:21` |
| `pi-background-tasks.delegate-child-terminal.v1` | `src/delegate-child-extension.ts:584` |
| `pi-background-tasks.delegate-hook-contract.v1` | `src/core/delegate/hook-contract.ts:15` |
| `pi-background-tasks.delegate-launch.v1` | `src/delegate-extension.ts:458` |
| `pi-background-tasks.delegate-ledger.v1` | `src/core/delegate/types.ts:16` |
| `pi-background-tasks.delegate-manifest.v2` | `src/core/delegate/types.ts:22` |
| `pi-background-tasks.delegate-outcome.v1` | `src/core/delegate/runner.ts:228` |
| `pi-background-tasks.delegate-receipt.v1` | `src/core/delegate/types.ts:19` |
| `pi-background-tasks.delegate-result-view.v1` | `src/delegate-extension.ts:734` |
| `pi-background-tasks.delegate-result.v1` | `src/core/delegate/types.ts:18` |
| `pi-background-tasks.delegate-runtime-budget.v1` | `src/delegate-child-extension.ts:489` |
| `pi-background-tasks.delegate-seed.v2` | `src/core/delegate/types.ts:15` |
| `pi-background-tasks.delegate-tool-result-content.v1` | `src/delegate-child-extension.ts:190` |
| `pi-background-tasks.extension-request.v1` | `src/core/extension-api.ts:15` |
| `pi-background-tasks.extension-response.v1` | `src/core/extension-api.ts:16` |
| `pi-background-tasks.extension-terminal.v1` | `src/core/extension-api.ts:17` |
| `pi-background-tasks.fusion-blind-candidates.v1` | `src/core/fusion/prompts.ts:309` |
| `pi-background-tasks.fusion-budget-plan.v4` | `src/core/fusion/types.ts:27` |
| `pi-background-tasks.fusion-calibration-violation.v2` | `src/core/fusion/types.ts:29` |
| `pi-background-tasks.fusion-child-result.v4` | `src/core/fusion/child-protocol.ts:10` |
| `pi-background-tasks.fusion-child-settlement.v3` | `src/core/fusion/child-protocol.ts:13` |
| `pi-background-tasks.fusion-claude-cache-observation.v1` | `src/core/fusion/claude-cache.ts:4` |
| `pi-background-tasks.fusion-committed-result.v1` | `src/core/fusion/types.ts:22` |
| `pi-background-tasks.fusion-context-ledger.v2` | `src/core/fusion/types.ts:25` |
| `pi-background-tasks.fusion-evaluation-repair-input.v1` | `src/core/fusion/prompts.ts:289` |
| `pi-background-tasks.fusion-evaluation.v1` | `src/core/fusion/types.ts:16` |
| `pi-background-tasks.fusion-failure-summary.v1` | `src/core/fusion/types.ts:34` |
| `pi-background-tasks.fusion-input.v4` | `src/core/fusion/types.ts:14` |
| `pi-background-tasks.fusion-input.v5` | `src/core/fusion/types.ts:15` |
| `pi-background-tasks.fusion-launch.v1` | `src/fusion-extension.ts:1125` |
| `pi-background-tasks.fusion-manifest.v3` | `src/core/fusion/types.ts:23` |
| `pi-background-tasks.fusion-manifest.v4` | `src/core/fusion/types.ts:24` |
| `pi-background-tasks.fusion-merge-input.v1` | `src/core/fusion/prompts.ts:336` |
| `pi-background-tasks.fusion-models.v1` | `src/core/fusion/types.ts:13` |
| `pi-background-tasks.fusion-progress.v1` | `src/fusion-extension.ts:59` |
| `pi-background-tasks.fusion-result-view.v1` | `src/delegate-extension.ts:775` |
| `pi-background-tasks.fusion-result.v4` | `src/core/fusion/types.ts:19` |
| `pi-background-tasks.fusion-result.v5` | `src/core/fusion/types.ts:20` |
| `pi-background-tasks.fusion-runtime-guard.v2` | `src/core/fusion/child-protocol.ts:24` |
| `pi-background-tasks.fusion-source-policy.v1` | `src/core/fusion/types.ts:26` |
| `pi-background-tasks.fusion-tool-call-seal.v1` | `src/core/fusion/child-protocol.ts:21` |
| `pi-background-tasks.fusion-tool-call.v1` | `src/core/fusion/types.ts:32` |
| `pi-background-tasks.fusion-validation-candidate-contract-event.v1` | `src/core/fusion/types.ts:31` |
| `pi-background-tasks.fusion-validation-candidate.v1` | `src/core/fusion/types.ts:18` |
| `pi-background-tasks.input-token-calibration.v1` | `src/core/context/token-budget.ts:18` |

### Status vocabularies


```json
{
  "DELEGATE_MANIFEST_STATES": [
    "launched",
    "running",
    "committed",
    "failed",
    "cancelled"
  ],
  "FUSION_BUDGET_STAGE_VALUES": [
    "candidate",
    "evaluation",
    "evaluation_repair",
    "merge"
  ],
  "FUSION_CAPABILITY_VALUES": [
    "reason",
    "inspect",
    "research"
  ],
  "FUSION_STAGE_VALUES": [
    "candidate",
    "evaluation",
    "merge"
  ],
  "FUSION_STATE_VALUES": [
    "initializing",
    "candidates_running",
    "candidates_complete",
    "evaluating",
    "evaluation_complete",
    "merging",
    "completed",
    "failed",
    "cancelled"
  ],
  "FUSION_TERMINAL_STATE_VALUES": [
    "completed",
    "failed",
    "cancelled"
  ],
  "TASK_STATUS_VALUES": [
    "running",
    "completed",
    "failed",
    "killed"
  ],
  "TERMINAL_TASK_STATUS_VALUES": [
    "completed",
    "failed",
    "killed"
  ]
}
```
<!-- pi-docs:end name="runtime-contracts" -->

## Maintenance rule

If a runtime fact changes in source, update the owning subsystem/API doc and run `npm run docs:generate`. Do not hand-edit generated tables.
