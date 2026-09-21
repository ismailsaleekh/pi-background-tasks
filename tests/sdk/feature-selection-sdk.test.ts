import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Context } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type EventBus,
  type ExtensionRunner,
  type ExtensionUIContext,
  type LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import { matchesKey, type KeyId } from '@earendil-works/pi-tui';
import {
  BG_REQUEST_CHANNEL,
  BG_REQUEST_SCHEMA,
  BG_RESPONSE_CHANNEL,
  BG_RESPONSE_SCHEMA,
} from '../../src/core/extension-api.js';

const ambientAttributionPath = resolve('extensions/anthropic-attribution.ts');
const childAttributionPath = resolve('extensions/anthropic-attribution-child.ts');
const backgroundPath = resolve('extensions/background-tasks.ts');
const compiledAmbientAttributionPath = resolve('dist/extensions/anthropic-attribution.js');
const compiledBackgroundPath = resolve('dist/extensions/background-tasks.js');
const shortcutOwnerPath = resolve('tests/fixtures/shortcut-owner.ts');
const featureToolCollisionsPath = resolve('tests/fixtures/feature-tool-collisions.ts');
const attributionCopyPath = resolve('tests/fixtures/anthropic-attribution-copy.ts');
const FEATURE_ENV_KEYS = ['PI_BG_FEATURES', 'PI_BG_DOCK_SHORTCUT'] as const;
const roots: string[] = [];
const originalEnv = new Map<string, string | undefined>(
  FEATURE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const PROCESS_TOOLS = ['bg_kill', 'bg_logs', 'bg_run', 'bg_status'] as const;
const PROCESS_COMMANDS = [
  'bg',
  'bg-clear',
  'bg-tasks',
  'bg-update',
  'jobs',
  'kill',
  'logs',
  'tasks',
] as const;
const FUSION_TOOLS = [
  'fusion_investigate',
  'fusion_reason',
  'fusion_research',
  'fusion_validate',
] as const;
const FUSION_COMMANDS = ['fusion', 'fusion-models'] as const;
const ADVANCED_TOOLS = ['bg_delegate', 'bg_result', 'bg_run_pi_attested', ...FUSION_TOOLS] as const;

interface RegistrationInventory {
  tools: string[];
  commands: string[];
  shortcuts: string[];
  renderers: string[];
}

function setEnv(key: (typeof FEATURE_ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

function configure(features?: string, shortcut?: string): void {
  setEnv('PI_BG_FEATURES', features);
  setEnv('PI_BG_DOCK_SHORTCUT', shortcut);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function inventory(result: LoadExtensionsResult): RegistrationInventory {
  return {
    tools: sorted(result.extensions.flatMap((extension) => [...extension.tools.keys()])),
    commands: sorted(result.extensions.flatMap((extension) => [...extension.commands.keys()])),
    shortcuts: sorted(result.extensions.flatMap((extension) => [...extension.shortcuts.keys()])),
    renderers: sorted(
      result.extensions.flatMap((extension) => [...extension.messageRenderers.keys()]),
    ),
  };
}

function expectedInventory(
  features: ReadonlySet<string>,
  shortcut = 'shift+down',
): RegistrationInventory {
  const tools: string[] = [...PROCESS_TOOLS];
  const commands: string[] = [...PROCESS_COMMANDS];
  const renderers: string[] = ['background-task-notification'];
  const shortcuts: string[] = ['ctrl+alt+c'];
  if (features.has('delegate')) tools.push('bg_delegate');
  if (features.has('delegate') || features.has('fusion')) tools.push('bg_result');
  if (features.has('attested')) tools.push('bg_run_pi_attested');
  if (features.has('fusion')) {
    tools.push(...FUSION_TOOLS);
    commands.push(...FUSION_COMMANDS);
    renderers.push('fusion-result');
  }
  if (features.has('attribution')) commands.push('claude-cache');
  if (shortcut !== 'off') shortcuts.push(shortcut);
  return {
    tools: sorted(tools),
    commands: sorted(commands),
    shortcuts: sorted(shortcuts),
    renderers: sorted(renderers),
  };
}

async function makeRoot(prefix: string): Promise<{ root: string; cwd: string; agentDir: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
  return { root, cwd, agentDir };
}

async function loadPackage(
  options: { extraPaths?: string[]; paths?: string[] } = {},
): Promise<{
  loader: DefaultResourceLoader;
  result: LoadExtensionsResult;
  cwd: string;
  agentDir: string;
}> {
  const { cwd, agentDir } = await makeRoot('pi-bg-feature-loader-');
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    eventBus: createEventBus(),
    additionalExtensionPaths: options.paths ?? [
      ambientAttributionPath,
      ...(options.extraPaths ?? []),
      backgroundPath,
    ],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
  });
  await loader.reload();
  return { loader, result: loader.getExtensions(), cwd, agentDir };
}

interface SessionHarness {
  session: AgentSession;
  loader: DefaultResourceLoader;
  eventBus: EventBus;
  modelRuntime: ModelRuntime;
  cwd: string;
  agentDir: string;
}

interface SessionHarnessOptions {
  setupModelRuntime?: (runtime: ModelRuntime) => void;
  onExtensionError?: (error: { event: string; error: string }) => void;
  skipBind?: boolean;
  paths?: string[];
}

async function makeSession(
  extraPaths: string[] = [],
  options: SessionHarnessOptions = {},
): Promise<SessionHarness> {
  const { cwd, agentDir } = await makeRoot('pi-bg-feature-session-');
  const settingsManager = SettingsManager.inMemory();
  const eventBus = createEventBus();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus,
    additionalExtensionPaths: options.paths ?? [
      ambientAttributionPath,
      ...extraPaths,
      backgroundPath,
    ],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
  });
  options.setupModelRuntime?.(modelRuntime);
  const created = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    settingsManager,
    modelRuntime,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: 'builtin',
  });
  assert.deepEqual(created.extensionsResult.errors, []);
  if (!options.skipBind) {
    await created.session.bindExtensions({
      onError: (error) => {
        if (options.onExtensionError) {
          options.onExtensionError(error);
          return;
        }
        assert.fail(`extension error: ${error.event}: ${error.error}`);
      },
    });
  }
  return { session: created.session, loader, eventBus, modelRuntime, cwd, agentDir };
}

