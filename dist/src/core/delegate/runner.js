import { existsSync } from 'node:fs';
import { readFile, rmdir } from 'node:fs/promises';
import { canonicalJson } from '../canonical-json.js';
import { replaceFileDurable } from '../durable-fs.js';
import { resolveAnthropicAttributionExtensionPath } from '../anthropic-attribution-path.js';
import { dirname, join } from 'node:path';
import { DelegateArtifactStore, discardDelegateArtifactRoot } from './artifacts.js';
import { buildDelegateChildArgv, delegateChildEnv, ensureDelegateChildSessionDir, preflightDelegateLaunch, resolveDelegateChildExtensionPath, } from './launch.js';
import { DELEGATE_INLINE_ANSWER_BYTES } from './budget.js';
import { verifyDelegateResultPackage } from './result-package.js';
import { DelegateError, } from './types.js';
const PREPARATION_CLEANUP_ERROR_MAX_CHARS = 320;
function boundedPreparationError(error) {
    const text = (error instanceof Error ? error.message : String(error))
        .replace(/\s+/gu, ' ')
        .trim();
    if (text.length <= PREPARATION_CLEANUP_ERROR_MAX_CHARS)
        return text;
    return `${text.slice(0, PREPARATION_CLEANUP_ERROR_MAX_CHARS)}…`;
}
function filesystemErrorCode(error) {
    if (typeof error !== 'object' || error === null)
        return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}
async function removeEmptyDirectory(path) {
    try {
        await rmdir(path);
        return true;
    }
    catch (error) {
        const code = filesystemErrorCode(error);
        if (code === 'ENOENT')
            return true;
        if (code === 'ENOTEMPTY' || code === 'EEXIST')
            return false;
        throw error;
    }
}
async function discardUnownedDelegatePreparation(rootAbs) {
    await discardDelegateArtifactRoot(rootAbs);
    const runParent = dirname(rootAbs);
    if (!(await removeEmptyDirectory(runParent)))
        return;
    await removeEmptyDirectory(dirname(runParent));
}
function throwIfPreparationAborted(signal) {
    if (signal?.aborted !== true)
        return;
    const reason = signal.reason;
    if (reason instanceof Error)
        throw reason;
    throw new Error('delegate launch preparation was cancelled before task registration');
}
function preparationCleanupFailure(original, cleanup) {
    return new AggregateError([original, cleanup], `delegate launch preparation failed and rollback also failed: ${boundedPreparationError(cleanup)}`);
}
/**
 * Prepare a delegate launch.
 *
 * Preflight runs first and completes entirely before the artifact directory is
 * created, so every admission refusal leaves zero children AND zero artifacts.
 * When a step after directory creation fails or activation cancellation is
 * observed, the producer removes the unowned directory before rejecting.
 */
