import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ShellInvocationError,
  parseJsonText,
  resolveShellPolicy,
  shellInvocation,
  shellInvocationForPolicy,
} from '../../src/core/common.js';
import {
  SHELL_POLICY_SECTION,
  applyShellPolicyGuidance,
  renderShellPolicyGuidanceBlock,
  shellPolicyGuidance,
  upsertShellPolicyGuidance,
} from '../../src/core/shell-policy.js';
import {
  BackgroundTaskRegistry,
  type BackgroundTaskChildProcess,
  type BackgroundTaskContext,
  type BackgroundTaskSpawn,
} from '../../src/core/registry.js';

const NON_POSIX_TELEMETRY_REASON =
  'user-non-posix-shell-cannot-safely-intercept-pi-argv';

type JsonObject = Record<PropertyKey, unknown>;

function jsonObject(text: string): JsonObject {
  const parsed = parseJsonText(text);
  assert.ok(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed));
  return parsed as JsonObject;
}

class FakeChild extends EventEmitter implements BackgroundTaskChildProcess {
  readonly pid = 9123;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  kill(): boolean {
    return true;
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

void describe('POSIX automation shell policy', { concurrency: false }, () => {
  void it('preserves inherited SHELL and /bin/sh default bytes', () => {
    const inherited = resolveShellPolicy('linux', { SHELL: '/bin/zsh' });
    assert.deepEqual(inherited, {
      policy: 'inherit',
      executable: '/bin/zsh',
      argvPrefix: ['-c'],
      dialect: 'posix',
      supportsPosixFunctionWrapper: true,
      windowsVerbatimArguments: false,
    });
    assert.equal(Object.isFrozen(inherited), true);
    assert.equal(Object.isFrozen(inherited.argvPrefix), true);
    assert.deepEqual(shellInvocation('printf default', 'linux', { SHELL: '/bin/zsh' }), {
      shell: '/bin/zsh',
      args: ['-c', 'printf default'],
      dialect: 'posix',
      windowsVerbatimArguments: false,
    });
    assert.deepEqual(shellInvocation('printf fallback', 'linux', { SHELL: '' }), {
      shell: '/bin/sh',
      args: ['-c', 'printf fallback'],
      dialect: 'posix',
      windowsVerbatimArguments: false,
    });
    assert.equal(resolveShellPolicy('linux', {}).executable, '/bin/sh');
  });

  void it('honors an explicit executable POSIX Bash override without interpolation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-shell-policy-explicit-'));
    try {
      const bashPath = join(root, 'shell bin Ω', 'bash');
      await mkdir(join(root, 'shell bin Ω'), { recursive: true });
      await writeFile(bashPath, '#!/bin/sh\nexec /bin/bash "$@"\n', 'utf8');
      await chmod(bashPath, 0o755);
      const command = 'printf "%s" "space Ω"';
      const invocation = shellInvocation(command, 'linux', {
        PI_BG_POSIX_SHELL: 'bash',
        PI_BG_POSIX_SHELL_PATH: bashPath,
        SHELL: '/definitely/not/the/selected/shell',
      });
      assert.equal(invocation.shell, bashPath);
      assert.deepEqual(invocation.args, ['-c', command]);
      assert.equal(invocation.dialect, 'posix');
      assert.equal(invocation.windowsVerbatimArguments, false);
      assert.deepEqual(
        resolveShellPolicy('linux', {
          PI_BG_POSIX_SHELL: 'bash',
          PI_BG_POSIX_SHELL_PATH: bashPath,
        }),
        {
          policy: 'bash',
          executable: bashPath,
          argvPrefix: ['-c'],
          dialect: 'bash',
          supportsPosixFunctionWrapper: true,
          windowsVerbatimArguments: false,
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('classifies inherited Nu, fish, csh, and unknown shells truthfully', () => {
    for (const name of ['nu', 'fish', 'csh', 'tcsh', 'custom-shell']) {
      const executable = `/opt/example/${name}`;
      const policy = resolveShellPolicy('linux', { SHELL: executable });
      assert.equal(policy.dialect, 'user-non-posix', name);
      assert.equal(policy.supportsPosixFunctionWrapper, false, name);
      const invocation = shellInvocationForPolicy('print hello', policy);
      assert.equal(invocation.shell, executable);
      assert.deepEqual(invocation.args, ['-c', 'print hello']);
      assert.equal(invocation.dialect, 'user-non-posix');
    }
    assert.equal(resolveShellPolicy('linux', { SHELL: '/usr/bin/bash' }).dialect, 'bash');
    assert.equal(resolveShellPolicy('linux', { SHELL: '/usr/bin/dash' }).dialect, 'posix');
  });

  void it('fails loudly for malformed or invalid explicit POSIX overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-shell-policy-invalid-'));
    try {
      const directory = join(root, 'directory');
      const nonExecutable = join(root, 'not-executable');
      await mkdir(directory);
      await writeFile(nonExecutable, '#!/bin/sh\n', 'utf8');
      await chmod(nonExecutable, 0o644);
      for (const value of ['', ' bash', 'bash ', 'zsh']) {
        assert.throws(
          () => shellInvocation('echo no', 'linux', { PI_BG_POSIX_SHELL: value }),
          (error: unknown) =>
            error instanceof ShellInvocationError && /inherit, bash, or sh/u.test(error.message),
        );
      }
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL: 'bash',
            PI_BG_POSIX_SHELL_PATH: 'relative/bash',
          }),
        /absolute path/u,
      );
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL: 'bash',
            PI_BG_POSIX_SHELL_PATH: '',
          }),
        /is empty/u,
      );
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL: 'sh',
            PI_BG_POSIX_SHELL_PATH: join(root, 'missing'),
          }),
        /stat failed/u,
      );
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL: 'sh',
            PI_BG_POSIX_SHELL_PATH: directory,
          }),
        /regular file/u,
      );
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL: 'sh',
            PI_BG_POSIX_SHELL_PATH: nonExecutable,
          }),
        /must be executable/u,
      );
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL_PATH: '/bin/bash',
          }),
        /requires PI_BG_POSIX_SHELL/u,
      );
      assert.throws(
        () =>
          shellInvocation('echo no', 'linux', {
            PI_BG_POSIX_SHELL: 'inherit',
            PI_BG_POSIX_SHELL_PATH: '/bin/bash',
          }),
        /requires PI_BG_POSIX_SHELL/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('keeps the existing Windows route and ignores POSIX-only knobs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-shell-policy-win-'));
    try {
      const bashPath = join(root, 'bash.exe');
      await writeFile(bashPath, '', 'utf8');
      assert.deepEqual(
        shellInvocation('echo %PATH%', 'win32', {
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
          PI_BG_POSIX_SHELL: 'not-a-posix-policy',
          PI_BG_POSIX_SHELL_PATH: 'relative-is-ignored-on-windows',
        }),
        {
          shell: 'C:\\Windows\\System32\\cmd.exe',
          args: ['/d', '/s', '/c', '"echo %PATH%"'],
          dialect: 'cmd',
          windowsVerbatimArguments: true,
        },
      );
      assert.deepEqual(
        shellInvocation('printf ok', 'win32', {
          PI_BG_SHELL: 'bash',
          PI_BG_SHELL_PATH: bashPath,
          PI_BG_POSIX_SHELL: '',
        }),
        {
          shell: bashPath,
          args: ['-c', 'printf ok'],
          dialect: 'posix',
          windowsVerbatimArguments: false,
        },
      );
      assert.deepEqual(
        resolveShellPolicy('win32', {
          PI_BG_SHELL: 'bash',
          PI_BG_SHELL_PATH: bashPath,
          PI_BG_POSIX_SHELL: 'invalid-is-ignored',
          PI_BG_POSIX_SHELL_PATH: 'relative-is-ignored',
        }),
        {
          policy: 'bash',
          executable: bashPath,
          argvPrefix: ['-c'],
          dialect: 'bash',
          supportsPosixFunctionWrapper: true,
          windowsVerbatimArguments: false,
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('never injects a POSIX function wrapper into inherited Nu', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-shell-policy-nu-'));
    const cwd = join(root, 'project');
    const fakeNu = join(root, 'nu');
    await mkdir(cwd, { recursive: true });
    await writeFile(fakeNu, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(fakeNu, 0o755);
    const child = new FakeChild();
    const spawns: Array<{ shell: string; args: string[] }> = [];
    const spawn: BackgroundTaskSpawn = (shell, args) => {
      spawns.push({ shell, args: [...args] });
      return child;
    };
    const registry = new BackgroundTaskRegistry({
      platform: 'linux',
      env: { ...process.env, SHELL: fakeNu },
      spawn,
      sendCompletionNotification: () => undefined,
    });
    const ctx: BackgroundTaskContext = {
      cwd,
      sessionId: 'shell-policy-red',
      modelRegistry: { getAll: () => [] },
    };
    try {
      const task = await registry.startTask(ctx, 'pi -p hello', {
        name: 'Fake Nu Agent',
        isAgent: true,
        notifyOnCompletion: false,
      });
      assert.equal(spawns.length, 1);
      assert.equal(spawns[0]?.shell, fakeNu);
      assert.deepEqual(spawns[0]?.args, ['-c', 'pi -p hello']);
      assert.equal(task.telemetryWrapped, undefined);
      assert.equal(task.telemetryUnavailableReason, NON_POSIX_TELEMETRY_REASON);
      assert.deepEqual(task.shellPolicy, {
        policy: 'inherit',
        executable: fakeNu,
        argvPrefix: ['-c'],
        dialect: 'user-non-posix',
      });
      const metadata = jsonObject(await readFile(task.metadataAbsPath, 'utf8'));
      assert.equal(metadata['telemetryUnavailableReason'], NON_POSIX_TELEMETRY_REASON);
      assert.deepEqual(metadata['shellPolicy'], task.shellPolicy);
      child.close();
      await waitFor(() => task.status === 'completed', 'fake Nu task completion');
      await new Promise((resolve) => setTimeout(resolve, 25));
      await task.metadataWriteChain;
    } finally {
      registry.setShuttingDown(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('keeps a resolved policy stable when its source environment mutates', () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/opt/example/nu' };
    const policy = resolveShellPolicy('linux', env);
    env['SHELL'] = '/bin/bash';
    env['PI_BG_POSIX_SHELL'] = 'bash';
    assert.deepEqual(shellInvocationForPolicy('echo stable', policy), {
      shell: '/opt/example/nu',
      args: ['-c', 'echo stable'],
      dialect: 'user-non-posix',
      windowsVerbatimArguments: false,
    });
    assert.equal(resolveShellPolicy('linux', env).executable, '/bin/bash');
  });

  void it('resolves explicit Bash and sh through /bin before PATH', () => {
    const pathOnly = join(tmpdir(), 'must-not-win-shell-search');
    const bash = resolveShellPolicy('linux', {
      PI_BG_POSIX_SHELL: 'bash',
      PATH: pathOnly,
    });
    const sh = resolveShellPolicy('linux', {
      PI_BG_POSIX_SHELL: 'sh',
      PATH: pathOnly,
    });
    assert.equal(bash.executable, '/bin/bash');
    assert.equal(bash.dialect, 'bash');
    assert.equal(sh.executable, '/bin/sh');
    assert.equal(sh.dialect, 'posix');
  });

  void it('accepts an absolute executable symlink whose target is a regular file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-bg-shell-policy-symlink-'));
    try {
      const target = join(root, 'target-sh');
      const link = join(root, 'selected sh');
      await writeFile(target, '#!/bin/sh\nexit 0\n', 'utf8');
      await chmod(target, 0o755);
      await symlink(target, link);
      const policy = resolveShellPolicy('linux', {
        PI_BG_POSIX_SHELL: 'sh',
        PI_BG_POSIX_SHELL_PATH: link,
      });
      assert.equal(policy.executable, link);
      assert.equal(policy.dialect, 'posix');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('renders exact guidance and composes old and structured hooks in either order', () => {
    const policy = resolveShellPolicy('linux', { SHELL: '/opt/fake nu/nu' });
    const guidance = shellPolicyGuidance(policy);
    assert.match(guidance, /"executable":"\/opt\/fake nu\/nu"/u);
    assert.match(guidance, /"dialect":"user-non-posix"/u);
    assert.match(guidance, /"args":\["-c","<command>"\]/u);
    assert.match(guidance, /PI_BG_POSIX_SHELL=bash/u);
    assert.doesNotMatch(guidance, /environment|PATH=/u);

    const peer = '<pi_background_feature_guidance>feature survives</pi_background_feature_guidance>';
    const oldFirst = applyShellPolicyGuidance(
      { systemPrompt: `base\n\n${peer}`, systemPromptOptions: { cwd: '/tmp' } },
      policy,
    );
    assert.ok(oldFirst?.systemPrompt);
    assert.match(oldFirst.systemPrompt, /feature survives/u);
    assert.match(oldFirst.systemPrompt, /pi_background_shell_policy/u);
    const peerAfter = `${oldFirst.systemPrompt}\n\n<peer_after>also survives</peer_after>`;
    assert.match(upsertShellPolicyGuidance(peerAfter, policy), /peer_after/u);
    assert.equal(
      upsertShellPolicyGuidance(upsertShellPolicyGuidance(peerAfter, policy), policy),
      upsertShellPolicyGuidance(peerAfter, policy),
      'shell policy insertion must be idempotent',
    );

    const sections: Record<string, string> = { pi_background_feature_guidance: 'feature survives' };
    const structuredOptions = { cwd: '/tmp', sections, forceSystemPrompt: `forced\n\n${peer}` };
    const structured = applyShellPolicyGuidance(
      { systemPrompt: structuredOptions.forceSystemPrompt, systemPromptOptions: structuredOptions },
      policy,
    );
    assert.equal(structured, undefined);
    assert.equal(sections[SHELL_POLICY_SECTION], guidance);
    assert.match(structuredOptions.forceSystemPrompt, /feature survives/u);
    assert.match(structuredOptions.forceSystemPrompt, /pi_background_shell_policy/u);
    assert.equal(renderShellPolicyGuidanceBlock(policy).includes(guidance), true);
  });
});
