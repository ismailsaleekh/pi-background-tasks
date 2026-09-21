#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--root' && value) out.root = resolve(value);
    else if (key === '--scenario' && value) out.scenario = value;
    else if (key === '--sample-root' && value) out.sampleRoot = resolve(value);
    else if (key === '--runtime' && (value === 'source' || value === 'compiled')) out.runtime = value;
    else throw new Error(`unknown or incomplete argument: ${key ?? '(missing)'}`);
  }
  if (!out.root || !out.scenario || !out.sampleRoot) throw new Error('worker requires --root, --scenario, and --sample-root');
  out.runtime ??= 'source';
  return out;
}

const args = parseArgs(process.argv.slice(2));
const project = join(args.sampleRoot, 'project');
const agentDir = join(args.sampleRoot, 'agent');
const binDir = join(args.sampleRoot, 'bin');
await Promise.all([
  mkdir(project, { recursive: true }),
  mkdir(agentDir, { recursive: true }),
  mkdir(binDir, { recursive: true }),
]);
Object.assign(process.env, {
  PI_OFFLINE: '1',
  PI_SKIP_VERSION_CHECK: '1',
  PI_TELEMETRY: '0',
  CI: '1',
  PI_CODING_AGENT_DIR: agentDir,
});

const url = (relative) => pathToFileURL(join(args.root, relative)).href;
const elapsed = (start) => Number((performance.now() - start).toFixed(6));

function emit(metrics, facts = {}) {
  console.log(JSON.stringify({ scenario: args.scenario, metrics, facts }));
}

const runtimePath = (sourcePath, compiledPath) =>
  args.runtime === 'compiled' ? compiledPath : sourcePath;

if (args.scenario === 'delegate-facade-import') {
  const start = performance.now();
  const module = await import(url(runtimePath('src/delegate-extension.ts', 'dist/src/delegate-extension.js')));
  emit({ facade_import_ms: elapsed(start) }, {
    exported_registrars: ['registerDelegateExtension', 'registerBackgroundResultExtension'].filter((name) => typeof module[name] === 'function'),
  });
  process.exit(0);
}

if (args.scenario === 'fusion-facade-import') {
  const start = performance.now();
  const module = await import(url(runtimePath('src/fusion-extension.ts', 'dist/src/fusion-extension.js')));
  emit({ facade_import_ms: elapsed(start) }, {
    exported_registrar: typeof module.registerFusionExtension === 'function',
  });
  process.exit(0);
}

const sdkImportStart = performance.now();
const sdk = await import(url('node_modules/@earendil-works/pi-coding-agent/dist/index.js'));
const sdkImportMs = elapsed(sdkImportStart);
const {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} = sdk;

const backgroundPath = join(
  args.root,
  runtimePath('extensions/background-tasks.ts', 'dist/extensions/background-tasks.js'),
);
const attributionPath = join(
  args.root,
  runtimePath('extensions/anthropic-attribution.ts', 'dist/extensions/anthropic-attribution.js'),
);

async function makeLoader(paths) {
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: 'bench-provider',
    defaultModel: 'bench-model',
  });
  const eventBus = createEventBus();
  const loader = new DefaultResourceLoader({
    cwd: project,
    agentDir,
    settingsManager,
    eventBus,
    additionalExtensionPaths: paths,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
  });
  return { loader, settingsManager, eventBus };
}

function inventory(result) {
  return {
    tools: result.extensions.flatMap((extension) => [...extension.tools.keys()]).sort(),
    commands: result.extensions.flatMap((extension) => [...extension.commands.keys()]).sort(),
    renderers: result.extensions.flatMap((extension) => [...extension.messageRenderers.keys()]).sort(),
  };
}

