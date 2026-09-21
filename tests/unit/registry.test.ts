import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { parseJsonText, shellQuote, type StartDelegateTaskOptions } from '../../src/core/common.js';
import {
  BackgroundTaskRegistry,
  WIN32_CMD_PI_TELEMETRY_UNAVAILABLE_REASON,
  commandMayLaunchPiAgent,
  type BackgroundTaskContext,
  type BackgroundTaskSpawn,
  type CompletionNotificationMessage,
  type CompletionNotificationOptions,
} from '../../src/core/registry.js';
import type { Api, Model } from '@earendil-works/pi-ai';
import type {
  BgTask,
  BgTaskSnapshot,
  ReloadShellActivationLeaseV1,
  ReloadShellOwnerHubV1,
} from '../../src/core/common.js';
import {
  createReloadShellOwnerHubForTests,
  inspectReloadShellOwnerForTests,
  makeReloadShellIdentity,
} from '../../src/core/reload-shell-owner.js';
import type { TaskkillOutcome, WindowsKillPhase } from '../../src/core/windows-taskkill.js';
import type { AttestedGitSpawn } from '../../src/core/attested-pi-run.js';
import { BackgroundTaskExtensionServiceClosedError } from '../../src/core/extension-api.js';
import { SynchronousActivationCloseFence } from '../../src/core/lazy-module.js';
import { registerBackgroundResultExtension } from '../../src/delegate-extension.js';
import { FusionArtifactStore } from '../../src/core/fusion/artifacts.js';
import { defaultFusionModelConfig } from '../../src/core/fusion/config.js';
import {
  FUSION_RESULT_SCHEMA_VERSION,
  type FusionResultDetails,
  type ResolvedFusionModel,
  type ResolvedFusionModels,
} from '../../src/core/fusion/types.js';

type JsonObject = Record<PropertyKey, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string, message: string): JsonObject {
  const parsed = parseJsonText(text);
  assert.ok(isJsonObject(parsed), message);
  return parsed;
}

function requiredJsonObject(value: unknown, message: string): JsonObject {
  assert.ok(isJsonObject(value), message);
  return value;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid: number;
  killCalls: Array<NodeJS.Signals | undefined> = [];
  killImpl: (signal?: NodeJS.Signals) => boolean;

  constructor(pid: number, killImpl?: (signal?: NodeJS.Signals) => boolean) {
    super();
    this.pid = pid;
    this.killImpl = killImpl ?? (() => true);
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killCalls.push(signal);
    return this.killImpl(signal);
  }

  writeStdout(value: string): void {
    this.stdout.emit('data', Buffer.from(value, 'utf8'));
  }

  writeStderr(value: string): void {
    this.stderr.emit('data', Buffer.from(value, 'utf8'));
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }

  fail(error: Error): void {
    this.emit('error', error);
  }
}

interface SpawnRecord {
  child: FakeChild;
  shell: string;
  args: string[];
  options: Parameters<BackgroundTaskSpawn>[2];
}

interface HarnessOptions {
  platform?: NodeJS.Platform;
  maxRecentTasks?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  stopWaitMs?: number;
  taskAdmissionTimeoutMs?: number;
  attestedGitKillGraceMs?: number;
  attestedGitSpawn?: AttestedGitSpawn;
  killProcess?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
  killTree?: (
    pid: number,
    phase: WindowsKillPhase,
    signal?: AbortSignal,
  ) => Promise<TaskkillOutcome>;
  sendCompletionNotification?: (
    message: CompletionNotificationMessage,
    options: CompletionNotificationOptions,
  ) => void;
  publishTerminal?: (task: BgTaskSnapshot) => void;
  logger?: Pick<Console, 'error'>;
  makeTaskId?: () => string;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  childFactory?: (pid: number) => FakeChild;
  spawn?: BackgroundTaskSpawn;
  modelRegistry?: BackgroundTaskContext['modelRegistry'];
  reloadShellOwner?: ReloadShellOwnerHubV1;
}

async function createHarness(options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-registry-'));
  const cwd = join(root, 'project');
  await mkdir(cwd, { recursive: true });
  let pid = 4200;
  let idSeq = 0;
  const children: SpawnRecord[] = [];
  const notifications: Array<{
    message: CompletionNotificationMessage;
    options: CompletionNotificationOptions;
  }> = [];
  const errors: unknown[][] = [];
  let changes = 0;
  const registryOptions: ConstructorParameters<typeof BackgroundTaskRegistry>[0] = {
    logger: options.logger ?? {
      error: (...args: unknown[]) => {
        errors.push(args);
      },
    },
    makeTaskId: options.makeTaskId ?? (() => `bunit${String(++idSeq).padStart(3, '0')}`),
    sendCompletionNotification:
      options.sendCompletionNotification ??
      ((message, opts) => {
        notifications.push({ message, options: opts });
      }),
    onChange: () => {
      changes++;
    },
    ...(options.reloadShellOwner === undefined
      ? {}
      : { reloadShellOwner: options.reloadShellOwner }),
    spawn:
      options.spawn ??
      ((shell, args, spawnOptions) => {
        const child = options.childFactory?.(++pid) ?? new FakeChild(++pid);
        children.push({ child, shell, args: [...args], options: spawnOptions });
        return child;
      }),
  };
  if (options.publishTerminal !== undefined)
    registryOptions.publishTerminal = options.publishTerminal;
  if (options.platform !== undefined) registryOptions.platform = options.platform;
  if (options.env !== undefined) registryOptions.env = options.env;
  if (options.maxRecentTasks !== undefined) registryOptions.maxRecentTasks = options.maxRecentTasks;
  if (options.maxOutputBytes !== undefined) registryOptions.maxOutputBytes = options.maxOutputBytes;
  if (options.killGraceMs !== undefined) registryOptions.killGraceMs = options.killGraceMs;
  if (options.stopWaitMs !== undefined) registryOptions.stopWaitMs = options.stopWaitMs;
  if (options.taskAdmissionTimeoutMs !== undefined)
    registryOptions.taskAdmissionTimeoutMs = options.taskAdmissionTimeoutMs;
  if (options.attestedGitKillGraceMs !== undefined)
    registryOptions.attestedGitKillGraceMs = options.attestedGitKillGraceMs;
  if (options.attestedGitSpawn !== undefined)
    registryOptions.attestedGitSpawn = options.attestedGitSpawn;
  if (options.now !== undefined) registryOptions.now = options.now;
  if (options.killProcess !== undefined) registryOptions.killProcess = options.killProcess;
  if (options.killTree !== undefined) registryOptions.killTree = options.killTree;
  const registry = new BackgroundTaskRegistry(registryOptions);
  const ctx: BackgroundTaskContext = {
    cwd,
    sessionId: 'registry-test',
    modelRegistry: options.modelRegistry ?? { getAll: () => [] },
    model: undefined,
  };
  return {
    root,
    cwd,
    ctx,
    registry,
    children,
    notifications,
    errors,
    get changes() {
      return changes;
    },
  };
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function initCleanGit(cwd: string): Promise<void> {
  git(cwd, ['init']);
  git(cwd, ['config', 'user.email', 'pi-bg@example.invalid']);
  git(cwd, ['config', 'user.name', 'Pi BG Tests']);
  await writeFile(join(cwd, 'README.md'), 'clean\n', 'utf8');
  await writeFile(join(cwd, '.gitignore'), '.pi/\nreport.md\n', 'utf8');
  git(cwd, ['add', 'README.md', '.gitignore']);
  git(cwd, ['commit', '-m', 'init']);
}

function oauthModel(provider = 'openai-codex', modelId = 'gpt-5.5'): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: provider === 'anthropic' ? 'anthropic-messages' : 'openai-codex-responses',
    provider,
    baseUrl: 'https://example.invalid',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 4096,
  };
}

function oauthRegistry(model = oauthModel()): BackgroundTaskContext['modelRegistry'] {
  return {
    getAll: () => [model],
    find: (provider, modelId) =>
      provider === model.provider && modelId === model.id ? model : undefined,
    isUsingOAuth: () => true,
  };
}

function piJsonEvents(provider = 'openai-codex', model = 'gpt-5.5'): string {
  return (
    [
      {
        type: 'session',
        version: 3,
        id: 'pi-session-unit',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/unit',
      },
      { type: 'agent_start' },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          provider,
          model,
          usage: {
            input: 10,
            output: 4,
            cacheRead: 0,
            cacheWrite: 1,
            totalTokens: 15,
            cost: { total: 0.12 },
          },
          content: [{ type: 'text', text: 'attested done' }],
          stopReason: 'stop',
        },
      },
      { type: 'agent_end', messages: [] },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n') + '\n'
  );
}

async function cleanup(root: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !/ENOTEMPTY/.test(error.message) || attempt === 4)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message = 'condition',
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH');
  }
}

function pgidFor(pid: number): number | undefined {
  const result = spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const pgid = Number(result.stdout.trim());
  return Number.isSafeInteger(pgid) && pgid > 0 ? pgid : undefined;
}

function errnoError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function waitForPidExit(pid: number, label: string, timeoutMs = 1000): Promise<void> {
  await waitFor(() => !pidExists(pid), `${label} pid ${String(pid)} exit`, timeoutMs);
}

async function filesBelow(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) await visit(child);
      else files.push(child);
    }
  };
  await visit(path);
  return files;
}

async function readJsonEventually(path: string, timeoutMs = 1000): Promise<JsonObject> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = await readFile(path, 'utf8').catch(() => '');
    try {
      if (last.trim()) return parseJsonObject(last, 'metadata JSON must be an object');
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return parseJsonObject(last, 'metadata JSON must be an object');
}

function lastSpawn(h: Awaited<ReturnType<typeof createHarness>>): SpawnRecord {
  const spawn = h.children.at(-1);
  assert.ok(spawn, 'test harness should have recorded a child process spawn');
  return spawn;
}

