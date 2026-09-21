import { FUSION_EVALUATION_REPAIR_SYSTEM_PROMPT, FUSION_EVALUATOR_SYSTEM_PROMPT, FUSION_MERGER_SYSTEM_PROMPT, FUSION_VALIDATE_EVALUATION_REPAIR_SYSTEM_PROMPT, FUSION_VALIDATE_EVALUATOR_SYSTEM_PROMPT, FUSION_VALIDATE_MERGER_SYSTEM_PROMPT, fusionCandidateSystemPrompt, fusionValidateCandidateSystemPrompt, } from './prompts.js';
import { FUSION_INSPECT_TOOLS, FUSION_NO_TOOLS_CAPABILITY, FUSION_RESEARCH_TOOLS, FUSION_VALIDATE_CAPABILITY, FusionError, } from './types.js';
export const FUSION_REASON_TOOL_NAME = 'fusion_reason';
export const FUSION_INVESTIGATE_TOOL_NAME = 'fusion_investigate';
export const FUSION_RESEARCH_TOOL_NAME = 'fusion_research';
export const FUSION_VALIDATE_TOOL_NAME = 'fusion_validate';
/** @deprecated v4 recursion-denylist compatibility only; do not register new public APIs with this name. */
export const FUSION_BRAINSTORM_TOOL_NAME = 'fusion_brainstorm';
function freezeProfile(profile) {
    const empty = Object.freeze([]);
    return Object.freeze({
        ...profile,
        candidateTools: Object.freeze([...profile.candidateTools]),
        evaluatorTools: empty,
        mergeTools: empty,
    });
}
export const FUSION_REASON_WORKFLOW = freezeProfile({
    id: 'reason',
    publicName: FUSION_REASON_TOOL_NAME,
    toolName: FUSION_REASON_TOOL_NAME,
    runIdPrefix: 'reason-',
    contextKind: 'session_projection',
    candidateCapability: FUSION_NO_TOOLS_CAPABILITY,
    candidateTools: [],
    evaluatorCapability: FUSION_NO_TOOLS_CAPABILITY,
    evaluatorTools: [],
    mergeCapability: FUSION_NO_TOOLS_CAPABILITY,
    mergeTools: [],
    candidateSystemPrompt: fusionCandidateSystemPrompt,
    evaluatorSystemPrompt: FUSION_EVALUATOR_SYSTEM_PROMPT,
    evaluationRepairSystemPrompt: FUSION_EVALUATION_REPAIR_SYSTEM_PROMPT,
    mergerSystemPrompt: FUSION_MERGER_SYSTEM_PROMPT,
    label: 'fusion reason',
});
export const FUSION_INVESTIGATE_WORKFLOW = freezeProfile({
    id: 'investigate',
    publicName: FUSION_INVESTIGATE_TOOL_NAME,
    toolName: FUSION_INVESTIGATE_TOOL_NAME,
    runIdPrefix: 'investigate-',
    contextKind: 'clean_task',
    candidateCapability: 'inspect',
    candidateTools: FUSION_INSPECT_TOOLS,
    evaluatorCapability: FUSION_NO_TOOLS_CAPABILITY,
    evaluatorTools: [],
    mergeCapability: FUSION_NO_TOOLS_CAPABILITY,
    mergeTools: [],
    candidateSystemPrompt: fusionCandidateSystemPrompt,
    evaluatorSystemPrompt: FUSION_EVALUATOR_SYSTEM_PROMPT,
    evaluationRepairSystemPrompt: FUSION_EVALUATION_REPAIR_SYSTEM_PROMPT,
    mergerSystemPrompt: FUSION_MERGER_SYSTEM_PROMPT,
    label: 'fusion investigate',
});
export const FUSION_RESEARCH_WORKFLOW = freezeProfile({
    id: 'research',
    publicName: FUSION_RESEARCH_TOOL_NAME,
    toolName: FUSION_RESEARCH_TOOL_NAME,
    runIdPrefix: 'research-',
    contextKind: 'clean_task',
    candidateCapability: 'research',
    candidateTools: FUSION_RESEARCH_TOOLS,
    evaluatorCapability: FUSION_NO_TOOLS_CAPABILITY,
    evaluatorTools: [],
    mergeCapability: FUSION_NO_TOOLS_CAPABILITY,
    mergeTools: [],
    candidateSystemPrompt: fusionCandidateSystemPrompt,
    evaluatorSystemPrompt: FUSION_EVALUATOR_SYSTEM_PROMPT,
    evaluationRepairSystemPrompt: FUSION_EVALUATION_REPAIR_SYSTEM_PROMPT,
    mergerSystemPrompt: FUSION_MERGER_SYSTEM_PROMPT,
    label: 'fusion research',
});
export const FUSION_VALIDATE_WORKFLOW = freezeProfile({
    id: 'validate',
    publicName: FUSION_VALIDATE_TOOL_NAME,
    toolName: FUSION_VALIDATE_TOOL_NAME,
    runIdPrefix: 'validate-',
    contextKind: 'clean_task',
    candidateCapability: FUSION_VALIDATE_CAPABILITY,
    candidateTools: FUSION_INSPECT_TOOLS,
    evaluatorCapability: FUSION_NO_TOOLS_CAPABILITY,
    evaluatorTools: [],
    mergeCapability: FUSION_NO_TOOLS_CAPABILITY,
    mergeTools: [],
    candidateSystemPrompt: fusionValidateCandidateSystemPrompt,
    evaluatorSystemPrompt: FUSION_VALIDATE_EVALUATOR_SYSTEM_PROMPT,
    evaluationRepairSystemPrompt: FUSION_VALIDATE_EVALUATION_REPAIR_SYSTEM_PROMPT,
    mergerSystemPrompt: FUSION_VALIDATE_MERGER_SYSTEM_PROMPT,
    label: 'fusion validate',
});
const PROFILES_BY_ID = Object.freeze({
    reason: FUSION_REASON_WORKFLOW,
    investigate: FUSION_INVESTIGATE_WORKFLOW,
    research: FUSION_RESEARCH_WORKFLOW,
    validate: FUSION_VALIDATE_WORKFLOW,
});
export const FUSION_WORKFLOW_PROFILES = Object.freeze([
    FUSION_REASON_WORKFLOW,
    FUSION_INVESTIGATE_WORKFLOW,
    FUSION_RESEARCH_WORKFLOW,
    FUSION_VALIDATE_WORKFLOW,
]);
export function fusionWorkflowProfile(id) {
    const profile = PROFILES_BY_ID[id];
    if (profile === undefined) {
        throw new FusionError(`unknown fusion workflow ${String(id)}`, {
            code: 'orchestration_failed',
            childCreated: false,
        });
    }
    return profile;
}
export function assertWorkflowCapability(profile, requested) {
    if (requested !== undefined && requested !== profile.candidateCapability) {
        throw new FusionError(`fusion workflow ${profile.id} always runs candidates with the ${profile.candidateCapability} capability; received ${String(requested)}`, { code: 'orchestration_failed', childCreated: false });
    }
    return profile.candidateCapability;
}
/** @deprecated v4 artifact/testing alias. The retired public tool is never registered. */
export const FUSION_BRAINSTORM_WORKFLOW = FUSION_REASON_WORKFLOW;
export const FUSION_REASON = FUSION_REASON_WORKFLOW;
export const FUSION_INVESTIGATE = FUSION_INVESTIGATE_WORKFLOW;
export const FUSION_RESEARCH = FUSION_RESEARCH_WORKFLOW;
export const FUSION_VALIDATE = FUSION_VALIDATE_WORKFLOW;
/** @deprecated v5 workflows do not default; retained for old imports. */
export const resolveWorkflowCapability = assertWorkflowCapability;
//# sourceMappingURL=workflows.js.map