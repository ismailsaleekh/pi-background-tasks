import { existsSync, statSync, type WriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { DEFAULT_MAX_BYTES } from '@earendil-works/pi-coding-agent';
import type { BackgroundTaskChildProcess } from './registry.js';

export const TASK_STATUS_VALUES = ['running', 'completed', 'failed', 'killed'] as const;
export const TERMINAL_TASK_STATUS_VALUES = ['completed', 'failed', 'killed'] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type TerminalTaskStatus = (typeof TERMINAL_TASK_STATUS_VALUES)[number];
export type KillKind = 'user' | 'timeout' | 'output_cap' | 'shutdown';

export type JsonObject = Readonly<Record<PropertyKey, unknown>>;

export interface TaskContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface TaskTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal?: number;
}

export interface TaskToolUsage {
  total: number;
  failed: number;
  byName: Record<string, number>;
}

export interface BgTaskSnapshot {
  id: string;
  name?: string | undefined;
  command: string;
  description?: string | undefined;
  status: TaskStatus;
  outputPath: string;
  cwd: string;
  startTime: number;
  endTime?: number | undefined;
  exitCode?: number | null | undefined;
  signal?: string | null | undefined;
  pid?: number | undefined;
  bytesWritten: number;
  isAgent: boolean;
  error?: string | undefined;
  notified: boolean;
  notifyOnCompletion: boolean;
  triggerOnCompletion: boolean;
  timeoutSeconds?: number | undefined;
  contextUsage?: TaskContextUsage | undefined;
  tokenUsage?: TaskTokenUsage | undefined;
  toolUsage?: TaskToolUsage | undefined;
  model?: string | undefined;
  attestationPath?: string | undefined;
}

export interface AttestedPiTaskFiles {
  eventsPath: string;
  stderrPath: string;
  wrapperPath: string;
  attestationPath: string;
}

export interface AttestedPiTaskSnapshot extends BgTaskSnapshot {
  attestedPi?: AttestedPiTaskFiles | undefined;
}

export interface BgTask extends Omit<BgTaskSnapshot, 'name'> {
  name: string;
  outputAbsPath: string;
  metadataAbsPath: string;
  eventsAbsPath?: string | undefined;
  stderrAbsPath?: string | undefined;
  wrapperAbsPath?: string | undefined;
  attestationAbsPath?: string | undefined;
  child?: BackgroundTaskChildProcess | undefined;
  stream?: WriteStream | undefined;
  timeoutHandle?: NodeJS.Timeout | undefined;
  killKind?: KillKind | undefined;
  killSignalSent?: boolean | undefined;
  capExceeded?: boolean | undefined;
  finalized?: boolean | undefined;
  terminalPublished?: boolean | undefined;
  terminalPublishInFlight?: boolean | undefined;
  terminalPublishRetryHandle?: NodeJS.Timeout | undefined;
  /** Optional protocol barrier used by EventBus run requests so early child exits cannot publish before the run response is observable. */
  terminalPublicationGate?: Promise<void> | undefined;
  contextUsageBuffer?: string | undefined;
  /** True when this task launched a telemetry-wrapped Pi agent; its stdout carries control lines, not raw output. */
  telemetryWrapped?: boolean | undefined;
  /** Partial trailing stdout line held between chunks while reconstructing wrapped-agent control lines. */
  agentStdoutBuffer?: string | undefined;
  attestationPath?: string | undefined;
  attestedPi?: AttestedPiTaskFiles | undefined;
  metadataWriteChain?: Promise<void> | undefined;
  waiters: Array<() => void>;
}

export type CompletionDeliveryMode =
  | 'notification-and-wake'
  | 'notification-only'
  | 'manual-monitoring';

export interface CompletionDeliveryGuidance {
  readonly mode: CompletionDeliveryMode;
  readonly notificationEnabled: boolean;
  readonly automaticWakeEnabled: boolean;
  readonly text: string;
}

/**
 * Describe the actual parent-agent completion path for one bg_run launch.
 * A wake request cannot take effect without the notification that carries it.
 */
