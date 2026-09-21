import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isJsonObject, parseJsonText } from './common.js';
import { canonicalJson, sha256Buffer } from './canonical-json.js';
import { ATTESTED_GIT_KILL_GRACE_MS, ATTESTED_GIT_MAX_OUTPUT_BYTES, ATTESTED_GIT_TIMEOUT_MS, } from './attested-pi-contract.js';
export { canonicalJson, sha256Buffer } from './canonical-json.js';
export { ATTESTED_GIT_KILL_GRACE_MS, ATTESTED_GIT_MAX_OUTPUT_BYTES, ATTESTED_GIT_TIMEOUT_MS, ATTESTED_TASK_ID_PATTERN, } from './attested-pi-contract.js';
export { closeAndFsyncOutputStream, writeFileFsynced, writeJsonAtomic } from './task-durable.js';
import { runWindowsTaskkill, } from './windows-taskkill.js';
import { assertWindowsCommandLineWithinLimit, piLaunchArgv, resolvePiLaunch, } from './pi-launch.js';
export const PI_TASK_ATTESTATION_SCHEMA_VERSION = 'phase2.pi_task_attestation.v1';
export class AttestedGitCommandError extends Error {
    code = 'attested_git_failed';
    constructor(message) {
        super(message);
        this.name = 'AttestedGitCommandError';
    }
}
export class AttestedGitTimeoutError extends Error {
    code = 'attested_git_timeout';
    constructor(args) {
        super(`git ${args.join(' ')} timed out during attested Pi preflight`);
        this.name = 'AttestedGitTimeoutError';
    }
}
export class AttestedGitOutputLimitError extends Error {
    code = 'attested_git_output_limit';
    constructor(args, maxBytes) {
        super(`git ${args.join(' ')} output exceeded the explicit ${String(maxBytes)} bytes per-stream limit`);
        this.name = 'AttestedGitOutputLimitError';
    }
}
class AttestedGitCleanupError extends Error {
    code = 'attested_git_cleanup_failed';
    primaryError;
    cleanupErrors;
    constructor(primaryError, cleanupErrors) {
        super(`${primaryError.message}; Git process-tree cleanup failed: ${cleanupErrors.join('; ')}`);
        this.name = 'AttestedGitCleanupError';
        this.primaryError = primaryError;
        this.cleanupErrors = [...cleanupErrors];
    }
}
export function makeAttestedTaskId() {
    return `b${randomBytes(16).toString('hex')}`;
}
export function validateStructuredPiLaunchRequest(input) {
    if (!input.name.trim())
        throw new Error('Attested Pi task requires a concise name');
    if (!input.provider.trim())
        throw new Error('Attested Pi task requires provider');
    if (!input.model.trim())
        throw new Error('Attested Pi task requires model');
    if (!input.prompt)
        throw new Error('Attested Pi task requires prompt text');
    if (!input.reportPath.trim())
        throw new Error('Attested Pi task requires a report path');
    const args = input.extraPiArgs ?? [];
    for (const arg of args) {
        if (arg === '--api-key' || arg.startsWith('--api-key=')) {
            throw new Error('Attested Pi tasks forbid direct --api-key launch arguments');
        }
        if (arg === '--auth-file' || arg.startsWith('--auth-file=')) {
            throw new Error('Attested Pi tasks forbid alternate auth-file launch arguments');
        }
        if (arg === '-p' || arg === '--print' || arg === '--mode' || arg.startsWith('--mode=')) {
            throw new Error('Attested Pi tasks own print/json mode arguments');
        }
        if (arg === '--provider' ||
            arg.startsWith('--provider=') ||
            arg === '--model' ||
            arg.startsWith('--model=')) {
            throw new Error('Use structured provider/model fields, not duplicate Pi args');
        }
        if (arg === '--thinking' || arg.startsWith('--thinking=')) {
            throw new Error('Use the structured thinking field, not duplicate Pi args');
        }
    }
}
const ATTESTED_PI_REMOVED_ENV_KEYS = [
    'OPENROUTER_API_KEY',
    'OPENROUTER_BASE_URL',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'PI_API_KEY',
    'PI_API_BASE_URL',
    'PI_AUTH_FILE',
];
export function attestedPiChildEnv(env) {
    const out = { ...env };
    for (const key of ATTESTED_PI_REMOVED_ENV_KEYS)
        Reflect.deleteProperty(out, key);
    return out;
}
export function buildAttestedPiArgv(input, attributionExtensionPath) {
    validateStructuredPiLaunchRequest(input);
    const args = ['pi', '--mode', 'json', '--provider', input.provider, '--model', input.model];
    if (input.provider === 'anthropic') {
        if (!attributionExtensionPath?.trim()) {
            throw new Error('Anthropic attested Pi tasks require the package attribution extension');
        }
        args.push('--extension', attributionExtensionPath);
    }
    if (input.thinking?.trim())
        args.push('--thinking', input.thinking.trim());
    args.push(...(input.extraPiArgs ?? []), input.prompt);
    return args;
}
export async function resolveReportPath(cwd, reportPath) {
    if (isAbsolute(reportPath))
        throw new Error('Attested Pi report path must be relative to task cwd');
    const resolved = resolve(cwd, reportPath);
    const relativePath = relative(cwd, resolved);
    if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Attested Pi report path must stay inside task cwd');
    }
    const parts = relativePath.split(sep);
    if (parts[0] === '.git' || (parts[0] === '.pi' && parts[1] === 'tasks')) {
        throw new Error('Attested Pi report path cannot target Git metadata or the fixed task store');
    }
    return resolved;
}
function positiveInteger(value, fallback, label) {
    const candidate = value ?? fallback;
    if (!Number.isFinite(candidate) || candidate <= 0) {
        throw new Error(`${label} must be a positive finite number`);
    }
    return Math.max(1, Math.floor(candidate));
}
function errorCode(error) {
    if (typeof error !== 'object' || error === null)
        return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function signalError(signal) {
    return signal.reason instanceof Error
        ? signal.reason
        : new Error(`Attested Git preflight cancelled${signal.reason === undefined ? '' : `: ${String(signal.reason)}`}`);
}
function gitDeadline(options) {
    const configured = options.deadlineAt;
    return typeof configured === 'number' && Number.isFinite(configured)
        ? configured
        : Date.now() + ATTESTED_GIT_TIMEOUT_MS;
}
function assertGitBoundary(options, args) {
    if (options.signal?.aborted === true)
        throw signalError(options.signal);
    if (Date.now() >= gitDeadline(options))
        throw new AttestedGitTimeoutError(args);
}
class BoundedGitCapture {
    maxBytes;
    chunks = [];
    bytes = 0;
    exceeded = false;
    constructor(maxBytes) {
        this.maxBytes = maxBytes;
    }
    append(data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        const remaining = this.maxBytes - this.bytes;
        if (remaining > 0) {
            const kept = buffer.length <= remaining ? buffer : buffer.subarray(0, remaining);
            this.chunks.push(kept);
            this.bytes += kept.length;
        }
        if (buffer.length > Math.max(0, remaining))
            this.exceeded = true;
        return this.exceeded;
    }
    text() {
        return Buffer.concat(this.chunks, this.bytes).toString('utf8');
    }
    diagnostic() {
        const text = this.text().trim();
        return this.exceeded
            ? `${text}${text.length > 0 ? ' ' : ''}[output exceeded ${String(this.maxBytes)} bytes]`
            : text;
    }
}
function delay(ms) {
    return new Promise((resolvePromise) => {
        setTimeout(resolvePromise, ms);
    });
}
function posixTreeSignal(child, pid, signal, killProcess) {
    const errors = [];
    if (pid !== undefined) {
        try {
            if (killProcess(-pid, signal))
                return errors;
            errors.push(`process group ${signal} returned false`);
        }
        catch (error) {
            if (errorCode(error) === 'ESRCH')
                return [];
            errors.push(`process group ${signal} failed: ${errorMessage(error)}`);
        }
    }
    try {
        if (child.kill(signal))
            return errors;
        errors.push(`child ${signal} returned false`);
    }
    catch (error) {
        if (errorCode(error) === 'ESRCH')
            return errors;
        errors.push(`child ${signal} failed: ${errorMessage(error)}`);
    }
    return errors;
}
function windowsTaskkillSucceeded(outcome) {
    return outcome.exitCode === 0 || outcome.exitCode === 128;
}
function describeTaskkill(phase, outcome) {
    const stderr = outcome.stderr.trim();
    const stdout = outcome.stdout.trim();
    const detail = stderr || stdout;
    const truncated = outcome.stderrTruncated || outcome.stdoutTruncated ? ' (output truncated)' : '';
    return `taskkill ${phase} exited ${String(outcome.exitCode)}${detail ? `: ${detail}` : ''}${truncated}`;
}
async function terminateGitProcessTree(child, options, killGraceMs, isClosed) {
    const pid = child.pid;
    if (options.platform !== 'win32') {
        const errors = posixTreeSignal(child, pid, 'SIGTERM', options.killProcess);
        // Keep the grace timer referenced and always probe/force the process group
        // once. The direct Git process can exit before a descendant that ignored
        // TERM; forcing the detached group closes that tree-shaped race.
        await delay(killGraceMs);
        errors.push(...posixTreeSignal(child, pid, 'SIGKILL', options.killProcess));
        return errors;
    }
    if (pid === undefined)
        return ['Git process has no pid for Windows tree termination'];
    const softController = new AbortController();
    let softOutcome;
    let softError;
    let softSettled = false;
    const soft = Promise.resolve()
        .then(() => options.killTree(pid, 'terminate', softController.signal))
        .then((outcome) => {
        softOutcome = outcome;
        softSettled = true;
    }, (error) => {
        softError = error;
        softSettled = true;
    });
    await delay(killGraceMs);
    const softSucceeded = softOutcome !== undefined && windowsTaskkillSucceeded(softOutcome);
    const needsForce = !softSettled || !softSucceeded || !isClosed();
    if (!softSettled)
        softController.abort();
    await soft;
    const errors = [];
    if (softError !== undefined)
        errors.push(`taskkill terminate failed: ${errorMessage(softError)}`);
    else if (softOutcome !== undefined && !windowsTaskkillSucceeded(softOutcome))
        errors.push(describeTaskkill('terminate', softOutcome));
    if (!needsForce)
        return errors;
    try {
        const forceOutcome = await options.killTree(pid, 'force');
        if (!windowsTaskkillSucceeded(forceOutcome))
            errors.push(describeTaskkill('force', forceOutcome));
    }
    catch (error) {
        errors.push(`taskkill force failed: ${errorMessage(error)}`);
    }
    return errors;
}
function defaultGitSpawn(command, args, options) {
    return nodeSpawn(command, args, options);
}
export async function runGitCommand(cwd, args, options = {}) {
    const deadlineAt = gitDeadline(options);
    const boundedOptions = { ...options, deadlineAt };
    assertGitBoundary(boundedOptions, args);
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const spawn = options.spawn ?? defaultGitSpawn;
    const killProcess = options.killProcess ?? process.kill.bind(process);
    const killTree = options.killTree ??
        ((pid, phase, signal) => {
            const taskkillOptions = signal === undefined ? { env } : { env, signal };
            return runWindowsTaskkill(pid, phase, taskkillOptions);
        });
    const killGraceMs = positiveInteger(options.killGraceMs, ATTESTED_GIT_KILL_GRACE_MS, 'killGraceMs');
    const maxOutputBytes = positiveInteger(options.maxOutputBytes, ATTESTED_GIT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
    let child;
    try {
        child = spawn('git', args, {
            cwd,
            detached: platform !== 'win32',
            env,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    }
    catch (error) {
        throw new AttestedGitCommandError(`git ${args.join(' ')} failed to spawn: ${errorMessage(error)}`);
    }
    const admissionSignal = options.signal;
    const stdout = new BoundedGitCapture(maxOutputBytes);
    const stderr = new BoundedGitCapture(maxOutputBytes);
    let closed = false;
    let closeRecord;
    let resolveClose;
    const closePromise = new Promise((resolvePromise) => {
        resolveClose = resolvePromise;
    });
    let primaryError;
    let processError;
    let termination;
    let deadlineTimer;
    const requestTermination = (error) => {
        if (closed)
            return;
        primaryError ??= error;
        termination ??= terminateGitProcessTree(child, { platform, killProcess, killTree }, killGraceMs, () => closed);
    };
    const stdoutListener = (data) => {
        if (stdout.append(data))
            requestTermination(new AttestedGitOutputLimitError(args, maxOutputBytes));
    };
    const stderrListener = (data) => {
        if (stderr.append(data))
            requestTermination(new AttestedGitOutputLimitError(args, maxOutputBytes));
    };
    const errorListener = (error) => {
        processError = error;
        const wrapped = new AttestedGitCommandError(`git ${args.join(' ')} process error: ${error.message}`);
        if (child.pid === undefined) {
            primaryError ??= wrapped;
            closed = true;
            closeRecord = { code: null, signal: null };
            resolveClose?.();
            return;
        }
        requestTermination(wrapped);
    };
    const closeListener = (code, signal) => {
        if (closed)
            return;
        closed = true;
        closeRecord = { code, signal };
        if (deadlineTimer !== undefined) {
            clearTimeout(deadlineTimer);
            deadlineTimer = undefined;
        }
        resolveClose?.();
    };
    const abortListener = () => {
        if (admissionSignal !== undefined)
            requestTermination(signalError(admissionSignal));
    };
    child.stdout?.on('data', stdoutListener);
    child.stderr?.on('data', stderrListener);
    child.on('error', errorListener);
    child.on('close', closeListener);
    admissionSignal?.addEventListener('abort', abortListener, { once: true });
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    deadlineTimer = setTimeout(() => {
        requestTermination(new AttestedGitTimeoutError(args));
    }, remainingMs);
    if (admissionSignal?.aborted === true)
        abortListener();
    try {
        await closePromise;
        const cleanupErrors = termination === undefined ? [] : await termination;
        if (primaryError !== undefined) {
            if (cleanupErrors.length > 0)
                throw new AttestedGitCleanupError(primaryError, cleanupErrors);
            throw primaryError;
        }
        if (processError !== undefined) {
            throw new AttestedGitCommandError(`git ${args.join(' ')} process error: ${processError.message}`);
        }
        const close = closeRecord;
        if (close?.code === 0)
            return stdout.text().trim();
        const exit = close?.code === null || close === undefined ? 'null' : String(close.code);
        const signal = close?.signal ? ` (${close.signal})` : '';
        throw new AttestedGitCommandError(`git ${args.join(' ')} failed with exit ${exit}${signal}: ${stderr.diagnostic()}`);
    }
    finally {
        if (deadlineTimer !== undefined)
            clearTimeout(deadlineTimer);
        admissionSignal?.removeEventListener('abort', abortListener);
        child.stdout?.off('data', stdoutListener);
        child.stderr?.off('data', stderrListener);
        child.off('error', errorListener);
        child.off('close', closeListener);
    }
}
function withDefaultGitDeadline(options) {
    return options.deadlineAt === undefined
        ? { ...options, deadlineAt: Date.now() + ATTESTED_GIT_TIMEOUT_MS }
        : options;
}
export async function gitAuthoritySnapshot(cwd, options = {}) {
    const bounded = withDefaultGitDeadline(options);
    const commit = await runGitCommand(cwd, ['rev-parse', 'HEAD'], bounded);
    const tree = await runGitCommand(cwd, ['rev-parse', 'HEAD^{tree}'], bounded);
    const status = await runGitCommand(cwd, ['status', '--porcelain=v1', '--untracked-files=all'], bounded);
    return { commit, tree, clean: status.length === 0 };
}
export async function gitRepoRoot(cwd, options = {}) {
    const bounded = withDefaultGitDeadline(options);
    const root = await runGitCommand(cwd, ['rev-parse', '--show-toplevel'], bounded);
    assertGitBoundary(bounded, ['rev-parse', '--show-toplevel']);
    const resolved = await realpath(root);
    assertGitBoundary(bounded, ['rev-parse', '--show-toplevel']);
    return resolved;
}
export function observePiOAuth(ctx, provider, modelId) {
    const registry = ctx.modelRegistry;
    const selected = registry.find?.(provider, modelId);
    if (!selected)
        throw new Error(`Pi model not found in ModelRegistry: ${provider}/${modelId}`);
    if (!registry.isUsingOAuth)
        throw new Error('ModelRegistry OAuth observation is unavailable');
    if (!registry.isUsingOAuth(selected)) {
        throw new Error(`Attested Pi task requires OAuth credentials for ${provider}/${modelId}`);
    }
    const channel = provider === 'openai-codex'
        ? 'subscription-codex'
        : provider === 'anthropic'
            ? 'subscription-anthropic'
            : undefined;
    const authClass = provider === 'openai-codex'
        ? 'pi-codex-oauth'
        : provider === 'anthropic'
            ? 'pi-anthropic-oauth'
            : undefined;
    if (!channel || !authClass)
        throw new Error(`Unsupported attested Pi OAuth provider: ${provider}`);
    return {
        apiIdentity: selected.api,
        authClass,
        credentialKind: 'oauth',
        routeClass: 'subscription-agent',
        channel,
        directApiKey: false,
        selectedModel: selected,
    };
}
function readString(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}
function readNumber(record, key) {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
function normalizeUsage(value) {
    if (!isJsonObject(value))
        return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    const input = nonNegativeInteger(value['input']);
    const output = nonNegativeInteger(value['output']);
    const cacheRead = nonNegativeInteger(value['cacheRead']);
    const cacheWrite = nonNegativeInteger(value['cacheWrite']);
    const totalTokens = nonNegativeInteger(value['totalTokens']) || input + output + cacheRead + cacheWrite;
    const cost = isJsonObject(value['cost']) ? readNumber(value['cost'], 'total') : undefined;
    const usage = { input, output, cacheRead, cacheWrite, totalTokens };
    if (cost !== undefined && cost >= 0)
        usage.costTotal = cost;
    return usage;
}
function appendUsage(target, delta) {
    target.input += delta.input;
    target.output += delta.output;
    target.cacheRead += delta.cacheRead;
    target.cacheWrite += delta.cacheWrite;
    target.totalTokens += delta.totalTokens;
    if (delta.costTotal !== undefined)
        target.costTotal = (target.costTotal ?? 0) + delta.costTotal;
}
function textFromAssistantMessage(message) {
    const content = message['content'];
    if (!Array.isArray(content))
        return [];
    return content.flatMap((part) => {
        if (!isJsonObject(part))
            return [];
        if (part['type'] === 'text' && typeof part['text'] === 'string')
            return [part['text']];
        return [];
    });
}
function countToolCalls(message, tools) {
    const content = message['content'];
    if (!Array.isArray(content))
        return;
    for (const part of content) {
        if (!isJsonObject(part) || part['type'] !== 'toolCall')
            continue;
        const name = typeof part['name'] === 'string' && part['name'] ? part['name'] : 'tool';
        tools.total += 1;
        tools.byName[name] = (tools.byName[name] ?? 0) + 1;
    }
}
export function parsePiJsonEvents(raw) {
    const text = raw.toString('utf8');
    if (!text.endsWith('\n'))
        throw new Error('Pi JSON event stream is not newline-terminated');
    let sessionId;
    let sessionCwd;
    let sessionCount = 0;
    let agentStartCount = 0;
    let agentEndCount = 0;
    let provider;
    let model;
    let finalStopReason;
    let assistantCount = 0;
    const usage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
    };
    const tools = { total: 0, failed: 0, byName: {} };
    const transcript = [];
    for (const line of text.split('\n')) {
        if (!line)
            continue;
        const parsed = parseJsonText(line);
        if (!isJsonObject(parsed))
            throw new Error('Pi JSON event line is not an object');
        const eventType = parsed['type'];
        if (eventType === 'session') {
            sessionCount += 1;
            sessionId = readString(parsed, 'id');
            sessionCwd = readString(parsed, 'cwd');
            continue;
        }
        if (eventType === 'agent_start')
            agentStartCount += 1;
        if (eventType === 'agent_end')
            agentEndCount += 1;
        if (eventType === 'tool_execution_start') {
            const name = readString(parsed, 'toolName') ?? readString(parsed, 'tool_name') ?? 'tool';
            tools.total += 1;
            tools.byName[name] = (tools.byName[name] ?? 0) + 1;
            transcript.push(`→ ${name}`);
            continue;
        }
        if (eventType === 'tool_execution_end') {
            if (parsed['isError'] === true) {
                tools.failed += 1;
                const name = readString(parsed, 'toolName') ?? readString(parsed, 'tool_name') ?? 'tool';
                transcript.push(`✗ ${name} failed`);
            }
            continue;
        }
        if (eventType !== 'message_end' || !isJsonObject(parsed['message']))
            continue;
        const message = parsed['message'];
        if (message['role'] !== 'assistant')
            continue;
        assistantCount += 1;
        const messageProvider = readString(message, 'provider');
        const messageModel = readString(message, 'model');
        if (!messageProvider || !messageModel) {
            throw new Error('Assistant message lacks provider/model in Pi JSON events');
        }
        if (provider !== undefined && provider !== messageProvider)
            throw new Error('Pi assistant provider changed during task');
        if (model !== undefined && model !== messageModel)
            throw new Error('Pi assistant model changed during task');
        provider = messageProvider;
        model = messageModel;
        appendUsage(usage, normalizeUsage(message['usage']));
        countToolCalls(message, tools);
        transcript.push(...textFromAssistantMessage(message));
        if (message['error'] !== undefined && message['error'] !== null)
            throw new Error('Assistant message reported an error');
        const stopReason = readString(message, 'stopReason');
        if (stopReason)
            finalStopReason = stopReason;
    }
    if (sessionCount !== 1 || !sessionId || !sessionCwd)
        throw new Error('Pi JSON events must contain exactly one session header');
    if (agentStartCount !== 1)
        throw new Error('Pi JSON events must contain exactly one agent_start');
    if (agentEndCount !== 1)
        throw new Error('Pi JSON events must contain exactly one agent_end');
    if (assistantCount < 1 || !provider || !model)
        throw new Error('Pi JSON events contain no assistant message');
    if (finalStopReason !== 'stop')
        throw new Error(`Pi final stop reason is not stop: ${finalStopReason ?? 'missing'}`);
    return {
        piSessionId: sessionId,
        piCwd: sessionCwd,
        provider,
        model,
        providerScopedModelId: `${provider}/${model}`,
        finalStopReason,
        tokenUsage: usage,
        assistantCount,
        toolUsage: tools,
        humanTranscript: transcript.filter((line) => line.trim()).join('\n') + '\n',
    };
}
export async function sha256File(path) {
    const bytes = await readFile(path);
    return { byteLength: bytes.length, sha256: sha256Buffer(bytes) };
}
export function spawnAndCapturePi(spawnImpl, argv, options, platform = process.platform, launchOverride) {
    const stdoutChunks = [];
    const stderrChunks = [];
    const logicalExecutable = argv[0];
    if (logicalExecutable !== 'pi')
        throw new Error('Attested Pi argv must start with pi');
    const piArgs = argv.slice(1);
    const launch = launchOverride ?? resolvePiLaunch({ platform });
    assertWindowsCommandLineWithinLimit(launch, piArgs, platform, 'attested-pi-run');
    const child = spawnImpl(launch.executable, piLaunchArgv(launch, piArgs), options);
    child.stdout?.on('data', (chunk) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
    });
    child.stderr?.on('data', (chunk) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
    });
    return { child, stdoutChunks, stderrChunks };
}
export async function buildPiTaskAttestation(input) {
    if (input.startAuthority.commit !== input.finishAuthority.commit ||
        input.startAuthority.tree !== input.finishAuthority.tree) {
        throw new Error('Git authority changed during attested Pi task');
    }
    if (!input.startAuthority.clean || !input.finishAuthority.clean) {
        throw new Error('Git worktree must be clean at attested Pi task start and finish');
    }
    if (input.parsedEvents.provider !== input.auth.selectedModel.provider ||
        input.parsedEvents.model !== input.auth.selectedModel.id) {
        throw new Error('Observed Pi provider/model do not match selected ModelRegistry model');
    }
    const metadata = await sha256File(input.paths.metadataAbsPath);
    const output = await sha256File(input.paths.outputAbsPath);
    const events = await sha256File(input.paths.eventsAbsPath);
    const stderr = await sha256File(input.paths.stderrAbsPath);
    const wrapper = await sha256File(input.paths.wrapperAbsPath);
    const report = await sha256File(input.reportAbsPath);
    const promptHash = sha256Buffer(input.prompt);
    const attestation = {
        schema_version: PI_TASK_ATTESTATION_SCHEMA_VERSION,
        locator: {
            session_dir: input.sessionDir,
            task_id: input.task.id,
            metadata_ref: input.paths.metadataPath,
            output_ref: input.paths.outputPath,
            events_ref: input.paths.eventsPath,
            stderr_ref: input.paths.stderrPath,
            wrapper_ref: input.paths.wrapperPath,
        },
        source_hashes: {
            metadata_sha256: metadata.sha256,
            output_sha256: output.sha256,
            events_sha256: events.sha256,
            stderr_sha256: stderr.sha256,
            wrapper_sha256: wrapper.sha256,
        },
        lifecycle: {
            status: input.task.status,
            is_agent: input.task.isAgent,
            start_time_ms: input.task.startTime,
            end_time_ms: input.task.endTime ?? input.task.startTime,
            exit_code: input.task.exitCode ?? null,
            signal: input.task.signal ?? null,
            bytes_written: input.task.bytesWritten,
        },
        invocation: {
            pi_session_id: input.parsedEvents.piSessionId,
            argv: input.argv,
            cwd_realpath: input.cwdRealpath,
            provider: input.parsedEvents.provider,
            model_id: input.parsedEvents.model,
            provider_scoped_model_id: input.parsedEvents.providerScopedModelId,
            api_identity: input.auth.apiIdentity,
            auth_class: input.auth.authClass,
            credential_kind: input.auth.credentialKind,
            route_class: input.auth.routeClass,
            channel: input.auth.channel,
            direct_api_key: input.auth.directApiKey,
            final_stop_reason: input.parsedEvents.finalStopReason,
        },
        authority: {
            repo_root_realpath: input.repoRootRealpath,
            start_commit_oid: input.startAuthority.commit,
            start_tree_oid: input.startAuthority.tree,
            finish_commit_oid: input.finishAuthority.commit,
            finish_tree_oid: input.finishAuthority.tree,
            start_worktree_clean: input.startAuthority.clean,
            finish_worktree_clean: input.finishAuthority.clean,
        },
        artifacts: {
            prompt: { byte_length: input.prompt.length, sha256: promptHash },
            task_output: { byte_length: output.byteLength, sha256: output.sha256 },
            stderr: { byte_length: stderr.byteLength, sha256: stderr.sha256 },
            transcript: { byte_length: events.byteLength, sha256: events.sha256 },
            report: { byte_length: report.byteLength, sha256: report.sha256 },
        },
        attestation_sha256: '',
    };
    const withoutSelf = { ...attestation, attestation_sha256: undefined };
    Reflect.deleteProperty(withoutSelf, 'attestation_sha256');
    attestation['attestation_sha256'] = sha256Buffer(Buffer.from(canonicalJson(withoutSelf), 'utf8'));
    return attestation;
}
export function makeAttestedTaskPaths(runtimeAbs, runtimeDisplay, id) {
    return {
        outputAbsPath: join(runtimeAbs, `${id}.output`),
        metadataAbsPath: join(runtimeAbs, `${id}.json`),
        eventsAbsPath: join(runtimeAbs, `${id}.pi-events.jsonl`),
        stderrAbsPath: join(runtimeAbs, `${id}.stderr`),
        wrapperAbsPath: join(runtimeAbs, `${id}.pi-telemetry-wrapper.cjs`),
        attestationAbsPath: join(runtimeAbs, `${id}.attestation.json`),
        outputPath: join(runtimeDisplay, `${id}.output`),
        metadataPath: join(runtimeDisplay, `${id}.json`),
        eventsPath: join(runtimeDisplay, `${id}.pi-events.jsonl`),
        stderrPath: join(runtimeDisplay, `${id}.stderr`),
        wrapperPath: join(runtimeDisplay, `${id}.pi-telemetry-wrapper.cjs`),
        attestationPath: join(runtimeDisplay, `${id}.attestation.json`),
    };
}
export function pathInside(parent, child) {
    const rel = relative(parent, child);
    return (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..')));
}
export async function assertRegularReadable(path) {
    const stats = await stat(path);
    if (!stats.isFile())
        throw new Error(`Expected regular file: ${path}`);
}
//# sourceMappingURL=attested-pi-run.js.map