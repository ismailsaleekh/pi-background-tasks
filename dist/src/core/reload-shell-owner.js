import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { isAbsolute } from 'node:path';
import { formatSize } from '@earendil-works/pi-coding-agent';
import { isJsonObject, parseJsonText, snapshot, ReloadSurvivalError, } from './common.js';
import { replaceFileDurable } from './durable-fs.js';
import { runWindowsTaskkill, } from './windows-taskkill.js';
export const RELOAD_SHELL_OWNER_PROTOCOL = 'pi-background-tasks.reload-shell-owner.v1';
export const RELOAD_SHELL_OWNER_SYMBOL = Symbol.for(RELOAD_SHELL_OWNER_PROTOCOL);
export const RELOAD_SHELL_HANDOFF_TIMEOUT_MS = 30_000;
const TELEMETRY_BUFFER_CHARS = 512 * 1024;
export { ReloadSurvivalError } from './common.js';
const hubStates = new WeakMap();
const OWNER_STATE_SYMBOL = Symbol.for(`${RELOAD_SHELL_OWNER_PROTOCOL}.test-state`);
function ownerError(code, message) {
    return new ReloadSurvivalError(code, message);
}
function randomNonce() {
    return randomBytes(16).toString('hex');
}
function requireNonce(value, label) {
    if (!/^[0-9a-f]{32}$/u.test(value)) {
        throw ownerError('pi_bg_reload_owner_stale_claim', `${label} is not a 128-bit lowercase hex nonce`);
    }
}
function positiveTimeout(value, fallback) {
    const candidate = value ?? fallback;
    if (!Number.isFinite(candidate) || candidate <= 0) {
        throw ownerError('pi_bg_reload_owner_protocol_incompatible', 'handoff timeout must be positive');
    }
    return Math.max(1, Math.floor(candidate));
}
function lengthPart(value) {
    return `${String(Buffer.byteLength(value, 'utf8'))}:${value}`;
}
export function makeReloadShellIdentity(sessionId, cwdRealpath, hostPid = process.pid) {
    if (!Number.isSafeInteger(hostPid) || hostPid <= 0 || hostPid !== process.pid) {
        throw ownerError('pi_bg_reload_owner_stale_claim', `reload owner host pid must equal the current process pid ${String(process.pid)}`);
    }
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw ownerError('pi_bg_reload_owner_stale_claim', 'reload owner session id must be non-empty');
    }
    if (typeof cwdRealpath !== 'string' || cwdRealpath.length === 0 || !isAbsolute(cwdRealpath)) {
        throw ownerError('pi_bg_reload_owner_stale_claim', 'reload owner cwd identity must be a non-empty absolute canonical path');
    }
    return Object.freeze({ hostPid, sessionId, cwdRealpath });
}
export function reloadShellIdentityKey(identity) {
    if (identity.hostPid !== process.pid) {
        throw ownerError('pi_bg_reload_owner_stale_claim', 'reload owner identity belongs to another process');
    }
    return `${lengthPart(String(identity.hostPid))}${lengthPart(identity.sessionId)}${lengthPart(identity.cwdRealpath)}`;
}
function structuralHub(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    if (Reflect.get(value, 'protocol') !== RELOAD_SHELL_OWNER_PROTOCOL)
        return false;
    if (typeof Reflect.get(value, 'hubNonce') !== 'string')
        return false;
    for (const method of [
        'beginActivation',
        'commitActivation',
        'abortActivation',
        'beginReloadHandoff',
        'releaseActivation',
        'registerExecution',
        'markAdmissionCommitted',
        'releaseExecution',
        'isCurrentLease',
    ]) {
        if (typeof Reflect.get(value, method) !== 'function')
            return false;
    }
    return true;
}
function sameIdentity(left, right) {
    return (left.hostPid === right.hostPid &&
        left.sessionId === right.sessionId &&
        left.cwdRealpath === right.cwdRealpath);
}
function clearHandoffTimer(slot) {
    if (slot.handoffTimer !== undefined) {
        clearTimeout(slot.handoffTimer);
        slot.handoffTimer = undefined;
    }
}
function boundedError(error) {
    const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').trim();
    return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}
