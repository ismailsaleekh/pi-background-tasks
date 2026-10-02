import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ModelRuntime, SessionManager, SettingsManager, createEventBus,
  createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  type AgentSession, type CreateAgentSessionRuntimeFactory, type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import { BG_DISPLAY_ENTRY, BG_DISPLAY_SCHEMA } from '../../src/core/config.js';
import { BG_TERMINAL_CHANNEL } from '../../src/core/extension-api.js';

const envKeys = ['PI_CODING_AGENT_DIR', 'PI_BG_FEATURES', 'PI_BG_FOOTER_DISPLAY', 'PI_OFFLINE',
  'PI_SKIP_VERSION_CHECK', 'PI_TELEMETRY', 'CI', 'PI_BG_REGISTRY_URL'] as const;
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const roots: string[] = [];
afterEach(async () => {
  await new Promise((done) => setTimeout(done, 150));
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function command(session: AgentSession, name: string, args = ''): Promise<void> {
  const registered = session.extensionRunner.getRegisteredCommands().find((c) => c.invocationName === name);
  assert.ok(registered, `/${name} registered`);
  await registered.handler(args, session.extensionRunner.createCommandContext());
}

async function tool(session: AgentSession, name: string, args: unknown): Promise<Record<string, unknown>> {
  const registered = session.getToolDefinition(name);
  assert.ok(registered);
  return record(await registered.execute(`footer-${name}`, args, undefined, undefined,
    session.extensionRunner.createContext()));
}

function persistMessage(manager: SessionManager): void {
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'local persistence fixture' }],
    api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'stop', timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
}

async function harness(compiled = false, mode?: string, registryUrl?: string) {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-footer-sdk-'));
  roots.push(root);
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  process.env['PI_BG_FEATURES'] = 'process';
  process.env['PI_OFFLINE'] = registryUrl === undefined ? '1' : '0';
  process.env['PI_SKIP_VERSION_CHECK'] = '1';
  process.env['PI_TELEMETRY'] = '0';
  process.env['CI'] = '1';
  if (mode === undefined) delete process.env['PI_BG_FOOTER_DISPLAY'];
  else process.env['PI_BG_FOOTER_DISPLAY'] = mode;
  if (registryUrl !== undefined) process.env['PI_BG_REGISTRY_URL'] = registryUrl;
  const events = createEventBus();
  const statuses = new Map<string, string | undefined>([['peer-extension', 'peer status']]);
  const widgets = new Map<string, unknown>([['peer-extension', ['peer widget']]]);
  const notices: Array<{ message: string; type: string | undefined }> = [];
  const errors: string[] = [];
  let customCalls = 0;
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null });
  const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
    const services = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir,
      settingsManager: SettingsManager.inMemory(), modelRuntime,
      resourceLoaderOptions: { eventBus: events,
        additionalExtensionPaths: [resolve(compiled ? 'dist/extensions/background-tasks.js' : 'extensions/background-tasks.ts')],
        noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true } });
    const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager,
      ...(options.sessionStartEvent === undefined ? {} : { sessionStartEvent: options.sessionStartEvent }),
      noTools: 'builtin' });
    assert.deepEqual(created.extensionsResult.errors, []);
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const runtime = await createAgentSessionRuntime(createRuntime,
    { cwd, agentDir, sessionManager: SessionManager.create(cwd, join(root, 'sessions')) });
  const bind = async (session: AgentSession) => {
    const ui: ExtensionUIContext = { ...session.extensionRunner.getUIContext(),
      notify: (message, type) => { notices.push({ message, type }); },
      setStatus: (key, text) => { statuses.set(key, text); },
      setWidget: (key, content) => { widgets.set(key, content); },
      custom: (async () => { customCalls += 1; return undefined; }) as ExtensionUIContext['custom'] };
    await session.bindExtensions({ uiContext: ui, onError: (error) => { errors.push(`${error.event}: ${error.error}`); } });
  };
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  const footer = () => statuses.get('background-tasks');
  const lastNotice = () => notices.at(-1)?.message ?? '';
  return { runtime, events, statuses, widgets, notices, errors, bind, footer, lastNotice,
    customCalls: () => customCalls, root, cwd };
}