if (
  args.scenario === 'sdk-no-extension-load' ||
  args.scenario === 'sdk-process-only-load' ||
  args.scenario === 'sdk-default-load'
) {
  if (args.scenario === 'sdk-process-only-load') {
    process.env.PI_BG_FEATURES = 'process';
    process.env.PI_BG_DOCK_SHORTCUT = 'off';
  } else {
    Reflect.deleteProperty(process.env, 'PI_BG_FEATURES');
    Reflect.deleteProperty(process.env, 'PI_BG_DOCK_SHORTCUT');
  }
  const paths =
    args.scenario === 'sdk-no-extension-load' ? [] : [attributionPath, backgroundPath];
  const { loader } = await makeLoader(paths);
  const start = performance.now();
  await loader.reload();
  const loadMs = elapsed(start);
  const result = loader.getExtensions();
  if (result.errors.length > 0) throw new Error(`extension load errors: ${JSON.stringify(result.errors)}`);
  emit({ sdk_import_ms: sdkImportMs, package_load_ms: loadMs }, inventory(result));
  process.exit(0);
}

process.env.PI_BG_FEATURES = args.scenario === 'delegate-first' ? 'process,delegate' : 'process,fusion';
process.env.PI_BG_DOCK_SHORTCUT = 'off';
process.env.PI_BG_DISABLE_UPDATE_CHECK = '1';
process.env.PI_BG_FUSION_TEST_KEY = 'bench-key';

const { loader, settingsManager, eventBus } = await makeLoader([backgroundPath]);
const loaderStart = performance.now();
await loader.reload();
const packageLoadMs = elapsed(loaderStart);
const extensionResult = loader.getExtensions();
if (extensionResult.errors.length > 0) throw new Error(`extension load errors: ${JSON.stringify(extensionResult.errors)}`);
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null });
const modelRegistry = new ModelRegistry(modelRuntime);
modelRegistry.registerProvider('bench-provider', {
  name: 'Cold benchmark provider',
  baseUrl: 'https://example.invalid',
  apiKey: 'PI_BG_FUSION_TEST_KEY',
  api: 'openai-responses',
  models: [{
    id: 'bench-model',
    name: 'Cold benchmark model',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 4096,
  }],
});
const created = await createAgentSession({
  cwd: project,
  agentDir,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(project),
  settingsManager,
  modelRuntime,
  noTools: 'builtin',
});
const session = created.session;
const model = modelRegistry.find('bench-provider', 'bench-model');
if (!model) throw new Error('benchmark model did not register');
await session.setModel(model);
session.setThinkingLevel('low');
await session.bindExtensions({ mode: args.scenario === 'model-selector-first' ? 'tui' : 'json' });

