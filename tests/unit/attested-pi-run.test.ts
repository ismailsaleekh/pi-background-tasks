import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import {
  runGitCommand,
  type AttestedGitChildProcess,
  type AttestedGitSpawn,
  type GitCommandOptions,
} from '../../src/core/attested-pi-run.js';
import type { TaskkillOutcome, WindowsKillPhase } from '../../src/core/windows-taskkill.js';

class FakeGitChild extends EventEmitter implements AttestedGitChildProcess {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly killCalls: NodeJS.Signals[] = [];

  constructor(readonly pid: number | undefined = 8123) {
    super();
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killCalls.push(signal);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

interface SpawnCall {
  readonly command: string;
  readonly args: string[];
  readonly options: SpawnOptions;
  readonly child: FakeGitChild;
}

function fakeSpawn(
  calls: SpawnCall[],
  child: FakeGitChild,
  onSpawn?: (child: FakeGitChild) => void,
): AttestedGitSpawn {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options, child });
    onSpawn?.(child);
    return child;
  };
}

function taskkillOutcome(exitCode: number | null, stderr = ''): TaskkillOutcome {
  return {
    exitCode,
    signal: null,
    stdout: '',
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected promise to reject');
}

void describe('attested Git preflight process ownership', () => {
  void it('rejects a pre-aborted request before spawning Git', async () => {
    const calls: SpawnCall[] = [];
    const controller = new AbortController();
    const reason = new Error('admission closed before Git spawn');
    controller.abort(reason);

    const error = await rejection(
      runGitCommand('/project', ['rev-parse', 'HEAD'], {
        signal: controller.signal,
        deadlineAt: Date.now() + 1000,
        spawn: fakeSpawn(calls, new FakeGitChild()),
      }),
    );

    assert.equal(error, reason);
    assert.equal(calls.length, 0);
  });

  void it('aborts a running POSIX Git tree, force-escalates, reaps, and removes listeners', async () => {
    const calls: SpawnCall[] = [];
    const child = new FakeGitChild(8124);
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = [];
    const controller = new AbortController();
    const reason = new Error('registry admission closed');
    const options: GitCommandOptions = {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
      spawn: fakeSpawn(calls, child),
      platform: 'linux',
      killGraceMs: 5,
      killProcess: (pid, signal) => {
        signals.push({ pid, signal });
        if (signal === 'SIGKILL') queueMicrotask(() => child.close(null, 'SIGKILL'));
        return true;
      },
    };

    const running = runGitCommand('/project', ['status', '--porcelain=v1'], options);
    assert.equal(calls.length, 1);
    controller.abort(reason);
    const error = await rejection(running);

    assert.equal(error, reason);
    assert.deepEqual(signals, [
      { pid: -8124, signal: 'SIGTERM' },
      { pid: -8124, signal: 'SIGKILL' },
    ]);
    assert.equal(calls[0]?.options.detached, true);
    assert.equal(calls[0]?.options.shell, false);
    assert.deepEqual(child.killCalls, []);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.listenerCount('close'), 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(signals.length, 2, 'termination timers must be cleared after settlement');
  });

  void it('enforces an injected short deadline and reports timeout distinctly', async () => {
    const child = new FakeGitChild(8125);
    const signals: NodeJS.Signals[] = [];
    const startedAt = Date.now();
    const error = await rejection(
      runGitCommand('/project', ['rev-parse', 'HEAD'], {
        deadlineAt: Date.now() + 10,
        spawn: fakeSpawn([], child),
        platform: 'linux',
        killGraceMs: 5,
        killProcess: (_pid, signal) => {
          if (typeof signal === 'string') signals.push(signal);
          if (signal === 'SIGKILL') queueMicrotask(() => child.close(null, 'SIGKILL'));
          return true;
        },
      }),
    );

    assert.equal(errorCode(error), 'attested_git_timeout');
    assert.match(error instanceof Error ? error.message : String(error), /timed out/i);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.ok(Date.now() - startedAt < 500, 'short injected deadline must settle promptly');
  });

  void it('preserves normal output and distinguishes non-repository and spawn errors', async () => {
    const normalChild = new FakeGitChild(8126);
    const normal = runGitCommand('/project', ['rev-parse', 'HEAD'], {
      deadlineAt: Date.now() + 1000,
      spawn: fakeSpawn([], normalChild, (spawned) => {
        queueMicrotask(() => {
          spawned.stdout.emit('data', Buffer.from('abc123\n', 'utf8'));
          spawned.close(0);
        });
      }),
    });
    assert.equal(await normal, 'abc123');

    const nonRepoChild = new FakeGitChild(8127);
    const nonRepo = runGitCommand('/not-a-repo', ['rev-parse', '--show-toplevel'], {
      deadlineAt: Date.now() + 1000,
      spawn: fakeSpawn([], nonRepoChild, (spawned) => {
        queueMicrotask(() => {
          spawned.stderr.emit('data', 'fatal: not a git repository\n');
          spawned.close(128);
        });
      }),
    });
    const nonRepoError = await rejection(nonRepo);
    assert.equal(errorCode(nonRepoError), 'attested_git_failed');
    assert.match(nonRepoError instanceof Error ? nonRepoError.message : String(nonRepoError), /not a git repository/);
    assert.notEqual(errorCode(nonRepoError), 'attested_git_timeout');

    const spawnError = new Error('ENOENT: git missing');
    const failedSpawn: AttestedGitSpawn = () => {
      throw spawnError;
    };
    const error = await rejection(
      runGitCommand('/project', ['status'], {
        deadlineAt: Date.now() + 1000,
        spawn: failedSpawn,
      }),
    );
    assert.equal(errorCode(error), 'attested_git_failed');
    assert.match(error instanceof Error ? error.message : String(error), /git missing/);
  });

  void it('fails loudly on bounded output instead of silently using a truncated authority value', async () => {
    const child = new FakeGitChild(8128);
    const error = await rejection(
      runGitCommand('/project', ['status', '--porcelain=v1'], {
        deadlineAt: Date.now() + 1000,
        maxOutputBytes: 8,
        spawn: fakeSpawn([], child, (spawned) => {
          queueMicrotask(() => spawned.stdout.emit('data', '0123456789abcdef'));
        }),
        platform: 'linux',
        killGraceMs: 5,
        killProcess: (_pid, signal) => {
          if (signal === 'SIGKILL') queueMicrotask(() => child.close(null, 'SIGKILL'));
          return true;
        },
      }),
    );

    assert.equal(errorCode(error), 'attested_git_output_limit');
    assert.match(error instanceof Error ? error.message : String(error), /exceeded.*8 bytes/i);
  });

  void it('uses the shared Windows tree-kill phases under injected mocks', async () => {
    const child = new FakeGitChild(8129);
    const phases: WindowsKillPhase[] = [];
    const controller = new AbortController();
    const running = runGitCommand('/project', ['status'], {
      signal: controller.signal,
      deadlineAt: Date.now() + 1000,
      spawn: fakeSpawn([], child),
      platform: 'win32',
      killGraceMs: 5,
      killTree: async (_pid, phase) => {
        phases.push(phase);
        if (phase === 'terminate') return taskkillOutcome(1, 'soft denied');
        queueMicrotask(() => child.close(null, 'SIGKILL'));
        return taskkillOutcome(0);
      },
    });

    controller.abort(new Error('windows admission closed'));
    await rejection(running);
    assert.deepEqual(phases, ['terminate', 'force']);
    assert.deepEqual(child.killCalls, [], 'Windows must not fall back to root-only child.kill');
  });
});
