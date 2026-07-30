import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import {
  FusionChildRunError,
  FusionPiCompactResultParser,
  buildFusionPiChildArgv,
  fusionPiChildEnv,
  parseFusionChildStderr,
  runPiChild,
  type FusionChildProcess,
  type FusionChildSpawn,
} from '../../src/core/fusion/pi-child.js';
import type { Usage } from '@earendil-works/pi-ai';
import type { ResolvedFusionModel } from '../../src/core/fusion/types.js';
import {
  FUSION_CHILD_RESULT_PREFIX,
  buildFusionChildResultMetadata,
} from '../../src/fusion-child-extension.js';

class FakeReadable extends EventEmitter {
  emitData(value: Buffer | string): void {
    this.emit('data', value);
  }
}

class FakeStdin extends EventEmitter {
  readonly chunks: Buffer[] = [];
  ended = false;
  writeError: Error | undefined;

  write(data: Buffer, callback: (error?: Error | null) => void): boolean {
    this.chunks.push(data);
    const error = this.writeError;
    queueMicrotask(() => callback(error));
    return true;
  }

  end(callback?: () => void): void {
    this.ended = true;
    if (callback !== undefined) queueMicrotask(callback);
  }
}

class FakeChild extends EventEmitter implements FusionChildProcess {
  readonly stdin = new FakeStdin();
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly killCalls: NodeJS.Signals[] = [];
  pid: number | undefined;

  constructor(pid: number | undefined = 1234) {
    super();
    this.pid = pid;
  }

  kill(signal?: NodeJS.Signals): boolean {
    if (signal !== undefined) this.killCalls.push(signal);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('close', code, signal);
  }

  fail(error: Error): void {
    this.emit('error', error);
  }
}

interface SpawnRecord {
  command: string;
  args: string[];
  options: SpawnOptions;
  child: FakeChild;
}

function resolvedModel(provider = 'openai-codex', model = 'gpt-5.5'): ResolvedFusionModel {
  return {
    selection: '$current',
    source: 'current',
    provider,
    model,
    qualifiedId: `${provider}/${model}`,
    thinkingLevel: 'high',
    contextWindow: 100000,
  };
}

function makeSpawn(child = new FakeChild()): { records: SpawnRecord[]; spawn: FusionChildSpawn } {
  const records: SpawnRecord[] = [];
  return {
    records,
    spawn: (command, args, options) => {
      records.push({ command, args, options, child });
      return child;
    },
  };
}

function compactFrame(input: {
  provider?: string;
  model?: string;
  text: string;
  stopReason: string;
  usage: Usage;
}): string {
  const record = buildFusionChildResultMetadata({
    provider: input.provider ?? 'openai-codex',
    model: input.model ?? 'gpt-5.5',
    stopReason: input.stopReason,
    content: [{ type: 'text', text: input.text }],
    usage: input.usage,
  });
  return `${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(record)}\n`;
}

function compactMetadata(provider = 'openai-codex', model = 'gpt-5.5'): string {
  return (
    compactFrame({
      provider,
      model,
      text: 'draft',
      stopReason: 'length',
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 10,
        cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
      },
    }) +
    compactFrame({
      provider,
      model,
      text: 'final héllo',
      stopReason: 'stop',
      usage: {
        input: 5,
        output: 6,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 11,
        cost: { input: 0.05, output: 0.06, cacheRead: 0.04, cacheWrite: 0.05, total: 0.2 },
      },
    })
  );
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

