/**
 * Real-Windows integration coverage.
 *
 * These cases assert behaviour that CANNOT be proven on POSIX with injected
 * seams: npm `.cmd` shim avoidance, cmd.exe quoting and metacharacter
 * handling, PATHEXT resolution, process-tree teardown of grandchildren, and
 * single-handle fsync durability on NTFS.
 *
 * This suite deliberately FAILS when executed off Windows rather than
 * skipping, so a green run can never be mistaken for Windows evidence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createEventBus,
  type AgentSession,
  type EventBus,
} from '@earendil-works/pi-coding-agent';
import type { BgTaskSnapshot } from '../../src/core/common.js';
import { BackgroundTaskRegistry } from '../../src/core/registry.js';
import { replaceFileDurable, writeFileDurable } from '../../src/core/durable-fs.js';
import {
  createReloadShellOwnerHubForTests,
  makeReloadShellIdentity,
} from '../../src/core/reload-shell-owner.js';
import { BG_TERMINAL_CHANNEL, BG_TERMINAL_SCHEMA } from '../../src/core/extension-api.js';

const isWindows = process.platform === 'win32';

function requireWindows(): void {
  assert.equal(
    process.platform,
    'win32',
    `the Windows integration suite must run on Windows; saw ${process.platform}. ` +
      'Run it through the windows-latest CI job (npm run test:windows).',
  );
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-bg-win-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const extensionPath = resolve('extensions/background-tasks.ts');

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown, label: string): JsonRecord {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), label);
  return value as JsonRecord;
}

function isTaskSnapshot(value: unknown): value is BgTaskSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const status = Reflect.get(value, 'status');
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'command') === 'string' &&
    (status === 'running' || status === 'completed' || status === 'failed' || status === 'killed') &&
    typeof Reflect.get(value, 'outputPath') === 'string' &&
    typeof Reflect.get(value, 'cwd') === 'string' &&
    typeof Reflect.get(value, 'startTime') === 'number' &&
    typeof Reflect.get(value, 'bytesWritten') === 'number' &&
    typeof Reflect.get(value, 'isAgent') === 'boolean' &&
    typeof Reflect.get(value, 'surviveReload') === 'boolean' &&
    typeof Reflect.get(value, 'notified') === 'boolean' &&
    typeof Reflect.get(value, 'notifyOnCompletion') === 'boolean' &&
    typeof Reflect.get(value, 'triggerOnCompletion') === 'boolean'
  );
}

interface WindowsReloadHarness {
  readonly root: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly loader: DefaultResourceLoader;
  readonly eventBus: EventBus;
  readonly session: AgentSession;
}

async function createWindowsReloadHarness(): Promise<WindowsReloadHarness> {
  requireWindows();
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-win-reload-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const settingsManager = SettingsManager.inMemory();
  const eventBus = createEventBus();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus,
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
  const created = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    modelRuntime,
    noTools: 'builtin',
  });
  await created.session.bindExtensions({ onError: (error) => assert.fail(error.error) });
  return { root, cwd, agentDir, loader, eventBus, session: created.session };
}

async function closeWindowsReloadHarness(harness: WindowsReloadHarness): Promise<void> {
  await harness.session.extensionRunner
    .emit({ type: 'session_shutdown', reason: 'quit' })
    .catch(() => undefined);
  harness.session.dispose();
  await sleep(100);
  await rm(harness.root, { recursive: true, force: true });
}

async function executeTaskTool(
  session: AgentSession,
  name: string,
  args: unknown,
): Promise<{ result: JsonRecord; task: BgTaskSnapshot }> {
  const tool = session.getToolDefinition(name);
  assert.ok(tool, `missing tool ${name}`);
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  const value = await tool.execute(
    `windows-${name}`,
    prepared,
    undefined,
    undefined,
    session.extensionRunner.createContext(),
  );
  const result = jsonRecord(value, `${name} result`);
  const details = jsonRecord(result['details'], `${name} details`);
  const task = details['task'];
  assert.ok(isTaskSnapshot(task), `${name} task snapshot`);
  return { result, task };
}

async function windowsStatus(session: AgentSession, id: string): Promise<BgTaskSnapshot> {
  const tool = session.getToolDefinition('bg_status');
  assert.ok(tool);
  const value = await tool.execute(
    'windows-status',
    { taskId: id },
    undefined,
    undefined,
    session.extensionRunner.createContext(),
  );
  const result = jsonRecord(value, 'status result');
  const details = jsonRecord(result['details'], 'status details');
  const tasks = details['tasks'];
  assert.ok(Array.isArray(tasks));
  const task = tasks[0];
  assert.ok(isTaskSnapshot(task));
  return task;
}

async function waitForWindowsTask(
  session: AgentSession,
  id: string,
  timeoutMs = 12_000,
): Promise<BgTaskSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let task = await windowsStatus(session, id);
  while (task.status === 'running' && Date.now() < deadline) {
    await sleep(25);
    task = await windowsStatus(session, id);
  }
  assert.notEqual(task.status, 'running', `task ${id} did not finish`);
  return task;
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** True while a PID is still visible to tasklist. */
function processExists(pid: number): boolean {
  const result = spawnSync(
    join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tasklist.exe'),
    ['/FI', `PID eq ${String(pid)}`, '/NH'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) return false;
  return result.stdout.includes(String(pid));
}

void describe('windows integration', { concurrency: false }, () => {
  void it('runs on Windows', () => {
    requireWindows();
  });

  void it('writes terminal metadata durably on NTFS through a single writable handle', async () => {
    requireWindows();
    await withTempDir(async (dir) => {
      // The exact shape that previously failed with
      // "EPERM: operation not permitted, fsync" on Windows.
      const target = join(dir, 'metadata.json');
      await replaceFileDurable(target, `${JSON.stringify({ status: 'completed' }, null, 2)}\n`);
      const parsed: unknown = JSON.parse(await readFile(target, 'utf8'));
      assert.deepEqual(parsed, { status: 'completed' });

      // Repeated replacement must keep working (manifest-style rewrites).
      await replaceFileDurable(target, `${JSON.stringify({ status: 'killed' }, null, 2)}\n`);
      const second: unknown = JSON.parse(await readFile(target, 'utf8'));
      assert.deepEqual(second, { status: 'killed' });

      const output = join(dir, 'task.output');
      await writeFileDurable(output, 'first');
      await writeFileDurable(output, 'second');
      assert.equal(await readFile(output, 'utf8'), 'second');
      assert.ok((await stat(output)).isFile());
    });
  });

  void it('launches the Pi CLI through node without touching the npm .cmd shim', async () => {
    requireWindows();
    const { resolvePiLaunch, piLaunchArgv } = await import('../../src/core/pi-launch.js');
    const launch = resolvePiLaunch();
    // Never execute a batch shim: cmd/bat/ps1 cannot preserve argv safely.
    assert.doesNotMatch(launch.executable.toLowerCase(), /\.(?:cmd|bat|ps1)$/);
    assert.equal(launch.executable, process.execPath);
    const argv = piLaunchArgv(launch, ['--version']);
    const result = spawnSync(launch.executable, argv, {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /\d+\.\d+\.\d+/);
  });

  void it('passes shell metacharacters through structured argv without executing them', async () => {
    requireWindows();
    await withTempDir(async (dir) => {
      const sentinel = join(dir, 'pwned.txt');
      const script = join(dir, 'echo-argv.cjs');
      await writeFile(
        script,
        'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
        'utf8',
      );
      // Should some layer re-parse argv through cmd.exe, `&` would run a command
      // and the sentinel file would appear.
      const hostile = `& echo pwned > "${sentinel}"`;
      const result = spawnSync(process.execPath, [script, hostile, '%PATH%', 'a"b\\c'], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
      });
      assert.equal(result.status, 0, result.stderr);
      const received: unknown = JSON.parse(result.stdout);
      assert.deepEqual(received, [hostile, '%PATH%', 'a"b\\c']);
      await assert.rejects(stat(sentinel), 'no shell operator may execute');
    });
  });

  void it('keeps cmd.exe as the default dialect and honours the documented bash opt-in', async () => {
    requireWindows();
    const { shellInvocation } = await import('../../src/core/common.js');
    const fallback = shellInvocation('echo ok', 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
    assert.equal(fallback.dialect, 'cmd');
    assert.deepEqual(fallback.args.slice(0, 3), ['/d', '/s', '/c']);
    // A generic SHELL value must never silently switch the command language.
    const ignoresShell = shellInvocation('echo ok', 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      SHELL: '/bin/bash',
    });
    assert.equal(ignoresShell.dialect, 'cmd');

    const bashPath = process.env['PI_BG_TEST_BASH'];
    assert.ok(bashPath, 'PI_BG_TEST_BASH must point at Git Bash in Windows CI');
    const opted = shellInvocation('echo ok', 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PI_BG_SHELL: 'bash',
      PI_BG_SHELL_PATH: bashPath,
    });
    assert.equal(opted.dialect, 'posix');
    // -c, never -lc: a login shell would inject profile banners into output.
    assert.deepEqual(opted.args, ['-c', 'echo ok']);
  });

  void it('runs a non-login bash so profile banners cannot pollute captured output', async () => {
    requireWindows();
    const bashPath = process.env['PI_BG_TEST_BASH'];
    assert.ok(bashPath, 'PI_BG_TEST_BASH must point at Git Bash in Windows CI');
    await withTempDir(async (home) => {
      await writeFile(join(home, '.bash_profile'), 'echo PROFILE_BANNER\n', 'utf8');
      const result = spawnSync(bashPath, ['-c', 'echo REAL_OUTPUT'], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        env: { ...process.env, HOME: home },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /REAL_OUTPUT/);
      assert.doesNotMatch(result.stdout, /PROFILE_BANNER/);
    });
  });

  void it('terminates a grandchild process tree with taskkill', async () => {
    requireWindows();
    const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
    await withTempDir(async (dir) => {
      const grandchild = join(dir, 'grandchild.cjs');
      const parent = join(dir, 'parent.cjs');
      const pidFile = join(dir, 'grandchild.pid');
      await writeFile(
        grandchild,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
          'setInterval(() => {}, 1000);\n',
        'utf8',
      );
      await writeFile(
        parent,
        `const { spawn } = require('node:child_process');\n` +
          `spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: 'ignore' });\n` +
          'setInterval(() => {}, 1000);\n',
        'utf8',
      );
      const child = spawn(process.execPath, [parent], { stdio: 'ignore', windowsHide: true });
      const parentPid = child.pid;
      assert.ok(parentPid, 'parent pid should exist');

      let grandchildPid = 0;
      for (let attempt = 0; attempt < 100 && grandchildPid === 0; attempt++) {
        await sleep(50);
        try {
          grandchildPid = Number.parseInt(await readFile(pidFile, 'utf8'), 10);
        } catch {
          grandchildPid = 0;
        }
      }
      assert.ok(grandchildPid > 0, 'grandchild should report its pid');
      assert.ok(processExists(grandchildPid), 'grandchild should be running before the kill');

      const outcome = await runWindowsTaskkill(parentPid, 'force');
      assert.equal(outcome.exitCode, 0, outcome.stderr);

      let grandchildGone = false;
      for (let attempt = 0; attempt < 100 && !grandchildGone; attempt++) {
        await sleep(50);
        grandchildGone = !processExists(grandchildPid);
      }
      // Root-only child.kill() would leave this descendant alive.
      assert.ok(grandchildGone, 'taskkill /T /F must remove the whole process tree');
    });
  });

  void it('tolerates taskkill against an already-exited process', async () => {
    requireWindows();
    const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const pid = child.pid;
    assert.ok(pid);
    await new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve();
      });
    });
    const outcome = await runWindowsTaskkill(pid, 'force');
    // 128 means "process not found" and is a benign race, not a failure.
    assert.ok(
      outcome.exitCode === 0 || outcome.exitCode === 128,
      `unexpected taskkill exit code ${String(outcome.exitCode)}: ${outcome.stderr}`,
    );
  });

  void it('D1 native 1/6 keeps the same cmd process, nonce, path, and output over real reload', async () => {
    requireWindows();
    const h = await createWindowsReloadHarness();
    const terminals: BgTaskSnapshot[] = [];
    const off = h.eventBus.on(BG_TERMINAL_CHANNEL, (value) => {
      const frame = jsonRecord(value, 'terminal frame');
      const task = frame['task'];
      if (frame['schema_version'] === BG_TERMINAL_SCHEMA && isTaskSnapshot(task)) terminals.push(task);
    });
    try {
      const script = 'process.stdout.write("before\\n");setTimeout(()=>process.stdout.write("after\\n"),400);setTimeout(()=>process.exit(0),800)';
      const launched = (
        await executeTaskTool(h.session, 'bg_run', {
          name: 'Windows continuity',
          command: `node -e ${JSON.stringify(script)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        })
      ).task;
      const pid = launched.pid;
      const nonce = launched.reloadSurvival?.launchNonce;
      await waitForCondition(
        async () => (await readFile(join(h.cwd, launched.outputPath), 'utf8')).includes('before'),
        'Windows pre-reload output',
      );
      await h.session.reload();
      const claimed = await windowsStatus(h.session, launched.id);
      assert.equal(claimed.pid, pid);
      assert.equal(claimed.outputPath, launched.outputPath);
      assert.equal(claimed.reloadSurvival?.launchNonce, nonce);
      const terminal = await waitForWindowsTask(h.session, launched.id);
      assert.equal(terminal.status, 'completed');
      assert.match(await readFile(join(h.cwd, launched.outputPath), 'utf8'), /before[\s\S]*after/u);
      assert.equal(terminals.filter((task) => task.id === launched.id).length, 1);
    } finally {
      off();
      await closeWindowsReloadHarness(h);
    }
  });

  void it('D1 native 2/6 removes a retained grandchild tree with bg_kill after reload', async () => {
    requireWindows();
    const h = await createWindowsReloadHarness();
    let grandchildPid = 0;
    try {
      const grandchild = join(h.cwd, 'reload-grandchild.cjs');
      const parent = join(h.cwd, 'reload-parent.cjs');
      const pidFile = join(h.cwd, 'reload-grandchild.pid');
      await writeFile(
        grandchild,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`,
        'utf8',
      );
      await writeFile(
        parent,
        `require('node:child_process').spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000);`,
        'utf8',
      );
      const launched = (
        await executeTaskTool(h.session, 'bg_run', {
          name: 'Windows reload tree',
          command: `node ${JSON.stringify(parent)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        })
      ).task;
      await waitForCondition(async () => {
        grandchildPid = Number(await readFile(pidFile, 'utf8').catch(() => '0'));
        return grandchildPid > 0;
      }, 'Windows reload grandchild pid');
      await h.session.reload();
      const killed = (await executeTaskTool(h.session, 'bg_kill', { taskId: launched.id })).task;
      assert.equal(killed.status, 'killed');
      await waitForCondition(() => !processExists(grandchildPid), 'Windows reload grandchild exit');
    } finally {
      if (grandchildPid > 0 && processExists(grandchildPid)) {
        const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
        await runWindowsTaskkill(grandchildPid, 'force');
      }
      await closeWindowsReloadHarness(h);
    }
  });

  void it('D1 native 3/6 keeps the original timeout and cumulative output cap over reload', async () => {
    requireWindows();
    const h = await createWindowsReloadHarness();
    try {
      const timeoutStart = Date.now();
      const timed = (
        await executeTaskTool(h.session, 'bg_run', {
          name: 'Windows absolute timeout',
          command: `node -e ${JSON.stringify('setInterval(()=>{},1000)')}`,
          isAgent: false,
          surviveReload: true,
          timeoutSeconds: 1,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        })
      ).task;
      await sleep(650);
      await h.session.reload();
      const timedTerminal = await waitForWindowsTask(h.session, timed.id);
      assert.equal(timedTerminal.status, 'failed');
      assert.ok((timedTerminal.endTime ?? Date.now()) - timeoutStart < 1800);

      const capScript = [
        'const cap=Number(process.env.PI_BG_MAX_OUTPUT_BYTES||20*1024*1024)',
        'const chunk=Buffer.alloc(Math.ceil(cap*0.6),97)',
        'process.stdout.write(chunk,()=>setTimeout(()=>process.stdout.write(chunk),500))',
        'setTimeout(()=>{},5000)',
      ].join(';');
      const capped = (
        await executeTaskTool(h.session, 'bg_run', {
          name: 'Windows cumulative cap',
          command: `node -e ${JSON.stringify(capScript)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        })
      ).task;
      const cap = capped.reloadSurvival?.outputCapBytes;
      assert.equal(typeof cap, 'number');
      await waitForCondition(
        async () => (await stat(join(h.cwd, capped.outputPath))).size >= Number(cap) * 0.5,
        'first Windows cap segment',
      );
      await h.session.reload();
      const capTerminal = await waitForWindowsTask(h.session, capped.id, 15_000);
      assert.equal(capTerminal.status, 'failed');
      assert.match(capTerminal.error ?? '', /Output exceeded cap/u);
      assert.equal(capTerminal.reloadSurvival?.outputCapBytes, cap);
    } finally {
      await closeWindowsReloadHarness(h);
    }
  });

  void it('D1 native 4/6 queues a real nonzero close during the reload gap', async () => {
    requireWindows();
    const h = await createWindowsReloadHarness();
    const originalReload = h.loader.reload.bind(h.loader);
    let calls = 0;
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolveEntered) => {
      h.loader.reload = async (...args) => {
        calls += 1;
        if (calls === 1) {
          resolveEntered();
          await new Promise<void>((resolveRelease) => {
            release = resolveRelease;
          });
        }
        return originalReload(...args);
      };
    });
    try {
      const launched = (
        await executeTaskTool(h.session, 'bg_run', {
          name: 'Windows gap close',
          command: `node -e ${JSON.stringify('process.stdout.write("gap\\n");setTimeout(()=>process.exit(9),120)')}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        })
      ).task;
      const reload = h.session.reload();
      await entered;
      await sleep(250);
      release?.();
      await reload;
      const terminal = await waitForWindowsTask(h.session, launched.id);
      assert.equal(terminal.status, 'failed');
      assert.equal(terminal.exitCode, 9);
      assert.match(await readFile(join(h.cwd, launched.outputPath), 'utf8'), /gap/u);
    } finally {
      release?.();
      h.loader.reload = originalReload;
      await closeWindowsReloadHarness(h);
    }
  });

  void it('D1 native 5/6 survives repeated reload without duplicate terminal/taskkill or residual handles', async () => {
    requireWindows();
    const h = await createWindowsReloadHarness();
    const terminals: BgTaskSnapshot[] = [];
    const off = h.eventBus.on(BG_TERMINAL_CHANNEL, (value) => {
      const frame = jsonRecord(value, 'terminal frame');
      const task = frame['task'];
      if (frame['schema_version'] === BG_TERMINAL_SCHEMA && isTaskSnapshot(task)) terminals.push(task);
    });
    let pid = 0;
    try {
      const launched = (
        await executeTaskTool(h.session, 'bg_run', {
          name: 'Windows repeated reload',
          command: `node -e ${JSON.stringify('setInterval(()=>{},1000)')}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        })
      ).task;
      pid = launched.pid ?? 0;
      await h.session.reload();
      await h.session.reload();
      const claimed = await windowsStatus(h.session, launched.id);
      assert.equal(claimed.pid, pid);
      assert.equal(claimed.reloadSurvival?.handoffCount, 2);
      await executeTaskTool(h.session, 'bg_kill', { taskId: launched.id });
      await waitForCondition(() => !processExists(pid), 'repeated reload root exit');
      await waitForCondition(
        () => terminals.filter((task) => task.id === launched.id).length === 1,
        'one Windows repeated-reload terminal',
      );
    } finally {
      off();
      if (pid > 0 && processExists(pid)) {
        const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
        await runWindowsTaskkill(pid, 'force');
      }
      await closeWindowsReloadHarness(h);
    }
  });

  void it('D1 native 6/6 removes a real tree when the short no-claim owner deadline fires', async () => {
    requireWindows();
    await withTempDir(async (cwd) => {
      const hub = createReloadShellOwnerHubForTests({ handoffTimeoutMs: 75 });
      const registry = new BackgroundTaskRegistry({
        reloadShellOwner: hub,
        platform: 'win32',
        env: process.env,
        killGraceMs: 25,
        stopWaitMs: 5000,
        sendCompletionNotification() {},
      });
      const sessionId = `windows-no-claim-${String(Date.now())}`;
      const identity = makeReloadShellIdentity(sessionId, resolve(cwd));
      const claim = hub.beginActivation(identity, 'startup', 'd'.repeat(32));
      const adapter = await registry.stageReloadActivation(claim);
      const lease = hub.commitActivation(claim, adapter);
      let pid = 0;
      try {
        const task = await registry.startTask(
          { cwd, sessionId, modelRegistry: { getAll: () => [] } },
          `node -e ${JSON.stringify('setInterval(()=>{},1000)')}`,
          {
            name: 'Windows no claimant',
            isAgent: false,
            surviveReload: true,
            notifyOnCompletion: false,
            triggerOnCompletion: false,
          },
        );
        pid = task.pid ?? 0;
        const execution = task.reloadExecution;
        assert.ok(execution);
        registry.prepareReloadHandoff(lease);
        await waitForCondition(() => execution.phase === 'released', 'Windows orphan release');
        assert.equal(task.status, 'failed');
        assert.match(task.error ?? '', /pi_bg_reload_handoff_expired/u);
        assert.equal(processExists(pid), false);
      } finally {
        if (pid > 0 && processExists(pid)) {
          const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
          await runWindowsTaskkill(pid, 'force');
        }
        registry.setShuttingDown(true);
      }
    });
  });

  void it('keeps the event loop responsive while taskkill runs', async () => {
    requireWindows();
    const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const pid = child.pid;
    assert.ok(pid);
    let ticks = 0;
    const heartbeat = setInterval(() => {
      ticks += 1;
    }, 5);
    try {
      await runWindowsTaskkill(pid, 'force');
    } finally {
      clearInterval(heartbeat);
    }
    // A synchronous spawnSync helper would starve the loop entirely.
    assert.ok(ticks > 0, 'taskkill must not block the event loop');
  });
});

if (!isWindows) {
  // Make the off-Windows failure obvious even before assertions run.
  console.error(
    `[windows-integration] this suite requires Windows; current platform is ${process.platform}.`,
  );
}