export async function prepareDelegateLaunch(input) {
    throwIfPreparationAborted(input.signal);
    // Resolve the guard extension before anything is created: a package missing
    // its child guard must refuse rather than spawn an unguarded child.
    const childExtensionPath = input.childExtensionPath ?? resolveDelegateChildExtensionPath();
    let attributionExtensionPath;
    if (input.route.provider === 'anthropic') {
        try {
            attributionExtensionPath =
                input.attributionExtensionPath ?? resolveAnthropicAttributionExtensionPath();
        }
        catch (error) {
            throw new DelegateError(`Anthropic delegate attribution extension could not be resolved: ${error instanceof Error ? error.message : String(error)}`, {
                code: 'delegate_isolation_unsupported',
                childCreated: false,
                remediation: ['Reinstall the package; Anthropic delegates require attribution.'],
            });
        }
    }
    throwIfPreparationAborted(input.signal);
    const preflight = preflightDelegateLaunch(input);
    throwIfPreparationAborted(input.signal);
    let store;
    try {
        store = await DelegateArtifactStore.create({
            cwd: input.cwd,
            taskId: preflight.taskId,
            launchNonce: preflight.launchNonce,
            sessionId: input.sessionId,
            childSessionId: preflight.childSessionId,
            childSessionDir: '',
            extensionMode: input.extensionMode,
            route: input.route,
            limits: preflight.limits,
            seedSha256: preflight.seed.sha256,
            ...(input.now === undefined ? {} : { now: input.now }),
        });
        throwIfPreparationAborted(input.signal);
        const seedRef = await store.writeSeed(preflight.seed.serialized);
        throwIfPreparationAborted(input.signal);
        // The persisted seed bytes are the bytes the child reads. Nothing
        // re-serializes them between here and the child, and the child verifies the
        // hash before its first model call.
        if (seedRef.sha256 !== preflight.seed.sha256) {
            throw new DelegateError('delegate seed hash changed between construction and persistence', {
                code: 'seed_persist_failed',
                childCreated: false,
                taskId: preflight.taskId,
                artifactDir: store.artifactDir,
            });
        }
        await store.writeLedger(preflight.seed.ledger);
        throwIfPreparationAborted(input.signal);
        await store.writeBudgetPlan(preflight.plan);
        throwIfPreparationAborted(input.signal);
        const childSessionDirAbs = await ensureDelegateChildSessionDir(store.artifactDirAbs);
        throwIfPreparationAborted(input.signal);
        const seedPathAbs = join(store.artifactDirAbs, 'seed.json');
        const argv = buildDelegateChildArgv({
            route: input.route,
            capability: input.capability,
            extensionMode: input.extensionMode,
            childSessionId: preflight.childSessionId,
            childSessionDir: childSessionDirAbs,
            childExtensionPath,
            attributionExtensionPath,
            systemPrompt: preflight.childSystemPrompt,
        });
        const env = delegateChildEnv({
            artifactDirAbs: store.artifactDirAbs,
            seedPathAbs,
            seedSha256: preflight.seed.sha256,
            taskId: preflight.taskId,
            launchNonce: preflight.launchNonce,
        }, input.env ?? process.env);
        const facts = {
            taskId: preflight.taskId,
            launchNonce: preflight.launchNonce,
            artifactDir: store.artifactDir,
            artifactDirAbs: store.artifactDirAbs,
            seedSha256: preflight.seed.sha256,
            childSessionId: preflight.childSessionId,
            route: {
                provider: input.route.provider,
                model: input.route.model,
                qualifiedId: input.route.qualified_id,
            },
            budget: {
                family: preflight.plan.route.family,
                rate_source: preflight.plan.route.rate_source,
                conservative_rate_source: preflight.plan.conservative_estimate.rateSource,
            },
            extensionMode: input.extensionMode,
            autoDeliver: input.autoDeliver,
        };
        const stdinBytes = Buffer.from(preflight.childPrompt, 'utf8');
        // The persisted prompt bytes must equal the bytes sent to the child, so the
        // artifact is evidence of what the child actually received.
        await store.writeChildPrompt(stdinBytes);
        throwIfPreparationAborted(input.signal);
        const artifactDirAbs = store.artifactDirAbs;
        let rollbackPromise;
        const rollback = () => {
            rollbackPromise ??= discardUnownedDelegatePreparation(artifactDirAbs);
            return rollbackPromise;
        };
        return {
            preflight,
            store,
            argv,
            env,
            facts,
            childSessionDirAbs,
            seedPathAbs,
            stdinBytes,
            rollback,
        };
    }
    catch (error) {
        if (store === undefined)
            throw error;
        try {
            await discardUnownedDelegatePreparation(store.artifactDirAbs);
        }
        catch (cleanupError) {
            throw preparationCleanupFailure(error, cleanupError);
        }
        throw error;
    }
}
/**
 * Evaluate a finished delegate child.
 *
 * The committed result package is the sole answer data plane. Its presence under
 * its final name is the success signal; its absence means no answer was
 * accepted, whatever the process exit code happened to be. A child that exits 0
 * without committing is a typed `child_exited_without_commit`, never a silent
 * empty success.
 */
