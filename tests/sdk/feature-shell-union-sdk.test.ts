import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type EventBus,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { parseJsonText } from '../../src/core/common.js';
import {
  BG_REQUEST_CHANNEL,
  BG_REQUEST_SCHEMA,
  BG_RESPONSE_CHANNEL,
  BG_RESPONSE_SCHEMA,
} from '../../src/core/extension-api.js';

const ambientAttributionPath = resolve('extensions/anthropic-attribution.ts');
const backgroundPath = resolve('extensions/background-tasks.ts');
const PROVIDER = 'pi-bg-feature-shell-union';
const MODEL_ID = 'feature-shell-union-model';
const API = 'pi-bg-feature-shell-union-api';
const COMMAND = 'shell_policy_probe Ω with spaces';
const PEER_GUIDANCE =
  '<pi_background_feature_guidance>peer feature guidance survives</pi_background_feature_guidance>';
const ENV_KEYS = [
  'PI_BG_FEATURES',
  'PI_BG_DOCK_SHORTCUT',
  'PI_BG_POSIX_SHELL',
  'PI_BG_POSIX_SHELL_PATH',
  'SHELL',
] as const;

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
const ALL_PACKAGE_TOOLS = [
  ...PROCESS_TOOLS,
  'bg_delegate',
  'bg_result',
  'bg_run_pi_attested',
  ...FUSION_TOOLS,
] as const;
const ALL_PACKAGE_COMMANDS = [
  ...PROCESS_COMMANDS,
  'claude-cache',
  'fusion',
  'fusion-models',
] as const;
const DEFAULT_USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type JsonObject = Record<PropertyKey, unknown>;

interface ProviderObservation {
  readonly guidance: JsonObject | undefined;
  readonly peerGuidanceCount: number;
  readonly shellGuidanceCount: number;
  readonly toolNames: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, label: string): JsonObject {
  assert.ok(isObject(value), label);
  return value;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

function messageText(message: unknown): string {
  if (!isObject(message)) return '';
  const content = message['content'];
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((part: unknown) =>
            isObject(part) && typeof part['text'] === 'string' ? part['text'] : '',
          )
          .join(' ')
      : '';
}

function effectiveSystemPrompt(context: Context): string {
  if (typeof context.systemPrompt === 'string' && context.systemPrompt.length > 0) {
    return context.systemPrompt;
  }
  const parts: string[] = [];
  for (const knownMessage of context.messages) {
    const message: unknown = knownMessage;
    if (!isObject(message) || message['role'] !== 'system') continue;
    const content = messageText(message);
    if (content.length > 0) parts.push(content);
    if (!isObject(message['sections'])) continue;
    for (const [name, value] of Object.entries(message['sections'])) {
      if (typeof value === 'string') parts.push(`<${name}>\n${value}\n</${name}>`);
    }
  }
  return parts.join('\n\n');
}

function guidanceFrom(systemPrompt: string): JsonObject | undefined {
  const match = /activation shell policy (\{[^\n]+\})\./u.exec(systemPrompt);
  if (match?.[1] === undefined) return undefined;
  const parsed: unknown = JSON.parse(match[1]);
  return isObject(parsed) ? parsed : undefined;
}

function stopMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Feature and shell union observed.' }],
    api: API,
    provider: PROVIDER,
    model: MODEL_ID,
    usage: DEFAULT_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function stoppedStream(): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = stopMessage();
  queueMicrotask(() => {
    const partial: AssistantMessage = { ...message, content: [], stopReason: 'pending' };
    stream.push({ type: 'start', partial: { ...partial } });
    const text = message.content[0];
    assert.ok(text?.type === 'text');
    partial.content = [{ type: 'text', text: '' }];
    stream.push({ type: 'text_start', contentIndex: 0, partial: { ...partial } });
    stream.push({ type: 'text_delta', contentIndex: 0, delta: text.text, partial: { ...partial } });
    stream.push({ type: 'text_end', contentIndex: 0, content: text.text, partial: { ...partial } });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
  });
  return stream;
}

function unionPeerAndProviderExtension(
  observations: ProviderObservation[],
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_agent_start', (event) => ({
      systemPrompt: `${event.systemPrompt}\n\n${PEER_GUIDANCE}`,
    }));
    pi.registerProvider(PROVIDER, {
      name: 'Feature/shell union scripted provider',
      baseUrl: 'http://localhost:0',
      apiKey: 'offline-feature-shell-union-key',
      api: API,
      models: [
        {
          id: MODEL_ID,
          name: 'Feature/shell union model',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_000,
          maxTokens: 1024,
        },
      ],
      streamSimple(_model: Model<Api>, context: Context): AssistantMessageEventStream {
        const prompt = effectiveSystemPrompt(context);
        observations.push({
          guidance: guidanceFrom(prompt),
          peerGuidanceCount: prompt.split(PEER_GUIDANCE).length - 1,
          shellGuidanceCount: prompt.split('<pi_background_shell_policy>').length - 1,
          toolNames: sorted(context.tools?.map((tool) => tool.name) ?? []),
        });
        return stoppedStream();
      },
    });
  };
}