export function createReloadShellOwnerHubForTests(dependencies = {}) {
    const now = dependencies.now ?? Date.now;
    const nextNonce = dependencies.randomNonce ?? randomNonce;
    const logger = dependencies.logger ?? console;
    const handoffTimeoutMs = positiveTimeout(dependencies.handoffTimeoutMs, RELOAD_SHELL_HANDOFF_TIMEOUT_MS);
    const slots = new Map();
    const terminalReleaseContinuations = new WeakMap();
    const hubNonce = nextNonce();
    requireNonce(hubNonce, 'hub nonce');
    const failStale = (message) => {
        throw ownerError('pi_bg_reload_owner_stale_claim', message);
    };
    const currentSlotForLease = (lease) => {
        if (lease.protocol !== RELOAD_SHELL_OWNER_PROTOCOL || lease.hubNonce !== hubNonce) {
            return failStale('activation lease belongs to another owner protocol instance');
        }
        const slot = slots.get(lease.identityKey);
        if (slot === undefined ||
            slot.phase !== 'bound' ||
            slot.lease?.generation !== lease.generation ||
            slot.lease.activationNonce !== lease.activationNonce) {
            return failStale('activation lease is stale or no longer bound');
        }
        return slot;
    };
    const slotForClaim = (claim) => {
        if (claim.protocol !== RELOAD_SHELL_OWNER_PROTOCOL || claim.hubNonce !== hubNonce) {
            return failStale('activation claim belongs to another owner protocol instance');
        }
        const slot = slots.get(claim.identityKey);
        if (slot === undefined ||
            slot.phase !== 'claiming' ||
            slot.claim !== claim ||
            slot.claimNonce !== claim.claimNonce ||
            slot.generation !== claim.generation ||
            slot.activationNonce !== claim.activationNonce ||
            !sameIdentity(slot.identity, claim.identity)) {
            return failStale('activation claim is stale or no longer current');
        }
        if (claim.expiresAt !== undefined && now() >= claim.expiresAt) {
            return failStale('activation claim expired before mutation');
        }
        return slot;
    };
    const dispatch = (slot, kind, execution) => {
        if (slot.executions.get(execution.launchNonce) !== execution)
            return;
        const adapter = slot.adapter;
        if (slot.phase === 'releasing' && kind === 'terminal') {
            removeExecution(slot, execution);
            return;
        }
        if (slot.phase !== 'bound' || adapter === undefined) {
            if (kind === 'changed')
                slot.queuedChanged.add(execution.launchNonce);
            else
                slot.queuedTerminal.add(execution.launchNonce);
            return;
        }
        try {
            if (kind === 'changed')
                adapter.onChanged(execution);
            else
                adapter.onTerminal(execution);
        }
        catch (error) {
            logger.error(`[background-tasks] reload owner ${kind} adapter failed for ${execution.task.id}: ${boundedError(error)}`);
            if (kind === 'changed')
                slot.queuedChanged.add(execution.launchNonce);
            else
                slot.queuedTerminal.add(execution.launchNonce);
        }
    };
    function removeExecution(slot, execution) {
        if (slot.executions.get(execution.launchNonce) !== execution)
            return;
        slot.executions.delete(execution.launchNonce);
        slot.queuedChanged.delete(execution.launchNonce);
        slot.queuedTerminal.delete(execution.launchNonce);
        execution.setOwnerEventSink(undefined);
        execution.releaseResources();
        if (slot.executions.size === 0 &&
            (slot.phase === 'handoff' || slot.phase === 'releasing' || slot.phase === 'orphaned')) {
            clearHandoffTimer(slot);
            slots.delete(slot.identityKey);
        }
    }
    const releaseAfterTerminal = (slot, execution) => {
        const existing = terminalReleaseContinuations.get(execution);
        if (existing !== undefined)
            return existing;
        const continuation = execution.terminal.then(() => {
            if (slots.get(slot.identityKey) !== slot ||
                slot.executions.get(execution.launchNonce) !== execution) {
                return;
            }
            if (execution.phase !== 'terminal') {
                logger.error(`[background-tasks] retained reload shell execution ${execution.task.id} settled without terminal ownership proof; keeping its owner slot`);
                return;
            }
            try {
                removeExecution(slot, execution);
            }
            catch (error) {
                logger.error(`[background-tasks] retained reload shell execution cleanup failed for ${execution.task.id}: ${boundedError(error)}`);
            }
        }, (error) => {
            logger.error(`[background-tasks] retained reload shell execution terminal promise rejected for ${execution.task.id}; keeping its owner slot: ${boundedError(error)}`);
        });
        terminalReleaseContinuations.set(execution, continuation);
        return continuation;
    };
    const expireHandoff = (slot, deadline) => {
        if (slots.get(slot.identityKey) !== slot)
            return;
        if ((slot.phase !== 'handoff' && slot.phase !== 'claiming') ||
            slot.expiresAt !== deadline ||
            now() < deadline) {
            return;
        }
        slot.phase = 'orphaned';
        slot.adapter = undefined;
        slot.claim = undefined;
        delete slot.claimNonce;
        clearHandoffTimer(slot);
        const executions = [...slot.executions.values()];
        void Promise.allSettled(executions.map(async (execution) => {
            execution.abandonReloadHandoff();
            const terminalRelease = releaseAfterTerminal(slot, execution);
            try {
                if (execution.phase === 'running' || execution.phase === 'stop_requested') {
                    await execution.requestStop('handoff_expired', `pi_bg_reload_handoff_expired: no compatible reload activation claimed the live shell execution before the ${String(handoffTimeoutMs)}ms handoff deadline`);
                }
                else if (execution.phase === 'starting') {
                    execution.failAdmission(ownerError('pi_bg_reload_handoff_expired', 'uncommitted reload shell execution reached handoff expiry'));
                    await execution.requestStop('handoff_expired');
                }
                else if (execution.phase === 'finalizing') {
                    await execution.terminal;
                }
            }
            catch (error) {
                logger.error(`[background-tasks] reload handoff expiry could not settle ${execution.task.id}: ${boundedError(error)}`);
            }
            await terminalRelease;
        })).then(() => {
            if (slots.get(slot.identityKey) === slot && slot.executions.size === 0) {
                slots.delete(slot.identityKey);
            }
        });
        logger.error(`[background-tasks] pi_bg_reload_handoff_expired: ${String(executions.length)} live reload shell execution(s) were not claimed before the fixed handoff deadline`);
    };
    const armHandoffDeadline = (slot) => {
        const deadline = slot.expiresAt;
        if (deadline === undefined || slot.handoffTimer !== undefined)
            return;
        const remaining = Math.max(0, deadline - now());
        slot.handoffTimer = setTimeout(() => {
            slot.handoffTimer = undefined;
            expireHandoff(slot, deadline);
        }, remaining);
        // Deliberately referenced. The retained child/tree authority must keep the
        // process alive until a claimant or orphan cleanup owns it.
    };
    const hub = Object.assign(Object.create(null), {
        protocol: RELOAD_SHELL_OWNER_PROTOCOL,
        hubNonce,
        beginActivation(identity, startReason, activationNonce) {
            requireNonce(activationNonce, 'activation nonce');
            const identityKey = reloadShellIdentityKey(identity);
            let slot = slots.get(identityKey);
            if (slot === undefined) {
                const claimNonce = nextNonce();
                requireNonce(claimNonce, 'claim nonce');
                slot = {
                    identity: Object.freeze({ ...identity }),
                    identityKey,
                    generation: 1,
                    handoffCount: 0,
                    phase: 'claiming',
                    activationNonce,
                    claimNonce,
                    executions: new Map(),
                    queuedChanged: new Set(),
                    queuedTerminal: new Set(),
                };
                const claim = Object.freeze({
                    protocol: RELOAD_SHELL_OWNER_PROTOCOL,
                    hubNonce,
                    claimNonce,
                    identity: slot.identity,
                    identityKey,
                    generation: 1,
                    activationNonce,
                    executions: Object.freeze([]),
                });
                slot.claim = claim;
                slots.set(identityKey, slot);
                return claim;
            }
            if (!sameIdentity(slot.identity, identity)) {
                throw ownerError('pi_bg_reload_owner_activation_conflict', 'another activation owns a non-identical reload shell identity under this key');
            }
            if (slot.phase !== 'handoff' || startReason !== 'reload') {
                throw ownerError('pi_bg_reload_owner_activation_conflict', `another package activation already owns session ${JSON.stringify(identity.sessionId)} in state ${slot.phase}`);
            }
            if (slot.expiresAt === undefined || now() >= slot.expiresAt) {
                return failStale('reload handoff expired before activation claim');
            }
            slot.phase = 'claiming';
            slot.generation += 1;
            slot.activationNonce = activationNonce;
            const claimNonce = nextNonce();
            requireNonce(claimNonce, 'claim nonce');
            slot.claimNonce = claimNonce;
            const claim = Object.freeze({
                protocol: RELOAD_SHELL_OWNER_PROTOCOL,
                hubNonce,
                claimNonce,
                identity: slot.identity,
                identityKey,
                generation: slot.generation,
                activationNonce,
                expiresAt: slot.expiresAt,
                executions: Object.freeze([...slot.executions.values()].filter((execution) => execution.admissionCommitted)),
            });
            slot.claim = claim;
            return claim;
        },
        commitActivation(claim, adapter) {
            const slot = slotForClaim(claim);
            if (adapter.activationNonce !== claim.activationNonce) {
                return failStale('host adapter activation nonce does not match its claim');
            }
            const lease = Object.freeze({
                protocol: RELOAD_SHELL_OWNER_PROTOCOL,
                hubNonce,
                identityKey: slot.identityKey,
                generation: slot.generation,
                activationNonce: slot.activationNonce,
            });
            try {
                adapter.onBound(lease);
            }
            catch (error) {
                slot.phase = slot.expiresAt === undefined ? 'releasing' : 'handoff';
                slot.claim = undefined;
                delete slot.claimNonce;
                if (slot.expiresAt === undefined || slot.executions.size === 0) {
                    clearHandoffTimer(slot);
                    slots.delete(slot.identityKey);
                }
                else {
                    armHandoffDeadline(slot);
                }
                throw error;
            }
            slot.lease = lease;
            slot.claim = undefined;
            delete slot.claimNonce;
            slot.phase = 'bound';
            slot.adapter = adapter;
            clearHandoffTimer(slot);
            delete slot.expiresAt;
            for (const execution of claim.executions) {
                execution.updateLeaseAudit(slot.generation, slot.handoffCount);
                slot.queuedChanged.add(execution.launchNonce);
                if (execution.phase === 'terminal')
                    slot.queuedTerminal.add(execution.launchNonce);
            }
            for (const nonce of [...slot.queuedChanged]) {
                const execution = slot.executions.get(nonce);
                if (execution === undefined)
                    continue;
                slot.queuedChanged.delete(nonce);
                dispatch(slot, 'changed', execution);
            }
            for (const nonce of [...slot.queuedTerminal]) {
                const execution = slot.executions.get(nonce);
                if (execution === undefined)
                    continue;
                slot.queuedTerminal.delete(nonce);
                dispatch(slot, 'terminal', execution);
            }
            return lease;
        },
        abortActivation(claim, error) {
            void error;
            const slot = slotForClaim(claim);
            slot.claim = undefined;
            delete slot.claimNonce;
            if (slot.expiresAt === undefined) {
                slot.phase = 'releasing';
                if (slot.executions.size === 0)
                    slots.delete(slot.identityKey);
                return;
            }
            slot.phase = 'handoff';
            if (slot.executions.size === 0) {
                clearHandoffTimer(slot);
                slots.delete(slot.identityKey);
                return;
            }
            armHandoffDeadline(slot);
        },
        beginReloadHandoff(lease) {
            const slot = currentSlotForLease(lease);
            // Detach first: no child/timer callback after this line can reach an old
            // registry or Pi closure.
            slot.adapter = undefined;
            slot.phase = 'handoff';
            slot.handoffCount += 1;
            slot.expiresAt = now() + handoffTimeoutMs;
            slot.lease = undefined;
            const transferred = [];
            for (const execution of [...slot.executions.values()]) {
                if (execution.admissionCommitted) {
                    slot.queuedChanged.add(execution.launchNonce);
                    if (execution.phase === 'terminal')
                        slot.queuedTerminal.add(execution.launchNonce);
                    transferred.push(execution);
                    continue;
                }
                // Admission closure remains old-registry owned and uncommitted work is
                // never claimable. Keep its process authority in the hub until terminal
                // settlement, without requiring either the old or fresh host adapter.
                void releaseAfterTerminal(slot, execution);
            }
            if (slot.executions.size === 0) {
                clearHandoffTimer(slot);
                slots.delete(slot.identityKey);
                return Object.freeze([]);
            }
            armHandoffDeadline(slot);
            return Object.freeze(transferred);
        },
        releaseActivation(lease) {
            const slot = currentSlotForLease(lease);
            slot.adapter = undefined;
            slot.lease = undefined;
            slot.phase = 'releasing';
            clearHandoffTimer(slot);
            for (const execution of [...slot.executions.values()]) {
                if (execution.phase === 'terminal')
                    removeExecution(slot, execution);
            }
            if (slot.executions.size === 0)
                slots.delete(slot.identityKey);
        },
        registerExecution(lease, execution) {
            const slot = currentSlotForLease(lease);
            if (execution.protocol !== RELOAD_SHELL_OWNER_PROTOCOL) {
                throw ownerError('pi_bg_reload_owner_protocol_incompatible', 'reload shell execution protocol is incompatible');
            }
            if (slot.executions.has(execution.launchNonce)) {
                throw ownerError('pi_bg_reload_owner_activation_conflict', `reload shell launch nonce ${execution.launchNonce} is already registered`);
            }
            slot.executions.set(execution.launchNonce, execution);
            execution.setOwnerEventSink({
                onChanged: (changed) => dispatch(slot, 'changed', changed),
                onTerminal: (terminal) => dispatch(slot, 'terminal', terminal),
            });
        },
        markAdmissionCommitted(lease, execution) {
            const slot = currentSlotForLease(lease);
            if (slot.executions.get(execution.launchNonce) !== execution) {
                return failStale('cannot commit an execution not registered to this activation');
            }
            execution.markAdmissionCommitted(slot.generation, slot.handoffCount);
        },
        releaseExecution(leaseOrClaim, execution) {
            let slot;
            if ('claimNonce' in leaseOrClaim)
                slot = slotForClaim(leaseOrClaim);
            else
                slot = currentSlotForLease(leaseOrClaim);
            if (slot.executions.get(execution.launchNonce) !== execution) {
                return failStale('cannot release an execution not owned by this activation');
            }
            if (execution.phase === 'terminal') {
                removeExecution(slot, execution);
                return;
            }
            // A bounded stop wait is not terminal proof. Retain the child, streams,
            // listeners, tree state, and timers under this slot until the execution's
            // one terminal continuation can release them safely.
            void releaseAfterTerminal(slot, execution);
        },
        isCurrentLease(lease) {
            try {
                currentSlotForLease(lease);
                return true;
            }
            catch {
                return false;
            }
        },
    });
    const internalState = { slots };
    hubStates.set(hub, internalState);
    Object.defineProperty(hub, OWNER_STATE_SYMBOL, {
        value: internalState,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return hub;
}
export function getProcessReloadShellOwnerV1() {
    const current = Reflect.get(globalThis, RELOAD_SHELL_OWNER_SYMBOL);
    if (current !== undefined) {
        if (!structuralHub(current)) {
            throw ownerError('pi_bg_reload_owner_protocol_incompatible', `global symbol ${RELOAD_SHELL_OWNER_PROTOCOL} contains an incompatible value`);
        }
        return current;
    }
    const created = createReloadShellOwnerHubForTests();
    Reflect.set(globalThis, RELOAD_SHELL_OWNER_SYMBOL, created);
    return created;
}
/** Direct-source-only deterministic inspection seam; not exported by a package facade. */
export function inspectReloadShellOwnerForTests(hub, identity) {
    const localState = hubStates.get(hub);
    const reflectedState = Reflect.get(hub, OWNER_STATE_SYMBOL);
    const state = localState ??
        (typeof reflectedState === 'object' && reflectedState !== null
            ? reflectedState
            : undefined);
    if (state === undefined) {
        return {
            phase: undefined,
            generation: undefined,
            expiresAt: undefined,
            hasAdapter: false,
            executions: Object.freeze([]),
        };
    }
    const slot = state.slots.get(reloadShellIdentityKey(identity));
    return {
        phase: slot?.phase,
        generation: slot?.generation,
        expiresAt: slot?.expiresAt,
        hasAdapter: slot?.adapter !== undefined,
        executions: Object.freeze(slot === undefined ? [] : [...slot.executions.values()]),
    };
}
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;
}
function normalizeContextUsage(value) {
    if (!isJsonObject(value))
        return undefined;
    const input = value;
    const contextWindow = typeof input.contextWindow === 'number' &&
        Number.isFinite(input.contextWindow) &&
        input.contextWindow > 0
        ? Math.floor(input.contextWindow)
        : undefined;
    if (contextWindow === undefined)
        return undefined;
    const tokens = input.tokens === null
        ? null
        : typeof input.tokens === 'number' && Number.isFinite(input.tokens) && input.tokens >= 0
            ? Math.floor(input.tokens)
            : null;
    const percent = input.percent === null
        ? null
        : typeof input.percent === 'number' && Number.isFinite(input.percent) && input.percent >= 0
            ? input.percent
            : tokens === null
                ? null
                : (tokens / contextWindow) * 100;
    return { tokens, contextWindow, percent };
}
function normalizeTokenUsage(value) {
    if (!isJsonObject(value))
        return undefined;
    const input = value;
    const usage = {
        input: nonNegativeInteger(input.input),
        output: nonNegativeInteger(input.output),
        cacheRead: nonNegativeInteger(input.cacheRead),
        cacheWrite: nonNegativeInteger(input.cacheWrite),
        totalTokens: nonNegativeInteger(input.totalTokens),
    };
    if (usage.totalTokens <= 0) {
        usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    }
    if (typeof input.costTotal === 'number' &&
        Number.isFinite(input.costTotal) &&
        input.costTotal >= 0) {
        usage.costTotal = input.costTotal;
    }
    return usage.totalTokens > 0 ? usage : undefined;
}
function normalizeToolUsage(value) {
    if (!isJsonObject(value))
        return undefined;
    const input = value;
    const byName = {};
    if (isJsonObject(input.byName)) {
        for (const [name, count] of Object.entries(input.byName)) {
            const normalized = nonNegativeInteger(count);
            if (normalized > 0)
                byName[name] = normalized;
        }
    }
    const failed = nonNegativeInteger(input.failed);
    const total = Math.max(nonNegativeInteger(input.total), failed, Object.values(byName).reduce((sum, count) => sum + count, 0));
    return total > 0 || failed > 0 ? { total, failed, byName } : undefined;
}
function normalizeModel(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0)
        return undefined;
    return trimmed.length <= 120 ? trimmed : trimmed.slice(0, 120);
}
function parseContextUsageXml(xml) {
    const number = (tag) => {
        const match = new RegExp(`<${tag}>(.*?)</${tag}>`, 'iu').exec(xml);
        if (match === null)
            return undefined;
        const raw = match[1]?.trim();
        if (raw === 'null' || raw === '?')
            return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    return normalizeContextUsage({
        tokens: number('tokens'),
        contextWindow: number('context-window') ?? number('contextWindow'),
        percent: number('percent'),
    });
}
async function writeOwnerMetadata(path, value, signal) {
    await replaceFileDurable(path, `${JSON.stringify(value, null, 2)}\n`, signal === undefined ? {} : { signal });
}
async function closeOwnerOutputStream(stream) {
    if (stream === undefined || stream.destroyed || stream.closed)
        return;
    await new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            stream.off('error', fail);
            stream.off('close', finish);
            stream.off('finish', finish);
            resolve();
        };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            stream.off('close', finish);
            stream.off('finish', finish);
            reject(error);
        };
        stream.once('close', finish);
        stream.once('finish', finish);
        stream.once('error', fail);
        stream.end();
    });
}
function appendError(existing, next) {
    if (existing === undefined || existing.length === 0)
        return next;
    return existing.includes(next) ? existing : `${existing}; ${next}`;
}
function taskkillDescription(outcome) {
    return [
        `exit=${String(outcome.exitCode)}`,
        `signal=${String(outcome.signal)}`,
        outcome.stdout.length > 0 ? `stdout=${JSON.stringify(outcome.stdout)}` : '',
        outcome.stderr.length > 0 ? `stderr=${JSON.stringify(outcome.stderr)}` : '',
        outcome.stdoutTruncated ? 'stdout_truncated=true' : '',
        outcome.stderrTruncated ? 'stderr_truncated=true' : '',
    ]
        .filter(Boolean)
        .join(' ');
}
/**
 * Create and spawn the complete live execution retained by the process-global
 * owner. The returned object is structural and survives hot-loaded module copies.
 */
