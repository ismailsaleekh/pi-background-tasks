---
doc_id: operations/troubleshooting
audience: maintainer
mode: authored
review_policy: contract
stability: evolving
covers_surfaces: []
covers_sources: []
---
# Troubleshooting

Start from the symptom, verify the source-owned doc, then apply the remediation. Do not tier-bump models, switch routes, or add fallbacks to make a failure disappear.

| Symptom/error | Likely cause | Remediation |
|---|---|---|
| EventBus response says `request frame must be an object`, `unknown key`, `schema_version mismatch`, or duplicate `request_id` | Request frame violates the closed EventBus v1 schema | Fix caller frame to match `docs/api/eventbus-v1.md`; never relax closed-frame validation. |
| EventBus says service unavailable before `session_start` | Extension API is installed but no session context exists | Start/await Pi session startup; do not fabricate a context. |
| Terminal event arrives unexpectedly early in a consumer | Consumer is not waiting for the `run` response before correlating task id, or an older implementation lacks the gate | Bind response first; current API gates terminal publication for `run`/`kill`. See `docs/api/eventbus-v1.md`. |
| `bg_run` starts but logs are bounded/truncated | `bg_logs` is model-visible and capped by design | Read the full output file path from the notice only when operator-approved; do not increase model-visible logs casually. |
| Output cap terminates a task | `PI_BG_MAX_OUTPUT_BYTES` cap reached | Inspect full command behavior; raise cap only deliberately for that run environment. The task failure is intentional safety. |
| `PI_BG_SHELL` or `PI_BG_SHELL_PATH` error on Windows | Windows shell selection is closed and path-validated | Use `PI_BG_SHELL=cmd` or `bash`; if setting `PI_BG_SHELL_PATH`, provide an absolute `.exe`/`.com`. See `docs/subsystems/child-launch-durability-and-safety.md`. |
| `pi_executable_resolution_failed` | Windows Pi package bin cannot be resolved/validated | Reinstall/repair Pi package; do not fall back to shell PATH shims. |
| `pi_command_line_too_long` | Rendered Windows command line exceeds 32,767 UTF-16 units | Move large payload to stdin/artifact path; do not truncate argv. |
| Terminal metadata/output durability failure | Fsync/close/metadata write failed | Treat terminal state as failed; inspect `DurableFileError` operation/path/cause. See `docs/subsystems/child-launch-durability-and-safety.md`. |
| Delegate refuses with `delegate_hook_contract_unsupported` | Current Pi hook behavior does not match committed evidence | Re-run the hook characterization gate during release work and re-review the guard; do not weaken the guard. See `docs/operations/testing.md`. |
| Delegate refuses with `route_unresolved` or `route_capacity_unknown` | Requested/default route unavailable or lacks usable context window | Pin an available provider/model with declared context window; no substitute route is selected. |
| Delegate refuses with `seed_budget_exceeded` | Exact child prompt plus system prompt exceeds allowed input under the backed route-family policy or conservative fallback | Use a larger-context subscription route, delegate earlier, or reduce visible parent text. Nothing was clipped. |
| Delegate spills many individually small tool results | Retaining them would consume protected final-answer runway | This is expected lossless pressure control. The full bytes are in `spill/`; inspect `runtime-budget.json`. Narrow the investigation only if receipt-driven range reads become excessive. |
| Delegate enters finalization runway | Advisory context/runway pressure disabled tools so the child can answer from gathered evidence | Let the child finish. Do not re-enable tools or treat the advisory estimate as a provider context rejection. |
| `bg_result` says not ready | Child has not committed `result.json` yet | Wait for terminal notification or inspect later; do not poll tightly. |
| Delegate result corruption/hash/identity mismatch | Result package does not match task/seed/route/hash contract | Treat as invalid; inspect artifact bytes. Do not synthesize an answer. |
| Fusion model unavailable or metered route refusal | Frontier route is not admitted as a Pi subscription/OAuth route, or configured model is stale | Fix `/fusion-models` config to available subscription routes. Never route GPT/Claude-class work through metered APIs. |
| Fusion prompt budget exceeded | Stage forecast or measured prompt exceeds limiting route capacity after reserving the larger of the Fusion output contract and route maximum output | Use a larger-context or lower-max-output configured subscription route, or reduce explicit request/context. Do not route-substitute after planning. |
| `child_runtime_limit_exceeded` | The child exceeded 550 provider requests or 600 tool calls | Inspect the failed audit seal and split an unbounded task; do not raise limits blindly. |
| `child_runtime_payload_invalid` | The final provider payload could not be normalized as one stable JSON object | Fix the provider/payload integration; Fusion does not fall back to a lossy serializer. |
| `child_cache_policy_invalid` | Claude cache policy, retention configuration, or final cache-control shape was invalid | Set `PI_CACHE_RETENTION` to `none`, `short`, or `long`; do not bypass its four-breakpoint or shape checks. |
| Fusion child timeout vs idle timeout | Absolute timeout is 50 minutes; idle watchdog is 35 minutes of no stdout/stderr activity | Preserve distinction in errors. `FUSION_CHILD_IDLE_TIMEOUT_MS` is a source constant, not documented as env-configurable. |
| Fusion research URL rejected | Source URL is not declared/public http(s), has credentials, resolves to blocked address class, or redirects unsafely | Provide declared public source URLs with purpose; targeted fetch is not search. |
| `/fusion-models` rejects in non-TUI mode | Selector requires interactive UI | Use an interactive Pi TUI session to edit config; headless path should fail loudly. |
| `/bg-update` shows no update | Offline/opt-out/current-version/registry failure path | Check `PI_OFFLINE`, `PI_BG_DISABLE_UPDATE_CHECK`, `PI_BG_REGISTRY_URL`; update check is one-shot and non-blocking. |
| TypeBox/compat failure | Installed package resolved a private/nested TypeBox or used removed APIs | Keep TypeBox as Pi-provided peer and verify installed payload. See `docs/operations/releasing.md`. |

Detailed references: EventBus API (`docs/api/eventbus-v1.md`), context budgeting (`docs/concepts/context-projection-and-budgeting.md`), launch/durability (`docs/subsystems/child-launch-durability-and-safety.md`), runtime registry (`docs/reference/runtime-contracts.md`), testing (`docs/operations/testing.md`), releasing (`docs/operations/releasing.md`).