async function makeFakeNu(path: string, argvPath: string, label: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      `const { writeFileSync } = require('node:fs');`,
      `const args = process.argv.slice(2);`,
      `writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(args), 'utf8');`,
      `if (args[0] !== '-c' || args[1] !== ${JSON.stringify(COMMAND)}) {`,
      `  process.stderr.write('unexpected fake Nu argv: ' + JSON.stringify(args));`,
      `  process.exitCode = 9;`,
      `} else {`,
      `  process.stdout.write(${JSON.stringify(`${label} selected Ω with spaces\n`)});`,
      `}`,
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
      const response = object(value, 'response frame');
      if (response['schema_version'] !== BG_RESPONSE_SCHEMA || response['request_id'] !== requestId)
        return;
      clearTimeout(timeout);
      unsubscribe();
      resolveResponse(response);
    });
  });
}

async function runTask(
  eventBus: EventBus,
  requestId: string,
): Promise<JsonObject> {
  const pending = responseFor(eventBus, requestId);
  eventBus.emit(BG_REQUEST_CHANNEL, {
    schema_version: BG_REQUEST_SCHEMA,
    request_id: requestId,
    operation: 'run',
    payload: {
      name: requestId,
      command: COMMAND,
      isAgent: false,
      notifyOnCompletion: false,
      triggerOnCompletion: false,
    },
  });
  const response = await pending;
  assert.equal(response['ok'], true, String(response['error'] ?? 'run failed'));
  return object(response['result'], 'run task');
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

function registeredCommands(session: AgentSession): string[] {
  return sorted(
    session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName),
  );
}

function registeredPackageTools(session: AgentSession): string[] {
  return sorted(ALL_PACKAGE_TOOLS.filter((name) => session.getToolDefinition(name) !== undefined));
}

async function exerciseActivation(options: {
  readonly session: AgentSession;
  readonly eventBus: EventBus;
  readonly observations: ProviderObservation[];
  readonly cwd: string;
  readonly shell: string;
  readonly argvPath: string;
  readonly label: string;
  readonly expectedTools: readonly string[];
}): Promise<void> {
  const before = options.observations.length;
  await options.session.prompt(`Observe the ${options.label} feature/shell activation.`);
  await options.session.agent.waitForIdle();
  const observed = options.observations.slice(before);
  assert.equal(observed.length, 1, 'the actual provider must observe one prompt');
  assert.deepEqual(observed[0]?.guidance, {
    policy: 'inherit',
    executable: options.shell,
    dialect: 'user-non-posix',
    args: ['-c', '<command>'],
  });
  assert.equal(observed[0]?.shellGuidanceCount, 1);
  assert.equal(observed[0]?.peerGuidanceCount, 1);
  assert.deepEqual(observed[0]?.toolNames, sorted(options.expectedTools));

  const task = await runTask(options.eventBus, `union-${options.label}`);
  const shellPolicy = object(task['shellPolicy'], 'task shell policy');
  assert.deepEqual(shellPolicy, {
    policy: 'inherit',
    executable: options.shell,
    argvPrefix: ['-c'],
    dialect: 'user-non-posix',
  });
  const outputPath = String(task['outputPath']);
  const metadata = await terminalMetadata(
    join(options.cwd, outputPath.replace(/\.output$/u, '.json')),
  );
  assert.equal(metadata['status'], 'completed');
  assert.deepEqual(metadata['shellPolicy'], shellPolicy);
  assert.deepEqual(JSON.parse(await readFile(options.argvPath, 'utf8')), ['-c', COMMAND]);
  assert.match(await readFile(join(options.cwd, outputPath), 'utf8'), new RegExp(options.label, 'u'));
}

