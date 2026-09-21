import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { parseJsonText } from '../../src/core/common.js';
import { isolatedTestEnv } from '../helpers/normalize.js';

const backgroundExtensionPath = resolve('extensions/background-tasks.ts');
const providerPath = resolve('tests/scripted-provider/shell-policy-provider.ts');
const peerGuidancePath = resolve('tests/scripted-provider/shell-policy-peer-guidance.ts');
const roots: string[] = [];

type JsonObject = Record<PropertyKey, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, label: string): JsonObject {
  assert.ok(isObject(value), label);
  return value;
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
      `const args = process.argv.slice(2);`,
      `writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args), 'utf8');`,
      `if (args[0] !== '-c' || args[1] !== 'shell_policy_probe Ω with spaces') {`,
      `  process.stderr.write('unexpected fake Nu argv: ' + JSON.stringify(args));`,
      `  process.exitCode = 9;`,
      `} else {`,
      `  process.stdout.write('fake Nu selected Ω with spaces\\n');`,
      `}`,
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(path, 0o755);
}

async function providerEvents(path: string): Promise<JsonObject[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => object(parseJsonText(line), 'provider event'));
}

async function terminalMetadata(path: string): Promise<JsonObject> {
  const deadline = Date.now() + 5000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const metadata = object(parseJsonText(await readFile(path, 'utf8')), 'task metadata');
      if (metadata['status'] !== 'running') return metadata;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for terminal metadata ${path}: ${String(lastError ?? '')}`);
}

interface HarnessOptions {
  readonly rootLabel: string;
  readonly extensionOrder: 'peer-before' | 'peer-after';
  readonly shell?: string | undefined;
  readonly policy?: 'bash' | undefined;
}

async function runHarness(options: HarnessOptions) {
  const root = await mkdtemp(join(tmpdir(), `pi-bg-shell-guidance-${options.rootLabel}-`));
  roots.push(root);
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  const eventsPath = join(root, 'provider-events.jsonl');
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });

  const previous = {
    shell: process.env['SHELL'],
    policy: process.env['PI_BG_POSIX_SHELL'],
    path: process.env['PI_BG_POSIX_SHELL_PATH'],
    events: process.env['PI_BG_SHELL_POLICY_EVENTS'],
    key: process.env['PI_BG_SHELL_POLICY_API_KEY'],
  };
  Object.assign(process.env, isolatedTestEnv, {
    PI_BG_SHELL_POLICY_EVENTS: eventsPath,
    PI_BG_SHELL_POLICY_API_KEY: 'offline-scripted-key',
  });
  if (options.shell === undefined) delete process.env['SHELL'];
  else process.env['SHELL'] = options.shell;
  if (options.policy === undefined) delete process.env['PI_BG_POSIX_SHELL'];
  else process.env['PI_BG_POSIX_SHELL'] = options.policy;
  delete process.env['PI_BG_POSIX_SHELL_PATH'];

  const ordered =
    options.extensionOrder === 'peer-before'
      ? [providerPath, peerGuidancePath, backgroundExtensionPath]
      : [providerPath, backgroundExtensionPath, peerGuidancePath];
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: 'pi-bg-shell-policy',
    defaultModel: 'shell-policy-model',
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalExtensionPaths: ordered,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
  });
  await loader.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
  });
  const modelRegistry = new ModelRegistry(modelRuntime);
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    modelRuntime,
    noTools: 'builtin',
  });
  const model = modelRegistry.find('pi-bg-shell-policy', 'shell-policy-model');
  assert.ok(model, 'scripted shell-policy model must be registered');
  await session.setModel(model);

  const dispose = async () => {
    try {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    } finally {
      session.dispose();
      restoreEnv('SHELL', previous.shell);
      restoreEnv('PI_BG_POSIX_SHELL', previous.policy);
      restoreEnv('PI_BG_POSIX_SHELL_PATH', previous.path);
      restoreEnv('PI_BG_SHELL_POLICY_EVENTS', previous.events);
      restoreEnv('PI_BG_SHELL_POLICY_API_KEY', previous.key);
    }
  };
  return { root, cwd, eventsPath, session, dispose };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

void describe('scripted-provider shell policy guidance and execution', { concurrency: false }, () => {
  for (const extensionOrder of ['peer-before', 'peer-after'] as const) {
    void it(
      `observes inherited fake Nu guidance and executes with the same argv (${extensionOrder})`,
      { timeout: 15_000 },
      async (t) => {
        if (process.platform === 'win32') {
          t.skip('executable fake Nu is a POSIX argv witness, not a native Nu/Windows claim');
          return;
        }
        const root = await mkdtemp(join(tmpdir(), `pi-bg-fake-nu-${extensionOrder}-`));
        roots.push(root);
        const fakeNu = join(root, 'fake shell Ω', 'nu');
        const argvPath = join(root, 'fake-nu-argv.json');
        await makeFakeNu(fakeNu, argvPath);
        const h = await runHarness({
          rootLabel: `nu-${extensionOrder}`,
          extensionOrder,
          shell: fakeNu,
        });
        try {
          await h.session.prompt('Use the documented background shell policy witness.');
          await h.session.agent.waitForIdle();
          const events = await providerEvents(h.eventsPath);
          assert.equal(events.length, 2);
          const first = object(events[0], 'first provider event');
          const guidance = object(first['guidance'], 'provider-observed shell guidance');
          assert.equal(first['peerGuidance'], true);
          assert.equal(guidance['policy'], 'inherit');
          assert.equal(guidance['executable'], fakeNu);
          assert.equal(guidance['dialect'], 'user-non-posix');
          assert.deepEqual(guidance['args'], ['-c', '<command>']);

          const second = object(events[1], 'second provider event');
          assert.equal(second['peerGuidance'], true);
          const taskPolicy = object(second['taskShellPolicy'], 'agent-visible launch policy');
          assert.deepEqual(taskPolicy, {
            policy: 'inherit',
            executable: fakeNu,
            argvPrefix: ['-c'],
            dialect: 'user-non-posix',
          });
          const taskId = String(second['taskId']);
          const outputPath = String(second['taskOutputPath']);
          assert.ok(taskId.startsWith('b'));
          const metadata = await terminalMetadata(
            join(h.cwd, outputPath.replace(/\.output$/u, '.json')),
          );
          assert.equal(metadata['status'], 'completed');
          assert.deepEqual(metadata['shellPolicy'], taskPolicy);
          assert.deepEqual(JSON.parse(await readFile(argvPath, 'utf8')), [
            '-c',
            'shell_policy_probe Ω with spaces',
          ]);
          assert.match(await readFile(join(h.cwd, outputPath), 'utf8'), /fake Nu selected Ω/u);
        } finally {
          await h.dispose();
        }
      },
    );
  }

  void it('observes explicit Bash guidance and executes a real Bash command', { timeout: 15_000 }, async (t) => {
    if (process.platform === 'win32') {
      t.skip('real /bin/bash proof is POSIX-only and is not a native Windows claim');
      return;
    }
    try {
      await access('/bin/bash', constants.X_OK);
    } catch {
      t.skip('/bin/bash is unavailable on this host');
      return;
    }
    const h = await runHarness({
      rootLabel: 'real-bash',
      extensionOrder: 'peer-after',
      shell: '/opt/ignored/nu',
      policy: 'bash',
    });
    try {
      await h.session.prompt('Run the explicit Bash shell-policy proof.');
      await h.session.agent.waitForIdle();
      const events = await providerEvents(h.eventsPath);
      assert.equal(events.length, 2);
      const guidance = object(events[0]?.['guidance'], 'Bash guidance');
      assert.equal(events[0]?.['peerGuidance'], true);
      assert.equal(guidance['policy'], 'bash');
      assert.equal(guidance['executable'], '/bin/bash');
      assert.equal(guidance['dialect'], 'bash');
      assert.deepEqual(guidance['args'], ['-c', '<command>']);
      const receipt = object(events[1]?.['taskShellPolicy'], 'Bash task policy receipt');
      assert.deepEqual(receipt, {
        policy: 'bash',
        executable: '/bin/bash',
        argvPrefix: ['-c'],
        dialect: 'bash',
      });
      const outputPath = String(events[1]?.['taskOutputPath']);
      const metadata = await terminalMetadata(join(h.cwd, outputPath.replace(/\.output$/u, '.json')));
      assert.equal(metadata['status'], 'completed');
      assert.deepEqual(metadata['shellPolicy'], receipt);
      assert.match(await readFile(join(h.cwd, outputPath), 'utf8'), /real bash selected Ω with spaces/u);
    } finally {
      await h.dispose();
    }
  });
});
