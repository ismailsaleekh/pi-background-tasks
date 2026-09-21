import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
import {
  BG_TERMINAL_CHANNEL,
  BG_TERMINAL_SCHEMA,
} from '../../src/core/extension-api.js';
import {
  getProcessReloadShellOwnerV1,
  inspectReloadShellOwnerForTests,
  makeReloadShellIdentity,
} from '../../src/core/reload-shell-owner.js';

const extensionPath = resolve('extensions/background-tasks.ts');
const roots: string[] = [];
const originalMaxOutputBytes = process.env['PI_BG_MAX_OUTPUT_BYTES'];
process.env['PI_BG_MAX_OUTPUT_BYTES'] = '1024';
after(() => {
  if (originalMaxOutputBytes === undefined) delete process.env['PI_BG_MAX_OUTPUT_BYTES'];
  else process.env['PI_BG_MAX_OUTPUT_BYTES'] = originalMaxOutputBytes;
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), label);
  return value as JsonRecord;
}

function isTaskSnapshot(value: unknown): value is BgTaskSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'command') === 'string' &&
    typeof Reflect.get(value, 'status') === 'string' &&
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

function taskSnapshot(value: unknown, label = 'task snapshot'): BgTaskSnapshot {
  assert.ok(isTaskSnapshot(value), label);
  return value;
}

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  details: JsonRecord;
}

function toolResult(value: unknown): ToolResult {
  const result = record(value, 'tool result');
  assert.ok(Array.isArray(result['content']));
  return {
    content: result['content'] as Array<{ type: string; text?: string }>,
    details: record(result['details'], 'tool details'),
  };
}

async function execute(session: AgentSession, name: string, args: unknown): Promise<ToolResult> {
  const tool = session.getToolDefinition(name);
  assert.ok(tool, `missing tool ${name}`);
  const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
  return toolResult(
    await tool.execute(
      `reload-survival-${name}`,
      prepared,
      undefined,
      undefined,
      session.extensionRunner.createContext(),
    ),
  );
}

function taskFrom(result: ToolResult): BgTaskSnapshot {
  return taskSnapshot(result.details['task']);
}

function tasksFrom(result: ToolResult): BgTaskSnapshot[] {
  const tasks = result.details['tasks'];
  assert.ok(Array.isArray(tasks));
  return tasks.map((task) => taskSnapshot(task));
}

async function status(session: AgentSession, id: string): Promise<BgTaskSnapshot> {
  const result = await execute(session, 'bg_status', { taskId: id });
  const task = tasksFrom(result)[0];
  assert.ok(task);
  return task;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitTerminal(session: AgentSession, id: string, timeoutMs = 5000): Promise<BgTaskSnapshot> {
  let latest = await status(session, id);
  const deadline = Date.now() + timeoutMs;
  while (latest.status === 'running' && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    latest = await status(session, id);
  }
  assert.notEqual(latest.status, 'running', `task ${id} should become terminal`);
  return latest;
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === 'ESRCH'
    );
  }
}

interface Harness {
  root: string;
  cwd: string;
  agentDir: string;
  loader: DefaultResourceLoader;
  session: AgentSession;
  eventBus: EventBus;
}

async function harness(
  mode?: 'tui' | 'rpc' | 'json' | 'print',
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-reload-survival-'));
  roots.push(root);
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
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    modelRuntime,
    noTools: 'builtin',
  });
  await session.bindExtensions({
    onError: () => undefined,
    ...(mode === undefined ? {} : { mode }),
  });
  return { root, cwd, agentDir, loader, session, eventBus };
}

async function disposeHarness(h: Harness): Promise<void> {
  await h.session.extensionRunner
    .emit({ type: 'session_shutdown', reason: 'quit' })
    .catch(() => undefined);
  h.session.dispose();
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  await rm(h.root, { recursive: true, force: true });
}

