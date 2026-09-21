export const FUSION_MODEL_CONFIG_SCHEMA_VERSION = 'pi-background-tasks.fusion-models.v1';
export const FUSION_LEGACY_INPUT_SCHEMA_VERSION = 'pi-background-tasks.fusion-input.v4';
export const FUSION_INPUT_SCHEMA_VERSION = 'pi-background-tasks.fusion-input.v5';
export const FUSION_EVALUATION_SCHEMA_VERSION = 'pi-background-tasks.fusion-evaluation.v1';
export const FUSION_VALIDATE_CANDIDATE_SCHEMA_VERSION = 'pi-background-tasks.fusion-validation-candidate.v1';
export const FUSION_LEGACY_RESULT_SCHEMA_VERSION = 'pi-background-tasks.fusion-result.v4';
export const FUSION_RESULT_SCHEMA_VERSION = 'pi-background-tasks.fusion-result.v5';
export const FUSION_COMMITTED_RESULT_SCHEMA_VERSION = 'pi-background-tasks.fusion-committed-result.v1';
export const FUSION_LEGACY_MANIFEST_SCHEMA_VERSION = 'pi-background-tasks.fusion-manifest.v3';
export const FUSION_MANIFEST_SCHEMA_VERSION = 'pi-background-tasks.fusion-manifest.v4';
export const FUSION_CONTEXT_LEDGER_SCHEMA_VERSION = 'pi-background-tasks.fusion-context-ledger.v2';
export const FUSION_SOURCE_POLICY_SCHEMA_VERSION = 'pi-background-tasks.fusion-source-policy.v1';
export const FUSION_BUDGET_PLAN_SCHEMA_VERSION = 'pi-background-tasks.fusion-budget-plan.v4';
export const FUSION_CALIBRATION_VIOLATION_SCHEMA_VERSION = 'pi-background-tasks.fusion-calibration-violation.v2';
export const FUSION_VALIDATE_CANDIDATE_CONTRACT_EVENT_SCHEMA_VERSION = 'pi-background-tasks.fusion-validation-candidate-contract-event.v1';
export const FUSION_TOOL_CALL_LOG_SCHEMA_VERSION = 'pi-background-tasks.fusion-tool-call.v1';
export const FUSION_FAILURE_SUMMARY_SCHEMA_VERSION = 'pi-background-tasks.fusion-failure-summary.v1';
/**
 * Conversation-projection transform shared by every Fusion entry point.
 *
 * The transform keeps visible user/assistant conversational text verbatim and
 * replaces assistant thinking plus all tool traffic with deterministic,
 * hash-accounted omission receipts. It never truncates retained text and never
 * forwards raw image bytes.
 */
export const FUSION_CONTEXT_TRANSFORM_ID = 'visible-conversation-ledger-v2';
export const FUSION_BRANCH_FILTER_ID = 'exclude-active-fusion-subtree-v1';
/** Entry-point specific context policies. Both use the same payload-exclusion transform. */
export const FUSION_TOOL_CONTEXT_POLICY_ID = 'fusion-tool-explicit-v2';
export const FUSION_COMMAND_CONTEXT_POLICY_ID = 'fusion-command-conversation-v2';
export const FUSION_IMAGE_OMISSION_PREFIX = '[Image omitted from fusion text transcript: ';
export const FUSION_CANDIDATE_IDS = ['A', 'B', 'C'];
export const FUSION_STAGE_VALUES = ['candidate', 'evaluation', 'merge'];
export const FUSION_CAPABILITY_VALUES = Object.freeze(['reason', 'inspect', 'research']);
/** No-tools capability for reason candidates, evaluator, repair, and merger. */
export const FUSION_NO_TOOLS_CAPABILITY = 'reason';
/** Legacy default retained for old type imports only. New workflows never default. */
export const FUSION_BRAINSTORM_DEFAULT_CAPABILITY = 'inspect';
/** @deprecated New v5 workflows have no caller capability default. */
export const FUSION_DEFAULT_CAPABILITY = FUSION_BRAINSTORM_DEFAULT_CAPABILITY;
export const FUSION_WEB_FETCH_TOOL_NAME = 'fusion_web_fetch';
export const FUSION_INSPECT_TOOLS = Object.freeze(['read', 'grep', 'find', 'ls']);
export const FUSION_RESEARCH_TOOLS = Object.freeze([
    'read',
    'grep',
    'find',
    'ls',
    FUSION_WEB_FETCH_TOOL_NAME,
]);
/**
 * Workflow identities sharing one orchestrator, one context projection, one
 * evaluation schema, and one artifact store. A workflow selects stage framing and
 * capability policy only; it never changes the canonical input schema.
 */