function attributionClaimCount(eventBus: EventBus): number {
  let count = 0;
  eventBus.emit('pi-anthropic-attribution:claim:v1', {
    schema_version: 'pi-anthropic-attribution.claim.v1',
    acknowledge: () => {
      count += 1;
    },
  });
  return count;
}

function hasCacheCommand(session: AgentSession): boolean {
  return session.extensionRunner
    .getRegisteredCommands()
    .some((command) => command.invocationName === 'claude-cache');
}

function sessionInventory(session: AgentSession): RegistrationInventory {
  const runner = session.extensionRunner;
  const toolNames = [...PROCESS_TOOLS, ...ADVANCED_TOOLS].filter(
    (name) => session.getToolDefinition(name) !== undefined,
  );
  return {
    tools: sorted(toolNames),
    commands: sorted(runner.getRegisteredCommands().map((command) => command.invocationName)),
    shortcuts: sorted(runner.getShortcuts({}).keys()),
    renderers: sorted(
      ['background-task-notification', 'fusion-result'].filter(
        (name) => runner.getMessageRenderer(name) !== undefined,
      ),
    ),
  };
}

async function closeSession(session: AgentSession): Promise<void> {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}

async function dispatchEncodedKey(
  runner: ExtensionRunner,
  data: string,
): Promise<KeyId | undefined> {
  for (const [key, shortcut] of runner.getShortcuts({})) {
    if (!matchesKey(data, key)) continue;
    await shortcut.handler(runner.createContext());
    return key;
  }
  return undefined;
}

function uiWithDispatchCounters(
  base: ExtensionUIContext,
  customCalls: { value: number },
  statuses: string[],
): ExtensionUIContext {
  return {
    ...base,
    setStatus: (_key, text) => {
      if (text !== undefined) statuses.push(text);
    },
    custom: (async () => {
      customCalls.value += 1;
      return undefined;
    }) as ExtensionUIContext['custom'],
  };
}

async function executeTool(session: AgentSession, name: string, params: unknown): Promise<unknown> {
  const tool = session.getToolDefinition(name);
  assert.ok(tool, `missing tool ${name}`);
  return tool.execute(
    `feature-${name}`,
    params,
    undefined,
    undefined,
    session.extensionRunner.createContext(),
  );
}