void describe('C1a capability selection + C1b shell policy union', { concurrency: false }, () => {
  void it(
    'preserves inventory, attribution, cooperative guidance, and real spawn across full → process → delegate reload',
    { timeout: 30_000 },
    async (t) => {
      if (process.platform === 'win32') {
        t.skip('fake POSIX shell argv proof is not a native Windows qualification');
        return;
      }
      const previousEnv = new Map<string, string | undefined>(
        ENV_KEYS.map((key) => [key, process.env[key]]),
      );
      const root = await mkdtemp(join(tmpdir(), 'pi-bg-feature-shell-union-'));
      const cwd = join(root, 'project');
      const agentDir = join(root, 'agent');
      const shells = [
        { path: join(root, 'full shell Ω', 'nu'), argv: join(root, 'full-argv.json') },
        { path: join(root, 'process shell Ω', 'nu'), argv: join(root, 'process-argv.json') },
        { path: join(root, 'delegate shell Ω', 'nu'), argv: join(root, 'delegate-argv.json') },
      ] as const;
      await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
      await Promise.all([
        makeFakeNu(shells[0].path, shells[0].argv, 'full'),
        makeFakeNu(shells[1].path, shells[1].argv, 'process'),
        makeFakeNu(shells[2].path, shells[2].argv, 'delegate'),
      ]);

      const observations: ProviderObservation[] = [];
      const eventBus = createEventBus();
      let session: AgentSession | undefined;
      try {
        Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
        Reflect.deleteProperty(process.env, 'PI_BG_DOCK_SHORTCUT');
        Reflect.deleteProperty(process.env, 'PI_BG_POSIX_SHELL');
        Reflect.deleteProperty(process.env, 'PI_BG_POSIX_SHELL_PATH');
        process.env['SHELL'] = shells[0].path;

        const settingsManager = SettingsManager.inMemory({
          defaultProvider: PROVIDER,
          defaultModel: MODEL_ID,
        });
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          eventBus,
          additionalExtensionPaths: [ambientAttributionPath, backgroundPath],
          extensionFactories: [unionPeerAndProviderExtension(observations)],
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
        const created = await createAgentSession({
          cwd,
          agentDir,
          resourceLoader: loader,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager,
          modelRuntime,
          noTools: 'builtin',
        });
        session = created.session;
        await session.bindExtensions({ onError: (error) => assert.fail(String(error)) });
        const model = new ModelRegistry(modelRuntime).find(PROVIDER, MODEL_ID);
        assert.ok(model, 'union scripted model must be registered');
        await session.setModel(model);

        assert.deepEqual(registeredPackageTools(session), sorted(ALL_PACKAGE_TOOLS));
        assert.deepEqual(registeredCommands(session), sorted(ALL_PACKAGE_COMMANDS));
        assert.equal(attributionClaimCount(eventBus), 1);
        assert.equal(
          typeof modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple,
          'function',
        );
        await exerciseActivation({
          session,
          eventBus,
          observations,
          cwd,
          shell: shells[0].path,
          argvPath: shells[0].argv,
          label: 'full',
          expectedTools: ALL_PACKAGE_TOOLS,
        });

        process.env['PI_BG_FEATURES'] = 'process';
        process.env['PI_BG_DOCK_SHORTCUT'] = 'off';
        process.env['SHELL'] = shells[1].path;
        await session.reload();
        assert.deepEqual(registeredPackageTools(session), sorted(PROCESS_TOOLS));
        assert.deepEqual(registeredCommands(session), sorted(PROCESS_COMMANDS));
        assert.equal(attributionClaimCount(eventBus), 0);
        assert.equal(modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
        assert.ok(modelRuntime.getProvider('anthropic'), 'the built-in Anthropic provider must survive');
        await exerciseActivation({
          session,
          eventBus,
          observations,
          cwd,
          shell: shells[1].path,
          argvPath: shells[1].argv,
          label: 'process',
          expectedTools: PROCESS_TOOLS,
        });

        process.env['PI_BG_FEATURES'] = 'process,delegate';
        process.env['PI_BG_DOCK_SHORTCUT'] = 'ctrl+alt+b';
        process.env['SHELL'] = shells[2].path;
        await session.reload();
        const delegateTools = [...PROCESS_TOOLS, 'bg_delegate', 'bg_result'];
        assert.deepEqual(registeredPackageTools(session), sorted(delegateTools));
        assert.deepEqual(registeredCommands(session), sorted(PROCESS_COMMANDS));
        assert.equal(attributionClaimCount(eventBus), 0);
        assert.equal(modelRuntime.getRegisteredProviderConfig('anthropic'), undefined);
        assert.equal(session.model?.provider, PROVIDER, 'the scripted provider route must survive reload');
        await exerciseActivation({
          session,
          eventBus,
          observations,
          cwd,
          shell: shells[2].path,
          argvPath: shells[2].argv,
          label: 'delegate',
          expectedTools: delegateTools,
        });
        assert.equal(observations.length, 3);
      } finally {
        if (session !== undefined) {
          await session.extensionRunner
            .emit({ type: 'session_shutdown', reason: 'quit' })
            .catch(() => undefined);
          session.dispose();
        }
        for (const key of ENV_KEYS) restoreEnv(key, previousEnv.get(key));
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
