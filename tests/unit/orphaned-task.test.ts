import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePsElapsedSeconds, stopOrphanedTask } from '../../src/core/orphaned-task.js';

async function recordIn(cwd: string, record: Record<string, unknown>, run = 'earlier-session'): Promise<string> {
  const dir = join(cwd, '.pi', 'tasks', run);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${String(record['id'])}.json`);
  await writeFile(path, JSON.stringify(record), 'utf8');
  return path;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function withCwd(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-bg-orphan-'));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe('a task left running by an earlier process', () => {
  it('reads the elapsed time ps prints in each of its forms', () => {
    assert.deepEqual(
      ['00:07', '12:03:04', '11-23:59:59', 'ELAPSED', ''].map(parsePsElapsedSeconds),
      [7, 43384, 1036799, undefined, undefined],
    );
  });

  it('is stopped with its whole process group, and its record says so', { skip: process.platform === 'win32' }, async () => {
    await withCwd(async (cwd) => {
      const child = spawn('sh', ['-c', 'sleep 300 & wait'], { detached: true, stdio: 'ignore' });
      child.unref();
      const pid = child.pid ?? 0;
      const path = await recordIn(cwd, { id: 'babc12345', name: 'server', status: 'running', pid, startTime: Date.now(), outputPath: '.pi/tasks/x/babc12345.output' });
      try {
        const stopped = await stopOrphanedTask(cwd, 'babc12345');
        const record: unknown = JSON.parse(await readFile(path, 'utf8'));
        assert.deepEqual(
          { stopped, alive: alive(pid), record },
          {
            stopped: { id: 'babc12345', name: 'server', outputPath: '.pi/tasks/x/babc12345.output', signal: 'SIGTERM', wasRunning: true },
            alive: false,
            record: { id: 'babc12345', name: 'server', status: 'killed', pid, startTime: (record as { startTime: number }).startTime, outputPath: '.pi/tasks/x/babc12345.output', endTime: (record as { endTime: number }).endTime, exitCode: null, signal: 'SIGTERM', error: 'Stopped after the process that started it was gone' },
          },
        );
      } finally {
        if (alive(pid)) process.kill(-pid, 'SIGKILL');
      }
    });
  });

  it('never signals a pid that was born at another time, and closes the record', async () => {
    await withCwd(async (cwd) => {
      const signalled: number[] = [];
      const path = await recordIn(cwd, { id: 'bold', status: 'running', pid: 4242, startTime: 1_000_000 });
      const stopped = await stopOrphanedTask(cwd, 'bold', {
        platform: 'linux',
        kill: (pid) => { signalled.push(pid); return true; },
        processStartMs: async () => 9_000_000,
        now: () => 9_500_000,
      });
      const record = JSON.parse(await readFile(path, 'utf8')) as { status: string; signal: unknown };
      assert.deepEqual({ signalled, id: stopped?.id, wasRunning: stopped?.wasRunning, status: record.status, signal: record.signal }, { signalled: [], id: 'bold', wasRunning: false, status: 'failed', signal: null });
    });
  });

  it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
    await withCwd(async (cwd) => {
      const signals: string[] = [];
      let gone = false;
      let clock = 0;
      await recordIn(cwd, { id: 'bstubborn', status: 'running', pid: 4242, startTime: 0 });
      const stopped = await stopOrphanedTask(cwd, 'bstubborn', {
        platform: 'linux',
        kill: (pid, signal) => { signals.push(`${String(pid)}:${String(signal)}`); if (signal === 'SIGKILL') gone = true; return true; },
        processStartMs: async () => (gone ? undefined : 0),
        now: () => clock,
        sleep: async (ms) => { clock += ms; },
        killGraceMs: 300,
      });
      assert.deepEqual({ signals, signal: stopped?.signal }, { signals: ['-4242:SIGTERM', '-4242:SIGKILL'], signal: 'SIGKILL' });
    });
  });

  it('leaves a task to the process that started it while that process is alive', async () => {
    await withCwd(async (cwd) => {
      const signalled: number[] = [];
      const starts = new Map([[700, 1_000], [4242, 5_000]]);
      const deps = { platform: 'linux' as const, kill: (pid: number) => { signalled.push(pid); starts.delete(-pid); return true; }, processStartMs: async (pid: number) => starts.get(pid), now: () => 9_000 };
      const path = await recordIn(cwd, { id: 'bowned', status: 'running', pid: 4242, startTime: 5_000 }, 'other-session-700');
      await assert.rejects(stopOrphanedTask(cwd, 'bowned', deps), /belongs to a process that is still running \(pid 700\)/u);
      const untouched = JSON.parse(await readFile(path, 'utf8')) as { status: string };
      starts.set(700, 500_000);
      const stopped = await stopOrphanedTask(cwd, 'bowned', deps);
      assert.deepEqual({ untouched: untouched.status, signalled, wasRunning: stopped?.wasRunning }, { untouched: 'running', signalled: [-4242], wasRunning: true });
    });
  });

  it('leaves an unknown id to the caller, and refuses a record that is not running', async () => {
    await withCwd(async (cwd) => {
      await recordIn(cwd, { id: 'bdone', status: 'completed', pid: 4242, startTime: 0 });
      assert.equal(await stopOrphanedTask(cwd, 'bnone'), undefined);
      assert.equal(await stopOrphanedTask(cwd, '../x'), undefined);
      await assert.rejects(stopOrphanedTask(cwd, 'bdone'), /recorded as completed, not running/u);
    });
  });
});