function tool(name) {
  const found = session.getToolDefinition(name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

async function execute(name, input) {
  return tool(name).execute(
    `benchmark-${name}`,
    input,
    undefined,
    undefined,
    session.extensionRunner.createContext(),
  );
}

function field(value, key) {
  if (typeof value !== 'object' || value === null) throw new Error(`${key} parent is not an object`);
  return Reflect.get(value, key);
}

async function waitTerminal(taskId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await execute('bg_status', { taskId });
    const details = field(result, 'details');
    const tasks = field(details, 'tasks');
    if (Array.isArray(tasks) && tasks.length === 1) {
      const status = field(tasks[0], 'status');
      if (status !== 'running') return status;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error(`task ${taskId} did not settle`);
}

async function close() {
  try {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  } finally {
    session.dispose();
  }
}

if (args.scenario === 'model-selector-first') {
  const baseUi = session.extensionRunner.getUIContext();
  let customCalls = 0;
  session.extensionRunner.setUIContext({
    ...baseUi,
    custom: async () => {
      customCalls += 1;
      return { type: 'cancelled' };
    },
    notify: () => undefined,
  });
  const command = session.extensionRunner
    .getRegisteredCommands()
    .find((candidate) => candidate.invocationName === 'fusion-models');
  if (!command) throw new Error('missing /fusion-models');
  const context = session.extensionRunner.createCommandContext();
  Object.defineProperty(context, 'mode', { value: 'tui', configurable: true });
  const start = performance.now();
  await command.handler('', context);
  const firstMs = elapsed(start);
  await close();
  emit({ sdk_import_ms: sdkImportMs, package_load_ms: packageLoadMs, model_selector_first_ms: firstMs }, { custom_calls: customCalls });
  process.exit(0);
}

if (args.scenario === 'delegate-first') {
  const fakePi = join(binDir, 'pi');
  const fakeSource = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = process.env.PI_BG_DELEGATE_ARTIFACT_DIR;
const seedPath = process.env.PI_BG_DELEGATE_SEED_PATH;
const expectedSha = process.env.PI_BG_DELEGATE_SEED_SHA256;
const taskId = process.env.PI_BG_DELEGATE_TASK_ID;
const nonce = process.env.PI_BG_DELEGATE_LAUNCH_NONCE;
try { fs.readFileSync(0); } catch {}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const seedRaw = fs.readFileSync(seedPath, 'utf8');
const seed = JSON.parse(seedRaw);
const answer = Buffer.from('BENCH DELEGATE ANSWER', 'utf8');
const pkg = {
 schema_version: 'pi-background-tasks.delegate-result.v1', task_id: taskId, launch_nonce: nonce,
 seed_sha256: expectedSha, directive_sha256: seed.directive.sha256,
 route: { provider: seed.route.provider, model: seed.route.model },
 route_attestations: [{ provider: seed.route.provider, model: seed.route.model, stop_reason: 'stop' }],
 stop_reason: 'stop', turns: 1, tool_calls: 0,
 usage: { status: 'unavailable', reason: 'benchmark fake child' },
 answer: { encoding: 'utf-8', byte_length: answer.length, sha256: sha256(answer), blocks: [{ kind: 'text', byte_length: answer.length, sha256: sha256(answer), data_base64: answer.toString('base64') }] },
 spilled_artifacts: []
};
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') { const out = {}; for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]); return out; } return value; }
const temporary = path.join(dir, 'result.json.tmp');
fs.writeFileSync(temporary, JSON.stringify(canonical(pkg)) + '\\n');
fs.renameSync(temporary, path.join(dir, 'result.json'));
`;
  await writeFile(fakePi, fakeSource, 'utf8');
  await chmod(fakePi, 0o755);
  process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ''}`;
  const start = performance.now();
  const launch = await execute('bg_delegate', { name: 'Cold delegate', prompt: 'Return benchmark evidence.' });
  const firstMs = elapsed(start);
  const taskId = field(field(launch, 'details'), 'task')?.id;
  if (typeof taskId !== 'string') throw new Error('delegate receipt omitted task id');
  const terminalStatus = await waitTerminal(taskId);
  const resultStart = performance.now();
  const result = await execute('bg_result', { taskId, delivery: 'inline' });
  const resultMs = elapsed(resultStart);
  const state = field(field(result, 'details'), 'state');
  await close();
  emit({ sdk_import_ms: sdkImportMs, package_load_ms: packageLoadMs, delegate_first_ms: firstMs, delegate_result_first_ms: resultMs }, { task_status: terminalStatus, result_state: state });
  process.exit(0);
}

if (args.scenario === 'fusion-first') {
  const helper = await import(url('tests/helpers/fusion-fake-pi.ts'));
  const fake = await helper.installFusionFakePi(args.sampleRoot, { mergedText: 'BENCH FUSION ANSWER' });
  process.env.PATH = fake.env.PATH;
  const start = performance.now();
  const launch = await execute('fusion_reason', { prompt: 'Return benchmark evidence.' });
  const firstMs = elapsed(start);
  const taskId = field(field(launch, 'details'), 'task')?.id;
  if (typeof taskId !== 'string') throw new Error('fusion receipt omitted task id');
  const terminalStatus = await waitTerminal(taskId);
  const resultStart = performance.now();
  const result = await execute('bg_result', { taskId, delivery: 'inline' });
  const resultMs = elapsed(resultStart);
  const state = field(field(result, 'details'), 'state');
  const childCalls = (await readFile(fake.logPath, 'utf8')).trim().split('\n').filter(Boolean).length;
  await close();
  emit({ sdk_import_ms: sdkImportMs, package_load_ms: packageLoadMs, fusion_first_ms: firstMs, fusion_result_first_ms: resultMs }, { task_status: terminalStatus, result_state: state, mocked_child_calls: childCalls });
  process.exit(0);
}

throw new Error(`unsupported scenario: ${args.scenario}`);
