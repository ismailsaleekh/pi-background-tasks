// Parent test owns a hard subprocess deadline. All model transport/children are
// deterministic fakes; the host SDK and both packed extension roots are real.
import assert from 'node:assert/strict';
import { findPackageJSON } from 'node:module';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installFusionFakePi } from '../helpers/fusion-fake-pi.ts';

const [packedRoot, hostPackage, root] = process.argv.slice(2);
assert.ok(packedRoot && hostPackage && root);
const manifest = JSON.parse(await readFile(join(hostPackage, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@earendil-works/pi-coding-agent');
const sdk = await import(pathToFileURL(join(hostPackage, 'dist/index.js')).href);
// Pi AI exposes ESM-only export conditions; require.resolve would choose the
// wrong conditions. Resolve the host's actual dependency, then its public import.
const aiManifestPath = findPackageJSON(
  '@earendil-works/pi-ai',
  pathToFileURL(join(hostPackage, 'dist/index.js')),
);
assert.ok(aiManifestPath);
const aiManifest = JSON.parse(await readFile(aiManifestPath, 'utf8'));
assert.equal(aiManifest.name, '@earendil-works/pi-ai');
assert.equal(
  aiManifest.version.split('.').slice(0, 2).join('.'),
  manifest.version.split('.').slice(0, 2).join('.'),
);
const aiEntry = aiManifest.exports['.'].import;
assert.equal(typeof aiEntry, 'string');
assert.ok(aiEntry.startsWith('./'));
const ai = await import(pathToFileURL(resolve(dirname(aiManifestPath), aiEntry)).href);
const transcriptHost = typeof ai.getCurrentSystemPrompt === 'function';
if (/^0\.86\./u.test(manifest.version)) assert.equal(transcriptHost, true);

const cwd = join(root, 'project');
const agentDir = join(root, 'agent');
await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
const accountPath = join(root, 'account.json');
await writeFile(
  accountPath,
  JSON.stringify({
    userID: 'd'.repeat(64),
    oauthAccount: { accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
  }),
);
Object.assign(process.env, {
  PI_BG_FEATURES: 'process,delegate,fusion,attribution',
  PI_BG_DOCK_SHORTCUT: 'off',
  PI_CODING_AGENT_DIR: agentDir,
  PI_ANTHROPIC_ACCOUNT_CONFIG_PATH: accountPath,
  PI_BG_TRANSCRIPT_TEST_KEY: 'offline-fixture',
  PI_OFFLINE: '1',
  PI_SKIP_VERSION_CHECK: '1',
  PI_TELEMETRY: '0',
});

const tool = (name, description = name) => ({
  name,
  description,
  parameters: ai.Type.Object({ path: ai.Type.String() }),
});
const initial = {
  role: 'system',
  content: [{ type: 'text', text: 'BASE_PROMPT' }],
  sections: { rules: 'OLD_RULES', removed: 'REMOVED_SECTION' },
  toolsAdded: [tool('old'), tool('read', 'old read')],
  timestamp: 1,
};
const patch = {
  role: 'system',
  content: 'APPENDED_PROMPT',
  sections: { rules: 'CURRENT_RULES', removed: null },
  toolsRemoved: [{ name: 'old' }, { name: 'read' }],
  toolsAdded: [tool('read', 'current read'), tool('inspect')],
  timestamp: 2,
};
const user = { role: 'user', content: 'VISIBLE_USER', timestamp: 3 };
const messages = [initial, user, patch, { ...user, content: 'VISIBLE_FOLLOWUP', timestamp: 4 }];
const expectedPrompt = 'BASE_PROMPT\n\nAPPENDED_PROMPT\n\nCURRENT_RULES';
const expectedTools = [tool('read', 'current read'), tool('inspect')];
const context = transcriptHost
  ? { messages }
  : { systemPrompt: expectedPrompt, tools: expectedTools, messages: [user, messages[3]] };
if (transcriptHost) {
  assert.equal(ai.getCurrentSystemPrompt(messages), expectedPrompt);
  assert.deepEqual(ai.getCurrentTools(messages), expectedTools);
}

let responseNumber = 0;
let failConnections = 0;
const requests = [];
const wireRequests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init) => {
  assert.equal(String(_input), 'https://api.anthropic.com/v1/messages?beta=true');
  const payload = JSON.parse(String(init?.body));
  requests.push(payload);
  wireRequests.push({ body: String(init.body), headers: [...new Headers(init.headers)] });
  if (failConnections > 0) {
    failConnections -= 1;
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('fixture socket closed'), { code: 'UND_ERR_SOCKET' }),
    });
  }
  responseNumber += 1;
  const events = [
    { type: 'message_start', message: { id: `msg_${responseNumber}`, usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OFFLINE_OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
};
const target = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  id: 'claude-fable-5-1',
  name: 'Fable',
  baseUrl: 'https://api.anthropic.com',
  input: ['text'],
  contextWindow: 200000,
  maxTokens: 128000,
  reasoning: true,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
async function send(transport, input, sessionId) {
  const result = await transport(target, input, {
    apiKey: 'sk-ant-oat-offline',
    sessionId,
    cacheRetention: 'none',
    reasoning: 'low',
  }).result();
  assert.equal(result.stopReason, 'stop', result.errorMessage);
  return result;
}
function checkPayload(payload) {
  const system = JSON.stringify(payload.system);
  for (const text of ['BASE_PROMPT', 'APPENDED_PROMPT', 'CURRENT_RULES'])
    assert.ok(system.includes(text));
  assert.doesNotMatch(system, /OLD_RULES|REMOVED_SECTION/u);
  assert.deepEqual(
    payload.tools.map((t) => [t.name, t.description]),
    [
      ['read', 'current read'],
      ['inspect', 'inspect'],
    ],
  );
  assert.equal(
    payload.messages.some((m) => m.role === 'system'),
    false,
  );
}
const settingsManager = sdk.SettingsManager.inMemory({
  defaultProvider: 'transcript-fixture',
  defaultModel: 'fixture',
});
const loader = new sdk.DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
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
let session;
try {
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
  });
  const registry = new sdk.ModelRegistry(modelRuntime);
  registry.registerProvider('transcript-fixture', {
    api: 'openai-responses',
    baseUrl: 'https://example.invalid',
    apiKey: 'PI_BG_TRANSCRIPT_TEST_KEY',
    models: [
      {
        id: 'fixture',
        name: 'fixture',
        input: ['text'],
        reasoning: true,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 272000,
        maxTokens: 4096,
      },
    ],
  });
  const sessionManager = sdk.SessionManager.inMemory(cwd);
  for (const message of messages) sessionManager.appendMessage(message);
  const created = await sdk.createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    settingsManager,
    modelRuntime,
    sessionManager,
    noTools: 'builtin',
  });
  session = created.session;
  // Observe completion without starting parent inference. Wake-up semantics have
  // their own scripted-provider suite; this fixture owns transcript boundaries.
  const notifications = [];
  session.sendCustomMessage = async (message) => {
    notifications.push(message);
  };
  await session.setModel(registry.find('transcript-fixture', 'fixture'));
  await session.bindExtensions({
    mode: 'json',
    onError: (error) => assert.fail(JSON.stringify(error)),
  });
  const ambient = modelRuntime.getRegisteredProviderConfig('anthropic')?.streamSimple;
  assert.equal(typeof ambient, 'function');
  await send(ambient, context, 'packed-ambient-transcript');
  checkPayload(requests.at(-1));

  const childLoader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: sdk.SettingsManager.inMemory(),
    additionalExtensionPaths: [join(packedRoot, 'dist/extensions/anthropic-attribution-child.js')],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
  });
  await childLoader.reload();
  assert.deepEqual(childLoader.getExtensions().errors, []);
  const childTransport = childLoader
    .getExtensions()
    .runtime.pendingProviderRegistrations.find((r) => r.name === 'anthropic')?.config.streamSimple;
  assert.equal(typeof childTransport, 'function');
  await send(childTransport, context, 'packed-child-transcript');
  checkPayload(requests.at(-1));

  // #33/#34 and #32 through both actual packed gateways: the one-off identity
  // and protected wire bytes survive a connection retry without private SDK peers.
  const oneOffIds = [];
  for (const transport of [ambient, childTransport]) {
    const start = wireRequests.length;
    failConnections = 1;
    const result = await send(transport, context, undefined);
    assert.equal(wireRequests.length, start + 2);
    assert.deepEqual(wireRequests[start], wireRequests[start + 1]);
    const header = new Headers(wireRequests[start].headers).get('X-Claude-Code-Session-Id');
    assert.match(header, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u);
    assert.equal(JSON.parse(requests.at(-1).metadata.user_id).session_id, header);
    oneOffIds.push(header);
    assert.equal(
      result.diagnostics.find((d) => d.type === 'anthropic-connection-retry').details
        .retries_scheduled,
      1,
    );
    checkPayload(requests.at(-1));
  }
  assert.notEqual(oneOffIds[0], oneOffIds[1]);

  // Reproduce the extension-owned modelRegistry.streamSimple call, not just the
  // transport function. Legacy hosts expose the same operation on ModelRuntime.
  // Do not let a missing modern facade silently hide a future host regression.
  const registryHasSimple = typeof registry.streamSimple === 'function';
  if (!registryHasSimple) assert.match(manifest.version, /^0\.8[1-6]\./u);
  const sideCaller = registryHasSimple ? registry : modelRuntime;
  assert.equal(typeof sideCaller.streamSimple, 'function');
  await modelRuntime.setRuntimeApiKey('anthropic', 'sk-ant-oat-offline');
  let sidePayloads = 0;
  let sideResponses = 0;
  const startSide = wireRequests.length;
  failConnections = 1;
  const side = await sideCaller
    .streamSimple(target, context, {
      reasoning: 'low',
      cacheRetention: 'none',
      maxRetries: 1,
      onPayload: () => {
        sidePayloads += 1;
      },
      onResponse: () => {
        sideResponses += 1;
      },
    })
    .result();
  assert.equal(side.stopReason, 'stop', side.errorMessage);
  assert.equal(
    side.diagnostics.find((d) => d.type === 'anthropic-connection-retry').details.retries_scheduled,
    1,
  );
  assert.equal(sidePayloads, 1);
  assert.equal(sideResponses, 1);
  assert.equal(wireRequests.length, startSide + 2);
  assert.deepEqual(wireRequests[startSide], wireRequests[startSide + 1]);
  checkPayload(requests.at(-1));

  // The compaction marker must be found after the leading system checkpoint.
  const summary = {
    ...user,
    content:
      'The conversation history before this point was compacted into the following summary: compacted state',
  };
  const compacted = transcriptHost
    ? { messages: [initial, summary, patch, user] }
    : { ...context, messages: [summary, user] };
  const first = await send(ambient, compacted, 'packed-compaction');
  const lineage = first.diagnostics.find((d) => d.type === 'anthropic-cache-lineage').details;
  assert.match(lineage.compaction_boundary_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(lineage.signature_epoch_inherits_prior, false);
  const next = await send(
    ambient,
    { ...compacted, messages: [...compacted.messages, first, user] },
    'packed-compaction',
  );
  assert.equal(requests.at(-1).diagnostics.previous_message_id, first.responseId);
  assert.equal(
    next.diagnostics.find((d) => d.type === 'anthropic-cache-lineage').details
      .signature_epoch_sha256,
    lineage.signature_epoch_sha256,
  );
  childLoader.getExtensions().runtime.invalidate('fixture finished');

  // Exercise real public launch -> task -> verified result, not semantic failure.
  // Only child inference is faked; the parent's registry/projection/artifacts are real.
  const fake = await installFusionFakePi(join(root, 'fusion'), {
    mergedText: 'FUSION_TRANSCRIPT_OK',
  });
  const fakeRoot = join(root, 'fake-host');
  const driver = join(fakeRoot, 'dist/cli.cjs');
  await mkdir(dirname(driver), { recursive: true });
  await writeFile(
    join(fakeRoot, 'package.json'),
    JSON.stringify({ name: '@earendil-works/pi-coding-agent', bin: { pi: 'dist/cli.cjs' } }),
  );
  await writeFile(
    driver,
    `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
if (!process.env.PI_BG_DELEGATE_SEED_PATH) { require(${JSON.stringify(fake.packageCliPath)}); }
else {
 const raw=fs.readFileSync(process.env.PI_BG_DELEGATE_SEED_PATH); const seed=JSON.parse(raw); fs.readFileSync(0);
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex'); const answer=Buffer.from('DELEGATE_TRANSCRIPT_OK');
 const pkg={schema_version:'pi-background-tasks.delegate-result.v1',task_id:seed.task_id,launch_nonce:seed.launch_nonce,
 seed_sha256:hash(raw),directive_sha256:seed.directive.sha256,route:{provider:seed.route.provider,model:seed.route.model},
 route_attestations:[{provider:seed.route.provider,model:seed.route.model,stop_reason:'stop'}],stop_reason:'stop',turns:1,tool_calls:0,
 usage:{status:'unavailable',reason:'offline child fixture'},answer:{encoding:'utf-8',byte_length:answer.length,sha256:hash(answer),
 blocks:[{kind:'text',byte_length:answer.length,sha256:hash(answer),data_base64:answer.toString('base64')}]},spilled_artifacts:[]};
 const out=path.join(process.env.PI_BG_DELEGATE_ARTIFACT_DIR,'result.json'); fs.writeFileSync(out+'.tmp',JSON.stringify(pkg)+'\\n'); fs.renameSync(out+'.tmp',out);
}
`,
  );
  const bin = join(root, 'bin');
  await mkdir(bin);
  const shim = join(bin, 'pi');
  await writeFile(shim, `#!/usr/bin/env node\nrequire(${JSON.stringify(driver)});\n`);
  await chmod(shim, 0o755);
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
  // Native Windows resolution uses the declared host bin instead of a .cmd shim.
  process.argv[1] = driver;
  const execute = (name, params, callId = `test-${name}`) => {
    const definition = session.getToolDefinition(name);
    assert.ok(definition, name);
    return definition.execute(
      callId,
      params,
      undefined,
      undefined,
      session.extensionRunner.createContext(),
    );
  };
  async function settled(id) {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const status = await execute('bg_status', { taskId: id });
      if (status.details.tasks[0].status !== 'running') {
        assert.equal(status.details.tasks[0].status, 'completed', JSON.stringify(status.details));
        return;
      }
      await new Promise((done) => setTimeout(done, 10));
    }
    assert.fail('fake child did not settle');
  }
  async function exerciseProjection(messageCount, visible) {
    const promptBefore = session.extensionRunner.createContext().getSystemPrompt();
    assert.equal(typeof promptBefore, 'string');
    const active = {
      role: 'assistant',
      api: 'openai-responses',
      provider: 'transcript-fixture',
      model: 'fixture',
      content: [
        {
          type: 'toolCall',
          id: 'active-delegate',
          name: 'bg_delegate',
          arguments: { prompt: 'ACTIVE_SECRET' },
        },
        {
          type: 'toolCall',
          id: 'active-fusion',
          name: 'fusion_reason',
          arguments: { prompt: 'SIBLING_SECRET' },
        },
      ],
      stopReason: 'toolUse',
      timestamp: 5,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    sessionManager.appendMessage(active);
    const delegate = await execute(
      'bg_delegate',
      { name: 'Transcript delegate', prompt: 'Inspect', notifyOnCompletion: false },
      'active-delegate',
    );
    await settled(delegate.details.task.id);
    const seed = JSON.parse(
      await readFile(resolve(cwd, delegate.details.artifact_dir, 'seed.json'), 'utf8'),
    );
    assert.equal(seed.parent_system_prompt, promptBefore);
    assert.equal(seed.conversation_projection.accounting.message_count, messageCount);
    assert.match(JSON.stringify(seed.conversation_projection), visible);
    assert.doesNotMatch(
      JSON.stringify(seed.conversation_projection),
      /BASE_PROMPT|OLD_RULES|CURRENT_RULES|ACTIVE_SECRET|SIBLING_SECRET/u,
    );
    const delegateResult = await execute('bg_result', { taskId: delegate.details.task.id });
    assert.equal(delegateResult.details.state, 'committed');
    assert.match(JSON.stringify(delegateResult.content), /DELEGATE_TRANSCRIPT_OK/u);
    const fusion = await execute(
      'fusion_reason',
      { prompt: 'Reason about the visible history' },
      'active-fusion',
    );
    await settled(fusion.details.task.id);
    const input = JSON.parse(
      await readFile(resolve(cwd, fusion.details.artifact_dir, 'canonical-input.json'), 'utf8'),
    );
    assert.equal(input.system_prompt, promptBefore);
    assert.equal(input.context.system_prompt, promptBefore);
    assert.equal(input.conversation_projection.accounting.message_count, messageCount);
    assert.match(JSON.stringify(input.conversation_projection), visible);
    assert.doesNotMatch(
      JSON.stringify(input.conversation_projection),
      /BASE_PROMPT|OLD_RULES|CURRENT_RULES|ACTIVE_SECRET|SIBLING_SECRET/u,
    );
    const fusionResult = await execute('bg_result', { taskId: fusion.details.task.id });
    assert.equal(fusionResult.details.state, 'committed');
    assert.match(JSON.stringify(fusionResult.content), /FUSION_TRANSCRIPT_OK/u);
  }
  await exerciseProjection(2, /VISIBLE_USER/u);
  const kept = sessionManager
    .getEntries()
    .find((entry) => entry.type === 'message' && entry.message.content === 'VISIBLE_FOLLOWUP');
  assert.ok(kept);
  sessionManager.branch(kept.id);
  sessionManager.appendCompaction('VISIBLE_SUMMARY', kept.id, 20_000);
  sessionManager.appendMessage({ ...user, content: 'AFTER_COMPACTION_USER' });
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  if (transcriptHost) assert.equal(session.agent.state.messages[0].role, 'system');
  await exerciseProjection(3, /VISIBLE_SUMMARY/u);
  sessionManager.appendMessage({
    role: 'future-role',
    content: 'must not disappear',
    timestamp: 6,
  });
  await assert.rejects(
    () => execute('bg_delegate', { name: 'Unknown role', prompt: 'Inspect' }),
    /unsupported conversation block: message role future-role/u,
  );
  await assert.rejects(
    () => execute('fusion_reason', { prompt: 'Reason' }),
    /unsupported conversation block: message role future-role/u,
  );
  assert.equal((await readFile(fake.logPath, 'utf8')).trim().split('\n').length, 10);
  console.log(
    `packed transcript runtime PASS: Pi ${manifest.version}; ${transcriptHost ? 'system replay' : 'legacy context'}; ambient + child Anthropic + ${registryHasSimple ? 'ModelRegistry' : 'legacy ModelRuntime'} one-offs/retries; delegate + fusion verified results before/after real compaction`,
  );
} finally {
  globalThis.fetch = originalFetch;
  if (session) {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    session.dispose();
  }
}