function taskkillOutcome(exitCode: number | null, stderr = ''): TaskkillOutcome {
  return {
    exitCode,
    signal: null,
    stdout: '',
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  assert.ok(resolveFn, 'deferred resolve should initialize');
  assert.ok(rejectFn, 'deferred reject should initialize');
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function isKillRequester(value: unknown): value is (task: BgTask, signal?: NodeJS.Signals) => void {
  return typeof value === 'function';
}

function requestKillForTest(
  registry: BackgroundTaskRegistry,
  task: BgTask,
  signal?: NodeJS.Signals,
): void {
  const method = Reflect.get(registry, 'requestKill');
  assert.ok(isKillRequester(method), 'registry requestKill should be callable');
  method.call(registry, task, signal);
}

async function startFakeTask(
  h: Awaited<ReturnType<typeof createHarness>>,
  name = 'Registry Task',
): Promise<{ task: BgTask; child: FakeChild }> {
  const task = await h.registry.startTask(h.ctx, 'node fake.js', {
    name,
    isAgent: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true,
  });
  return { task, child: lastSpawn(h).child };
}

function resolvedFusionModel(qualifiedId: string): ResolvedFusionModel {
  const slash = qualifiedId.indexOf('/');
  return {
    selection: '$current',
    source: 'current',
    provider: qualifiedId.slice(0, slash),
    model: qualifiedId.slice(slash + 1),
    qualifiedId,
    thinkingLevel: 'medium',
    contextWindow: 1000,
    maxOutputTokens: 128,
  };
}

function resolvedFusionModels(): ResolvedFusionModels {
  return {
    candidates: [
      resolvedFusionModel('test/candidate-a'),
      resolvedFusionModel('test/candidate-b'),
      resolvedFusionModel('test/candidate-c'),
    ],
    evaluator: resolvedFusionModel('test/evaluator'),
    merger: resolvedFusionModel('test/merger'),
  };
}

async function createCommittedFusionResult(
  cwd: string,
  runId: string,
): Promise<{ store: FusionArtifactStore; details: FusionResultDetails }> {
  const store = await FusionArtifactStore.create({
    cwd,
    runId,
    source: 'tool',
    config: defaultFusionModelConfig(),
    models: resolvedFusionModels(),
  });
  await store.transition('candidates_running');
  await store.transition('candidates_complete');
  await store.transition('evaluating');
  await store.transition('evaluation_complete');
  await store.transition('merging');
  const merged = await store.writeMerged('retained fusion answer');
  const details: FusionResultDetails = {
    schema_version: FUSION_RESULT_SCHEMA_VERSION,
    run_id: runId,
    workflow: 'reason',
    source: 'tool',
    status: 'completed',
    context: { kind: 'session_projection', policy_id: 'retention-test' },
    tool_policy: { candidate_tools: [], evaluation_tools: [], merge_tools: [] },
    artifact_dir: store.artifactDir,
    models: store.snapshot().models,
    evaluator_attempts: 1,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    budget: {
      policy_id: 'retention-test',
      calibration_version: 'test',
      route_table: [],
      rate_sources: [],
      unknown_provider_warnings: [],
      calibration_warnings: [],
    },
  };
  await store.writeCommittedResult(merged, details);
  await store.transition('completed');
  return { store, details };
}

void describe('BackgroundTaskRegistry', () => {
  void it('validates reload survival before admission, filesystem, insertion, wrapper, or spawn', async () => {
    const hub = createReloadShellOwnerHubForTests();
    const h = await createHarness({ reloadShellOwner: hub });
    let ensureCalls = 0;
    const originalEnsureRuntimeDir = h.registry.ensureRuntimeDir.bind(h.registry);
    h.registry.ensureRuntimeDir = async (ctx) => {
      ensureCalls += 1;
      return originalEnsureRuntimeDir(ctx);
    };
    try {
      await assert.rejects(
        () =>
          h.registry.startTask(h.ctx, 'echo malformed', {
            isAgent: false,
            surviveReload: 'yes',
          } as never),
        /pi_bg_survive_reload_invalid/u,
      );
      await assert.rejects(
        () =>
          h.registry.startTask(h.ctx, 'pi -p agent', {
            isAgent: true,
            surviveReload: true,
          }),
        /pi_bg_survive_reload_requires_non_agent/u,
      );
      await assert.rejects(
        () =>
          h.registry.startTask(h.ctx, 'echo unavailable', {
            isAgent: false,
            surviveReload: true,
          }),
        /pi_bg_reload_owner_unavailable/u,
      );
      assert.equal(ensureCalls, 0);
      assert.equal(h.children.length, 0);
      assert.equal(h.registry.allTasks().length, 0);
      assert.deepEqual(await filesBelow(join(h.cwd, '.pi')), []);
    } finally {
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('starts a real owner-backed ordinary consumer only after activation and admission commit', async () => {
    const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 1000 });
    const h = await createHarness({
      reloadShellOwner: hub,
      killGraceMs: 10,
      stopWaitMs: 200,
      killProcess: () => true,
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const claim = hub.beginActivation(identity, 'startup', 'a'.repeat(32));
    const adapter = await h.registry.stageReloadActivation(claim);
    const lease = hub.commitActivation(claim, adapter);
    try {
      const task = await h.registry.startTask(h.ctx, 'node owner-consumer.js', {
        name: 'Owner consumer',
        isAgent: false,
        surviveReload: true,
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      const child = lastSpawn(h).child;
      assert.equal(task.surviveReload, true);
      const execution = task.reloadExecution;
      assert.ok(execution);
      assert.equal(execution.admissionCommitted, true);
      assert.equal(execution.child, child);
      assert.equal(task.reloadSurvival?.authority, 'same-process-live-owner');
      assert.equal(task.reloadSurvival?.hostPid, process.pid);
      assert.equal(task.reloadSurvival?.sessionId, h.ctx.sessionId);
      assert.equal(task.reloadSurvival?.cwdRealpath, realpathSync(h.cwd));
      assert.equal(task.reloadSurvival?.childPid, child.pid);
      assert.equal(task.reloadSurvival?.leaseGeneration, 1);
      assert.equal(task.reloadSurvival?.handoffCount, 0);
      assert.match(task.reloadSurvival?.launchNonce ?? '', /^[0-9a-f]{32}$/u);
      assert.equal(task.reloadSurvival?.completionId, `${task.id}:1`);
      assert.equal(
        task.telemetryWrapped,
        undefined,
        'opted ordinary work never creates a Pi wrapper',
      );
      assert.equal(hub.isCurrentLease(lease), true);

      child.writeStdout('owner-output\n');
      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'owner-backed completion');
      assert.equal(task.exitCode, 0);
      assert.equal(execution.closeObservation?.code, 0);
      await waitFor(
        () => task.reloadExecution === undefined,
        'released terminal execution reference',
      );
      assert.match(await readFile(task.outputAbsPath, 'utf8'), /owner-output/u);
      await waitFor(async () => {
        const metadata = await readJsonEventually(task.metadataAbsPath);
        return metadata['status'] === 'completed';
      }, 'owner metadata completion');
      const metadata = await readJsonEventually(task.metadataAbsPath);
      assert.equal(metadata['surviveReload'], true);
      assert.deepEqual(metadata['reloadSurvival'], task.reloadSurvival);
    } finally {
      h.registry.releaseReloadActivation(lease);
      h.registry.setShuttingDown(true);
      for (const { child } of h.children) {
        if (child.listenerCount('close') > 0) child.close(null, 'SIGTERM');
      }
      await cleanup(h.root);
    }
  });

  void it('retains a real failed-admission child owner until natural terminal settlement', async () => {
    if (process.platform === 'win32') return;
    const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 1000 });
    let projectCwd = '';
    let child: ReturnType<typeof spawn> | undefined;
    const signals: string[] = [];
    const h = await createHarness({
      reloadShellOwner: hub,
      stopWaitMs: 80,
      killGraceMs: 20,
      spawn: (command, args, options) => {
        rmSync(join(projectCwd, '.pi'), { recursive: true, force: true });
        child = spawn(command, args, options);
        return child;
      },
      killProcess: (_pid, signal) => {
        signals.push(String(signal));
        return true;
      },
    });
    projectCwd = h.cwd;
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const claim = hub.beginActivation(identity, 'startup', '1'.repeat(32));
    const lease = hub.commitActivation(claim, await h.registry.stageReloadActivation(claim));
    let execution = inspectReloadShellOwnerForTests(hub, identity).executions[0];
    let passingAssertionsCompleted = false;
    try {
      const launch = h.registry.startTask(
        h.ctx,
        `node -e ${JSON.stringify('setTimeout(() => process.exit(0), 260)')}`,
        {
          name: 'Failed admission owner retention',
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        },
      );
      await waitFor(() => {
        execution = inspectReloadShellOwnerForTests(hub, identity).executions[0];
        return execution !== undefined;
      }, 'failed-admission execution registration');
      await assert.rejects(launch, /cleanup also failed|Failed to start background task/u);

      const pid = child?.pid;
      assert.equal(typeof pid, 'number');
      assert.ok(execution);
      assert.equal(pidExists(pid as number), true, 'real child must still be live at rejection');
      assert.equal(h.registry.allTasks().length, 0, 'rejected launch must leave no registry task');
      assert.equal(inspectReloadShellOwnerForTests(hub, identity).executions.length, 1);
      assert.equal(execution.child, child, 'owner must retain the only live child handle');
      assert.notEqual(execution.phase, 'released');
      assert.notEqual(execution.task.status, 'completed', 'admission failure cannot fake success');
      assert.ok(signals.includes('SIGTERM'));
      assert.ok(signals.includes('SIGKILL'));

      h.registry.releaseReloadActivation(lease);
      const hostless = inspectReloadShellOwnerForTests(hub, identity);
      assert.equal(hostless.phase, 'releasing');
      assert.equal(hostless.hasAdapter, false);
      assert.equal(hostless.executions[0], execution, 'cleanup must not require a host adapter');
      assert.equal(execution.child, child);

      await waitFor(() => !pidExists(pid as number), 'failed-admission child natural exit', 2000);
      await waitFor(
        () => inspectReloadShellOwnerForTests(hub, identity).executions.length === 0,
        'failed-admission owner terminal release',
        2000,
      );
      assert.equal(execution.phase, 'released');
      assert.equal(execution.child, undefined);
      assert.equal(execution.task.status, 'failed');
      passingAssertionsCompleted = true;
    } finally {
      const pid = child?.pid;
      if (!passingAssertionsCompleted && pid !== undefined && pidExists(pid)) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Failure-only rescue; passing assertions require natural settlement.
          }
        }
        await waitFor(() => !pidExists(pid), 'failed-admission failure-only cleanup', 2000).catch(
          () => undefined,
        );
      }
      h.registry.releaseReloadActivation(lease);
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('carries the R1 publication ledger across handoff with one cumulative three-attempt budget', async () => {
    const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 1000 });
    let oldAttempts = 0;
    const h = await createHarness({
      reloadShellOwner: hub,
      publishTerminal: () => {
        oldAttempts += 1;
        throw new Error('old activation listener failure');
      },
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const firstClaim = hub.beginActivation(identity, 'startup', '9'.repeat(32));
    const firstAdapter = await h.registry.stageReloadActivation(firstClaim);
    const firstLease = hub.commitActivation(firstClaim, firstAdapter);
    let freshLease: ReloadShellActivationLeaseV1 | undefined;
    let fresh: BackgroundTaskRegistry | undefined;
    try {
      const task = await h.registry.startTask(h.ctx, 'node publication-owner.js', {
        name: 'Publication owner',
        isAgent: false,
        surviveReload: true,
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      const child = lastSpawn(h).child;
      child.close(0, null);
      await waitFor(
        () => task.terminalPublishAttempts === 1 && task.terminalPublishRetryHandle !== undefined,
        'first owner publication retry',
      );
      assert.equal(task.terminalPublicationState, 'pending');
      h.registry.prepareReloadHandoff(firstLease);
      assert.equal(task.terminalPublishRetryHandle, undefined);

      const freshPublications: BgTaskSnapshot[] = [];
      fresh = new BackgroundTaskRegistry({
        reloadShellOwner: hub,
        sendCompletionNotification() {},
        publishTerminal: (terminal) => freshPublications.push(terminal),
        spawn: () => {
          throw new Error('fresh registry must not respawn terminal execution');
        },
      });
      const claim = hub.beginActivation(identity, 'reload', 'a'.repeat(31) + 'b');
      const adapter = await fresh.stageReloadActivation(claim);
      freshLease = hub.commitActivation(claim, adapter);
      await waitFor(() => task.terminalPublicationState === 'delivered', 'fresh publication');
      assert.equal(oldAttempts, 1);
      assert.equal(task.terminalPublishAttempts, 2);
      assert.equal(task.terminalPublished, true);
      assert.equal(freshPublications.filter((entry) => entry.id === task.id).length, 1);
      await waitFor(() => task.reloadExecution === undefined, 'published owner release');
    } finally {
      if (fresh !== undefined && freshLease !== undefined) {
        fresh.releaseReloadActivation(freshLease);
        fresh.setShuttingDown(true);
      }
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('leaves a reentrant reload throw pending for cumulative fresh attempt two', async () => {
    const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 1000 });
    let oldLease: ReloadShellActivationLeaseV1 | undefined;
    let detached = false;
    let oldAttempts = 0;
    const h = await createHarness({
      reloadShellOwner: hub,
      publishTerminal: () => {
        oldAttempts += 1;
        const lease = oldLease;
        if (lease === undefined) throw new Error('old lease was not initialized');
        if (!detached) {
          detached = true;
          h.registry.prepareReloadHandoff(lease);
          h.registry.closeTerminalPublication('publisher_closed');
        }
        throw new Error('synthetic listener failure after reentrant reload detach');
      },
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const firstClaim = hub.beginActivation(identity, 'startup', '2'.repeat(32));
    oldLease = hub.commitActivation(firstClaim, await h.registry.stageReloadActivation(firstClaim));
    let fresh: BackgroundTaskRegistry | undefined;
    let freshLease: ReloadShellActivationLeaseV1 | undefined;
    try {
      const task = await h.registry.startTask(h.ctx, 'node reentrant-publication.js', {
        name: 'Reentrant publication handoff',
        isAgent: false,
        surviveReload: true,
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      lastSpawn(h).child.close(0, null);
      await waitFor(() => detached, 'reentrant publication detach');
      await waitFor(() => task.status === 'completed', 'reentrant publication terminal');

      const stateAfterThrow = task.terminalPublicationState;
      const reasonAfterThrow = task.terminalPublicationAbandonReason;
      const attemptsAfterThrow = task.terminalPublishAttempts;
      const retryAfterThrow = task.terminalPublishRetryHandle;
      const oldErrorCount = h.errors.length;

      const freshPublications: BgTaskSnapshot[] = [];
      fresh = new BackgroundTaskRegistry({
        reloadShellOwner: hub,
        sendCompletionNotification() {},
        publishTerminal: (terminal) => freshPublications.push(terminal),
        spawn: () => {
          throw new Error('fresh registry must not respawn a terminal execution');
        },
      });
      const claim = hub.beginActivation(identity, 'reload', '3'.repeat(32));
      freshLease = hub.commitActivation(claim, await fresh.stageReloadActivation(claim));
      await waitFor(() => task.reloadExecution === undefined, 'reentrant owner release');

      assert.equal(stateAfterThrow, 'pending');
      assert.equal(reasonAfterThrow, undefined);
      assert.equal(attemptsAfterThrow, 1);
      assert.equal(retryAfterThrow, undefined, 'old registry must not schedule a retry');
      assert.equal(oldErrorCount, 0, 'transferred throw must not log old-host abandonment');
      assert.equal(oldAttempts, 1);
      assert.equal(task.terminalPublicationState, 'delivered');
      assert.equal(task.terminalPublicationAbandonReason, undefined);
      assert.equal(task.terminalPublishAttempts, 2);
      assert.equal(freshPublications.filter((entry) => entry.id === task.id).length, 1);
      assert.deepEqual(inspectReloadShellOwnerForTests(hub, identity).executions, []);
    } finally {
      if (fresh !== undefined && freshLease !== undefined) {
        fresh.releaseReloadActivation(freshLease);
        fresh.setShuttingDown(true);
      }
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('imports the same execution into a fresh registry and keeps one cumulative output cap', async () => {
    const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 1000 });
    let child: FakeChild | undefined;
    let groupPresent = true;
    const killProcess = (_pid: number, signal?: NodeJS.Signals | number): boolean => {
      if (signal === 0) {
        if (groupPresent) return true;
        throw errnoError('ESRCH', 'group gone');
      }
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        groupPresent = false;
        queueMicrotask(() => child?.close(null, signal));
        return true;
      }
      return true;
    };
    const h = await createHarness({
      reloadShellOwner: hub,
      maxOutputBytes: 10,
      killGraceMs: 10,
      stopWaitMs: 200,
      killProcess,
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const initialClaim = hub.beginActivation(identity, 'startup', 'c'.repeat(32));
    const initialAdapter = await h.registry.stageReloadActivation(initialClaim);
    const initialLease = hub.commitActivation(initialClaim, initialAdapter);
    let freshLease: ReloadShellActivationLeaseV1 | undefined;
    let fresh: BackgroundTaskRegistry | undefined;
    try {
      const task = await h.registry.startTask(h.ctx, 'node cap-owner.js', {
        name: 'Cumulative cap',
        isAgent: false,
        surviveReload: true,
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      child = lastSpawn(h).child;
      child.writeStdout('123456');
      assert.equal(task.bytesWritten, 6);
      const execution = task.reloadExecution;
      assert.ok(execution);
      h.registry.prepareReloadHandoff(initialLease);

      const published: BgTaskSnapshot[] = [];
      fresh = new BackgroundTaskRegistry({
        reloadShellOwner: hub,
        maxOutputBytes: 10,
        killGraceMs: 10,
        stopWaitMs: 200,
        killProcess,
        platform: process.platform,
        env: process.env,
        sendCompletionNotification() {},
        publishTerminal: (terminal) => published.push(terminal),
        spawn: () => {
          throw new Error('fresh registry must not respawn a claimed execution');
        },
      });
      const claim = hub.beginActivation(identity, 'reload', 'd'.repeat(32));
      const adapter = await fresh.stageReloadActivation(claim);
      freshLease = hub.commitActivation(claim, adapter);
      assert.equal(fresh.resolveTask(task.id), task);
      assert.equal(task.reloadExecution, execution);
      assert.equal(task.bytesWritten, 6);

      child.writeStdout('789012');
      await waitFor(() => task.status === 'failed', 'cumulative cap terminal');
      assert.equal(task.capExceeded, true);
      assert.match(task.error ?? '', /Output exceeded cap of 10B/u);
      assert.equal(task.reloadSurvival?.outputCapBytes, 10);
      assert.equal(task.reloadSurvival?.handoffCount, 1);
      assert.equal(published.filter((entry) => entry.id === task.id).length, 1);
      const logs = await fresh.getTaskLogs(task, 1024, true);
      assert.match(logs.text, /1234567890/u);
      assert.doesNotMatch(logs.text, /123456789012/u);
      await waitFor(() => task.reloadExecution === undefined, 'cap owner release');
    } finally {
      if (fresh !== undefined && freshLease !== undefined) {
        fresh.releaseReloadActivation(freshLease);
        fresh.setShuttingDown(true);
      }
      h.registry.setShuttingDown(true);
      child?.close(null, 'SIGTERM');
      await cleanup(h.root);
    }
  });

  void it('retains injected Windows taskkill tree authority across a registry handoff', async () => {
    const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 1000 });
    const phases: WindowsKillPhase[] = [];
    let child: FakeChild | undefined;
    let softAborted = 0;
    const killTree = async (
      _pid: number,
      phase: WindowsKillPhase,
      signal?: AbortSignal,
    ): Promise<TaskkillOutcome> => {
      phases.push(phase);
      if (phase === 'terminate') {
        return new Promise<TaskkillOutcome>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              softAborted += 1;
              resolve(taskkillOutcome(null, 'aborted'));
            },
            { once: true },
          );
        });
      }
      queueMicrotask(() => child?.close(null, 'SIGTERM'));
      return taskkillOutcome(0);
    };
    const h = await createHarness({
      reloadShellOwner: hub,
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe' },
      killTree,
      killGraceMs: 10,
      stopWaitMs: 300,
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const firstClaim = hub.beginActivation(identity, 'startup', 'e'.repeat(32));
    const firstAdapter = await h.registry.stageReloadActivation(firstClaim);
    const firstLease = hub.commitActivation(firstClaim, firstAdapter);
    let freshLease: ReloadShellActivationLeaseV1 | undefined;
    let fresh: BackgroundTaskRegistry | undefined;
    try {
      const task = await h.registry.startTask(h.ctx, 'echo windows-owner', {
        name: 'Windows owner',
        isAgent: false,
        surviveReload: true,
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      child = lastSpawn(h).child;
      const originalExecution = task.reloadExecution;
      h.registry.prepareReloadHandoff(firstLease);

      fresh = new BackgroundTaskRegistry({
        reloadShellOwner: hub,
        platform: 'win32',
        env: { SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe' },
        killTree,
        killGraceMs: 10,
        stopWaitMs: 300,
        sendCompletionNotification() {},
        spawn: () => {
          throw new Error('claimed Windows execution must not respawn');
        },
      });
      const claim = hub.beginActivation(identity, 'reload', 'f'.repeat(32));
      const adapter = await fresh.stageReloadActivation(claim);
      freshLease = hub.commitActivation(claim, adapter);
      assert.equal(task.reloadExecution, originalExecution);
      assert.equal(task.reloadExecution?.child, child);

      await fresh.stopTask(task, 'user');
      assert.equal(task.status, 'killed');
      assert.deepEqual(phases, ['terminate', 'force']);
      assert.equal(softAborted, 1);
      assert.deepEqual(
        child.killCalls,
        [],
        'Windows owner must never fall back to root-only child.kill',
      );
      await waitFor(() => task.reloadExecution === undefined, 'Windows owner release');
    } finally {
      if (fresh !== undefined && freshLease !== undefined) {
        fresh.releaseReloadActivation(freshLease);
        fresh.setShuttingDown(true);
      }
      h.registry.setShuttingDown(true);
      child?.close(null, 'SIGTERM');
      await cleanup(h.root);
    }
  });

  void it('uses the short no-claim seam to stop and reap a real opted process without adoption', async () => {
    if (process.platform === 'win32') return;
    const hub = createReloadShellOwnerHubForTests({
      handoffTimeoutMs: 40,
      logger: { error() {} },
    });
    const h = await createHarness({
      reloadShellOwner: hub,
      spawn: (command, args, options) => spawn(command, args, options),
      killGraceMs: 20,
      stopWaitMs: 500,
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const claim = hub.beginActivation(identity, 'startup', 'b'.repeat(32));
    const adapter = await h.registry.stageReloadActivation(claim);
    const lease = hub.commitActivation(claim, adapter);
    let pid: number | undefined;
    try {
      const task = await h.registry.startTask(
        h.ctx,
        `node -e ${JSON.stringify('setInterval(() => {}, 1000)')}`,
        {
          name: 'No claimant',
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        },
      );
      pid = task.pid;
      assert.equal(typeof pid, 'number');
      const execution = task.reloadExecution;
      assert.ok(execution);
      h.registry.prepareReloadHandoff(lease);
      await waitFor(() => execution.phase === 'released', 'orphan owner release', 2000);
      assert.equal(task.status, 'failed');
      assert.match(task.error ?? '', /pi_bg_reload_handoff_expired/u);
      assert.equal(task.terminalPublicationState, 'abandoned');
      assert.equal(task.terminalPublicationAbandonReason, 'reload_handoff_expired');
      if (pid !== undefined) assert.equal(pidExists(pid), false);
      assert.deepEqual(inspectReloadShellOwnerForTests(hub, identity).executions, []);
    } finally {
      if (pid !== undefined && pidExists(pid)) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Failure-only rescue; passing assertions above require this to be unnecessary.
        }
      }
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('releases a real late-closing child after handoff deadline stop timeout', async () => {
    if (process.platform === 'win32') return;
    const logs: string[] = [];
    const hub = createReloadShellOwnerHubForTests({
      handoffTimeoutMs: 20,
      logger: { error: (...args: unknown[]) => logs.push(args.map(String).join(' ')) },
    });
    let child: ReturnType<typeof spawn> | undefined;
    const h = await createHarness({
      reloadShellOwner: hub,
      stopWaitMs: 100,
      killGraceMs: 25,
      spawn: (command, args, options) => {
        child = spawn(command, args, options);
        return child;
      },
      killProcess: () => true,
    });
    const identity = makeReloadShellIdentity(h.ctx.sessionId ?? '', realpathSync(h.cwd));
    const claim = hub.beginActivation(identity, 'startup', '4'.repeat(32));
    const lease = hub.commitActivation(claim, await h.registry.stageReloadActivation(claim));
    let replacementLease: ReloadShellActivationLeaseV1 | undefined;
    let passingAssertionsCompleted = false;
    try {
      const task = await h.registry.startTask(
        h.ctx,
        `node -e ${JSON.stringify('setTimeout(() => process.exit(0), 260)')}`,
        {
          name: 'Deadline late close',
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        },
      );
      const pid = child?.pid;
      const execution = task.reloadExecution;
      assert.equal(typeof pid, 'number');
      assert.ok(execution);
      h.registry.prepareReloadHandoff(lease);

      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.equal(pidExists(pid as number), false);
      assert.equal(task.status, 'failed');
      assert.match(task.error ?? '', /pi_bg_reload_handoff_expired/u);
      assert.equal(execution.phase, 'released');
      assert.equal(execution.child, undefined);
      assert.deepEqual(inspectReloadShellOwnerForTests(hub, identity).executions, []);
      assert.match(logs.join('\n'), /reload handoff expiry could not settle/u);

      const replacement = hub.beginActivation(identity, 'startup', '5'.repeat(32));
      replacementLease = hub.commitActivation(
        replacement,
        await h.registry.stageReloadActivation(replacement),
      );
      assert.equal(hub.isCurrentLease(replacementLease), true);
      passingAssertionsCompleted = true;
    } finally {
      const pid = child?.pid;
      if (!passingAssertionsCompleted && pid !== undefined && pidExists(pid)) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Failure-only rescue; passing assertions require the natural close.
          }
        }
        await waitFor(
          () => !pidExists(pid),
          'deadline late-close failure-only cleanup',
          2000,
        ).catch(() => undefined);
      }
      if (replacementLease !== undefined) h.registry.releaseReloadActivation(replacementLease);
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('rejects survival-shaped managed, delegate, and attested registry requests', async () => {
    const h = await createHarness();
    const managedCompletion = Promise.resolve();
    try {
      await assert.rejects(
        () =>
          h.registry.startManagedTask(
            h.ctx,
            Object.assign(
              {
                id: 'reason-survival-refusal00000000000000',
                name: 'managed refusal',
                command: 'fusion_reason',
                isAgent: true,
                completion: managedCompletion,
                cancel() {},
                notifyOnCompletion: false,
                triggerOnCompletion: false,
                fusion: {
                  runId: 'reason-survival-refusal00000000000000',
                  workflow: 'reason' as const,
                  artifactDir: '.pi/fusion/refusal',
                  artifactDirAbs: join(h.cwd, '.pi', 'fusion', 'refusal'),
                  state: 'initializing',
                  usageDelivered: false,
                },
              },
              { surviveReload: true },
            ),
          ),
        /pi_bg_survive_reload_unsupported_task_kind/u,
      );
      await assert.rejects(
        () =>
          h.registry.startDelegateTask(
            h.ctx,
            Object.assign(
              {
                name: 'delegate refusal',
                argv: [],
                stdinBytes: Buffer.from('seed'),
                env: {},
                facts: {
                  taskId: 'delegate-survival-refusal',
                  launchNonce: 'f'.repeat(32),
                  artifactDir: '.pi/delegate/refusal',
                  artifactDirAbs: join(h.cwd, '.pi', 'delegate', 'refusal'),
                  seedSha256: '0'.repeat(64),
                  childSessionId: 'child-refusal',
                  route: { provider: 'test', model: 'test', qualifiedId: 'test/test' },
                  budget: Object.create(null),
                  extensionMode: 'isolated' as const,
                  autoDeliver: 'never' as const,
                },
                notifyOnCompletion: false,
                triggerOnCompletion: false,
              },
              { surviveReload: true },
            ),
          ),
        /pi_bg_survive_reload_unsupported_task_kind/u,
      );
      await assert.rejects(
        () =>
          h.registry.startAttestedPiTask(
            h.ctx,
            Object.assign(
              {
                name: 'attested refusal',
                provider: 'openai-codex',
                model: 'gpt-test',
                prompt: 'no launch',
                reportPath: 'report.md',
              },
              { surviveReload: true },
            ),
          ),
        /pi_bg_survive_reload_unsupported_task_kind/u,
      );
      assert.equal(h.children.length, 0);
      assert.deepEqual(await filesBelow(join(h.cwd, '.pi')), []);
    } finally {
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('closes and drains every starter admission before late insertion or spawn', async () => {
    const h = await createHarness({ modelRegistry: oauthRegistry() });
    const releaseEnsure = deferred<void>();
    const allEnteredEnsure = deferred<void>();
    const managedCompletion = deferred<void>();
    const originalEnsureRuntimeDir = h.registry.ensureRuntimeDir.bind(h.registry);
    let ensureEntries = 0;
    let managedCancels = 0;
    h.registry.ensureRuntimeDir = async (ctx) => {
      ensureEntries += 1;
      if (ensureEntries === 4) allEnteredEnsure.resolve(undefined);
      await releaseEnsure.promise;
      return originalEnsureRuntimeDir(ctx);
    };
    try {
      await initCleanGit(h.cwd);
      const delegateRequest: StartDelegateTaskOptions = Object.assign(Object.create(null), {
        name: 'admission delegate',
        argv: [],
        stdinBytes: Buffer.from('seed', 'utf8'),
        env: {},
        facts: {
          taskId: 'delegate-admission-test',
          route: { qualifiedId: 'test/delegate-model' },
        },
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      const starts = [
        h.registry.startTask(h.ctx, 'node ordinary-admission.js', {
          name: 'ordinary admission',
          notifyOnCompletion: false,
        }),
        h.registry.startManagedTask(h.ctx, {
          id: 'reason-admissionmanaged0000000000000000',
          name: 'managed admission',
          command: 'fusion_reason',
          isAgent: true,
          completion: managedCompletion.promise,
          cancel: () => {
            managedCancels += 1;
            managedCompletion.resolve(undefined);
          },
          notifyOnCompletion: false,
          triggerOnCompletion: false,
          fusion: {
            runId: 'reason-admissionmanaged0000000000000000',
            workflow: 'reason',
            artifactDir: '.pi/fusion/admission-managed',
            artifactDirAbs: join(h.cwd, '.pi', 'fusion', 'admission-managed'),
            state: 'initializing',
            usageDelivered: false,
          },
        }),
        h.registry.startDelegateTask(h.ctx, delegateRequest),
        h.registry.startAttestedPiTask(h.ctx, {
          name: 'attested admission',
          provider: 'openai-codex',
          model: 'gpt-5.5',
          prompt: 'write report.md',
          reportPath: 'report.md',
        }),
      ];
      await allEnteredEnsure.promise;

      h.registry.setShuttingDown(true);
      const waitForAdmissions = Reflect.get(h.registry, 'waitForTaskAdmissions');
      const admissionsDrained =
        typeof waitForAdmissions === 'function'
          ? Promise.resolve(Reflect.apply(waitForAdmissions, h.registry, []))
          : Promise.resolve();
      releaseEnsure.resolve(undefined);
      const results = await Promise.allSettled(starts);
      await admissionsDrained;

      assert.deepEqual(
        results.map((result) => result.status),
        ['rejected', 'rejected', 'rejected', 'rejected'],
        'ordinary, managed, delegate, and attested starters must all reject after closure',
      );
      assert.equal(h.children.length, 0, 'no starter may spawn after admission closure');
      assert.equal(h.registry.allTasks().length, 0, 'late preflight must not insert tasks');
      assert.equal(managedCancels, 1, 'managed preflight cancellation must not leak its workflow');
    } finally {
      releaseEnsure.resolve(undefined);
      managedCompletion.resolve(undefined);
      h.registry.ensureRuntimeDir = originalEnsureRuntimeDir;
      h.registry.setShuttingDown(true);
      for (const { child } of h.children) child.close(null, 'SIGTERM');
      await cleanup(h.root);
    }
  });

  void it('waits for cancelled pre-insertion managed work to settle before releasing admission', async () => {
    const h = await createHarness();
    const enteredEnsure = deferred<void>();
    const releaseEnsure = deferred<void>();
    const completion = deferred<void>();
    const originalEnsureRuntimeDir = h.registry.ensureRuntimeDir.bind(h.registry);
    let cancels = 0;
    h.registry.ensureRuntimeDir = async (ctx) => {
      enteredEnsure.resolve(undefined);
      await releaseEnsure.promise;
      return originalEnsureRuntimeDir(ctx);
    };
    try {
      const start = h.registry.startManagedTask(h.ctx, {
        id: 'reason-managedcleanup000000000000000000',
        name: 'managed cleanup admission',
        command: 'fusion_reason',
        isAgent: true,
        completion: completion.promise,
        cancel: () => {
          cancels += 1;
        },
        notifyOnCompletion: false,
        triggerOnCompletion: false,
        fusion: {
          runId: 'reason-managedcleanup000000000000000000',
          workflow: 'reason',
          artifactDir: '.pi/fusion/managed-cleanup',
          artifactDirAbs: join(h.cwd, '.pi', 'fusion', 'managed-cleanup'),
          state: 'initializing',
          usageDelivered: false,
        },
      });
      await enteredEnsure.promise;

      h.registry.setShuttingDown(true);
      const drain = h.registry.waitForTaskAdmissions();
      releaseEnsure.resolve(undefined);
      await waitFor(() => cancels === 1, 'managed preflight cancellation');
      assert.equal(
        await settlesWithin(drain, 30),
        false,
        'admission must remain owned until managed cleanup completion settles',
      );
      assert.equal(
        await settlesWithin(start, 30),
        false,
        'starter must remain unsettled until managed cleanup completion settles',
      );

      completion.resolve(undefined);
      await assert.rejects(start, /admission|closed/i);
      await drain;
      assert.equal(h.registry.allTasks().length, 0);
      assert.equal(h.children.length, 0);
    } finally {
      releaseEnsure.resolve(undefined);
      completion.resolve(undefined);
      h.registry.ensureRuntimeDir = originalEnsureRuntimeDir;
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it('enforces the admission-owned deadline while Git is running', async () => {
    if (process.platform === 'win32') return;
    const gitChild = new FakeChild(9101);
    const gitSignals: NodeJS.Signals[] = [];
    let gitSpawns = 0;
    const h = await createHarness({
      modelRegistry: oauthRegistry(),
      taskAdmissionTimeoutMs: 20,
      attestedGitKillGraceMs: 5,
      attestedGitSpawn: (_command, _args, options) => {
        gitSpawns += 1;
        assert.equal(options.detached, process.platform !== 'win32');
        return gitChild;
      },
      killProcess: (_pid, signal) => {
        if (typeof signal === 'string') gitSignals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => gitChild.close(null, 'SIGKILL'));
        return true;
      },
    });
    try {
      const start = h.registry.startAttestedPiTask(h.ctx, {
        name: 'deadline Git admission',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        prompt: 'write report.md',
        reportPath: 'report.md',
      });
      await assert.rejects(start, (error: unknown) => {
        if (typeof error !== 'object' || error === null) return false;
        const code = Reflect.get(error, 'code');
        return code === 'pi_background_tasks_admission_timeout' || code === 'attested_git_timeout';
      });
      await h.registry.waitForTaskAdmissions();
      assert.equal(gitSpawns, 1);
      assert.deepEqual(gitSignals, ['SIGTERM', 'SIGKILL']);
      assert.equal(h.registry.allTasks().length, 0);
      assert.equal(h.children.length, 0, 'deadline preflight must not spawn Pi');
      assert.deepEqual(await filesBelow(join(h.cwd, '.pi', 'tasks')), []);
    } finally {
      h.registry.setShuttingDown(true);
      await cleanup(h.root);
    }
  });

  void it(
    'cancels and reaps a real hanging attested Git preflight tree before admission drain',
    { timeout: 5000 },
    async () => {
      if (process.platform === 'win32') return;
      const h = await createHarness({
        modelRegistry: oauthRegistry(),
        taskAdmissionTimeoutMs: 2000,
        attestedGitKillGraceMs: 25,
      });
      const bin = join(h.root, 'bin');
      const gitPidPath = join(h.root, 'git.pid');
      const descendantPidPath = join(h.root, 'git-descendant.pid');
      await mkdir(bin, { recursive: true });
      const fakeGit = join(bin, 'git');
      await writeFile(
        fakeGit,
        `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.PI_BG_TEST_GIT_PID_FILE, String(process.pid));
const child = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
writeFileSync(process.env.PI_BG_TEST_GIT_DESCENDANT_PID_FILE, String(child.pid));
setInterval(() => {}, 1000);
`,
        'utf8',
      );
      await chmod(fakeGit, 0o755);

      const oldPath = process.env['PATH'];
      const oldGitPidPath = process.env['PI_BG_TEST_GIT_PID_FILE'];
      const oldDescendantPidPath = process.env['PI_BG_TEST_GIT_DESCENDANT_PID_FILE'];
      process.env['PATH'] = `${bin}:${oldPath ?? ''}`;
      process.env['PI_BG_TEST_GIT_PID_FILE'] = gitPidPath;
      process.env['PI_BG_TEST_GIT_DESCENDANT_PID_FILE'] = descendantPidPath;
      let gitPid: number | undefined;
      let descendantPid: number | undefined;
      let assertionsComplete = false;
      try {
        const start = h.registry.startAttestedPiTask(h.ctx, {
          name: 'real hanging Git admission',
          provider: 'openai-codex',
          model: 'gpt-5.5',
          prompt: 'write report.md',
          reportPath: 'report.md',
        });
        await waitFor(
          () => existsSync(gitPidPath) && existsSync(descendantPidPath),
          'fake Git process tree pid files',
          1500,
        );
        gitPid = Number((await readFile(gitPidPath, 'utf8')).trim());
        descendantPid = Number((await readFile(descendantPidPath, 'utf8')).trim());
        assert.ok(Number.isSafeInteger(gitPid) && gitPid > 0);
        assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);

        const shutdownStarted = Date.now();
        h.registry.setShuttingDown(true);
        const drain = h.registry.waitForTaskAdmissions();
        const [startResult] = await withTimeout(
          Promise.all([Promise.allSettled([start]), drain]),
          1500,
          'attested start/admission drain exceeded 1500ms',
        );
        assert.equal(startResult[0]?.status, 'rejected');
        assert.ok(Date.now() - shutdownStarted < 1500);
        await waitForPidExit(gitPid, 'fake Git root');
        await waitForPidExit(descendantPid, 'fake Git descendant');
        assert.equal(h.registry.allTasks().length, 0, 'preflight must not register a task');
        assert.equal(h.children.length, 0, 'preflight must not spawn Pi');
        assert.deepEqual(
          await filesBelow(join(h.cwd, '.pi', 'tasks')),
          [],
          'cancelled preflight must leave no task artifacts',
        );
        assertionsComplete = true;
      } finally {
        // Rescue is failure-only. A passing regression must prove production
        // cancellation reaped both processes without help from the test.
        if (!assertionsComplete) {
          for (const pid of [descendantPid, gitPid]) {
            if (pid === undefined || !pidExists(pid)) continue;
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // Already exited.
            }
          }
        }
        if (oldPath === undefined) delete process.env['PATH'];
        else process.env['PATH'] = oldPath;
        if (oldGitPidPath === undefined) delete process.env['PI_BG_TEST_GIT_PID_FILE'];
        else process.env['PI_BG_TEST_GIT_PID_FILE'] = oldGitPidPath;
        if (oldDescendantPidPath === undefined)
          delete process.env['PI_BG_TEST_GIT_DESCENDANT_PID_FILE'];
        else process.env['PI_BG_TEST_GIT_DESCENDANT_PID_FILE'] = oldDescendantPidPath;
        h.registry.setShuttingDown(true);
        await cleanup(h.root);
      }
    },
  );

  void it('preserves full shell command bytes except surrounding whitespace', async () => {
    const h = await createHarness({ platform: 'linux' });
    try {
      const command = `'${process.execPath}' '${join(h.cwd, 'bin', 'autopilot-agent-run.mjs')}' --spec '${join(h.cwd, 'specs', 'unit spec.json')}'`;
      const task = await h.registry.startTask(h.ctx, `  ${command}  `, {
        name: 'Quoted Runner',
        isAgent: true,
        notifyOnCompletion: false,
      });
      const spawn = lastSpawn(h);
      assert.equal(task.command, command);
      assert.equal(spawn.args.at(-1), command);
      assert.equal(JSON.parse(readFileSync(task.metadataAbsPath, 'utf8')).command, command);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('uses explicit isAgent to decide Pi telemetry wrapping', async () => {
    assert.equal(commandMayLaunchPiAgent('pi -p hello'), true);
    assert.equal(
      commandMayLaunchPiAgent('/usr/local/bin/pi -p hello'),
      false,
      'shell-function wrapper cannot intercept path-qualified pi commands',
    );

    const h = await createHarness({ platform: 'linux' });
    try {
      const scriptLikePi = await h.registry.startTask(h.ctx, 'pi -p hello', {
        name: 'Plain Pi Script',
        isAgent: false,
        notifyOnCompletion: false,
      });
      assert.equal(scriptLikePi.isAgent, false);
      assert.doesNotMatch(lastSpawn(h).args.join('\n'), /pi-telemetry-wrapper/);

      const agentPi = await h.registry.startTask(h.ctx, 'pi -p hello', {
        name: 'Agent Pi',
        isAgent: true,
        notifyOnCompletion: false,
      });
      assert.equal(agentPi.isAgent, true);
      const wrappedCommand = lastSpawn(h).args.join('\n');
      assert.match(wrappedCommand, /pi\(\) \{ .*pi-telemetry-wrapper\.cjs/);
      assert.ok(wrappedCommand.includes(process.execPath));
      assert.doesNotMatch(wrappedCommand, /pi\(\) \{ node /);
      const wrapperPath = join(
        dirname(agentPi.outputAbsPath),
        `${agentPi.id}.pi-telemetry-wrapper.cjs`,
      );
      const wrapperSource = await readFile(wrapperPath, 'utf8');
      assert.match(wrapperSource, /const launch = /);
      assert.match(wrapperSource, /spawn\(launch\.executable, childArgs, \{[^}]*shell: false/);
      assert.doesNotMatch(wrapperSource, /spawn\("pi"/);
      assert.doesNotThrow(
        () => new Function('require', 'process', wrapperSource.replace(/^#!.*\n/, '')),
      );

      const pathQualifiedPi = await h.registry.startTask(h.ctx, '/usr/local/bin/pi -p hello', {
        name: 'Path Pi',
        isAgent: true,
        notifyOnCompletion: false,
      });
      assert.equal(pathQualifiedPi.isAgent, true);
      assert.doesNotMatch(lastSpawn(h).args.join('\n'), /pi-telemetry-wrapper/);
    } finally {
      await cleanup(h.root);
    }

    const disabled = await createHarness({
      env: { ...process.env, PI_BG_DISABLE_PI_TELEMETRY: '1' },
    });
    try {
      await disabled.registry.startTask(disabled.ctx, 'pi -p hello', {
        name: 'Disabled Agent',
        isAgent: true,
        notifyOnCompletion: false,
      });
      assert.doesNotMatch(lastSpawn(disabled).args.join('\n'), /pi-telemetry-wrapper/);
    } finally {
      await cleanup(disabled.root);
    }
  });

  void it('leaves Pi agent commands unchanged under Windows cmd and records telemetry unavailability', async () => {
    const h = await createHarness({
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    });
    try {
      const command = 'pi --mode json "hello & echo pwned"';
      const task = await h.registry.startTask(h.ctx, command, {
        name: 'Cmd Pi Agent',
        isAgent: true,
        notifyOnCompletion: false,
      });
      const spawn = lastSpawn(h);
      assert.equal(task.command, command);
      assert.equal(spawn.shell, 'C:\\Windows\\System32\\cmd.exe');
      assert.deepEqual(spawn.args, ['/d', '/s', '/c', `"${command}"`]);
      assert.equal(spawn.options.shell, undefined);
      assert.equal(spawn.options.windowsVerbatimArguments, true);
      assert.equal(task.telemetryWrapped, undefined);
      assert.equal(task.telemetryUnavailableReason, WIN32_CMD_PI_TELEMETRY_UNAVAILABLE_REASON);
      const files = await readdir(dirname(task.outputAbsPath));
      assert.equal(
        files.some((file) => file.includes('pi-telemetry-wrapper')),
        false,
      );
      const metadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'metadata must be an object',
      );
      assert.equal(
        metadata['telemetryUnavailableReason'],
        WIN32_CMD_PI_TELEMETRY_UNAVAILABLE_REASON,
      );
      spawn.child.close(0, null);
      await waitFor(() => task.status === 'completed', 'cmd telemetry task completion');
      assert.equal(await readFile(task.outputAbsPath, 'utf8'), '');
    } finally {
      await cleanup(h.root);
    }
  });

  void it('rejects unresolved Windows bash before creating a task', async () => {
    const h = await createHarness({ platform: 'win32', env: { PI_BG_SHELL: 'bash', PATH: '' } });
    try {
      await assert.rejects(
        h.registry.startTask(h.ctx, 'echo ok', { name: 'Bad Bash', notifyOnCompletion: false }),
        /could not resolve bash/,
      );
      assert.equal(h.children.length, 0);
      assert.equal(h.registry.allTasks().length, 0);
    } finally {
      await cleanup(h.root);
    }
  });

  void it(
    'retains an admission-owned POSIX group after leader close until its TERM-ignoring descendant is forced',
    { timeout: 5000 },
    async () => {
      if (process.platform === 'win32') return;
      const root = await mkdtemp(join(tmpdir(), 'pi-bg-inserted-tree-'));
      const cwd = join(root, 'project');
      const script = join(root, 'leader.mjs');
      const descendantScript = join(root, 'descendant.mjs');
      const rootPidPath = join(root, 'leader.pid');
      const descendantPidPath = join(root, 'descendant.pid');
      await mkdir(cwd, { recursive: true });
      await writeFile(
        descendantScript,
        [
          `import { writeFileSync } from 'node:fs';`,
          `process.on('SIGTERM', () => undefined);`,
          `writeFileSync(process.env.PI_BG_TREE_DESCENDANT_PID, String(process.pid));`,
          `setInterval(() => {}, 1000);`,
          '',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        script,
        [
          `import { spawn } from 'node:child_process';`,
          `import { writeFileSync } from 'node:fs';`,
          `process.on('SIGTERM', () => process.exit(0));`,
          `writeFileSync(process.env.PI_BG_TREE_ROOT_PID, String(process.pid));`,
          `spawn(process.execPath, [process.env.PI_BG_TREE_DESCENDANT_SCRIPT], { stdio: 'ignore' });`,
          `setInterval(() => {}, 1000);`,
          '',
        ].join('\n'),
        'utf8',
      );

      const enteredMetadata = deferred<void>();
      const releaseMetadata = deferred<void>();
      const terminalSnapshots: BgTaskSnapshot[] = [];
      const notifications: CompletionNotificationMessage[] = [];
      const killCalls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
      const registry = new BackgroundTaskRegistry({
        killGraceMs: 250,
        stopWaitMs: 800,
        env: {
          ...process.env,
          PI_BG_TREE_ROOT_PID: rootPidPath,
          PI_BG_TREE_DESCENDANT_PID: descendantPidPath,
          PI_BG_TREE_DESCENDANT_SCRIPT: descendantScript,
        },
        killProcess: (pid, signal) => {
          const call: { pid: number; signal?: NodeJS.Signals | number } = { pid };
          if (signal !== undefined) call.signal = signal;
          killCalls.push(call);
          return process.kill(pid, signal);
        },
        publishTerminal: (task) => terminalSnapshots.push(task),
        sendCompletionNotification: (message) => notifications.push(message),
      });
      const ctx: BackgroundTaskContext = {
        cwd,
        sessionId: 'inserted-process-tree',
        modelRegistry: { getAll: () => [] },
        model: undefined,
      };
      const originalWriteMetadata = Reflect.get(registry, 'writeMetadata');
      assert.equal(typeof originalWriteMetadata, 'function');
      let metadataCalls = 0;
      Reflect.set(
        registry,
        'writeMetadata',
        async function (this: BackgroundTaskRegistry, task: BgTask, signal?: AbortSignal) {
          metadataCalls += 1;
          if (metadataCalls === 1) {
            enteredMetadata.resolve(undefined);
            await releaseMetadata.promise;
          }
          return Reflect.apply(originalWriteMetadata, this, [task, signal]);
        },
      );

      let start: Promise<BgTask> | undefined;
      let rootPid: number | undefined;
      let descendantPid: number | undefined;
      let assertionsComplete = false;
      try {
        start = registry.startTask(
          ctx,
          `exec ${shellQuote(process.execPath)} ${shellQuote(script)}`,
          { name: 'inserted process tree', notifyOnCompletion: true },
        );
        await enteredMetadata.promise;
        await waitFor(
          () => existsSync(rootPidPath) && existsSync(descendantPidPath),
          'leader and descendant pid files',
          1500,
        );
        rootPid = Number((await readFile(rootPidPath, 'utf8')).trim());
        descendantPid = Number((await readFile(descendantPidPath, 'utf8')).trim());
        assert.ok(Number.isSafeInteger(rootPid) && rootPid > 0);
        assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
        assert.equal(pgidFor(descendantPid), rootPid, 'descendant must remain in the owned group');

        registry.setShuttingDown(true);
        const drain = registry.waitForTaskAdmissions();
        await waitForPidExit(rootPid, 'inserted task leader', 750);
        const task = registry.allTasks()[0];
        assert.ok(task, 'inserted task must remain registry-owned');
        assert.equal(pidExists(descendantPid), true, 'fixture descendant must survive group TERM');
        assert.equal(task.status, 'running', 'leader close cannot publish terminal tree cleanup');
        assert.ok(task.killEscalationTimer, 'leader close must retain the force owner');
        assert.equal(terminalSnapshots.length, 0);
        assert.equal(notifications.length, 0);

        releaseMetadata.resolve(undefined);
        const startResult = await start.then(
          () => 'fulfilled' as const,
          () => 'rejected' as const,
        );
        assert.equal(startResult, 'rejected');
        await drain;
        const stopResult = await registry.stopAllRunning(
          'shutdown',
          'Killed during inserted process-tree regression',
        );
        assert.deepEqual(stopResult, { stopped: 1, failures: [] });
        await waitForPidExit(descendantPid, 'inserted task descendant', 750);
        assert.equal(pidExists(rootPid), false);
        assert.equal(pidExists(descendantPid), false);
        assert.equal(task.status, 'killed');
        assert.equal(task.killEscalationTimer, undefined, 'tree owner must disarm after ESRCH');
        assert.equal(
          killCalls.filter((call) => call.signal === 'SIGKILL').length,
          1,
          'the owned process group must receive exactly one force signal',
        );
        assert.equal(terminalSnapshots.length, 0, 'shutdown publication remains suppressed');
        assert.equal(notifications.length, 0, 'shutdown notification remains suppressed');
        assertionsComplete = true;
      } finally {
        releaseMetadata.resolve(undefined);
        Reflect.set(registry, 'writeMetadata', originalWriteMetadata);
        registry.setShuttingDown(true);
        if (start !== undefined) await start.catch(() => undefined);
        // Rescue is failure-only: a green regression receives no test-originated signal.
        if (!assertionsComplete && rootPid !== undefined) {
          try {
            process.kill(-rootPid, 'SIGKILL');
          } catch {
            // The owned process group may already be gone.
          }
        }
        if (!assertionsComplete && descendantPid !== undefined && pidExists(descendantPid)) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
        if (descendantPid !== undefined && pidExists(descendantPid)) {
          await waitForPidExit(descendantPid, 'failure-only rescued descendant', 1500);
        }
        const cleanupTask = registry.allTasks()[0];
        if (cleanupTask?.status === 'running') {
          await registry
            .stopAllRunning('shutdown', 'Failure-only process-tree test cleanup')
            .catch(() => undefined);
        }
        if (cleanupTask !== undefined) {
          await waitFor(() => cleanupTask.status !== 'running', 'process-tree test finalization');
          await cleanupTask.metadataWriteChain?.catch(() => undefined);
        }
        await cleanup(root);
      }
    },
  );

  void it('publishes POSIX ownership and close listeners before an already-aborted admission can kill', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 20,
      stopWaitMs: 250,
      killProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGTERM') {
          groupAlive = false;
          childRef?.close(null, 'SIGTERM');
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    const originalSpawn = Reflect.get(h.registry, 'spawn');
    assert.equal(typeof originalSpawn, 'function');
    Reflect.set(
      h.registry,
      'spawn',
      (command: string, args: string[], options: Parameters<BackgroundTaskSpawn>[2]) => {
        const child = Reflect.apply(originalSpawn, h.registry, [command, args, options]);
        h.registry.setShuttingDown(true);
        return child;
      },
    );
    try {
      await assert.rejects(
        h.registry.startTask(h.ctx, 'node reentrant-admission-close.js', {
          name: 'Reentrant admission close',
          notifyOnCompletion: false,
        }),
        /admission|closed/i,
      );
      await h.registry.waitForTaskAdmissions();
      const task = h.registry.allTasks()[0];
      assert.ok(task, 'spawned task must remain registry-owned');
      await waitFor(() => task.status === 'killed', 'reentrant admission close finalization');
      assert.equal(signals.filter((signal) => signal === 'SIGTERM').length, 1);
      assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 0);
      assert.ok(signals.some((signal) => signal === 0));
      assert.equal(task.killEscalationTimer, undefined);
    } finally {
      groupAlive = false;
      Reflect.set(h.registry, 'spawn', originalSpawn);
      await cleanup(h.root);
    }
  });

  void it('holds ordinary POSIX terminal delivery through root-close-before-grace and shares one force', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    const terminals: BgTaskSnapshot[] = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 25,
      stopWaitMs: 300,
      publishTerminal: (task) => terminals.push(task),
      killProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGTERM') {
          childRef?.close(null, 'SIGTERM');
          return true;
        }
        if (signal === 'SIGKILL') {
          groupAlive = false;
          return true;
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'POSIX Root Close Barrier');
      const stops = [
        h.registry.stopTask(task, 'user'),
        h.registry.stopTask(task, 'user'),
        h.registry.stopTask(task, 'user'),
      ];
      assert.equal(task.status, 'running');
      assert.equal(terminals.length, 0, 'direct close must not publish before group force');
      await Promise.all(stops);
      assert.equal(signals.filter((signal) => signal === 'SIGTERM').length, 1);
      assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 1);
      assert.ok(
        signals.some((signal) => signal === 0),
        'group disappearance must be observed',
      );
      assert.equal(task.status, 'killed');
      assert.equal(task.killEscalationTimer, undefined);
      assert.equal(terminals.length, 1);
      assert.equal(terminals[0]?.status, 'killed');
      assert.equal(h.notifications.length, 1);
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('does not signal a released POSIX group during natural-close terminalization', async () => {
    let signalCalls = 0;
    const h = await createHarness({
      platform: 'linux',
      stopWaitMs: 250,
      killProcess: () => {
        signalCalls += 1;
        throw new Error('released group must not be signaled');
      },
    });
    try {
      const { task, child } = await startFakeTask(h, 'POSIX Natural Close Race');
      child.close(0, null);
      const stopped = await h.registry.stopTask(task, 'shutdown');
      assert.equal(stopped, task);
      assert.equal(task.status, 'completed');
      assert.equal(signalCalls, 0);
      assert.equal(task.ownedPosixProcessGroupId, undefined);
      assert.equal(task.posixProcessGroupSignalAuthorityReleased, true);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('disarms an already-gone POSIX group without a stale escalation or force signal', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 25,
      stopWaitMs: 300,
      killProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGTERM') {
          groupAlive = false;
          childRef?.close(null, 'SIGTERM');
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'POSIX Already Gone');
      await h.registry.stopTask(task, 'user');
      assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 0);
      assert.ok(signals.some((signal) => signal === 0));
      assert.equal(task.status, 'killed');
      assert.equal(task.killEscalationTimer, undefined);
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 0);
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('turns POSIX group force failure into loud failed terminal truth', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const terminals: BgTaskSnapshot[] = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 20,
      stopWaitMs: 250,
      publishTerminal: (task) => terminals.push(task),
      killProcess: (_pid, signal) => {
        if (signal === 0) return groupAlive;
        if (signal === 'SIGTERM') {
          childRef?.close(null, 'SIGTERM');
          return true;
        }
        if (signal === 'SIGKILL') throw errnoError('EACCES', 'force denied');
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'POSIX Force Failure');
      await assert.rejects(
        h.registry.stopTask(task, 'user'),
        /SIGKILL[\s\S]*force denied[\s\S]*Descendant processes may have leaked/i,
      );
      await waitFor(() => task.status === 'failed', 'loud POSIX force-failure finalization');
      assert.match(task.error ?? '', /Descendant processes may have leaked/i);
      assert.equal(task.killEscalationTimer, undefined);
      assert.equal(terminals.length, 1);
      assert.equal(terminals[0]?.status, 'failed');
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('applies the POSIX group barrier to direct delegate finalization', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 20,
      stopWaitMs: 250,
      killProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGTERM') {
          childRef?.close(null, 'SIGTERM');
          return true;
        }
        if (signal === 'SIGKILL') {
          groupAlive = false;
          return true;
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = Object.assign(new FakeChild(pid), {
          stdin: {
            once: () => undefined,
            write: (_data: Buffer, callback: (error?: Error | null) => void) => {
              callback();
              return true;
            },
            end: () => undefined,
          },
        });
        return childRef;
      },
    });
    try {
      const request: StartDelegateTaskOptions = Object.assign(Object.create(null), {
        name: 'delegate process-tree barrier',
        argv: [],
        stdinBytes: Buffer.from('seed', 'utf8'),
        env: {},
        facts: {
          taskId: 'delegate-process-tree-barrier',
          route: { qualifiedId: 'test/delegate-model' },
        },
        notifyOnCompletion: false,
        triggerOnCompletion: false,
      });
      const task = await h.registry.startDelegateTask(h.ctx, request);
      await h.registry.stopTask(task, 'user');
      assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 1);
      assert.equal(task.status, 'killed');
      assert.equal(task.killEscalationTimer, undefined);
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('applies the POSIX group barrier to direct attested finalization', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    const h = await createHarness({
      platform: 'linux',
      modelRegistry: oauthRegistry(),
      killGraceMs: 20,
      stopWaitMs: 300,
      killProcess: (_pid, signal) => {
        signals.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGTERM') {
          childRef?.close(null, 'SIGTERM');
          return true;
        }
        if (signal === 'SIGKILL') {
          groupAlive = false;
          return true;
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      await initCleanGit(h.cwd);
      const task = await h.registry.startAttestedPiTask(h.ctx, {
        name: 'attested process-tree barrier',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        prompt: 'write report.md',
        reportPath: 'report.md',
      });
      await h.registry.stopTask(task, 'user');
      assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 1);
      assert.equal(task.status, 'killed');
      assert.equal(task.killEscalationTimer, undefined);
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('uses POSIX process-group kill before child fallback', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const killCalls: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
    const h = await createHarness({
      platform: 'darwin',
      killProcess: (pid, signal) => {
        const call: { pid: number; signal?: NodeJS.Signals | number } = { pid };
        if (signal !== undefined) call.signal = signal;
        killCalls.push(call);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGTERM') {
          groupAlive = false;
          queueMicrotask(() => childRef?.close(null, signal));
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task, child } = await startFakeTask(h);
      task.pid = child.pid + 99_999;
      await h.registry.stopTask(task, 'user');
      assert.equal(killCalls[0]?.pid, -child.pid, 'signals must use spawn-captured ownership');
      assert.equal(killCalls[0]?.signal, 'SIGTERM');
      assert.equal(killCalls.filter((call) => call.signal === 'SIGKILL').length, 0);
      assert.ok(killCalls.some((call) => call.signal === 0));
      assert.deepEqual(child.killCalls, []);
      assert.equal(task.status, 'killed');
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('falls back to child.kill when process-group kill fails and reports when both fail', async () => {
    const h = await createHarness({
      platform: 'linux',
      killProcess: () => {
        throw errnoError('ESRCH', 'group already gone');
      },
      childFactory: (pid) =>
        new FakeChild(pid, function (this: FakeChild, signal) {
          queueMicrotask(() => {
            this.close(null, signal ?? null);
          });
          return true;
        }),
    });
    try {
      const { task, child } = await startFakeTask(h, 'Fallback Kill');
      await h.registry.stopTask(task, 'user');
      assert.deepEqual(child.killCalls, ['SIGTERM']);
      assert.equal(task.status, 'killed');
    } finally {
      await cleanup(h.root);
    }

    const failing = await createHarness({
      platform: 'linux',
      killProcess: () => {
        throw errnoError('ESRCH', 'group already gone');
      },
      childFactory: (pid) =>
        new FakeChild(pid, () => {
          throw new Error('child unavailable');
        }),
    });
    try {
      const { task } = await startFakeTask(failing, 'Failed Kill');
      await assert.rejects(
        () => failing.registry.stopTask(task, 'user'),
        /Could not kill task[\s\S]*child unavailable/,
      );
      assert.equal(task.status, 'running');
    } finally {
      await cleanup(failing.root);
    }
  });

  void it('uses taskkill tree termination on Windows and never falls back to child.kill', async () => {
    let processKillCalled = false;
    let childRef: FakeChild | undefined;
    const killTreeCalls: Array<{ pid: number; phase: WindowsKillPhase }> = [];
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 20,
      stopWaitMs: 500,
      killProcess: () => {
        processKillCalled = true;
        return true;
      },
      killTree: (pid, phase) => {
        killTreeCalls.push({ pid, phase });
        if (phase === 'force') {
          queueMicrotask(() => {
            childRef?.close(null, 'SIGKILL');
          });
        }
        return Promise.resolve(taskkillOutcome(0));
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid, () => {
          throw new Error('root-only kill must not run');
        });
        return childRef;
      },
    });
    try {
      const { task, child } = await startFakeTask(h, 'Windows Kill');
      await h.registry.stopTask(task, 'user');
      assert.equal(processKillCalled, false);
      assert.deepEqual(killTreeCalls, [
        { pid: child.pid, phase: 'terminate' },
        { pid: child.pid, phase: 'force' },
      ]);
      assert.deepEqual(child.killCalls, []);
      const windowsSpawn = h.children[0];
      assert.ok(windowsSpawn, 'Windows shell spawn should be recorded');
      // ComSpec is a full path on a real Windows host, so compare the basename.
      assert.equal(basename(windowsSpawn.shell).toLowerCase(), 'cmd.exe');
      assert.deepEqual(windowsSpawn.args.slice(0, 3), ['/d', '/s', '/c']);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('shares duplicate Windows graceful stops and aborts soft taskkill when force starts', async () => {
    let childRef: FakeChild | undefined;
    let softAbortCount = 0;
    let firstTimer: NodeJS.Timeout | undefined;
    const phases: WindowsKillPhase[] = [];
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 20,
      stopWaitMs: 500,
      killTree: (_pid, phase, signal) => {
        phases.push(phase);
        if (phase === 'terminate') {
          if (signal !== undefined) {
            signal.addEventListener(
              'abort',
              () => {
                softAbortCount += 1;
              },
              { once: true },
            );
          }
          return new Promise<TaskkillOutcome>(() => undefined);
        }
        assert.equal(signal, undefined, 'force taskkill must not reuse the soft abort signal');
        assert.equal(softAbortCount, 1, 'soft attempt should be aborted before force starts');
        queueMicrotask(() => {
          childRef?.close(null, 'SIGKILL');
        });
        return Promise.resolve(taskkillOutcome(0));
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'Windows Duplicate Stop');
      const first = h.registry.stopTask(task, 'user');
      firstTimer = task.killEscalationTimer;
      assert.ok(firstTimer, 'first graceful stop should arm an escalation timer');
      const second = h.registry.stopTask(task, 'user');
      const third = h.registry.stopTask(task, 'user');
      assert.equal(task.killEscalationTimer, firstTimer, 'duplicate stops must share one timer');
      await Promise.all([first, second, third]);
      assert.deepEqual(phases, ['terminate', 'force']);
      assert.equal(task.killEscalationTimer, undefined);
      assert.equal(softAbortCount, 1);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('treats explicit Windows force as terminal and does not arm escalation', async () => {
    const phases: WindowsKillPhase[] = [];
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 20,
      killTree: (_pid, phase) => {
        phases.push(phase);
        return Promise.resolve(taskkillOutcome(0));
      },
    });
    try {
      const { task } = await startFakeTask(h, 'Windows Explicit Force');
      requestKillForTest(h.registry, task, 'SIGKILL');
      assert.equal(task.killEscalationTimer, undefined);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(phases, ['force']);
      assert.equal(task.killEscalationTimer, undefined);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('records Windows taskkill exit 128 as an already-exited race', async () => {
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 500,
      stopWaitMs: 1000,
      killTree: () => Promise.resolve(taskkillOutcome(128, 'process not found')),
    });
    try {
      const { task, child } = await startFakeTask(h, 'Windows Missing Process');
      const stopped = h.registry.stopTask(task, 'user');
      await waitFor(
        () => readFileSync(task.outputAbsPath, 'utf8').includes('process not found'),
        'exit 128 notice',
      );
      child.close(0, null);
      await stopped;
      assert.equal(task.status, 'killed');
      assert.match(await readFile(task.outputAbsPath, 'utf8'), /already-exited race/);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('persists a Windows soft failure and still escalates to force after grace', async () => {
    let childRef: FakeChild | undefined;
    const phases: WindowsKillPhase[] = [];
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 20,
      stopWaitMs: 500,
      killTree: (_pid, phase) => {
        phases.push(phase);
        if (phase === 'terminate') return Promise.resolve(taskkillOutcome(1, 'soft denied'));
        queueMicrotask(() => {
          childRef?.close(null, 'SIGKILL');
        });
        return Promise.resolve(taskkillOutcome(0));
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'Windows Soft Failure');
      await h.registry.stopTask(task, 'user');
      assert.deepEqual(phases, ['terminate', 'force']);
      assert.match(task.error ?? '', /soft denied/);
      const metadata = parseJsonObject(await readFile(task.metadataAbsPath, 'utf8'), 'metadata');
      assert.match(String(metadata['error']), /soft denied/);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('surfaces Windows force failure loudly without root-only fallback', async () => {
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 20,
      stopWaitMs: 500,
      killTree: (_pid, phase) =>
        Promise.resolve(
          phase === 'terminate'
            ? taskkillOutcome(1, 'soft denied')
            : taskkillOutcome(5, 'force denied'),
        ),
      childFactory: (pid) =>
        new FakeChild(pid, () => {
          throw new Error('root-only kill must not run');
        }),
    });
    try {
      const { task, child } = await startFakeTask(h, 'Windows Force Failure');
      await assert.rejects(
        () => h.registry.stopTask(task, 'user'),
        /Windows taskkill \/T \/F force termination failed[\s\S]*Descendant processes may have leaked/,
      );
      assert.equal(task.status, 'running');
      assert.match(task.error ?? '', /force denied/);
      assert.deepEqual(child.killCalls, []);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('keeps terminal metadata running until in-flight Windows force settles', async () => {
    let childRef: FakeChild | undefined;
    let forceStarted = false;
    const force = deferred<TaskkillOutcome>();
    const terminals: BgTaskSnapshot[] = [];
    const h = await createHarness({
      platform: 'win32',
      killGraceMs: 20,
      stopWaitMs: 1000,
      publishTerminal: (task) => {
        terminals.push(task);
      },
      killTree: (_pid, phase) => {
        if (phase === 'terminate') return Promise.resolve(taskkillOutcome(0));
        forceStarted = true;
        queueMicrotask(() => {
          childRef?.close(null, 'SIGKILL');
        });
        return force.promise;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'Windows Force Barrier');
      const stopped = h.registry.stopTask(task, 'user');
      await waitFor(() => forceStarted, 'force taskkill start');
      await waitFor(() => task.finalized === true, 'child close reached finalization');
      const runningMetadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'metadata before force settles',
      );
      assert.equal(runningMetadata['status'], 'running');
      assert.equal(terminals.length, 0);
      force.resolve(taskkillOutcome(0));
      await stopped;
      assert.equal(task.status, 'killed');
      const terminalMetadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'metadata after force settles',
      );
      assert.equal(terminalMetadata['status'], 'killed');
      assert.equal(terminals.length, 1);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('keeps duplicate stop requests idempotent and escalates to SIGKILL after grace', async () => {
    let childRef: FakeChild | undefined;
    let groupAlive = true;
    const killCalls: Array<NodeJS.Signals | number | undefined> = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 20,
      stopWaitMs: 500,
      killProcess: (_pid, signal) => {
        killCalls.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGKILL') {
          groupAlive = false;
          queueMicrotask(() => {
            childRef?.close(null, 'SIGKILL');
          });
        }
        return true;
      },
      childFactory: (pid) => {
        childRef = new FakeChild(pid);
        return childRef;
      },
    });
    try {
      const { task } = await startFakeTask(h, 'Escalate Kill');
      const first = h.registry.stopTask(task, 'user');
      const second = h.registry.stopTask(task, 'user');
      await Promise.all([first, second]);
      assert.deepEqual(
        killCalls.filter((signal) => signal !== 0),
        ['SIGTERM', 'SIGKILL'],
      );
      assert.equal(task.status, 'killed');
      assert.equal(task.killEscalationTimer, undefined, 'escalation timer must be cleared');
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('schedules exactly one SIGKILL escalation for concurrent stop requests', async () => {
    // Regression: SIGTERM de-duplication guarded the signal but not the timer,
    // so each concurrent stopTask scheduled its own escalation. When the child
    // outlived the grace window that produced duplicate SIGKILLs.
    let groupAlive = true;
    const killCalls: Array<NodeJS.Signals | number | undefined> = [];
    const h = await createHarness({
      platform: 'linux',
      killGraceMs: 20,
      stopWaitMs: 120,
      // Never close the child, so stop waiters time out after the sole force.
      killProcess: (_pid, signal) => {
        killCalls.push(signal);
        if (signal === 0) {
          if (groupAlive) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        if (signal === 'SIGKILL') groupAlive = false;
        return true;
      },
      childFactory: (pid) => new FakeChild(pid),
    });
    try {
      const { task } = await startFakeTask(h, 'Escalate Once');
      await Promise.all([
        h.registry.stopTask(task, 'user').catch(() => undefined),
        h.registry.stopTask(task, 'user').catch(() => undefined),
        h.registry.stopTask(task, 'user').catch(() => undefined),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.deepEqual(
        killCalls.filter((signal) => signal !== 0),
        ['SIGTERM', 'SIGKILL'],
        'concurrent stop requests must escalate to SIGKILL exactly once',
      );
    } finally {
      groupAlive = false;
      await cleanup(h.root);
    }
  });

  void it('finalizes and notifies once under error/close and output-cap races', async () => {
    const liveGroups = new Set<number>();
    const h = await createHarness({
      maxOutputBytes: 8,
      killProcess: (pid, signal) => {
        const groupId = Math.abs(pid);
        if (signal === 0) {
          if (liveGroups.has(groupId)) return true;
          throw errnoError('ESRCH', 'owned group is gone');
        }
        liveGroups.delete(groupId);
        return true;
      },
      childFactory: (pid) => {
        liveGroups.add(pid);
        return new FakeChild(pid);
      },
    });
    try {
      const { task, child } = await startFakeTask(h, 'Race Failure');
      child.fail(new Error('spawn exploded'));
      child.close(0, null);
      await waitFor(() => task.status !== 'running', 'spawn race finalization');
      await waitFor(() => h.notifications.length === 1, 'single spawn-race notification');
      assert.equal(task.status, 'failed');
      assert.match(task.error ?? '', /spawn exploded/);
      assert.equal(h.notifications.length, 1);
      // BUG-181: the terminal event itself is authoritative; agents must not poll to reconfirm it.
      const notification = h.notifications[0];
      assert.ok(notification, 'terminal notification should be captured');
      assert.match(
        notification.message.content,
        /<guidance>Terminal state and output metadata are durable\. Do not call bg_status to reconfirm; use bg_logs only if output is needed\.<\/guidance>/,
      );
      assert.deepEqual(notification.options, { deliverAs: 'followUp', triggerTurn: true });

      const capped = await h.registry.startTask(h.ctx, 'node noisy.js', {
        name: 'Output Race',
        notifyOnCompletion: true,
        triggerOnCompletion: true,
      });
      const cappedChild = lastSpawn(h).child;
      cappedChild.writeStdout('0123456789abcdef');
      cappedChild.close(1, null);
      cappedChild.close(0, null);
      await waitFor(() => capped.status !== 'running', 'output-cap finalization');
      await waitFor(() => h.notifications.length === 2, 'single output-cap notification');
      assert.equal(capped.status, 'failed');
      assert.match(capped.error ?? '', /Output exceeded cap/);
      assert.equal(h.notifications.length, 2);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('publishes terminal snapshots exactly once after durable metadata', async () => {
    const terminals: BgTaskSnapshot[] = [];
    const metadataStatuses: unknown[] = [];
    let metadataPath = '';
    const h = await createHarness({
      publishTerminal: (task) => {
        terminals.push(task);
        metadataStatuses.push(
          parseJsonObject(readFileSync(metadataPath, 'utf8'), 'terminal metadata must be written')[
            'status'
          ],
        );
      },
    });
    try {
      const { task, child } = await startFakeTask(h, 'Terminal Once');
      metadataPath = task.metadataAbsPath;
      child.close(0, null);
      child.close(1, null);
      await waitFor(() => task.status !== 'running', 'terminal status');
      await waitFor(() => terminals.length === 1, 'single terminal publication');
      const terminal = terminals[0];
      assert.ok(terminal, 'terminal snapshot should be present');
      assert.equal(terminal.id, task.id);
      assert.equal(terminal.status, 'completed');
      assert.deepEqual(metadataStatuses, ['completed']);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('keeps failed terminal EventBus delivery loud and retriable', async () => {
    const terminals: BgTaskSnapshot[] = [];
    let attempts = 0;
    const h = await createHarness({
      publishTerminal: (task) => {
        attempts += 1;
        if (attempts === 1) throw new Error('terminal bus unavailable');
        terminals.push(task);
      },
    });
    try {
      const { task, child } = await startFakeTask(h, 'Terminal Retry');
      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'terminal retry completion');
      await waitFor(() => terminals.length === 1, 'terminal retry publication');
      assert.equal(attempts, 2);
      assert.equal(task.terminalPublished, true);
      assert.equal(terminals[0]?.id, task.id);
      assert.match(
        h.errors.flat().join(' '),
        /terminal publication failed|terminal bus unavailable/,
      );
    } finally {
      await cleanup(h.root);
    }
  });

  void it('abandons a pending retry on shutdown without claiming terminal delivery', async () => {
    let attempts = 0;
    let failPublication = true;
    let task: BgTask | undefined;
    const h = await createHarness({
      publishTerminal: () => {
        attempts += 1;
        if (failPublication) throw new Error('terminal listener unavailable');
      },
    });
    try {
      const started = await startFakeTask(h, 'Terminal Shutdown Abandonment');
      task = started.task;
      started.child.close(0, null);
      await waitFor(() => task?.terminalPublishRetryHandle !== undefined, 'terminal retry arm');

      h.registry.setShuttingDown(true);
      assert.equal(task.status, 'completed', 'terminal task truth must remain intact');
      assert.notEqual(task.terminalPublished, true, 'abandonment is not successful delivery');
      assert.equal(Reflect.get(task, 'terminalPublicationState'), 'abandoned');
      assert.equal(Reflect.get(task, 'terminalPublicationAbandonReason'), 'registry_shutdown');
      assert.equal(task.terminalPublishRetryHandle, undefined, 'shutdown must cancel retry timer');

      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(attempts, 1, 'a disposed registry must never re-arm its publisher');
      const metadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'terminal metadata must survive publication abandonment',
      );
      assert.equal(metadata['status'], 'completed');
      assert.equal(
        task.notified,
        true,
        'notification truth remains independent of EventBus delivery',
      );
    } finally {
      failPublication = false;
      if (task !== undefined) {
        if (task.terminalPublishRetryHandle !== undefined)
          clearTimeout(task.terminalPublishRetryHandle);
        task.terminalPublishRetryHandle = undefined;
        // Baseline-only cleanup: stop its unbounded retry after preserving red evidence.
        if (Reflect.get(task, 'terminalPublicationState') === undefined)
          task.terminalPublished = true;
      }
      await cleanup(h.root);
    }
  });

  void it('abandons a typed closed publisher error without retrying or message matching', async () => {
    let attempts = 0;
    const h = await createHarness({
      publishTerminal: () => {
        attempts += 1;
        throw new BackgroundTaskExtensionServiceClosedError();
      },
    });
    try {
      const { task, child } = await startFakeTask(h, 'Typed Publisher Closure');
      child.close(0, null);
      await waitFor(
        () => task.terminalPublicationState === 'abandoned',
        'typed publisher abandonment',
      );
      await new Promise((resolve) => setTimeout(resolve, 250));

      assert.equal(attempts, 1);
      assert.equal(task.terminalPublished, false);
      assert.equal(task.terminalPublicationAbandonReason, 'publisher_closed');
      assert.equal(task.terminalPublishRetryHandle, undefined);
      assert.equal(h.errors.length, 1);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('bounds persistent terminal listener failures while retaining transient retry', async () => {
    let attempts = 0;
    let failPublication = true;
    let task: BgTask | undefined;
    const h = await createHarness({
      publishTerminal: () => {
        attempts += 1;
        if (failPublication) throw new Error(`persistent listener failure ${String(attempts)}`);
      },
    });
    try {
      const started = await startFakeTask(h, 'Terminal Retry Exhaustion');
      task = started.task;
      started.child.close(0, null);
      await waitFor(() => attempts >= 3, 'bounded terminal attempts');
      await new Promise((resolve) => setTimeout(resolve, 180));

      assert.equal(attempts, 3, 'terminal delivery uses three total attempts, not an open loop');
      assert.notEqual(task.terminalPublished, true, 'exhaustion is not successful delivery');
      assert.equal(Reflect.get(task, 'terminalPublicationState'), 'abandoned');
      assert.equal(Reflect.get(task, 'terminalPublicationAbandonReason'), 'retry_exhausted');
      assert.equal(task.terminalPublishRetryHandle, undefined);
      assert.equal(
        h.errors.length,
        3,
        'persistent failure diagnostics must be bounded with the attempt policy',
      );
    } finally {
      failPublication = false;
      if (task !== undefined) {
        if (task.terminalPublishRetryHandle !== undefined)
          clearTimeout(task.terminalPublishRetryHandle);
        task.terminalPublishRetryHandle = undefined;
        // Baseline-only cleanup: stop its unbounded retry after preserving red evidence.
        if (Reflect.get(task, 'terminalPublicationState') === undefined)
          task.terminalPublished = true;
      }
      await cleanup(h.root);
    }
  });

  void it('does not publish an ordinary terminal after a late gate resolves into shutdown', async () => {
    const gate = deferred<void>();
    const terminals: BgTaskSnapshot[] = [];
    const h = await createHarness({ publishTerminal: (terminal) => terminals.push(terminal) });
    const task = await h.registry.startTask(h.ctx, 'node late-gate.js', {
      name: 'Late Ordinary Gate',
      notifyOnCompletion: true,
      triggerOnCompletion: true,
      terminalPublicationGate: gate.promise,
    });
    try {
      lastSpawn(h).child.close(0, null);
      await waitFor(() => task.status === 'completed', 'late-gated ordinary completion');
      assert.equal(terminals.length, 0);

      h.registry.setShuttingDown(true);
      gate.resolve(undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(terminals.length, 0, 'a gate resolving after closure cannot publish');
      assert.notEqual(task.terminalPublished, true);
      assert.equal(Reflect.get(task, 'terminalPublicationState'), 'abandoned');
      assert.equal(task.terminalPublishRetryHandle, undefined);
      assert.equal(
        task.terminalPublicationGate,
        undefined,
        'closure must release the gate reference',
      );
      assert.equal(task.terminalPublishInFlight, false);
      assert.equal(h.notifications.length, 0, 'shutdown still suppresses completion notification');
      const metadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'late-gated task metadata must remain durable',
      );
      assert.equal(metadata['status'], 'completed');
    } finally {
      gate.resolve(undefined);
      await cleanup(h.root);
    }
  });

  void it('does not re-arm a managed terminal when its late gate rejects after shutdown', async () => {
    const completion = deferred<void>();
    const gate = deferred<void>();
    const h = await createHarness();
    const facts = {
      runId: 'reason-cccccccccccccccccccccccccccccccc',
      workflow: 'reason' as const,
      artifactDir: '.pi/fusion/test/reason-c',
      artifactDirAbs: join(h.cwd, '.pi', 'fusion', 'test', 'reason-c'),
      state: 'initializing',
      usageDelivered: false,
    };
    const task = await h.registry.startManagedTask(h.ctx, {
      id: facts.runId,
      name: 'late managed gate',
      command: 'fusion_reason',
      isAgent: true,
      completion: completion.promise,
      cancel: () => undefined,
      notifyOnCompletion: true,
      triggerOnCompletion: true,
      fusion: facts,
      terminalPublicationGate: gate.promise,
    });
    try {
      completion.resolve(undefined);
      await waitFor(() => task.status === 'completed', 'late-gated managed completion');
      h.registry.setShuttingDown(true);
      gate.reject(new Error('late launch gate rejected'));
      await new Promise((resolve) => setTimeout(resolve, 250));

      assert.notEqual(task.terminalPublished, true);
      assert.equal(Reflect.get(task, 'terminalPublicationState'), 'abandoned');
      assert.equal(Reflect.get(task, 'terminalPublicationAbandonReason'), 'registry_shutdown');
      assert.equal(task.terminalPublishRetryHandle, undefined);
      assert.equal(
        task.terminalPublicationGate,
        undefined,
        'closure must release the gate reference',
      );
      assert.equal(task.terminalPublishInFlight, false);
      assert.equal(h.notifications.length, 0);
      const metadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'managed terminal metadata must remain durable',
      );
      assert.equal(metadata['status'], 'completed');
    } finally {
      if (task.terminalPublishRetryHandle !== undefined)
        clearTimeout(task.terminalPublishRetryHandle);
      task.terminalPublishRetryHandle = undefined;
      // Baseline-only cleanup: stop its rejected-gate retry loop.
      if (Reflect.get(task, 'terminalPublicationState') === undefined)
        task.terminalPublished = true;
      completion.resolve(undefined);
      await cleanup(h.root);
    }
  });

  void it('resets notified when completion notification delivery fails and records loud metadata errors', async () => {
    const failingNotify = await createHarness({
      sendCompletionNotification: () => {
        throw new Error('send failed');
      },
    });
    try {
      const { task, child } = await startFakeTask(failingNotify, 'Notify Failure');
      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'notification failure task completion');
      await waitFor(() => failingNotify.errors.length > 0, 'notification failure log');
      assert.equal(task.notified, false);
      const metadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'notification metadata must be an object',
      );
      assert.equal(metadata['notified'], false);
      assert.match(failingNotify.errors.flat().join(' '), /notification failed|send failed/);
    } finally {
      await cleanup(failingNotify.root);
    }

    const metadataFailure = await createHarness();
    try {
      const { task, child } = await startFakeTask(metadataFailure, 'Metadata Failure');
      await rm(join(metadataFailure.cwd, '.pi'), { recursive: true, force: true });
      child.close(0, null);
      await waitFor(() => task.status === 'failed', 'metadata failure task completion');
      await waitFor(
        () => metadataFailure.notifications.length === 1,
        'notification despite metadata failure',
      );
      await waitFor(() => metadataFailure.errors.length > 0, 'metadata failure log');
      assert.equal(task.notified, true);
      assert.match(task.error ?? '', /Terminal metadata write failed/);
      assert.match(
        metadataFailure.errors.flat().join(' '),
        /failed to (write failed terminal|write|update )?metadata|ENOENT/,
      );
    } finally {
      await cleanup(metadataFailure.root);
    }
  });

  void it('ingests split, malformed, and large telemetry records without losing task state', async () => {
    const h = await createHarness();
    try {
      const { task, child } = await startFakeTask(h, 'Telemetry Chunks');
      child.writeStdout('not-json-but-user-output\n');
      child.writeStdout('{"type":"background-task-telemetry",');
      assert.equal(task.contextUsage, undefined);

      const byName = Object.fromEntries(
        Array.from({ length: 2500 }, (_, index) => [`tool-${String(index)}`, 1]),
      );
      const telemetry = JSON.stringify({
        type: 'background-task-telemetry',
        contextUsage: { tokens: 12_345, contextWindow: 200_000, percent: 6.1725 },
        tokenUsage: {
          input: 10_000,
          output: 2000,
          cacheRead: 300,
          cacheWrite: 45,
          totalTokens: 12_345,
        },
        toolUsage: { total: 2500, failed: 3, byName },
        model: 'openai-codex/gpt-5.5',
      });
      assert.ok(telemetry.length > 16 * 1024, 'fixture must exceed the old 16KiB telemetry buffer');
      const telemetryPrefix = '{"type":"background-task-telemetry",';
      assert.ok(telemetry.startsWith(telemetryPrefix));
      const continuation = telemetry.slice(telemetryPrefix.length);
      for (const chunk of [
        continuation.slice(0, 257),
        ...(continuation.slice(257).match(/.{1,113}/gs) ?? []),
        '\n',
      ]) {
        child.writeStdout(chunk);
      }

      assert.deepEqual(task.contextUsage, {
        tokens: 12_345,
        contextWindow: 200_000,
        percent: 6.1725,
      });
      assert.deepEqual(task.tokenUsage, {
        input: 10_000,
        output: 2000,
        cacheRead: 300,
        cacheWrite: 45,
        totalTokens: 12_345,
      });
      const toolUsage = task.toolUsage;
      assert.ok(toolUsage, 'valid telemetry should populate tool usage');
      assert.equal(toolUsage.total, 2500);
      assert.equal(toolUsage.failed, 3);
      assert.equal(toolUsage.byName['tool-2499'], 1);
      assert.equal(task.model, 'openai-codex/gpt-5.5');

      child.writeStdout('{"type":"background-task-telemetry",bad}\n');
      const retainedToolUsage = task.toolUsage;
      assert.ok(retainedToolUsage, 'malformed telemetry must not clear previous tool usage');
      assert.equal(retainedToolUsage.total, 2500);
      assert.equal(task.model, 'openai-codex/gpt-5.5');
      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'telemetry task completion');
      let metadata = await readJsonEventually(task.metadataAbsPath);
      for (let attempt = 0; attempt < 20; attempt++) {
        metadata = await readJsonEventually(task.metadataAbsPath);
        if (JSON.stringify(metadata['tokenUsage']) === JSON.stringify(task.tokenUsage)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.deepEqual(metadata['tokenUsage'], task.tokenUsage);
      const metadataToolUsage = requiredJsonObject(
        metadata['toolUsage'],
        'metadata tool usage must be an object',
      );
      const metadataToolCounts = requiredJsonObject(
        metadataToolUsage['byName'],
        'metadata tool counts must be an object',
      );
      assert.equal(metadataToolCounts['tool-2499'], 1);
      assert.equal(metadata['model'], 'openai-codex/gpt-5.5');
    } finally {
      await cleanup(h.root);
    }
  });

  void it('renders wrapped Pi-agent activity transcripts and keeps telemetry out of the output file', async () => {
    const h = await createHarness({ platform: 'linux' });
    try {
      const task = await h.registry.startTask(h.ctx, 'pi -p hello', {
        name: 'Wrapped Agent',
        isAgent: true,
        notifyOnCompletion: false,
      });
      assert.equal(task.telemetryWrapped, true);
      const child = lastSpawn(h).child;

      child.writeStdout(
        '{"type":"background-task-activity","kind":"tool_start","tool":"read","argsSummary":"README.md"}\n',
      );
      // Telemetry split across two stdout chunks must reassemble before parsing.
      child.writeStdout(
        '{"type":"background-task-telemetry","tokenUsage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15},',
      );
      child.writeStdout(
        '"toolUsage":{"total":1,"failed":1,"byName":{"read":1}},"model":"prov/model","contextUsage":{"tokens":15,"contextWindow":1000,"percent":1.5}}\n',
      );
      child.writeStdout(
        '{"type":"background-task-activity","kind":"tool_end","tool":"read","isError":true,"error":"boom"}\n',
      );
      child.writeStdout(
        '{"type":"background-task-activity","kind":"assistant_text","text":"final answer"}\n',
      );
      child.writeStderr('child stderr diagnostic\n');
      // Trailing partial line (no newline) must be flushed verbatim on finalize.
      child.writeStdout('trailing fragment without newline');

      assert.deepEqual(task.tokenUsage, {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
      });
      assert.deepEqual(task.toolUsage, { total: 1, failed: 1, byName: { read: 1 } });
      assert.equal(task.model, 'prov/model');
      assert.deepEqual(task.contextUsage, { tokens: 15, contextWindow: 1000, percent: 1.5 });

      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'wrapped-agent completion');

      let output = '';
      await waitFor(() => {
        try {
          output = readFileSync(task.outputAbsPath, 'utf8');
        } catch {
          output = '';
        }
        return output.includes('trailing fragment without newline');
      }, 'wrapped-agent transcript flushed');

      assert.match(output, /\u2192 read README\.md/);
      assert.match(output, /\u2717 read failed: boom/);
      assert.match(output, /^final answer$/m);
      assert.match(output, /child stderr diagnostic/);
      assert.doesNotMatch(output, /background-task-telemetry/);
      assert.doesNotMatch(output, /background-task-activity/);
      assert.doesNotMatch(output, /"kind"/);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('preserves split multiline XML context telemetry across newline boundaries', async () => {
    const h = await createHarness();
    try {
      const { task, child } = await startFakeTask(h, 'XML Telemetry');
      child.writeStdout('prefix\n<background-task-context-usage>\n  <tokens>321</tokens>\n');
      assert.equal(task.contextUsage, undefined);
      child.writeStdout(
        '  <context-window>1000</context-window>\n  <percent>32.1</percent>\n</background-task-context-usage>\n',
      );
      assert.deepEqual(task.contextUsage, { tokens: 321, contextWindow: 1000, percent: 32.1 });
      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'xml telemetry task completion');
    } finally {
      await cleanup(h.root);
    }
  });

  void it('produces a direct-spawn attested Pi sidecar with raw events, stderr, hashes, and exact argv', async () => {
    const h = await createHarness({ modelRegistry: oauthRegistry() });
    const originalPath = process.env['PATH'];
    let task: BgTask | undefined;
    try {
      await initCleanGit(h.cwd);
      let admittedPi: string | undefined;
      let canonicalPiTarget: string | undefined;
      if (process.platform !== 'win32') {
        const fixtureBin = join(h.root, 'attested-pi-bin');
        const fixtureTarget = join(h.root, 'attested-pi-target');
        admittedPi = join(fixtureBin, 'pi');
        await mkdir(fixtureBin, { recursive: true });
        await writeFile(fixtureTarget, '#!/bin/sh\nexit 0\n', 'utf8');
        await chmod(fixtureTarget, 0o755);
        await symlink(fixtureTarget, admittedPi, 'file');
        canonicalPiTarget = realpathSync(admittedPi);
        process.env['PATH'] =
          originalPath === undefined ? fixtureBin : `${fixtureBin}${delimiter}${originalPath}`;
      }

      // The fixture leads PATH while the original entries keep real Git preflight
      // reachable. Restore the process-global value even when setup rejects.
      try {
        task = await h.registry.startAttestedPiTask(h.ctx, {
          name: 'Unit Attested',
          provider: 'openai-codex',
          model: 'gpt-5.5',
          prompt: 'write report.md',
          reportPath: 'report.md',
          extraPiArgs: ['--no-extensions'],
        });
      } finally {
        if (process.platform !== 'win32') {
          if (originalPath === undefined) delete process.env['PATH'];
          else process.env['PATH'] = originalPath;
        }
      }
      await writeFile(join(h.cwd, 'report.md'), 'unit report\n', 'utf8');
      const spawn = lastSpawn(h);

      // Settle the fake child before launch assertions so a failed assertion
      // cannot strand task cleanup or suppress the test runner's TAP summary.
      spawn.child.writeStdout(piJsonEvents());
      spawn.child.writeStderr('diagnostic\n');
      spawn.child.close(0, null);
      await waitFor(() => task?.status === 'completed', 'attested sidecar completion');

      assert.match(task.id, /^b[0-9a-f]{32}$/);
      // Actual launch identity and attested logical argv are separate contracts.
      // POSIX must spawn the independently canonicalized fixture target; Windows
      // retains its Node-plus-cli.js package launch shape.
      const piArgs = process.platform === 'win32' ? spawn.args.slice(1) : [...spawn.args];
      if (process.platform === 'win32') {
        assert.equal(spawn.shell, process.execPath);
        assert.ok(
          spawn.args[0]?.endsWith('cli.js'),
          'Windows launches the resolved Pi bin as the first argument',
        );
      } else {
        assert.ok(admittedPi);
        assert.ok(canonicalPiTarget);
        assert.equal(spawn.shell, canonicalPiTarget);
        assert.notEqual(spawn.shell, admittedPi, 'POSIX launch must pin the canonical target');
      }
      assert.equal(spawn.options.shell, false);
      assert.equal(spawn.options.env?.['OPENAI_API_KEY'], undefined);
      assert.equal(spawn.options.env?.['OPENAI_BASE_URL'], undefined);
      assert.equal(spawn.options.env?.['ANTHROPIC_API_KEY'], undefined);
      assert.equal(spawn.options.env?.['OPENROUTER_API_KEY'], undefined);
      assert.deepEqual(piArgs, [
        '--mode',
        'json',
        '--provider',
        'openai-codex',
        '--model',
        'gpt-5.5',
        '--no-extensions',
        'write report.md',
      ]);
      assert.ok(task.attestationAbsPath, 'attestation path should be recorded on task');
      assert.equal(
        existsSync(task.attestationAbsPath ?? ''),
        true,
        'completed must not become externally visible before the attestation is durable',
      );
      const attestation = parseJsonObject(
        await readFile(task.attestationAbsPath, 'utf8'),
        'attestation sidecar must be an object',
      );
      assert.equal(attestation['schema_version'], 'phase2.pi_task_attestation.v1');
      assert.equal(
        requiredJsonObject(attestation['lifecycle'], 'lifecycle')['status'],
        'completed',
      );
      const invocation = requiredJsonObject(attestation['invocation'], 'invocation');
      assert.equal(invocation['pi_session_id'], 'pi-session-unit');
      assert.equal(invocation['provider'], 'openai-codex');
      assert.equal(invocation['model_id'], 'gpt-5.5');
      assert.equal(invocation['credential_kind'], 'oauth');
      assert.equal(invocation['direct_api_key'], false);
      // The recorded evidence argv is the logical Pi invocation on every
      // platform. It deliberately stays ['pi', ...] rather than echoing the
      // Windows Node-plus-cli.js launch form, so attestation evidence keeps one
      // stable meaning across platforms.
      assert.deepEqual(invocation['argv'], ['pi', ...piArgs]);
      const sourceHashes = requiredJsonObject(attestation['source_hashes'], 'source hashes');
      const artifacts = requiredJsonObject(attestation['artifacts'], 'artifacts');
      assert.equal(
        requiredJsonObject(artifacts['task_output'], 'task output artifact')['sha256'],
        sourceHashes['output_sha256'],
      );
      assert.equal(
        requiredJsonObject(artifacts['stderr'], 'stderr artifact')['sha256'],
        sourceHashes['stderr_sha256'],
      );
      assert.equal(
        requiredJsonObject(artifacts['transcript'], 'transcript artifact')['sha256'],
        sourceHashes['events_sha256'],
      );
      assert.match(await readFile(task.outputAbsPath, 'utf8'), /attested done/);
      assert.match(await readFile(task.eventsAbsPath ?? '', 'utf8'), /pi-session-unit/);
      assert.match(await readFile(task.stderrAbsPath ?? '', 'utf8'), /diagnostic/);
      const metadata = parseJsonObject(
        await readFile(task.metadataAbsPath, 'utf8'),
        'metadata must remain parseable after attestation',
      );
      assert.equal(metadata['bytesWritten'], readFileSync(task.outputAbsPath).length);
    } finally {
      try {
        const child = h.children.at(-1)?.child;
        if (task?.status === 'running' && child !== undefined) {
          child.close(1, null);
          await waitFor(() => task?.status !== 'running', 'attested fixture settlement');
        }
      } finally {
        await cleanup(h.root);
      }
    }
  });

  void it('rejects duplicate thinking in attested Pi extra args before spawn', async () => {
    const h = await createHarness({ modelRegistry: oauthRegistry() });
    try {
      await initCleanGit(h.cwd);
      await assert.rejects(
        h.registry.startAttestedPiTask(h.ctx, {
          name: 'Duplicate Thinking',
          provider: 'openai-codex',
          model: 'gpt-5.5',
          thinking: 'high',
          prompt: 'write report.md',
          reportPath: 'report.md',
          extraPiArgs: ['--thinking', 'low'],
        }),
        /structured thinking field|duplicate Pi args/,
      );
      assert.equal(h.children.length, 0, 'duplicate thinking must fail before spawning pi');
    } finally {
      await cleanup(h.root);
    }
  });

  void it('launches attested Pi on Windows through Node while preserving logical argv', async () => {
    const h = await createHarness({ platform: 'win32', modelRegistry: oauthRegistry() });
    try {
      await initCleanGit(h.cwd);
      const prompt = 'write report.md & echo pwned "%VAR%" C:\\tmp\\space path\\';
      const task = await h.registry.startAttestedPiTask(h.ctx, {
        name: 'Win Attested',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        prompt,
        reportPath: 'report.md',
        extraPiArgs: ['--no-extensions', 'quoted "value"'],
      });
      await writeFile(join(h.cwd, 'report.md'), 'unit report\n', 'utf8');
      const spawn = lastSpawn(h);
      assert.equal(spawn.shell, process.execPath);
      assert.equal(spawn.options.shell, false);
      assert.equal(spawn.options.detached, false);
      assert.equal(spawn.args.at(-1), prompt);
      assert.ok(spawn.args[0]?.endsWith('cli.js'));
      assert.deepEqual(spawn.args.slice(1), [
        '--mode',
        'json',
        '--provider',
        'openai-codex',
        '--model',
        'gpt-5.5',
        '--no-extensions',
        'quoted "value"',
        prompt,
      ]);
      spawn.child.writeStdout(piJsonEvents());
      spawn.child.close(0, null);
      await waitFor(() => task.status === 'completed', 'Windows attested completion');
      assert.ok(task.attestationAbsPath);
      const attestation = parseJsonObject(
        await readFile(task.attestationAbsPath, 'utf8'),
        'attestation sidecar must be an object',
      );
      const invocation = requiredJsonObject(attestation['invocation'], 'invocation');
      assert.deepEqual(invocation['argv'], [
        'pi',
        '--mode',
        'json',
        '--provider',
        'openai-codex',
        '--model',
        'gpt-5.5',
        '--no-extensions',
        'quoted "value"',
        prompt,
      ]);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('strips metered API environment from attested Pi child process', async () => {
    const h = await createHarness({
      modelRegistry: oauthRegistry(),
      env: {
        ...process.env,
        OPENAI_API_KEY: 'metered-openai',
        OPENAI_BASE_URL: 'https://api.openai.invalid',
        ANTHROPIC_API_KEY: 'metered-anthropic',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.invalid',
        OPENROUTER_API_KEY: 'metered-openrouter',
        OPENROUTER_BASE_URL: 'https://openrouter.invalid',
        PI_API_KEY: 'metered-pi',
        PI_AUTH_FILE: '/tmp/forbidden-auth.json',
      },
    });
    try {
      await initCleanGit(h.cwd);
      const task = await h.registry.startAttestedPiTask(h.ctx, {
        name: 'Env Strip',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        prompt: 'write report.md',
        reportPath: 'report.md',
      });
      await writeFile(join(h.cwd, 'report.md'), 'unit report\n', 'utf8');
      const spawn = lastSpawn(h);
      for (const key of [
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_BASE_URL',
        'OPENROUTER_API_KEY',
        'OPENROUTER_BASE_URL',
        'PI_API_KEY',
        'PI_AUTH_FILE',
      ]) {
        assert.equal(spawn.options.env?.[key], undefined, `${key} must be stripped`);
      }
      spawn.child.writeStdout(piJsonEvents());
      spawn.child.close(0, null);
      await waitFor(() => task.status === 'completed', 'attested env-strip completion');
    } finally {
      await cleanup(h.root);
    }
  });

  void it('rejects malformed attested Pi events and does not emit a sidecar', async () => {
    const h = await createHarness({ modelRegistry: oauthRegistry() });
    try {
      await initCleanGit(h.cwd);
      const task = await h.registry.startAttestedPiTask(h.ctx, {
        name: 'Bad Attested',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        prompt: 'write report.md',
        reportPath: 'report.md',
      });
      await writeFile(join(h.cwd, 'report.md'), 'unit report\n', 'utf8');
      lastSpawn(h).child.writeStdout('{"type":"session","id":"s","cwd":"/tmp"}\n');
      lastSpawn(h).child.close(0, null);
      await waitFor(() => task.status === 'failed', 'malformed attested failure');
      assert.match(task.error ?? '', /agent_start|assistant|agent_end|session/i);
      assert.equal(existsSync(task.attestationAbsPath ?? ''), false);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('keeps ordinary bg_run tasks free of attestation sidecars', async () => {
    const h = await createHarness();
    try {
      const { task, child } = await startFakeTask(h, 'Ordinary No Sidecar');
      child.writeStdout('ordinary\n');
      child.close(0, null);
      await waitFor(() => task.status === 'completed', 'ordinary completion');
      assert.equal(task.attestationPath, undefined);
      assert.equal(existsSync(task.outputAbsPath.replace(/\.output$/, '.attestation.json')), false);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('tracks managed Fusion completion, durable progress, once-only usage, and cancellation', async () => {
    const h = await createHarness({ stopWaitMs: 100 });
    try {
      let complete: (() => void) | undefined;
      const completion = new Promise<void>((resolve) => {
        complete = resolve;
      });
      let releaseTerminal: (() => void) | undefined;
      const terminalPublicationGate = new Promise<void>((resolve) => {
        releaseTerminal = resolve;
      });
      const facts = {
        runId: 'reason-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        workflow: 'reason' as const,
        artifactDir: '.pi/fusion/test/reason-a',
        artifactDirAbs: join(h.cwd, '.pi', 'fusion', 'test', 'reason-a'),
        state: 'initializing',
        usageDelivered: false,
      };
      const task = await h.registry.startManagedTask(h.ctx, {
        id: facts.runId,
        name: 'fusion reason',
        command: 'fusion_reason',
        isAgent: true,
        completion,
        cancel: () => undefined,
        notifyOnCompletion: true,
        triggerOnCompletion: true,
        fusion: facts,
        terminalPublicationGate,
      });
      assert.equal(h.children.length, 0, 'managed task must not create a registry child process');
      await h.registry.updateManagedTask(task, 'candidates_running', 'candidate wave started');
      assert.equal(task.fusion?.state, 'candidates_running');
      assert.match(await readFile(task.outputAbsPath, 'utf8'), /candidate wave started/);
      assert.equal(await h.registry.claimFusionUsage(task), true);
      assert.equal(await h.registry.claimFusionUsage(task), false);
      assert.equal(task.fusion?.usageDelivered, true);
      complete?.();
      await waitFor(() => task.status === 'completed', 'managed Fusion completion');
      assert.equal(
        h.notifications.length,
        0,
        'completion must wait behind the launch publication gate',
      );
      releaseTerminal?.();
      await waitFor(() => h.notifications.length === 1, 'gated managed Fusion notification');
      assert.match(h.notifications[0]?.message.content ?? '', /Call bg_result/);

      let rejectCancelled: ((error: Error) => void) | undefined;
      const cancelled = new Promise<void>((_resolve, reject) => {
        rejectCancelled = reject;
      });
      const cancelledFacts = {
        ...facts,
        runId: 'reason-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        usageDelivered: false,
      };
      const cancelledTask = await h.registry.startManagedTask(h.ctx, {
        id: cancelledFacts.runId,
        name: 'fusion reason',
        command: 'fusion_reason',
        isAgent: true,
        completion: cancelled,
        cancel: () => rejectCancelled?.(new Error('fusion cancelled')),
        notifyOnCompletion: false,
        triggerOnCompletion: false,
        fusion: cancelledFacts,
        stopWaitMs: 100,
      });
      await h.registry.stopTask(cancelledTask, 'user');
      assert.equal(cancelledTask.status, 'killed');
      assert.equal(cancelledTask.managedCancelRequested, true);
    } finally {
      await cleanup(h.root);
    }
  });

  void it('abandons an oldest pending publication so the newest managed result remains retrievable by bg_result', async () => {
    const gate = deferred<void>();
    const h = await createHarness({ maxRecentTasks: 1 });
    const runId = 'reason-dddddddddddddddddddddddddddddddd';
    try {
      const blocked = await h.registry.startTask(h.ctx, 'node blocked-publication.js', {
        name: 'old pending publication',
        notifyOnCompletion: false,
        terminalPublicationGate: gate.promise,
      });
      lastSpawn(h).child.close(0, null);
      await waitFor(() => blocked.status === 'completed', 'old pending completion');
      assert.equal(blocked.terminalPublicationState, 'pending');

      const { store, details } = await createCommittedFusionResult(h.cwd, runId);
      const managed = await h.registry.startManagedTask(h.ctx, {
        id: runId,
        name: 'new retained fusion result',
        command: 'fusion_reason',
        isAgent: true,
        completion: Promise.resolve(),
        cancel: () => undefined,
        notifyOnCompletion: true,
        triggerOnCompletion: true,
        fusion: {
          runId,
          workflow: 'reason',
          artifactDir: store.artifactDir,
          artifactDirAbs: store.artifactDirAbs,
          state: 'completed',
          outcome: { status: 'committed', resultDetails: details, usage: details.usage },
          usageDelivered: false,
        },
      });
      await waitFor(
        () => managed.status === 'completed' && managed.terminalPublicationState === 'delivered',
        'managed result completion',
      );
      await waitFor(() => h.notifications.length === 1, 'managed result notification');

      const registeredTools = new Map<string, unknown>();
      const pi: ExtensionAPI = Object.assign(Object.create(null), {
        registerTool(definition: unknown) {
          if (isJsonObject(definition) && typeof definition['name'] === 'string') {
            registeredTools.set(definition['name'], definition);
          }
        },
        on() {
          return () => undefined;
        },
        getActiveTools() {
          return [];
        },
        setActiveTools() {},
      });
      registerBackgroundResultExtension(pi, {
        activationCloseFence: new SynchronousActivationCloseFence(),
        resolveTask: (idOrPrefix) => h.registry.resolveTask(idOrPrefix),
        claimFusionUsage: (task) => h.registry.claimFusionUsage(task),
      });
      const resultDefinition = requiredJsonObject(
        registeredTools.get('bg_result'),
        'bg_result must be registered',
      );
      const execute = resultDefinition['execute'];
      if (typeof execute !== 'function') assert.fail('bg_result execute must be callable');
      const result = requiredJsonObject(
        await Reflect.apply(execute, resultDefinition, [
          'retention-bg-result',
          { taskId: runId, delivery: 'inline' },
        ]),
        'bg_result must return an object',
      );
      const content = result['content'];
      assert.ok(Array.isArray(content));
      const firstContent = requiredJsonObject(content[0], 'bg_result content item');

      assert.deepEqual(
        h.registry.allTasks().map((task) => task.id),
        [runId],
      );
      assert.equal(blocked.terminalPublicationState, 'abandoned');
      assert.equal(blocked.terminalPublicationAbandonReason, 'retention_limit');
      assert.equal(managed.notified, true);
      assert.match(String(firstContent['text']), /retained fusion answer/);
      const resultDetails = requiredJsonObject(result['details'], 'bg_result details');
      assert.equal(resultDetails['task_id'], runId);
      assert.equal(resultDetails['state'], 'committed');
      assert.equal(resultDetails['delivery'], 'inline');
    } finally {
      gate.resolve(undefined);
      h.registry.setShuttingDown(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await cleanup(h.root);
    }
  });

  void it('prunes oldest finished tasks while preserving running tasks', async () => {
    let clock = 1_000;
    const h = await createHarness({
      maxRecentTasks: 3,
      now: () => clock++,
    });
    try {
      const running = await h.registry.startTask(h.ctx, 'sleep forever', {
        name: 'Still Running',
        notifyOnCompletion: false,
      });
      assert.equal(running.status, 'running');

      for (let i = 1; i <= 4; i++) {
        const suffix = String(i);
        const task = await h.registry.startTask(h.ctx, `printf ${suffix}`, {
          name: `Finished ${suffix}`,
          notifyOnCompletion: false,
        });
        lastSpawn(h).child.close(0, null);
        await waitFor(() => task.status === 'completed', `finished ${suffix}`);
      }

      await waitFor(() => h.registry.allTasks().length <= 3, 'old finished tasks pruned');
      const names = h.registry
        .allTasks()
        .map((task) => task.name)
        .sort();
      assert.deepEqual(names, ['Finished 3', 'Finished 4', 'Still Running'].sort());
    } finally {
      await cleanup(h.root);
    }
  });
});
