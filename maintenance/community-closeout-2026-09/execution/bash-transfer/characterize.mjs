import { mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const probeRoot = '/private/tmp/pi-bg-closeout-iNoltL/reports/bash-transfer-probes/runtime';
await rm(probeRoot, { recursive: true, force: true });
await mkdir(probeRoot, { recursive: true });

const variants = [
  {
    label: 'package',
    entry: '/Users/lizavasilyeva/work/ai-pipeline/packages/pi-background-tasks/node_modules/@earendil-works/pi-coding-agent/dist/index.js',
  },
  {
    label: 'host-unbundled',
    entry: '/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js',
  },
  {
    label: 'host-bundle',
    entry: '/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js',
  },
];

const schema = { type: 'object', properties: {}, additionalProperties: false };
const makeTool = (owner) => ({
  name: 'bash',
  label: `bash-${owner}`,
  description: `probe bash owned by ${owner}`,
  parameters: schema,
  async execute() {
    return { content: [{ type: 'text', text: owner }], details: { owner } };
  },
});

async function makeSession(mod, root, extensionFactories, { customTools = [], settings } = {}) {
  const cwd = join(root, 'cwd');
  const agentDir = join(root, 'agent');
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const settingsManager = settings ?? mod.SettingsManager.inMemory();
  const loader = new mod.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
  });
  await loader.reload();
  const before = loader.getExtensions();
  const modelRuntime = await mod.ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(agentDir, 'models-store.json'),
  });
  const { session } = await mod.createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: mod.SessionManager.inMemory(cwd),
    settingsManager,
    modelRuntime,
    customTools,
  });
  await session.extensionRunner.emit({ type: 'session_start', reason: 'startup' });
  return { session, loader, diagnosticsBeforeSessionStart: before.errors, settingsManager, cwd, agentDir };
}

async function effectiveOwner(session) {
  const definition = session.getToolDefinition('bash');
  if (!definition) return undefined;
  const result = await definition.execute('probe-call', {}, undefined, undefined, undefined);
  return result?.details?.owner;
}

for (const variant of variants) {
  const mod = await import(pathToFileURL(variant.entry).href);
  const root = join(probeRoot, variant.label);

  const staticSession = await makeSession(
    mod,
    join(root, 'static'),
    [
      { name: 'first', factory: (pi) => pi.registerTool(makeTool('first')) },
      { name: 'second', factory: (pi) => pi.registerTool(makeTool('second')) },
    ],
    { customTools: [makeTool('sdk')] },
  );
  const staticBash = staticSession.session.getAllTools().find((tool) => tool.name === 'bash');
  const staticResult = {
    diagnostics: staticSession.diagnosticsBeforeSessionStart.map((entry) => entry.error),
    effectiveOwner: await effectiveOwner(staticSession.session),
    effectiveSource: staticBash?.sourceInfo,
    exposedKeys: staticBash ? Object.keys(staticBash).sort() : [],
    allBashRows: staticSession.session.getAllTools().filter((tool) => tool.name === 'bash').length,
  };
  staticSession.session.dispose();

  const observations = [];
  const dynamicSession = await makeSession(mod, join(root, 'dynamic'), [
    {
      name: 'package-dynamic',
      factory: (pi) => {
        pi.on('session_start', () => {
          observations.push({
            actor: 'package-before-register',
            source: pi.getAllTools().find((tool) => tool.name === 'bash')?.sourceInfo,
          });
          pi.registerTool(makeTool('package'));
        });
      },
    },
    {
      name: 'late-competitor',
      factory: (pi) => {
        pi.on('session_start', () => {
          pi.registerTool(makeTool('late-competitor'));
          observations.push({
            actor: 'competitor-after-register',
            source: pi.getAllTools().find((tool) => tool.name === 'bash')?.sourceInfo,
          });
        });
      },
    },
  ]);
  const dynamicBash = dynamicSession.session.getAllTools().find((tool) => tool.name === 'bash');
  const dynamicResult = {
    diagnosticsComputedBeforeDynamicRegistration: dynamicSession.diagnosticsBeforeSessionStart.map((entry) => entry.error),
    observations,
    effectiveOwner: await effectiveOwner(dynamicSession.session),
    effectiveSource: dynamicBash?.sourceInfo,
    loaderDiagnosticsAfterDynamicRegistration: dynamicSession.loader.getExtensions().errors.map((entry) => entry.error),
    allBashRows: dynamicSession.session.getAllTools().filter((tool) => tool.name === 'bash').length,
  };
  dynamicSession.session.dispose();

  const injectedSettings = mod.SettingsManager.inMemory({
    shellPath: '/host-only/shell',
    shellCommandPrefix: 'HOST_ONLY_PREFIX',
  });
  const settingsSession = await makeSession(mod, join(root, 'settings'), [], { settings: injectedSettings });
  const independentSettings = mod.SettingsManager.create(settingsSession.cwd, settingsSession.agentDir, {
    projectTrusted: true,
  });
  const settingsResult = {
    hostEffective: {
      shellPath: injectedSettings.getShellPath(),
      shellCommandPrefix: injectedSettings.getShellCommandPrefix(),
    },
    independentlyReopened: {
      shellPath: independentSettings.getShellPath(),
      shellCommandPrefix: independentSettings.getShellCommandPrefix(),
    },
    publicBashMetadataKeys: Object.keys(
      settingsSession.session.getAllTools().find((tool) => tool.name === 'bash') ?? {},
    ).sort(),
  };
  settingsSession.session.dispose();

  console.log(JSON.stringify({
    label: variant.label,
    version: mod.VERSION,
    staticConflictAndSdkPrecedence: staticResult,
    dynamicLateConflict: dynamicResult,
    effectiveSettingsVisibility: settingsResult,
  }));
}
