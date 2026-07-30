import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
  ThemeColor,
  ToolRenderResultOptions,
} from '@earendil-works/pi-coding-agent';
import { formatSize } from '@earendil-works/pi-coding-agent';
import { Text, type KeyId } from '@earendil-works/pi-tui';
import { Type, type Static } from 'typebox';
import {
  DEFAULT_LOG_BYTES,
  MAX_LOG_BYTES,
  deriveCompletionDeliveryGuidance,
  deriveTaskNameFromCommand,
  formatSnapshotList,
  formatUpdateSegment,
  isNewerVersion,
  normalizeMaxBytes,
  normalizeTaskName,
  parseBgCommandArgs,
  taskDisplayName,
  truncateChars,
  type BgKillDetails,
  type BgLogsDetails,
  type BgRunDetails,
  type BgStatusDetails,
  type BgTask,
  type BgTaskSnapshot,
  type StartAttestedPiTaskOptions,
  type StartTaskOptions,
} from './core/common.js';
import {
  fetchLatestVersion,
  readPackageInfo,
  type FetchLatestVersionOptions,
} from './core/update-check.js';
import { BackgroundTaskRegistry } from './core/registry.js';
import {
  installBackgroundTaskExtensionApi,
  type BackgroundTaskExtensionService,
} from './core/extension-api.js';
import {
  BackgroundTasksManager,
  type BackgroundTaskForUi,
  type TaskManagerResult,
} from './ui/background-tasks-manager.js';
import { registerFusionExtension } from './fusion-extension.js';

/**
 * Project-local Pi background task manager.
 *
 * Scope:
 * - Explicit background shell jobs only: /bg and bg_run spawn commands directly.
 * - No Ctrl+B support for backgrounding an already-running built-in bash tool.
 * - No detached/restart reattachment: live child processes belong to this Pi
 *   extension runtime and are killed on session shutdown/reload.
 */

const STATUS_INTERVAL_MS = 1000;
const COMMAND_PREVIEW_CHARS = 90;
const GIT_INSTALL_TARGET = 'git:github.com/ismailsaleekh/pi-background-tasks';

const packageInfo = readPackageInfo(new URL('../package.json', import.meta.url), (error) => {
  console.error(`[background-tasks] failed to read package version: ${error.message}`);
});
const PACKAGE_NAME = packageInfo.name ?? 'pi-background-tasks';
const PACKAGE_VERSION = packageInfo.version;
const LIGHT_BLUE_BG = '\x1b[48;2;183;223;255m';
const LIGHT_BLUE_FG = '\x1b[38;2;11;70;110m';
const ANSI_RESET = '\x1b[0m';

function lightBlue(value: string): string {
  return `${LIGHT_BLUE_BG}${LIGHT_BLUE_FG}${value}${ANSI_RESET}`;
}

function textContent(text: string) {
  return [{ type: 'text' as const, text }];
}

interface TextToolResult {
  content?: ReadonlyArray<{ type: string; text?: string }>;
}

interface BgToolArgumentRecord {
  readonly command?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly isAgent?: unknown;
  readonly timeoutSeconds?: unknown;
  readonly notifyOnCompletion?: unknown;
  readonly triggerOnCompletion?: unknown;
}

