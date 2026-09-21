import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import { isolatedTestEnv } from '../helpers/normalize.js';
import { verifyDelegateResultPackage } from '../../src/core/delegate/result-package.js';
import type { DelegateErrorCode } from '../../src/core/delegate/types.js';
import { DELEGATE_INLINE_ANSWER_BYTES } from '../../src/core/delegate/budget.js';

/**
 * `bg_delegate` / `bg_result` public-surface gate.
 *
 * Loads the shipped extension entrypoint into a real Pi session and drives the
 * registered tools directly, with a fake `pi` executable standing in for the
 * child so the whole launch and retrieval loop runs without a model call.
 */
const extensionPath = resolve('extensions/background-tasks.ts');
const roots: string[] = [];

interface Harness {
  session: AgentSession;
  cwd: string;
  root: string;
  hostCliPath: string;
  restore: () => void;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
}

/**
 * Fake `pi` that behaves like a conforming delegate child: it reads the seed
 * handed to it, verifies its own identity, and atomically commits one result
 * package. Scenarios let a test choose non-conforming behaviour instead.
 */
const FAKE_PI = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const scenario = process.env.PI_BG_DELEGATE_FAKE_SCENARIO || 'commit';
const dir = process.env.PI_BG_DELEGATE_ARTIFACT_DIR;
const seedPath = process.env.PI_BG_DELEGATE_SEED_PATH;
const expectedSha = process.env.PI_BG_DELEGATE_SEED_SHA256;
const taskId = process.env.PI_BG_DELEGATE_TASK_ID;
const nonce = process.env.PI_BG_DELEGATE_LAUNCH_NONCE;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

const argv = process.argv.slice(2);
fs.writeFileSync(path.join(dir, 'child-argv.json'), JSON.stringify(argv, null, 2));
fs.writeFileSync(
  path.join(dir, 'child-env.json'),
  JSON.stringify(
    {
      PI_SESSION_ID: process.env.PI_SESSION_ID ?? null,
      PI_SESSION_FILE: process.env.PI_SESSION_FILE ?? null,
      PI_PROVIDER: process.env.PI_PROVIDER ?? null,
      PI_MODEL: process.env.PI_MODEL ?? null,
      PI_CHILD_ENTRY: process.argv[1] ?? null,
    },
    null,
    2,
  ),
);

const seedRaw = fs.readFileSync(seedPath, 'utf8');
const seedSha = sha256(Buffer.from(seedRaw, 'utf8'));
if (seedSha !== expectedSha) {
  fs.writeFileSync(path.join(dir, 'child-terminal.json'), JSON.stringify({ code: 'seed_hash_mismatch', message: 'seed hash mismatch' }));
  process.exit(3);
}
const seed = JSON.parse(seedRaw);
fs.writeFileSync(path.join(dir, 'child-seed-observed.json'), JSON.stringify({
  directive: seed.directive.text,
  entries: seed.conversation_projection.entries,
  route: seed.route,
  extension_mode: seed.extension_mode,
}, null, 2));

if (scenario === 'no-commit') { process.exit(0); }
if (scenario === 'crash') { process.exit(9); }

const answerText =
  scenario === 'huge-answer'
    ? 'A'.repeat(${DELEGATE_INLINE_ANSWER_BYTES} + 1000)
    : 'DELEGATE ANSWER: ' + seed.directive.text;