afterEach(async () => {
  for (const key of FEATURE_ENV_KEYS) setEnv(key, originalEnv.get(key));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

void describe('C1a feature selection and dock configuration', { concurrency: false }, () => {
  void it('loads the compiled distribution entrypoints with the complete default surface', async () => {
    configure(undefined, undefined);
    const { session } = await makeSession([], {
      paths: [compiledAmbientAttributionPath, compiledBackgroundPath],
    });
    try {
      const all = new Set(['process', 'delegate', 'fusion', 'attested', 'attribution']);
      assert.deepEqual(sessionInventory(session), expectedInventory(all));
    } finally {
      await closeSession(session);
    }
  });

  void it('loads compiled process-only mode without advanced registrations', async () => {
    configure('process', 'off');
    const { session } = await makeSession([], {
      paths: [compiledAmbientAttributionPath, compiledBackgroundPath],
    });
    try {
      assert.deepEqual(sessionInventory(session), expectedInventory(new Set(['process']), 'off'));
    } finally {
      await closeSession(session);
    }
  });

  void it('keeps the default full public registration surface', async () => {
    configure(undefined, undefined);
    const { session } = await makeSession();
    try {
      const all = new Set(['process', 'delegate', 'fusion', 'attested', 'attribution']);
      assert.deepEqual(sessionInventory(session), expectedInventory(all));
      for (const name of [...PROCESS_TOOLS, ...ADVANCED_TOOLS]) {
        assert.ok(
          session.getActiveToolNames().includes(name),
          `${name} should be active by default`,
        );
      }
    } finally {
      await closeSession(session);
    }
  });

  void it('activates the exact surface for all 16 optional-capability subsets', async () => {
    const optional = ['delegate', 'fusion', 'attested', 'attribution'] as const;
    for (let mask = 0; mask < 1 << optional.length; mask += 1) {
      const enabled = optional.filter((_feature, index) => (mask & (1 << index)) !== 0);
      const features = new Set<string>(['process', ...enabled]);
      configure([...features].join(','), undefined);
      const { session } = await makeSession();
      try {
        const actual = sessionInventory(session);
        assert.deepEqual(
          actual,
          expectedInventory(features),
          `inventory for ${[...features].join(',')}`,
        );
        assert.equal(
          actual.tools.filter((name) => name === 'bg_result').length,
          features.has('delegate') || features.has('fusion') ? 1 : 0,
        );
      } finally {
        await closeSession(session);
      }
    }
  });

  void it('fails malformed settings before any package registration with bounded diagnostics', async () => {
    const invalidCases: Array<{ features?: string; shortcut?: string; expected: RegExp }> = [
      { features: '', expected: /PI_BG_FEATURES.*empty/i },
      { features: 'process,', expected: /blank/i },
      { features: 'process, delegate', expected: /whitespace/i },
      { features: 'process,delegate,delegate', expected: /duplicate.*delegate/i },
      { features: 'process,unknown', expected: /unknown.*accepted/i },
      { features: 'delegate', expected: /mandatory.*process/i },
      { features: 'process,bg_result', expected: /bg_result.*accepted/i },
      { features: 'PROCESS', expected: /PROCESS.*accepted/i },
      { features: 'process', shortcut: 'shift+up', expected: /PI_BG_DOCK_SHORTCUT.*accepted/i },
      { features: `process,${'x'.repeat(10_000)}`, expected: /pi_bg_config_invalid/i },
    ];
    for (const testCase of invalidCases) {
      configure(testCase.features, testCase.shortcut);
      const { result } = await loadPackage();
      assert.ok(result.errors.length >= 1, `expected load error for ${JSON.stringify(testCase)}`);
      const message = result.errors.map((error) => error.error).join('\n');
      assert.match(message, /pi_bg_config_invalid/);
      assert.match(message, testCase.expected);
      assert.ok(
        message.length < 8_000,
        `diagnostic should stay bounded, got ${String(message.length)}`,
      );
      assert.doesNotMatch(message, /x{200}/, 'oversized invalid values must not be echoed');
      assert.deepEqual(inventory(result), {
        tools: [],
        commands: [],
        shortcuts: [],
        renderers: [],
      });
    }
  });

  void it('keeps ambient attribution off while the explicit child entry remains mandatory', async () => {
    configure('process', 'off');
    const ambient = await loadPackage({ paths: [ambientAttributionPath] });
    assert.deepEqual(ambient.result.errors, []);
    assert.deepEqual(inventory(ambient.result), {
      tools: [],
      commands: [],
      shortcuts: [],
      renderers: [],
    });
    assert.equal(ambient.result.runtime.pendingProviderRegistrations.length, 0);
    assert.equal(
      ambient.result.extensions.reduce(
        (count, extension) => count + [...extension.handlers.values()].flat().length,
        0,
      ),
      0,
    );

    const child = await loadPackage({ paths: [childAttributionPath] });
    assert.deepEqual(child.result.errors, []);
    assert.deepEqual(inventory(child.result).commands, ['claude-cache']);
    assert.equal(child.result.runtime.pendingProviderRegistrations.length, 1);
    assert.equal(child.result.runtime.pendingProviderRegistrations[0]?.name, 'anthropic');
    assert.ok(
      child.result.extensions.reduce(
        (count, extension) => count + [...extension.handlers.values()].flat().length,
        0,
      ) >= 3,
    );
  });

  void it('restores preexisting public config, routing, auth, stream, and future merges', async () => {
    configure('process,attribution', 'off');
    const routeContext: Context = {
      systemPrompt: 'provider route fixture',
      messages: [],
      tools: [],
    };
    const routeCalls: Array<{
      baseUrl: string | undefined;
      contextIdentity: boolean;
      sessionId: string | undefined;
      apiKeyMatches: boolean;
      hostHeader: string | null | undefined;
    }> = [];
    const hostStream: NonNullable<
      NonNullable<ReturnType<ModelRuntime['getRegisteredProviderConfig']>>['streamSimple']
    > = (model, context, options) => {
      routeCalls.push({
        baseUrl: model.baseUrl,
        contextIdentity: context === routeContext,
        sessionId: options?.sessionId,
        apiKeyMatches: options?.apiKey === 'host-secret-marker',
        hostHeader: options?.headers?.['x-host-route'],
      });
      throw new Error('host-route-invoked');
    };
    const { session, modelRuntime } = await makeSession([], {
      setupModelRuntime: (runtime) => {
        runtime.registerProvider('anthropic', {
          api: 'anthropic-messages',
          apiKey: 'host-secret-marker',
          baseUrl: 'https://host-route.invalid/v1',
          headers: { 'x-host-route': 'original' },
          streamSimple: hostStream,
        });
      },
    });
    try {
      assert.notEqual(
        modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple,
        hostStream,
        'package provider must be installed while attribution is enabled',
      );
      configure('process', 'off');
      await session.reload();
      const restored = modelRuntime.getRegisteredProviderConfig('anthropic');
      assert.equal(restored?.streamSimple, hostStream);
      assert.equal(restored?.baseUrl, 'https://host-route.invalid/v1');
      assert.equal(restored?.headers?.['x-host-route'], 'original');
      assert.equal((await modelRuntime.getAuth('anthropic'))?.auth.apiKey, 'host-secret-marker');

      const model = modelRuntime
        .getModels('anthropic')
        .find((candidate) => candidate.api === 'anthropic-messages');
      assert.ok(model, 'fixture requires an Anthropic messages model');
      const restoredResult = await modelRuntime
        .streamSimple(model, routeContext, { sessionId: 'restored-route' })
        .result();
      assert.equal(restoredResult.stopReason, 'error');
      assert.match(restoredResult.errorMessage ?? '', /host-route-invoked/);

      modelRuntime.registerProvider('anthropic', {
        baseUrl: 'https://future-merge.invalid/v1',
      });
      const future = modelRuntime.getRegisteredProviderConfig('anthropic');
      assert.equal(future?.streamSimple, hostStream);
      assert.equal(future?.headers?.['x-host-route'], 'original');
      assert.equal(future?.baseUrl, 'https://future-merge.invalid/v1');
      assert.equal((await modelRuntime.getAuth('anthropic'))?.auth.apiKey, 'host-secret-marker');
      const futureModel = modelRuntime
        .getModels('anthropic')
        .find((candidate) => candidate.api === 'anthropic-messages');
      assert.ok(futureModel, 'future merge must retain an Anthropic messages model');
      const futureResult = await modelRuntime
        .streamSimple(futureModel, routeContext, { sessionId: 'future-route' })
        .result();
      assert.equal(futureResult.stopReason, 'error');
      assert.match(futureResult.errorMessage ?? '', /host-route-invoked/);
      assert.deepEqual(routeCalls, [
        {
          baseUrl: 'https://host-route.invalid/v1',
          contextIdentity: true,
          sessionId: 'restored-route',
          apiKeyMatches: true,
          hostHeader: 'original',
        },
        {
          baseUrl: 'https://future-merge.invalid/v1',
          contextIdentity: true,
          sessionId: 'future-route',
          apiKeyMatches: true,
          hostHeader: 'original',
        },
      ]);
    } finally {
      await closeSession(session);
    }
  });

  void it('restores exact public absence when no dynamic provider existed before activation', async () => {
    configure('process,attribution', 'off');
    let builtinProvider: ReturnType<ModelRuntime['getProvider']>;
    const { session, modelRuntime } = await makeSession([], {
      setupModelRuntime: (runtime) => {
        assert.equal(runtime.getRegisteredProviderConfig('anthropic'), undefined);
        assert.equal(runtime.getRegisteredNativeProvider('anthropic'), undefined);
        builtinProvider = runtime.getProvider('anthropic');
        assert.ok(builtinProvider, 'fixture requires the built-in Anthropic provider');
      },
    });
    try {
      assert.ok(modelRuntime.getRegisteredProviderConfig('anthropic'));
      configure('process', 'off');
      await session.reload();
      assert.equal(modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
      assert.equal(modelRuntime.getRegisteredNativeProvider('anthropic'), undefined);
      assert.equal(modelRuntime.getRegisteredProviderIds().includes('anthropic'), false);
      assert.equal(modelRuntime.getProvider('anthropic'), builtinProvider);
    } finally {
      await closeSession(session);
    }
  });

  void it('accepts a host-refreshed built-in while restoring exact dynamic absence', async () => {
    configure('process,attribution', 'off');
    const extensionErrors: Array<{ event: string; error: string }> = [];
    let originalBuiltin: ReturnType<ModelRuntime['getProvider']>;
    let refreshedBuiltin: ReturnType<ModelRuntime['getProvider']>;
    const { session, modelRuntime } = await makeSession([], {
      setupModelRuntime: (runtime) => {
        const originalGetProvider = runtime.getProvider.bind(runtime);
        const originalUnregisterProvider = runtime.unregisterProvider.bind(runtime);
        originalBuiltin = originalGetProvider('anthropic');
        assert.ok(originalBuiltin, 'fixture requires the built-in Anthropic provider');

        const getProvider: ModelRuntime['getProvider'] = (providerId) => {
          if (
            providerId === 'anthropic' &&
            refreshedBuiltin !== undefined &&
            runtime.getRegisteredProviderConfig(providerId) === undefined &&
            runtime.getRegisteredNativeProvider(providerId) === undefined
          ) {
            return refreshedBuiltin;
          }
          return originalGetProvider(providerId);
        };
        runtime.getProvider = getProvider;
        runtime.unregisterProvider = (providerId) => {
          originalUnregisterProvider(providerId);
          if (providerId !== 'anthropic') return;
          const currentBuiltin = originalGetProvider(providerId);
          assert.ok(currentBuiltin, 'host refresh fixture requires the restored built-in');
          refreshedBuiltin = Object.freeze({
            ...currentBuiltin,
            name: `${currentBuiltin.name} refreshed`,
          });
        };
      },
      onExtensionError: (error) => extensionErrors.push(error),
    });
    try {
      assert.ok(modelRuntime.getRegisteredProviderConfig('anthropic'));
      configure('process', 'off');
      await session.reload();
      assert.equal(modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
      assert.equal(modelRuntime.getRegisteredNativeProvider('anthropic'), undefined);
      assert.equal(modelRuntime.getRegisteredProviderIds().includes('anthropic'), false);
      assert.ok(refreshedBuiltin);
      assert.notEqual(refreshedBuiltin, originalBuiltin);
      assert.equal(modelRuntime.getProvider('anthropic'), refreshedBuiltin);
      assert.deepEqual(extensionErrors, []);
    } finally {
      await closeSession(session);
    }
  });

  void it('restores a preexisting native provider object by exact public identity', async () => {
    configure('process,attribution', 'off');
    let nativeProvider: ReturnType<ModelRuntime['getProvider']>;
    const { session, modelRuntime } = await makeSession([], {
      setupModelRuntime: (runtime) => {
        nativeProvider = runtime.getProvider('anthropic');
        assert.ok(nativeProvider);
        runtime.registerNativeProvider(nativeProvider);
      },
    });
    try {
      assert.equal(modelRuntime.getRegisteredNativeProvider('anthropic'), undefined);
      configure('process', 'off');
      await session.reload();
      assert.equal(modelRuntime.getRegisteredNativeProvider('anthropic'), nativeProvider);
      assert.equal(modelRuntime.getProvider('anthropic'), nativeProvider);
    } finally {
      await closeSession(session);
    }
  });

  void it('does not remove a provider owner installed after this attribution instance', async () => {
    configure('process,attribution', 'off');
    function laterStream(): never {
      throw new Error('later owner marker');
    }
    const { session, modelRuntime } = await makeSession();
    let shutdown = false;
    try {
      modelRuntime.registerProvider('anthropic', {
        api: 'anthropic-messages',
        streamSimple: laterStream,
      });
      assert.equal(
        modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple,
        laterStream,
      );
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      shutdown = true;
      assert.equal(
        modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple,
        laterStream,
        'later dynamic owner must survive package shutdown',
      );
      assert.ok(modelRuntime.getProvider('anthropic'), 'later provider must remain effective');
    } finally {
      if (!shutdown)
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
    }
  });

  void it('does not remove a later native provider owner', async () => {
    configure('process,attribution', 'off');
    let hostProvider: ReturnType<ModelRuntime['getProvider']>;
    const { session, modelRuntime } = await makeSession([], {
      setupModelRuntime: (runtime) => {
        hostProvider = runtime.getProvider('anthropic');
        assert.ok(hostProvider);
      },
    });
    assert.ok(hostProvider);
    const laterNative = Object.freeze({
      ...hostProvider,
      name: `${hostProvider.name} later-owner`,
    });
    let shutdown = false;
    try {
      modelRuntime.registerNativeProvider(laterNative);
      assert.equal(modelRuntime.getRegisteredNativeProvider('anthropic'), laterNative);
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      shutdown = true;
      assert.equal(modelRuntime.getRegisteredNativeProvider('anthropic'), laterNative);
      assert.equal(modelRuntime.getProvider('anthropic'), laterNative);
      assert.equal(modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
    } finally {
      if (!shutdown)
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
    }
  });

  void it('publishes no attribution owner or command when immediate provider installation fails', async () => {
    configure('process,attribution', 'off');
    function hostStream(): never {
      throw new Error('failure host marker');
    }
    let packageRegistrationFailures = 0;
    const extensionErrors: Array<{ event: string; error: string }> = [];
    const { session, modelRuntime, eventBus } = await makeSession([], {
      setupModelRuntime: (runtime) => {
        runtime.registerProvider('anthropic', {
          api: 'anthropic-messages',
          streamSimple: hostStream,
        });
        const realRegister = runtime.registerProvider.bind(runtime);
        const rejectingRegister: ModelRuntime['registerProvider'] = (
          providerId,
          providerConfig,
        ) => {
          if (providerId === 'anthropic' && providerConfig.streamSimple !== hostStream) {
            packageRegistrationFailures += 1;
            throw new Error('fixture rejects package provider registration');
          }
          realRegister(providerId, providerConfig);
        };
        runtime.registerProvider = rejectingRegister;
      },
      onExtensionError: (error) => extensionErrors.push(error),
    });
    try {
      let claimAcks = 0;
      eventBus.emit('pi-anthropic-attribution:claim:v1', {
        schema_version: 'pi-anthropic-attribution.claim.v1',
        acknowledge: () => {
          claimAcks += 1;
        },
      });
      assert.equal(packageRegistrationFailures, 1);
      assert.ok(
        extensionErrors.some(
          (error) => error.event === 'session_start' && /fixture rejects/.test(error.error),
        ),
        `expected session_start installation error: ${JSON.stringify(extensionErrors)}`,
      );
      assert.equal(modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple, hostStream);
      assert.equal(
        session.extensionRunner
          .getRegisteredCommands()
          .some((command) => command.invocationName === 'claude-cache'),
        false,
      );
      assert.equal(claimAcks, 0, 'failed installation must not publish attribution ownership');
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      assert.equal(
        modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple,
        hostStream,
        'failed installer cleanup must leave the host provider untouched',
      );
    } finally {
      session.dispose();
    }
  });

  void it('preserves active external tools that collide with disabled package capability names', async () => {
    configure('process', 'off');
    const { session } = await makeSession([featureToolCollisionsPath]);
    try {
      const expected = ['bg_delegate', 'fusion_brainstorm', 'external_feature_control'];
      for (const name of expected) {
        assert.ok(session.getToolDefinition(name), `${name} must remain registered`);
        assert.ok(session.getActiveToolNames().includes(name), `${name} must remain active`);
      }
      const byName = new Map(session.getAllTools().map((tool) => [tool.name, tool]));
      for (const name of expected) {
        assert.match(
          byName.get(name)?.sourceInfo.path ?? '',
          /feature-tool-collisions\.ts$/u,
          `${name} must retain external source provenance`,
        );
      }
    } finally {
      await closeSession(session);
    }
  });

  void it('keeps an independent ambient copy inert after one successful owner installs', async () => {
    configure('process,attribution', 'off');
    const { session, eventBus } = await makeSession([attributionCopyPath]);
    try {
      const cacheCommands = session.extensionRunner
        .getRegisteredCommands()
        .filter((command) => command.name === 'claude-cache');
      assert.equal(cacheCommands.length, 1, 'duplicate copies must expose one cache command');
      let claimAcks = 0;
      eventBus.emit('pi-anthropic-attribution:claim:v1', {
        schema_version: 'pi-anthropic-attribution.claim.v1',
        acknowledge: () => {
          claimAcks += 1;
        },
      });
      assert.equal(claimAcks, 1, 'duplicate copies must publish one successful owner');
    } finally {
      await closeSession(session);
    }
  });

  void it('characterizes counted host bindings versus bare, empty, and mode-only SDK paths', async () => {
    configure('process,attribution', 'off');
    const bare = await makeSession([], { skipBind: true });
    try {
      assert.equal(attributionClaimCount(bare.eventBus), 0, 'bare createAgentSession is blocked');
      assert.equal(hasCacheCommand(bare.session), false);
      assert.equal(bare.modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
      assert.equal(bare.modelRuntime.getRegisteredNativeProvider('anthropic'), undefined);
    } finally {
      await closeSession(bare.session);
    }

    configure('process,attribution', 'off');
    const empty = await makeSession([], { skipBind: true });
    try {
      await empty.session.bindExtensions({});
      assert.equal(attributionClaimCount(empty.eventBus), 1);
      assert.equal(hasCacheCommand(empty.session), true);
      configure('process', 'off');
      await empty.session.reload();
      assert.equal(empty.modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
      assert.equal(empty.modelRuntime.getRegisteredNativeProvider('anthropic'), undefined);
      configure('process,attribution', 'off');
      await empty.session.reload();
      assert.equal(
        attributionClaimCount(empty.eventBus),
        0,
        'empty-binding reload remains blocked',
      );
      assert.equal(hasCacheCommand(empty.session), false);
      await empty.session.bindExtensions({});
      assert.equal(
        attributionClaimCount(empty.eventBus),
        1,
        'explicit post-reload rebind initializes',
      );
      assert.equal(hasCacheCommand(empty.session), true);
    } finally {
      await closeSession(empty.session);
    }

    configure('process,attribution', 'off');
    const modeOnly = await makeSession([], { skipBind: true });
    try {
      await modeOnly.session.bindExtensions({ mode: 'print' });
      assert.equal(attributionClaimCount(modeOnly.eventBus), 1);
      configure('process', 'off');
      await modeOnly.session.reload();
      configure('process,attribution', 'off');
      await modeOnly.session.reload();
      assert.equal(attributionClaimCount(modeOnly.eventBus), 0, 'mode-only reload remains blocked');
      assert.equal(hasCacheCommand(modeOnly.session), false);
    } finally {
      await closeSession(modeOnly.session);
    }

    configure('process,attribution', 'off');
    const counted = await makeSession([], { skipBind: true });
    try {
      const extensionErrors: Array<{ event: string; error: string }> = [];
      await counted.session.bindExtensions({
        mode: 'print',
        onError: (error) => extensionErrors.push(error),
      });
      assert.equal(attributionClaimCount(counted.eventBus), 1);
      assert.equal(hasCacheCommand(counted.session), true);
      configure('process', 'off');
      await counted.session.reload();
      configure('process,attribution', 'off');
      await counted.session.reload();
      assert.equal(attributionClaimCount(counted.eventBus), 1);
      assert.equal(hasCacheCommand(counted.session), true);
      assert.deepEqual(extensionErrors, []);
    } finally {
      await closeSession(counted.session);
    }
  });

  void it('rebuilds one successful attribution claim across enabled-disabled-enabled reload', async () => {
    configure(undefined, 'shift+down');
    const { session, eventBus } = await makeSession();
    const claimCount = (): number => {
      let count = 0;
      eventBus.emit('pi-anthropic-attribution:claim:v1', {
        schema_version: 'pi-anthropic-attribution.claim.v1',
        acknowledge: () => {
          count += 1;
        },
      });
      return count;
    };
    try {
      assert.equal(claimCount(), 1);
      configure('process', 'off');
      await session.reload();
      assert.equal(claimCount(), 0);
      configure('process,attribution', 'ctrl+alt+b');
      await session.reload();
      assert.equal(claimCount(), 1);
    } finally {
      await closeSession(session);
    }
  });

  void it('rebuilds exact registrations and active tools across a real AgentSession reload', async () => {
    configure(undefined, undefined);
    const { session } = await makeSession();
    try {
      assert.ok(session.getToolDefinition('fusion_reason'));
      assert.ok(session.getToolDefinition('bg_delegate'));
      assert.ok(session.getToolDefinition('bg_result'));
      assert.ok(session.getActiveToolNames().includes('fusion_reason'));
      assert.equal(session.extensionRunner.hasHandlers('session_tree'), true);
      const ambientProvider = session.extensionRunner.getModelRegistry().getProvider('anthropic');
      assert.ok(ambientProvider);

      configure('process', 'off');
      await session.reload();
      assert.deepEqual(sessionInventory(session), expectedInventory(new Set(['process']), 'off'));
      for (const name of ADVANCED_TOOLS) {
        assert.equal(
          session.getToolDefinition(name),
          undefined,
          `${name} must be absent after reload`,
        );
        assert.equal(
          session.getActiveToolNames().includes(name),
          false,
          `${name} must not stay active`,
        );
      }
      assert.equal(session.extensionRunner.hasHandlers('session_tree'), false);
      const restoredProvider = session.extensionRunner.getModelRegistry().getProvider('anthropic');
      assert.ok(restoredProvider);
      assert.notEqual(
        restoredProvider.streamSimple,
        ambientProvider.streamSimple,
        'reload must remove the package-owned ambient provider implementation',
      );

      configure('process,delegate', 'ctrl+alt+b');
      await session.reload();
      assert.deepEqual(
        sessionInventory(session),
        expectedInventory(new Set(['process', 'delegate']), 'ctrl+alt+b'),
      );
      assert.ok(session.getToolDefinition('bg_delegate'));
      assert.ok(session.getToolDefinition('bg_result'));
      assert.equal(session.getToolDefinition('fusion_reason'), undefined);
      assert.equal(
        session.extensionRunner
          .getRegisteredCommands()
          .some((command) => command.invocationName === 'claude-cache'),
        false,
      );
    } finally {
      await closeSession(session);
    }
  });

  void it('avoids the fixture Shift+Down conflict and dispatches both encoded keys to their owners', async () => {
    configure('process', 'ctrl+alt+b');
    const { session, eventBus } = await makeSession([shortcutOwnerPath]);
    const fixtureEvents: unknown[] = [];
    const unsubscribe = eventBus.on('pi-bg-test:shortcut-owner:shift-down', (event) =>
      fixtureEvents.push(event),
    );
    const customCalls = { value: 0 };
    const statuses: string[] = [];
    session.extensionRunner.setUIContext(
      uiWithDispatchCounters(session.extensionRunner.getUIContext(), customCalls, statuses),
    );
    try {
      const shortcuts = session.extensionRunner.getShortcuts({});
      assert.deepEqual(sorted(shortcuts.keys()), ['ctrl+alt+b', 'ctrl+alt+c', 'shift+down']);
      assert.equal(
        session.extensionRunner
          .getShortcutDiagnostics()
          .some((diagnostic) => /shortcut conflict/i.test(diagnostic.message)),
        false,
      );

      assert.equal(await dispatchEncodedKey(session.extensionRunner, '\u001b[1;2B'), 'shift+down');
      assert.equal(fixtureEvents.length, 1);
      assert.equal(customCalls.value, 0);

      assert.equal(await dispatchEncodedKey(session.extensionRunner, '\u001b\u0002'), 'ctrl+alt+b');
      assert.equal(customCalls.value, 1);
      assert.ok(statuses.some((status) => status.includes('focused')) || customCalls.value === 1);
    } finally {
      unsubscribe();
      await closeSession(session);
    }
  });

  void it('registers no dock shortcut in off mode while commands and fixture dispatch still work', async () => {
    configure('process', 'off');
    const { session, eventBus } = await makeSession([shortcutOwnerPath]);
    const fixtureEvents: unknown[] = [];
    const unsubscribe = eventBus.on('pi-bg-test:shortcut-owner:shift-down', (event) =>
      fixtureEvents.push(event),
    );
    const customCalls = { value: 0 };
    session.extensionRunner.setUIContext(
      uiWithDispatchCounters(session.extensionRunner.getUIContext(), customCalls, []),
    );
    try {
      const shortcuts = session.extensionRunner.getShortcuts({});
      assert.deepEqual(sorted(shortcuts.keys()), ['ctrl+alt+c', 'shift+down']);
      assert.equal(
        session.extensionRunner
          .getShortcutDiagnostics()
          .some((diagnostic) => /shortcut conflict/i.test(diagnostic.message)),
        false,
      );
      assert.equal(await dispatchEncodedKey(session.extensionRunner, '\u001b[1;2B'), 'shift+down');
      assert.equal(fixtureEvents.length, 1);
      assert.equal(await dispatchEncodedKey(session.extensionRunner, '\u001b\u0002'), undefined);

      for (const commandName of ['tasks', 'bg-tasks']) {
        const command = session.extensionRunner
          .getRegisteredCommands()
          .find((candidate) => candidate.invocationName === commandName);
        assert.ok(command, `/${commandName} must remain registered`);
        await command.handler('', session.extensionRunner.createCommandContext());
      }
      assert.equal(customCalls.value, 2);

      const response = new Promise<unknown>((resolve) => {
        const remove = eventBus.on(BG_RESPONSE_CHANNEL, (value) => {
          remove();
          resolve(value);
        });
      });
      eventBus.emit(BG_REQUEST_CHANNEL, {
        schema_version: BG_REQUEST_SCHEMA,
        request_id: 'process-only-capabilities',
        operation: 'capabilities',
        payload: {},
      });
      const event = await response;
      assert.ok(event && typeof event === 'object');
      assert.equal(Reflect.get(event, 'schema_version'), BG_RESPONSE_SCHEMA);
      assert.equal(Reflect.get(event, 'request_id'), 'process-only-capabilities');
      assert.equal(Reflect.get(event, 'ok'), true);
    } finally {
      unsubscribe();
      await closeSession(session);
    }
  });

  void it('derives the actual footer hint from default, alternate, and off shortcut config', async () => {
    for (const testCase of [
      { shortcut: undefined, expected: 'Shift↓' },
      { shortcut: 'ctrl+alt+b', expected: 'CtrlAltB' },
      { shortcut: 'off', expected: '/tasks' },
    ] as const) {
      configure('process', testCase.shortcut);
      const { session } = await makeSession();
      const statuses: string[] = [];
      session.extensionRunner.setUIContext(
        uiWithDispatchCounters(session.extensionRunner.getUIContext(), { value: 0 }, statuses),
      );
      try {
        const result = await executeTool(session, 'bg_run', {
          name: 'Feature footer',
          command: `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
          isAgent: false,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        });
        assert.ok(result && typeof result === 'object');
        const jobs = session.extensionRunner
          .getRegisteredCommands()
          .find((command) => command.invocationName === 'jobs');
        assert.ok(jobs);
        await jobs.handler('', session.extensionRunner.createCommandContext());
        assert.ok(
          statuses.some((status) => status.includes(testCase.expected)),
          `footer should include ${testCase.expected}: ${statuses.join(' | ')}`,
        );
        const details = Reflect.get(result, 'details') as { task?: { id?: string } } | undefined;
        const taskId = details?.task?.id;
        assert.equal(typeof taskId, 'string');
        await executeTool(session, 'bg_kill', { taskId });
      } finally {
        await closeSession(session);
      }
    }
  });
});
