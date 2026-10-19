import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'node:test';
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
} from '@earendil-works/pi-coding-agent';
import { installFusionFakePi } from '../helpers/fusion-fake-pi.ts';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, '../..');
const roots: string[] = [];
const HOST_MODULES = ['host-api', 'host-protocol', 'host-results'];
const PROVIDER = 'pi-bg-host-packed';
const MODEL = 'scripted';
const FUSION_TEXT = 'PACKED HOST FUSION VERIFIED ANSWER';
const DELEGATE_PREFIX = 'PACKED HOST DELEGATE ANSWER: ';

type Frame = Record<string, unknown>;

function isRecord(value: unknown): value is Frame {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  assert.ok(isRecord(value), `expected an object carrying ${key}`);
  return value[key];
}

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function parsePackFilename(stdout: string): string {
  const trimmed = stdout.trim();
  const start = trimmed.startsWith('[') ? 0 : stdout.lastIndexOf('\n[') + 1;
  assert.ok(start > 0 || trimmed.startsWith('['), 'npm pack must emit a JSON array');
  const parsed: unknown = JSON.parse(start === 0 ? trimmed : stdout.slice(start).trim());
  assert.ok(Array.isArray(parsed));
  const filename = field(parsed[0], 'filename');
  if (typeof filename !== 'string') throw new Error('npm pack filename must be a string');
  return filename;
}

async function packTarball(root: string, destination: string): Promise<string> {
  const home = join(root, 'home');
  const temporary = join(root, 'tmp');
  const cache = join(root, 'cache');
  const config = join(root, 'config');
  await Promise.all(
    [home, temporary, cache, config, destination].map((path) => mkdir(path, { recursive: true })),
  );
  const userConfig = join(config, 'user.npmrc');
  const globalConfig = join(config, 'global.npmrc');
  await Promise.all([writeFile(userConfig, ''), writeFile(globalConfig, '')]);
  const npmCli = process.env['npm_execpath'];
  const command = npmCli === undefined ? 'npm' : process.execPath;
  const prefix = npmCli === undefined ? [] : [npmCli];
  const result = await execFileAsync(
    command,
    [...prefix, 'pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', destination],
    {
      cwd: root,
      timeout: 120_000,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: home,
        USERPROFILE: home,
        TMPDIR: temporary,
        npm_config_cache: cache,
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
        npm_config_registry: 'http://127.0.0.1.invalid/',
        GIT_ALLOW_PROTOCOL: 'file',
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
        CI: '1',
      },
    },
  );
  return join(destination, parsePackFilename(result.stdout));
}

/** Pack, extract and install only the production dependency closure; Pi peers stay absent. */
async function preparePackedRoot(root: string): Promise<string> {
  const tarball = await packTarball(root, join(root, 'tarballs'));
  const unpacked = join(root, 'unpacked');
  await mkdir(unpacked, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarball, '-C', unpacked], {
    cwd: root,
    timeout: 60_000,
    killSignal: 'SIGKILL',
  });
  const packedRoot = join(unpacked, 'package');
  for (const name of HOST_MODULES) {
    for (const suffix of ['.js', '.js.map']) {
      assert.ok(existsSync(join(packedRoot, 'dist/src/core', `${name}${suffix}`)), `${name}${suffix}`);
    }
    assert.ok(existsSync(join(packedRoot, 'src/core', `${name}.ts`)), `${name}.ts source`);
  }
  const modules = join(packedRoot, 'node_modules');
  await mkdir(join(modules, '@mixmark-io'), { recursive: true });
  await Promise.all([
    cp(join(packageRoot, 'node_modules', 'turndown'), join(modules, 'turndown'), {
      recursive: true,
      dereference: true,
    }),
    cp(
      join(packageRoot, 'node_modules', '@mixmark-io', 'domino'),
      join(modules, '@mixmark-io', 'domino'),
      { recursive: true, dereference: true },
    ),
  ]);
  for (const hostPackage of [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-tui',
    'typebox',
  ]) {
    assert.equal(existsSync(join(modules, ...hostPackage.split('/'))), false, hostPackage);
  }
  return packedRoot;
}

