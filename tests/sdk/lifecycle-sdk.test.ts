import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEventBus,
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  type EventBus,
} from '@earendil-works/pi-coding-agent';
import type { BgTaskSnapshot } from '../../src/core/common.js';
import {
  BG_REQUEST_CHANNEL,
  BG_REQUEST_SCHEMA,
  BG_RESPONSE_CHANNEL,
  BG_RESPONSE_SCHEMA,
  BG_TERMINAL_CHANNEL,
  BG_TERMINAL_SCHEMA,
} from '../../src/core/extension-api.js';

const extensionPath = resolve('extensions/background-tasks.ts');

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), label);
  return value as JsonRecord;
}

function waitForResponse(eventBus: EventBus, requestId: string): Promise<JsonRecord> {
  return new Promise((resolveResponse, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for ${requestId}`));
    }, 2000);
    const unsubscribe = eventBus.on(BG_RESPONSE_CHANNEL, (value) => {
      const response = record(value, 'EventBus response');
      if (response['schema_version'] !== BG_RESPONSE_SCHEMA || response['request_id'] !== requestId)
        return;
      clearTimeout(timeout);
      unsubscribe();
      resolveResponse(response);
    });
  });
}

async function request(
  eventBus: EventBus,
  requestId: string,
  operation: string,
  payload: JsonRecord,
): Promise<JsonRecord> {
  const pending = waitForResponse(eventBus, requestId);
  eventBus.emit(BG_REQUEST_CHANNEL, {
    schema_version: BG_REQUEST_SCHEMA,
    request_id: requestId,
    operation,
    payload,
  });
  return pending;
}

async function runTask(eventBus: EventBus, requestId: string, command: string): Promise<string> {
  const response = await request(eventBus, requestId, 'run', {
    name: requestId,
    command,
    isAgent: false,
    notifyOnCompletion: false,
    triggerOnCompletion: false,
  });
  assert.equal(response['ok'], true, String(response['error'] ?? 'run failed'));
  const task = record(response['result'], 'run result task');
  assert.equal(task['status'], 'running');
  assert.equal(typeof task['id'], 'string');
  return String(task['id']);
}

async function waitForTerminal(terminals: readonly string[], taskId: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (terminals.includes(taskId)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`timed out waiting for terminal ${taskId}`);
}

async function bindSession(session: AgentSession): Promise<void> {
  await session.bindExtensions({ onError: () => undefined });
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === 'ESRCH'
    );
  }
}

function isTaskSnapshot(value: unknown): value is BgTaskSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const status = Reflect.get(value, 'status');
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'command') === 'string' &&
    (status === 'running' || status === 'completed' || status === 'failed' || status === 'killed') &&
    typeof Reflect.get(value, 'outputPath') === 'string' &&
    typeof Reflect.get(value, 'cwd') === 'string' &&
    typeof Reflect.get(value, 'startTime') === 'number' &&
    typeof Reflect.get(value, 'bytesWritten') === 'number' &&
    typeof Reflect.get(value, 'isAgent') === 'boolean' &&
    typeof Reflect.get(value, 'surviveReload') === 'boolean' &&
    typeof Reflect.get(value, 'notified') === 'boolean' &&
    typeof Reflect.get(value, 'notifyOnCompletion') === 'boolean' &&
    typeof Reflect.get(value, 'triggerOnCompletion') === 'boolean'
  );
}

async function runSurvivor(session: AgentSession, name: string): Promise<BgTaskSnapshot> {
  const tool = session.getToolDefinition('bg_run');
  assert.ok(tool, 'bg_run must be registered');
  const args = {
    name,
    command: `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
    isAgent: false,
    surviveReload: true,
    notifyOnCompletion: false,
    triggerOnCompletion: false,
  };
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  const value = await tool.execute(
    `call-${name}`,
    prepared,
    undefined,
    undefined,
    session.extensionRunner.createContext(),
  );
  const result = record(value, 'bg_run result');
  const details = record(result['details'], 'bg_run details');
  const task = details['task'];
  assert.ok(isTaskSnapshot(task), 'bg_run task must be a snapshot');
  assert.equal(task.surviveReload, true);
  assert.equal(task.status, 'running');
  assert.equal(typeof task.pid, 'number');
  return task;
}

async function assertLifecycleKilled(task: BgTaskSnapshot, label: string): Promise<void> {
  assert.equal(typeof task.pid, 'number');
  const pid = task.pid;
  if (pid === undefined) throw new Error(`${label} task has no pid`);
  const deadline = Date.now() + 3000;
  while (pidExists(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.equal(pidExists(pid), false, `${label} must kill the opted process rather than transfer it`);
}

void describe('real Pi session lifecycle SDK integration', { concurrency: false }, () => {
  void it('uses AgentSessionRuntime new/switch/fork/clone/dispose with one EventBus and fresh extension bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-runtime-lifecycle-'));
    const cwd = join(root, 'project');
    const agentDir = join(root, 'agent');
    const sessionDir = join(root, 'sessions');
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    const eventBus = createEventBus();
    const responses: JsonRecord[] = [];
    const terminals: string[] = [];
    const unsubscribeResponses = eventBus.on(BG_RESPONSE_CHANNEL, (value) => {
      const response = record(value, 'observed response');
      if (response['schema_version'] === BG_RESPONSE_SCHEMA) responses.push(response);
    });
    const unsubscribeTerminals = eventBus.on(BG_TERMINAL_CHANNEL, (value) => {
      const frame = record(value, 'observed terminal');
      if (frame['schema_version'] !== BG_TERMINAL_SCHEMA) return;
      const task = record(frame['task'], 'terminal task');
      if (typeof task['id'] === 'string') terminals.push(task['id']);
    });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
    });
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd: runtimeCwd,
      agentDir: runtimeAgentDir,
      sessionManager,
      sessionStartEvent,
    }) => {
      const settingsManager = SettingsManager.inMemory();
      const services = await createAgentSessionServices({
        cwd: runtimeCwd,
        agentDir: runtimeAgentDir,
        settingsManager,
        modelRuntime,
        resourceLoaderOptions: {
          eventBus,
          additionalExtensionPaths: [extensionPath],
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noContextFiles: true,
          noThemes: true,
        },
      });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
          noTools: 'builtin',
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir,
      sessionManager: SessionManager.create(cwd, sessionDir),
    });
    let disposed = false;
    try {
      runtime.setRebindSession(bindSession);
      await bindSession(runtime.session);
      runtime.session.sessionManager.appendCustomEntry('lifecycle-sdk', { generation: 1 });
      runtime.session.sessionManager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'persist lifecycle fixture' }],
        api: 'openai-responses',
        provider: 'lifecycle-test',
        model: 'lifecycle-test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      });
      const initialSessionFile = runtime.session.sessionFile;
      assert.ok(initialSessionFile, 'initial persisted session must have a file');
      const fileDeadline = Date.now() + 1000;
      while (!existsSync(initialSessionFile) && Date.now() < fileDeadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
      assert.equal(existsSync(initialSessionFile), true, 'initial session file must exist for switch');

      const firstRunner = runtime.session.extensionRunner;
      const firstContext = firstRunner.createContext();
      const newSurvivor = await runSurvivor(runtime.session, 'runtime-new-survivor');
      const firstTask = await runTask(
        eventBus,
        'runtime-new-running',
        `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
      );
      await runtime.newSession();
      assert.notEqual(runtime.session.extensionRunner, firstRunner);
      assert.throws(() => firstContext.cwd, /stale after session replacement or reload/u);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      assert.equal(terminals.includes(firstTask), false, 'newSession must suppress old terminals');
      await assertLifecycleKilled(newSurvivor, 'newSession');

      const secondRunner = runtime.session.extensionRunner;
      const secondContext = secondRunner.createContext();
      const switchSurvivor = await runSurvivor(runtime.session, 'runtime-switch-survivor');
      const secondTask = await runTask(
        eventBus,
        'runtime-switch-running',
        `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
      );
      await runtime.switchSession(initialSessionFile);
      assert.notEqual(runtime.session.extensionRunner, secondRunner);
      assert.throws(() => secondContext.cwd, /stale after session replacement or reload/u);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      assert.equal(terminals.includes(secondTask), false, 'switchSession must suppress old terminals');
      await assertLifecycleKilled(switchSurvivor, 'switchSession');

      const forkEntryId = runtime.session.sessionManager.appendMessage({
        role: 'user',
        content: 'fork lifecycle fixture',
        timestamp: Date.now(),
      });
      const forkRunner = runtime.session.extensionRunner;
      const forkSurvivor = await runSurvivor(runtime.session, 'runtime-fork-survivor');
      await runtime.fork(forkEntryId);
      assert.notEqual(runtime.session.extensionRunner, forkRunner);
      await assertLifecycleKilled(forkSurvivor, 'fork');

      const cloneEntryId = runtime.session.sessionManager.appendMessage({
        role: 'user',
        content: 'clone lifecycle fixture',
        timestamp: Date.now(),
      });
      const cloneRunner = runtime.session.extensionRunner;
      const cloneSurvivor = await runSurvivor(runtime.session, 'runtime-clone-survivor');
      await runtime.fork(cloneEntryId, { position: 'at' });
      assert.notEqual(runtime.session.extensionRunner, cloneRunner);
      await assertLifecycleKilled(cloneSurvivor, 'clone');

      const quickTask = await runTask(eventBus, 'runtime-fresh-quick', 'echo runtime-fresh');
      await waitForTerminal(terminals, quickTask);
      assert.equal(
        responses.filter((response) => response['request_id'] === 'runtime-fresh-quick').length,
        1,
        'only the current runtime may answer after lifecycle replacements',
      );
      assert.equal(
        terminals.filter((taskId) => taskId === quickTask).length,
        1,
        'the current runtime must publish exactly one terminal',
      );

      const disposeRunner = runtime.session.extensionRunner;
      const disposeContext = disposeRunner.createContext();
      const disposeSurvivor = await runSurvivor(runtime.session, 'runtime-dispose-survivor');
      const disposeTask = await runTask(
        eventBus,
        'runtime-dispose-running',
        `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
      );
      await runtime.dispose();
      disposed = true;
      assert.throws(() => disposeContext.cwd, /stale after session replacement or reload/u);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      assert.equal(terminals.includes(disposeTask), false, 'dispose must suppress old terminals');
      await assertLifecycleKilled(disposeSurvivor, 'AgentSessionRuntime.dispose');

      eventBus.emit(BG_REQUEST_CHANNEL, {
        schema_version: BG_REQUEST_SCHEMA,
        request_id: 'runtime-after-dispose',
        operation: 'capabilities',
        payload: {},
      });
      await new Promise((resolveWait) => setTimeout(resolveWait, 75));
      assert.equal(
        responses.some((response) => response['request_id'] === 'runtime-after-dispose'),
        false,
        'dispose must leave no activation subscribed to the shared EventBus',
      );
    } finally {
      if (!disposed) await runtime.dispose().catch(() => undefined);
      unsubscribeTerminals();
      unsubscribeResponses();
      await rm(root, { recursive: true, force: true });
    }
  });
});
