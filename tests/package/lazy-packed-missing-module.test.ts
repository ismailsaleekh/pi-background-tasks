import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '../..');
const roots: string[] = [];

function parsePackFilename(stdout: string): string {
  const trimmed = stdout.trim();
  const start = trimmed.startsWith('[') ? 0 : stdout.lastIndexOf('\n[') + 1;
  assert.ok(start > 0 || trimmed.startsWith('['), 'npm pack must emit a JSON array');
  const parsed: unknown = JSON.parse(start === 0 ? trimmed : stdout.slice(start).trim());
  assert.ok(Array.isArray(parsed));
  const first: unknown = parsed[0];
  assert.ok(typeof first === 'object' && first !== null);
  const filename: unknown = Reflect.get(first, 'filename');
  if (typeof filename !== 'string') throw new Error('npm pack filename must be a string');
  return filename;
}

async function runNpmPack(root: string, destination: string): Promise<string> {
  const configDir = join(root, 'config');
  const home = join(root, 'home');
  const temporary = join(root, 'tmp');
  const cache = join(root, 'cache');
  await Promise.all([
    mkdir(configDir, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(temporary, { recursive: true }),
    mkdir(cache, { recursive: true }),
    mkdir(destination, { recursive: true }),
  ]);
  const userConfig = join(configDir, 'user.npmrc');
  const globalConfig = join(configDir, 'global.npmrc');
  await Promise.all([writeFile(userConfig, '', 'utf8'), writeFile(globalConfig, '', 'utf8')]);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    NPM_CONFIG_USERCONFIG: userConfig,
    npm_config_userconfig: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    npm_config_globalconfig: globalConfig,
    NPM_CONFIG_REGISTRY: 'http://127.0.0.1.invalid/',
    npm_config_registry: 'http://127.0.0.1.invalid/',
    GIT_ALLOW_PROTOCOL: 'file',
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    CI: '1',
  };
  const npmCli = process.env['npm_execpath'];
  const command = npmCli === undefined ? 'npm' : process.execPath;
  const prefix = npmCli === undefined ? [] : [npmCli];
  const result = await execFileAsync(
    command,
    [
      ...prefix,
      'pack',
      packageRoot,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      destination,
    ],
    { cwd: root, env, maxBuffer: 8 * 1024 * 1024 },
  );
  return join(destination, parsePackFilename(result.stdout));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected deferred invocation to fail');
}

async function close(session: AgentSession): Promise<void> {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}