const answerBytes = Buffer.from(answerText, 'utf8');
const pkg = {
  schema_version: 'pi-background-tasks.delegate-result.v1',
  task_id: taskId,
  launch_nonce: nonce,
  seed_sha256: expectedSha,
  directive_sha256: seed.directive.sha256,
  route: scenario === 'route-drift'
    ? { provider: 'someone-else', model: 'other' }
    : { provider: seed.route.provider, model: seed.route.model },
  route_attestations: [
    { provider: seed.route.provider, model: seed.route.model, stop_reason: 'stop' },
  ],
  stop_reason: 'stop',
  turns: 2,
  tool_calls: 1,
  usage: { status: 'unavailable', reason: 'fake child reports no usage' },
  answer: {
    encoding: 'utf-8',
    byte_length: answerBytes.length,
    sha256: sha256(answerBytes),
    blocks: [
      { kind: 'text', byte_length: answerBytes.length, sha256: sha256(answerBytes), data_base64: answerBytes.toString('base64') },
    ],
  },
  spilled_artifacts: [],
};
if (scenario === 'corrupt-answer') {
  pkg.answer.blocks[0].data_base64 = Buffer.from('SUBSTITUTED', 'utf8').toString('base64');
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
const serialized = JSON.stringify(canonical(pkg)) + '\n';
const tmp = path.join(dir, 'result.json.tmp');
fs.writeFileSync(tmp, serialized);
fs.renameSync(tmp, path.join(dir, 'result.json'));
process.exit(0);
`;

async function harness(
  scenario = 'commit',
  options: { failAfterMutation?: boolean } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-delegate-sdk-'));
  roots.push(root);
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  const emptyBinA = join(root, 'empty-bin-a');
  const emptyBinB = join(root, 'empty-bin-b');
  const hostPackageRoot = join(
    root,
    'global Pi installation',
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
  );
  const fakePi = join(hostPackageRoot, 'dist', 'cli.cjs');
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(emptyBinA, { recursive: true });
  await mkdir(emptyBinB, { recursive: true });
  await mkdir(join(hostPackageRoot, 'dist'), { recursive: true });
  await writeFile(
    join(hostPackageRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: '@earendil-works/pi-coding-agent',
        version: '0.0.0-delegate-sdk-fixture',
        bin: { pi: 'dist/cli.cjs' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(fakePi, FAKE_PI, 'utf8');
  await chmod(fakePi, 0o755);

  const previous = {
    path: process.env['PATH'],
    scenario: process.env['PI_BG_DELEGATE_FAKE_SCENARIO'],
    offline: process.env['PI_OFFLINE'],
    skipVersionCheck: process.env['PI_SKIP_VERSION_CHECK'],
    telemetry: process.env['PI_TELEMETRY'],
    ci: process.env['CI'],
    argv1: process.argv[1],
  };
  Object.assign(process.env, isolatedTestEnv, {
    // Deliberately provide no `pi` executable. POSIX and Windows must both use
    // the same genuine named-host-package route exercised by production Pi.
    PATH: `${emptyBinA}${delimiter}${emptyBinB}`,
    PI_BG_DELEGATE_FAKE_SCENARIO: scenario,
  });

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    restoreEnvValue('PATH', previous.path);
    restoreEnvValue('PI_BG_DELEGATE_FAKE_SCENARIO', previous.scenario);
    restoreEnvValue('PI_OFFLINE', previous.offline);
    restoreEnvValue('PI_SKIP_VERSION_CHECK', previous.skipVersionCheck);
    restoreEnvValue('PI_TELEMETRY', previous.telemetry);
    restoreEnvValue('CI', previous.ci);
    if (previous.argv1 === undefined) process.argv.splice(1, 1);
    else process.argv[1] = previous.argv1;
  };
  process.argv[1] = fakePi;

  try {
    if (options.failAfterMutation) throw new Error('fixture setup failure after global mutation');
    const settingsManager = SettingsManager.inMemory({});
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: [extensionPath],
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
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
      modelRuntime,
      noTools: 'builtin',
    });
    await session.extensionRunner.emit({ type: 'session_start', reason: 'startup' });
    return {
      session,
      cwd,
      root,
      hostCliPath: realpathSync(fakePi),
      restore,
    };
  } catch (error) {
    restore();
    throw error;
  }
}

async function dispose(h: Harness): Promise<void> {
  try {
    await h.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  } finally {
    try {
      h.session.dispose();
    } finally {
      h.restore();
    }
  }
}

interface ToolLike {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: ReadonlyArray<{ type: string; text?: string }>; details: unknown }>;
  prepareArguments?: (args: unknown) => unknown;
}

function findTool(h: Harness, name: string): ToolLike {
  const tools: readonly unknown[] = h.session.resourceLoader
    .getExtensions()
    .extensions.flatMap((extension) => [...extension.tools.values()]);
  for (const entry of tools) {
    if (typeof entry !== 'object' || entry === null) continue;
    const definition = Reflect.get(entry, 'definition');
    if (typeof definition !== 'object' || definition === null) continue;
    if (Reflect.get(definition, 'name') !== name) continue;
    const execute = Reflect.get(definition, 'execute');
    const prepare = Reflect.get(definition, 'prepareArguments');
    assert.equal(typeof execute, 'function');
    const tool: ToolLike = {
      name,
      execute: execute as ToolLike['execute'],
    };
    if (typeof prepare === 'function')
      tool.prepareArguments = prepare as (args: unknown) => unknown;
    return tool;
  }
  throw new Error(`tool ${name} is not registered`);
}

function extensionContext(h: Harness): Record<string, unknown> {
  const model = {
    provider: 'test-provider',
    id: 'test-model',
    contextWindow: 200_000,
  };
  return {
    cwd: h.cwd,
    mode: 'json',
    hasUI: false,
    sessionManager: h.session.sessionManager,
    modelRegistry: { getAll: () => [model], getAvailable: () => [model] },
    model,
    getSystemPrompt: () => 'parent system prompt for delegate SDK gate',
    ui: { notify: () => undefined },
  };
}

async function runTool(
  h: Harness,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; details: unknown }> {
  const tool = findTool(h, name);
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  const result = await tool.execute(
    `${name}-call-1`,
    prepared,
    undefined,
    undefined,
    extensionContext(h),
  );
  return {
    text: result.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n'),
    details: result.details,
  };
}

/**
 * Structural check for a typed delegate failure.
 *
 * The extension under test is loaded through Pi's resource loader, which
 * resolves its own module graph, so `instanceof DelegateError` is not reliable
 * across that boundary. The properties that form the public contract are
 * asserted directly.
 */
function isDelegateFailure(error: unknown, code: DelegateErrorCode): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return Reflect.get(error, 'name') === 'DelegateError' && Reflect.get(error, 'code') === code;
}

function delegateFlag(error: unknown, key: string): unknown {
  return Reflect.get(Object(error), key);
}

function detail(value: unknown, key: string): unknown {
  assert.ok(typeof value === 'object' && value !== null);
  return Reflect.get(value, key);
}

async function waitForTerminal(h: Harness, taskId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await runTool(h, 'bg_status', { taskId });
    if (!/\brunning\b/.test(result.text)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`delegate ${taskId} did not reach a terminal state`);
}

async function artifactDirOf(h: Harness): Promise<string> {
  const base = join(h.cwd, '.pi', 'delegate');
  const sessions = await readdir(base);
  const first = sessions[0];
  assert.ok(first);
  const tasks = await readdir(join(base, first));
  const task = tasks[0];
  assert.ok(task);
  return join(base, first, task);
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

void describe('bg_delegate and bg_result public surface', { concurrency: false }, () => {
  void it('restores every mutated env key and argv after normal and failed setup', async () => {
    const original = {
      PATH: process.env['PATH'],
      PI_BG_DELEGATE_FAKE_SCENARIO: process.env['PI_BG_DELEGATE_FAKE_SCENARIO'],
      PI_OFFLINE: process.env['PI_OFFLINE'],
      PI_SKIP_VERSION_CHECK: process.env['PI_SKIP_VERSION_CHECK'],
      PI_TELEMETRY: process.env['PI_TELEMETRY'],
      CI: process.env['CI'],
      argv1: process.argv[1],
    };
    const sentinels = {
      PATH: '/fixture/original/path',
      PI_BG_DELEGATE_FAKE_SCENARIO: 'fixture-original-scenario',
      PI_OFFLINE: 'fixture-original-offline',
      PI_SKIP_VERSION_CHECK: 'fixture-original-version-check',
      PI_TELEMETRY: 'fixture-original-telemetry',
      CI: 'fixture-original-ci',
      argv1: '/fixture/original-host.js',
    } as const;
    const observe = () => ({
      PATH: process.env['PATH'],
      PI_BG_DELEGATE_FAKE_SCENARIO: process.env['PI_BG_DELEGATE_FAKE_SCENARIO'],
      PI_OFFLINE: process.env['PI_OFFLINE'],
      PI_SKIP_VERSION_CHECK: process.env['PI_SKIP_VERSION_CHECK'],
      PI_TELEMETRY: process.env['PI_TELEMETRY'],
      CI: process.env['CI'],
      argv1: process.argv[1],
    });
    const installSentinels = () => {
      Object.assign(process.env, {
        PATH: sentinels.PATH,
        PI_BG_DELEGATE_FAKE_SCENARIO: sentinels.PI_BG_DELEGATE_FAKE_SCENARIO,
        PI_OFFLINE: sentinels.PI_OFFLINE,
        PI_SKIP_VERSION_CHECK: sentinels.PI_SKIP_VERSION_CHECK,
        PI_TELEMETRY: sentinels.PI_TELEMETRY,
        CI: sentinels.CI,
      });
      process.argv[1] = sentinels.argv1;
    };

    try {
      installSentinels();
      const h = await harness();
      await dispose(h);
      const afterNormalDispose = observe();

      installSentinels();
      await assert.rejects(
        () => harness('commit', { failAfterMutation: true }),
        /fixture setup failure after global mutation/,
      );
      const afterSetupFailure = observe();

      assert.deepEqual(afterNormalDispose, sentinels);
      assert.deepEqual(afterSetupFailure, sentinels);
    } finally {
      for (const key of [
        'PATH',
        'PI_BG_DELEGATE_FAKE_SCENARIO',
        'PI_OFFLINE',
        'PI_SKIP_VERSION_CHECK',
        'PI_TELEMETRY',
        'CI',
      ] as const) {
        restoreEnvValue(key, original[key]);
      }
      if (original.argv1 === undefined) process.argv.splice(1, 1);
      else process.argv[1] = original.argv1;
    }
  });

  void it('registers both tools at load', async () => {
    const h = await harness();
    try {
      assert.equal(findTool(h, 'bg_delegate').name, 'bg_delegate');
      assert.equal(findTool(h, 'bg_result').name, 'bg_result');
    } finally {
      await dispose(h);
    }
  });

  void it(
    'returns a launch receipt immediately and completes the whole loop',
    { timeout: 30_000 },
    async () => {
      const h = await harness('commit');
      try {
        h.session.sessionManager.appendMessage({
          role: 'user',
          content: 'PARENT_VISIBLE_CONTEXT about the bug',
          timestamp: Date.now(),
        });
        const launch = await runTool(h, 'bg_delegate', {
          name: 'Investigate bug',
          prompt: 'find the root cause',
        });
        const task = detail(launch.details, 'task');
        const taskId = detail(task, 'id');
        assert.equal(typeof taskId, 'string');
        assert.match(launch.text, /Route pinned: test-provider\/test-model/);
        assert.match(launch.text, /never substituted/);
        assert.match(launch.text, /Child session: delegate-/);
        assert.match(launch.text, /Capability: inspect/);
        assert.match(launch.text, /Extension mode: isolated/);
        assert.match(launch.text, /Auto-deliver: never/);
        assert.equal(detail(launch.details, 'extension_mode'), 'isolated');
        assert.equal(detail(detail(launch.details, 'task'), 'delegate') instanceof Object, true);
        assert.equal(
          detail(detail(detail(launch.details, 'task'), 'delegate'), 'extensionMode'),
          'isolated',
        );
        assert.equal(detail(launch.details, 'auto_deliver'), 'never');

        await waitForTerminal(h, String(taskId));

        const artifactDir = await artifactDirOf(h);
        const observed = JSON.parse(
          await readFile(join(artifactDir, 'child-seed-observed.json'), 'utf8'),
        ) as Record<string, unknown>;
        const entries = observed['entries'];
        assert.ok(Array.isArray(entries));
        const projectedText = entries
          .flatMap((entry) =>
            typeof entry === 'object' && entry !== null && Reflect.get(entry, 'kind') === 'text'
              ? [String(Reflect.get(entry, 'text'))]
              : [],
          )
          .join('\n');
        assert.match(
          projectedText,
          /PARENT_VISIBLE_CONTEXT about the bug/,
          'the child must actually receive the projected parent context',
        );
        assert.equal(observed['directive'], 'find the root cause');
        assert.equal(observed['extension_mode'], 'isolated');
        const manifest = JSON.parse(
          await readFile(join(artifactDir, 'manifest.json'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal(manifest['extension_mode'], 'isolated');

        const result = await runTool(h, 'bg_result', { taskId });
        assert.match(result.text, /DELEGATE ANSWER: find the root cause/);
        assert.match(result.text, /verified/);
        assert.equal(detail(result.details, 'state'), 'committed');
        assert.equal(detail(result.details, 'delivery'), 'inline');
        // Usage is reported explicitly, never synthesized as zero.
        assert.deepEqual(detail(result.details, 'usage'), { status: 'unavailable' });
        assert.match(result.text, /usage: unavailable/);
        assert.equal(typeof detail(result.details, 'answer_sha256'), 'string');
      } finally {
        await dispose(h);
      }
    },
  );

  void it(
    'gives the child its own session and strips parent identity',
    { timeout: 30_000 },
    async () => {
      const h = await harness('commit');
      try {
        const launch = await runTool(h, 'bg_delegate', { name: 'Isolation', prompt: 'check' });
        await waitForTerminal(h, String(detail(detail(launch.details, 'task'), 'id')));
        const artifactDir = await artifactDirOf(h);
        const argv = JSON.parse(
          await readFile(join(artifactDir, 'child-argv.json'), 'utf8'),
        ) as string[];
        assert.ok(argv.includes('--session-id'));
        const sessionDir = argv[argv.indexOf('--session-dir') + 1];
        assert.ok(sessionDir?.startsWith(artifactDir), 'the child session dir must be task-owned');
        assert.ok(argv.includes('--no-extensions'));
        assert.ok(argv.includes('--no-builtin-tools'));
        const tools = argv[argv.indexOf('--tools') + 1]?.split(',') ?? [];
        assert.ok(!tools.includes('bash'));
        assert.ok(!tools.includes('write'));
        assert.ok(!tools.includes('bg_delegate'));

        const env = JSON.parse(
          await readFile(join(artifactDir, 'child-env.json'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal(env['PI_SESSION_ID'], null);
        assert.equal(env['PI_SESSION_FILE'], null);
        assert.equal(
          env['PI_CHILD_ENTRY'],
          h.hostCliPath,
          'the SDK child must launch the named host package bin rather than a PATH shim',
        );
      } finally {
        await dispose(h);
      }
    },
  );

  void it(
    'enables ambient extension discovery explicitly while retaining all other child restrictions',
    { timeout: 30_000 },
    async () => {
      const h = await harness('commit');
      try {
        const launch = await runTool(h, 'bg_delegate', {
          name: 'Custom provider',
          prompt: 'check ambient mode',
          extensionMode: 'ambient',
        });
        const task = detail(launch.details, 'task');
        await waitForTerminal(h, String(detail(task, 'id')));
        assert.equal(detail(launch.details, 'extension_mode'), 'ambient');
        assert.equal(detail(detail(task, 'delegate'), 'extensionMode'), 'ambient');
        assert.match(launch.text, /Extension mode: ambient/);
        assert.match(launch.text, /WARNING: arbitrary discovered extension code executes/);
        assert.match(launch.text, /inspect-only process isolation is weakened/);

        const artifactDir = await artifactDirOf(h);
        const argv = JSON.parse(
          await readFile(join(artifactDir, 'child-argv.json'), 'utf8'),
        ) as string[];
        assert.ok(!argv.includes('--no-extensions'));
        for (const flag of [
          '--no-skills',
          '--no-prompt-templates',
          '--no-themes',
          '--no-context-files',
          '--no-builtin-tools',
          '--tools',
          '--exclude-tools',
        ]) {
          assert.ok(argv.includes(flag), `${flag} must remain set`);
        }
        const extensionPaths = argv.flatMap((entry, index) =>
          entry === '--extension' ? [argv[index + 1] ?? ''] : [],
        );
        assert.equal(extensionPaths.length, 1);
        assert.match(extensionPaths[0] ?? '', /extensions\/delegate-child\.(?:ts|js)$/);
        const manifest = JSON.parse(
          await readFile(join(artifactDir, 'manifest.json'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal(manifest['extension_mode'], 'ambient');
      } finally {
        await dispose(h);
      }
    },
  );

  void it(
    'returns a typed not-ready result while the delegate is running',
    { timeout: 30_000 },
    async () => {
      const h = await harness('commit');
      try {
        const launch = await runTool(h, 'bg_delegate', { name: 'Not ready', prompt: 'slow work' });
        const taskId = String(detail(detail(launch.details, 'task'), 'id'));
        // Immediately after launch the task may still be running; either way the
        // call must return rather than block.
        const started = Date.now();
        const result = await runTool(h, 'bg_result', { taskId });
        assert.ok(Date.now() - started < 5_000, 'bg_result must never block');
        const state = detail(result.details, 'state');
        assert.ok(state === 'running' || state === 'committed');
        if (state === 'running') assert.match(result.text, /never blocks/);
        await waitForTerminal(h, taskId);
      } finally {
        await dispose(h);
      }
    },
  );

  void it(
    'reports a child that exits cleanly without committing',
    { timeout: 30_000 },
    async () => {
      const h = await harness('no-commit');
      try {
        const launch = await runTool(h, 'bg_delegate', { name: 'No commit', prompt: 'do nothing' });
        const taskId = String(detail(detail(launch.details, 'task'), 'id'));
        await waitForTerminal(h, taskId);
        await assert.rejects(
          runTool(h, 'bg_result', { taskId }),
          (error: unknown) =>
            error instanceof Error && /child_exited_without_commit/.test(error.message),
        );
      } finally {
        await dispose(h);
      }
    },
  );

  void it(
    'detects a corrupted answer and never returns its bytes',
    { timeout: 30_000 },
    async () => {
      const h = await harness('corrupt-answer');
      try {
        const launch = await runTool(h, 'bg_delegate', { name: 'Corrupt', prompt: 'x' });
        const taskId = String(detail(detail(launch.details, 'task'), 'id'));
        await waitForTerminal(h, taskId);
        await assert.rejects(
          runTool(h, 'bg_result', { taskId }),
          (error: unknown) => error instanceof Error && /answer_hash_mismatch/.test(error.message),
        );
      } finally {
        await dispose(h);
      }
    },
  );

  void it('rejects an answer produced on a different route', { timeout: 30_000 }, async () => {
    const h = await harness('route-drift');
    try {
      const launch = await runTool(h, 'bg_delegate', { name: 'Drift', prompt: 'x' });
      const taskId = String(detail(detail(launch.details, 'task'), 'id'));
      await waitForTerminal(h, taskId);
      await assert.rejects(
        runTool(h, 'bg_result', { taskId }),
        (error: unknown) => error instanceof Error && /route_mismatch/.test(error.message),
      );
    } finally {
      await dispose(h);
    }
  });

  void it(
    'degrades an oversized answer to an artifact reference and never truncates it',
    { timeout: 30_000 },
    async () => {
      const h = await harness('huge-answer');
      try {
        const launch = await runTool(h, 'bg_delegate', { name: 'Huge', prompt: 'x' });
        const taskId = String(detail(detail(launch.details, 'task'), 'id'));
        await waitForTerminal(h, taskId);

        const auto = await runTool(h, 'bg_result', { taskId });
        assert.equal(detail(auto.details, 'delivery'), 'artifact');
        assert.match(auto.text, /over the .*-byte inline cap/);
        assert.match(auto.text, /not truncated/);
        assert.ok(
          !auto.text.includes('A'.repeat(1000)),
          'an artifact-delivered answer must not carry the body',
        );

        await assert.rejects(
          runTool(h, 'bg_result', { taskId, delivery: 'inline' }),
          (error: unknown) =>
            error instanceof Error && /result_too_large_for_inline/.test(error.message),
        );

        // The complete answer is still preserved and verifiable on disk.
        const artifactDir = await artifactDirOf(h);
        const raw = await readFile(join(artifactDir, 'result.json'), 'utf8');
        const manifest = JSON.parse(
          await readFile(join(artifactDir, 'manifest.json'), 'utf8'),
        ) as Record<string, unknown>;
        const verified = verifyDelegateResultPackage(raw, {
          taskId,
          launchNonce: String(Reflect.get(manifest, 'launch_nonce')),
          seedSha256: String(Reflect.get(manifest, 'seed_sha256')),
          route: { provider: 'test-provider', model: 'test-model' },
        });
        assert.equal(verified.answer.length, DELEGATE_INLINE_ANSWER_BYTES + 1000);
      } finally {
        await dispose(h);
      }
    },
  );

  void it('refuses an unavailable explicit route without creating anything', async () => {
    const h = await harness();
    try {
      await assert.rejects(
        runTool(h, 'bg_delegate', {
          name: 'Bad route',
          prompt: 'x',
          route: { provider: 'nope', model: 'missing' },
        }),
        (error: unknown) =>
          error instanceof Error && /route_unresolved|not available/.test(error.message),
      );
      assert.ok(
        !existsSync(join(h.cwd, '.pi', 'delegate')),
        'a refused launch must create no delegate artifacts at all',
      );
    } finally {
      await dispose(h);
    }
  });

  void it('rejects a blank prompt and unknown arguments', async () => {
    const h = await harness();
    try {
      const tool = findTool(h, 'bg_delegate');
      assert.ok(tool.prepareArguments);
      assert.throws(() => tool.prepareArguments?.({ name: 'x', prompt: '   ' }));
      assert.throws(() => tool.prepareArguments?.({ name: 'x' }));
      assert.throws(() => tool.prepareArguments?.({ name: 'x', prompt: 'y', capability: 'write' }));
      assert.throws(() =>
        tool.prepareArguments?.({ name: 'x', prompt: 'y', autoDeliver: 'sometimes' }),
      );
      assert.deepEqual(
        tool.prepareArguments?.({ name: 'x', prompt: 'y' }),
        { name: 'x', prompt: 'y', capability: 'inspect', extensionMode: 'isolated', autoDeliver: 'never' },
      );
      assert.throws(() =>
        tool.prepareArguments?.({ name: 'x', prompt: 'y', extensionMode: 'custom-path' }),
      );
      assert.throws(() =>
        tool.prepareArguments?.({ name: 'x', prompt: 'y', extensions: ['/tmp/provider.ts'] }),
      );
      assert.throws(() =>
        tool.prepareArguments?.({ name: 'x', prompt: 'y', extensionPaths: ['/tmp/provider.ts'] }),
      );
      assert.throws(() => tool.prepareArguments?.({ name: 'x', prompt: 'y', maxTurns: 0 }));
      assert.throws(() => tool.prepareArguments?.({ name: 'x', prompt: 'y', maxTurns: 1.5 }));
    } finally {
      await dispose(h);
    }
  });

  void it('rejects bg_result for an unknown task with a typed error', async () => {
    const h = await harness();
    try {
      await assert.rejects(
        runTool(h, 'bg_result', { taskId: 'does-not-exist' }),
        // The extension is loaded through Pi's resource loader, which resolves
        // its own module instance, so `instanceof` across that boundary is not
        // reliable. The typed contract is asserted structurally instead.
        (error: unknown) =>
          isDelegateFailure(error, 'task_unknown') && delegateFlag(error, 'childCreated') === false,
      );
    } finally {
      await dispose(h);
    }
  });

  void it('rejects bg_result for an ordinary background task', { timeout: 30_000 }, async () => {
    const h = await harness();
    try {
      const started = await runTool(h, 'bg_run', {
        name: 'Ordinary task',
        command: 'printf ordinary',
        isAgent: false,
        notifyOnCompletion: false,
      });
      const taskId = String(detail(detail(started.details, 'task'), 'id'));
      await assert.rejects(
        runTool(h, 'bg_result', { taskId }),
        (error: unknown) =>
          isDelegateFailure(error, 'task_unknown') &&
          /no retrievable delegate or Fusion result/.test(
            String(Reflect.get(Object(error), 'message')),
          ),
      );
    } finally {
      await dispose(h);
    }
  });
});