export const FUSION_WORKFLOW_IDS = Object.freeze([
    'reason',
    'investigate',
    'research',
    'validate',
]);
export const FUSION_PUBLIC_WORKFLOW_NAMES = Object.freeze([
    'fusion_reason',
    'fusion_investigate',
    'fusion_research',
    'fusion_validate',
]);
/**
 * The single capability the validate workflow ever runs candidates with.
 *
 * Deliberately separate from the caller-selectable brainstorm default. Although
 * both workflows currently give candidates read-only inspection, validation pins
 * that capability as fixed policy rather than exposing a caller override.
 */
export const FUSION_VALIDATE_CAPABILITY = 'inspect';
export const FUSION_FORBIDDEN_TOOLS = Object.freeze([
    'bash',
    'edit',
    'write',
    'fusion_brainstorm',
    'fusion_reason',
    'fusion_investigate',
    'fusion_research',
    'fusion_validate',
    'bg_delegate',
    'bg_result',
    'bg_run',
    'bg_kill',
    'bg_status',
    'bg_logs',
    'bg_run_pi_attested',
]);
/**
 * Prompt-expansion stages guarded by deterministic size accounting. `evaluation`
 * and `evaluation_repair` share the evaluator model but render different prompts.
 */
export const FUSION_BUDGET_STAGE_VALUES = [
    'candidate',
    'evaluation',
    'evaluation_repair',
    'merge',
];
export const FUSION_SOURCE_VALUES = ['command', 'tool'];
export const FUSION_STATE_VALUES = [
    'initializing',
    'candidates_running',
    'candidates_complete',
    'evaluating',
    'evaluation_complete',
    'merging',
    'completed',
    'failed',
    'cancelled',
];
export const FUSION_NONTERMINAL_STATE_VALUES = [
    'initializing',
    'candidates_running',
    'candidates_complete',
    'evaluating',
    'evaluation_complete',
    'merging',
];
export const FUSION_TERMINAL_STATE_VALUES = ['completed', 'failed', 'cancelled'];
export const FUSION_OMITTED_EVENT_KINDS = [
    'assistant_thinking',
    'tool_call',
    'tool_result_text',
    'tool_result_image',
];
const EMPTY_FUSION_COST = Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
});
export const EMPTY_FUSION_USAGE = Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: EMPTY_FUSION_COST,
});
export function createEmptyFusionUsage() {
    return cloneFusionUsage(EMPTY_FUSION_USAGE);
}
export function cloneFusionUsage(usage) {
    return {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        ...(usage.cacheWrite1h === undefined ? {} : { cacheWrite1h: usage.cacheWrite1h }),
        ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
        totalTokens: usage.totalTokens,
        cost: {
            input: usage.cost.input,
            output: usage.cost.output,
            cacheRead: usage.cost.cacheRead,
            cacheWrite: usage.cost.cacheWrite,
            total: usage.cost.total,
        },
    };
}
export function addFusionUsage(target, delta) {
    target.input += delta.input;
    target.output += delta.output;
    target.cacheRead += delta.cacheRead;
    target.cacheWrite += delta.cacheWrite;
    if (delta.cacheWrite1h !== undefined) {
        target.cacheWrite1h = (target.cacheWrite1h ?? 0) + delta.cacheWrite1h;
    }
    if (delta.reasoning !== undefined) {
        target.reasoning = (target.reasoning ?? 0) + delta.reasoning;
    }
    target.totalTokens += delta.totalTokens;
    target.cost.input += delta.cost.input;
    target.cost.output += delta.cost.output;
    target.cost.cacheRead += delta.cost.cacheRead;
    target.cost.cacheWrite += delta.cost.cacheWrite;
    target.cost.total += delta.cost.total;
}
export class FusionError extends Error {
    code;
    stage;
    slot;
    attempt;
    artifactDir;
    transient;
    childCreated;
    budget;
    runProgress;
    constructor(message, details) {
        super(message);
        this.name = 'FusionError';
        this.code = details.code;
        this.stage = details.stage;
        this.slot = details.slot;
        this.attempt = details.attempt;
        this.artifactDir = details.artifactDir;
        this.transient = details.transient ?? false;
        this.childCreated = details.childCreated ?? true;
        this.budget = details.budget;
        this.runProgress = details.runProgress;
    }
}
//# sourceMappingURL=types.js.map