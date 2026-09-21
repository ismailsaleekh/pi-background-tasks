export const DELEGATE_SEED_SCHEMA_VERSION = 'pi-background-tasks.delegate-seed.v2';
export const DELEGATE_LEDGER_SCHEMA_VERSION = 'pi-background-tasks.delegate-ledger.v1';
export const DELEGATE_RESULT_PACKAGE_SCHEMA_VERSION = 'pi-background-tasks.delegate-result.v1';
export const DELEGATE_RECEIPT_SCHEMA_VERSION = 'pi-background-tasks.delegate-receipt.v1';
export const DELEGATE_BUDGET_PLAN_SCHEMA_VERSION = 'pi-background-tasks.delegate-budget-plan.v3';
export const DELEGATE_MANIFEST_SCHEMA_VERSION = 'pi-background-tasks.delegate-manifest.v2';
/**
 * Delegate's own context policy id. It shares the frozen
 * `visible-conversation-ledger-v2` transform with Fusion but is a distinct
 * consumer identity, so a delegate artifact can never be mistaken for a Fusion
 * artifact and neither can claim the other's provenance.
 */
export const DELEGATE_CONTEXT_POLICY_ID = 'delegate-inspect-v1';
export const DELEGATE_BRANCH_FILTER_ID = 'exclude-active-delegate-batch-v1';
export const DELEGATE_TOOL_NAME = 'bg_delegate';
export const DELEGATE_RESULT_TOOL_NAME = 'bg_result';
export const DELEGATE_CAPABILITIES = ['inspect'];
/**
 * Controls only Pi's ambient extension discovery for delegate children.
 * Tool and project-resource restrictions remain independently enforced.
 */
export const DELEGATE_EXTENSION_MODES = ['isolated', 'ambient'];
export const DELEGATE_AUTO_DELIVER_MODES = ['never', 'when_small', 'always'];
export const DELEGATE_DELIVERY_MODES = ['inline', 'artifact'];
export const DELEGATE_ERROR_CODES = [
    // Admission failures. No child process exists in these states.
    'delegate_hook_contract_unsupported',
    'delegate_isolation_unsupported',
    'route_unresolved',
    'route_capacity_unknown',
    'seed_projection_failed',
    'seed_budget_exceeded',
    'seed_persist_failed',
    'invalid_arguments',
    // Launch and execution.
    'child_spawn_failed',
    'child_startup_failed',
    'child_timeout',
    'child_cancelled',
    'child_turn_limit',
    'child_tool_call_limit',
    'child_exited_without_commit',
    // Budget, split by which budget was exhausted.
    'provider_context_budget_exhausted',
    'aggregate_tool_output_cap',
    'child_model_output_limit',
    'child_capture_limit',
    // Integrity.
    'child_result_invalid',
    'child_result_encoding_invalid',
    'route_attestation_missing',
    'route_mismatch',
    'seed_hash_mismatch',
    'answer_hash_mismatch',
    'artifact_spill_failed',
    'artifact_read_failed',
    'artifact_error',
    // Retrieval states and outcomes.
    'result_not_ready',
    'result_unavailable',
    'result_too_large_for_inline',
    'task_unknown',
];
/**
 * Typed delegate failure.
 *
 * Every instance states what happened, what was preserved, and what the operator
 * can do. There is no untyped delegate failure path.
 */
export class DelegateError extends Error {
    code;
    childCreated;
    taskId;
    artifactDir;
    budget;
    preserved;
    remediation;
    constructor(message, details) {
        super(message);
        this.name = 'DelegateError';
        this.code = details.code;
        this.childCreated = details.childCreated ?? false;
        this.taskId = details.taskId;
        this.artifactDir = details.artifactDir;
        this.budget = details.budget;
        this.preserved = details.preserved ?? [];
        this.remediation = details.remediation ?? [];
    }
    /** Operator-facing rendering: cause, preserved evidence, and next action. */
    describe() {
        const lines = [`[${this.code}] ${this.message}`];
        lines.push(`Child process created: ${this.childCreated ? 'yes' : 'no'}`);
        if (this.artifactDir !== undefined)
            lines.push(`Artifacts: ${this.artifactDir}`);
        lines.push(this.preserved.length > 0
            ? `Preserved: ${this.preserved.join(', ')}`
            : 'Preserved: nothing was written for this failure');
        if (this.remediation.length > 0)
            lines.push(`Remediation: ${this.remediation.join(' ')}`);
        return lines.join('\n');
    }
}
//# sourceMappingURL=types.js.map