interface BgPiAttestedArgumentRecord {
  readonly name?: unknown;
  readonly provider?: unknown;
  readonly model?: unknown;
  readonly prompt?: unknown;
  readonly reportPath?: unknown;
  readonly extraPiArgs?: unknown;
  readonly thinking?: unknown;
  readonly timeoutSeconds?: unknown;
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const BgRunParams = Type.Object({
  name: Type.String({
    description:
      'Short human-readable task name shown in the bg footer dock. Required; use 2-6 words, not the raw command.',
  }),
  command: Type.String({ description: 'Shell command to start in the background' }),
  isAgent: Type.Boolean({
    description:
      'Required. Set true only when this background task launches an LLM/agent process, such as a child `pi -p ...` or `pi --mode json ...`, so Pi-agent telemetry can be collected. Set false for scripts, tests, servers, sleeps, and ordinary shell commands.',
  }),
  description: Type.Optional(
    Type.String({ description: 'Optional longer human-readable context for the task' }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({ description: 'Optional timeout; task is failed and killed when exceeded' }),
  ),
  notifyOnCompletion: Type.Optional(
    Type.Boolean({
      description:
        'Whether to deliver the durable terminal notification. Default: true; disable only when deliberately taking over completion monitoring.',
    }),
  ),
  triggerOnCompletion: Type.Optional(
    Type.Boolean({
      description:
        'Whether that notification should automatically trigger a follow-up agent turn. Default: false for bg_run; opt in only when an unsolicited completion response is useful. Requires notifyOnCompletion.',
    }),
  ),
});

const BgPiAttestedParams = Type.Object({
  name: Type.String({ description: 'Short human-readable name for this attested Pi task.' }),
  provider: Type.String({
    description: 'Exact Pi provider to launch, for example openai-codex or anthropic.',
  }),
  model: Type.String({ description: 'Exact provider-local Pi model id to launch.' }),
  prompt: Type.String({ description: 'Prompt bytes passed as the single user prompt to Pi.' }),
  reportPath: Type.String({
    description:
      'Relative path, inside the task cwd, that the child Pi run must write as its report.',
  }),
  extraPiArgs: Type.Optional(
    Type.Array(
      Type.String({
        description:
          'Additional literal Pi argv entries; mode/provider/model/api-key args are rejected.',
      }),
    ),
  ),
  thinking: Type.Optional(Type.String({ description: 'Optional Pi thinking level argument.' })),
  timeoutSeconds: Type.Optional(
    Type.Number({ description: 'Optional timeout; task is failed and killed when exceeded' }),
  ),
});

const BgStatusParams = Type.Object({
  taskId: Type.Optional(
    Type.String({
      description:
        'Optional task ID or unambiguous prefix. If omitted, all running/recent tasks are returned.',
    }),
  ),
});

const BgLogsParams = Type.Object({
  taskId: Type.String({ description: 'Task ID or unambiguous prefix' }),
  maxBytes: Type.Optional(
    Type.Number({
      description: `Maximum bytes to return, capped at ${formatSize(MAX_LOG_BYTES)}. Default: ${formatSize(DEFAULT_LOG_BYTES)}.`,
    }),
  ),
  tail: Type.Optional(
    Type.Boolean({
      description: 'Read the tail of the log when true, head when false. Default: true.',
    }),
  ),
});

const BgKillParams = Type.Object({
  taskId: Type.String({ description: 'Task ID or unambiguous prefix to stop' }),
});

type BgRunParamsValue = Static<typeof BgRunParams>;
type BgPiAttestedParamsValue = Static<typeof BgPiAttestedParams>;

function renderPlainResult(result: TextToolResult, options: ToolRenderResultOptions, theme: Theme) {
  void options;
  void theme;
  const text =
    result.content?.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n') ?? '';
  return new Text(text, 0, 0);
}

export default function backgroundTasksExtension(pi: ExtensionAPI): void {
  registerFusionExtension(pi);

  const seenTaskIds = new Set<string>();
  let currentCtx: ExtensionContext | undefined;
  let dockOpen = false;
  let statusInterval: NodeJS.Timeout | undefined;
  let latestKnownVersion: string | undefined;
  let updateCheckStarted = false;

  let eventService: BackgroundTaskExtensionService | undefined;
  const registry = new BackgroundTaskRegistry({
    onChange: () => {
      updateUi();
    },
    sendCompletionNotification: (message, options) => {
      pi.sendMessage(message, options);
    },
    publishTerminal: (task) => {
      if (!eventService) throw new Error('Background task EventBus service is not installed');
      eventService.publishTerminal(task);
    },
  });
  eventService = installBackgroundTaskExtensionApi({
    events: pi.events,
    registry,
    getContext: () => currentCtx,
    isShuttingDown: () => registry.isShuttingDown(),
  });

  function unseenFinishedTasks(): BgTask[] {
    return registry
      .allTasks()
      .filter((task) => task.status !== 'running' && !seenTaskIds.has(task.id));
  }

  function clearFinishedNotices(ctx = currentCtx): number {
    const unseen = unseenFinishedTasks();
    for (const task of unseen) seenTaskIds.add(task.id);
    updateUi(ctx);
    return unseen.length;
  }

  function notifyClearFinishedNotices(ctx: ExtensionContext): void {
    currentCtx = ctx;
    const cleared = clearFinishedNotices(ctx);
    if (!ctx.hasUI) return;
    ctx.ui.notify(
      cleared > 0
        ? `Cleared ${String(cleared)} finished background task notice${cleared === 1 ? '' : 's'}.`
        : 'No finished background task notices to clear.',
      cleared > 0 ? 'info' : 'warning',
    );
  }

  function updateUi(ctx = currentCtx): void {
    if (registry.isShuttingDown() || !ctx) return;
    try {
      if (!ctx.hasUI) return;
      const allTasks = registry.allTasks();
      const running = allTasks.filter((task) => task.status === 'running');
      const unseenFailed = allTasks.filter(
        (task) => task.status === 'failed' && !seenTaskIds.has(task.id),
      );
      const unseenStopped = allTasks.filter(
        (task) => task.status === 'killed' && !seenTaskIds.has(task.id),
      );
      const unseenDone = allTasks.filter(
        (task) => task.status === 'completed' && !seenTaskIds.has(task.id),
      );
      const unseenFinishedCount = unseenFailed.length + unseenStopped.length + unseenDone.length;
      const updateSegment = formatUpdateSegment(latestKnownVersion, PACKAGE_VERSION ?? '');
      ctx.ui.setWidget('background-tasks', undefined);
      if (running.length === 0 && unseenFinishedCount === 0) {
        ctx.ui.setStatus(
          'background-tasks',
          updateSegment ? lightBlue(` bg ${updateSegment} `) : undefined,
        );
        return;
      }

      const parts: string[] = [];
      if (running.length > 0) parts.push(`${String(running.length)} running`);
      if (unseenFailed.length > 0) parts.push(`${String(unseenFailed.length)} failed`);
      if (unseenStopped.length > 0) parts.push(`${String(unseenStopped.length)} stopped`);
      if (unseenDone.length > 0) parts.push(`${String(unseenDone.length)} done`);
      const entryHint = dockOpen
        ? 'focused'
        : `Shift↓${unseenFinishedCount > 0 ? ' · /bg-clear' : ''}`;
      const segments = [...parts, entryHint];
      if (updateSegment) segments.push(updateSegment);
      const label = ` bg ${segments.join(' · ')} `;
      ctx.ui.setStatus('background-tasks', lightBlue(label));
    } catch (error) {
      console.error(
        `[background-tasks] UI update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      currentCtx = undefined;
    }
  }

  async function startTask(
    ctx: ExtensionContext,
    command: string,
    options: StartTaskOptions = {},
  ): Promise<BgTask> {
    currentCtx = ctx;
    return registry.startTask(ctx, command, options);
  }

  async function startAttestedPiTask(
    ctx: ExtensionContext,
    options: StartAttestedPiTaskOptions,
  ): Promise<BgTask> {
    currentCtx = ctx;
    return registry.startAttestedPiTask(ctx, options);
  }

  async function openTaskManager(
    ctx: ExtensionCommandContext | ExtensionContext,
    initialTaskId?: string,
  ): Promise<void> {
    currentCtx = ctx;
    if (!ctx.hasUI) {
      ctx.ui.notify(
        'Background task manager requires an interactive Pi UI. Use /jobs, /logs, or the bg_status/bg_logs tools in non-interactive mode.',
        'error',
      );
      return;
    }
    dockOpen = true;
    updateUi(ctx);
    try {
      await ctx.ui.custom<TaskManagerResult>(
        (tui, theme, _keybindings, done) => {
          const managerOptions = {
            getTasks: () => registry.allTasks(),
            stopTask: async (task: BackgroundTaskForUi) => {
              await registry.stopTask(registry.resolveTask(task.id), 'user');
              updateUi(ctx);
            },
            stopAllRunning: async () => {
              const result = await registry.stopAllRunning('user');
              updateUi(ctx);
              return result;
            },
            rerunTask: async (task: BackgroundTaskForUi) => {
              const rerunOptions: StartTaskOptions = {
                name: taskDisplayName(task),
                isAgent: task.isAgent,
                notifyOnCompletion: true,
                triggerOnCompletion: false,
              };
              if (task.description !== undefined) rerunOptions.description = task.description;
              if (task.timeoutSeconds !== undefined)
                rerunOptions.timeoutSeconds = task.timeoutSeconds;
              const rerun = await startTask(ctx, task.command, rerunOptions);
              updateUi(ctx);
              return rerun;
            },
            showOutputPath: (task: BackgroundTaskForUi) => {
              ctx.ui.notify(
                `Output path for ${taskDisplayName(task)} (${task.id}):\n${task.outputPath}`,
                'info',
              );
            },
            markSeen: (taskId: string) => {
              seenTaskIds.add(taskId);
              updateUi(ctx);
            },
            markFinishedSeen: (taskIds: string[]) => {
              for (const taskId of taskIds) seenTaskIds.add(taskId);
              updateUi(ctx);
            },
            isSeen: (taskId: string) => seenTaskIds.has(taskId),
          };
          if (initialTaskId)
            return new BackgroundTasksManager(tui, theme, done, {
              ...managerOptions,
              initialTaskId,
            });
          return new BackgroundTasksManager(tui, theme, done, managerOptions);
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: 'bottom-center',
            width: '96%',
            minWidth: 64,
            maxHeight: '60%',
            margin: { bottom: 1, left: 1, right: 1 },
          },
        },
      );
    } finally {
      dockOpen = false;
      updateUi(ctx);
    }
  }

  pi.registerMessageRenderer<BgTaskSnapshot>(
    'background-task-notification',
    (message, _options, theme) => {
      const task = message.details;
      const status = task?.status ?? 'completed';
      const color: ThemeColor =
        status === 'completed'
          ? 'success'
          : status === 'failed'
            ? 'error'
            : status === 'killed'
              ? 'warning'
              : 'accent';
      const id = task?.id ?? 'background task';
      const name = task ? taskDisplayName(task) : 'Background task';
      const output = task?.outputPath ? `\n${theme.fg('dim', `Output: ${task.outputPath}`)}` : '';
      const error = task?.error ? `\n${theme.fg('error', task.error)}` : '';
      return new Text(
        `${theme.fg(color, `[bg ${status}]`)} ${theme.fg('accent', name)} ${theme.fg('dim', `(${id})`)}${output}${error}`,
        0,
        0,
      );
    },
  );

  async function scheduleUpdateCheck(ctx: ExtensionContext): Promise<void> {
    if (updateCheckStarted) return;
    updateCheckStarted = true;
    const env = process.env;
    if (env['PI_BG_DISABLE_UPDATE_CHECK'] === '1') return;
    if (env['PI_OFFLINE'] === '1') return;
    if (!PACKAGE_VERSION) return;
    const options: FetchLatestVersionOptions = {
      packageName: PACKAGE_NAME,
      onError: (error) => {
        console.error(`[background-tasks] update check skipped: ${error.message}`);
      },
    };
    const registryUrl = env['PI_BG_REGISTRY_URL'];
    if (registryUrl) options.registryUrl = registryUrl;
    const latest = await fetchLatestVersion(options);
    if (latest && isNewerVersion(latest, PACKAGE_VERSION)) {
      latestKnownVersion = latest;
      updateUi(ctx);
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    registry.setShuttingDown(false);
    currentCtx = ctx;
    await registry.ensureRuntimeDir(ctx);
    updateUi(ctx);
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(() => {
      updateUi();
    }, STATUS_INTERVAL_MS);
    // One-shot, non-blocking: never awaited on the session-start path or the status tick.
    void scheduleUpdateCheck(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    registry.setShuttingDown(true);
    currentCtx = undefined;
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = undefined;
    }
    try {
      const running = registry.allTasks().filter((task) => task.status === 'running');
      if (running.length === 0) return;

      const failures: string[] = [];
      await Promise.all(
        running.map(async (task) => {
          try {
            await registry.stopTask(task, 'shutdown', 'Killed during Pi session shutdown/reload');
          } catch (error) {
            const message = `${task.id}: ${error instanceof Error ? error.message : String(error)}`;
            failures.push(message);
            console.error(`[background-tasks] shutdown cleanup failed for ${message}`);
          }
        }),
      );
      if (failures.length > 0 && ctx.hasUI) {
        ctx.ui.notify(`Background task cleanup failed:\n${failures.join('\n')}`, 'error');
      }
    } finally {
      eventService?.close();
    }
  });

  pi.registerCommand('bg', {
    description:
      'Start a shell command as a tracked background task: /bg [--agent] [--name "Task name"] <command>',
    handler: async (args, ctx) => {
      try {
        const parsed = parseBgCommandArgs(args);
        const taskOptions: StartTaskOptions = {
          isAgent: parsed.isAgent,
          notifyOnCompletion: true,
          triggerOnCompletion: false,
        };
        if (parsed.name !== undefined) taskOptions.name = parsed.name;
        const task = await startTask(ctx, parsed.command, taskOptions);
        ctx.ui.notify(
          `Started ${taskDisplayName(task)} (${task.id})\nOutput: ${task.outputPath}\nCommand: ${task.command}`,
          'info',
        );
      } catch (error) {
        ctx.ui.notify(
          `Background task failed to start: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    },
  });

  pi.registerCommand('tasks', {
    description: 'Open the Claude-like background task manager UI',
    handler: async (args, ctx) => {
      const taskId = optionalTrimmed(args);
      await openTaskManager(ctx, taskId);
    },
  });

  pi.registerCommand('bg-tasks', {
    description: 'Open the background task manager UI',
    handler: async (args, ctx) => {
      const taskId = optionalTrimmed(args);
      await openTaskManager(ctx, taskId);
    },
  });

  pi.registerCommand('bg-clear', {
    description: 'Clear finished background task footer notices',
    handler: (_args, ctx) => {
      notifyClearFinishedNotices(ctx);
      return Promise.resolve();
    },
  });

  pi.registerCommand('bg-update', {
    description: 'Show how to update pi-background-tasks to the latest published version',
    handler: (_args, ctx) => {
      const current = PACKAGE_VERSION ?? 'unknown';
      const latest = latestKnownVersion;
      const pinnedNpm = latest ? `${PACKAGE_NAME}@${latest}` : `${PACKAGE_NAME}@<version>`;
      const pinnedGit = latest ? `${GIT_INSTALL_TARGET}@v${latest}` : `${GIT_INSTALL_TARGET}@<tag>`;
      const lines = [
        latest
          ? `pi-background-tasks ${current} is installed; ${latest} is the latest published version.`
          : `pi-background-tasks ${current} is installed.`,
        'Update from npm:',
        `  pi install npm:${PACKAGE_NAME}@latest`,
        `  pi install npm:${pinnedNpm}`,
        'Or update from git tags:',
        `  pi install ${pinnedGit}`,
        'This command only prints update instructions; it does not install or self-update.',
      ];
      ctx.ui.notify(lines.join('\n'), 'info');
      return Promise.resolve();
    },
  });

  pi.registerShortcut('shift+down' satisfies KeyId, {
    description: 'Open focused background task footer dock',
    handler: async (ctx) => {
      await openTaskManager(ctx);
    },
  });

  pi.registerShortcut('ctrl+alt+c' satisfies KeyId, {
    description:
      'Clear finished background task footer notices (terminal-dependent fallback for /bg-clear)',
    handler: (ctx) => {
      notifyClearFinishedNotices(ctx);
    },
  });

  pi.registerCommand('jobs', {
    description: 'List running and recent background tasks',
    handler: (_args, ctx) => {
      currentCtx = ctx;
      ctx.ui.notify(
        formatSnapshotList(registry.allTasks().map((task) => registry.snapshot(task))),
        'info',
      );
      updateUi(ctx);
      return Promise.resolve();
    },
  });

  pi.registerCommand('logs', {
    description: 'Show bounded output from a background task: /logs <id> [maxBytes]',
    getArgumentCompletions: (prefix) => {
      const matches = registry
        .allTasks()
        .filter((task) => task.id.startsWith(prefix.trim()))
        .slice(0, 20)
        .map((task) => ({
          value: task.id,
          label: `${task.id} ${taskDisplayName(task)}`,
          description: `${task.status} — ${truncateChars(task.command, 60)}`,
        }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      try {
        currentCtx = ctx;
        const [id, bytes] = args.trim().split(/\s+/, 2);
        const task = registry.resolveTask(id ?? '');
        const maxBytes = normalizeMaxBytes(Number(bytes), DEFAULT_LOG_BYTES);
        const logs = await registry.getTaskLogs(task, maxBytes, true);
        ctx.ui.notify(logs.text, 'info');
      } catch (error) {
        ctx.ui.notify(
          `Background logs error: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    },
  });

  pi.registerCommand('kill', {
    description: 'Stop a running background task: /kill <id>',
    getArgumentCompletions: (prefix) => {
      const matches = registry
        .allTasks()
        .filter((task) => task.status === 'running' && task.id.startsWith(prefix.trim()))
        .slice(0, 20)
        .map((task) => ({
          value: task.id,
          label: `${task.id} ${taskDisplayName(task)}`,
          description: truncateChars(task.command, 70),
        }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      try {
        currentCtx = ctx;
        const task = registry.resolveTask(args.trim());
        await registry.stopTask(task, 'user');
        ctx.ui.notify(
          `Killed ${taskDisplayName(task)} (${task.id}). Output: ${task.outputPath}`,
          'info',
        );
        updateUi(ctx);
      } catch (error) {
        ctx.ui.notify(
          `Background kill error: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    },
  });

  pi.registerTool<typeof BgRunParams, BgRunDetails>({
    name: 'bg_run',
    label: 'Background Run',
    description: `Start a named long-running shell command in the background and return immediately with a task ID and output path. By default, completed, failed, or killed terminal state is delivered automatically as a passive <background-task-notification> without starting an unsolicited follow-up agent turn; do not sleep or poll merely to wait. Output is written to .pi/tasks and model-visible logs are bounded to ${formatSize(MAX_LOG_BYTES)}.`,
    promptSnippet:
      'Start a named long-running shell command; the default terminal notification is passive, so never poll merely to wait',
    promptGuidelines: [
      'Use bg_run instead of bash for commands expected to run for a long time, such as test suites, dev servers, watchers, or builds.',
      'Always set isAgent: true only when the background task launches an LLM/agent process; set isAgent: false for scripts, tests, dev servers, sleeps, and ordinary shell commands.',
      'When using bg_run, always set name to a concise 2-6 word human-readable label for the footer task dock; do not use the raw command as the name unless it is already short and meaningful.',
      'bg_run returns immediately. By default notifyOnCompletion is true and triggerOnCompletion is false: terminal state is delivered as a passive <background-task-notification> without automatically starting a follow-up agent turn.',
      'After bg_run, continue only independent useful work that does not merely wait for the task; otherwise briefly acknowledge the launch if useful, then end the current turn. Do not call sleep, bg_status, or bg_logs merely to wait.',
      'Treat <background-task-notification> as durable terminal truth. Do not acknowledge a passive notification solely to restate it, do not call bg_status to reconfirm it, and call bg_logs only when task output is needed.',
      'Use bg_status/bg_logs only when the user explicitly requests an update, deliberate monitoring is required, there is concrete evidence the task is hung, or a terminal notification arrived and output details are needed.',
      'Keep the default passive completion behavior. Set triggerOnCompletion:true only when the user explicitly requests an automatic completion response or the workflow cannot proceed without one; set notifyOnCompletion:false only when deliberately taking over monitoring.',
    ],
    parameters: BgRunParams,
    prepareArguments(args): BgRunParamsValue {
      if (!args || typeof args !== 'object') throw new Error('bg_run arguments must be an object');
      const input = args as BgToolArgumentRecord;
      if (typeof input.command !== 'string') throw new Error('bg_run requires command string');
      if (typeof input.isAgent !== 'boolean') {
        throw new Error(
          'bg_run requires isAgent boolean. Set true only for LLM/agent tasks; set false for scripts, tests, servers, sleeps, and ordinary shell commands.',
        );
      }
      const prepared: BgRunParamsValue = {
        command: input.command,
        name:
          normalizeTaskName(input.name) ??
          normalizeTaskName(input.description) ??
          deriveTaskNameFromCommand(input.command),
        isAgent: input.isAgent,
      };
      if (typeof input.description === 'string') prepared.description = input.description;
      if (typeof input.timeoutSeconds === 'number') prepared.timeoutSeconds = input.timeoutSeconds;
      if (typeof input.notifyOnCompletion === 'boolean')
        prepared.notifyOnCompletion = input.notifyOnCompletion;
      if (typeof input.triggerOnCompletion === 'boolean')
        prepared.triggerOnCompletion = input.triggerOnCompletion;
      return prepared;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (typeof params.isAgent !== 'boolean') {
        throw new Error(
          'bg_run requires isAgent boolean. Set true only for LLM/agent tasks; set false for scripts, tests, servers, sleeps, and ordinary shell commands.',
        );
      }
      const taskOptions: StartTaskOptions = {
        name: params.name,
        isAgent: params.isAgent,
        notifyOnCompletion: params.notifyOnCompletion ?? true,
        triggerOnCompletion: params.triggerOnCompletion ?? false,
      };
      if (params.description !== undefined) taskOptions.description = params.description;
      if (params.timeoutSeconds !== undefined) taskOptions.timeoutSeconds = params.timeoutSeconds;
      const task = await startTask(ctx, params.command, taskOptions);
      const completionDelivery = deriveCompletionDeliveryGuidance(
        task.notifyOnCompletion,
        task.triggerOnCompletion,
      );
      return {
        content: textContent(
          `Started background task ${taskDisplayName(task)} (${task.id})\nStatus: ${task.status}\nPID: ${String(task.pid ?? 'unknown')}\nOutput: ${task.outputPath}\n${completionDelivery.text}`,
        ),
        details: { task: registry.snapshot(task) },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg('toolTitle', theme.bold('bg_run '))}${theme.fg('muted', truncateChars(taskDisplayName(args), COMMAND_PREVIEW_CHARS))}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const { task } = result.details;
      return new Text(
        `${theme.fg('success', '✓ started')} ${theme.fg('accent', taskDisplayName(task))} ${theme.fg('dim', `(${task.id})`)}\n${theme.fg('dim', `Output: ${task.outputPath}`)}`,
        0,
        0,
      );
    },
  });

  pi.registerTool<typeof BgPiAttestedParams, BgRunDetails>({
    name: 'bg_run_pi_attested',
    label: 'Attested Pi Run',
    description:
      'Opt-in evidence-oriented direct Pi spawn. Launches exactly one `pi --mode json` child, records raw Pi events/stderr, hashes prompt/report/output, observes OAuth through ModelRegistry, and emits a strict attestation sidecar only after successful completion.',
    promptSnippet: 'Start an attested direct Pi agent task and return its task ID plus output path',
    promptGuidelines: [
      'Use only when the user explicitly asks for an attested Pi evidence-producing task; ordinary background work should use bg_run unchanged.',
      'Provide provider/model as structured fields and a relative reportPath that the child Pi prompt will write before exit.',
      'Do not provide channel, auth, route, or hash claims; the producer observes those facts itself and fails loudly if it cannot attest them.',
    ],
    parameters: BgPiAttestedParams,
    prepareArguments(args): BgPiAttestedParamsValue {
      if (!args || typeof args !== 'object')
        throw new Error('bg_run_pi_attested arguments must be an object');
      const input = args as BgPiAttestedArgumentRecord;
      if (typeof input.name !== 'string') throw new Error('bg_run_pi_attested requires name');
      if (typeof input.provider !== 'string')
        throw new Error('bg_run_pi_attested requires provider');
      if (typeof input.model !== 'string') throw new Error('bg_run_pi_attested requires model');
      if (typeof input.prompt !== 'string') throw new Error('bg_run_pi_attested requires prompt');
      if (typeof input.reportPath !== 'string')
        throw new Error('bg_run_pi_attested requires reportPath');
      const prepared: BgPiAttestedParamsValue = {
        name: input.name,
        provider: input.provider,
        model: input.model,
        prompt: input.prompt,
        reportPath: input.reportPath,
      };
      if (Array.isArray(input.extraPiArgs)) {
        if (!input.extraPiArgs.every((entry) => typeof entry === 'string'))
          throw new Error('bg_run_pi_attested extraPiArgs entries must be strings');
        prepared.extraPiArgs = input.extraPiArgs;
      }
      if (typeof input.thinking === 'string') prepared.thinking = input.thinking;
      if (typeof input.timeoutSeconds === 'number') prepared.timeoutSeconds = input.timeoutSeconds;
      return prepared;
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = await startAttestedPiTask(ctx, params);
      return {
        content: textContent(
          `Started attested Pi task ${taskDisplayName(task)} (${task.id})\nStatus: ${task.status}\nPID: ${String(task.pid ?? 'unknown')}\nOutput: ${task.outputPath}\nAttestation: ${task.attestationPath ?? 'pending until completion'}`,
        ),
        details: { task: registry.snapshot(task) },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg('toolTitle', theme.bold('bg_run_pi_attested '))}${theme.fg('muted', truncateChars(args.name, COMMAND_PREVIEW_CHARS))}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const { task } = result.details;
      return new Text(
        `${theme.fg('success', '✓ started')} ${theme.fg('accent', taskDisplayName(task))} ${theme.fg('dim', `(${task.id})`)}\n${theme.fg('dim', `Output: ${task.outputPath}`)}\n${theme.fg('dim', `Attestation: ${task.attestationPath ?? 'pending'}`)}`,
        0,
        0,
      );
    },
  });

  pi.registerTool<typeof BgStatusParams, BgStatusDetails>({
    name: 'bg_status',
    label: 'Background Status',
    description:
      'Inspect one background task or list all running/recent background tasks. This is a point-in-time inspection tool, not a waiting primitive.',
    promptSnippet:
      'Inspect point-in-time status for one or all background tasks; never poll it as a wait loop',
    promptGuidelines: [
      'Use bg_status for deliberate point-in-time inspection, not as a waiting primitive.',
      'A running result is not an instruction to poll again. Do not repeatedly call bg_status while an automatic terminal notification is pending.',
      'Use bg_status when the user explicitly requests an update, automatic completion handling was disabled, or concrete evidence suggests a task is hung; terminal notifications do not need reconfirmation.',
    ],
    parameters: BgStatusParams,
    execute(_toolCallId, params) {
      const selected = params.taskId ? [registry.resolveTask(params.taskId)] : registry.allTasks();
      const snapshots = selected.map((task) => registry.snapshot(task));
      return Promise.resolve({
        content: textContent(formatSnapshotList(snapshots)),
        details: { tasks: snapshots },
      });
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg('toolTitle', theme.bold('bg_status'))}${args.taskId ? ` ${theme.fg('accent', args.taskId)}` : ''}`,
        0,
        0,
      );
    },
    renderResult: renderPlainResult,
  });

  pi.registerTool<typeof BgLogsParams, BgLogsDetails>({
    name: 'bg_logs',
    label: 'Background Logs',
    description: `Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at ${formatSize(MAX_LOG_BYTES)} for model safety and points to the full output file when truncated.`,
    promptSnippet: 'Read bounded task output when needed; never tail it repeatedly as a wait loop',
    promptGuidelines: [
      'Use bg_logs with a modest maxBytes value only when task output is needed, without flooding context.',
      'Do not repeatedly call bg_logs to wait for completion while an automatic terminal notification is pending.',
      'Use bg_status first only when a deliberate inspection requires the current task state; do not reconfirm a terminal notification.',
    ],
    parameters: BgLogsParams,
    async execute(_toolCallId, params) {
      const task = registry.resolveTask(params.taskId);
      const logs = await registry.getTaskLogs(
        task,
        normalizeMaxBytes(params.maxBytes),
        params.tail ?? true,
      );
      return {
        content: textContent(logs.text),
        details: logs.details,
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg('toolTitle', theme.bold('bg_logs '))}${theme.fg('accent', args.taskId)}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details;
      let text = `${theme.fg('accent', taskDisplayName(details.task))} ${theme.fg('dim', `(${details.task.id})`)} ${theme.fg('muted', details.tail ? 'tail' : 'head')} ${formatSize(details.bytesRead)}`;
      if (details.truncated) text += theme.fg('warning', ' (truncated)');
      text += `\n${theme.fg('dim', `Full output: ${details.path}`)}`;
      if (expanded) {
        const output = result.content
          .map((content) => (content.type === 'text' ? content.text : '[image content]'))
          .join('\n');
        text += `\n${theme.fg('toolOutput', output.split('\n').slice(0, 30).join('\n'))}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool<typeof BgKillParams, BgKillDetails>({
    name: 'bg_kill',
    label: 'Background Kill',
    description:
      'Stop a running background task by ID. Fails loudly if the task is unknown or already finished.',
    promptSnippet: 'Stop a running background task by ID',
    promptGuidelines: [
      'Use bg_kill when the user asks to stop a background task or when a bg_run command is no longer needed.',
    ],
    parameters: BgKillParams,
    async execute(_toolCallId, params) {
      const task = registry.resolveTask(params.taskId);
      await registry.stopTask(task, 'user');
      const message = `Killed background task ${taskDisplayName(task)} (${task.id}). Output: ${task.outputPath}`;
      return {
        content: textContent(message),
        details: { task: registry.snapshot(task), message },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg('toolTitle', theme.bold('bg_kill '))}${theme.fg('accent', args.taskId)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const { task } = result.details;
      return new Text(
        `${theme.fg('warning', '■ killed')} ${theme.fg('accent', taskDisplayName(task))} ${theme.fg('dim', `(${task.id})`)}\n${theme.fg('dim', `Output: ${task.outputPath}`)}`,
        0,
        0,
      );
    },
  });
}