void describe('fusion Pi child runner', () => {
  void it('BUG-182 preserves the complete Pi Usage cost contract in compact metadata', () => {
    const piUsage: Usage = {
      input: 11,
      output: 7,
      cacheRead: 2,
      cacheWrite: 3,
      totalTokens: 23,
      cost: {
        input: 0.001,
        output: 0.002,
        cacheRead: 0.003,
        cacheWrite: 0.004,
        total: 0.01,
      },
    };
    const record = buildFusionChildResultMetadata({
      provider: 'anthropic',
      model: 'claude-opus-5',
      stopReason: 'stop',
      content: [{ type: 'text', text: 'answer' }],
      usage: piUsage,
    });
    const usage: unknown = record.usage;
    assert.deepEqual(usage, piUsage);
    assert.equal(Reflect.get(record.usage, 'costTotal'), undefined);

    const legacyRecord = {
      ...record,
      usage: {
        input: 11,
        output: 7,
        cacheRead: 2,
        cacheWrite: 3,
        totalTokens: 23,
        costTotal: 0.01,
      },
    };
    assert.throws(
      () =>
        parseFusionChildStderr(
          Buffer.from(`${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(legacyRecord)}\n`),
        ),
      /cost|keys mismatch|unknown key/,
    );
  });

  void it('BUG-180 launches a final-text child with only the private compact metadata extension', () => {
    const argv = buildFusionPiChildArgv(resolvedModel(), 'system');
    assert.deepEqual(argv.slice(0, 8), [
      '--mode',
      'text',
      '--no-session',
      '--no-tools',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
    ]);
    assert.ok(argv.includes('--no-context-files'));
    assert.ok(argv.includes('--system-prompt'));
    const extensionIndex = argv.indexOf('--extension');
    assert.ok(extensionIndex >= 0, 'private compact metadata extension flag');
    assert.match((argv[extensionIndex + 1] ?? '').replaceAll('\\', '/'), /extensions\/fusion-child\.ts$/);
    const env = fusionPiChildEnv({
      PI_SESSION_ID: 'old',
      PI_MODEL: 'old-model',
      OPENAI_API_KEY: 'kept',
    });
    assert.equal(env['PI_SESSION_ID'], undefined);
    assert.equal(env['PI_MODEL'], undefined);
    assert.equal(env['OPENAI_API_KEY'], 'kept');
    assert.equal(env['PI_SKIP_VERSION_CHECK'], '1');
  });

  void it('keeps reasoning and full response text out of compact child metadata', () => {
    const record = buildFusionChildResultMetadata({
      provider: 'openai-codex',
      model: 'gpt-5.5',
      stopReason: 'stop',
      content: [
        { type: 'thinking', text: 'private reasoning must not cross the child boundary' },
        { type: 'text', text: 'complete final answer' },
      ],
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const serialized = JSON.stringify(record);
    assert.doesNotMatch(serialized, /private reasoning/);
    assert.doesNotMatch(serialized, /complete final answer/);
    assert.deepEqual(
      record.text_blocks.map((block) => block.utf8_bytes),
      [21],
    );
  });

  void it('pipes the prompt through stdin and returns the exact full text with compact metadata', async () => {
    const child = new FakeChild(777);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'candidate',
      slot: 1,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system prompt',
      userPrompt: 'large prompt with U+2028 \u2028 and U+2029 \u2029',
      spawn: harness.spawn,
      platform: 'linux',
      env: { PI_SESSION_FILE: 'old', ANTHROPIC_API_KEY: 'kept' },
    });
    await tick();
    const record = harness.records[0];
    assert.ok(record, 'spawn record exists');
    assert.equal(record.command, 'pi');
    assert.equal(record.options.shell, false);
    assert.deepEqual(record.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(record.options.env?.['PI_SESSION_FILE'], undefined);
    assert.equal(record.options.env?.['ANTHROPIC_API_KEY'], 'kept');
    assert.equal(
      Buffer.concat(child.stdin.chunks).toString('utf8'),
      'large prompt with U+2028 \u2028 and U+2029 \u2029',
    );
    assert.equal(child.stdin.ended, true);

    const response = Buffer.from('final héllo\n', 'utf8');
    child.stdout.emitData(response.subarray(0, 4));
    child.stdout.emitData(response.subarray(4));
    const metadata = Buffer.from(compactMetadata(), 'utf8');
    child.stderr.emitData('diagnostic');
    child.stderr.emitData(metadata.subarray(0, 23));
    child.stderr.emitData(metadata.subarray(23));
    child.close(0, null);
    const result = await run;
    assert.equal(result.text, 'final héllo');
    assert.equal(result.usage.input, 6);
    assert.equal(result.usage.output, 8);
    assert.equal(result.usage.totalTokens, 21);
    assert.deepEqual(result.usage.cost, {
      input: 0.060000000000000005,
      output: 0.08,
      cacheRead: 0.07,
      cacheWrite: 0.09,
      total: 0.30000000000000004,
    });
    assert.equal(result.stderr.toString('utf8'), 'diagnostic');
    assert.equal(result.events.toString('utf8').split('\n').filter(Boolean).length, 2);
    assert.doesNotMatch(result.events.toString('utf8'), /final héllo/);
  });

  void it('rejects malformed compact metadata loudly', async () => {
    const child = new FakeChild(888);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'candidate',
      slot: 2,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'linux',
      killGraceMs: 50,
      sigkillWaitMs: 50,
    });
    await tick();
    child.stdout.emitData('x\n');
    child.stderr.emitData(`${FUSION_CHILD_RESULT_PREFIX}{broken}\n`);
    child.close(0, null);
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_event_invalid');
      return true;
    });
  });

  void it('fails before spawn when the abort signal is already set', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeSpawn();
    await assert.rejects(
      runPiChild({
        stage: 'merge',
        attempt: 1,
        cwd: '/tmp/project',
        model: resolvedModel(),
        systemPrompt: 'system',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        signal: controller.signal,
      }),
      /cancelled before spawn/,
    );
    assert.equal(harness.records.length, 0);
  });

  void it('catches an abort that fires during spawn before listener attachment', async () => {
    const controller = new AbortController();
    const child = new FakeChild(333);
    const records: SpawnRecord[] = [];
    const run = runPiChild({
      stage: 'candidate',
      slot: 1,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: (command, args, options) => {
        records.push({ command, args, options, child });
        controller.abort();
        return child;
      },
      signal: controller.signal,
      platform: 'win32',
      killGraceMs: 1000,
      sigkillWaitMs: 1000,
    });
    await tick();
    assert.equal(records.length, 1);
    assert.deepEqual(child.killCalls, ['SIGTERM']);
    child.close(null, 'SIGTERM');
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_cancelled');
      return true;
    });
  });

  void it('reconstructs multiple print-mode text blocks without compacting the final answer', () => {
    const record = buildFusionChildResultMetadata({
      provider: 'p',
      model: 'm',
      stopReason: 'stop',
      content: [
        { type: 'text', text: 'first line\n' },
        { type: 'text', text: '世界' },
      ],
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const stderr = Buffer.from(`${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(record)}\n`, 'utf8');
    const response = Buffer.from('first line\n\n世界\n', 'utf8');
    const parsed = new FusionPiCompactResultParser('p', 'm').finish(response, stderr);
    assert.equal(parsed.text, 'first line\n世界');
  });

  void it('rejects non-stop final reasons, model mismatch, and unterminated metadata', () => {
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
    };
    const parser = new FusionPiCompactResultParser('p', 'm');
    const nonStop = compactFrame({
      provider: 'p',
      model: 'm',
      text: 'x',
      stopReason: 'length',
      usage,
    });
    assert.throws(() => parser.finish(Buffer.from('x\n'), Buffer.from(nonStop)), /not stop/);

    const mismatch = compactFrame({
      provider: 'p',
      model: 'other',
      text: 'x',
      stopReason: 'stop',
      usage,
    });
    assert.throws(() => parser.finish(Buffer.from('x\n'), Buffer.from(mismatch)), /model mismatch/);

    const valid = compactFrame({
      provider: 'p',
      model: 'm',
      text: 'expected',
      stopReason: 'stop',
      usage,
    });
    assert.throws(
      () => parser.finish(Buffer.from('tampered\n'), Buffer.from(valid)),
      /hash mismatch/,
    );
    assert.throws(() => parser.finish(Buffer.from('x\n'), Buffer.alloc(0)), /no compact result/);
    assert.throws(
      () => parseFusionChildStderr(Buffer.from(`${FUSION_CHILD_RESULT_PREFIX}{}`)),
      /newline-terminated/,
    );
  });

  void it('rejects stdin write failures and terminates the child loudly', async () => {
    const child = new FakeChild(456);
    child.stdin.writeError = new Error('EPIPE');
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'candidate',
      slot: 3,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'win32',
      killGraceMs: 50,
      sigkillWaitMs: 50,
    });
    await tick();
    child.close(null, 'SIGTERM');
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_stdin_failed');
      assert.match(error.message, /EPIPE/);
      return true;
    });
    assert.deepEqual(child.killCalls, ['SIGTERM']);
  });

  void it('surfaces cleanup failures even when child kill fallback succeeds', async () => {
    const child = new FakeChild(321);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'candidate',
      slot: 2,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'linux',
      killProcess: () => false,
      stdoutLimitBytes: 4,
      killGraceMs: 20,
      sigkillWaitMs: 20,
    });
    await tick();
    child.stdout.emitData('abcdef');
    child.close(null, 'SIGTERM');
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_output_cap');
      assert.match(error.message, /process cleanup issues/);
      assert.match(error.message, /process group kill returned false/);
      return true;
    });
  });

  void it('fails instead of reporting completion when a killed child never closes', async () => {
    const child = new FakeChild(654);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'merge',
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'win32',
      stdoutLimitBytes: 4,
      killGraceMs: 10,
      sigkillWaitMs: 10,
    });
    await tick();
    child.stdout.emitData('abcdef');
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_output_cap');
      assert.match(error.message, /did not emit close/);
      return true;
    });
    assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
  });

  void it('carries observed usage on child exit failures', async () => {
    const child = new FakeChild(111);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'evaluation',
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'win32',
      killGraceMs: 20,
      sigkillWaitMs: 20,
    });
    await tick();
    child.stdout.emitData('final héllo\n');
    child.stderr.emitData(compactMetadata());
    child.close(42, null);
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_exit_failed');
      assert.equal(error.usage.totalTokens, 21);
      assert.equal(error.qualifiedId, 'openai-codex/gpt-5.5');
      return true;
    });
  });

  void it('rejects output caps and keeps captured prefixes', async () => {
    const child = new FakeChild(999);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'merge',
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'win32',
      stdoutLimitBytes: 5,
      killGraceMs: 50,
      sigkillWaitMs: 50,
    });
    await tick();
    child.stdout.emitData('abcdef');
    child.close(null, 'SIGTERM');
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_output_cap');
      assert.equal(error.response.toString('utf8'), 'abcde');
      return true;
    });
    assert.deepEqual(child.killCalls, ['SIGTERM']);
  });
});