export function createReloadableShellExecutionV1(options) {
    const task = options.task;
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const now = options.now ?? Date.now;
    const logger = options.logger ?? console;
    const spawn = options.spawn ??
        ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
    const killProcess = options.killProcess ?? process.kill.bind(process);
    const killTree = options.killTree ??
        ((pid, phase, signal) => {
            const taskkillOptions = signal === undefined ? { env } : { env, signal };
            return runWindowsTaskkill(pid, phase, taskkillOptions);
        });
    const outputStream = createWriteStream(task.outputAbsPath, { flags: 'a', encoding: 'utf8' });
    let child;
    try {
        child = spawn(options.invocation.shell, [...options.invocation.args], {
            cwd: task.cwd,
            detached: platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
            windowsHide: true,
            windowsVerbatimArguments: options.invocation.windowsVerbatimArguments,
        });
    }
    catch (error) {
        outputStream.destroy();
        throw error;
    }
    const childPid = child.pid;
    if (childPid === undefined || !Number.isSafeInteger(childPid) || childPid <= 0) {
        outputStream.destroy();
        try {
            child.kill('SIGKILL');
        }
        catch {
            // The loud launch error remains authoritative; no PID authority was acquired.
        }
        throw ownerError('pi_bg_reload_owner_unavailable', 'opted reload shell spawn did not provide a positive child pid');
    }
    task.child = child;
    task.pid = childPid;
    task.stream = outputStream;
    if (platform !== 'win32')
        task.ownedPosixProcessGroupId = childPid;
    const spawnedAt = task.startTime;
    const timeoutDeadlineAt = task.timeoutSeconds === undefined ? undefined : spawnedAt + task.timeoutSeconds * 1000;
    const audit = {
        schemaVersion: 'pi-background-tasks.reload-shell.v1',
        authority: 'same-process-live-owner',
        hostPid: options.identity.hostPid,
        sessionId: options.identity.sessionId,
        cwdRealpath: options.identity.cwdRealpath,
        launchNonce: options.launchNonce,
        completionId: `${task.id}:1`,
        spawnedAt,
        childPid,
        outputCapBytes: options.maxOutputBytes,
        leaseGeneration: options.lease.generation,
        handoffCount: 0,
    };
    if (timeoutDeadlineAt !== undefined)
        audit.timeoutDeadlineAt = timeoutDeadlineAt;
    if (platform === 'win32')
        audit.windowsTreeRootPid = childPid;
    else
        audit.posixProcessGroupId = childPid;
    task.reloadSurvival = audit;
    let sink;
    let resolveTerminal = () => { };
    const terminal = new Promise((resolve) => {
        resolveTerminal = resolve;
    });
    let resolveInitialMetadata = () => { };
    let rejectInitialMetadata = () => { };
    let initialMetadataSettled = false;
    const initialMetadata = new Promise((resolve, reject) => {
        resolveInitialMetadata = resolve;
        rejectInitialMetadata = reject;
    });
    void initialMetadata.catch(() => undefined);
    let finalization;
    let posixTree;
    let windowsTree;
    let stopKind;
    let notificationToken;
    const writeMetadata = async (value = snapshot(task), signal) => {
        const write = async () => {
            await writeOwnerMetadata(task.metadataAbsPath, value, signal);
        };
        const previous = task.metadataWriteChain ?? Promise.resolve();
        const next = previous.then(write, write);
        task.metadataWriteChain = next.catch(() => undefined);
        await next;
    };
    const changed = () => {
        sink?.onChanged(execution);
    };
    const writeBuffer = (buffer) => {
        const stream = execution.outputStream;
        if (stream === undefined || stream.destroyed || buffer.length === 0)
            return;
        const nextBytes = task.bytesWritten + buffer.length;
        if (nextBytes <= execution.outputCapBytes) {
            stream.write(buffer);
            task.bytesWritten = nextBytes;
            return;
        }
        const remaining = Math.max(0, execution.outputCapBytes - task.bytesWritten);
        if (remaining > 0) {
            stream.write(buffer.subarray(0, remaining));
            task.bytesWritten += remaining;
        }
        if (task.capExceeded)
            return;
        task.capExceeded = true;
        task.error = `Output exceeded cap of ${formatSize(execution.outputCapBytes)}; terminating task`;
        const notice = Buffer.from(`\n\n[background task error: ${task.error}]\n`, 'utf8');
        stream.write(notice);
        task.bytesWritten += notice.length;
        changed();
        void execution.requestStop('output_cap', task.error).catch((error) => {
            task.error = appendError(task.error, `kill failed: ${boundedError(error)}`);
        });
    };
    const ingestTelemetry = (text) => {
        if (text.length === 0)
            return;
        const telemetryText = `${task.contextUsageBuffer ?? ''}${text}`;
        let context = task.contextUsage;
        let tokens = task.tokenUsage;
        let tools = task.toolUsage;
        let model = task.model;
        for (const line of telemetryText.split(/\r?\n/u)) {
            if (!line.includes('background-task-'))
                continue;
            const trimmed = line.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = parseJsonText(trimmed);
                    if (!isJsonObject(parsed))
                        continue;
                    if (parsed['type'] === 'background-task-context-usage') {
                        context = normalizeContextUsage(parsed) ?? context;
                    }
                    else if (parsed['type'] === 'background-task-telemetry') {
                        context = normalizeContextUsage(parsed['contextUsage']) ?? context;
                        tokens = normalizeTokenUsage(parsed['tokenUsage']) ?? tokens;
                        tools = normalizeToolUsage(parsed['toolUsage']) ?? tools;
                        model = normalizeModel(parsed['model']) ?? model;
                    }
                }
                catch {
                    // Optional telemetry never replaces raw output truth.
                }
            }
        }
        for (const match of telemetryText.matchAll(/<background-task-context-usage>[\s\S]*?<\/background-task-context-usage>/giu)) {
            context = parseContextUsageXml(match[0]) ?? context;
        }
        const lastNewline = Math.max(telemetryText.lastIndexOf('\n'), telemetryText.lastIndexOf('\r'));
        let retained = lastNewline >= 0 ? telemetryText.slice(lastNewline + 1) : telemetryText;
        const lower = telemetryText.toLowerCase();
        const open = lower.lastIndexOf('<background-task-context-usage');
        const close = lower.lastIndexOf('</background-task-context-usage>');
        if (open > close)
            retained = telemetryText.slice(open);
        task.contextUsageBuffer = retained.slice(-TELEMETRY_BUFFER_CHARS);
        const before = JSON.stringify({
            contextUsage: task.contextUsage,
            tokenUsage: task.tokenUsage,
            toolUsage: task.toolUsage,
            model: task.model,
        });
        task.contextUsage = context;
        task.tokenUsage = tokens;
        task.toolUsage = tools;
        task.model = model;
        const after = JSON.stringify({ contextUsage: context, tokenUsage: tokens, toolUsage: tools, model });
        if (before !== after) {
            changed();
            void writeMetadata().catch((error) => {
                logger.error(`[background-tasks] failed to write survivor telemetry for ${task.id}:`, error);
            });
        }
    };
    const finishPosix = (state, failure) => {
        if (state.settled)
            return;
        state.settled = true;
        state.failure = failure;
        if (state.verificationTimer !== undefined)
            clearTimeout(state.verificationTimer);
        if (task.killEscalationTimer !== undefined)
            clearTimeout(task.killEscalationTimer);
        delete task.killEscalationTimer;
        task.posixProcessGroupSignalAuthorityReleased = true;
        if (failure === undefined && task.ownedPosixProcessGroupId === state.groupId) {
            delete task.ownedPosixProcessGroupId;
        }
        state.resolve();
    };
    const probePosixGone = (state) => {
        if (state.settled)
            return state.failure === undefined;
        try {
            const present = killProcess(-state.groupId, 0);
            state.lastProbeError = present
                ? undefined
                : new Error(`process-group probe for ${String(state.groupId)} returned false`);
            return false;
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH') {
                finishPosix(state);
                return true;
            }
            state.lastProbeError = error instanceof Error ? error : new Error(String(error));
            return false;
        }
    };
    const recordPosixFailure = (state, error) => {
        task.error = appendError(task.error, error.message);
        writeBuffer(Buffer.from(`\n[background task POSIX termination: ${error.message}]\n`, 'utf8'));
        finishPosix(state, error);
        changed();
    };
    const verifyPosix = (state) => {
        if (state.settled)
            return;
        const remaining = state.deadlineAt - now();
        if (remaining <= 0) {
            const detail = state.lastProbeError ? `; last group probe failed: ${state.lastProbeError.message}` : '';
            recordPosixFailure(state, new Error(`POSIX process group ${String(state.groupId)} remained present after SIGKILL${detail}. Descendant processes may have leaked.`));
            return;
        }
        state.verificationTimer = setTimeout(() => {
            state.verificationTimer = undefined;
            if (!probePosixGone(state))
                verifyPosix(state);
        }, Math.min(10, remaining));
    };
    const forcePosix = (state) => {
        if (state.settled || state.forceAttempted)
            return;
        state.forceAttempted = true;
        if (task.killEscalationTimer !== undefined)
            clearTimeout(task.killEscalationTimer);
        delete task.killEscalationTimer;
        if (probePosixGone(state))
            return;
        try {
            if (!killProcess(-state.groupId, 'SIGKILL')) {
                recordPosixFailure(state, new Error(`POSIX process-group SIGKILL returned false for task ${task.id} group ${String(state.groupId)}. Descendant processes may have leaked.`));
                return;
            }
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH') {
                finishPosix(state);
                return;
            }
            recordPosixFailure(state, new Error(`POSIX process-group SIGKILL failed for task ${task.id} group ${String(state.groupId)}: ${boundedError(error)}. Descendant processes may have leaked.`));
            return;
        }
        if (!probePosixGone(state))
            verifyPosix(state);
    };
    const beginPosixStop = () => {
        if (posixTree !== undefined)
            return posixTree;
        if (task.posixProcessGroupSignalAuthorityReleased === true) {
            throw new Error(`Task ${task.id} has released its POSIX process-group signal authority`);
        }
        const groupId = task.ownedPosixProcessGroupId;
        if (groupId === undefined)
            throw new Error(`Task ${task.id} has no owned POSIX process group`);
        let resolve = () => { };
        const completion = new Promise((resolvePromise) => {
            resolve = resolvePromise;
        });
        const reserve = Math.min(25, Math.max(1, Math.floor(options.stopWaitMs / 4)));
        const state = {
            groupId,
            deadlineAt: now() + Math.max(1, options.stopWaitMs - reserve),
            completion,
            resolve,
            forceAttempted: false,
            settled: false,
        };
        posixTree = state;
        task.killEscalationTimer = setTimeout(() => {
            delete task.killEscalationTimer;
            forcePosix(state);
        }, Math.min(options.killGraceMs, Math.max(1, options.stopWaitMs - reserve)));
        return state;
    };
    const requestPosixStop = () => {
        const state = beginPosixStop();
        if (task.killSignalSent)
            return;
        task.killSignalSent = true;
        const failures = [];
        let sent = false;
        try {
            sent = killProcess(-state.groupId, 'SIGTERM');
            if (!sent)
                failures.push('process-group SIGTERM returned false');
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH') {
                finishPosix(state);
            }
            else {
                failures.push(`process-group SIGTERM failed: ${boundedError(error)}`);
            }
        }
        if (!sent && !state.settled) {
            try {
                sent = execution.child?.kill('SIGTERM') === true;
                if (!sent)
                    failures.push('child SIGTERM returned false');
            }
            catch (error) {
                failures.push(`child SIGTERM failed: ${boundedError(error)}`);
            }
        }
        if (!sent && !state.settled) {
            forcePosix(state);
            throw new Error(`Could not kill task ${task.id}: ${failures.join('; ')}`);
        }
    };
    const finishWindows = (state, failure) => {
        if (state.settled)
            return;
        state.settled = true;
        state.failure = failure;
        if (task.killEscalationTimer !== undefined)
            clearTimeout(task.killEscalationTimer);
        delete task.killEscalationTimer;
        state.resolve();
    };
    const evaluateTaskkill = (state, phase, outcome) => {
        if (outcome.exitCode === 0 || outcome.exitCode === 128)
            return undefined;
        if (phase === 'terminate')
            return undefined;
        return new Error(`Windows taskkill /T /F force termination failed for task ${task.id} pid ${String(state.pid)}: ${taskkillDescription(outcome)}. Descendant processes may have leaked.`);
    };
    const forceWindows = (state) => {
        if (state.forcePromise !== undefined)
            return state.forcePromise;
        state.forceAttempted = true;
        state.softController?.abort();
        if (task.killEscalationTimer !== undefined)
            clearTimeout(task.killEscalationTimer);
        delete task.killEscalationTimer;
        const launched = Promise.resolve().then(() => killTree(state.pid, 'force'));
        state.forcePromise = launched.then((outcome) => {
            const failure = evaluateTaskkill(state, 'force', outcome);
            if (failure !== undefined) {
                task.error = appendError(task.error, failure.message);
                finishWindows(state, failure);
                throw failure;
            }
            finishWindows(state);
        }, (error) => {
            const failure = new Error(`Windows taskkill /T /F force termination failed for task ${task.id} pid ${String(state.pid)}: ${boundedError(error)}. Descendant processes may have leaked.`);
            task.error = appendError(task.error, failure.message);
            finishWindows(state, failure);
            throw failure;
        });
        void state.forcePromise.catch((error) => {
            logger.error(`[background-tasks] Windows survivor force kill failed for ${task.id}:`, error);
        });
        return state.forcePromise;
    };
    const beginWindowsStop = () => {
        if (windowsTree !== undefined)
            return windowsTree;
        let resolve = () => { };
        const completion = new Promise((resolvePromise) => {
            resolve = resolvePromise;
        });
        const state = {
            pid: childPid,
            completion,
            resolve,
            forceAttempted: false,
            settled: false,
        };
        windowsTree = state;
        const controller = new AbortController();
        state.softController = controller;
        state.softPromise = Promise.resolve()
            .then(() => killTree(childPid, 'terminate', controller.signal))
            .then((outcome) => {
            if (state.forceAttempted || state.settled)
                return;
            if (outcome.exitCode === 0 || outcome.exitCode === 128)
                finishWindows(state);
            // Other soft failures deliberately retain force escalation.
        }, () => {
            // Soft failure deliberately retains force escalation.
        });
        task.killEscalationTimer = setTimeout(() => {
            delete task.killEscalationTimer;
            void forceWindows(state);
        }, options.killGraceMs);
        return state;
    };
    const requestWindowsStop = () => {
        beginWindowsStop();
        task.killSignalSent = true;
    };
    const awaitTreeBeforeTerminal = async () => {
        if (platform === 'win32') {
            if (windowsTree === undefined)
                return undefined;
            await windowsTree.completion;
            return windowsTree.failure;
        }
        if (posixTree === undefined) {
            task.posixProcessGroupSignalAuthorityReleased = true;
            delete task.ownedPosixProcessGroupId;
            return undefined;
        }
        probePosixGone(posixTree);
        await posixTree.completion;
        return posixTree.failure;
    };
    const terminalStatus = (code, signal) => {
        if (stopKind === 'user' || stopKind === 'shutdown')
            return { status: 'killed' };
        if (stopKind === 'timeout') {
            return { status: 'failed', error: task.error ?? `Timed out after ${String(task.timeoutSeconds)}s` };
        }
        if (stopKind === 'output_cap') {
            return { status: 'failed', error: task.error ?? `Output exceeded cap of ${formatSize(execution.outputCapBytes)}` };
        }
        if (stopKind === 'handoff_expired') {
            return {
                status: 'failed',
                error: task.error ??
                    'pi_bg_reload_handoff_expired: reload shell execution was not claimed before its handoff deadline',
            };
        }
        if ((code ?? 0) === 0)
            return { status: 'completed' };
        return {
            status: 'failed',
            error: `Exited with code ${code === null ? 'null' : String(code)}${signal ? ` (${signal})` : ''}`,
        };
    };
    const finalize = (code, signal) => {
        if (finalization !== undefined)
            return;
        execution.closeObservation = { code, signal, observedAt: now() };
        execution.phase = 'finalizing';
        finalization = (async () => {
            let result = terminalStatus(code, signal);
            try {
                await initialMetadata;
            }
            catch (error) {
                result = {
                    status: 'failed',
                    error: appendError(result.error, `Initial metadata write failed: ${boundedError(error)}`),
                };
            }
            const treeFailure = await awaitTreeBeforeTerminal();
            if (treeFailure !== undefined) {
                result = { status: 'failed', error: appendError(result.error, treeFailure.message) };
            }
            try {
                await closeOwnerOutputStream(execution.outputStream);
            }
            catch (error) {
                result = {
                    status: 'failed',
                    error: appendError(result.error, `Final output durability failed: ${boundedError(error)}`),
                };
            }
            task.exitCode = code;
            task.signal = signal;
            task.endTime = now();
            if (result.error !== undefined)
                task.error = result.error;
            try {
                await writeMetadata({ ...snapshot(task), status: result.status });
                task.status = result.status;
            }
            catch (error) {
                task.status = 'failed';
                task.error = `Terminal metadata write failed: ${boundedError(error)}`;
                logger.error(`[background-tasks] failed to write survivor metadata for ${task.id}:`, error);
                await writeMetadata().catch(() => undefined);
            }
            task.finalized = true;
            if (task.timeoutHandle !== undefined)
                clearTimeout(task.timeoutHandle);
            delete task.timeoutHandle;
            for (const waiter of task.waiters.splice(0))
                waiter();
            execution.phase = 'terminal';
            resolveTerminal(task);
            changed();
            sink?.onTerminal(execution);
        })().catch((error) => {
            logger.error(`[background-tasks] reload shell finalization failed for ${task.id}:`, error);
        });
    };
    let stdoutListener = () => { };
    let stderrListener = () => { };
    let childErrorListener = () => { };
    let childCloseListener = () => { };
    let streamErrorListener = () => { };
    const execution = {
        protocol: RELOAD_SHELL_OWNER_PROTOCOL,
        launchNonce: options.launchNonce,
        completionId: `${task.id}:1`,
        task,
        child,
        outputStream,
        spawnedAt,
        timeoutDeadlineAt,
        outputCapBytes: options.maxOutputBytes,
        terminal,
        phase: 'starting',
        admissionCommitted: false,
        notificationState: task.notifyOnCompletion ? 'pending' : 'disabled',
        async requestStop(kind, reason) {
            if (execution.phase === 'released')
                return task;
            if (execution.phase === 'terminal')
                return task;
            const firstStop = stopKind === undefined;
            if (firstStop) {
                stopKind = kind;
                task.killKind = kind === 'handoff_expired' ? 'shutdown' : kind;
                if (reason !== undefined)
                    task.error = reason;
            }
            if (firstStop && kind === 'handoff_expired' && !task.error?.startsWith('pi_bg_reload_handoff_expired')) {
                task.error = `pi_bg_reload_handoff_expired: ${task.error ?? 'reload handoff expired'}`;
            }
            if (execution.phase === 'finalizing')
                return terminal;
            if (execution.phase === 'running' || execution.phase === 'starting') {
                execution.phase = 'stop_requested';
            }
            if (task.status === 'running') {
                if (platform === 'win32')
                    requestWindowsStop();
                else
                    requestPosixStop();
            }
            let timeout;
            try {
                return await Promise.race([
                    terminal,
                    new Promise((_resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error(`Task ${task.id} did not exit within ${String(options.stopWaitMs)}ms after cancellation`)), options.stopWaitMs);
                    }),
                ]);
            }
            finally {
                if (timeout !== undefined)
                    clearTimeout(timeout);
            }
        },
        async commitInitialMetadata(signal) {
            try {
                await writeMetadata(snapshot(task), signal);
                if (!initialMetadataSettled) {
                    initialMetadataSettled = true;
                    resolveInitialMetadata();
                }
            }
            catch (error) {
                if (!initialMetadataSettled) {
                    initialMetadataSettled = true;
                    rejectInitialMetadata(error);
                }
                throw error;
            }
        },
        failAdmission(error) {
            if (!initialMetadataSettled) {
                initialMetadataSettled = true;
                rejectInitialMetadata(error);
            }
        },
        setOwnerEventSink(next) {
            sink = next;
        },
        markAdmissionCommitted(generation, handoffCount) {
            execution.admissionCommitted = true;
            execution.phase = execution.phase === 'starting' ? 'running' : execution.phase;
            audit.leaseGeneration = generation;
            audit.handoffCount = handoffCount;
        },
        updateLeaseAudit(generation, handoffCount) {
            audit.leaseGeneration = generation;
            audit.handoffCount = handoffCount;
        },
        abandonReloadHandoff() {
            if (task.terminalPublicationState === 'pending') {
                task.terminalPublicationState = 'abandoned';
                task.terminalPublicationAbandonReason = 'reload_handoff_expired';
                task.terminalPublished = false;
            }
            if (task.status === 'running') {
                task.error = appendError(task.error, 'pi_bg_reload_handoff_expired: no compatible reload activation claimed this execution');
            }
            void writeMetadata().catch((error) => {
                logger.error(`[background-tasks] failed to persist handoff expiry for ${task.id}:`, error);
            });
        },
        beginNotification(lease) {
            if (execution.notificationState !== 'pending')
                return undefined;
            const token = `${String(lease.generation)}:${lease.activationNonce}:${randomNonce()}`;
            notificationToken = token;
            execution.notificationState = 'sending';
            return token;
        },
        finishNotification(token, delivered) {
            if (notificationToken !== token || execution.notificationState !== 'sending')
                return;
            notificationToken = undefined;
            if (delivered) {
                execution.notificationState = 'delivered';
                task.notified = true;
            }
            else {
                execution.notificationState = 'pending';
                task.notified = false;
            }
        },
        releaseResources() {
            if (task.timeoutHandle !== undefined)
                clearTimeout(task.timeoutHandle);
            if (task.killEscalationTimer !== undefined)
                clearTimeout(task.killEscalationTimer);
            if (posixTree?.verificationTimer !== undefined)
                clearTimeout(posixTree.verificationTimer);
            windowsTree?.softController?.abort();
            execution.child?.stdout?.off?.('data', stdoutListener);
            execution.child?.stderr?.off?.('data', stderrListener);
            execution.child?.off?.('error', childErrorListener);
            execution.child?.off?.('close', childCloseListener);
            execution.outputStream?.off('error', streamErrorListener);
            sink = undefined;
            execution.child = undefined;
            execution.outputStream = undefined;
            delete task.child;
            delete task.stream;
            delete task.timeoutHandle;
            delete task.killEscalationTimer;
            delete task.reloadExecution;
            execution.phase = 'released';
        },
    };
    task.reloadExecution = execution;
    streamErrorListener = (error) => {
        task.error = `Output file write failed: ${error.message}`;
        changed();
        if (task.status === 'running') {
            void execution.requestStop('output_cap', task.error).catch((stopError) => {
                logger.error(`[background-tasks] failed to stop survivor after stream error ${task.id}:`, stopError);
            });
        }
    };
    stdoutListener = (data) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        ingestTelemetry(buffer.toString('utf8'));
        writeBuffer(buffer);
    };
    stderrListener = (data) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        ingestTelemetry(buffer.toString('utf8'));
        writeBuffer(buffer);
    };
    childErrorListener = (error) => {
        task.error = appendError(task.error, `Background task spawn error: ${error.message}`);
        writeBuffer(Buffer.from(`\n[background task spawn error: ${error.message}]\n`, 'utf8'));
        changed();
    };
    childCloseListener = (code, signal) => {
        if (execution.closeObservation !== undefined)
            return;
        finalize(code, signal);
    };
    outputStream.on('error', streamErrorListener);
    child.stdout?.on('data', stdoutListener);
    child.stderr?.on('data', stderrListener);
    child.on('error', childErrorListener);
    child.on('close', childCloseListener);
    if (timeoutDeadlineAt !== undefined) {
        task.timeoutHandle = setTimeout(() => {
            if (task.status !== 'running' || execution.phase === 'terminal' || execution.phase === 'released')
                return;
            const message = `Timed out after ${String(task.timeoutSeconds)}s`;
            writeBuffer(Buffer.from(`\n[background task timeout: ${message}]\n`, 'utf8'));
            void execution.requestStop('timeout', message).catch((error) => {
                logger.error(`[background-tasks] survivor timeout stop failed for ${task.id}:`, error);
            });
        }, Math.max(0, timeoutDeadlineAt - now()));
    }
    return execution;
}
//# sourceMappingURL=reload-shell-owner.js.map