function assertSemanticLazyFailure(error: unknown, expected: RegExp, label: string): void {
  assert.ok(error instanceof Error, `${label} should fail with an Error after lazy import`);
  assert.doesNotMatch(
    error.message,
    /Cannot find package|ERR_MODULE_NOT_FOUND/u,
    `${label} must resolve Pi host modules through the package entrypoint`,
  );
  assert.match(error.message, expected, `${label} should reach its post-import validation`);
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

void describe('packed lazy-module closure', { concurrency: false }, () => {
  void it('loads without private Pi peers, then bounds a damaged deferred producer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-lazy-packed-'));
    roots.push(root);
    const tarballs = join(root, 'tarballs');
    const unpacked = join(root, 'unpacked');
    const tarball = await runNpmPack(root, tarballs);
    await mkdir(unpacked, { recursive: true });
    await execFileAsync('tar', ['-xzf', tarball, '-C', unpacked], { cwd: root });
    const packedRoot = join(unpacked, 'package');
    const productionModules = join(packedRoot, 'node_modules');
    await mkdir(join(productionModules, '@mixmark-io'), { recursive: true });
    await Promise.all([
      cp(join(packageRoot, 'node_modules', 'turndown'), join(productionModules, 'turndown'), {
        recursive: true,
        dereference: true,
      }),
      cp(
        join(packageRoot, 'node_modules', '@mixmark-io', 'domino'),
        join(productionModules, '@mixmark-io', 'domino'),
        { recursive: true, dereference: true },
      ),
    ]);
    for (const hostPackage of [
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-tui',
      'typebox',
    ]) {
      assert.equal(
        existsSync(join(productionModules, ...hostPackage.split('/'))),
        false,
        `${hostPackage} must remain host-provided in the installed-package fixture`,
      );
    }

    const startupCwd = join(root, 'startup-project');
    const startupAgentDir = join(root, 'startup-agent');
    await Promise.all([
      mkdir(startupCwd, { recursive: true }),
      mkdir(startupAgentDir, { recursive: true }),
    ]);
    const startupPrevious = {
      features: process.env['PI_BG_FEATURES'],
      shortcut: process.env['PI_BG_DOCK_SHORTCUT'],
      agentDir: process.env['PI_CODING_AGENT_DIR'],
    };
    Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
    process.env['PI_BG_DOCK_SHORTCUT'] = 'off';
    process.env['PI_CODING_AGENT_DIR'] = startupAgentDir;
    const startupSettings = SettingsManager.inMemory();
    const startupLoader = new DefaultResourceLoader({
      cwd: startupCwd,
      agentDir: startupAgentDir,
      settingsManager: startupSettings,
      additionalExtensionPaths: [
        join(packedRoot, 'dist/extensions/anthropic-attribution.js'),
        join(packedRoot, 'dist/extensions/background-tasks.js'),
      ],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
    });
    const startupErrors: Array<{ event: string; error: string }> = [];
    let startupSession: AgentSession | undefined;
    try {
      await startupLoader.reload();
      assert.deepEqual(startupLoader.getExtensions().errors, []);
      const startupRuntime = await ModelRuntime.create({
        authPath: join(startupAgentDir, 'auth.json'),
        modelsPath: null,
      });
      const created = await createAgentSession({
        cwd: startupCwd,
        agentDir: startupAgentDir,
        resourceLoader: startupLoader,
        settingsManager: startupSettings,
        modelRuntime: startupRuntime,
        sessionManager: SessionManager.inMemory(startupCwd),
        noTools: 'builtin',
      });
      startupSession = created.session;
      await startupSession.bindExtensions({
        mode: 'json',
        onError: (error) => startupErrors.push(error),
      });
      assert.ok(startupSession.getToolDefinition('bg_run'));
      assert.ok(
        startupSession.extensionRunner
          .getRegisteredCommands()
          .some((command) => command.invocationName === 'claude-cache'),
      );

      const context = startupSession.extensionRunner.createContext();
      const delegate = startupSession.getToolDefinition('bg_delegate');
      const attested = startupSession.getToolDefinition('bg_run_pi_attested');
      const fusion = startupSession.getToolDefinition('fusion_reason');
      assert.ok(delegate);
      assert.ok(attested);
      assert.ok(fusion);
      assertSemanticLazyFailure(
        await rejection(
          delegate.execute(
            'packed-delegate-lazy-probe',
            { name: 'Lazy probe', prompt: 'Do not launch.' },
            undefined,
            undefined,
            context,
          ),
        ),
        /route .*reports no usable context-window capacity/u,
        'bg_delegate',
      );
      assertSemanticLazyFailure(
        await rejection(
          attested.execute(
            'packed-attested-lazy-probe',
            {
              name: 'Lazy probe',
              provider: 'missing-provider',
              model: 'missing-model',
              prompt: 'Do not launch.',
              reportPath: 'report.md',
            },
            undefined,
            undefined,
            context,
          ),
        ),
        /Pi model not found in ModelRegistry/u,
        'bg_run_pi_attested',
      );
      assertSemanticLazyFailure(
        await rejection(
          fusion.execute(
            'packed-fusion-lazy-probe',
            { prompt: 'Do not launch.' },
            undefined,
            undefined,
            context,
          ),
        ),
        /current model is not available to child Pi/u,
        'fusion_reason',
      );

      const baseUi = startupSession.extensionRunner.getUIContext();
      const custom = (async () => ({ type: 'cancelled' })) as ExtensionUIContext['custom'];
      startupSession.extensionRunner.setUIContext(
        { ...baseUi, custom, notify: () => undefined },
        'tui',
      );
      const commandContext = startupSession.extensionRunner.createCommandContext();
      Object.defineProperty(commandContext, 'mode', { value: 'tui', configurable: true });
      for (const commandName of ['tasks', 'fusion-models']) {
        const command = startupSession.extensionRunner
          .getRegisteredCommands()
          .find((candidate) => candidate.invocationName === commandName);
        assert.ok(command, `missing packed command ${commandName}`);
        await command.handler('', commandContext);
      }

      await close(startupSession);
      startupSession = undefined;
      assert.deepEqual(startupErrors, []);

      const childLoader = new DefaultResourceLoader({
        cwd: startupCwd,
        agentDir: startupAgentDir,
        settingsManager: SettingsManager.inMemory(),
        additionalExtensionPaths: [
          join(packedRoot, 'dist/extensions/anthropic-attribution-child.js'),
        ],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noContextFiles: true,
        noThemes: true,
      });
      await childLoader.reload();
      assert.deepEqual(childLoader.getExtensions().errors, []);
      assert.equal(childLoader.getExtensions().runtime.pendingProviderRegistrations.length, 1);
      assert.equal(
        childLoader.getExtensions().runtime.pendingProviderRegistrations[0]?.name,
        'anthropic',
      );
    } finally {
      if (startupSession !== undefined) await close(startupSession);
      if (startupPrevious.features === undefined)
        Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
      else process.env['PI_BG_FEATURES'] = startupPrevious.features;
      if (startupPrevious.shortcut === undefined)
        Reflect.deleteProperty(process.env, 'PI_BG_DOCK_SHORTCUT');
      else process.env['PI_BG_DOCK_SHORTCUT'] = startupPrevious.shortcut;
      if (startupPrevious.agentDir === undefined)
        Reflect.deleteProperty(process.env, 'PI_CODING_AGENT_DIR');
      else process.env['PI_CODING_AGENT_DIR'] = startupPrevious.agentDir;
    }

    const deferredModule = join(packedRoot, 'dist/src/core/delegate/runner.js');
    assert.ok(existsSync(deferredModule), 'the real tarball must close over the deferred module');
    await rm(deferredModule);

    const cwd = join(root, 'sdk-project');
    const agentDir = join(root, 'sdk-agent');
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
    const previous = {
      features: process.env['PI_BG_FEATURES'],
      shortcut: process.env['PI_BG_DOCK_SHORTCUT'],
      agentDir: process.env['PI_CODING_AGENT_DIR'],
    };
    process.env['PI_BG_FEATURES'] = 'process,delegate';
    process.env['PI_BG_DOCK_SHORTCUT'] = 'off';
    process.env['PI_CODING_AGENT_DIR'] = agentDir;
    const settingsManager = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: [join(packedRoot, 'dist/extensions/background-tasks.js')],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      noThemes: true,
    });
    let session: AgentSession | undefined;
    try {
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      const registered = loader
        .getExtensions()
        .extensions.flatMap((extension) => [...extension.tools.keys()]);
      assert.ok(registered.includes('bg_delegate'));
      assert.ok(registered.includes('bg_result'));

      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: null,
      });
      const created = await createAgentSession({
        cwd,
        agentDir,
        resourceLoader: loader,
        settingsManager,
        modelRuntime,
        sessionManager: SessionManager.inMemory(cwd),
        noTools: 'builtin',
      });
      session = created.session;
      const activeSession = created.session;
      await activeSession.bindExtensions({ mode: 'json' });
      const delegate = activeSession.getToolDefinition('bg_delegate');
      assert.ok(delegate);
      const invoke = () =>
        delegate.execute(
          'packed-missing-module',
          { name: 'Missing bytes', prompt: 'Do not launch.' },
          undefined,
          undefined,
          activeSession.extensionRunner.createContext(),
        );
      const first = await rejection(invoke());
      const second = await rejection(invoke());
      assert.equal(first, second, 'missing-module failure must be sticky for the activation');
      assert.ok(first instanceof Error);
      assert.match(first.message, /lazy_module_load_failed.*delegate-producer/);
      assert.match(first.message, /runner/u);
      assert.equal(existsSync(join(cwd, '.pi/delegate')), false);
    } finally {
      if (session !== undefined) await close(session);
      if (previous.features === undefined) Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
      else process.env['PI_BG_FEATURES'] = previous.features;
      if (previous.shortcut === undefined)
        Reflect.deleteProperty(process.env, 'PI_BG_DOCK_SHORTCUT');
      else process.env['PI_BG_DOCK_SHORTCUT'] = previous.shortcut;
      if (previous.agentDir === undefined)
        Reflect.deleteProperty(process.env, 'PI_CODING_AGENT_DIR');
      else process.env['PI_CODING_AGENT_DIR'] = previous.agentDir;
    }
  });
});