export function deriveCompletionDeliveryGuidance(
  notifyOnCompletion: boolean,
  triggerOnCompletion: boolean,
): CompletionDeliveryGuidance {
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
        'Automatic follow-up turn: disabled. The terminal notification will be delivered passively and will not start an agent turn.',
        'Next action: do not poll merely to wait; use bg_status/bg_logs only when deliberate monitoring is required.',
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

export interface BgRunDetails {
  task: BgTaskSnapshot;
}

export interface BgStatusDetails {
  tasks: BgTaskSnapshot[];
}

export interface BgLogsDetails {
  task: BgTaskSnapshot;
  path: string;
  bytesRead: number;
  truncated: boolean;
  tail: boolean;
}

export interface BgKillDetails {
  task: BgTaskSnapshot;
  message: string;
}

export interface StartTaskOptions {
  name?: string | undefined;
  description?: string | undefined;
  isAgent?: boolean | undefined;
  timeoutSeconds?: number | undefined;
  notifyOnCompletion?: boolean | undefined;
  triggerOnCompletion?: boolean | undefined;
  /** @internal EventBus protocol barrier; callers should not set this outside the extension service. */
  terminalPublicationGate?: Promise<void> | undefined;
}

export interface StartAttestedPiTaskOptions {
  name: string;
  provider: string;
  model: string;
  prompt: string;
  reportPath: string;
  extraPiArgs?: string[] | undefined;
  thinking?: string | undefined;
  timeoutSeconds?: number | undefined;
}

export const DEFAULT_LOG_BYTES = Math.min(DEFAULT_MAX_BYTES, 50 * 1024);
export const MAX_LOG_BYTES = Math.min(DEFAULT_MAX_BYTES, 50 * 1024);
export const COMMAND_PREVIEW_CHARS = 90;
const parseJsonValue: (text: string) => unknown = globalThis.JSON.parse;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

export function parseJsonText(text: string): unknown {
  return parseJsonValue(text);
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'session';
}

export function stripMatchingQuotes(value: string): string {
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

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeTaskName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = compactWhitespace(stripMatchingQuotes(value));
  if (!normalized) return undefined;
  return truncateChars(normalized, 80);
}

export function deriveTaskNameFromCommand(command: string): string {
  const normalized = compactWhitespace(stripMatchingQuotes(command));
  if (!normalized) return 'Background task';

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

export function taskDisplayName(task: {
  name?: string | undefined;
  description?: string | undefined;
  command?: string | undefined;
  id?: string | undefined;
}): string {
  const commandName =
    task.command && task.command.length > 0 ? deriveTaskNameFromCommand(task.command) : undefined;
  return (
    normalizeTaskName(task.name) ??
    normalizeTaskName(task.description) ??
    commandName ??
    task.id ??
    'Background task'
  );
}

function parseNameValueAndRest(valueAndRest: string): { value: string; rest: string } | undefined {
  const input = valueAndRest.trimStart();
  if (!input) return undefined;
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
  if (!match) return undefined;
  const parsedValue = match[1];
  if (parsedValue === undefined) return undefined;
  return { value: parsedValue, rest: match[2]?.trimStart() ?? '' };
}

export function parseBgCommandArgs(args: string): {
  name?: string;
  command: string;
  isAgent: boolean;
} {
  let input = args.trim();
  let name: string | undefined;
  let isAgent = false;

  while (input) {
    let consumed = false;
    for (const prefix of ['--name=', '-n=']) {
      if (input.startsWith(prefix)) {
        const parsed = parseNameValueAndRest(input.slice(prefix.length));
        if (!parsed) throw new Error(`${prefix.slice(0, -1)} requires a task name`);
        name = normalizeTaskName(parsed.value);
        input = parsed.rest;
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    for (const prefix of ['--name', '-n']) {
      if (input === prefix || input.startsWith(`${prefix} `) || input.startsWith(`${prefix}\t`)) {
        const parsed = parseNameValueAndRest(input.slice(prefix.length));
        if (!parsed) throw new Error(`${prefix} requires a task name`);
        name = normalizeTaskName(parsed.value);
        input = parsed.rest;
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    for (const flag of ['--agent', '--llm-agent']) {
      if (input === flag || input.startsWith(`${flag} `) || input.startsWith(`${flag}\t`)) {
        isAgent = true;
        input = input.slice(flag.length).trimStart();
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    for (const flag of ['--script', '--no-agent']) {
      if (input === flag || input.startsWith(`${flag} `) || input.startsWith(`${flag}\t`)) {
        isAgent = false;
        input = input.slice(flag.length).trimStart();
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

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

  return name ? { name, command: input, isAgent } : { command: input, isAgent };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${String(minutes)}m${remSeconds > 0 ? `${String(remSeconds)}s` : ''}`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${String(hours)}h${remMinutes > 0 ? `${String(remMinutes)}m` : ''}`;
}

export function formatCompactNumber(count: number): string {
  const normalized = Math.max(0, Math.floor(count));
  if (normalized < 1000) return normalized.toString();
  if (normalized < 10000) return `${(normalized / 1000).toFixed(1)}k`;
  if (normalized < 1000000) return `${String(Math.round(normalized / 1000))}k`;
  if (normalized < 10000000) return `${(normalized / 1000000).toFixed(1)}M`;
  return `${String(Math.round(normalized / 1000000))}M`;
}

export function formatContextUsageSummary(usage?: TaskContextUsage): string | undefined {
  if (usage?.contextWindow === undefined || usage.contextWindow <= 0) return undefined;
  const window = formatCompactNumber(usage.contextWindow);
  if (usage.percent === null || usage.tokens === null) return `ctx=?/${window}`;
  return `ctx=${usage.percent.toFixed(1)}%/${window}`;
}

export function formatTokenUsageSummary(usage?: TaskTokenUsage): string | undefined {
  if (!usage || usage.totalTokens <= 0) return undefined;
  return `tokens=${formatCompactNumber(usage.totalTokens)}`;
}

export function formatToolUsageSummary(usage?: TaskToolUsage): string | undefined {
  if (!usage || (usage.total <= 0 && usage.failed <= 0)) return undefined;
  const failed = usage.failed > 0 ? ` failed=${String(usage.failed)}` : '';
  return `tools=${String(usage.total)}${failed}`;
}

export function formatModelSummary(model?: string): string | undefined {
  if (!model) return undefined;
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

export type AgentActivity =
  | { kind: 'assistant_text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool_start'; tool: string; argsSummary: string }
  | { kind: 'tool_end'; tool: string; isError: boolean; error?: string };

interface AgentActivityPayload extends JsonObject {
  readonly type?: unknown;
  readonly kind?: unknown;
  readonly text?: unknown;
  readonly tool?: unknown;
  readonly argsSummary?: unknown;
  readonly isError?: unknown;
  readonly error?: unknown;
}

function readActivityString(
  record: AgentActivityPayload,
  key: 'text' | 'tool' | 'argsSummary' | 'error',
): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** Narrow a parsed `background-task-activity` control payload into a typed {@link AgentActivity}. */
export function parseAgentActivity(payload: unknown): AgentActivity | undefined {
  if (!isJsonObject(payload)) return undefined;
  const record: AgentActivityPayload = payload;
  if (record.type !== AGENT_ACTIVITY_TYPE) return undefined;
  const kind = record.kind;
  if (kind === 'assistant_text' || kind === 'reasoning') {
    const text = readActivityString(record, 'text');
    if (text === undefined) return undefined;
    return { kind, text };
  }
  if (kind === 'tool_start') {
    const tool = readActivityString(record, 'tool');
    if (!tool) return undefined;
    return { kind, tool, argsSummary: readActivityString(record, 'argsSummary') ?? '' };
  }
  if (kind === 'tool_end') {
    const tool = readActivityString(record, 'tool');
    if (!tool) return undefined;
    const activity: AgentActivity = { kind, tool, isError: record.isError === true };
    const error = readActivityString(record, 'error');
    if (error !== undefined && error.trim().length > 0) activity.error = error;
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
export function formatAgentActivityLine(activity: AgentActivity): string | undefined {
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
    const suffix =
      summary.length > 0 ? ` ${truncateChars(summary, AGENT_ACTIVITY_DETAIL_MAX)}` : '';
    return `\u2192 ${activity.tool}${suffix}`;
  }
  if (!activity.isError) return undefined;
  const detail = activity.error
    ? `: ${truncateChars(compactWhitespace(activity.error), AGENT_ACTIVITY_DETAIL_MAX)}`
    : '';
  return `\u2717 ${activity.tool} failed${detail}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function executableOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env['PATH'] ?? env['Path'];
  if (!pathValue) return undefined;
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function shellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { shell: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32') {
    const posixShell = env['PI_BG_SHELL'] ?? env['SHELL'] ?? executableOnPath('bash.exe', env);
    if (posixShell) {
      return { shell: posixShell, args: ['-lc', command], windowsVerbatimArguments: false };
    }
    const comSpec = env['ComSpec'];
    return {
      shell: comSpec && comSpec.length > 0 ? comSpec : 'cmd.exe',
      args: ['/d', '/s', '/c', command],
      windowsVerbatimArguments: true,
    };
  }
  const shell = env['SHELL'];
  return { shell: shell && shell.length > 0 ? shell : '/bin/sh', args: ['-c', command] };
}

export function normalizeMaxBytes(value: unknown, fallback = DEFAULT_LOG_BYTES): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(MAX_LOG_BYTES, raw));
}

export function snapshot(task: BgTask): BgTaskSnapshot {
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
    error: task.error,
    notified: task.notified,
    notifyOnCompletion: task.notifyOnCompletion,
    triggerOnCompletion: task.triggerOnCompletion,
    timeoutSeconds: task.timeoutSeconds,
    contextUsage: task.contextUsage,
    tokenUsage: task.tokenUsage,
    toolUsage: task.toolUsage,
    model: task.model,
    attestationPath: task.attestationPath,
  };
}

export function formatSnapshotList(tasks: BgTaskSnapshot[], now = Date.now()): string {
  if (tasks.length === 0) return 'No background tasks in this Pi extension runtime.';
  return tasks
    .map((task) => {
      const statusIcon =
        task.status === 'running'
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

export async function boundedRead(
  filePath: string,
  maxBytes: number,
  tail: boolean,
): Promise<{ content: string; truncated: boolean; bytesRead: number; totalBytes: number }> {
  const stats = statSync(filePath);
  const totalBytes = stats.size;
  const bytesToRead = Math.min(totalBytes, maxBytes);
  if (bytesToRead === 0) return { content: '', truncated: false, bytesRead: 0, totalBytes };

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
  } finally {
    await file.close();
  }
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const UPDATE_COMMAND = '/bg-update';

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value: string): ParsedSemver | undefined {
  if (typeof value !== 'string') return undefined;
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const majorRaw = match[1];
  const minorRaw = match[2];
  const patchRaw = match[3];
  if (majorRaw === undefined || minorRaw === undefined || patchRaw === undefined) return undefined;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch))
    return undefined;
  const prerelease = match[4] !== undefined ? match[4].split('.') : [];
  return { major, minor, patch, prerelease };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  // A version without prerelease identifiers outranks the same core with prerelease identifiers.
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const idA = a[i];
    const idB = b[i];
    if (idA === undefined || idB === undefined) break;
    if (idA === idB) continue;
    const numericA = /^\d+$/.test(idA);
    const numericB = /^\d+$/.test(idB);
    if (numericA && numericB) {
      const diff = Number(idA) - Number(idB);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    // Numeric identifiers always have lower precedence than non-numeric identifiers.
    if (numericA) return -1;
    if (numericB) return 1;
    return idA < idB ? -1 : 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** Compare two semver strings. Returns -1/0/1, or undefined when either side is not valid semver. */
export function compareSemver(a: string, b: string): number | undefined {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return undefined;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) === 1;
}

/** Footer segment shown only when a newer published version exists; undefined otherwise. */
export function formatUpdateSegment(
  latest: string | undefined,
  current: string,
): string | undefined {
  if (!latest) return undefined;
  if (!isNewerVersion(latest, current)) return undefined;
  return `\u2b06 v${latest} ${UPDATE_COMMAND}`;
}