export async function evaluateDelegateTerminal(input) {
    const evaluation = await adjudicateDelegateTerminal(input);
    // Record the parent's adjudicated view separately from the child-written
    // result package, so neither writer can overwrite the other's claim.
    try {
        await replaceFileDurable(join(input.artifactDirAbs, 'outcome.json'), `${canonicalJson({
            schema_version: 'pi-background-tasks.delegate-outcome.v1',
            task_id: input.taskId,
            launch_nonce: input.launchNonce,
            observed_task_status: input.taskStatus,
            outcome: evaluation.outcome,
            error_code: evaluation.error?.code ?? null,
        })}\n`);
    }
    catch {
        // Failing to record the adjudication must not change the adjudication
        // itself, which is returned to the caller either way.
    }
    return evaluation;
}
async function adjudicateDelegateTerminal(input) {
    const resultPath = join(input.artifactDirAbs, 'result.json');
    const terminalPath = join(input.artifactDirAbs, 'child-terminal.json');
    if (!existsSync(resultPath)) {
        const recorded = existsSync(terminalPath) ? await readChildTerminal(terminalPath) : undefined;
        const cancelled = input.taskStatus === 'killed';
        const code = recorded?.code ?? (cancelled ? 'child_cancelled' : 'child_exited_without_commit');
        const detail = recorded?.message ??
            input.taskError ??
            'the delegate child exited without committing a result package';
        const preserved = [
            'seed.json',
            'budget-plan.json',
            'child-terminal.json',
            'runtime-budget.json',
        ].filter((name) => existsSync(join(input.artifactDirAbs, name)));
        if (input.taskOutputPath !== undefined &&
            input.taskOutputAbsPath !== undefined &&
            existsSync(input.taskOutputAbsPath)) {
            preserved.push(input.taskOutputPath);
        }
        const diagnosticTargets = preserved.filter((name) => name === 'child-terminal.json' ||
            name === 'runtime-budget.json' ||
            name === input.taskOutputPath);
        const diagnostic = diagnosticTargets.length === 0
            ? 'No child terminal record or merged task output exists; inspect the preserved launch artifacts listed above.'
            : `Inspect the preserved diagnostic evidence: ${diagnosticTargets.join(', ')}.`;
        const error = new DelegateError(`bg_delegate produced no committed answer: ${detail}`, {
            code: isDelegateErrorCode(code) ? code : 'child_exited_without_commit',
            childCreated: true,
            taskId: input.taskId,
            artifactDir: input.artifactDirAbs,
            preserved,
            remediation: [
                diagnostic,
                'No partial answer is returned; nothing was truncated to look like success.',
            ],
        });
        const outcome = {
            status: cancelled ? 'cancelled' : 'failed',
            errorCode: error.code,
        };
        return { outcome, error };
    }
    let raw;
    try {
        raw = await readFile(resultPath, 'utf8');
    }
    catch (error) {
        const failure = new DelegateError(`bg_delegate could not read its committed result package: ${error instanceof Error ? error.message : String(error)}`, {
            code: 'artifact_read_failed',
            childCreated: true,
            taskId: input.taskId,
            artifactDir: input.artifactDirAbs,
        });
        return { outcome: { status: 'failed', errorCode: failure.code }, error: failure };
    }
    try {
        const verified = verifyDelegateResultPackage(raw, {
            taskId: input.taskId,
            launchNonce: input.launchNonce,
            seedSha256: input.seedSha256,
            route: input.route,
        });
        return {
            outcome: {
                status: 'committed',
                answerBytes: verified.package.answer.byte_length,
                answerSha256: verified.package.answer.sha256,
                turns: verified.package.turns,
                toolCalls: verified.package.tool_calls,
            },
            result: verified,
        };
    }
    catch (error) {
        if (error instanceof DelegateError) {
            return { outcome: { status: 'failed', errorCode: error.code }, error };
        }
        throw error;
    }
}
async function readChildTerminal(path) {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null)
            return undefined;
        const code = Reflect.get(parsed, 'code');
        const message = Reflect.get(parsed, 'message');
        if (typeof code !== 'string' || typeof message !== 'string')
            return undefined;
        return { code, message };
    }
    catch {
        // A missing or malformed child-terminal record must not mask the primary
        // "no committed answer" failure, which is reported by the caller either way.
        return undefined;
    }
}
const DELEGATE_ERROR_CODE_SET = new Set([
    'delegate_hook_contract_unsupported',
    'delegate_isolation_unsupported',
    'route_unresolved',
    'route_capacity_unknown',
    'seed_projection_failed',
    'seed_budget_exceeded',
    'seed_persist_failed',
    'invalid_arguments',
    'child_spawn_failed',
    'child_startup_failed',
    'child_timeout',
    'child_cancelled',
    'child_turn_limit',
    'child_tool_call_limit',
    'child_exited_without_commit',
    'provider_context_budget_exhausted',
    'aggregate_tool_output_cap',
    'child_model_output_limit',
    'child_capture_limit',
    'child_result_invalid',
    'child_result_encoding_invalid',
    'route_attestation_missing',
    'route_mismatch',
    'seed_hash_mismatch',
    'answer_hash_mismatch',
    'artifact_spill_failed',
    'artifact_read_failed',
    'artifact_error',
    'result_not_ready',
    'result_unavailable',
    'result_too_large_for_inline',
    'task_unknown',
]);
function isDelegateErrorCode(value) {
    return DELEGATE_ERROR_CODE_SET.has(value);
}
/**
 * Decide inline versus artifact delivery.
 *
 * The cap is applied to the exact serialized answer bytes. An answer over the
 * cap degrades to an artifact reference explicitly and is never shortened to
 * fit.
 */
export function decideDelegateDelivery(answerBytes, requested, cap = DELEGATE_INLINE_ANSWER_BYTES) {
    if (requested === 'artifact') {
        return { mode: 'artifact', reason: 'artifact delivery was requested explicitly' };
    }
    if (answerBytes <= cap) {
        return {
            mode: 'inline',
            reason: `the answer is ${String(answerBytes)} bytes, within the ${String(cap)}-byte inline cap`,
        };
    }
    return {
        mode: 'artifact',
        reason: `the answer is ${String(answerBytes)} bytes, over the ${String(cap)}-byte inline cap`,
    };
}
/** Raised when inline delivery was explicitly requested for an oversized answer. */
export function inlineTooLarge(taskId, artifactDir, answerBytes, cap = DELEGATE_INLINE_ANSWER_BYTES) {
    return new DelegateError(`bg_result cannot return this answer inline: it is ${String(answerBytes)} bytes, over the ${String(cap)}-byte inline cap. The complete verified answer is preserved at ${join(artifactDir, 'result.json')}. It is not truncated to fit.`, {
        code: 'result_too_large_for_inline',
        childCreated: true,
        taskId,
        artifactDir,
        preserved: [join(artifactDir, 'result.json')],
        remediation: [
            'Call bg_result with delivery:"artifact" to receive the verified metadata plus the artifact reference.',
            'Read the answer from the artifact path directly if the full text is required.',
        ],
    });
}
//# sourceMappingURL=runner.js.map