function ownerExecution(h: Harness, taskId: string) {
  const identity = makeReloadShellIdentity(h.session.sessionId, realpathSync(h.cwd));
  const state = inspectReloadShellOwnerForTests(getProcessReloadShellOwnerV1(), identity);
  return state.executions.find((execution) => execution.task.id === taskId);
}

void describe('real Pi reload shell survival', { concurrency: false }, () => {
  void it('keeps one real process/id/nonce/path/policy/output and delivers once across repeated AgentSession.reload()', async () => {
    const previousPolicy = process.env['PI_BG_POSIX_SHELL'];
    process.env['PI_BG_POSIX_SHELL'] = 'sh';
    const h = await harness();
    // Pi permits hosts to add bindings in more than one call; repeated start on
    // the same runner/identity must be idempotent rather than a duplicate owner.
    await h.session.bindExtensions({ onError: () => undefined });
    const terminals: BgTaskSnapshot[] = [];
    const offTerminal = h.eventBus.on(BG_TERMINAL_CHANNEL, (value) => {
      const frame = record(value, 'terminal frame');
      if (frame['schema_version'] === BG_TERMINAL_SCHEMA) {
        terminals.push(taskSnapshot(frame['task'], 'terminal task'));
      }
    });
    try {
      const script = [
        'process.stdout.write("before\\n")',
        'setTimeout(() => process.stdout.write("after\\n"), 350)',
        'setTimeout(() => process.exit(0), 750)',
      ].join(';');
      const launched = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Reload continuity',
          command: `node -e ${JSON.stringify(script)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: true,
          triggerOnCompletion: false,
        }),
      );
      assert.equal(launched.status, 'running');
      assert.equal(launched.surviveReload, true);
      assert.equal(launched.shellPolicy?.policy, 'sh');
      const nonce = launched.reloadSurvival?.launchNonce;
      const completionId = launched.reloadSurvival?.completionId;
      const pid = launched.pid;
      assert.equal(typeof pid, 'number');
      const beforeExecution = ownerExecution(h, launched.id);
      assert.ok(beforeExecution?.child);
      const beforeChild = beforeExecution.child;
      await waitFor(async () => {
        const logs = await execute(h.session, 'bg_logs', { taskId: launched.id, maxBytes: 4096 });
        return String(logs.content[0]?.text ?? '').includes('before');
      }, 'pre-reload output');

      process.env['PI_BG_POSIX_SHELL'] = 'bash';
      process.env['PI_BG_MAX_OUTPUT_BYTES'] = '2048';
      await h.session.reload();
      const afterFirst = await status(h.session, launched.id);
      assert.equal(afterFirst.status, 'running');
      assert.equal(afterFirst.id, launched.id);
      assert.equal(afterFirst.pid, pid);
      assert.equal(afterFirst.outputPath, launched.outputPath);
      assert.equal(afterFirst.reloadSurvival?.launchNonce, nonce);
      assert.equal(afterFirst.reloadSurvival?.completionId, completionId);
      assert.equal(afterFirst.shellPolicy?.policy, 'sh');
      assert.equal(afterFirst.reloadSurvival?.outputCapBytes, 1024);
      assert.equal(ownerExecution(h, launched.id), beforeExecution);
      assert.equal(ownerExecution(h, launched.id)?.child, beforeChild);

      await h.session.reload();
      const afterSecond = await status(h.session, launched.id);
      assert.equal(afterSecond.reloadSurvival?.leaseGeneration, 3);
      assert.equal(afterSecond.reloadSurvival?.handoffCount, 2);
      assert.equal(ownerExecution(h, launched.id), beforeExecution);

      const done = await waitTerminal(h.session, launched.id);
      assert.equal(done.status, 'completed');
      assert.equal(done.exitCode, 0);
      assert.equal(done.pid, pid);
      assert.equal(done.reloadSurvival?.launchNonce, nonce);
      const logs = await execute(h.session, 'bg_logs', { taskId: launched.id, maxBytes: 4096 });
      const text = String(logs.content[0]?.text ?? '');
      assert.match(text, /before/u);
      assert.match(text, /after/u);
      assert.equal(terminals.filter((task) => task.id === launched.id).length, 1);
      const notifications = h.session.sessionManager
        .getEntries()
        .filter(
          (entry) =>
            entry.type === 'custom_message' &&
            entry.customType === 'background-task-notification' &&
            record(entry.details, 'notification details')['id'] === launched.id,
        );
      assert.equal(notifications.length, 1);

      const rerun = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Current policy rerun',
          command: 'echo current-policy',
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      assert.notEqual(rerun.id, launched.id);
      assert.notEqual(rerun.reloadSurvival?.launchNonce, nonce);
      assert.equal(rerun.shellPolicy?.policy, 'bash');
      assert.equal(rerun.reloadSurvival?.outputCapBytes, 2048);
      await waitTerminal(h.session, rerun.id);
    } finally {
      process.env['PI_BG_MAX_OUTPUT_BYTES'] = '1024';
      offTerminal();
      if (previousPolicy === undefined) delete process.env['PI_BG_POSIX_SHELL'];
      else process.env['PI_BG_POSIX_SHELL'] = previousPolicy;
      await disposeHarness(h);
    }
  });

  void it('queues an actual nonzero close during a nonzero real reload gap for the fresh activation', async () => {
    const h = await harness();
    const terminals: BgTaskSnapshot[] = [];
    const offTerminal = h.eventBus.on(BG_TERMINAL_CHANNEL, (value) => {
      const frame = record(value, 'terminal frame');
      if (frame['schema_version'] === BG_TERMINAL_SCHEMA) terminals.push(taskSnapshot(frame['task']));
    });
    const originalReload = h.loader.reload.bind(h.loader);
    let reloadCalls = 0;
    let releaseGap: (() => void) | undefined;
    const gapEntered = new Promise<void>((resolveGap) => {
      h.loader.reload = async (...args) => {
        reloadCalls += 1;
        if (reloadCalls === 1) {
          resolveGap();
          await new Promise<void>((resolveRelease) => {
            releaseGap = resolveRelease;
          });
        }
        return originalReload(...args);
      };
    });
    try {
      const script = 'process.stdout.write("gap-before\\n");setTimeout(() => process.exit(7), 120)';
      const launched = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Gap terminal',
          command: `node -e ${JSON.stringify(script)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: true,
          triggerOnCompletion: false,
        }),
      );
      const oldRunner = h.session.extensionRunner;
      const reloadStartedAt = Date.now();
      const reload = h.session.reload();
      await gapEntered;
      await new Promise((resolveWait) => setTimeout(resolveWait, 220));
      const gapElapsed = Date.now() - reloadStartedAt;
      assert.ok(gapElapsed >= 150, `gap must be nonzero, observed ${String(gapElapsed)}ms`);
      const execution = ownerExecution(h, launched.id);
      assert.ok(execution);
      assert.equal(execution.phase, 'terminal');
      assert.equal(execution.closeObservation?.code, 7);
      assert.equal(terminals.filter((task) => task.id === launched.id).length, 0);

      releaseGap?.();
      await reload;
      assert.notEqual(h.session.extensionRunner, oldRunner);
      const terminal = await waitTerminal(h.session, launched.id);
      assert.equal(terminal.status, 'failed');
      assert.equal(terminal.exitCode, 7);
      assert.match(terminal.error ?? '', /Exited with code 7/u);
      await waitFor(
        () => terminals.filter((task) => task.id === launched.id).length === 1,
        'one fresh terminal frame',
      );
      assert.equal(terminals.filter((task) => task.id === launched.id).length, 1);
      const logs = await execute(h.session, 'bg_logs', { taskId: launched.id, maxBytes: 4096 });
      assert.match(String(logs.content[0]?.text ?? ''), /gap-before/u);
    } finally {
      releaseGap?.();
      h.loader.reload = originalReload;
      offTerminal();
      await disposeHarness(h);
    }
  });

  void it('retains POSIX group authority after reload when the leader exits and a descendant ignores TERM', async () => {
    if (process.platform === 'win32') return;
    const h = await harness();
    let descendantPid: number | undefined;
    try {
      const descendantScript = 'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000)';
      const leaderScript = [
        'const {spawn}=require("node:child_process")',
        `const child=spawn(process.execPath,["-e",${JSON.stringify(descendantScript)}],{stdio:["ignore","pipe","ignore"]})`,
        'child.stdout.once("data",()=>process.stdout.write("descendant="+String(child.pid)+"\\n"))',
        'process.on("SIGTERM",()=>process.exit(0))',
        'setInterval(()=>{},1000)',
      ].join(';');
      const launched = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Reload tree owner',
          command: `node -e ${JSON.stringify(leaderScript)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      await waitFor(async () => {
        const logs = await execute(h.session, 'bg_logs', { taskId: launched.id, maxBytes: 4096 });
        const match = /descendant=(\d+)/u.exec(String(logs.content[0]?.text ?? ''));
        if (match?.[1] === undefined) return false;
        descendantPid = Number(match[1]);
        return Number.isSafeInteger(descendantPid) && descendantPid > 0;
      }, 'descendant pid');
      assert.ok(descendantPid !== undefined && pidExists(descendantPid));
      await h.session.reload();
      assert.equal((await status(h.session, launched.id)).status, 'running');

      const killStarted = Date.now();
      const killed = taskFrom(await execute(h.session, 'bg_kill', { taskId: launched.id }));
      const elapsed = Date.now() - killStarted;
      assert.equal(killed.status, 'killed');
      assert.ok(elapsed >= 2500, `tree proof must retain force ownership through grace; observed ${String(elapsed)}ms`);
      assert.equal(pidExists(descendantPid), false);
      await waitFor(() => ownerExecution(h, launched.id) === undefined, 'terminal owner release');
    } finally {
      if (descendantPid !== undefined && pidExists(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // Failure-only rescue; the passing path proves retained group cleanup.
        }
      }
      await disposeHarness(h);
    }
  });

  void it('enforces the original absolute timeout rather than restarting it on reload', async () => {
    const h = await harness();
    try {
      const startedAt = Date.now();
      const launched = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Absolute timeout',
          command: `node -e ${JSON.stringify('setInterval(() => {}, 1000)')}`,
          isAgent: false,
          surviveReload: true,
          timeoutSeconds: 1,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      const deadline = launched.reloadSurvival?.timeoutDeadlineAt;
      assert.equal(typeof deadline, 'number');
      await new Promise((resolveWait) => setTimeout(resolveWait, 650));
      await h.session.reload();
      const terminal = await waitTerminal(h.session, launched.id, 3000);
      const elapsed = (terminal.endTime ?? Date.now()) - startedAt;
      assert.equal(terminal.status, 'failed');
      assert.match(terminal.error ?? '', /Timed out after 1s/u);
      assert.ok(elapsed < 1500, `reload must not reset timeout; observed ${String(elapsed)}ms`);
      assert.equal(terminal.reloadSurvival?.timeoutDeadlineAt, deadline);
    } finally {
      await disposeHarness(h);
    }
  });

  void it('enforces one cumulative launch-time output cap across a real process reload', async () => {
    const h = await harness();
    try {
      const script = [
        'process.stdout.write("a".repeat(700))',
        'setTimeout(()=>process.stdout.write("b".repeat(700)),500)',
        'setTimeout(()=>{},5000)',
      ].join(';');
      const launched = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Cumulative real cap',
          command: `node -e ${JSON.stringify(script)}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      assert.equal(launched.reloadSurvival?.outputCapBytes, 1024);
      await waitFor(async () => {
        const current = await status(h.session, launched.id);
        return current.bytesWritten >= 700;
      }, 'first real cap segment');
      await h.session.reload();
      const terminal = await waitTerminal(h.session, launched.id, 4000);
      assert.equal(terminal.status, 'failed');
      assert.match(terminal.error ?? '', /Output exceeded cap of 1\.0KB/u);
      assert.equal(terminal.reloadSurvival?.outputCapBytes, 1024);
      const output = await readFile(join(h.cwd, terminal.outputPath), 'utf8');
      assert.equal(output.startsWith('a'.repeat(700)), true);
      assert.equal(output.includes('b'.repeat(324)), true);
      assert.equal(output.includes('b'.repeat(325)), false);
    } finally {
      await disposeHarness(h);
    }
  });

  void it('keeps /bg survivors available to fresh /jobs, /logs, and /kill command handlers', async () => {
    const h = await harness();
    try {
      const command = (name: string) => {
        const found = h.session.extensionRunner
          .getRegisteredCommands()
          .find((entry) => entry.invocationName === name);
        assert.ok(found, `missing /${name}`);
        return found;
      };
      await command('bg').handler(
        `--survive-reload --name "Command survivor" node -e ${JSON.stringify(
          'process.stdout.write("command-before\\n");setInterval(() => {}, 1000)',
        )}`,
        h.session.extensionRunner.createCommandContext(),
      );
      const all = tasksFrom(await execute(h.session, 'bg_status', {}));
      const launched = all.find((task) => task.name === 'Command survivor');
      assert.ok(launched);
      assert.equal(launched.surviveReload, true);
      await h.session.reload();
      await command('jobs').handler('', h.session.extensionRunner.createCommandContext());
      await command('logs').handler(launched.id, h.session.extensionRunner.createCommandContext());
      await command('kill').handler(launched.id, h.session.extensionRunner.createCommandContext());
      const terminal = await waitTerminal(h.session, launched.id);
      assert.equal(terminal.status, 'killed');
      assert.equal(terminal.reloadSurvival?.launchNonce, launched.reloadSurvival?.launchNonce);
    } finally {
      await disposeHarness(h);
    }
  });

  void it('preserves default kill-on-reload, rejects unsupported launches, and never adopts copied JSON', async () => {
    const h = await harness();
    let copiedPid: number | undefined;
    let unrelatedPid: number | undefined;
    try {
      const defaultTask = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Default dies',
          command: `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
          isAgent: false,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      copiedPid = defaultTask.pid;
      assert.equal(defaultTask.surviveReload, false);
      await h.session.reload();
      await assert.rejects(() => status(h.session, defaultTask.id), /Unknown background task ID/u);
      if (copiedPid !== undefined) {
        await waitFor(() => !pidExists(copiedPid as number), 'default reload child exit');
      }

      await assert.rejects(
        () =>
          execute(h.session, 'bg_run', {
            name: 'Agent refusal',
            command: 'pi -p nope',
            isAgent: true,
            surviveReload: true,
          }),
        /pi_bg_survive_reload_requires_non_agent/u,
      );
      const attested = h.session.getToolDefinition('bg_run_pi_attested');
      assert.ok(attested?.prepareArguments);
      assert.throws(
        () =>
          attested.prepareArguments?.({
            name: 'Attested refusal',
            provider: 'openai-codex',
            model: 'gpt-test',
            prompt: 'nope',
            reportPath: 'report.md',
            surviveReload: true,
          }),
        /pi_bg_survive_reload_unsupported_task_kind/u,
      );
      const delegate = h.session.getToolDefinition('bg_delegate');
      assert.ok(delegate?.prepareArguments);
      assert.throws(
        () => delegate.prepareArguments?.({ name: 'Delegate refusal', prompt: 'nope', surviveReload: true }),
        /surviveReload/u,
      );
      const fusion = h.session.getToolDefinition('fusion_reason');
      assert.ok(fusion?.prepareArguments);
      assert.throws(
        () => fusion.prepareArguments?.({ objective: 'nope', surviveReload: true }),
        /surviveReload|unknown|unsupported/u,
      );

      const survivor = taskFrom(
        await execute(h.session, 'bg_run', {
          name: 'Result inapplicable',
          command: `node -e ${JSON.stringify('setTimeout(() => {}, 10000)')}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      await assert.rejects(
        () => execute(h.session, 'bg_result', { taskId: survivor.id }),
        /not a delegate or Fusion task|bg_logs/u,
      );
      const copiedMetadata = JSON.parse(
        await readFile(join(h.cwd, survivor.outputPath.replace(/\.output$/u, '.json')), 'utf8'),
      ) as JsonRecord;
      const unrelated = spawn(
        process.execPath,
        ['-e', 'setInterval(()=>{},1000)'],
        { detached: process.platform !== 'win32', stdio: 'ignore' },
      );
      unrelatedPid = unrelated.pid;
      assert.equal(typeof unrelatedPid, 'number');
      copiedMetadata['pid'] = unrelatedPid;
      const copiedAudit = copiedMetadata['reloadSurvival'];
      if (typeof copiedAudit === 'object' && copiedAudit !== null) {
        Reflect.set(copiedAudit, 'childPid', unrelatedPid);
      }
      await execute(h.session, 'bg_kill', { taskId: survivor.id });
      await waitTerminal(h.session, survivor.id);

      // A fresh, unrelated session has no adoption path even when supplied a byte-for-byte metadata copy.
      const other = await harness();
      try {
        const targetDir = join(
          other.cwd,
          '.pi',
          'tasks',
          `${other.session.sessionId}-${String(process.pid)}`,
        );
        await mkdir(targetDir, { recursive: true });
        const copiedPath = join(targetDir, `${String(copiedMetadata['id'])}.json`);
        await import('node:fs/promises').then(({ writeFile }) =>
          writeFile(copiedPath, `${JSON.stringify(copiedMetadata, null, 2)}\n`, 'utf8'),
        );
        const all = await execute(other.session, 'bg_status', {});
        assert.deepEqual(tasksFrom(all), []);
        await assert.rejects(
          () => status(other.session, String(copiedMetadata['id'])),
          /Unknown background task ID/u,
        );
        assert.equal(pidExists(unrelatedPid as number), true, 'copied metadata must not signal a live PID');
      } finally {
        await disposeHarness(other);
      }
    } finally {
      if (copiedPid !== undefined && pidExists(copiedPid)) {
        try {
          process.kill(copiedPid, 'SIGKILL');
        } catch {
          // Failure-only rescue; the passing path above proves reload killed it.
        }
      }
      if (unrelatedPid !== undefined && pidExists(unrelatedPid)) {
        if (process.platform === 'win32') {
          const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
          await runWindowsTaskkill(unrelatedPid, 'force');
        } else {
          try {
            process.kill(-unrelatedPid, 'SIGKILL');
          } catch {
            process.kill(unrelatedPid, 'SIGKILL');
          }
        }
        await waitFor(() => !pidExists(unrelatedPid as number), 'unrelated fixture cleanup');
      }
      await disposeHarness(h);
    }
  });

  void it('claims survivors after counted TUI, RPC, print, and JSON SDK bindings', async () => {
    for (const mode of ['tui', 'rpc', 'print', 'json'] as const) {
      const h = await harness(mode);
      try {
        const launched = taskFrom(
          await execute(h.session, 'bg_run', {
            name: `${mode} binding survivor`,
            command: `node -e ${JSON.stringify('setTimeout(()=>process.exit(0),300)')}`,
            isAgent: false,
            surviveReload: true,
            notifyOnCompletion: false,
            triggerOnCompletion: false,
          }),
        );
        await h.session.reload();
        const terminal = await waitTerminal(h.session, launched.id);
        assert.equal(terminal.status, 'completed', `${mode} counted binding should claim on reload`);
        assert.equal(terminal.reloadSurvival?.launchNonce, launched.reloadSurvival?.launchNonce);
      } finally {
        await disposeHarness(h);
      }
    }
  });

  void it('characterizes empty binding reload and direct AgentSession.dispose as upstream lifecycle blockers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-reload-blockers-'));
    roots.push(root);
    const cwd = join(root, 'project');
    const agentDir = join(root, 'agent');
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    const settingsManager = SettingsManager.inMemory();
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
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null });
    const created = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
      modelRuntime,
      noTools: 'builtin',
    });
    const session = created.session;
    try {
      await assert.rejects(
        () =>
          execute(session, 'bg_run', {
            name: 'Bare SDK refusal',
            command: 'echo no-owner',
            isAgent: false,
            surviveReload: true,
          }),
        /pi_bg_reload_owner_unavailable/u,
      );
      await session.bindExtensions({});
      const launched = taskFrom(
        await execute(session, 'bg_run', {
          name: 'Empty binding survivor',
          command: `node -e ${JSON.stringify('setInterval(() => {}, 1000)')}`,
          isAgent: false,
          surviveReload: true,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      const oldRunner = session.extensionRunner;
      await session.reload();
      assert.notEqual(session.extensionRunner, oldRunner, 'the module/runner is rebuilt');
      await assert.rejects(
        () =>
          execute(session, 'bg_run', {
            name: 'Empty binding refusal',
            command: 'echo no-owner',
            isAgent: false,
            surviveReload: true,
          }),
        /pi_bg_reload_owner_unavailable/u,
      );
      const identity = makeReloadShellIdentity(session.sessionId, realpathSync(cwd));
      const hub = getProcessReloadShellOwnerV1();
      const orphanedByHost = inspectReloadShellOwnerForTests(hub, identity).executions.find(
        (execution) => execution.task.id === launched.id,
      );
      assert.ok(orphanedByHost, 'empty binding reload must leave the execution awaiting a missing start');
      assert.equal(orphanedByHost.phase, 'running');

      // Failure-only test cleanup: manually provide the claim the host omitted,
      // stop the real child, and release the structural owner without waiting 30s.
      const claim = hub.beginActivation(identity, 'reload', 'c'.repeat(32));
      const lease = hub.commitActivation(claim, {
        activationNonce: claim.activationNonce,
        onBound() {},
        onChanged() {},
        onTerminal() {},
      });
      await orphanedByHost.requestStop('shutdown', 'empty-binding characterization cleanup');
      hub.releaseExecution(lease, orphanedByHost);
      hub.releaseActivation(lease);

      // Direct dispose has no awaited session_shutdown in Pi 0.84/0.86. A live
      // default child proves invalidation alone performs no extension cleanup.
      const directDisposeTask = taskFrom(
        await execute(session, 'bg_run', {
          name: 'Direct dispose blocker',
          command: `node -e ${JSON.stringify('setInterval(()=>{},1000)')}`,
          isAgent: false,
          notifyOnCompletion: false,
          triggerOnCompletion: false,
        }),
      );
      const directDisposePid = directDisposeTask.pid;
      assert.equal(typeof directDisposePid, 'number');
      const runner = session.extensionRunner;
      session.dispose();
      assert.throws(() => runner.createContext().cwd, /stale/u);
      assert.equal(pidExists(directDisposePid as number), true, 'direct dispose omits shutdown');
      if (process.platform === 'win32') {
        const { runWindowsTaskkill } = await import('../../src/core/windows-taskkill.js');
        await runWindowsTaskkill(directDisposePid as number, 'force');
      } else {
        try {
          process.kill(-(directDisposePid as number), 'SIGKILL');
        } catch {
          process.kill(directDisposePid as number, 'SIGKILL');
        }
      }
      await waitFor(() => !pidExists(directDisposePid as number), 'direct-dispose blocker cleanup');
      // Let the now-stale registry exhaust its bounded publication path while
      // the fixture directory still exists; this is part of the blocker truth.
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    } finally {
      session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