void describe('footer display through real Pi public entrypoints', { concurrency: false }, () => {
  for (const compiled of [false, true]) {
    void it(`preserves unread badges, commands, keyed peer UI and notifications (${compiled ? 'compiled' : 'source'})`, async () => {
      const h = await harness(compiled);
      try {
        const terminal = new Promise<void>((done) => {
          const off = h.events.on(BG_TERMINAL_CHANNEL, () => { off(); done(); });
        });
        await tool(h.runtime.session, 'bg_run', { name: 'Footer done', command: 'echo footer-done',
          isAgent: false, notifyOnCompletion: true, triggerOnCompletion: false });
        await terminal;
        await new Promise((done) => setTimeout(done, 30));
        await command(h.runtime.session, 'jobs');
        const expected = '\x1b[48;2;183;223;255m\x1b[38;2;11;70;110m bg 1 done · Shift↓ · /bg-clear \x1b[0m';
        assert.equal(h.footer(), expected, 'default bytes unchanged');
        const notifications = h.runtime.session.sessionManager.getEntries().filter((e) =>
          e.type === 'custom_message' && e.customType === 'background-task-notification');
        assert.equal(notifications.length, 1);
        for (const mode of ['off', 'running']) {
          await command(h.runtime.session, 'bg-display', mode);
          assert.equal(h.footer(), undefined);
          assert.equal(h.widgets.get('background-tasks'), undefined);
          for (const manager of ['tasks', 'bg-tasks']) await command(h.runtime.session, manager);
          const shortcut = h.runtime.session.extensionRunner.getShortcuts({}).get('shift+down');
          assert.ok(shortcut);
          await shortcut.handler(h.runtime.session.extensionRunner.createContext());
          assert.equal(h.footer(), undefined);
          await command(h.runtime.session, 'bg-display', 'all');
          assert.equal(h.footer(), expected, 'visibility never acknowledges a task');
        }
        assert.equal(h.customCalls(), 6);
        assert.equal(h.statuses.get('peer-extension'), 'peer status');
        assert.deepEqual(h.widgets.get('peer-extension'), ['peer widget']);
        const before = h.runtime.session.sessionManager.getEntries().length;
        await command(h.runtime.session, 'bg-display', 'garbage off');
        assert.match(h.lastNotice(), /Usage:/);
        assert.equal(h.runtime.session.sessionManager.getEntries().length, before);
        await command(h.runtime.session, 'bg-display', 'ALL');
        assert.equal(h.runtime.session.sessionManager.getEntries().length, before, 'same override is idempotent');
        const cmd = h.runtime.session.extensionRunner.getRegisteredCommands().find((c) => c.invocationName === 'bg-display');
        assert.ok(cmd?.getArgumentCompletions);
        assert.deepEqual((await cmd.getArgumentCompletions('r'))?.map((c) => c.value), ['running']);
        assert.equal(await cmd.getArgumentCompletions('off extra'), null);
        await command(h.runtime.session, 'bg-clear');
        assert.equal(h.footer(), undefined);
        assert.deepEqual(h.errors, []);
      } finally { await h.runtime.dispose(); }
    });
  }

  void it('restores current branches, reset, counted reload, durable resume, fork and new sessions', async () => {
    const h = await harness(true, 'running');
    try {
      const session = h.runtime.session;
      const rootLeaf = session.sessionManager.appendMessage({ role: 'user', content: 'root', timestamp: 1 });
      await command(session, 'bg-display', 'off');
      const offLeaf = session.sessionManager.getLeafId();
      assert.ok(offLeaf);
      const inheritedUser = session.sessionManager.appendMessage({ role: 'user', content: 'inherit', timestamp: 2 });
      await command(session, 'bg-display', 'all');
      const allLeaf = session.sessionManager.getLeafId();
      assert.ok(allLeaf);
      await session.navigateTree(offLeaf);
      await command(session, 'bg-display');
      assert.match(h.lastNotice(), /off \(branch override; scope: this session branch; activation default: running\)/);
      await session.navigateTree(rootLeaf);
      await command(session, 'bg-display', 'status');
      assert.match(h.lastNotice(), /running \(activation default; scope: this activation\)/);
      await session.navigateTree(allLeaf);
      process.env['PI_BG_FOOTER_DISPLAY'] = 'off';
      await session.reload();
      await command(session, 'bg-display');
      assert.match(h.lastNotice(), /all \(branch override.*activation default: off/);
      await command(session, 'bg-display', 'default');
      process.env['PI_BG_FOOTER_DISPLAY'] = 'running';
      await session.reload();
      await command(session, 'bg-display');
      assert.match(h.lastNotice(), /running \(activation default/);
      await command(session, 'bg-display', 'off');
      persistMessage(session.sessionManager);
      const saved = session.sessionFile;
      assert.ok(saved);
      assert.ok(existsSync(saved));
      assert.match(await readFile(saved, 'utf8'), /pi-background-tasks.footer-display.v1/);
      await h.runtime.fork(inheritedUser, { position: 'at' });
      await command(h.runtime.session, 'bg-display');
      assert.match(h.lastNotice(), /off \(branch override/);
      await h.runtime.switchSession(saved);
      await command(h.runtime.session, 'bg-display');
      assert.match(h.lastNotice(), /off \(branch override/);
      await h.runtime.fork(rootLeaf, { position: 'at' });
      await command(h.runtime.session, 'bg-display');
      assert.match(h.lastNotice(), /running \(activation default/);
      await h.runtime.newSession();
      await command(h.runtime.session, 'bg-display');
      assert.match(h.lastNotice(), /running \(activation default/);
      assert.deepEqual(h.errors, []);
    } finally { await h.runtime.dispose(); }
  });

  void it('reports append failure and rereads a host branch already changed in memory', async () => {
    const h = await harness();
    try {
      const manager = h.runtime.session.sessionManager;
      const append = manager.appendCustomEntry.bind(manager);
      manager.appendCustomEntry = (type, data) => {
        append(type, data);
        throw new Error('fixture persistence failure');
      };
      await command(h.runtime.session, 'bg-display', 'off');
      assert.match(h.lastNotice(), /save failed: fixture persistence failure/);
      assert.equal(h.footer(), undefined);
      manager.appendCustomEntry = append;
      await command(h.runtime.session, 'bg-display');
      assert.match(h.lastNotice(), /off \(branch override/);
    } finally { await h.runtime.dispose(); }
  });

  void it('invalid branch state never reuses the previous branch or hides corruption with reset', async () => {
    const h = await harness();
    try {
      const root = h.runtime.session.sessionManager.appendMessage({ role: 'user', content: 'root', timestamp: 1 });
      await command(h.runtime.session, 'bg-display', 'running');
      const bad = h.runtime.session.sessionManager.appendCustomEntry(BG_DISPLAY_ENTRY,
        { schema_version: BG_DISPLAY_SCHEMA, mode: 'unknown' });
      await h.runtime.session.navigateTree(root);
      await command(h.runtime.session, 'bg-display');
      assert.match(h.lastNotice(), /all \(activation default/);
      await h.runtime.session.navigateTree(bad);
      assert.match(h.lastNotice(), /pi_bg_footer_entry_invalid/);
      assert.equal(h.footer(), undefined);
      const count = h.runtime.session.sessionManager.getEntries().length;
      await command(h.runtime.session, 'bg-display', 'default');
      assert.match(h.lastNotice(), /pi_bg_footer_entry_invalid/);
      assert.equal(h.runtime.session.sessionManager.getEntries().length, count);
      await h.runtime.session.navigateTree(root);
      await command(h.runtime.session, 'bg-display', 'off');
      assert.match(h.lastNotice(), /set to off/);
    } finally { await h.runtime.dispose(); }
  });

  void it('keeps running counts and update lookup while hiding finished counts or all footer content', async () => {
    let requests = 0;
    const server = createServer((_request, response) => { requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ version: '999.0.0' })); });
    await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const h = await harness(true, 'off', `http://127.0.0.1:${address.port}`);
    try {
      const deadline = Date.now() + 3000;
      while (requests === 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
      await new Promise((done) => setTimeout(done, 30));
      assert.equal(requests, 1);
      assert.equal(h.footer(), undefined);
      await command(h.runtime.session, 'bg-display', 'running');
      assert.match(h.footer() ?? '', /bg ⬆ v999.0.0 \/bg-update/);
      assert.doesNotMatch(h.footer() ?? '', /Shift↓|\/bg-clear/);
      await tool(h.runtime.session, 'bg_run', { name: 'Footer running',
        command: `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`, isAgent: false,
        notifyOnCompletion: false, triggerOnCompletion: false });
      assert.match(h.footer() ?? '', /1 running · Shift↓ · ⬆ v999.0.0/);
      const done = new Promise<void>((resolveDone) => {
        const off = h.events.on(BG_TERMINAL_CHANNEL, () => { off(); resolveDone(); });
      });
      await tool(h.runtime.session, 'bg_run', { name: 'Footer finished', command: 'echo done',
        isAgent: false, notifyOnCompletion: false, triggerOnCompletion: false });
      await done;
      await command(h.runtime.session, 'jobs');
      assert.match(h.footer() ?? '', /1 running · Shift↓ · ⬆ v999.0.0/);
      assert.doesNotMatch(h.footer() ?? '', /done|\/bg-clear/);
      await command(h.runtime.session, 'bg-display', 'all');
      assert.match(h.footer() ?? '', /1 running · 1 done · Shift↓ · \/bg-clear · ⬆ v999.0.0/);
      await command(h.runtime.session, 'bg-display', 'off');
      assert.equal(h.footer(), undefined);
      await command(h.runtime.session, 'bg-update');
      assert.match(h.lastNotice(), /999.0.0 is the latest/);
      await command(h.runtime.session, 'bg-display', 'default');
      assert.equal(h.footer(), undefined);
      assert.equal(requests, 1);
    } finally {
      await h.runtime.dispose();
      await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
    }
  });
});
