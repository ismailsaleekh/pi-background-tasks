import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ModelRuntime,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type EventBus,
} from '@earendil-works/pi-coding-agent';
import {
  BG_REQUEST_CHANNEL,
  BG_REQUEST_SCHEMA,
  BG_RESPONSE_CHANNEL,
  BG_RESPONSE_SCHEMA,
  BG_TERMINAL_CHANNEL,
  BG_TERMINAL_SCHEMA,
} from '../../src/core/extension-api.js';

const extensionPath = resolve('extensions/background-tasks.ts');

type JsonObject = Record<string, unknown>;

function record(value: unknown, label: string): JsonObject {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), label);
  return value as JsonObject;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function makeFakeNu(path: string, argvPath: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      `const { writeFileSync } = require('node:fs');`,
      `const { spawnSync } = require('node:child_process');`,
      `writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)), 'utf8');`,
      `const result = spawnSync('/bin/sh', process.argv.slice(2), { stdio: 'inherit', env: process.env });`,
      `if (result.error) throw result.error;`,
      `process.exitCode = result.status ?? 1;`,
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(path, 0o755);
}

function responseFor(eventBus: EventBus, requestId: string): Promise<JsonObject> {
  return new Promise((resolveResponse, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for response ${requestId}`));
    }, 3000);
    const unsubscribe = eventBus.on(BG_RESPONSE_CHANNEL, (value) => {
      const response = record(value, 'response frame');
      if (response['schema_version'] !== BG_RESPONSE_SCHEMA || response['request_id'] !== requestId)
        return;
      clearTimeout(timeout);
      unsubscribe();
      resolveResponse(response);
    });
  });
}

async function run(eventBus: EventBus, requestId: string, command: string): Promise<JsonObject> {
  const pending = responseFor(eventBus, requestId);
  eventBus.emit(BG_REQUEST_CHANNEL, {
    schema_version: BG_REQUEST_SCHEMA,
    request_id: requestId,
    operation: 'run',
    payload: {
      name: requestId,
      command,
      isAgent: false,
      notifyOnCompletion: false,
      triggerOnCompletion: false,
    },
  });
  const response = await pending;
  assert.equal(response['ok'], true, String(response['error'] ?? 'run failed'));
  return record(response['result'], 'run task');
}

async function waitForTerminal(
  terminals: Map<string, JsonObject>,
  taskId: string,
): Promise<JsonObject> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const task = terminals.get(taskId);
    if (task !== undefined) return task;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for terminal task ${taskId}`);
}

void describe('shell policy SDK activation lifecycle', { concurrency: false }, () => {
  void it(
    'holds one shell selection through env mutation and refreshes it on real AgentSession.reload()',
    { timeout: 15_000 },
    async (t) => {
      if (process.platform === 'win32') {
        t.skip('fake POSIX shell lifecycle proof is not a native Windows qualification');
        return;
      }
      const root = await mkdtemp(join(tmpdir(), 'pi-bg-shell-policy-sdk-'));
      const cwd = join(root, 'project');
      const agentDir = join(root, 'agent');
      const firstNu = join(root, 'first shell Ω', 'nu');
      const secondNu = join(root, 'second shell Ω', 'nu');
      const firstArgv = join(root, 'first-argv.json');
      const secondArgv = join(root, 'second-argv.json');
      await mkdir(cwd, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await makeFakeNu(firstNu, firstArgv);
      await makeFakeNu(secondNu, secondArgv);

      const previousShell = process.env['SHELL'];
      const previousPolicy = process.env['PI_BG_POSIX_SHELL'];
      const previousPath = process.env['PI_BG_POSIX_SHELL_PATH'];
      delete process.env['PI_BG_POSIX_SHELL'];
      delete process.env['PI_BG_POSIX_SHELL_PATH'];
      process.env['SHELL'] = firstNu;

      const eventBus = createEventBus();
      const terminals = new Map<string, JsonObject>();
      const unsubscribeTerminal = eventBus.on(BG_TERMINAL_CHANNEL, (value) => {
        const frame = record(value, 'terminal frame');
        if (frame['schema_version'] !== BG_TERMINAL_SCHEMA) return;
        const task = record(frame['task'], 'terminal task');
        if (typeof task['id'] === 'string') terminals.set(task['id'], task);
      });
      const settingsManager = SettingsManager.inMemory();
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        eventBus,
        additionalExtensionPaths: [extensionPath],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noContextFiles: true,
        noThemes: true,
      });
      let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
      try {
        await loader.reload();
        const modelRuntime = await ModelRuntime.create({
          authPath: join(agentDir, 'auth.json'),
          modelsPath: null,
        });
        ({ session } = await createAgentSession({
          cwd,
          agentDir,
          resourceLoader: loader,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager,
          modelRuntime,
          noTools: 'builtin',
        }));
        await session.bindExtensions({ onError: (error) => assert.fail(String(error)) });

        process.env['SHELL'] = secondNu;
        const commandOne = `printf '%s\\n' 'first activation Ω with spaces'`;
        const first = await run(eventBus, 'immutable-first', commandOne);
        const firstId = String(first['id']);
        const firstPolicy = record(first['shellPolicy'], 'first task shell policy');
        assert.equal(firstPolicy['executable'], firstNu);
        assert.equal(firstPolicy['dialect'], 'user-non-posix');
        const firstTerminal = await waitForTerminal(terminals, firstId);
        assert.equal(firstTerminal['status'], 'completed');
        assert.deepEqual(firstTerminal['shellPolicy'], firstPolicy);
        assert.deepEqual(JSON.parse(await readFile(firstArgv, 'utf8')), ['-c', commandOne]);
        assert.equal(existsSync(secondArgv), false, 'env mutation must not drift this activation');
        assert.match(await readFile(join(cwd, String(first['outputPath'])), 'utf8'), /first activation Ω/u);

        await session.reload();
        const commandTwo = `printf '%s\\n' 'reloaded activation Ω with spaces'`;
        const second = await run(eventBus, 'reload-second', commandTwo);
        const secondId = String(second['id']);
        const secondPolicy = record(second['shellPolicy'], 'second task shell policy');
        assert.equal(secondPolicy['executable'], secondNu);
        assert.equal(secondPolicy['dialect'], 'user-non-posix');
        const secondTerminal = await waitForTerminal(terminals, secondId);
        assert.equal(secondTerminal['status'], 'completed');
        assert.deepEqual(secondTerminal['shellPolicy'], secondPolicy);
        assert.deepEqual(JSON.parse(await readFile(secondArgv, 'utf8')), ['-c', commandTwo]);
        assert.match(
          await readFile(join(cwd, String(second['outputPath'])), 'utf8'),
          /reloaded activation Ω/u,
        );
      } finally {
        unsubscribeTerminal();
        if (session !== undefined) {
          await session.extensionRunner
            .emit({ type: 'session_shutdown', reason: 'quit' })
            .catch(() => undefined);
          session.dispose();
        }
        restoreEnv('SHELL', previousShell);
        restoreEnv('PI_BG_POSIX_SHELL', previousPolicy);
        restoreEnv('PI_BG_POSIX_SHELL_PATH', previousPath);
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