function request(
  events: EventBus,
  channel: 'host' | 'v1',
  operation: string,
  payload: unknown,
): Promise<Frame> {
  const prefix = channel === 'host' ? 'pi-background-tasks:host' : 'pi-background-tasks';
  const schema = channel === 'host' ? 'pi-background-tasks.host' : 'pi-background-tasks.extension';
  const requestId = randomUUID();
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no ${channel} ${operation} response from the packed entrypoint`));
    }, 15_000);
    const off = events.on(`${prefix}:response:v1`, (frame) => {
      if (!isRecord(frame) || frame['request_id'] !== requestId) return;
      clearTimeout(timer);
      off();
      resolvePromise(frame);
    });
    events.emit(`${prefix}:request:v1`, {
      schema_version: `${schema}-request.v1`,
      request_id: requestId,
      operation,
      payload,
    });
  });
}

function result(frame: Frame): Frame {
  assert.equal(frame['ok'], true, JSON.stringify(frame));
  const value = frame['result'];
  assert.ok(isRecord(value));
  return value;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

async function fingerprint(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(directory, { recursive: true })).sort()) {
    const file = join(directory, entry);
    const info = await stat(file);
    if (!info.isFile()) continue;
    const digest = createHash('sha256').update(await readFile(file)).digest('hex');
    out.push(`${entry}:${String(info.mtimeMs)}:${digest}`);
  }
  return out;
}

/**
 * Wait until the producer has finished writing its own artifacts (including any
 * adjudication record such as outcome.json), so a before/after comparison around
 * a host read measures only that read.
 */
async function settledFingerprint(directory: string): Promise<string[]> {
  let previous = await fingerprint(directory);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    const current = await fingerprint(directory);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  throw new Error(`artifact directory ${directory} did not settle`);
}

async function outcomeRecord(directory: string): Promise<string> {
  const file = join(directory, 'outcome.json');
  if (!existsSync(file)) return 'absent';
  const info = await stat(file);
  return `${String(info.mtimeMs)}:${createHash('sha256').update(await readFile(file)).digest('hex')}`;
}

class HostClient {
  private sequence = 0;
  private leaseId = '';
  private activationId = '';

  constructor(private readonly events: EventBus) {}

  async subscribe(clientId: string): Promise<void> {
    const lease = result(await request(this.events, 'host', 'subscribe', { clientId }));
    this.leaseId = String(lease['leaseId']);
    this.activationId = String(lease['activationId']);
  }

  call(operation: string, extra: Record<string, unknown> = {}): Promise<Frame> {
    this.sequence += 1;
    return request(this.events, 'host', operation, {
      leaseId: this.leaseId,
      activationId: this.activationId,
      sequence: this.sequence,
      ...extra,
    });
  }
}

interface PackedSession {
  session: AgentSession;
  events: EventBus;
  changes: Frame[];
  terminals: Map<string, Frame>;
  errors: unknown[];
  close(): Promise<void>;
}

async function openPackedSession(packedRoot: string, cwd: string, agentDir: string): Promise<PackedSession> {
  const events = createEventBus();
  const changes: Frame[] = [];
  const terminals = new Map<string, Frame>();
  const offChanged = events.on('pi-background-tasks:host:changed:v1', (frame) => {
    if (isRecord(frame)) changes.push(frame);
  });
  const offTerminal = events.on('pi-background-tasks:terminal:v1', (frame) => {
    const task = field(frame, 'task');
    if (isRecord(task)) terminals.set(String(task['id']), task);
  });
  const settingsManager = SettingsManager.inMemory({ defaultProvider: PROVIDER, defaultModel: MODEL });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus: events,
    additionalExtensionPaths: [join(packedRoot, 'dist/extensions/background-tasks.js')],
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
  const models = new ModelRegistry(modelRuntime);
  models.registerProvider(PROVIDER, {
    name: 'Packed host no-inference provider',
    baseUrl: 'https://example.invalid',
    apiKey: 'PI_BG_HOST_PACKED_KEY',
    api: 'openai-responses',
    models: [
      {
        id: MODEL,
        name: 'Scripted',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 272000,
        maxTokens: 4096,
      },
    ],
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    settingsManager,
    modelRuntime,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: 'builtin',
  });
  const model = models.find(PROVIDER, MODEL);
  assert.ok(model !== undefined);
  await session.setModel(model);
  const errors: unknown[] = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  let closed = false;
  return {
    session,
    events,
    changes,
    terminals,
    errors,
    async close() {
      if (closed) return;
      closed = true;
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
      offChanged();
      offTerminal();
    },
  };
}

async function launchDelegate(packed: PackedSession, directive: string): Promise<string> {
  const definition = packed.session.getToolDefinition('bg_delegate');
  assert.ok(definition !== undefined, 'packed bg_delegate must be registered');
  const callId = randomUUID();
  const launched = await definition.execute(callId, {
    name: 'Packed delegate',
    prompt: directive,
    route: { provider: PROVIDER, model: MODEL },
    notifyOnCompletion: false,
    triggerOnCompletion: false,
    autoDeliver: 'never',
  }, undefined, undefined, packed.session.extensionRunner.createToolContext(callId, undefined));
  const id = String(field(field(launched.details, 'task'), 'id'));
  await waitFor(() => packed.terminals.has(id), `delegate ${id} terminal`);
  assert.equal(field(packed.terminals.get(id), 'status'), 'completed');
  return id;
}

async function v1Task(packed: PackedSession, taskId: string): Promise<Frame> {
  const tasks = field(result(await request(packed.events, 'v1', 'status', { taskId })), 'tasks');
  assert.ok(Array.isArray(tasks));
  const task: unknown = tasks[0];
  assert.ok(isRecord(task));
  return task;
}

const DELEGATE_CHILD = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = process.env.PI_BG_DELEGATE_ARTIFACT_DIR;
const raw = fs.readFileSync(process.env.PI_BG_DELEGATE_SEED_PATH, 'utf8');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
if (sha(Buffer.from(raw)) !== process.env.PI_BG_DELEGATE_SEED_SHA256) throw new Error('seed hash mismatch');
fs.readFileSync(0);
const seed = JSON.parse(raw);
const bytes = Buffer.from(${JSON.stringify(DELEGATE_PREFIX)} + seed.directive.text);
const route = { provider: seed.route.provider, model: seed.route.model };
const result = {
  schema_version: 'pi-background-tasks.delegate-result.v1',
  task_id: process.env.PI_BG_DELEGATE_TASK_ID,
  launch_nonce: process.env.PI_BG_DELEGATE_LAUNCH_NONCE,
  seed_sha256: process.env.PI_BG_DELEGATE_SEED_SHA256,
  directive_sha256: seed.directive.sha256,
  route,
  route_attestations: [{ ...route, stop_reason: 'stop' }],
  stop_reason: 'stop',
  turns: 1,
  tool_calls: 0,
  usage: { status: 'unavailable', reason: 'deterministic packed child performs no inference' },
  answer: {
    encoding: 'utf-8',
    byte_length: bytes.length,
    sha256: sha(bytes),
    blocks: [{ kind: 'text', byte_length: bytes.length, sha256: sha(bytes), data_base64: bytes.toString('base64') }],
  },
  spilled_artifacts: [],
};
const pending = path.join(dir, 'packed-result.tmp');
fs.writeFileSync(pending, JSON.stringify(result) + '\\n');
fs.renameSync(pending, path.join(dir, 'result.json'));
`;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// Fresh-process witness against the damaged tarball. Plain JavaScript so it needs no
// loader beyond the host SDK URL it is given; only child inference is substituted.
const DAMAGED_READER_WITNESS = `
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
const [sdkUrl, packedRoot, cwd, agentDir] = process.argv.slice(2);
const sdk = await import(sdkUrl);
const events = sdk.createEventBus();
const changes = [];
const terminals = new Map();
events.on('pi-background-tasks:host:changed:v1', (frame) => { changes.push(frame); });
events.on('pi-background-tasks:terminal:v1', (frame) => { terminals.set(frame.task.id, frame.task); });
function request(channel, operation, payload) {
  const prefix = channel === 'host' ? 'pi-background-tasks:host' : 'pi-background-tasks';
  const schema = channel === 'host' ? 'pi-background-tasks.host' : 'pi-background-tasks.extension';
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('no response for ' + operation)); }, 15000);
    const off = events.on(prefix + ':response:v1', (frame) => {
      if (frame?.request_id !== requestId) return;
      clearTimeout(timer); off(); resolve(frame);
    });
    events.emit(prefix + ':request:v1', { schema_version: schema + '-request.v1', request_id: requestId, operation, payload });
  });
}
const settingsManager = sdk.SettingsManager.inMemory({ defaultProvider: '${PROVIDER}', defaultModel: '${MODEL}' });
const loader = new sdk.DefaultResourceLoader({
  cwd, agentDir, settingsManager, eventBus: events,
  additionalExtensionPaths: [join(packedRoot, 'dist/extensions/background-tasks.js')],
  noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, [], 'damaged deferred reader must not break startup');
const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null });
const models = new sdk.ModelRegistry(modelRuntime);
models.registerProvider('${PROVIDER}', {
  name: 'Packed host no-inference provider', baseUrl: 'https://example.invalid', apiKey: 'PI_BG_HOST_PACKED_KEY', api: 'openai-responses',
  models: [{ id: '${MODEL}', name: 'Scripted', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 4096 }],
});
const { session } = await sdk.createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, modelRuntime, sessionManager: sdk.SessionManager.inMemory(cwd), noTools: 'builtin' });
await session.setModel(models.find('${PROVIDER}', '${MODEL}'));
const errors = [];
await session.bindExtensions({ onError: (error) => errors.push(error) });
try {
  const lease = (await request('host', 'subscribe', { clientId: 'damaged-reader' })).result;
  let sequence = 0;
  const host = (operation, extra = {}) => { sequence += 1; return request('host', operation, { leaseId: lease.leaseId, activationId: lease.activationId, sequence, ...extra }); };
  const launched = await session.getToolDefinition('bg_delegate').execute(randomUUID(), {
    name: 'Damaged reader delegate', prompt: 'damaged reader directive', route: { provider: '${PROVIDER}', model: '${MODEL}' },
    notifyOnCompletion: false, triggerOnCompletion: false, autoDeliver: 'never',
  }, undefined, undefined, session.extensionRunner.createContext());
  const taskId = launched.details.task.id;
  const deadline = Date.now() + 20000;
  while (!terminals.has(taskId)) {
    if (Date.now() > deadline) throw new Error('damaged-reader delegate did not finish');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(terminals.get(taskId).status, 'completed');
  const detail = await host('detail', { taskId });
  assert.equal(detail.ok, true, JSON.stringify(detail));
  assert.equal(detail.result.task.kind, 'delegate');
  const failed = await host('result', { taskId });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.code, 'OPERATION_FAILED');
  assert.match(failed.error.message, /lazy_module_load_failed.*host-result-reader/u);
  const again = await host('result', { taskId });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'OPERATION_FAILED', 'the load failure is sticky');
  const list = await host('list');
  assert.equal(list.ok, true);
  assert.equal(list.result.counts.completed, 1);
  assert.deepEqual(errors, []);
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  session.dispose();
}
assert.equal(changes.at(-1)?.kind, 'closed');
console.log('damaged reader witness PASS');
`;

const DOCS_DRIVER = [
  'const [, libUrl, mode, packageRoot] = process.argv;',
  'const lib = await import(libUrl);',
  "if (mode === 'verify') { await lib.verify({ packageRoot }); }",
  "else if (mode === 'generate') { await lib.generate({ packageRoot }); }",
  "else if (mode === 'generate-verify') { await lib.generate({ packageRoot }); await lib.verify({ packageRoot }); }",
  "else { throw new Error('unknown docs driver mode ' + mode); }",
  "console.log('docs driver ' + mode + ' ok');",
].join('\n');

function runDocs(mode: string, packageCopy: string): { status: number | null; output: string } {
  const libUrl = pathToFileURL(join(packageRoot, 'scripts/docs/lib.mjs')).href;
  const outcome = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', DOCS_DRIVER, libUrl, mode, packageCopy],
    { encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(outcome.error, undefined, String(outcome.error));
  assert.equal(outcome.signal, null, `docs driver ${mode} was killed`);
  return { status: outcome.status, output: `${outcome.stdout}\n${outcome.stderr}` };
}

async function snapshotDocs(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(join(root, 'docs'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    files.set(file.slice(root.length), await readFile(file, 'utf8'));
  }
  files.set('/README.md', await readFile(join(root, 'README.md'), 'utf8'));
  return files;
}

void describe('packed host interface closure', { concurrency: false }, () => {
  void it('retrieves verified delegate and Fusion results from a production-only no-peer install, then bounds a missing deferred reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-host-packed-'));
    roots.push(root);
    const packedRoot = await preparePackedRoot(root);
    const compiledExtension = await readFile(join(packedRoot, 'dist/src/extension.js'), 'utf8');
    assert.match(compiledExtension, /import\(['"]\.\/core\/host-results\.js['"]\)/u);
    assert.doesNotMatch(compiledExtension, /from ['"]\.\/core\/host-results\.js['"]/u);
    const compiledHostApi = await readFile(join(packedRoot, 'dist/src/core/host-api.js'), 'utf8');
    assert.doesNotMatch(compiledHostApi, /host-results|delegate\/runner|fusion\/result-package/u);

    const cwd = join(root, 'project');
    const agentDir = join(root, 'agent');
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
    const delegateChild = join(root, 'packed-delegate-child.cjs');
    await writeFile(delegateChild, DELEGATE_CHILD);
    await chmod(delegateChild, 0o700);
    const fake = await installFusionFakePi(join(root, 'fake-pi'), {
      delegatePi: delegateChild,
      mergedText: FUSION_TEXT,
    });
    const previous = {
      features: process.env['PI_BG_FEATURES'],
      shortcut: process.env['PI_BG_DOCK_SHORTCUT'],
      agentDir: process.env['PI_CODING_AGENT_DIR'],
      key: process.env['PI_BG_HOST_PACKED_KEY'],
      path: process.env['PATH'],
    };
    Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
    process.env['PI_BG_DOCK_SHORTCUT'] = 'off';
    process.env['PI_CODING_AGENT_DIR'] = agentDir;
    process.env['PI_BG_HOST_PACKED_KEY'] = 'offline-no-inference';
    process.env['PATH'] = fake.env['PATH'] ?? '';
    let first: PackedSession | undefined;
    try {
      first = await openPackedSession(packedRoot, cwd, agentDir);
      const packed = first;
      assert.equal(packed.changes.filter((frame) => frame['kind'] === 'ready').length, 1);
      assert.equal(result(await request(packed.events, 'host', 'capabilities', {}))['api_version'], 1);
      const client = new HostClient(packed.events);
      await client.subscribe('packed-result-proof');

      const delegateId = await launchDelegate(packed, 'packed directive');
      const delegateTask = await v1Task(packed, delegateId);
      const delegateDir = String(field(field(delegateTask, 'delegate'), 'artifactDirAbs'));
      const delegateBefore = await settledFingerprint(delegateDir);
      const outcomeBefore = await outcomeRecord(delegateDir);
      const transcriptBefore = JSON.stringify(packed.session.sessionManager.getEntries());
      const delegateView = result(await client.call('result', { taskId: delegateId }));
      const delegateText = `${DELEGATE_PREFIX}packed directive`;
      assert.deepEqual(
        {
          state: delegateView['state'],
          delivery: delegateView['delivery'],
          text: delegateView['text'],
          answerBytes: delegateView['answerBytes'],
          answerSha256: delegateView['answerSha256'],
        },
        {
          state: 'committed',
          delivery: 'inline',
          text: delegateText,
          answerBytes: Buffer.byteLength(delegateText),
          answerSha256: sha256(delegateText),
        },
      );
      assert.deepEqual(await fingerprint(delegateDir), delegateBefore, 'delegate read writes nothing');
      assert.equal(
        await outcomeRecord(delegateDir),
        outcomeBefore,
        'the producer adjudication record keeps its presence, bytes and mtime across a UI read',
      );
      assert.equal(
        JSON.stringify(packed.session.sessionManager.getEntries()),
        transcriptBefore,
        'a delegate result read appends no transcript entry',
      );

      const fusionCommand = packed.session.extensionRunner
        .getRegisteredCommands()
        .find((command) => command.invocationName === 'fusion');
      assert.ok(fusionCommand !== undefined, 'packed /fusion must be registered');
      const before = new Set(packed.terminals.keys());
      const tasksBefore = field(result(await request(packed.events, 'v1', 'status', {})), 'tasks');
      assert.ok(Array.isArray(tasksBefore));
      const knownIds = new Set(tasksBefore.map((task: unknown) => String(field(task, 'id'))));
      await fusionCommand.handler(
        'Return the packed deterministic answer',
        packed.session.extensionRunner.createCommandContext(),
      );
      const tasksAfter = field(result(await request(packed.events, 'v1', 'status', {})), 'tasks');
      assert.ok(Array.isArray(tasksAfter));
      const fusionIds = tasksAfter
        .map((task: unknown) => String(field(task, 'id')))
        .filter((id) => !knownIds.has(id));
      assert.equal(fusionIds.length, 1, 'the packed /fusion command registers one real task');
      const fusionId = fusionIds[0] ?? '';
      assert.equal(before.has(fusionId), false);
      await waitFor(() => packed.terminals.has(fusionId), 'Fusion terminal');
      assert.equal(field(packed.terminals.get(fusionId), 'status'), 'completed');
      await waitFor(async () => {
        const task = await v1Task(packed, fusionId);
        return task['notifyOnCompletion'] !== true || task['notified'] === true;
      }, 'Fusion completion notification settlement');
      const fusionTask = await v1Task(packed, fusionId);
      const fusionDir = String(field(field(fusionTask, 'fusion'), 'artifactDirAbs'));
      const fusionBefore = await settledFingerprint(fusionDir);
      const transcriptBeforeFusion = JSON.stringify(packed.session.sessionManager.getEntries());
      const fusionView = result(await client.call('result', { taskId: fusionId }));
      assert.deepEqual(
        {
          state: fusionView['state'],
          delivery: fusionView['delivery'],
          text: fusionView['text'],
          answerBytes: fusionView['answerBytes'],
          answerSha256: fusionView['answerSha256'],
        },
        {
          state: 'committed',
          delivery: 'inline',
          text: FUSION_TEXT,
          answerBytes: Buffer.byteLength(FUSION_TEXT),
          answerSha256: sha256(FUSION_TEXT),
        },
      );
      assert.deepEqual(await fingerprint(fusionDir), fusionBefore, 'Fusion read writes nothing');
      assert.equal(
        field(field(await v1Task(packed, fusionId), 'fusion'), 'usageDelivered'),
        false,
        'host reads never claim the once-only usage accounting',
      );
      assert.equal(
        JSON.stringify(packed.session.sessionManager.getEntries()),
        transcriptBeforeFusion,
        'a Fusion result read appends no transcript entry',
      );
      assert.deepEqual(packed.errors, []);
      await packed.close();
      first = undefined;

      // Only after the positive proof: remove the deferred reader chunk and prove,
      // in a fresh bounded process (no module cache from the positive load), that
      // the packed entrypoint still starts and serves inventory while the first
      // verified read fails with the bounded, sticky module-specific error.
      await rm(join(packedRoot, 'dist/src/core/host-results.js'));
      const witness = join(root, 'damaged-reader-witness.mjs');
      await writeFile(witness, DAMAGED_READER_WITNESS);
      const witnessCwd = join(root, 'damaged-project');
      const witnessAgentDir = join(root, 'damaged-agent');
      const witnessHome = join(root, 'damaged-home');
      await Promise.all(
        [witnessCwd, witnessAgentDir, witnessHome].map((path) => mkdir(path, { recursive: true })),
      );
      const outcome = spawnSync(
        process.execPath,
        [witness, import.meta.resolve('@earendil-works/pi-coding-agent'), packedRoot, witnessCwd, witnessAgentDir],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 120_000,
          killSignal: 'SIGKILL',
          maxBuffer: 8 * 1024 * 1024,
          env: {
            PATH: fake.env['PATH'] ?? '',
            HOME: witnessHome,
            USERPROFILE: witnessHome,
            TMPDIR: tmpdir(),
            PI_CODING_AGENT_DIR: witnessAgentDir,
            PI_BG_DOCK_SHORTCUT: 'off',
            PI_BG_HOST_PACKED_KEY: 'offline-no-inference',
            PI_OFFLINE: '1',
            PI_SKIP_VERSION_CHECK: '1',
            PI_TELEMETRY: '0',
            CI: '1',
          },
        },
      );
      const witnessOutput = `${outcome.stdout}\n${outcome.stderr}`;
      assert.equal(outcome.error, undefined, String(outcome.error));
      assert.equal(outcome.signal, null, `damaged-reader witness was killed\n${witnessOutput}`);
      assert.equal(outcome.status, 0, witnessOutput);
      assert.match(outcome.stdout, /damaged reader witness PASS/u);
    } finally {
      await first?.close();
      if (previous.features === undefined) Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
      else process.env['PI_BG_FEATURES'] = previous.features;
      if (previous.shortcut === undefined) Reflect.deleteProperty(process.env, 'PI_BG_DOCK_SHORTCUT');
      else process.env['PI_BG_DOCK_SHORTCUT'] = previous.shortcut;
      if (previous.agentDir === undefined) Reflect.deleteProperty(process.env, 'PI_CODING_AGENT_DIR');
      else process.env['PI_CODING_AGENT_DIR'] = previous.agentDir;
      if (previous.key === undefined) Reflect.deleteProperty(process.env, 'PI_BG_HOST_PACKED_KEY');
      else process.env['PI_BG_HOST_PACKED_KEY'] = previous.key;
      if (previous.path === undefined) Reflect.deleteProperty(process.env, 'PATH');
      else process.env['PATH'] = previous.path;
    }
  });

  void it('generates a newly authored host doc to a verified fixed point in one invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-host-docs-'));
    roots.push(root);
    const copy = join(root, 'package');
    await mkdir(copy);
    for (const entry of await readdir(packageRoot)) {
      if (['node_modules', 'dist', '.git', '.pi'].includes(entry)) continue;
      await cp(join(packageRoot, entry), join(copy, entry), { recursive: true });
    }
    // Recreate the first-generation state: the authored host doc without its generated region.
    const hostDoc = join(copy, 'docs/api/eventbus-host-v1.md');
    const generated = await readFile(hostDoc, 'utf8');
    const authored = generated.replace(
      /<!-- pi-docs:begin name="eventbus-host-contract"[\s\S]*?<!-- pi-docs:end name="eventbus-host-contract" -->\n\n?/u,
      '',
    );
    assert.notEqual(authored, generated, 'the copied host doc must carry the generated contract region');
    await writeFile(hostDoc, authored);
    const attestationsBefore = await readFile(join(copy, 'docs/attestations.json'), 'utf8');

    const stale = runDocs('verify', copy);
    assert.notEqual(stale.status, 0, 'the authored-only state must be detected as stale');
    assert.match(stale.output, /is stale; run npm run docs:generate/u);

    const firstRun = runDocs('generate-verify', copy);
    assert.equal(firstRun.status, 0, firstRun.output);
    assert.match(await readFile(hostDoc, 'utf8'), /pi-docs:begin name="eventbus-host-contract"/u);
    const afterFirst = await snapshotDocs(copy);

    const secondRun = runDocs('generate', copy);
    assert.equal(secondRun.status, 0, secondRun.output);
    assert.deepEqual(await snapshotDocs(copy), afterFirst, 'a second generation is byte-identical');
    assert.equal(
      await readFile(join(copy, 'docs/attestations.json'), 'utf8'),
      attestationsBefore,
      'generation never records or changes review receipts',
    );
  });
});
