import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatSize } from '@earendil-works/pi-coding-agent';
import { boundedRead, deriveTaskNameFromCommand, escapeXml, formatAgentActivityLine, formatDuration, isJsonObject, normalizeTaskName, parseAgentActivity, parseJsonText, rejectSurvivalForTaskKind, resolveShellPolicy, sanitizePathSegment, shellInvocationForPolicy, shellPolicySnapshot, shellQuote, snapshot, taskDisplayName, ReloadSurvivalError, } from './common.js';
import { ATTESTED_GIT_KILL_GRACE_MS, ATTESTED_GIT_MAX_OUTPUT_BYTES, ATTESTED_TASK_ID_PATTERN, } from './attested-pi-contract.js';
import { closeAndFsyncOutputStream, writeFileFsynced, writeJsonAtomic } from './task-durable.js';
import { assertWindowsCommandLineWithinLimit, piLaunchArgv, resolvePiLaunch, } from './pi-launch.js';
import { BackgroundTaskExtensionServiceClosedError } from './extension-api.js';
import { resolveAnthropicAttributionExtensionPath } from './anthropic-attribution-path.js';
import { createReloadableShellExecutionV1, RELOAD_SHELL_OWNER_PROTOCOL, } from './reload-shell-owner.js';
import { runWindowsTaskkill, } from './windows-taskkill.js';
export const MAX_OUTPUT_BYTES = Number(process.env['PI_BG_MAX_OUTPUT_BYTES'] ?? 20 * 1024 * 1024);
export const KILL_GRACE_MS = 3000;
export const STOP_WAIT_MS = KILL_GRACE_MS + 1500;
export const MAX_RECENT_TASKS = 100;
export const TERMINAL_PUBLICATION_MAX_ATTEMPTS = 3;
export const TERMINAL_PUBLICATION_RETRY_MS = 100;
export const TASK_ADMISSION_TIMEOUT_MS = 30_000;
const TERMINAL_PUBLICATION_DIAGNOSTIC_CHARS = 500;
const TELEMETRY_BUFFER_CHARS = 512 * 1024;
export class BackgroundTaskAdmissionClosedError extends Error {
    code = 'pi_background_tasks_admission_closed';
    constructor(kind) {
        super(`Cannot start ${kind} after background task admissions have closed`);
        this.name = 'BackgroundTaskAdmissionClosedError';
    }
}
export class BackgroundTaskAdmissionTimeoutError extends Error {
    code = 'pi_background_tasks_admission_timeout';
    constructor(kind, timeoutMs) {
        super(`Timed out while preparing ${kind} after ${String(timeoutMs)}ms`);
        this.name = 'BackgroundTaskAdmissionTimeoutError';
    }
}
export const WIN32_CMD_PI_TELEMETRY_UNAVAILABLE_REASON = 'win32-cmd-cannot-safely-intercept-pi-argv';
export const NON_POSIX_SHELL_PI_TELEMETRY_UNAVAILABLE_REASON = 'user-non-posix-shell-cannot-safely-intercept-pi-argv';
function defaultTaskId() {
    return `b${randomBytes(4).toString('hex')}`;
}
function dirNameFromDisplay(path) {
    const parts = path.split(/[\\/]/);
    return parts.length >= 2 ? (parts.at(-2) ?? '') : '';
}
export function commandMayLaunchPiAgent(command, env = process.env) {
    if (env['PI_BG_DISABLE_PI_TELEMETRY'] === '1')
        return false;
    return /(^|[\s;&|()])pi(?=\s)(?=[^\n;&|]*(?:\s-p(?:\s|$)|\s--print(?:\s|$)|\s--mode(?:=|\s+)json\b))/m.test(command);
}
export function buildModelWindowIndex(ctx) {
    const byQualifiedId = {};
    const candidatesById = new Map();
    for (const model of ctx.modelRegistry.getAll()) {
        const contextWindow = typeof model.contextWindow === 'number' &&
            Number.isFinite(model.contextWindow) &&
            model.contextWindow > 0
            ? Math.floor(model.contextWindow)
            : undefined;
        if (!contextWindow)
            continue;
        byQualifiedId[`${model.provider}/${model.id}`] = contextWindow;
        let candidates = candidatesById.get(model.id);
        if (!candidates) {
            candidates = new Set();
            candidatesById.set(model.id, candidates);
        }
        candidates.add(contextWindow);
    }
    const byId = {};
    for (const [id, windows] of candidatesById) {
        const onlyWindow = windows.values().next();
        if (windows.size === 1 && !onlyWindow.done)
            byId[id] = onlyWindow.value;
    }
    const current = ctx.model;
    return {
        byQualifiedId,
        byId,
        defaultModel: current?.id,
        defaultProvider: current?.provider,
        defaultContextWindow: current?.contextWindow,
    };
}
export function createPiTelemetryWrapperSource(index, launch = resolvePiLaunch()) {
    return `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const index = ${JSON.stringify(index)};
const launch = ${JSON.stringify(launch)};
const WINDOWS_COMMAND_LINE_LIMIT = 32767;

const tokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
let costTotal = 0;
let hasCostTotal = false;
let agentModel;
const toolUsage = { total: 0, failed: 0, byName: {} };
const seenToolCallIds = new Set();
const failedToolCallIds = new Set();

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeUsage(usage) {
  if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const input = nonNegativeInteger(usage.input);
  const output = nonNegativeInteger(usage.output);
  const cacheRead = nonNegativeInteger(usage.cacheRead);
  const cacheWrite = nonNegativeInteger(usage.cacheWrite);
  const explicitTotal = nonNegativeInteger(usage.totalTokens);
  const totalTokens = explicitTotal || (input + output + cacheRead + cacheWrite);
  const cost = usage.cost && typeof usage.cost.total === "number" && Number.isFinite(usage.cost.total) && usage.cost.total >= 0
    ? usage.cost.total
    : undefined;
  return { input, output, cacheRead, cacheWrite, totalTokens, cost };
}

function addTokenUsage(usage) {
  const normalized = normalizeUsage(usage);
  if (!normalized.totalTokens) return normalized;
  tokenUsage.input += normalized.input;
  tokenUsage.output += normalized.output;
  tokenUsage.cacheRead += normalized.cacheRead;
  tokenUsage.cacheWrite += normalized.cacheWrite;
  tokenUsage.totalTokens += normalized.totalTokens;
  if (normalized.cost !== undefined) {
    costTotal += normalized.cost;
    hasCostTotal = true;
  }
  return normalized;
}

function currentTokenUsage() {
  if (!tokenUsage.totalTokens) return undefined;
  const out = { ...tokenUsage };
  if (hasCostTotal) out.costTotal = costTotal;
  return out;
}

function markToolStarted(id, name) {
  const key = id ? String(id) : undefined;
  if (key && seenToolCallIds.has(key)) return;
  if (key) seenToolCallIds.add(key);
  const toolName = name ? String(name) : "unknown";
  toolUsage.total += 1;
  toolUsage.byName[toolName] = (toolUsage.byName[toolName] || 0) + 1;
}

function markToolFailed(id) {
  const key = id ? String(id) : undefined;
  if (key && failedToolCallIds.has(key)) return;
  if (key) failedToolCallIds.add(key);
  toolUsage.failed += 1;
}

function currentToolUsage() {
  if (!toolUsage.total && !toolUsage.failed) return undefined;
  return { total: toolUsage.total, failed: toolUsage.failed, byName: { ...toolUsage.byName } };
}

function renderWindowsArgument(value) {
  if (value.length > 0 && !/[ \\t\"]/.test(value)) return value;
  let rendered = "\\\"";
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\\\") {
      backslashes += 1;
      continue;
    }
    if (char === "\\\"") {
      rendered += "\\\\".repeat(backslashes * 2 + 1);
      rendered += "\\\"";
      backslashes = 0;
      continue;
    }
    if (backslashes > 0) {
      rendered += "\\\\".repeat(backslashes);
      backslashes = 0;
    }
    rendered += char;
  }
  if (backslashes > 0) rendered += "\\\\".repeat(backslashes * 2);
  rendered += "\\\"";
  return rendered;
}

function assertWindowsLimit(stage, args) {
  if (process.platform !== "win32") return;
  const measured = [launch.executable, ...launch.argvPrefix, ...args].map(renderWindowsArgument).join(" ").length + 1;
  if (measured > WINDOWS_COMMAND_LINE_LIMIT) {
    const error = new Error("pi_command_line_too_long: " + stage + " measured UTF-16 command line length " + String(measured) + " exceeds limit " + String(WINDOWS_COMMAND_LINE_LIMIT));
    error.code = "pi_command_line_too_long";
    throw error;
  }
}

function emitUnifiedTelemetry(payload) {
  const out = { type: "background-task-telemetry", ...payload };
  const tokens = currentTokenUsage();
  const tools = currentToolUsage();
  if (tokens && !out.tokenUsage) out.tokenUsage = tokens;
  if (tools && !out.toolUsage) out.toolUsage = tools;
  if (agentModel && !out.model) out.model = agentModel;
  process.stdout.write(JSON.stringify(out) + "\\n");
}

function emitActivity(activity) {
  process.stdout.write(JSON.stringify({ type: "background-task-activity", ...activity }) + "\\n");
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  const pick = (value) => {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
  };
  const preferred = ["path", "file_path", "file", "filename", "command", "cmd", "pattern", "query", "url", "name", "value", "text", "message"];
  for (const key of preferred) { const summary = pick(args[key]); if (summary) return summary; }
  for (const key of Object.keys(args)) { const summary = pick(args[key]); if (summary) return summary; }
  return "";
}

function emitAssistantActivity(message) {
  const content = message && Array.isArray(message.content) ? message.content : [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      emitActivity({ kind: "assistant_text", text: part.text });
    } else if (part.type === "thinking" || part.type === "reasoning") {
      const text = typeof part.text === "string" ? part.text : (typeof part.thinking === "string" ? part.thinking : "");
      if (text.trim()) emitActivity({ kind: "reasoning", text: text });
    }
  }
}

function resolveModelName(fromMessage, fromArgs, providerFromArgs) {
  const message = fromMessage ? String(fromMessage) : "";
  const args = fromArgs ? String(fromArgs) : "";
  const bareOf = (value) => value.includes("/") ? value.split("/").pop() : value;
  if (message && message.includes("/")) return message;
  if (args && args.includes("/") && (!message || bareOf(args) === message)) return args;
  const primary = message || args;
  if (!primary) return undefined;
  if (primary.includes("/")) return primary;
  if (providerFromArgs) return providerFromArgs + "/" + primary;
  if (index.defaultProvider) return index.defaultProvider + "/" + primary;
  return primary;
}

function parseInvocation(argv) {
  const out = [];
  let model;
  let provider;
  let hasMode = false;
  let modeValue;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") continue;
    if (arg === "--mode") {
      hasMode = true;
      modeValue = argv[i + 1];
      out.push(arg);
      if (i + 1 < argv.length) out.push(argv[++i]);
      continue;
    }
    if (arg.startsWith("--mode=")) {
      hasMode = true;
      modeValue = arg.slice("--mode=".length);
      out.push(arg);
      continue;
    }
    if (arg === "--model" && i + 1 < argv.length) {
      model = argv[i + 1];
      out.push(arg, argv[++i]);
      continue;
    }
    if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
    if (arg === "--provider" && i + 1 < argv.length) {
      provider = argv[i + 1];
      out.push(arg, argv[++i]);
      continue;
    }
    if (arg.startsWith("--provider=")) provider = arg.slice("--provider=".length);
    out.push(arg);
  }
  if (hasMode && modeValue !== "json") return { args: argv, parseJson: false, model, provider };
  if (!hasMode) out.unshift("--mode", "json");
  return { args: out, parseJson: true, model, provider };
}

function resolveWindow(modelFromArgs, providerFromArgs, modelFromMessage) {
  const candidates = [];
  if (modelFromMessage) candidates.push(modelFromMessage);
  if (modelFromArgs) candidates.push(modelFromArgs);
  if (modelFromArgs && providerFromArgs && !modelFromArgs.includes("/")) candidates.push(providerFromArgs + "/" + modelFromArgs);
  if (modelFromArgs && index.defaultProvider && !modelFromArgs.includes("/")) candidates.push(index.defaultProvider + "/" + modelFromArgs);
  if (index.defaultModel && index.defaultProvider) candidates.push(index.defaultProvider + "/" + index.defaultModel);
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (index.byQualifiedId[candidate]) return index.byQualifiedId[candidate];
    const bare = String(candidate).includes("/") ? String(candidate).split("/").pop() : String(candidate);
    if (bare && index.byId[bare]) return index.byId[bare];
  }
  return index.defaultContextWindow || 0;
}

function countToolCallsFromMessage(message) {
  const content = message && Array.isArray(message.content) ? message.content : [];
  for (const part of content) {
    if (part && part.type === "toolCall") markToolStarted(part.id, part.name);
  }
}

function emitMessageTelemetry(message, modelFromArgs, providerFromArgs) {
  const usage = addTokenUsage(message && message.usage);
  const resolvedModel = resolveModelName(message && message.model, modelFromArgs, providerFromArgs);
  if (resolvedModel) agentModel = resolvedModel;
  const contextWindow = resolveWindow(modelFromArgs, providerFromArgs, message && message.model);
  const contextUsage = usage.totalTokens && contextWindow
    ? { tokens: usage.totalTokens, contextWindow, percent: (usage.totalTokens / contextWindow) * 100 }
    : undefined;
  if (contextUsage) process.stdout.write(JSON.stringify({ type: "background-task-context-usage", ...contextUsage }) + "\\n");
  const payload = {};
  if (contextUsage) payload.contextUsage = contextUsage;
  emitUnifiedTelemetry(payload);
}

function emitToolTelemetry() {
  emitUnifiedTelemetry({});
}

const parsed = parseInvocation(process.argv.slice(2));
let child;
let buffer = "";
try {
  const childArgs = [...launch.argvPrefix, ...parsed.args];
  assertWindowsLimit("telemetry-wrapper-pi", parsed.args);
  child = spawn(launch.executable, childArgs, { stdio: ["ignore", "pipe", "pipe"], env: process.env, shell: false, windowsHide: true });
} catch (error) {
  const message = error && typeof error.message === "string" ? error.message : String(error);
  process.stderr.write("[pi-bg telemetry wrapper error: " + message + "]\\n");
  process.exitCode = 1;
}

if (child) {
  if (!parsed.parseJson) {
    child.stdout.pipe(process.stdout);
  } else {
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });
  }
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    process.stderr.write("[pi-bg telemetry wrapper error: " + error.message + "]\\n");
  });
  child.on("close", (code, signal) => {
    if (parsed.parseJson && buffer.trim()) processLine(buffer);
    // Never call process.exit() here: the final message telemetry may still be
    // buffered on wrapper stdout, and forced exit can publish a stale context
    // snapshot from the preceding assistant turn. exitCode lets Node drain the
    // pipe; signal termination is deferred through the same stdout barrier.
    process.stdout.write("", () => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 0;
    });
  });
}

function processLine(line) {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    process.stdout.write(line + "\\n");
    return;
  }
  if (event.type === "tool_execution_start") {
    const toolName = event.toolName || event.tool_name || "tool";
    markToolStarted(event.toolCallId || event.tool_call_id, toolName);
    emitActivity({ kind: "tool_start", tool: String(toolName), argsSummary: summarizeArgs(event.args || event.arguments || event.input || event.parameters) });
    emitToolTelemetry();
    return;
  }
  if (event.type === "tool_execution_end") {
    const toolName = event.toolName || event.tool_name || "tool";
    if (event.isError) markToolFailed(event.toolCallId || event.tool_call_id);
    emitActivity({ kind: "tool_end", tool: String(toolName), isError: !!event.isError, error: typeof event.error === "string" ? event.error : undefined });
    emitToolTelemetry();
    return;
  }
  if (event.type === "message_end" && event.message && event.message.role === "assistant") {
    emitAssistantActivity(event.message);
    countToolCallsFromMessage(event.message);
    emitMessageTelemetry(event.message, parsed.model, parsed.provider);
  }
}
`;
}
function normalizeContextUsage(value) {
    if (!isJsonObject(value))
        return undefined;
    const input = value;
    const rawContextWindow = input.contextWindow;
    const contextWindow = typeof rawContextWindow === 'number' &&
        Number.isFinite(rawContextWindow) &&
        rawContextWindow > 0
        ? Math.floor(rawContextWindow)
        : undefined;
    if (!contextWindow)
        return undefined;
    const rawTokens = input.tokens;
    const tokens = rawTokens === null
        ? null
        : typeof rawTokens === 'number' && Number.isFinite(rawTokens) && rawTokens >= 0
            ? Math.floor(rawTokens)
            : null;
    const rawPercent = input.percent;
    const percent = rawPercent === null
        ? null
        : typeof rawPercent === 'number' && Number.isFinite(rawPercent) && rawPercent >= 0
            ? rawPercent
            : tokens === null
                ? null
                : (tokens / contextWindow) * 100;
    return { tokens, contextWindow, percent };
}
function parseContextUsageXml(xml) {
    const readNumber = (tag) => {
        const match = new RegExp(`<${tag}>(.*?)</${tag}>`, 'i').exec(xml);
        if (!match)
            return undefined;
        const raw = match[1]?.trim();
        if (raw === 'null' || raw === '?')
            return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    const tokens = readNumber('tokens');
    const contextWindow = readNumber('context-window') ?? readNumber('contextWindow');
    const percent = readNumber('percent');
    return normalizeContextUsage({ tokens, contextWindow, percent });
}
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
function normalizeModel(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
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
    if (usage.totalTokens <= 0)
        usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const rawCostTotal = input.costTotal;
    if (typeof rawCostTotal === 'number' && Number.isFinite(rawCostTotal) && rawCostTotal >= 0)
        usage.costTotal = rawCostTotal;
    return usage.totalTokens > 0 ? usage : undefined;
}
function normalizeToolUsage(value) {
    if (!isJsonObject(value))
        return undefined;
    const input = value;
    const byName = {};
    const rawByName = input.byName;
    if (isJsonObject(rawByName)) {
        for (const [name, count] of Object.entries(rawByName)) {
            const normalized = nonNegativeInteger(count);
            if (normalized > 0)
                byName[name] = normalized;
        }
    }
    const byNameTotal = Object.values(byName).reduce((sum, count) => sum + count, 0);
    const failed = nonNegativeInteger(input.failed);
    const total = Math.max(nonNegativeInteger(input.total), byNameTotal, failed);
    return total > 0 || failed > 0 ? { total, failed, byName } : undefined;
}
function noopOnChange() {
    return undefined;
}
/**
 * Deliver the delegate prompt bytes over stdin.
 *
 * A failure to deliver the seed is loud: the caller terminates the task rather
 * than letting a child run without the context it was supposed to receive.
 */
function writeDelegateStdin(child, bytes, onError) {
    const stdin = child.stdin;
    if (stdin === undefined || stdin === null) {
        onError(new Error('delegate child stdin pipe is unavailable'));
        return;
    }
    stdin.once('error', onError);
    stdin.write(bytes, (error) => {
        if (error !== undefined && error !== null) {
            onError(error);
            return;
        }
        stdin.end();
    });
}
export class BackgroundTaskRegistry {
    tasks = new Map();
    runtimeDir;
    shuttingDown = false;
    taskAdmissionsClosed = false;
    activeTaskAdmissions = new Set();
    taskAdmissionDrainWaiters = new Set();
    terminalPublicationClosed = false;
    terminalPublicationCloseReason;
    terminalPublicationClosedSignal;
    resolveTerminalPublicationClosedSignal = () => { };
    spawn;
    killProcess;
    killTree;
    platform;
    env;
    shellPolicy;
    shellPolicyEnv;
    makeTaskIdFn;
    now;
    maxOutputBytes;
    maxRecentTasks;
    killGraceMs;
    stopWaitMs;
    taskAdmissionTimeoutMs;
    attestedGitKillGraceMs;
    attestedGitMaxOutputBytes;
    attestedGitSpawn;
    attestedRuntimePromise;
    logger;
    onChange;
    sendCompletionNotification;
    publishTerminalSnapshot;
    posixProcessGroupKillStates = new WeakMap();
    windowsKillStates = new WeakMap();
    terminalPublicationAbandonSignals = new WeakMap();
    reloadShellOwner;
    reloadShellLease;
    reloadShellIdentity;
    constructor(options) {
        this.terminalPublicationClosedSignal = new Promise((resolve) => {
            this.resolveTerminalPublicationClosedSignal = resolve;
        });
        this.spawn =
            options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
        this.killProcess = options.killProcess ?? process.kill.bind(process);
        this.platform = options.platform ?? process.platform;
        this.env = options.env ?? process.env;
        this.shellPolicy = options.shellPolicy;
        this.shellPolicyEnv = options.shellPolicy === undefined ? { ...this.env } : undefined;
        const taskkillEnv = this.env;
        this.killTree =
            options.killTree ??
                ((pid, phase, signal) => {
                    const taskkillOptions = signal === undefined ? { env: taskkillEnv } : { env: taskkillEnv, signal };
                    return runWindowsTaskkill(pid, phase, taskkillOptions);
                });
        this.makeTaskIdFn = options.makeTaskId ?? defaultTaskId;
        this.now = options.now ?? Date.now;
        this.maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
        this.maxRecentTasks = options.maxRecentTasks ?? MAX_RECENT_TASKS;
        this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
        this.stopWaitMs = options.stopWaitMs ?? STOP_WAIT_MS;
        this.taskAdmissionTimeoutMs = BackgroundTaskRegistry.positiveTimeout(options.taskAdmissionTimeoutMs, TASK_ADMISSION_TIMEOUT_MS, 'taskAdmissionTimeoutMs');
        this.attestedGitKillGraceMs = BackgroundTaskRegistry.positiveTimeout(options.attestedGitKillGraceMs, ATTESTED_GIT_KILL_GRACE_MS, 'attestedGitKillGraceMs');
        this.attestedGitMaxOutputBytes = BackgroundTaskRegistry.positiveTimeout(options.attestedGitMaxOutputBytes, ATTESTED_GIT_MAX_OUTPUT_BYTES, 'attestedGitMaxOutputBytes');
        this.attestedGitSpawn = options.attestedGitSpawn;
        this.logger = options.logger ?? console;
        this.onChange = options.onChange ?? noopOnChange;
        this.sendCompletionNotification = options.sendCompletionNotification;
        this.publishTerminalSnapshot = options.publishTerminal ?? noopOnChange;
        this.reloadShellOwner = options.reloadShellOwner;
    }
    isShuttingDown() {
        return this.shuttingDown;
    }
    resolvedShellPolicy() {
        const existing = this.shellPolicy;
        if (existing !== undefined)
            return existing;
        const resolved = resolveShellPolicy(this.platform, this.shellPolicyEnv ?? this.env, process.cwd());
        this.shellPolicy = resolved;
        return resolved;
    }
    loadAttestedRuntime() {
        const existing = this.attestedRuntimePromise;
        if (existing !== undefined)
            return existing;
        const loading = import('./attested-pi-run.js');
        this.attestedRuntimePromise = loading;
        return loading;
    }
    static positiveTimeout(value, fallback, label) {
        const candidate = value ?? fallback;
        if (!Number.isFinite(candidate) || candidate <= 0) {
            throw new Error(`${label} must be a positive finite number`);
        }
        return Math.max(1, Math.floor(candidate));
    }
    beginTaskAdmission(kind) {
        this.assertTaskAdmissionOpen(kind);
        const controller = new AbortController();
        const admission = {
            kind,
            controller,
            deadlineAt: Date.now() + this.taskAdmissionTimeoutMs,
            timeoutMs: this.taskAdmissionTimeoutMs,
            timeoutHandle: undefined,
            released: false,
        };
        admission.timeoutHandle = setTimeout(() => {
            if (admission.released || admission.controller.signal.aborted)
                return;
            admission.controller.abort(new BackgroundTaskAdmissionTimeoutError(admission.kind, admission.timeoutMs));
        }, admission.timeoutMs);
        this.activeTaskAdmissions.add(admission);
        return admission;
    }
    releaseTaskAdmission(admission) {
        if (admission.released)
            return;
        admission.released = true;
        if (admission.timeoutHandle !== undefined) {
            clearTimeout(admission.timeoutHandle);
            admission.timeoutHandle = undefined;
        }
        this.activeTaskAdmissions.delete(admission);
        if (this.activeTaskAdmissions.size !== 0)
            return;
        for (const resolve of this.taskAdmissionDrainWaiters)
            resolve();
        this.taskAdmissionDrainWaiters.clear();
    }
    taskAdmissionError(admission) {
        const reason = admission.controller.signal.reason;
        if (reason instanceof Error)
            return reason;
        if (this.shuttingDown || this.taskAdmissionsClosed) {
            return new BackgroundTaskAdmissionClosedError(admission.kind);
        }
        return new BackgroundTaskAdmissionTimeoutError(admission.kind, admission.timeoutMs);
    }
    surfacedTaskAdmissionError(admission, ...details) {
        const primary = this.taskAdmissionError(admission);
        const meaningful = details.filter((detail) => {
            if (detail === undefined || detail === primary)
                return false;
            if (typeof detail !== 'object' || detail === null)
                return true;
            return (Reflect.get(detail, 'name') !== 'AbortError' &&
                Reflect.get(detail, 'code') !== Reflect.get(primary, 'code'));
        });
        if (meaningful.length === 0)
            return primary;
        return new AggregateError([primary, ...meaningful], `${primary.message}; admission cancellation or cleanup reported additional failures: ${meaningful.map(BackgroundTaskRegistry.errorMessage).join('; ')}`);
    }
    assertTaskAdmissionOpen(kind, admission) {
        if (admission?.controller.signal.aborted === true)
            throw this.taskAdmissionError(admission);
        if (this.shuttingDown || this.taskAdmissionsClosed) {
            throw new BackgroundTaskAdmissionClosedError(kind);
        }
    }
    async awaitTaskAdmissionBoundary(promise, admission) {
        try {
            const value = await promise;
            this.assertTaskAdmissionOpen(admission.kind, admission);
            return value;
        }
        catch (error) {
            if (admission.controller.signal.aborted && typeof error === 'object' && error !== null) {
                const isPlainAbort = Reflect.get(error, 'name') === 'AbortError';
                const isCleanDurableCancellation = Reflect.get(error, 'code') === 'durable_file_cancelled' &&
                    Reflect.get(error, 'renameCompleted') !== true &&
                    Array.isArray(Reflect.get(error, 'cleanupFailures')) &&
                    Reflect.get(error, 'cleanupFailures').length === 0;
                if (isPlainAbort || isCleanDurableCancellation) {
                    throw this.taskAdmissionError(admission);
                }
            }
            throw error;
        }
    }
    closeTaskAdmissions() {
        if (this.taskAdmissionsClosed)
            return;
        this.taskAdmissionsClosed = true;
        for (const admission of this.activeTaskAdmissions) {
            if (!admission.controller.signal.aborted) {
                admission.controller.abort(new BackgroundTaskAdmissionClosedError(admission.kind));
            }
        }
    }
    waitForTaskAdmissions() {
        if (this.activeTaskAdmissions.size === 0)
            return Promise.resolve();
        return new Promise((resolve) => {
            this.taskAdmissionDrainWaiters.add(resolve);
        });
    }
    setShuttingDown(value) {
        if (value) {
            this.shuttingDown = true;
            this.closeTaskAdmissions();
            this.closeTerminalPublication('registry_shutdown');
            return;
        }
        // Publication and admission closure belong to one extension activation and
        // are one-way. Pi session replacement creates a fresh registry; an old
        // registry must not be reopened by a late lifecycle continuation.
        if (!this.terminalPublicationClosed && !this.taskAdmissionsClosed)
            this.shuttingDown = false;
    }
    closeTerminalPublication(reason) {
        if (!this.terminalPublicationClosed) {
            this.terminalPublicationClosed = true;
            this.terminalPublicationCloseReason = reason;
            this.resolveTerminalPublicationClosedSignal(reason);
        }
        const effectiveReason = this.terminalPublicationCloseReason ?? reason;
        for (const task of this.tasks.values()) {
            if (task.terminalPublicationState === 'pending' && task.terminalEmitInFlight === true) {
                // A synchronous listener can close the service while emit() is still on
                // the stack. Dispose queued work now, but let the emitter's return/throw
                // settle the in-flight attempt exactly once.
                if (task.terminalPublishRetryHandle !== undefined) {
                    clearTimeout(task.terminalPublishRetryHandle);
                    task.terminalPublishRetryHandle = undefined;
                }
                task.terminalPublicationGate = undefined;
                continue;
            }
            const shouldLog = task.terminalPublicationState === 'pending' &&
                task.status !== 'running' &&
                (task.terminalPublishAttempts > 0 ||
                    task.terminalPublishRetryHandle !== undefined ||
                    task.terminalPublicationGate !== undefined);
            this.abandonTerminalPublication(task, effectiveReason, undefined, shouldLog);
        }
        this.pruneOldTasks();
    }
    allTasks() {
        return [...this.tasks.values()];
    }
    snapshot(task) {
        return snapshot(task);
    }
    hasCurrentReloadLease() {
        const lease = this.reloadShellLease;
        return lease !== undefined && this.reloadShellOwner?.isCurrentLease(lease) === true;
    }
    async stageReloadActivation(claim) {
        if (claim.protocol !== RELOAD_SHELL_OWNER_PROTOCOL) {
            throw new ReloadSurvivalError('pi_bg_reload_owner_protocol_incompatible', 'activation claim does not use the supported reload shell owner protocol');
        }
        const staged = [];
        const ids = new Set();
        for (const execution of claim.executions) {
            if (execution.protocol !== RELOAD_SHELL_OWNER_PROTOCOL ||
                execution.task.reloadExecution !== execution ||
                execution.task.surviveReload !== true) {
                throw new ReloadSurvivalError('pi_bg_reload_owner_protocol_incompatible', 'activation claim contains an incompatible reload shell execution');
            }
            if (ids.has(execution.task.id) || this.tasks.has(execution.task.id)) {
                throw new ReloadSurvivalError('pi_bg_reload_owner_activation_conflict', `claimed task id ${execution.task.id} conflicts with the fresh registry`);
            }
            ids.add(execution.task.id);
        }
        try {
            for (const execution of claim.executions) {
                const task = execution.task;
                task.reloadHostDeliveryInFlight = false;
                task.reloadHostDeliverySettled = false;
                task.reloadHostNotificationSettled = false;
                execution.updateLeaseAudit(claim.generation, (task.reloadSurvival?.handoffCount ?? 0) + 1);
                this.tasks.set(task.id, task);
                staged.push(execution);
            }
            await Promise.all(staged.map(async (execution) => this.writeMetadata(execution.task)));
        }
        catch (error) {
            for (const execution of staged)
                this.tasks.delete(execution.task.id);
            throw error;
        }
        let boundLease;
        return {
            activationNonce: claim.activationNonce,
            onBound: (lease) => {
                if (lease.activationNonce !== claim.activationNonce ||
                    lease.generation !== claim.generation ||
                    lease.identityKey !== claim.identityKey) {
                    throw new ReloadSurvivalError('pi_bg_reload_owner_stale_claim', 'committed lease does not match its staged activation claim');
                }
                boundLease = lease;
                this.reloadShellLease = lease;
                this.reloadShellIdentity = claim.identity;
            },
            onChanged: (execution) => {
                const lease = boundLease;
                if (!this.ownsReloadExecution(execution, lease))
                    return;
                this.onChange();
            },
            onTerminal: (execution) => {
                const lease = boundLease;
                if (!this.ownsReloadExecution(execution, lease))
                    return;
                void this.deliverReloadTerminal(execution, lease);
            },
        };
    }
    abortReloadActivation(claim) {
        for (const execution of claim.executions) {
            const task = execution.task;
            if (this.tasks.get(task.id) !== task)
                continue;
            if (task.terminalPublishRetryHandle !== undefined) {
                clearTimeout(task.terminalPublishRetryHandle);
                task.terminalPublishRetryHandle = undefined;
            }
            task.terminalPublicationGate = undefined;
            task.terminalPublishInFlight = false;
            this.tasks.delete(task.id);
        }
        if (this.reloadShellLease?.activationNonce === claim.activationNonce) {
            this.reloadShellLease = undefined;
            this.reloadShellIdentity = undefined;
        }
    }
    prepareReloadHandoff(lease) {
        if (this.reloadShellOwner === undefined || this.reloadShellLease !== lease) {
            throw new ReloadSurvivalError('pi_bg_reload_owner_stale_claim', 'registry does not own the requested reload activation lease');
        }
        const executions = this.reloadShellOwner.beginReloadHandoff(lease);
        const tasks = [];
        for (const execution of executions) {
            const task = execution.task;
            if (this.tasks.get(task.id) !== task) {
                throw new ReloadSurvivalError('pi_bg_reload_owner_stale_claim', `registry no longer owns survivor ${task.id}`);
            }
            if (task.terminalPublishRetryHandle !== undefined) {
                clearTimeout(task.terminalPublishRetryHandle);
                task.terminalPublishRetryHandle = undefined;
            }
            task.terminalPublicationGate = undefined;
            task.terminalPublishInFlight = false;
            task.reloadHostDeliveryInFlight = false;
            task.reloadHostDeliverySettled = false;
            task.reloadHostNotificationSettled = false;
            this.tasks.delete(task.id);
            tasks.push(task);
        }
        this.reloadShellLease = undefined;
        this.reloadShellIdentity = undefined;
        return Object.freeze(tasks);
    }
    async waitForReloadHostSettlement(timeoutMs = this.stopWaitMs) {
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const unsettled = [...this.tasks.values()].filter((task) => task.reloadExecution?.phase === 'terminal' &&
                (task.reloadHostNotificationSettled !== true ||
                    task.terminalPublicationState === 'pending'));
            if (unsettled.length === 0)
                return;
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Error(`Timed out waiting for reload shell host settlement: ${unsettled.map((task) => task.id).join(', ')}`);
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(10, remaining)));
        }
    }
    releaseReloadActivation(lease) {
        if (this.reloadShellOwner === undefined)
            return;
        if (this.reloadShellLease !== lease || !this.reloadShellOwner.isCurrentLease(lease))
            return;
        this.reloadShellOwner.releaseActivation(lease);
        this.reloadShellLease = undefined;
        this.reloadShellIdentity = undefined;
    }
    currentReloadLease() {
        return this.hasCurrentReloadLease() ? this.reloadShellLease : undefined;
    }
    ownsReloadExecution(execution, lease) {
        return (lease !== undefined &&
            this.reloadShellLease === lease &&
            this.reloadShellOwner?.isCurrentLease(lease) === true &&
            this.tasks.get(execution.task.id) === execution.task &&
            execution.task.reloadExecution === execution);
    }
    async ensureRuntimeDir(ctx) {
        if (this.runtimeDir)
            return this.runtimeDir;
        const sessionId = sanitizePathSegment(ctx.sessionId ?? `session-${String(process.pid)}`);
        const runId = `${sessionId}-${String(process.pid)}`;
        const runtimeDirAbs = join(ctx.cwd, '.pi', 'tasks', runId);
        const runtimeDirDisplay = join('.pi', 'tasks', runId);
        await mkdir(runtimeDirAbs, { recursive: true });
        this.runtimeDir = { abs: runtimeDirAbs, display: runtimeDirDisplay };
        return this.runtimeDir;
    }
    async destroyTaskStream(task) {
        const stream = task.stream;
        if (stream === undefined || stream.closed)
            return;
        await new Promise((resolve) => {
            const closed = () => {
                stream.off('close', closed);
                resolve();
            };
            stream.once('close', closed);
            if (!stream.destroyed)
                stream.destroy();
            if (stream.closed)
                closed();
        });
    }
    async discardUnspawnedTask(task, paths) {
        this.tasks.delete(task.id);
        task.finalized = true;
        task.status = 'failed';
        if (task.timeoutHandle !== undefined)
            clearTimeout(task.timeoutHandle);
        if (task.killEscalationTimer !== undefined)
            clearTimeout(task.killEscalationTimer);
        await this.destroyTaskStream(task);
        const removals = await Promise.allSettled(paths.map((path) => rm(path, { force: true })));
        const failures = [];
        for (let index = 0; index < removals.length; index++) {
            const result = removals[index];
            if (result?.status !== 'rejected')
                continue;
            const path = paths[index] ?? '<unknown admission artifact>';
            failures.push(new Error(`Failed to remove interrupted admission artifact ${path}: ${BackgroundTaskRegistry.errorMessage(result.reason)}`));
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, 'Interrupted task admission artifact cleanup failed');
        }
    }
    attestedGitOptions(admission) {
        return {
            signal: admission?.controller.signal,
            deadlineAt: admission?.deadlineAt ?? Date.now() + this.taskAdmissionTimeoutMs,
            killProcess: this.killProcess,
            killTree: this.killTree,
            platform: this.platform,
            env: this.env,
            killGraceMs: this.attestedGitKillGraceMs,
            maxOutputBytes: this.attestedGitMaxOutputBytes,
            ...(this.attestedGitSpawn === undefined ? {} : { spawn: this.attestedGitSpawn }),
        };
    }
    captureSpawnedChild(task, child) {
        task.child = child;
        task.pid = child.pid;
        if (this.platform !== 'win32' &&
            child.pid !== undefined &&
            Number.isSafeInteger(child.pid) &&
            child.pid > 0) {
            // Capture detached-group ownership once, directly from this spawn. Never
            // reconstruct signal authority from mutable task metadata or a later PID.
            task.ownedPosixProcessGroupId = child.pid;
        }
    }
    bindOwnedTaskToAdmission(task, admission) {
        const cancelOwnedTask = () => {
            this.stopOwnedTaskAfterAdmissionCancellation(task, this.taskAdmissionError(admission));
        };
        admission.controller.signal.addEventListener('abort', cancelOwnedTask, { once: true });
        if (admission.controller.signal.aborted)
            cancelOwnedTask();
        return () => {
            admission.controller.signal.removeEventListener('abort', cancelOwnedTask);
        };
    }
    stopOwnedTaskAfterAdmissionCancellation(task, error) {
        if (task.status !== 'running')
            return;
        task.killKind = error instanceof BackgroundTaskAdmissionTimeoutError ? 'timeout' : 'shutdown';
        task.error = error.message;
        try {
            this.requestKill(task, 'SIGTERM');
        }
        catch (killError) {
            this.logger.error(`[background-tasks] failed to stop ${task.id} after admission cancellation:`, killError);
        }
    }
    async startTask(ctx, command, options = {}) {
        const hasSurvival = Object.prototype.hasOwnProperty.call(options, 'surviveReload');
        if (hasSurvival && typeof options.surviveReload !== 'boolean') {
            throw new ReloadSurvivalError('pi_bg_survive_reload_invalid', 'surviveReload must be a boolean when present');
        }
        const surviveReload = options.surviveReload === true;
        if (surviveReload && options.isAgent === true) {
            throw new ReloadSurvivalError('pi_bg_survive_reload_requires_non_agent', 'surviveReload requires isAgent:false');
        }
        const reloadLease = surviveReload ? this.currentReloadLease() : undefined;
        if (surviveReload && reloadLease === undefined) {
            throw new ReloadSurvivalError('pi_bg_reload_owner_unavailable', 'no successfully bound same-process reload owner activation is available');
        }
        const admission = this.beginTaskAdmission('a background task');
        try {
            if (surviveReload && reloadLease !== undefined) {
                return await this.startReloadableTaskAdmitted(ctx, command, options, admission, reloadLease);
            }
            return await this.startTaskAdmitted(ctx, command, options, admission);
        }
        finally {
            this.releaseTaskAdmission(admission);
        }
    }
    async startReloadableTaskAdmitted(ctx, command, options, admission, lease) {
        const normalizedCommand = command.trim();
        if (!normalizedCommand)
            throw new Error('Background command is empty');
        if (options.isAgent === true) {
            throw new ReloadSurvivalError('pi_bg_survive_reload_requires_non_agent', 'surviveReload requires isAgent:false');
        }
        if (this.reloadShellOwner === undefined ||
            this.reloadShellIdentity === undefined ||
            this.reloadShellLease !== lease ||
            !this.reloadShellOwner.isCurrentLease(lease)) {
            throw new ReloadSurvivalError('pi_bg_reload_owner_unavailable', 'reload owner activation became unavailable before launch');
        }
        if (ctx.sessionId !== this.reloadShellIdentity.sessionId) {
            throw new ReloadSurvivalError('pi_bg_reload_owner_stale_claim', 'launch context session id does not match the bound reload owner identity');
        }
        this.assertTaskAdmissionOpen('a background task', admission);
        const shellPolicy = this.resolvedShellPolicy();
        const invocation = shellInvocationForPolicy(normalizedCommand, shellPolicy);
        const dir = await this.awaitTaskAdmissionBoundary(this.ensureRuntimeDir(ctx), admission);
        this.assertTaskAdmissionOpen('a background task', admission);
        if (this.reloadShellLease !== lease || !this.reloadShellOwner.isCurrentLease(lease)) {
            throw new ReloadSurvivalError('pi_bg_reload_owner_stale_claim', 'reload owner activation changed during task preflight');
        }
        const id = this.makeTaskIdFn();
        const outputAbsPath = join(dir.abs, `${id}.output`);
        const metadataAbsPath = join(dir.abs, `${id}.json`);
        const outputPath = join(dir.display, `${id}.output`);
        const timeoutSeconds = typeof options.timeoutSeconds === 'number' &&
            Number.isFinite(options.timeoutSeconds) &&
            options.timeoutSeconds > 0
            ? Math.floor(options.timeoutSeconds)
            : undefined;
        const taskName = normalizeTaskName(options.name) ??
            normalizeTaskName(options.description) ??
            deriveTaskNameFromCommand(normalizedCommand);
        const trimmedDescription = options.description?.trim();
        const description = trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : undefined;
        const task = {
            id,
            name: taskName,
            command: normalizedCommand,
            description,
            status: 'running',
            outputPath,
            outputAbsPath,
            metadataAbsPath,
            cwd: ctx.cwd,
            startTime: this.now(),
            exitCode: undefined,
            pid: undefined,
            bytesWritten: 0,
            isAgent: false,
            surviveReload: true,
            notified: false,
            notifyOnCompletion: options.notifyOnCompletion ?? true,
            triggerOnCompletion: options.triggerOnCompletion ?? false,
            timeoutSeconds,
            terminalPublished: false,
            terminalPublicationState: 'pending',
            terminalPublishAttempts: 0,
            terminalPublicationGate: options.terminalPublicationGate,
            shellPolicy: shellPolicySnapshot(shellPolicy),
            waiters: [],
        };
        const launchNonce = randomBytes(16).toString('hex');
        this.assertTaskAdmissionOpen('a background task', admission);
        this.tasks.set(id, task);
        let execution;
        let registered = false;
        let committed = false;
        let abortListener;
        try {
            execution = createReloadableShellExecutionV1({
                task,
                identity: this.reloadShellIdentity,
                lease,
                launchNonce,
                invocation,
                spawn: this.spawn,
                killProcess: this.killProcess,
                killTree: this.killTree,
                platform: this.platform,
                env: this.env,
                maxOutputBytes: this.maxOutputBytes,
                killGraceMs: this.killGraceMs,
                stopWaitMs: this.stopWaitMs,
                now: this.now,
                logger: this.logger,
            });
            this.reloadShellOwner.registerExecution(lease, execution);
            registered = true;
            abortListener = () => {
                if (execution === undefined)
                    return;
                const error = this.taskAdmissionError(admission);
                execution.failAdmission(error);
                const kind = error instanceof BackgroundTaskAdmissionTimeoutError ? 'timeout' : 'shutdown';
                void execution.requestStop(kind, error.message).catch((stopError) => {
                    this.logger.error(`[background-tasks] failed to stop reloadable task ${task.id} after admission cancellation:`, stopError);
                });
            };
            admission.controller.signal.addEventListener('abort', abortListener, { once: true });
            if (admission.controller.signal.aborted)
                abortListener();
            await this.awaitTaskAdmissionBoundary(execution.commitInitialMetadata(admission.controller.signal), admission);
            this.assertTaskAdmissionOpen('a background task', admission);
            if (this.reloadShellLease !== lease || !this.reloadShellOwner.isCurrentLease(lease)) {
                throw new ReloadSurvivalError('pi_bg_reload_owner_stale_claim', 'reload owner activation changed before admission commit');
            }
            this.reloadShellOwner.markAdmissionCommitted(lease, execution);
            committed = true;
            this.onChange();
            return task;
        }
        catch (error) {
            const primary = admission.controller.signal.aborted
                ? this.taskAdmissionError(admission)
                : error instanceof Error
                    ? error
                    : new Error(String(error));
            execution?.failAdmission(primary);
            let cleanupError;
            if (execution !== undefined) {
                try {
                    if (task.status === 'running') {
                        await execution.requestStop(admission.controller.signal.aborted &&
                            primary instanceof BackgroundTaskAdmissionTimeoutError
                            ? 'timeout'
                            : 'shutdown', primary.message);
                    }
                }
                catch (stopError) {
                    cleanupError = stopError;
                }
            }
            if (registered && !committed && execution !== undefined) {
                if (this.reloadShellOwner.isCurrentLease(lease)) {
                    this.reloadShellOwner.releaseExecution(lease, execution);
                }
            }
            this.tasks.delete(task.id);
            if (execution === undefined) {
                const removals = await Promise.allSettled([
                    rm(outputAbsPath, { force: true }),
                    rm(metadataAbsPath, { force: true }),
                ]);
                const removalFailure = removals.find((result) => result.status === 'rejected');
                if (removalFailure?.status === 'rejected')
                    cleanupError = removalFailure.reason;
            }
            if (admission.controller.signal.aborted) {
                throw this.surfacedTaskAdmissionError(admission, error, cleanupError);
            }
            if (cleanupError !== undefined) {
                throw new AggregateError([primary, cleanupError], `Failed to start reloadable background task and cleanup also failed: ${BackgroundTaskRegistry.errorMessage(cleanupError)}`);
            }
            throw new Error(`Failed to start background task: ${primary.message}`);
        }
        finally {
            if (abortListener !== undefined) {
                admission.controller.signal.removeEventListener('abort', abortListener);
            }
        }
    }
    async startTaskAdmitted(ctx, command, options, admission) {
        const normalizedCommand = command.trim();
        if (!normalizedCommand)
            throw new Error('Background command is empty');
        this.assertTaskAdmissionOpen('a background task', admission);
        const isAgent = options.isAgent ?? false;
        const shellPolicy = this.resolvedShellPolicy();
        const baseInvocation = shellInvocationForPolicy(normalizedCommand, shellPolicy);
        const piTelemetryRequested = isAgent && commandMayLaunchPiAgent(normalizedCommand, this.env);
        const piTelemetryLaunch = piTelemetryRequested && shellPolicy.supportsPosixFunctionWrapper
            ? resolvePiLaunch({ platform: this.platform })
            : undefined;
        const dir = await this.awaitTaskAdmissionBoundary(this.ensureRuntimeDir(ctx), admission);
        this.assertTaskAdmissionOpen('a background task', admission);
        const id = this.makeTaskIdFn();
        const outputAbsPath = join(dir.abs, `${id}.output`);
        const metadataAbsPath = join(dir.abs, `${id}.json`);
        const outputPath = join(dir.display, `${id}.output`);
        let commandToSpawn = normalizedCommand;
        let wrapperAbsPath;
        try {
            if (piTelemetryRequested && shellPolicy.supportsPosixFunctionWrapper) {
                if (piTelemetryLaunch === undefined)
                    throw new Error('Pi telemetry launch spec was not resolved');
                wrapperAbsPath = join(dir.abs, `${id}.pi-telemetry-wrapper.cjs`);
                try {
                    await writeFile(wrapperAbsPath, createPiTelemetryWrapperSource(buildModelWindowIndex(ctx), piTelemetryLaunch), { encoding: 'utf8', signal: admission.controller.signal });
                }
                catch (error) {
                    if (admission.controller.signal.aborted)
                        throw this.taskAdmissionError(admission);
                    throw error;
                }
                this.assertTaskAdmissionOpen('a background task', admission);
                commandToSpawn = `pi() { ${shellQuote(process.execPath)} ${shellQuote(wrapperAbsPath)} "$@"; }\n${normalizedCommand}`;
            }
        }
        catch (error) {
            if (wrapperAbsPath !== undefined)
                await rm(wrapperAbsPath, { force: true });
            throw error;
        }
        const invocation = commandToSpawn === normalizedCommand
            ? baseInvocation
            : shellInvocationForPolicy(commandToSpawn, shellPolicy);
        const timeoutSeconds = typeof options.timeoutSeconds === 'number' &&
            Number.isFinite(options.timeoutSeconds) &&
            options.timeoutSeconds > 0
            ? Math.floor(options.timeoutSeconds)
            : undefined;
        const taskName = normalizeTaskName(options.name) ??
            normalizeTaskName(options.description) ??
            deriveTaskNameFromCommand(normalizedCommand);
        const trimmedDescription = options.description?.trim();
        const description = trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : undefined;
        const task = {
            id,
            name: taskName,
            command: normalizedCommand,
            description,
            status: 'running',
            outputPath,
            outputAbsPath,
            metadataAbsPath,
            cwd: ctx.cwd,
            startTime: this.now(),
            exitCode: undefined,
            pid: undefined,
            bytesWritten: 0,
            isAgent,
            surviveReload: false,
            notified: false,
            notifyOnCompletion: options.notifyOnCompletion ?? true,
            triggerOnCompletion: options.triggerOnCompletion ?? false,
            timeoutSeconds,
            terminalPublished: false,
            terminalPublicationState: 'pending',
            terminalPublishAttempts: 0,
            terminalPublicationGate: options.terminalPublicationGate,
            shellPolicy: shellPolicySnapshot(shellPolicy),
            waiters: [],
        };
        if (commandToSpawn !== normalizedCommand)
            task.telemetryWrapped = true;
        if (piTelemetryRequested && !shellPolicy.supportsPosixFunctionWrapper) {
            task.telemetryUnavailableReason =
                shellPolicy.dialect === 'cmd'
                    ? WIN32_CMD_PI_TELEMETRY_UNAVAILABLE_REASON
                    : NON_POSIX_SHELL_PI_TELEMETRY_UNAVAILABLE_REASON;
        }
        this.assertTaskAdmissionOpen('a background task', admission);
        this.tasks.set(id, task);
        const stream = createWriteStream(outputAbsPath, { flags: 'a', encoding: 'utf8' });
        task.stream = stream;
        stream.on('error', (error) => {
            task.error = `Output file write failed: ${error.message}`;
            if (task.status === 'running') {
                task.killKind = 'output_cap';
                try {
                    this.requestKill(task, 'SIGTERM');
                }
                catch (killError) {
                    void this.finalizeTask(task, 'failed', null, undefined, `${task.error}; kill failed: ${killError instanceof Error ? killError.message : String(killError)}`);
                }
            }
        });
        let unbindAdmissionCancellation = () => undefined;
        try {
            this.assertTaskAdmissionOpen('a background task', admission);
            const child = this.spawn(invocation.shell, invocation.args, {
                cwd: ctx.cwd,
                detached: this.platform !== 'win32',
                stdio: ['ignore', 'pipe', 'pipe'],
                env: this.env,
                windowsHide: true,
                windowsVerbatimArguments: invocation.windowsVerbatimArguments,
            });
            this.captureSpawnedChild(task, child);
            child.stdout?.on('data', (data) => {
                this.appendChildOutput(task, data, 'stdout');
            });
            child.stderr?.on('data', (data) => {
                this.appendChildOutput(task, data, 'stderr');
            });
            child.on('error', (error) => {
                this.writeNotice(task, `\n[background task spawn error: ${error.message}]\n`);
                void this.finalizeTask(task, 'failed', null, undefined, error.message);
            });
            child.on('close', (code, signalName) => {
                let status;
                let error;
                if (task.killKind === 'user' || task.killKind === 'shutdown') {
                    status = 'killed';
                }
                else if (task.killKind === 'timeout') {
                    status = 'failed';
                    error = task.error ?? `Timed out after ${String(timeoutSeconds)}s`;
                }
                else if (task.killKind === 'output_cap') {
                    status = 'failed';
                    error = task.error ?? `Output exceeded cap of ${formatSize(this.maxOutputBytes)}`;
                }
                else if ((code ?? 0) === 0) {
                    status = 'completed';
                }
                else {
                    status = 'failed';
                    const exitCode = code === null ? 'null' : String(code);
                    error = `Exited with code ${exitCode}${signalName ? ` (${signalName})` : ''}`;
                }
                void this.finalizeTask(task, status, code, signalName, error);
            });
            if (timeoutSeconds !== undefined) {
                task.timeoutHandle = setTimeout(() => {
                    if (task.status !== 'running')
                        return;
                    task.killKind = 'timeout';
                    task.error = `Timed out after ${String(timeoutSeconds)}s`;
                    this.writeNotice(task, `\n[background task timeout: ${task.error}]\n`);
                    try {
                        this.requestKill(task, 'SIGTERM');
                    }
                    catch (error) {
                        void this.finalizeTask(task, 'failed', null, undefined, `${task.error}; kill failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }, timeoutSeconds * 1000);
            }
            unbindAdmissionCancellation = this.bindOwnedTaskToAdmission(task, admission);
            await this.awaitTaskAdmissionBoundary(this.writeMetadata(task, admission.controller.signal), admission);
            this.assertTaskAdmissionOpen('a background task', admission);
            this.onChange();
            return task;
        }
        catch (error) {
            if (admission.controller.signal.aborted) {
                const admissionError = this.taskAdmissionError(admission);
                let cleanupError;
                if (task.child === undefined) {
                    try {
                        await this.discardUnspawnedTask(task, [
                            outputAbsPath,
                            metadataAbsPath,
                            ...(wrapperAbsPath === undefined ? [] : [wrapperAbsPath]),
                        ]);
                    }
                    catch (cleanupFailure) {
                        cleanupError = cleanupFailure;
                    }
                }
                else {
                    this.stopOwnedTaskAfterAdmissionCancellation(task, admissionError);
                }
                throw this.surfacedTaskAdmissionError(admission, error, cleanupError);
            }
            const message = error instanceof Error ? error.message : String(error);
            this.writeNotice(task, `\n[background task spawn exception: ${message}]\n`);
            await this.finalizeTask(task, 'failed', null, undefined, message);
            throw new Error(`Failed to start background task: ${message}`);
        }
        finally {
            unbindAdmissionCancellation();
        }
    }
    /**
     * Track an in-process asynchronous workflow through the same durable task,
     * notification, status, log, and cancellation surfaces as child processes.
     * The supplied completion promise must own all workflow cleanup before it
     * settles; terminal publication happens only after that settlement.
     */
    async startManagedTask(ctx, request) {
        rejectSurvivalForTaskKind(request, 'managed background tasks');
        let admission;
        try {
            admission = this.beginTaskAdmission('a managed background task');
            return await this.startManagedTaskAdmitted(ctx, request, admission);
        }
        catch (error) {
            const admissionError = admission?.controller.signal.aborted === true
                ? this.taskAdmissionError(admission)
                : error instanceof BackgroundTaskAdmissionClosedError
                    ? error
                    : undefined;
            if (admissionError !== undefined) {
                const task = admission === undefined ? undefined : this.tasks.get(request.id);
                if (task === undefined) {
                    try {
                        request.cancel();
                    }
                    catch (cancelError) {
                        this.logger.error(`[background-tasks] managed preflight cancellation failed for ${request.id}:`, cancelError);
                    }
                    // The workflow promise owns child/artifact cleanup. Do not release a
                    // pre-insertion admission while that cleanup can still run late.
                    await request.completion.then(() => undefined, () => undefined);
                }
                else {
                    this.stopOwnedTaskAfterAdmissionCancellation(task, admissionError);
                    await request.completion.then(() => undefined, () => undefined);
                }
                if (admission !== undefined) {
                    throw this.surfacedTaskAdmissionError(admission, error);
                }
                throw admissionError;
            }
            throw error;
        }
        finally {
            if (admission !== undefined)
                this.releaseTaskAdmission(admission);
        }
    }
    async startManagedTaskAdmitted(ctx, request, admission) {
        this.assertTaskAdmissionOpen('a managed background task', admission);
        if (!/^[a-zA-Z0-9_.-]+$/u.test(request.id))
            throw new Error(`Managed background task id is invalid: ${request.id}`);
        if (this.tasks.has(request.id))
            throw new Error(`Background task id already exists: ${request.id}`);
        const dir = await this.awaitTaskAdmissionBoundary(this.ensureRuntimeDir(ctx), admission);
        this.assertTaskAdmissionOpen('a managed background task', admission);
        const outputAbsPath = join(dir.abs, `${request.id}.output`);
        const metadataAbsPath = join(dir.abs, `${request.id}.json`);
        const outputPath = join(dir.display, `${request.id}.output`);
        const task = {
            id: request.id,
            name: normalizeTaskName(request.name) ?? 'Managed background task',
            command: request.command,
            description: request.description,
            status: 'running',
            outputPath,
            outputAbsPath,
            metadataAbsPath,
            cwd: ctx.cwd,
            startTime: this.now(),
            exitCode: undefined,
            pid: undefined,
            bytesWritten: 0,
            isAgent: request.isAgent,
            surviveReload: false,
            notified: false,
            notifyOnCompletion: request.notifyOnCompletion,
            triggerOnCompletion: request.triggerOnCompletion,
            fusion: request.fusion,
            managedCancel: request.cancel,
            managedStopWaitMs: request.stopWaitMs,
            terminalPublished: false,
            terminalPublicationState: 'pending',
            terminalPublishAttempts: 0,
            terminalPublicationGate: request.terminalPublicationGate,
            waiters: [],
        };
        this.assertTaskAdmissionOpen('a managed background task', admission);
        this.tasks.set(task.id, task);
        const stream = createWriteStream(outputAbsPath, { flags: 'a', encoding: 'utf8' });
        task.stream = stream;
        stream.on('error', (error) => {
            task.error = `Output file write failed: ${error.message}`;
            if (task.status === 'running' && !task.managedCancelRequested) {
                task.managedCancelRequested = true;
                try {
                    request.cancel();
                }
                catch (cancelError) {
                    task.error = `${task.error}; cancellation failed: ${BackgroundTaskRegistry.errorMessage(cancelError)}`;
                }
            }
        });
        const unbindAdmissionCancellation = this.bindOwnedTaskToAdmission(task, admission);
        let completionAttached = false;
        const attachCompletion = () => {
            if (completionAttached)
                return;
            completionAttached = true;
            void request.completion
                .then(() => {
                const killed = task.killKind === 'user' || task.killKind === 'shutdown';
                const timedOut = task.killKind === 'timeout';
                return this.finalizeTask(task, killed ? 'killed' : timedOut ? 'failed' : 'completed', killed || timedOut ? null : 0, undefined, timedOut ? task.error : undefined);
            }, (error) => {
                const message = BackgroundTaskRegistry.errorMessage(error);
                const killed = task.killKind === 'user' || task.killKind === 'shutdown';
                return this.finalizeTask(task, killed ? 'killed' : 'failed', null, undefined, message);
            })
                .catch((error) => {
                this.logger.error(`[background-tasks] managed task finalization failed for ${task.id}:`, error);
            });
        };
        try {
            await this.awaitTaskAdmissionBoundary(this.writeMetadata(task, admission.controller.signal), admission);
            attachCompletion();
            this.assertTaskAdmissionOpen('a managed background task', admission);
            this.onChange();
        }
        catch (error) {
            if (admission.controller.signal.aborted) {
                attachCompletion();
                throw this.surfacedTaskAdmissionError(admission, error);
            }
            this.tasks.delete(task.id);
            await this.destroyTaskStream(task);
            try {
                request.cancel();
            }
            catch (cancelError) {
                this.logger.error(`[background-tasks] managed task cancellation after metadata failure also failed for ${task.id}:`, cancelError);
            }
            await request.completion.then(() => undefined, () => undefined);
            throw new Error(`Failed to register managed background task: ${BackgroundTaskRegistry.errorMessage(error)}`);
        }
        finally {
            unbindAdmissionCancellation();
        }
        return task;
    }
    async updateManagedTask(task, state, line) {
        if (task.status !== 'running' || task.fusion === undefined)
            return;
        task.fusion.state = state;
        if (line !== undefined && line.length > 0)
            this.writeNotice(task, `${line}\n`);
        await this.writeMetadata(task);
        this.onChange();
    }
    /** Claim deferred Fusion usage exactly once before returning it from bg_result. */
    async claimFusionUsage(task) {
        if (task.fusion === undefined)
            throw new Error(`Task ${task.id} is not a Fusion task`);
        let claimed = false;
        const write = async () => {
            if (!task.fusion || task.fusion.usageDelivered)
                return;
            task.fusion.usageDelivered = true;
            await writeJsonAtomic(task.metadataAbsPath, snapshot(task));
            claimed = true;
        };
        const previous = task.metadataWriteChain ?? Promise.resolve();
        const next = previous.then(write, write);
        task.metadataWriteChain = next.catch(() => undefined);
        await next;
        return claimed;
    }
    /**
     * Start a prepared delegate child.
     *
     * The caller has already completed preflight, so by the time this runs the
     * seed, budget plan, and artifact directory exist and the argv is fixed. The
     * child is launched directly, never through a shell, and its terminal state
     * flows through the same durable notification path as `bg_run`.
     */
    async startDelegateTask(ctx, request) {
        rejectSurvivalForTaskKind(request, 'delegate tasks');
        const admission = this.beginTaskAdmission('a delegate task');
        try {
            return await this.startDelegateTaskAdmitted(ctx, request, admission);
        }
        finally {
            this.releaseTaskAdmission(admission);
        }
    }
    async startDelegateTaskAdmitted(ctx, request, admission) {
        this.assertTaskAdmissionOpen('a delegate task', admission);
        const launch = resolvePiLaunch({ platform: this.platform });
        assertWindowsCommandLineWithinLimit(launch, request.argv, this.platform, 'bg-delegate');
        const dir = await this.awaitTaskAdmissionBoundary(this.ensureRuntimeDir(ctx), admission);
        this.assertTaskAdmissionOpen('a delegate task', admission);
        const id = request.facts.taskId;
        const outputAbsPath = join(dir.abs, `${id}.output`);
        const metadataAbsPath = join(dir.abs, `${id}.json`);
        const outputPath = join(dir.display, `${id}.output`);
        const task = {
            id,
            name: normalizeTaskName(request.name) ?? 'Delegate task',
            command: ['pi', ...request.argv].map(shellQuote).join(' '),
            status: 'running',
            outputPath,
            outputAbsPath,
            metadataAbsPath,
            cwd: ctx.cwd,
            startTime: this.now(),
            exitCode: undefined,
            pid: undefined,
            bytesWritten: 0,
            isAgent: true,
            surviveReload: false,
            notified: false,
            notifyOnCompletion: request.notifyOnCompletion,
            triggerOnCompletion: request.triggerOnCompletion,
            timeoutSeconds: request.timeoutSeconds,
            model: request.facts.route.qualifiedId,
            delegate: request.facts,
            terminalPublished: false,
            terminalPublicationState: 'pending',
            terminalPublishAttempts: 0,
            waiters: [],
        };
        this.assertTaskAdmissionOpen('a delegate task', admission);
        this.tasks.set(id, task);
        const stream = createWriteStream(outputAbsPath, { flags: 'a', encoding: 'utf8' });
        task.stream = stream;
        stream.on('error', (error) => {
            task.error = `Output file write failed: ${error.message}`;
        });
        let unbindAdmissionCancellation = () => undefined;
        try {
            this.assertTaskAdmissionOpen('a delegate task', admission);
            const child = this.spawn(launch.executable, piLaunchArgv(launch, [...request.argv]), {
                cwd: ctx.cwd,
                detached: this.platform !== 'win32',
                shell: false,
                // The seed travels over stdin, never as a shell or positional argument,
                // so the bytes the child reads are exactly the bytes that were persisted
                // and hashed, with no quoting or command-line length limit in the path.
                stdio: ['pipe', 'pipe', 'pipe'],
                env: request.env,
                windowsHide: true,
            });
            this.captureSpawnedChild(task, child);
            child.stdout?.on('data', (data) => {
                this.appendChildOutput(task, data, 'stdout');
            });
            child.stderr?.on('data', (data) => {
                this.appendChildOutput(task, data, 'stderr');
            });
            child.on('error', (error) => {
                this.writeNotice(task, `\n[delegate spawn error: ${error.message}]\n`);
                void this.finalizeTask(task, 'failed', null, undefined, error.message);
            });
            child.on('close', (code, signalName) => {
                let status;
                let error;
                if (task.killKind === 'user' || task.killKind === 'shutdown') {
                    status = 'killed';
                }
                else if (task.killKind === 'timeout') {
                    status = 'failed';
                    error = task.error ?? `Timed out after ${String(request.timeoutSeconds ?? 0)}s`;
                }
                else if ((code ?? 0) === 0) {
                    status = 'completed';
                }
                else {
                    status = 'failed';
                    error = `Exited with code ${code === null ? 'null' : String(code)}${signalName ? ` (${signalName})` : ''}`;
                }
                void this.finalizeTask(task, status, code, signalName, error);
            });
            if (request.timeoutSeconds !== undefined) {
                task.timeoutHandle = setTimeout(() => {
                    if (task.status !== 'running')
                        return;
                    task.killKind = 'timeout';
                    task.error = `Timed out after ${String(request.timeoutSeconds)}s`;
                    this.writeNotice(task, `\n[delegate timeout: ${task.error}]\n`);
                    try {
                        this.requestKill(task, 'SIGTERM');
                    }
                    catch (error) {
                        void this.finalizeTask(task, 'failed', null, undefined, `${task.error}; kill failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }, request.timeoutSeconds * 1000);
            }
            unbindAdmissionCancellation = this.bindOwnedTaskToAdmission(task, admission);
            this.assertTaskAdmissionOpen('a delegate task', admission);
            writeDelegateStdin(child, request.stdinBytes, (error) => {
                this.writeNotice(task, `\n[delegate stdin write failed: ${error.message}]\n`);
                if (task.status === 'running') {
                    task.killKind = 'user';
                    task.error = `Delegate seed could not be delivered: ${error.message}`;
                    try {
                        this.requestKill(task, 'SIGTERM');
                    }
                    catch {
                        void this.finalizeTask(task, 'failed', null, undefined, task.error);
                    }
                }
            });
            await this.awaitTaskAdmissionBoundary(this.writeMetadata(task, admission.controller.signal), admission);
            this.assertTaskAdmissionOpen('a delegate task', admission);
            this.onChange();
            return task;
        }
        catch (error) {
            if (admission.controller.signal.aborted) {
                const admissionError = this.taskAdmissionError(admission);
                let cleanupError;
                if (task.child === undefined) {
                    try {
                        await this.discardUnspawnedTask(task, [outputAbsPath, metadataAbsPath]);
                    }
                    catch (cleanupFailure) {
                        cleanupError = cleanupFailure;
                    }
                }
                else {
                    this.stopOwnedTaskAfterAdmissionCancellation(task, admissionError);
                }
                throw this.surfacedTaskAdmissionError(admission, error, cleanupError);
            }
            const message = error instanceof Error ? error.message : String(error);
            this.writeNotice(task, `\n[delegate spawn exception: ${message}]\n`);
            await this.finalizeTask(task, 'failed', null, undefined, message);
            throw new Error(`Failed to start delegate task: ${message}`);
        }
        finally {
            unbindAdmissionCancellation();
        }
    }
    async startAttestedPiTask(ctx, request) {
        rejectSurvivalForTaskKind(request, 'attested Pi tasks');
        const admission = this.beginTaskAdmission('an attested Pi task');
        try {
            return await this.startAttestedPiTaskAdmitted(ctx, request, admission);
        }
        finally {
            this.releaseTaskAdmission(admission);
        }
    }
    async startAttestedPiTaskAdmitted(ctx, request, admission) {
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        const attested = await this.awaitTaskAdmissionBoundary(this.loadAttestedRuntime(), admission);
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        const attributionExtensionPath = request.provider === 'anthropic' ? resolveAnthropicAttributionExtensionPath() : undefined;
        const argv = attested.buildAttestedPiArgv(request, attributionExtensionPath);
        const attestedPiLaunch = resolvePiLaunch({ platform: this.platform });
        assertWindowsCommandLineWithinLimit(attestedPiLaunch, argv.slice(1), this.platform, 'attested-pi-run');
        const dir = await this.awaitTaskAdmissionBoundary(this.ensureRuntimeDir(ctx), admission);
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        const id = attested.makeAttestedTaskId();
        if (!ATTESTED_TASK_ID_PATTERN.test(id))
            throw new Error('Generated attested task id is invalid');
        const paths = attested.makeAttestedTaskPaths(dir.abs, dir.display, id);
        const promptBytes = Buffer.from(request.prompt, 'utf8');
        const reportAbsPath = await this.awaitTaskAdmissionBoundary(attested.resolveReportPath(ctx.cwd, request.reportPath), admission);
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        const auth = attested.observePiOAuth(ctx, request.provider, request.model);
        const gitOptions = this.attestedGitOptions(admission);
        const repoRootRealpath = await attested.gitRepoRoot(ctx.cwd, gitOptions);
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        const cwdRealpath = await this.awaitTaskAdmissionBoundary(realpath(ctx.cwd), admission);
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        const startAuthority = await attested.gitAuthoritySnapshot(ctx.cwd, gitOptions);
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        if (!startAuthority.clean)
            throw new Error('Attested Pi task requires a clean worktree at start');
        const timeoutSeconds = typeof request.timeoutSeconds === 'number' &&
            Number.isFinite(request.timeoutSeconds) &&
            request.timeoutSeconds > 0
            ? Math.floor(request.timeoutSeconds)
            : undefined;
        const task = {
            id,
            name: normalizeTaskName(request.name) ?? 'Attested Pi task',
            command: argv.map(shellQuote).join(' '),
            status: 'running',
            outputPath: paths.outputPath,
            outputAbsPath: paths.outputAbsPath,
            metadataAbsPath: paths.metadataAbsPath,
            eventsAbsPath: paths.eventsAbsPath,
            stderrAbsPath: paths.stderrAbsPath,
            wrapperAbsPath: paths.wrapperAbsPath,
            attestationAbsPath: paths.attestationAbsPath,
            cwd: ctx.cwd,
            startTime: this.now(),
            exitCode: undefined,
            pid: undefined,
            bytesWritten: 0,
            isAgent: true,
            surviveReload: false,
            notified: false,
            notifyOnCompletion: false,
            triggerOnCompletion: false,
            timeoutSeconds,
            attestationPath: paths.attestationPath,
            attestedPi: {
                eventsPath: paths.eventsPath,
                stderrPath: paths.stderrPath,
                wrapperPath: paths.wrapperPath,
                attestationPath: paths.attestationPath,
            },
            terminalPublished: false,
            terminalPublicationState: 'pending',
            terminalPublishAttempts: 0,
            waiters: [],
        };
        const admissionArtifacts = [
            paths.outputAbsPath,
            paths.eventsAbsPath,
            paths.stderrAbsPath,
            paths.wrapperAbsPath,
            paths.metadataAbsPath,
            paths.attestationAbsPath,
        ];
        const admissionSignal = admission.controller.signal;
        try {
            await writeFileFsynced(paths.outputAbsPath, '', admissionSignal);
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
            await writeFileFsynced(paths.eventsAbsPath, '', admissionSignal);
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
            await writeFileFsynced(paths.stderrAbsPath, '', admissionSignal);
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
            await writeFileFsynced(paths.wrapperAbsPath, 'direct-spawn attested Pi task; no shell telemetry wrapper is used\n', admissionSignal);
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
            await this.writeMetadata(task, admissionSignal);
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
        }
        catch (error) {
            let cleanupError;
            try {
                await this.discardUnspawnedTask(task, admissionArtifacts);
            }
            catch (cleanupFailure) {
                cleanupError = cleanupFailure;
            }
            if (admissionSignal.aborted) {
                throw this.surfacedTaskAdmissionError(admission, error, cleanupError);
            }
            if (cleanupError !== undefined) {
                throw new AggregateError([error, cleanupError], `Attested Pi preflight failed and artifact cleanup also failed: ${BackgroundTaskRegistry.errorMessage(cleanupError)}`);
            }
            throw error;
        }
        this.assertTaskAdmissionOpen('an attested Pi task', admission);
        this.tasks.set(id, task);
        let unbindAdmissionCancellation = () => undefined;
        try {
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
            const captured = attested.spawnAndCapturePi(this.spawn, argv, {
                cwd: ctx.cwd,
                detached: this.platform !== 'win32',
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: attested.attestedPiChildEnv(this.env),
                windowsHide: true,
            }, this.platform, attestedPiLaunch);
            this.captureSpawnedChild(task, captured.child);
            captured.child.on('error', (error) => {
                void this.finalizeAttestedPiTask(task, attested, paths, argv, cwdRealpath, repoRootRealpath, startAuthority, auth, promptBytes, reportAbsPath, captured.stdoutChunks, captured.stderrChunks, 'failed', null, null, error.message);
            });
            captured.child.on('close', (code, signalName) => {
                let status = (code ?? 0) === 0 && signalName === null ? 'completed' : 'failed';
                let error;
                if (task.killKind === 'timeout') {
                    status = 'failed';
                    error = task.error ?? `Timed out after ${String(timeoutSeconds)}s`;
                }
                else if (task.killKind === 'user' || task.killKind === 'shutdown') {
                    status = 'killed';
                    error = task.error;
                }
                else if (status === 'failed') {
                    const exitCode = code === null ? 'null' : String(code);
                    error = `Exited with code ${exitCode}${signalName ? ` (${signalName})` : ''}`;
                }
                void this.finalizeAttestedPiTask(task, attested, paths, argv, cwdRealpath, repoRootRealpath, startAuthority, auth, promptBytes, reportAbsPath, captured.stdoutChunks, captured.stderrChunks, status, code, signalName, error);
            });
            unbindAdmissionCancellation = this.bindOwnedTaskToAdmission(task, admission);
            await this.awaitTaskAdmissionBoundary(this.writeMetadata(task, admissionSignal), admission);
            this.assertTaskAdmissionOpen('an attested Pi task', admission);
            this.onChange();
            if (timeoutSeconds !== undefined) {
                task.timeoutHandle = setTimeout(() => {
                    if (task.status !== 'running')
                        return;
                    task.killKind = 'timeout';
                    task.error = `Timed out after ${String(timeoutSeconds)}s`;
                    try {
                        this.requestKill(task, 'SIGTERM');
                    }
                    catch (error) {
                        void this.finalizeAttestedPiTask(task, attested, paths, argv, cwdRealpath, repoRootRealpath, startAuthority, auth, promptBytes, reportAbsPath, captured.stdoutChunks, captured.stderrChunks, 'failed', null, null, error instanceof Error ? error.message : String(error));
                    }
                }, timeoutSeconds * 1000);
            }
            return task;
        }
        catch (error) {
            let cleanupError;
            if (task.child === undefined) {
                try {
                    await this.discardUnspawnedTask(task, admissionArtifacts);
                }
                catch (cleanupFailure) {
                    cleanupError = cleanupFailure;
                }
            }
            else {
                const taskError = admissionSignal.aborted
                    ? this.taskAdmissionError(admission)
                    : error instanceof Error
                        ? error
                        : new Error(String(error));
                this.stopOwnedTaskAfterAdmissionCancellation(task, taskError);
            }
            if (admissionSignal.aborted) {
                throw this.surfacedTaskAdmissionError(admission, error, cleanupError);
            }
            if (cleanupError !== undefined) {
                throw new AggregateError([error, cleanupError], `Attested Pi launch failed and artifact cleanup also failed: ${BackgroundTaskRegistry.errorMessage(cleanupError)}`);
            }
            throw error;
        }
        finally {
            unbindAdmissionCancellation();
        }
    }
    async finalizeAttestedPiTask(task, attested, paths, argv, cwdRealpath, repoRootRealpath, startAuthority, auth, promptBytes, reportAbsPath, stdoutChunks, stderrChunks, status, exitCode, signal, error) {
        if (task.finalized)
            return;
        task.finalized = true;
        if (task.timeoutHandle)
            clearTimeout(task.timeoutHandle);
        if (this.platform === 'win32')
            this.clearKillEscalationTimer(task);
        let finalStatus = status;
        let finalError = error;
        const posixForceFailure = await this.awaitPosixProcessGroupBeforeTerminal(task);
        if (posixForceFailure !== undefined) {
            finalStatus = 'failed';
            finalError = BackgroundTaskRegistry.appendTaskError(finalError, posixForceFailure.message);
        }
        const windowsForceFailure = await this.awaitWindowsForceBeforeTerminal(task);
        if (windowsForceFailure !== undefined) {
            finalStatus = 'failed';
            finalError = BackgroundTaskRegistry.appendTaskError(finalError, windowsForceFailure.message);
        }
        task.exitCode = exitCode;
        task.signal = signal;
        task.endTime = this.now();
        if (finalError)
            task.error = finalError;
        const rawEvents = Buffer.concat(stdoutChunks);
        const rawStderr = Buffer.concat(stderrChunks);
        await writeFileFsynced(paths.eventsAbsPath, rawEvents);
        await writeFileFsynced(paths.stderrAbsPath, rawStderr);
        let parsed;
        if (finalStatus === 'completed') {
            try {
                parsed = attested.parsePiJsonEvents(rawEvents);
                task.model = parsed.providerScopedModelId;
                task.tokenUsage = {
                    input: parsed.tokenUsage.input,
                    output: parsed.tokenUsage.output,
                    cacheRead: parsed.tokenUsage.cacheRead,
                    cacheWrite: parsed.tokenUsage.cacheWrite,
                    totalTokens: parsed.tokenUsage.totalTokens,
                };
                if (parsed.tokenUsage.costTotal !== undefined)
                    task.tokenUsage.costTotal = parsed.tokenUsage.costTotal;
                task.toolUsage = parsed.toolUsage;
                const outputBytes = Buffer.from(parsed.humanTranscript, 'utf8');
                task.bytesWritten = outputBytes.length;
                await writeFileFsynced(paths.outputAbsPath, outputBytes);
            }
            catch (parseError) {
                finalStatus = 'failed';
                task.error = parseError instanceof Error ? parseError.message : String(parseError);
                const outputBytes = Buffer.from(`[attested Pi task error: ${task.error}]\n`, 'utf8');
                task.bytesWritten = outputBytes.length;
                await writeFileFsynced(paths.outputAbsPath, outputBytes);
            }
        }
        else {
            const outputBytes = Buffer.from(rawStderr.toString('utf8'), 'utf8');
            task.bytesWritten = outputBytes.length;
            await writeFileFsynced(paths.outputAbsPath, outputBytes);
        }
        try {
            if (finalStatus === 'completed' && parsed) {
                const finishAuthority = await attested.gitAuthoritySnapshot(task.cwd, this.attestedGitOptions());
                const completedSnapshot = { ...snapshot(task), status: 'completed' };
                await this.writeMetadataSnapshot(task, completedSnapshot);
                const attestation = await attested.buildPiTaskAttestation({
                    task: completedSnapshot,
                    paths,
                    sessionDir: dirNameFromDisplay(paths.outputPath),
                    argv,
                    cwdRealpath,
                    repoRootRealpath,
                    startAuthority,
                    finishAuthority,
                    parsedEvents: parsed,
                    auth,
                    prompt: promptBytes,
                    reportAbsPath,
                });
                await writeJsonAtomic(paths.attestationAbsPath, attestation);
            }
            else {
                await this.writeMetadataSnapshot(task, { ...snapshot(task), status: finalStatus });
            }
        }
        catch (attestationError) {
            finalStatus = 'failed';
            task.error =
                attestationError instanceof Error ? attestationError.message : String(attestationError);
            await this.writeMetadataSnapshot(task, { ...snapshot(task), status: 'failed' }).catch((metadataError) => {
                this.logger.error(`[background-tasks] failed to write failed attested metadata for ${task.id}:`, metadataError);
            });
        }
        task.status = finalStatus;
        for (const waiter of task.waiters.splice(0))
            waiter();
        this.onChange();
        this.publishTerminal(task);
        this.pruneOldTasks();
    }
    resolveTask(idOrPrefix) {
        const id = idOrPrefix.trim();
        if (!id)
            throw new Error('Task ID is required');
        const exact = this.tasks.get(id);
        if (exact)
            return exact;
        const matches = [...this.tasks.values()].filter((task) => task.id.startsWith(id));
        const onlyMatch = matches[0];
        if (matches.length === 1 && onlyMatch)
            return onlyMatch;
        if (matches.length > 1)
            throw new Error(`Ambiguous task ID prefix "${id}": ${matches.map((task) => task.id).join(', ')}`);
        throw new Error(`Unknown background task ID: ${id}`);
    }
    async stopTask(task, kind, reason) {
        if (task.status !== 'running') {
            throw new Error(`Task ${task.id} is ${task.status}, not running`);
        }
        if (task.reloadExecution !== undefined) {
            return task.reloadExecution.requestStop(kind, reason);
        }
        const stopWaitMs = task.managedStopWaitMs ?? this.stopWaitMs;
        if (this.platform !== 'win32' &&
            task.managedCancel === undefined &&
            task.posixProcessGroupSignalAuthorityReleased === true &&
            this.posixProcessGroupKillStates.get(task) === undefined) {
            const finalized = await this.waitForEnd(task, stopWaitMs);
            if (!finalized) {
                throw new Error(`Task ${task.id} did not finish terminalization within ${formatDuration(stopWaitMs)} after its process group signal authority was released`);
            }
            return task;
        }
        task.killKind = kind;
        if (reason)
            task.error = reason;
        this.requestKill(task, 'SIGTERM');
        const stopped = task.managedCancel === undefined && this.platform === 'win32'
            ? await this.waitForEndOrWindowsForceFailure(task, stopWaitMs)
            : task.managedCancel === undefined
                ? await this.waitForEndOrPosixForceFailure(task, stopWaitMs)
                : await this.waitForEnd(task, stopWaitMs);
        const posixForceFailure = this.posixProcessGroupKillStates.get(task)?.failure;
        if (posixForceFailure !== undefined)
            throw posixForceFailure;
        const windowsForceFailure = this.windowsKillStates.get(task)?.forceFailure;
        if (windowsForceFailure !== undefined)
            throw windowsForceFailure;
        if (!stopped) {
            throw new Error(`Task ${task.id} did not exit within ${formatDuration(stopWaitMs)} after cancellation`);
        }
        return task;
    }
    async stopAllRunning(kind, reason) {
        const running = this.allTasks().filter((task) => task.status === 'running');
        const failures = [];
        let stopped = 0;
        await Promise.all(running.map(async (task) => {
            try {
                await this.stopTask(task, kind, reason);
                stopped++;
            }
            catch (error) {
                failures.push(`${taskDisplayName(task)} (${task.id}): ${error instanceof Error ? error.message : String(error)}`);
            }
        }));
        return { stopped, failures };
    }
    async getTaskLogs(task, maxBytes, tail) {
        if (!existsSync(task.outputAbsPath)) {
            throw new Error(`Output file does not exist for ${task.id}: ${task.outputPath}`);
        }
        const read = await boundedRead(task.outputAbsPath, maxBytes, tail);
        const direction = tail ? 'tail' : 'head';
        let text = read.content.length > 0 ? read.content : '(no output yet)';
        if (read.truncated) {
            const omitted = read.totalBytes - read.bytesRead;
            const notice = `\n\n[Showing ${direction} ${formatSize(read.bytesRead)} of ${formatSize(read.totalBytes)}; ${formatSize(omitted)} omitted. Full output: ${task.outputPath}]`;
            text = tail ? `${notice}\n\n${text}` : `${text}${notice}`;
        }
        else {
            text += `\n\n[Full output: ${task.outputPath}]`;
        }
        return {
            text,
            details: {
                task: snapshot(task),
                path: task.outputPath,
                bytesRead: read.bytesRead,
                truncated: read.truncated,
                tail,
            },
        };
    }
    async writeMetadata(task, signal) {
        await this.writeMetadataSnapshot(task, snapshot(task), signal);
    }
    async writeMetadataSnapshot(task, value, signal) {
        const write = async () => {
            await writeJsonAtomic(task.metadataAbsPath, value, signal);
        };
        const previous = task.metadataWriteChain ?? Promise.resolve();
        const next = previous.then(write, write);
        task.metadataWriteChain = next.catch(() => undefined);
        await next;
    }
    ingestTelemetry(task, text) {
        if (!text)
            return;
        const telemetryText = `${task.contextUsageBuffer ?? ''}${text}`;
        let latestContext = task.contextUsage;
        let latestTokens = task.tokenUsage;
        let latestTools = task.toolUsage;
        let latestModel = task.model;
        for (const line of telemetryText.split(/\r?\n/)) {
            if (!line.includes('background-task-'))
                continue;
            const trimmed = line.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = parseJsonText(trimmed);
                    if (!isJsonObject(parsed))
                        continue;
                    const payload = parsed;
                    if (payload.type === 'background-task-context-usage') {
                        latestContext = normalizeContextUsage(payload) ?? latestContext;
                    }
                    else if (payload.type === 'background-task-telemetry') {
                        latestContext = normalizeContextUsage(payload.contextUsage) ?? latestContext;
                        latestTokens = normalizeTokenUsage(payload.tokenUsage) ?? latestTokens;
                        latestTools = normalizeToolUsage(payload.toolUsage) ?? latestTools;
                        latestModel = normalizeModel(payload.model) ?? latestModel;
                    }
                }
                catch {
                    // Ignore malformed optional telemetry; task output remains authoritative for debugging.
                }
            }
        }
        const xmlMatches = telemetryText.matchAll(/<background-task-context-usage>[\s\S]*?<\/background-task-context-usage>/gi);
        for (const match of xmlMatches)
            latestContext = parseContextUsageXml(match[0]) ?? latestContext;
        const lastNewline = Math.max(telemetryText.lastIndexOf('\n'), telemetryText.lastIndexOf('\r'));
        let retained = lastNewline >= 0 ? telemetryText.slice(lastNewline + 1) : telemetryText;
        const lastXmlOpen = telemetryText.toLowerCase().lastIndexOf('<background-task-context-usage');
        const lastXmlClose = telemetryText
            .toLowerCase()
            .lastIndexOf('</background-task-context-usage>');
        if (lastXmlOpen > lastXmlClose)
            retained = telemetryText.slice(lastXmlOpen);
        task.contextUsageBuffer = retained.slice(-TELEMETRY_BUFFER_CHARS);
        this.commitTelemetry(task, {
            context: latestContext,
            tokens: latestTokens,
            tools: latestTools,
            model: latestModel,
        });
    }
    /** Apply the latest parsed telemetry to a task, persisting metadata and notifying the UI only on change. */
    commitTelemetry(task, next) {
        const before = JSON.stringify({
            contextUsage: task.contextUsage,
            tokenUsage: task.tokenUsage,
            toolUsage: task.toolUsage,
            model: task.model,
        });
        if (next.context !== undefined)
            task.contextUsage = next.context;
        if (next.tokens !== undefined)
            task.tokenUsage = next.tokens;
        if (next.tools !== undefined)
            task.toolUsage = next.tools;
        if (next.model !== undefined)
            task.model = next.model;
        const after = JSON.stringify({
            contextUsage: task.contextUsage,
            tokenUsage: task.tokenUsage,
            toolUsage: task.toolUsage,
            model: task.model,
        });
        if (before !== after) {
            this.onChange();
            void this.writeMetadata(task).catch((error) => {
                this.logger.error(`[background-tasks] failed to write telemetry metadata for ${task.id}:`, error);
            });
        }
    }
    /** Cap-enforcing sink for all persisted task output; terminates the task once the byte cap is exceeded. */
    writeToStream(task, buffer) {
        if (!task.stream || task.stream.destroyed)
            return;
        if (buffer.length === 0)
            return;
        const nextBytes = task.bytesWritten + buffer.length;
        if (nextBytes <= this.maxOutputBytes) {
            task.stream.write(buffer);
            task.bytesWritten = nextBytes;
            return;
        }
        const remaining = Math.max(0, this.maxOutputBytes - task.bytesWritten);
        if (remaining > 0) {
            task.stream.write(buffer.subarray(0, remaining));
            task.bytesWritten += remaining;
        }
        if (!task.capExceeded) {
            task.capExceeded = true;
            task.error = `Output exceeded cap of ${formatSize(this.maxOutputBytes)}; terminating task`;
            const notice = `\n\n[background task error: ${task.error}]\n`;
            task.stream.write(notice);
            task.bytesWritten += Buffer.byteLength(notice, 'utf8');
            task.killKind = 'output_cap';
            try {
                this.requestKill(task, 'SIGTERM');
            }
            catch (error) {
                task.error = `${task.error}; kill failed: ${error instanceof Error ? error.message : String(error)}`;
                void this.finalizeTask(task, 'failed', null, undefined, task.error);
            }
        }
    }
    /** Persist an internally generated notice (spawn/timeout/cap diagnostics) verbatim. */
    writeNotice(task, text) {
        if (!text)
            return;
        this.writeToStream(task, Buffer.from(text, 'utf8'));
    }
    appendChildOutput(task, data, source) {
        if (!task.stream || task.stream.destroyed)
            return;
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        if (buffer.length === 0)
            return;
        if (task.telemetryWrapped) {
            // Wrapped Pi agents stream control lines on stdout (telemetry + activity); child
            // stderr is raw diagnostics and is always passed through to the transcript verbatim.
            if (source === 'stdout')
                this.processAgentStdout(task, buffer.toString('utf8'));
            else
                this.writeToStream(task, buffer);
            return;
        }
        this.ingestTelemetry(task, buffer.toString('utf8'));
        this.writeToStream(task, buffer);
    }
    /** Reconstruct wrapped-agent stdout into whole control lines, routing telemetry to metrics and activity to the transcript. */
    processAgentStdout(task, text) {
        const buffered = `${task.agentStdoutBuffer ?? ''}${text}`;
        const lastNewline = buffered.lastIndexOf('\n');
        task.agentStdoutBuffer = lastNewline >= 0 ? buffered.slice(lastNewline + 1) : buffered;
        if (lastNewline < 0)
            return;
        const latest = {};
        for (const line of buffered.slice(0, lastNewline).split('\n'))
            this.consumeAgentLine(task, line, latest);
        this.commitTelemetry(task, latest);
    }
    /** Flush a trailing partial wrapped-agent line on finalize so the last transcript fragment is never lost. */
    flushAgentStdout(task) {
        const remainder = task.agentStdoutBuffer;
        if (!remainder)
            return;
        task.agentStdoutBuffer = '';
        const latest = {};
        this.consumeAgentLine(task, remainder, latest);
        this.commitTelemetry(task, latest);
    }
    consumeAgentLine(task, rawLine, latest) {
        const line = rawLine.replace(/\r$/, '');
        const trimmed = line.trim();
        if (!trimmed)
            return;
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
            this.writeNotice(task, `${line}\n`);
            return;
        }
        let parsed;
        try {
            parsed = parseJsonText(trimmed);
        }
        catch {
            this.writeNotice(task, `${line}\n`);
            return;
        }
        if (!isJsonObject(parsed)) {
            this.writeNotice(task, `${line}\n`);
            return;
        }
        const record = parsed;
        const type = record.type;
        if (type === 'background-task-context-usage') {
            const context = normalizeContextUsage(record);
            if (context)
                latest.context = context;
            return;
        }
        if (type === 'background-task-telemetry') {
            const context = normalizeContextUsage(record.contextUsage);
            if (context)
                latest.context = context;
            const tokens = normalizeTokenUsage(record.tokenUsage);
            if (tokens)
                latest.tokens = tokens;
            const tools = normalizeToolUsage(record.toolUsage);
            if (tools)
                latest.tools = tools;
            const model = normalizeModel(record.model);
            if (model)
                latest.model = model;
            return;
        }
        const activity = parseAgentActivity(parsed);
        if (activity) {
            const formatted = formatAgentActivityLine(activity);
            if (formatted)
                this.writeNotice(task, `${formatted}\n`);
            return;
        }
        // Unknown JSON object: pass through to the transcript rather than silently dropping it.
        this.writeNotice(task, `${line}\n`);
    }
    beginPosixProcessGroupKill(task, armGrace) {
        const existing = this.posixProcessGroupKillStates.get(task);
        if (existing !== undefined)
            return existing;
        if (task.posixProcessGroupSignalAuthorityReleased === true) {
            throw new Error(`Task ${task.id} has released its POSIX process-group signal authority`);
        }
        const groupId = task.ownedPosixProcessGroupId;
        if (groupId === undefined) {
            throw new Error(`Task ${task.id} has no owned POSIX process group`);
        }
        let resolveCompletion = () => undefined;
        const completion = new Promise((resolve) => {
            resolveCompletion = resolve;
        });
        // Finish ownership slightly before stopTask's waiter so a force/proof
        // failure is observed as that specific loud error instead of a generic
        // cancellation timeout.
        const reserveMs = Math.min(25, Math.max(1, Math.floor(this.stopWaitMs / 4)));
        const ownershipMs = Math.max(1, this.stopWaitMs - reserveMs);
        const state = {
            groupId,
            completion,
            resolveCompletion,
            deadlineAt: Date.now() + ownershipMs,
            forceAttempted: false,
            settled: false,
        };
        this.posixProcessGroupKillStates.set(task, state);
        if (armGrace) {
            // Publish the sole force owner before TERM. An injected signal can emit
            // close reentrantly; that close must see and await this exact state.
            task.killEscalationTimer = setTimeout(() => {
                task.killEscalationTimer = undefined;
                this.forceOwnedPosixProcessGroup(task, state);
            }, Math.min(this.killGraceMs, ownershipMs));
            // Unlike ordinary housekeeping timers, this owner stays referenced: a
            // departed leader must not let the host exit and strand its owned group.
        }
        return state;
    }
    finishPosixProcessGroupKill(task, state, releaseOwnership) {
        if (state.settled)
            return;
        state.settled = true;
        this.clearKillEscalationTimer(task);
        if (state.verificationTimer !== undefined) {
            clearTimeout(state.verificationTimer);
            state.verificationTimer = undefined;
        }
        task.posixProcessGroupSignalAuthorityReleased = true;
        if (releaseOwnership && task.ownedPosixProcessGroupId === state.groupId) {
            delete task.ownedPosixProcessGroupId;
        }
        state.resolveCompletion();
        const failure = state.failure;
        const listeners = state.failureListeners;
        if (listeners !== undefined) {
            delete state.failureListeners;
            if (failure !== undefined) {
                for (const listener of listeners)
                    listener(failure);
            }
        }
    }
    observeOwnedPosixProcessGroupGone(task, state) {
        if (state.settled)
            return state.failure === undefined;
        try {
            const exists = this.killProcess(-state.groupId, 0);
            state.lastProbeError = exists
                ? undefined
                : new Error(`process-group probe for ${String(state.groupId)} returned false`);
            return false;
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH') {
                this.finishPosixProcessGroupKill(task, state, true);
                return true;
            }
            state.lastProbeError =
                error instanceof Error ? error : new Error(BackgroundTaskRegistry.errorMessage(error));
            return false;
        }
    }
    recordPosixProcessGroupForceFailure(task, state, error) {
        if (state.settled)
            return;
        state.failure = error;
        this.finishPosixProcessGroupKill(task, state, false);
        task.error = BackgroundTaskRegistry.appendTaskError(task.error, error.message);
        this.writeNotice(task, `\n[background task POSIX termination: ${error.message}]\n`);
        this.onChange();
        void this.writeMetadata(task).catch((metadataError) => {
            this.logger.error(`[background-tasks] failed to write POSIX process-group failure metadata for ${task.id}:`, metadataError);
        });
    }
    schedulePosixProcessGroupVerification(task, state) {
        if (state.settled)
            return;
        const remainingMs = state.deadlineAt - Date.now();
        if (remainingMs <= 0) {
            const probeDetail = state.lastProbeError === undefined
                ? ''
                : `; last group probe failed: ${state.lastProbeError.message}`;
            this.recordPosixProcessGroupForceFailure(task, state, new Error(`POSIX process group ${String(state.groupId)} remained present after SIGKILL${probeDetail}. Descendant processes may have leaked.`));
            return;
        }
        state.verificationTimer = setTimeout(() => {
            state.verificationTimer = undefined;
            if (this.observeOwnedPosixProcessGroupGone(task, state))
                return;
            this.schedulePosixProcessGroupVerification(task, state);
        }, Math.min(10, remainingMs));
    }
    forceOwnedPosixProcessGroup(task, state) {
        if (state.settled || state.forceAttempted)
            return;
        // Latch before either probe or signal: both are injected boundaries that can
        // reentrantly emit root close, and no continuation may launch a second KILL.
        state.forceAttempted = true;
        this.clearKillEscalationTimer(task);
        if (this.observeOwnedPosixProcessGroupGone(task, state))
            return;
        try {
            const forced = this.killProcess(-state.groupId, 'SIGKILL');
            if (!forced) {
                this.recordPosixProcessGroupForceFailure(task, state, new Error(`POSIX process-group SIGKILL returned false for task ${task.id} group ${String(state.groupId)}. Descendant processes may have leaked.`));
                return;
            }
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH') {
                this.finishPosixProcessGroupKill(task, state, true);
                return;
            }
            this.recordPosixProcessGroupForceFailure(task, state, new Error(`POSIX process-group SIGKILL failed for task ${task.id} group ${String(state.groupId)}: ${BackgroundTaskRegistry.errorMessage(error)}. Descendant processes may have leaked.`));
            return;
        }
        if (this.observeOwnedPosixProcessGroupGone(task, state))
            return;
        this.schedulePosixProcessGroupVerification(task, state);
    }
    requestPosixKill(task, signal) {
        const state = this.beginPosixProcessGroupKill(task, signal !== 'SIGKILL');
        if (signal === 'SIGKILL') {
            task.killSignalSent = true;
            this.forceOwnedPosixProcessGroup(task, state);
            return;
        }
        if (task.killSignalSent)
            return;
        // Publish de-duplication before the signal boundary for the same reason the
        // state/timer is published above: close may be emitted synchronously.
        task.killSignalSent = true;
        const errors = [];
        let killed = false;
        try {
            killed = this.killProcess(-state.groupId, signal);
            if (!killed)
                errors.push(`process group ${signal} returned false`);
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH') {
                this.finishPosixProcessGroupKill(task, state, true);
            }
            else {
                errors.push(`process group kill failed: ${BackgroundTaskRegistry.errorMessage(error)}`);
            }
        }
        if (!killed) {
            try {
                killed = task.child?.kill(signal) === true;
                if (!killed)
                    errors.push(`child ${signal} returned false`);
            }
            catch (error) {
                errors.push(`child kill failed: ${BackgroundTaskRegistry.errorMessage(error)}`);
            }
        }
        if (!killed) {
            // If TERM reached neither target, waiting out grace has no benefit. Keep
            // the same owner but attempt its one force phase immediately.
            if (!state.settled)
                this.forceOwnedPosixProcessGroup(task, state);
            throw new Error(`Could not kill task ${task.id}: ${errors.join('; ')}`);
        }
    }
    async awaitPosixProcessGroupBeforeTerminal(task) {
        if (this.platform === 'win32')
            return undefined;
        const state = this.posixProcessGroupKillStates.get(task);
        if (state === undefined) {
            // No tree stop won the race before direct-child finalization. Release
            // signal authority synchronously so a concurrent late stop waits for this
            // terminalization instead of targeting a potentially reused group id.
            task.posixProcessGroupSignalAuthorityReleased = true;
            delete task.ownedPosixProcessGroupId;
            return undefined;
        }
        this.observeOwnedPosixProcessGroupGone(task, state);
        await state.completion;
        return state.failure;
    }
    waitForEndOrPosixForceFailure(task, timeoutMs) {
        const state = this.posixProcessGroupKillStates.get(task);
        if (state === undefined)
            return this.waitForEnd(task, timeoutMs);
        if (state.failure !== undefined)
            return Promise.reject(state.failure);
        if (task.status !== 'running')
            return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                const waiterIndex = task.waiters.indexOf(done);
                if (waiterIndex >= 0)
                    task.waiters.splice(waiterIndex, 1);
                const listeners = state.failureListeners;
                if (listeners !== undefined) {
                    const listenerIndex = listeners.indexOf(failed);
                    if (listenerIndex >= 0)
                        listeners.splice(listenerIndex, 1);
                    if (listeners.length === 0)
                        delete state.failureListeners;
                }
            };
            const timeout = setTimeout(() => {
                cleanup();
                resolve(false);
            }, timeoutMs);
            const done = () => {
                cleanup();
                resolve(true);
            };
            const failed = (error) => {
                cleanup();
                reject(error);
            };
            task.waiters.push(done);
            if (state.failureListeners === undefined)
                state.failureListeners = [];
            state.failureListeners.push(failed);
        });
    }
    getWindowsKillState(task) {
        let state = this.windowsKillStates.get(task);
        if (state === undefined) {
            state = {};
            this.windowsKillStates.set(task, state);
        }
        return state;
    }
    static errorMessage(error) {
        return error instanceof Error ? error.message : String(error);
    }
    static appendTaskError(existing, next) {
        if (existing === undefined || existing.length === 0)
            return next;
        if (existing.includes(next))
            return existing;
        return `${existing}; ${next}`;
    }
    static describeTaskkillOutcome(outcome) {
        const exitCode = outcome.exitCode === null ? 'null' : String(outcome.exitCode);
        const signal = outcome.signal === null ? 'null' : outcome.signal;
        const stdout = outcome.stdout.length > 0 ? ` stdout=${JSON.stringify(outcome.stdout)}` : '';
        const stderr = outcome.stderr.length > 0 ? ` stderr=${JSON.stringify(outcome.stderr)}` : '';
        const stdoutTruncated = outcome.stdoutTruncated ? ' stdout_truncated=true' : '';
        const stderrTruncated = outcome.stderrTruncated ? ' stderr_truncated=true' : '';
        return `exit=${exitCode} signal=${signal}${stdout}${stderr}${stdoutTruncated}${stderrTruncated}`;
    }
    isWindowsTaskkillTerminalRace(task) {
        return task.status !== 'running' || task.finalized === true;
    }
    clearKillEscalationTimer(task) {
        if (task.killEscalationTimer !== undefined) {
            clearTimeout(task.killEscalationTimer);
            task.killEscalationTimer = undefined;
        }
    }
    recordWindowsTaskkillNotice(task, message) {
        this.writeNotice(task, `\n[background task Windows termination: ${message}]\n`);
    }
    recordWindowsSoftFailure(task, pid, detail) {
        const message = `Windows taskkill /T logical termination request failed for task ${task.id} pid ${String(pid)}: ` +
            `${detail}; force escalation remains scheduled`;
        task.error = BackgroundTaskRegistry.appendTaskError(task.error, message);
        this.recordWindowsTaskkillNotice(task, message);
        this.onChange();
        void this.writeMetadata(task).catch((metadataError) => {
            this.logger.error(`[background-tasks] failed to write Windows taskkill soft-failure metadata for ${task.id}:`, metadataError);
        });
    }
    makeWindowsForceFailure(task, pid, detail) {
        return new Error(`Windows taskkill /T /F force termination failed for task ${task.id} pid ${String(pid)}: ${detail}. Descendant processes may have leaked.`);
    }
    recordWindowsForceFailure(task, error) {
        const state = this.getWindowsKillState(task);
        state.forceFailure = error;
        task.error = BackgroundTaskRegistry.appendTaskError(task.error, error.message);
        this.recordWindowsTaskkillNotice(task, error.message);
        this.onChange();
        void this.writeMetadata(task).catch((metadataError) => {
            this.logger.error(`[background-tasks] failed to write Windows taskkill force-failure metadata for ${task.id}:`, metadataError);
        });
        const listeners = state.forceFailureListeners;
        if (listeners !== undefined) {
            delete state.forceFailureListeners;
            for (const listener of listeners)
                listener(error);
        }
    }
    evaluateWindowsTaskkillOutcome(task, pid, phase, outcome) {
        if (outcome.exitCode === 0)
            return undefined;
        const detail = BackgroundTaskRegistry.describeTaskkillOutcome(outcome);
        if (outcome.exitCode === 128) {
            this.recordWindowsTaskkillNotice(task, `taskkill ${phase} reported process not found for pid ${String(pid)} (${detail}); treating as an already-exited race`);
            return undefined;
        }
        if (this.isWindowsTaskkillTerminalRace(task)) {
            this.recordWindowsTaskkillNotice(task, `taskkill ${phase} finished after the task became terminal for pid ${String(pid)} (${detail}); treating as a terminal race`);
            return undefined;
        }
        if (phase === 'terminate') {
            this.recordWindowsSoftFailure(task, pid, detail);
            return undefined;
        }
        return this.makeWindowsForceFailure(task, pid, detail);
    }
    handleWindowsSoftException(task, pid, error, state) {
        const message = BackgroundTaskRegistry.errorMessage(error);
        if (state.forcePromise !== undefined || this.isWindowsTaskkillTerminalRace(task))
            return;
        this.recordWindowsSoftFailure(task, pid, message);
    }
    startWindowsSoftKill(task, pid) {
        const state = this.getWindowsKillState(task);
        if (state.softPromise !== undefined)
            return state.softPromise;
        const controller = new AbortController();
        state.softController = controller;
        let launched;
        try {
            launched = this.killTree(pid, 'terminate', controller.signal);
        }
        catch (error) {
            delete state.softController;
            throw new Error(`Could not kill task ${task.id}: Windows taskkill /T failed to start: ${BackgroundTaskRegistry.errorMessage(error)}`);
        }
        const promise = launched
            .then((outcome) => {
            if (state.forcePromise !== undefined || this.isWindowsTaskkillTerminalRace(task))
                return;
            const failure = this.evaluateWindowsTaskkillOutcome(task, pid, 'terminate', outcome);
            if (failure !== undefined)
                throw failure;
        })
            .catch((error) => {
            this.handleWindowsSoftException(task, pid, error, state);
        })
            .finally(() => {
            if (state.softController === controller)
                delete state.softController;
        });
        state.softPromise = promise;
        return promise;
    }
    startWindowsForceKill(task, pid) {
        const state = this.getWindowsKillState(task);
        if (state.forcePromise !== undefined)
            return state.forcePromise;
        let resolveForce;
        let rejectForce;
        const forcePromise = new Promise((resolve, reject) => {
            resolveForce = resolve;
            rejectForce = reject;
        });
        if (resolveForce === undefined || rejectForce === undefined) {
            throw new Error('Windows force termination promise could not be initialized');
        }
        const resolveForceReady = resolveForce;
        const rejectForceReady = rejectForce;
        state.forcePromise = forcePromise;
        void forcePromise.catch((error) => {
            this.logger.error(`[background-tasks] Windows force tree termination failed for ${task.id}:`, error);
        });
        this.clearKillEscalationTimer(task);
        if (state.softController !== undefined && !state.softController.signal.aborted) {
            state.softController.abort();
        }
        let launched;
        try {
            launched = this.killTree(pid, 'force');
        }
        catch (error) {
            const failure = this.makeWindowsForceFailure(task, pid, `helper failed to start: ${BackgroundTaskRegistry.errorMessage(error)}`);
            delete state.forcePromise;
            this.recordWindowsForceFailure(task, failure);
            rejectForceReady(failure);
            throw failure;
        }
        launched.then((outcome) => {
            const failure = this.evaluateWindowsTaskkillOutcome(task, pid, 'force', outcome);
            if (failure !== undefined) {
                this.recordWindowsForceFailure(task, failure);
                rejectForceReady(failure);
                return;
            }
            resolveForceReady();
        }, (error) => {
            if (this.isWindowsTaskkillTerminalRace(task)) {
                this.recordWindowsTaskkillNotice(task, `taskkill force rejected after the task became terminal for pid ${String(pid)} (${BackgroundTaskRegistry.errorMessage(error)}); treating as a terminal race`);
                resolveForceReady();
                return;
            }
            const failure = this.makeWindowsForceFailure(task, pid, BackgroundTaskRegistry.errorMessage(error));
            this.recordWindowsForceFailure(task, failure);
            rejectForceReady(failure);
        });
        return forcePromise;
    }
    requestWindowsKill(task, pid, signal) {
        if (signal === 'SIGKILL') {
            this.startWindowsForceKill(task, pid);
            task.killSignalSent = true;
            return;
        }
        this.startWindowsSoftKill(task, pid);
        task.killSignalSent = true;
        if (task.killEscalationTimer !== undefined)
            return;
        task.killEscalationTimer = setTimeout(() => {
            task.killEscalationTimer = undefined;
            if (task.status !== 'running')
                return;
            try {
                this.requestKill(task, 'SIGKILL');
            }
            catch (error) {
                task.error = BackgroundTaskRegistry.appendTaskError(task.error, `SIGKILL failed: ${error instanceof Error ? error.message : String(error)}`);
                void this.writeMetadata(task).catch((metadataError) => {
                    this.logger.error(`[background-tasks] failed to write metadata for ${task.id}:`, metadataError);
                });
            }
        }, this.killGraceMs).unref();
    }
    requestKill(task, signal = 'SIGTERM') {
        if (task.status !== 'running') {
            throw new Error(`Task ${task.id} is ${task.status}, not running`);
        }
        if (task.managedCancel !== undefined) {
            if (task.managedCancelRequested)
                return;
            task.managedCancelRequested = true;
            try {
                task.managedCancel();
            }
            catch (error) {
                throw new Error(`Could not cancel managed task ${task.id}: ${BackgroundTaskRegistry.errorMessage(error)}`);
            }
            task.killSignalSent = true;
            return;
        }
        if (!task.child) {
            throw new Error(`Task ${task.id} has no child process handle`);
        }
        if (task.killSignalSent && signal === 'SIGTERM')
            return;
        if (this.platform === 'win32') {
            if (!task.pid)
                throw new Error(`Task ${task.id} has no process id`);
            this.requestWindowsKill(task, task.pid, signal);
            return;
        }
        this.requestPosixKill(task, signal);
    }
    waitForEnd(task, timeoutMs) {
        if (task.status !== 'running')
            return Promise.resolve(true);
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                const idx = task.waiters.indexOf(done);
                if (idx >= 0)
                    task.waiters.splice(idx, 1);
                resolve(false);
            }, timeoutMs);
            const done = () => {
                clearTimeout(timeout);
                resolve(true);
            };
            task.waiters.push(done);
        });
    }
    waitForEndOrWindowsForceFailure(task, timeoutMs) {
        const state = this.getWindowsKillState(task);
        if (state.forceFailure !== undefined)
            return Promise.reject(state.forceFailure);
        if (task.status !== 'running')
            return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                const waiterIndex = task.waiters.indexOf(done);
                if (waiterIndex >= 0)
                    task.waiters.splice(waiterIndex, 1);
                const listeners = state.forceFailureListeners;
                if (listeners !== undefined) {
                    const listenerIndex = listeners.indexOf(failed);
                    if (listenerIndex >= 0)
                        listeners.splice(listenerIndex, 1);
                    if (listeners.length === 0)
                        delete state.forceFailureListeners;
                }
            };
            const timeout = setTimeout(() => {
                cleanup();
                resolve(false);
            }, timeoutMs);
            const done = () => {
                cleanup();
                resolve(true);
            };
            const failed = (error) => {
                cleanup();
                reject(error);
            };
            task.waiters.push(done);
            if (state.forceFailureListeners === undefined)
                state.forceFailureListeners = [];
            state.forceFailureListeners.push(failed);
        });
    }
    async awaitWindowsForceBeforeTerminal(task) {
        const state = this.windowsKillStates.get(task);
        if (state === undefined)
            return undefined;
        const forcePromise = state.forcePromise;
        if (forcePromise === undefined)
            return state.forceFailure;
        try {
            await forcePromise;
        }
        catch (error) {
            return error instanceof Error ? error : new Error(String(error));
        }
        return state.forceFailure;
    }
    async deliverReloadTerminal(execution, lease) {
        const task = execution.task;
        if (task.reloadHostDeliveryInFlight || task.reloadHostDeliverySettled) {
            this.maybeReleaseReloadExecution(task);
            return;
        }
        task.reloadHostDeliveryInFlight = true;
        try {
            if (!this.ownsReloadExecution(execution, lease))
                return;
            this.onChange();
            this.publishTerminal(task);
            const deliveryGate = await this.waitForTerminalPublicationGate(task);
            if (!this.ownsReloadExecution(execution, lease))
                return;
            if (deliveryGate.kind === 'rejected') {
                this.logger.error(`[background-tasks] completion delivery gate failed for ${task.id}: ${this.terminalPublicationError(deliveryGate.error)}`);
            }
            else if (task.notifyOnCompletion &&
                !task.notified &&
                !this.shuttingDown &&
                execution.notificationState === 'pending') {
                const token = execution.beginNotification(lease);
                if (token !== undefined) {
                    try {
                        this.notifyCompletion(task);
                        execution.finishNotification(token, task.notified);
                    }
                    catch (error) {
                        execution.finishNotification(token, false);
                        this.logger.error(`[background-tasks] notification failed for ${task.id}:`, error);
                    }
                }
            }
            if (!this.ownsReloadExecution(execution, lease))
                return;
            task.reloadHostNotificationSettled = true;
            task.reloadHostDeliverySettled = true;
            try {
                await this.writeMetadata(task);
            }
            catch (error) {
                this.logger.error(`[background-tasks] failed to update survivor notification metadata for ${task.id}:`, error);
            }
        }
        finally {
            task.reloadHostDeliveryInFlight = false;
            this.maybeReleaseReloadExecution(task);
        }
    }
    maybeReleaseReloadExecution(task) {
        const execution = task.reloadExecution;
        const lease = this.reloadShellLease;
        if (execution === undefined ||
            execution.phase !== 'terminal' ||
            task.reloadHostNotificationSettled !== true ||
            task.terminalPublicationState === 'pending' ||
            !this.ownsReloadExecution(execution, lease) ||
            this.reloadShellOwner === undefined ||
            lease === undefined) {
            return;
        }
        try {
            this.reloadShellOwner.releaseExecution(lease, execution);
        }
        catch (error) {
            if (typeof error !== 'object' ||
                error === null ||
                Reflect.get(error, 'code') !== 'pi_bg_reload_owner_stale_claim') {
                this.logger.error(`[background-tasks] failed to release reload shell execution ${task.id}:`, error);
            }
        }
    }
    terminalPublicationAbandonSignal(task) {
        const existing = this.terminalPublicationAbandonSignals.get(task);
        if (existing !== undefined)
            return existing;
        let resolveSignal = () => { };
        const promise = new Promise((resolve) => {
            resolveSignal = resolve;
        });
        const signal = { promise, resolve: resolveSignal };
        this.terminalPublicationAbandonSignals.set(task, signal);
        return signal;
    }
    publishTerminal(task) {
        if (task.reloadExecution !== undefined && this.tasks.get(task.id) !== task)
            return;
        if (task.terminalPublicationState !== 'pending' || task.terminalPublishInFlight)
            return;
        if (this.terminalPublicationClosed) {
            this.abandonTerminalPublication(task, this.terminalPublicationCloseReason ?? 'registry_shutdown');
            return;
        }
        task.terminalPublishInFlight = true;
        if (task.terminalPublicationGate === undefined) {
            this.tryPublishTerminalNow(task);
            return;
        }
        void this.publishTerminalWhenReady(task);
    }
    async publishTerminalWhenReady(task) {
        const outcome = await this.waitForTerminalPublicationGate(task);
        if (task.reloadExecution !== undefined && this.tasks.get(task.id) !== task) {
            task.terminalPublishInFlight = false;
            return;
        }
        if (outcome.kind === 'closed') {
            this.abandonTerminalPublication(task, outcome.reason);
            return;
        }
        if (outcome.kind === 'rejected') {
            this.abandonTerminalPublication(task, 'gate_rejected', outcome.error);
            return;
        }
        // The gate and registry closure can settle in the same microtask turn.
        // Re-check after the await so a late gate cannot publish into a disposed
        // activation or revive a task already abandoned by shutdown.
        if (this.terminalPublicationClosed || task.terminalPublicationState !== 'pending') {
            this.abandonTerminalPublication(task, this.terminalPublicationCloseReason ?? 'registry_shutdown');
            return;
        }
        this.tryPublishTerminalNow(task);
    }
    async waitForTerminalPublicationGate(task) {
        if (this.terminalPublicationClosed) {
            return {
                kind: 'closed',
                reason: this.terminalPublicationCloseReason ?? 'registry_shutdown',
            };
        }
        if (task.terminalPublicationState === 'abandoned') {
            if (task.terminalPublicationAbandonReason === 'gate_rejected') {
                return { kind: 'rejected', error: new Error('terminal publication gate rejected') };
            }
            return {
                kind: 'closed',
                reason: task.terminalPublicationAbandonReason ?? 'registry_shutdown',
            };
        }
        const gate = task.terminalPublicationGate;
        if (gate === undefined)
            return { kind: 'released' };
        const gateOutcome = gate.then(() => ({ kind: 'released' }), (error) => ({ kind: 'rejected', error }));
        const closureOutcome = this.terminalPublicationClosedSignal.then((reason) => ({ kind: 'closed', reason }));
        const abandonmentOutcome = this.terminalPublicationAbandonSignal(task).promise.then((reason) => ({
            kind: 'closed',
            reason,
        }));
        const outcome = await Promise.race([gateOutcome, closureOutcome, abandonmentOutcome]);
        // Closure wins if it happened before this continuation resumed, regardless
        // of which promise queued its reaction first.
        if (this.terminalPublicationClosed) {
            return {
                kind: 'closed',
                reason: this.terminalPublicationCloseReason ?? 'registry_shutdown',
            };
        }
        return outcome;
    }
    tryPublishTerminalNow(task) {
        if (task.reloadExecution !== undefined && this.tasks.get(task.id) !== task) {
            task.terminalPublishInFlight = false;
            return;
        }
        if (task.terminalPublicationState !== 'pending') {
            task.terminalPublishInFlight = false;
            return;
        }
        if (this.terminalPublicationClosed) {
            task.terminalPublishInFlight = false;
            this.abandonTerminalPublication(task, this.terminalPublicationCloseReason ?? 'registry_shutdown');
            this.pruneOldTasks();
            return;
        }
        task.terminalPublishAttempts += 1;
        task.terminalEmitInFlight = true;
        let emitFailed = false;
        let emitError;
        try {
            this.publishTerminalSnapshot(snapshot(task));
        }
        catch (error) {
            emitFailed = true;
            emitError = error;
        }
        task.terminalEmitInFlight = false;
        task.terminalPublishInFlight = false;
        if (emitFailed) {
            const execution = task.reloadExecution;
            if (execution !== undefined && !this.ownsReloadExecution(execution, this.reloadShellLease)) {
                // The emitter synchronously detached this task into a reload handoff
                // before throwing. Attempt 1 is consumed, but only the fresh owner may
                // retry or decide abandonment on the shared publication ledger.
                return;
            }
            this.handleTerminalPublishFailure(task, emitError);
        }
        else {
            this.markTerminalPublicationDelivered(task);
        }
        this.pruneOldTasks();
    }
    markTerminalPublicationDelivered(task) {
        if (task.terminalPublishRetryHandle !== undefined) {
            clearTimeout(task.terminalPublishRetryHandle);
            task.terminalPublishRetryHandle = undefined;
        }
        task.terminalPublicationGate = undefined;
        task.terminalEmitInFlight = false;
        task.terminalPublishInFlight = false;
        task.terminalPublicationState = 'delivered';
        delete task.terminalPublicationAbandonReason;
        task.terminalPublished = true;
        this.maybeReleaseReloadExecution(task);
    }
    abandonTerminalPublication(task, reason, error, log = true) {
        if (task.terminalPublishRetryHandle !== undefined) {
            clearTimeout(task.terminalPublishRetryHandle);
            task.terminalPublishRetryHandle = undefined;
        }
        task.terminalPublicationGate = undefined;
        if (task.terminalEmitInFlight !== true)
            task.terminalPublishInFlight = false;
        if (task.terminalPublicationState === 'delivered')
            return;
        if (task.terminalPublicationState === 'abandoned')
            return;
        task.terminalPublicationState = 'abandoned';
        task.terminalPublicationAbandonReason = reason;
        task.terminalPublished = false;
        this.terminalPublicationAbandonSignal(task).resolve(reason);
        if (log) {
            const detail = error === undefined ? '' : `: ${this.terminalPublicationError(error)}`;
            this.logger.error(`[background-tasks] terminal publication abandoned for ${task.id} (${reason}) after ${String(task.terminalPublishAttempts)}/${String(TERMINAL_PUBLICATION_MAX_ATTEMPTS)} emit attempts${detail}`);
        }
        this.maybeReleaseReloadExecution(task);
    }
    terminalPublicationError(error) {
        const compact = BackgroundTaskRegistry.errorMessage(error).replace(/\s+/gu, ' ').trim();
        if (compact.length <= TERMINAL_PUBLICATION_DIAGNOSTIC_CHARS)
            return compact;
        return `${compact.slice(0, TERMINAL_PUBLICATION_DIAGNOSTIC_CHARS - 1)}…`;
    }
    handleTerminalPublishFailure(task, error) {
        task.terminalPublishInFlight = false;
        if (task.terminalPublicationState !== 'pending')
            return;
        if (error instanceof BackgroundTaskExtensionServiceClosedError) {
            this.closeTerminalPublication('publisher_closed');
            return;
        }
        if (this.terminalPublicationClosed) {
            this.abandonTerminalPublication(task, this.terminalPublicationCloseReason ?? 'registry_shutdown', error);
            this.pruneOldTasks();
            return;
        }
        if (task.terminalPublishAttempts >= TERMINAL_PUBLICATION_MAX_ATTEMPTS) {
            this.abandonTerminalPublication(task, 'retry_exhausted', error);
            this.pruneOldTasks();
            return;
        }
        this.logger.error(`[background-tasks] terminal publication failed for ${task.id} (attempt ${String(task.terminalPublishAttempts)}/${String(TERMINAL_PUBLICATION_MAX_ATTEMPTS)}; retrying): ${this.terminalPublicationError(error)}`);
        if (task.terminalPublishRetryHandle !== undefined)
            return;
        task.terminalPublishRetryHandle = setTimeout(() => {
            task.terminalPublishRetryHandle = undefined;
            if (this.terminalPublicationClosed ||
                task.terminalPublicationState !== 'pending' ||
                (task.reloadExecution !== undefined && this.tasks.get(task.id) !== task))
                return;
            this.publishTerminal(task);
        }, TERMINAL_PUBLICATION_RETRY_MS);
        task.terminalPublishRetryHandle.unref();
    }
    notifyCompletion(task) {
        if (!task.notifyOnCompletion || task.notified || this.shuttingDown)
            return;
        task.notified = true;
        const exit = task.exitCode === undefined ? '' : `\n  <exit-code>${String(task.exitCode)}</exit-code>`;
        const error = task.error ? `\n  <error>${escapeXml(task.error)}</error>` : '';
        const taskName = taskDisplayName(task);
        const guidance = task.fusion === undefined
            ? 'Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.'
            : task.status === 'completed'
                ? `Fusion result is durably committed at ${task.fusion.artifactDir}. Call bg_result({taskId:${JSON.stringify(task.id)}}) once to retrieve it; do not poll.`
                : `Fusion ended ${task.status}. Inspect the preserved artifacts at ${task.fusion.artifactDir}; do not poll.`;
        const content = [
            '<background-task-notification>',
            `  <task-id>${task.id}</task-id>`,
            `  <task-name>${escapeXml(taskName)}</task-name>`,
            `  <status>${task.status}</status>`,
            exit,
            error,
            `  <output-file>${escapeXml(task.outputPath)}</output-file>`,
            `  <summary>${escapeXml(`Background task ${JSON.stringify(taskName)} ${task.status}`)}</summary>`,
            `  <guidance>${escapeXml(guidance)}</guidance>`,
            '</background-task-notification>',
        ]
            .filter(Boolean)
            .join('\n');
        try {
            this.sendCompletionNotification({
                customType: 'background-task-notification',
                content,
                display: true,
                details: snapshot(task),
            }, { deliverAs: 'followUp', triggerTurn: task.triggerOnCompletion });
        }
        catch (error) {
            task.notified = false;
            throw new Error(`Failed to send background task notification for ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async finalizeTask(task, status, exitCode, signal, error) {
        if (task.finalized)
            return;
        task.finalized = true;
        if (task.timeoutHandle)
            clearTimeout(task.timeoutHandle);
        if (this.platform === 'win32')
            this.clearKillEscalationTimer(task);
        let finalStatus = status;
        let finalError = error;
        const posixForceFailure = await this.awaitPosixProcessGroupBeforeTerminal(task);
        if (posixForceFailure !== undefined) {
            finalStatus = 'failed';
            finalError = BackgroundTaskRegistry.appendTaskError(finalError, posixForceFailure.message);
        }
        const windowsForceFailure = await this.awaitWindowsForceBeforeTerminal(task);
        if (windowsForceFailure !== undefined) {
            finalStatus = 'failed';
            finalError = BackgroundTaskRegistry.appendTaskError(finalError, windowsForceFailure.message);
        }
        task.exitCode = exitCode;
        task.signal = signal ?? null;
        // Keep status="running" until the final wrapped-agent fragment has been
        // consumed and the output plus terminal metadata are durable. Publishing a
        // terminal state earlier lets bg_status observe the previous assistant
        // turn's context snapshot and recreates the same false-completion race the
        // attested producer is required to prevent.
        try {
            if (task.telemetryWrapped) {
                // Child-process close can be observed before the wrapper stdout listener has
                // committed its last parsed telemetry batch. Wait for a short quiet window,
                // then flush the trailing partial line, so completed status never races
                // ahead of the final assistant-turn context/token/tool snapshot.
                await new Promise((resolve) => setTimeout(resolve, 25));
                this.flushAgentStdout(task);
            }
            if (task.stream && !task.stream.destroyed)
                await closeAndFsyncOutputStream(task.stream);
        }
        catch (finalizeError) {
            finalStatus = 'failed';
            const message = finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
            finalError = finalError
                ? `${finalError}; final output durability failed: ${message}`
                : `Final output durability failed: ${message}`;
        }
        task.endTime = this.now();
        if (finalError)
            task.error = finalError;
        try {
            await this.writeMetadataSnapshot(task, { ...snapshot(task), status: finalStatus });
            task.status = finalStatus;
        }
        catch (metadataError) {
            finalStatus = 'failed';
            task.status = 'failed';
            task.error = `Terminal metadata write failed: ${metadataError instanceof Error ? metadataError.message : String(metadataError)}`;
            this.logger.error(`[background-tasks] failed to write metadata for ${task.id}:`, metadataError);
            await this.writeMetadata(task).catch((retryError) => {
                this.logger.error(`[background-tasks] failed to write failed terminal metadata for ${task.id}:`, retryError);
            });
        }
        for (const waiter of task.waiters.splice(0))
            waiter();
        this.onChange();
        this.publishTerminal(task);
        const deliveryGate = await this.waitForTerminalPublicationGate(task);
        if (deliveryGate.kind === 'rejected') {
            this.logger.error(`[background-tasks] completion delivery gate failed for ${task.id}: ${this.terminalPublicationError(deliveryGate.error)}`);
        }
        else {
            // EventBus disposal abandons only EventBus publication. Notification truth
            // remains independent; notifyCompletion itself suppresses session shutdown.
            try {
                this.notifyCompletion(task);
            }
            catch (notificationError) {
                this.logger.error(`[background-tasks] notification failed for ${task.id}:`, notificationError);
            }
        }
        try {
            await this.writeMetadata(task);
        }
        catch (metadataError) {
            this.logger.error(`[background-tasks] failed to update notification metadata for ${task.id}:`, metadataError);
        }
        this.pruneOldTasks();
    }
    pruneOldTasks() {
        if (this.tasks.size <= this.maxRecentTasks)
            return;
        const removable = [...this.tasks.values()]
            .filter((task) => task.status !== 'running' && task.terminalEmitInFlight !== true)
            .sort((a, b) => (a.endTime ?? a.startTime) - (b.endTime ?? b.startTime));
        while (this.tasks.size > this.maxRecentTasks && removable.length > 0) {
            const task = removable.shift();
            if (task === undefined)
                continue;
            if (task.terminalPublicationState === 'pending') {
                this.abandonTerminalPublication(task, 'retention_limit');
            }
            this.tasks.delete(task.id);
        }
    }
}
//# sourceMappingURL=registry.js.map