import { accessSync, constants, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, delimiter, extname, isAbsolute, join, resolve, win32 } from 'node:path';
import { DEFAULT_MAX_BYTES } from '@earendil-works/pi-coding-agent';
export const TASK_STATUS_VALUES = ['running', 'completed', 'failed', 'killed'];
export const TERMINAL_TASK_STATUS_VALUES = ['completed', 'failed', 'killed'];
export class ReloadSurvivalError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = 'ReloadSurvivalError';
    }
}
export function rejectSurvivalForTaskKind(value, kind) {
    if (!Object.prototype.hasOwnProperty.call(value, 'surviveReload'))
        return;
    throw new ReloadSurvivalError('pi_bg_survive_reload_unsupported_task_kind', `${kind} does not support surviveReload; only ordinary isAgent:false shell tasks may survive reload`);
}
/**
 * Describe the actual parent-agent completion path for one bg_run launch.
 * A wake request cannot take effect without the notification that carries it.
 */
export function deriveCompletionDeliveryGuidance(notifyOnCompletion, triggerOnCompletion) {
    if (notifyOnCompletion && triggerOnCompletion) {
        return {
            mode: 'notification-and-wake',
            notificationEnabled: true,
            automaticWakeEnabled: true,
            text: [
                'Terminal notification: enabled.',
                'Automatic follow-up turn: enabled.',
                'Next action: do not poll or sleep merely to wait; continue only independent useful work, otherwise end this turn and wait for <background-task-notification>.',
            ].join('\n'),
        };
    }
    if (notifyOnCompletion) {
        return {
            mode: 'notification-only',
            notificationEnabled: true,
            automaticWakeEnabled: false,
            text: [
                'Terminal notification: enabled.',
                'Automatic follow-up turn: disabled. The terminal notification will be delivered, but it will not start an agent turn.',
                'Next action: automatic wake-up was explicitly disabled; use bg_status/bg_logs only when deliberate monitoring is required, without tight polling.',
            ].join('\n'),
        };
    }
    return {
        mode: 'manual-monitoring',
        notificationEnabled: false,
        automaticWakeEnabled: false,
        text: [
            'Terminal notification: disabled.',
            triggerOnCompletion
                ? 'Automatic follow-up turn: disabled because terminal notifications are disabled. triggerOnCompletion has no effect while notifyOnCompletion is false.'
                : 'Automatic follow-up turn: disabled.',
            'Next action: completion delivery was explicitly disabled; use bg_status/bg_logs only for deliberate manual monitoring, without tight polling.',
        ].join('\n'),
    };
}
export const DEFAULT_LOG_BYTES = Math.min(DEFAULT_MAX_BYTES, 50 * 1024);
export const MAX_LOG_BYTES = Math.min(DEFAULT_MAX_BYTES, 50 * 1024);
export const COMMAND_PREVIEW_CHARS = 90;
const parseJsonValue = globalThis.JSON.parse;
export function isJsonObject(value) {
    return typeof value === 'object' && value !== null;
}
export function parseJsonText(text) {
    return parseJsonValue(text);
}
export function sanitizePathSegment(value) {
    const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
    return sanitized || 'session';
}
export function stripMatchingQuotes(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed;
}
export function compactWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
export function truncateChars(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
export function normalizeTaskName(value) {
    if (typeof value !== 'string')
        return undefined;
    const normalized = compactWhitespace(stripMatchingQuotes(value));
    if (!normalized)
        return undefined;
    return truncateChars(normalized, 80);
}
export function deriveTaskNameFromCommand(command) {
    const normalized = compactWhitespace(stripMatchingQuotes(command));
    if (!normalized)
        return 'Background task';
    const packageScript = /^(npm|pnpm|yarn|bun)\s+(?:(run)\s+)?([^\s;&|]+)/.exec(normalized);
    if (packageScript) {
        const runner = packageScript[1] ?? 'npm';
        const run = packageScript[2] !== undefined ? ' run' : '';
        const script = packageScript[3] ?? '';
        return truncateChars(`${runner}${run} ${script}`, 48);
    }
    const words = normalized.split(/\s+/).slice(0, 5).join(' ');
    return truncateChars(words.length > 0 ? words : normalized, 48);
}
export function taskDisplayName(task) {
    const commandName = task.command && task.command.length > 0 ? deriveTaskNameFromCommand(task.command) : undefined;
    return (normalizeTaskName(task.name) ??
        normalizeTaskName(task.description) ??
        commandName ??
        task.id ??
        'Background task');
}
function parseNameValueAndRest(valueAndRest) {
    const input = valueAndRest.trimStart();
    if (!input)
        return undefined;
    const quote = input[0];
    if (quote === '"' || quote === "'") {
        let escaped = false;
        let value = '';
        for (let i = 1; i < input.length; i++) {
            const char = input.charAt(i);
            if (escaped) {
                value += char;
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === quote) {
                return { value, rest: input.slice(i + 1).trimStart() };
            }
            value += char;
        }
        return undefined;
    }
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input);
    if (!match)
        return undefined;
    const parsedValue = match[1];
    if (parsedValue === undefined)
        return undefined;
    return { value: parsedValue, rest: match[2]?.trimStart() ?? '' };
}
export function parseBgCommandArgs(args) {
    let input = args.trim();
    let name;
    let isAgent = false;
    let surviveReload = false;
    while (input) {
        let consumed = false;
        for (const prefix of ['--name=', '-n=']) {
            if (input.startsWith(prefix)) {
                const parsed = parseNameValueAndRest(input.slice(prefix.length));
                if (!parsed)
                    throw new Error(`${prefix.slice(0, -1)} requires a task name`);
                name = normalizeTaskName(parsed.value);
                input = parsed.rest;
                consumed = true;
                break;
            }
        }
        if (consumed)
            continue;
        for (const prefix of ['--name', '-n']) {
            if (input === prefix || input.startsWith(`${prefix} `) || input.startsWith(`${prefix}\t`)) {
                const parsed = parseNameValueAndRest(input.slice(prefix.length));
                if (!parsed)
                    throw new Error(`${prefix} requires a task name`);
                name = normalizeTaskName(parsed.value);
                input = parsed.rest;
                consumed = true;
                break;
            }
        }
        if (consumed)
            continue;
        for (const flag of ['--agent', '--llm-agent']) {
            if (input === flag || input.startsWith(`${flag} `) || input.startsWith(`${flag}\t`)) {
                isAgent = true;
                input = input.slice(flag.length).trimStart();
                consumed = true;
                break;
            }
        }
        if (consumed)
            continue;
        for (const flag of ['--script', '--no-agent']) {
            if (input === flag || input.startsWith(`${flag} `) || input.startsWith(`${flag}\t`)) {
                isAgent = false;
                input = input.slice(flag.length).trimStart();
                consumed = true;
                break;
            }
        }
        if (consumed)
            continue;
        if (input === '--survive-reload' ||
            input.startsWith('--survive-reload ') ||
            input.startsWith('--survive-reload\t')) {
            if (surviveReload) {
                throw new ReloadSurvivalError('pi_bg_survive_reload_invalid', '/bg accepts --survive-reload at most once');
            }
            surviveReload = true;
            input = input.slice('--survive-reload'.length).trimStart();
            continue;
        }
        if (input.startsWith('--survive-reload=')) {
            throw new ReloadSurvivalError('pi_bg_survive_reload_invalid', '/bg accepts only the bare --survive-reload flag');
        }
        if (input === '--') {
            input = '';
            break;
        }
        if (input.startsWith('-- ')) {
            input = input.slice(3).trimStart();
            break;
        }
        break;
    }
    if (surviveReload && isAgent) {
        throw new ReloadSurvivalError('pi_bg_survive_reload_requires_non_agent', 'surviveReload requires isAgent:false');
    }
    return name
        ? { name, command: input, isAgent, surviveReload }
        : { command: input, isAgent, surviveReload };
}
export function formatDuration(ms) {
    if (ms < 1000)
        return `${String(ms)}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${String(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
    if (minutes < 60)
        return `${String(minutes)}m${remSeconds > 0 ? `${String(remSeconds)}s` : ''}`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${String(hours)}h${remMinutes > 0 ? `${String(remMinutes)}m` : ''}`;
}
export function formatCompactNumber(count) {
    const normalized = Math.max(0, Math.floor(count));
    if (normalized < 1000)
        return normalized.toString();
    if (normalized < 10000)
        return `${(normalized / 1000).toFixed(1)}k`;
    if (normalized < 1000000)
        return `${String(Math.round(normalized / 1000))}k`;
    if (normalized < 10000000)
        return `${(normalized / 1000000).toFixed(1)}M`;
    return `${String(Math.round(normalized / 1000000))}M`;
}
export function formatContextUsageSummary(usage) {
    if (usage?.contextWindow === undefined || usage.contextWindow <= 0)
        return undefined;
    const window = formatCompactNumber(usage.contextWindow);
    if (usage.percent === null || usage.tokens === null)
        return `ctx=?/${window}`;
    return `ctx=${usage.percent.toFixed(1)}%/${window}`;
}
export function formatTokenUsageSummary(usage) {
    if (!usage || usage.totalTokens <= 0)
        return undefined;
    return `tokens=${formatCompactNumber(usage.totalTokens)}`;
}
export function formatToolUsageSummary(usage) {
    if (!usage || (usage.total <= 0 && usage.failed <= 0))
        return undefined;
    const failed = usage.failed > 0 ? ` failed=${String(usage.failed)}` : '';
    return `tools=${String(usage.total)}${failed}`;
}
export function formatModelSummary(model) {
    if (!model)
        return undefined;
    return `model=${model}`;
}
/**
 * Human-readable activity transcript for telemetry-wrapped Pi agents.
 *
 * The wrapper emits one `background-task-activity` control line per meaningful
 * child-agent event (assistant text, reasoning, tool start, tool end) so the
 * registry can render "what the agent is actually doing" into the task output
 * file instead of leaking raw telemetry JSON. Both the parser and the formatter
 * are pure so the visible transcript is fully unit-testable.
 */
export const AGENT_ACTIVITY_TYPE = 'background-task-activity';
const AGENT_ACTIVITY_DETAIL_MAX = 80;
function readActivityString(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}
/** Narrow a parsed `background-task-activity` control payload into a typed {@link AgentActivity}. */
export function parseAgentActivity(payload) {
    if (!isJsonObject(payload))
        return undefined;
    const record = payload;
    if (record.type !== AGENT_ACTIVITY_TYPE)
        return undefined;
    const kind = record.kind;
    if (kind === 'assistant_text' || kind === 'reasoning') {
        const text = readActivityString(record, 'text');
        if (text === undefined)
            return undefined;
        return { kind, text };
    }
    if (kind === 'tool_start') {
        const tool = readActivityString(record, 'tool');
        if (!tool)
            return undefined;
        return { kind, tool, argsSummary: readActivityString(record, 'argsSummary') ?? '' };
    }
    if (kind === 'tool_end') {
        const tool = readActivityString(record, 'tool');
        if (!tool)
            return undefined;
        const activity = { kind, tool, isError: record.isError === true };
        const error = readActivityString(record, 'error');
        if (error !== undefined && error.trim().length > 0)
            activity.error = error;
        return activity;
    }
    return undefined;
}
/**
 * Render an {@link AgentActivity} into a single transcript line, or `undefined`
 * when the event carries nothing worth showing (blank text, a successful tool
 * end). Successful tool ends are intentionally silent: the matching `→` start
 * line already announced the call, and the next line implies completion.
 */
export function formatAgentActivityLine(activity) {
    if (activity.kind === 'assistant_text') {
        const text = activity.text.replace(/\s+$/u, '');
        return text.trim().length > 0 ? text : undefined;
    }
    if (activity.kind === 'reasoning') {
        const text = activity.text.replace(/\s+$/u, '');
        return text.trim().length > 0 ? `\u2026 ${text}` : undefined;
    }
    if (activity.kind === 'tool_start') {
        const summary = compactWhitespace(activity.argsSummary);
        const suffix = summary.length > 0 ? ` ${truncateChars(summary, AGENT_ACTIVITY_DETAIL_MAX)}` : '';
        return `\u2192 ${activity.tool}${suffix}`;
    }
    if (!activity.isError)
        return undefined;
    const detail = activity.error
        ? `: ${truncateChars(compactWhitespace(activity.error), AGENT_ACTIVITY_DETAIL_MAX)}`
        : '';
    return `\u2717 ${activity.tool} failed${detail}`;
}
export function shellQuote(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
export class ShellInvocationError extends Error {
    code = 'pi_bg_shell_invalid';
    constructor(message) {
        super(`pi_bg_shell_invalid: ${message}`);
        this.name = 'ShellInvocationError';
    }
}
const POSIX_FUNCTION_SHELLS = new Set([
    'sh',
    'dash',
    'ash',
    'ksh',
    'ksh93',
    'mksh',
    'pdksh',
    'zsh',
    'yash',
    'posh',
]);
function failShellInvocation(message) {
    throw new ShellInvocationError(message);
}
function shellErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function freezeShellPolicy(policy) {
    return Object.freeze({
        ...policy,
        argvPrefix: Object.freeze([...policy.argvPrefix]),
    });
}
export function shellPolicySnapshot(policy) {
    return Object.freeze({
        policy: policy.policy,
        executable: policy.executable,
        argvPrefix: Object.freeze([...policy.argvPrefix]),
        dialect: policy.dialect,
    });
}
function isWindowsExecutablePath(path) {
    const extension = extname(path).toLowerCase();
    return extension === '.exe' || extension === '.com';
}
function validateWindowsShellPath(path, label) {
    if (path.length === 0)
        failShellInvocation(`${label} is empty`);
    if (!isAbsolute(path) && !win32.isAbsolute(path)) {
        failShellInvocation(`${label} must be an absolute path`);
    }
    if (!isWindowsExecutablePath(path)) {
        failShellInvocation(`${label} must point to a .exe or .com file`);
    }
    let stats;
    try {
        stats = statSync(path);
    }
    catch (error) {
        failShellInvocation(`${label} stat failed: ${shellErrorMessage(error)}`);
    }
    if (!stats.isFile())
        failShellInvocation(`${label} must point to a regular file`);
    return path;
}
function inspectWindowsShellCandidate(path) {
    if (!isWindowsExecutablePath(path)) {
        return { found: false, diagnostic: `${path} is not a .exe or .com path` };
    }
    try {
        const stats = statSync(path);
        if (stats.isFile())
            return { found: true };
        return { found: false, diagnostic: `${path} is not a regular file` };
    }
    catch (error) {
        return { found: false, diagnostic: `${path}: ${shellErrorMessage(error)}` };
    }
}
function windowsPathValue(env) {
    return env['PATH'] ?? env['Path'] ?? env['path'] ?? '';
}
function resolveWindowsBash(env) {
    const pathValue = windowsPathValue(env);
    const diagnostics = [];
    for (const dir of pathValue.split(';').filter((entry) => entry.length > 0)) {
        for (const name of ['bash.exe', 'bash.com']) {
            const candidate = join(dir, name);
            const result = inspectWindowsShellCandidate(candidate);
            if (result.found)
                return candidate;
            diagnostics.push(result.diagnostic);
        }
    }
    const suffix = diagnostics.length > 0 ? `: ${diagnostics.join('; ')}` : '';
    failShellInvocation(`PI_BG_SHELL=bash could not resolve bash.exe or bash.com on PATH${suffix}`);
}
function validatePosixShellPath(path, label) {
    if (path.length === 0)
        failShellInvocation(`${label} is empty`);
    if (!isAbsolute(path))
        failShellInvocation(`${label} must be an absolute path`);
    let stats;
    try {
        stats = statSync(path);
    }
    catch (error) {
        failShellInvocation(`${label} stat failed: ${shellErrorMessage(error)}`);
    }
    if (!stats.isFile())
        failShellInvocation(`${label} must point to a regular file`);
    try {
        accessSync(path, constants.X_OK);
    }
    catch (error) {
        failShellInvocation(`${label} must be executable: ${shellErrorMessage(error)}`);
    }
    return path;
}
function inspectPosixShellCandidate(path) {
    try {
        const stats = statSync(path);
        if (!stats.isFile())
            return false;
        accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function resolvePosixExecutable(name, env, activationCwd) {
    const binCandidate = `/bin/${name}`;
    if (inspectPosixShellCandidate(binCandidate))
        return binCandidate;
    const pathValue = env['PATH'] ?? '';
    for (const entry of pathValue.split(delimiter)) {
        if (entry.length === 0)
            continue;
        const directory = isAbsolute(entry) ? entry : resolve(activationCwd, entry);
        const candidate = join(directory, name);
        if (inspectPosixShellCandidate(candidate))
            return candidate;
    }
    failShellInvocation(`PI_BG_POSIX_SHELL=${name} could not resolve executable ${binCandidate} or ${name} on PATH`);
}
function inheritedPosixDialect(executable) {
    const name = basename(executable).toLowerCase();
    if (name === 'bash')
        return 'bash';
    return POSIX_FUNCTION_SHELLS.has(name) ? 'posix' : 'user-non-posix';
}
/** Resolve one activation-stable policy. New POSIX variables are intentionally ignored on Windows. */
export function resolveShellPolicy(platform = process.platform, env = process.env, activationCwd = process.cwd()) {
    if (platform === 'win32') {
        const requestedShell = env['PI_BG_SHELL'];
        const requestedPath = env['PI_BG_SHELL_PATH'];
        if (requestedShell === undefined) {
            if (requestedPath !== undefined)
                failShellInvocation('PI_BG_SHELL_PATH requires PI_BG_SHELL');
            const comSpec = env['ComSpec'];
            return freezeShellPolicy({
                policy: 'cmd',
                executable: comSpec && comSpec.length > 0 ? comSpec : 'cmd.exe',
                argvPrefix: ['/d', '/s', '/c'],
                dialect: 'cmd',
                supportsPosixFunctionWrapper: false,
                windowsVerbatimArguments: true,
            });
        }
        if (requestedShell !== 'cmd' && requestedShell !== 'bash') {
            failShellInvocation('PI_BG_SHELL must be exactly cmd or bash');
        }
        const explicitPath = requestedPath !== undefined
            ? validateWindowsShellPath(requestedPath, 'PI_BG_SHELL_PATH')
            : undefined;
        if (requestedShell === 'cmd') {
            const comSpec = env['ComSpec'];
            return freezeShellPolicy({
                policy: 'cmd',
                executable: explicitPath ?? (comSpec && comSpec.length > 0 ? comSpec : 'cmd.exe'),
                argvPrefix: ['/d', '/s', '/c'],
                dialect: 'cmd',
                supportsPosixFunctionWrapper: false,
                windowsVerbatimArguments: true,
            });
        }
        return freezeShellPolicy({
            policy: 'bash',
            executable: explicitPath ?? resolveWindowsBash(env),
            argvPrefix: ['-c'],
            dialect: 'bash',
            supportsPosixFunctionWrapper: true,
            windowsVerbatimArguments: false,
        });
    }
    const configuredPolicy = env['PI_BG_POSIX_SHELL'];
    if (configuredPolicy !== undefined &&
        configuredPolicy !== 'inherit' &&
        configuredPolicy !== 'bash' &&
        configuredPolicy !== 'sh') {
        failShellInvocation('PI_BG_POSIX_SHELL must be exactly inherit, bash, or sh');
    }
    const policy = configuredPolicy ?? 'inherit';
    const configuredPath = env['PI_BG_POSIX_SHELL_PATH'];
    if (policy === 'inherit') {
        if (configuredPath !== undefined) {
            failShellInvocation('PI_BG_POSIX_SHELL_PATH requires PI_BG_POSIX_SHELL=bash or PI_BG_POSIX_SHELL=sh');
        }
        const inherited = env['SHELL'];
        const executable = inherited && inherited.length > 0 ? inherited : '/bin/sh';
        const dialect = inheritedPosixDialect(executable);
        return freezeShellPolicy({
            policy,
            executable,
            argvPrefix: ['-c'],
            dialect,
            supportsPosixFunctionWrapper: dialect === 'bash' || dialect === 'posix',
            windowsVerbatimArguments: false,
        });
    }
    const executable = configuredPath !== undefined
        ? validatePosixShellPath(configuredPath, 'PI_BG_POSIX_SHELL_PATH')
        : resolvePosixExecutable(policy, env, activationCwd);
    return freezeShellPolicy({
        policy,
        executable,
        argvPrefix: ['-c'],
        dialect: policy === 'bash' ? 'bash' : 'posix',
        supportsPosixFunctionWrapper: true,
        windowsVerbatimArguments: false,
    });
}
export function shellInvocationForPolicy(command, policy) {
    const dialect = policy.dialect === 'bash' ? 'posix' : policy.dialect;
    return {
        shell: policy.executable,
        args: policy.dialect === 'cmd'
            ? [...policy.argvPrefix, `"${command}"`]
            : [...policy.argvPrefix, command],
        dialect,
        windowsVerbatimArguments: policy.windowsVerbatimArguments,
    };
}
export function shellInvocation(command, platform = process.platform, env = process.env) {
    return shellInvocationForPolicy(command, resolveShellPolicy(platform, env));
}
export function normalizeMaxBytes(value, fallback = DEFAULT_LOG_BYTES) {
    const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.max(1, Math.min(MAX_LOG_BYTES, raw));
}
export function snapshot(task) {
    return {
        id: task.id,
        name: taskDisplayName(task),
        command: task.command,
        description: task.description,
        status: task.status,
        outputPath: task.outputPath,
        cwd: task.cwd,
        startTime: task.startTime,
        endTime: task.endTime,
        exitCode: task.exitCode,
        signal: task.signal,
        pid: task.pid,
        bytesWritten: task.bytesWritten,
        isAgent: task.isAgent,
        surviveReload: task.surviveReload === true,
        reloadSurvival: task.reloadSurvival,
        error: task.error,
        notified: task.notified,
        notifyOnCompletion: task.notifyOnCompletion,
        triggerOnCompletion: task.triggerOnCompletion,
        timeoutSeconds: task.timeoutSeconds,
        contextUsage: task.contextUsage,
        tokenUsage: task.tokenUsage,
        toolUsage: task.toolUsage,
        model: task.model,
        telemetryUnavailableReason: task.telemetryUnavailableReason,
        shellPolicy: task.shellPolicy,
        attestationPath: task.attestationPath,
        delegate: task.delegate,
        fusion: task.fusion,
    };
}
export function formatSnapshotList(tasks, now = Date.now()) {
    if (tasks.length === 0)
        return 'No background tasks in this Pi extension runtime.';
    return tasks
        .map((task) => {
        const statusIcon = task.status === 'running'
            ? '▶'
            : task.status === 'completed'
                ? '✓'
                : task.status === 'killed'
                    ? '■'
                    : '✗';
        const age = formatDuration((task.endTime ?? now) - task.startTime);
        const code = task.exitCode !== undefined ? ` exit=${String(task.exitCode)}` : '';
        const pid = task.pid !== undefined ? ` pid=${String(task.pid)}` : '';
        const error = task.error ? ` error=${truncateChars(task.error, 80)}` : '';
        const telemetry = [
            formatContextUsageSummary(task.contextUsage),
            formatModelSummary(task.model),
            formatTokenUsageSummary(task.tokenUsage),
            formatToolUsageSummary(task.toolUsage),
        ]
            .filter(Boolean)
            .join(' ');
        const telemetryText = telemetry ? ` ${telemetry}` : '';
        return `${statusIcon} ${task.id} ${task.status} ${age}${code}${pid}${telemetryText} — ${truncateChars(taskDisplayName(task), COMMAND_PREVIEW_CHARS)}${error}\n    output: ${task.outputPath}`;
    })
        .join('\n');
}
export async function boundedRead(filePath, maxBytes, tail) {
    const stats = statSync(filePath);
    const totalBytes = stats.size;
    const bytesToRead = Math.min(totalBytes, maxBytes);
    if (bytesToRead === 0)
        return { content: '', truncated: false, bytesRead: 0, totalBytes };
    const file = await open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytesToRead);
        const position = tail ? Math.max(0, totalBytes - bytesToRead) : 0;
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
        return {
            content: buffer.subarray(0, bytesRead).toString('utf8'),
            truncated: totalBytes > bytesRead,
            bytesRead,
            totalBytes,
        };
    }
    finally {
        await file.close();
    }
}
export function escapeXml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export const UPDATE_COMMAND = '/bg-update';
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function parseSemver(value) {
    if (typeof value !== 'string')
        return undefined;
    const match = SEMVER_PATTERN.exec(value.trim());
    if (!match)
        return undefined;
    const majorRaw = match[1];
    const minorRaw = match[2];
    const patchRaw = match[3];
    if (majorRaw === undefined || minorRaw === undefined || patchRaw === undefined)
        return undefined;
    const major = Number(majorRaw);
    const minor = Number(minorRaw);
    const patch = Number(patchRaw);
    if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch))
        return undefined;
    const prerelease = match[4] !== undefined ? match[4].split('.') : [];
    return { major, minor, patch, prerelease };
}
function comparePrerelease(a, b) {
    if (a.length === 0 && b.length === 0)
        return 0;
    // A version without prerelease identifiers outranks the same core with prerelease identifiers.
    if (a.length === 0)
        return 1;
    if (b.length === 0)
        return -1;
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
        const idA = a[i];
        const idB = b[i];
        if (idA === undefined || idB === undefined)
            break;
        if (idA === idB)
            continue;
        const numericA = /^\d+$/.test(idA);
        const numericB = /^\d+$/.test(idB);
        if (numericA && numericB) {
            const diff = Number(idA) - Number(idB);
            if (diff !== 0)
                return diff < 0 ? -1 : 1;
            continue;
        }
        // Numeric identifiers always have lower precedence than non-numeric identifiers.
        if (numericA)
            return -1;
        if (numericB)
            return 1;
        return idA < idB ? -1 : 1;
    }
    if (a.length === b.length)
        return 0;
    return a.length < b.length ? -1 : 1;
}
/** Compare two semver strings. Returns -1/0/1, or undefined when either side is not valid semver. */
export function compareSemver(a, b) {
    const left = parseSemver(a);
    const right = parseSemver(b);
    if (!left || !right)
        return undefined;
    if (left.major !== right.major)
        return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor)
        return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch)
        return left.patch < right.patch ? -1 : 1;
    return comparePrerelease(left.prerelease, right.prerelease);
}
export function isNewerVersion(latest, current) {
    return compareSemver(latest, current) === 1;
}
/** Footer segment shown only when a newer published version exists; undefined otherwise. */
export function formatUpdateSegment(latest, current) {
    if (!latest)
        return undefined;
    if (!isNewerVersion(latest, current))
        return undefined;
    return `\u2b06 v${latest} ${UPDATE_COMMAND}`;
}
//# sourceMappingURL=common.js.map