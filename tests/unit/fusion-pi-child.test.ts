import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnOptions } from 'node:child_process';
import {
  FUSION_CHILD_IDLE_TIMEOUT_MS,
  FUSION_CHILD_STDERR_LIMIT_BYTES,
  FUSION_CHILD_STDOUT_LIMIT_BYTES,
  FUSION_CHILD_TIMEOUT_MS,
  FusionChildRunError,
  FusionPiCompactResultParser,
  assertFusionRuntimeGuardMatchesModel,
  assertFusionToolPolicyDisjoint,
  buildFusionPiChildArgv,
  fusionPiChildEnv,
  parseFusionChildSettlement,
  parseFusionChildStderr,
  parseFusionRuntimeGuard,
  parseFusionToolCallLog,
  runPiChild,
  type FusionChildProcess,
  type FusionChildSpawn,
} from '../../src/core/fusion/pi-child.js';
import type { Usage } from '@earendil-works/pi-ai';
import { isJsonObject } from '../../src/core/common.js';
import { resolveAnthropicAttributionExtensionPath } from '../../src/core/anthropic-attribution-path.js';
import {
  FUSION_FORBIDDEN_TOOLS,
  FUSION_INSPECT_TOOLS,
  FUSION_TOOL_CALL_LOG_SCHEMA_VERSION,
  FUSION_WEB_FETCH_TOOL_NAME,
  type ResolvedFusionModel,
} from '../../src/core/fusion/types.js';
import fusionChildExtension, {
  FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
  FUSION_CANDIDATE_OUTPUT_COMPRESSION_PROMPT,
  FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV,
  FUSION_CHILD_MAX_PROVIDER_REQUESTS,
  FUSION_CHILD_MAX_TOOL_CALLS,
  FUSION_CLAUDE_CACHE_OBSERVATION_SCHEMA_VERSION,
  FUSION_CLAUDE_CACHE_RETENTION_ENV,
  FUSION_CHILD_RESULT_PREFIX,
  FUSION_CHILD_SETTLEMENT_PREFIX,
  FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES,
  FUSION_RUNTIME_GUARD_PREFIX,
  FUSION_RUNTIME_GUARD_SCHEMA_VERSION,
  evaluateFusionRuntimeRequest,
  evaluateFusionRuntimeToolLimit,
  prepareFusionRuntimeRequest,
  FUSION_RESEARCH_ENABLED_ENV,
  FUSION_SOURCE_POLICY_PATH_ENV,
  FUSION_SOURCE_POLICY_SHA256_ENV,
  FUSION_TOOL_CALL_LOG_PATH_ENV,
  FUSION_TOOL_CALL_SEAL_SCHEMA_VERSION,
  FUSION_TOOL_CALL_SEAL_SUFFIX,
  buildFusionChildResultMetadata,
  buildFusionChildSettlement,
  nonAnthropicFusionCacheObservation,
  type FusionClaudeCacheObservation,
} from '../../src/fusion-child-extension.js';
import {
  buildFusionSourcePolicy,
  sourcePolicyCanonicalBytes,
} from '../../src/core/fusion/source-policy.js';

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
    maxOutputTokens: 32_768,
  };
}

const fusionExtensionEventContext = {
  isIdle: () => true,
  abort: () => undefined,
  model: {
    provider: 'openai-codex',
    id: 'gpt-5.5',
    contextWindow: 100_000,
    maxTokens: 32_768,
  },
};

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

function cacheObservation(provider: string, requestOrdinal = 1): FusionClaudeCacheObservation {
  if (provider !== 'anthropic') return nonAnthropicFusionCacheObservation(requestOrdinal);
  return {
    schema_version: FUSION_CLAUDE_CACHE_OBSERVATION_SCHEMA_VERSION,
    applicability: 'anthropic',
    source: 'default',
    requested_retention: 'long',
    effective_retention: 'long',
    breakpoint_count: 3,
    request_ordinal: requestOrdinal,
  };
}

function compactFrame(input: {
  provider?: string;
  model?: string;
  text: string;
  stopReason: string;
  usage: Usage;
  requestOrdinal?: number;
  candidateLimitBytes?: number | null;
  recoveryRole?: 'none' | 'oversized_original' | 'replacement';
}): string {
  const provider = input.provider ?? 'openai-codex';
  const record = buildFusionChildResultMetadata(
    {
      provider,
      model: input.model ?? 'gpt-5.5',
      stopReason: input.stopReason,
      content: [{ type: 'text', text: input.text }],
      usage: input.usage,
    },
    cacheObservation(provider, input.requestOrdinal),
    {
      candidateLimitBytes: input.candidateLimitBytes ?? null,
      recoveryRole: input.recoveryRole ?? 'none',
    },
  );
  return `${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(record)}\n`;
}

function withSettlement(frames: string, runtimeGuardFailed = false): string {
  const records = parseFusionChildStderr(Buffer.from(frames, 'utf8')).records;
  const settlement = buildFusionChildSettlement(records, runtimeGuardFailed);
  return `${frames}${FUSION_CHILD_SETTLEMENT_PREFIX}${JSON.stringify(settlement)}\n`;
}

function compactMetadata(provider = 'openai-codex', model = 'gpt-5.5'): string {
  return withSettlement(
    compactFrame({
      provider,
      model,
      text: 'draft',
      stopReason: 'toolUse',
      requestOrdinal: 1,
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
        requestOrdinal: 2,
        usage: {
          input: 5,
          output: 6,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 11,
          cost: { input: 0.05, output: 0.06, cacheRead: 0.04, cacheWrite: 0.05, total: 0.2 },
        },
      }),
  );
}

function piUsage(input: number, output: number, totalTokens = input + output): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

async function writeToolCallSeal(logPath: string): Promise<void> {
  const bytes = await readFile(logPath);
  const trace = parseFusionToolCallLog(bytes);
  await writeFile(
    `${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`,
    `${JSON.stringify({
      schema_version: FUSION_TOOL_CALL_SEAL_SCHEMA_VERSION,
      status: 'complete',
      record_count: trace.summary.count,
      total_result_bytes: trace.summary.total_result_bytes,
      log_sha256: createHash('sha256').update(bytes).digest('hex'),
    })}\n`,
    'utf8',
  );
}

function toolLogLine(ordinal: number, overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema_version: FUSION_TOOL_CALL_LOG_SCHEMA_VERSION,
    ordinal,
    tool_name: 'read',
    arguments_sha256: 'a'.repeat(64),
    arguments_bytes: 10,
    result_bytes: 20,
    result_sha256: 'b'.repeat(64),
    status: 'ok',
    duration_ms: 5,
    ...overrides,
  })}\n`;
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

void describe('fusion Pi child runner', () => {
  void it('pins the expanded child execution envelope', () => {
    assert.equal(FUSION_CHILD_TIMEOUT_MS, 50 * 60 * 1000);
    assert.equal(FUSION_CHILD_IDLE_TIMEOUT_MS, 35 * 60 * 1000);
    assert.equal(FUSION_CHILD_MAX_PROVIDER_REQUESTS, 550);
    assert.equal(FUSION_CHILD_MAX_TOOL_CALLS, 600);
    assert.equal(FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES, 32 * 1024 * 1024);
    assert.equal(FUSION_CHILD_STDOUT_LIMIT_BYTES, 32 * 1024 * 1024);
    assert.equal(FUSION_CHILD_STDERR_LIMIT_BYTES, 16 * 1024 * 1024);
    assert.ok(FUSION_CHILD_IDLE_TIMEOUT_MS < FUSION_CHILD_TIMEOUT_MS);
  });

  void it('BUG-185 never rejects a provider request by subtracting possible output from context', () => {
    const input = {
      payload: { input: 'x '.repeat(300_000) },
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      contextWindowTokens: 272_000,
      maxOutputTokens: 128_000,
      requestOrdinal: 23,
      toolCallCount: 133,
    };

    assert.equal(prepareFusionRuntimeRequest(input).guard, undefined);
    assert.equal(evaluateFusionRuntimeRequest(input), undefined);
  });

  void it('stably clones provider payloads and preserves only explicit execution-limit guards', () => {
    const originalPayload = { input: 'small request' };
    const prepared = prepareFusionRuntimeRequest({
      payload: originalPayload,
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      requestOrdinal: 1,
      toolCallCount: 0,
    });
    assert.equal(prepared.guard, undefined);
    assert.deepEqual(prepared.payload, originalPayload);
    assert.notEqual(
      prepared.payload,
      originalPayload,
      'transport receives the validated JSON clone',
    );

    let toJsonCalls = 0;
    const stateful = prepareFusionRuntimeRequest({
      payload: {
        toJSON() {
          toJsonCalls += 1;
          return { input: toJsonCalls === 1 ? 'measured once' : 'changed later' };
        },
      },
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      requestOrdinal: 1,
      toolCallCount: 0,
    });
    assert.equal(stateful.guard, undefined);
    assert.deepEqual(stateful.payload, { input: 'measured once' });
    assert.equal(toJsonCalls, 1);

    const blocked = evaluateFusionRuntimeRequest({
      payload: { input: 'x '.repeat(300_000) },
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      requestOrdinal: FUSION_CHILD_MAX_PROVIDER_REQUESTS + 1,
      toolCallCount: 133,
    });
    assert.ok(blocked);
    assert.equal(blocked.code, 'provider_request_limit');
    assert.ok(blocked.payload_bytes > 600_000);
    assert.match(blocked.message, /provider request 551/);
    assert.doesNotMatch(blocked.message, /x x x/);

    const frame = Buffer.from(`${FUSION_RUNTIME_GUARD_PREFIX}${JSON.stringify(blocked)}\n`, 'utf8');
    assert.deepEqual(parseFusionRuntimeGuard(frame), blocked);
    const route = resolvedModel('openai-codex', 'gpt-5.6-terra');
    assert.doesNotThrow(() => assertFusionRuntimeGuardMatchesModel(blocked, route));
    assert.throws(
      () => assertFusionRuntimeGuardMatchesModel({ ...blocked, model: 'substituted-model' }, route),
      /route mismatch/,
    );
    assert.throws(
      () => parseFusionRuntimeGuard(Buffer.concat([frame, frame])),
      /multiple runtime guard frames/,
    );
    const malformed = (value: Record<string, unknown>): Buffer =>
      Buffer.from(`${FUSION_RUNTIME_GUARD_PREFIX}${JSON.stringify(value)}\n`, 'utf8');
    assert.throws(
      () => parseFusionRuntimeGuard(malformed({ ...blocked, unknown: true })),
      /unknown key|keys mismatch/,
    );
    assert.throws(
      () => parseFusionRuntimeGuard(malformed({ ...blocked, code: 'provider_request_budget' })),
      /code is unsupported/,
    );
    assert.throws(
      () => parseFusionRuntimeGuard(malformed({ ...blocked, request_ordinal: 0 })),
      /request_ordinal must be a positive/,
    );
    assert.throws(
      () => parseFusionRuntimeGuard(malformed({ ...blocked, allowed_input_tokens: 139_904 })),
      /unknown key|keys mismatch/,
    );
  });

  void it('fails closed for provider/tool loops and malformed provider payloads', () => {
    const limited = evaluateFusionRuntimeRequest({
      payload: { input: 'small' },
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      requestOrdinal: FUSION_CHILD_MAX_PROVIDER_REQUESTS + 1,
      toolCallCount: 10,
    });
    assert.equal(limited?.code, 'provider_request_limit');

    const missingModel = evaluateFusionRuntimeRequest({
      payload: { input: 'small' },
      provider: undefined,
      model: undefined,
      requestOrdinal: 1,
      toolCallCount: 0,
    });
    assert.equal(missingModel?.code, 'provider_payload_invalid');
    assert.match(missingModel.message, /active model is unavailable/);
    const nonObject = prepareFusionRuntimeRequest({
      payload: 'not an object',
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      requestOrdinal: 1,
      toolCallCount: 0,
    });
    assert.equal(nonObject.guard?.code, 'provider_payload_invalid');
    assert.match(nonObject.guard?.message ?? '', /must serialize to a JSON object/);

    assert.equal(
      evaluateFusionRuntimeToolLimit({
        provider: 'openai-codex',
        model: 'gpt-5.6-terra',
        requestOrdinal: 12,
        toolCallCount: FUSION_CHILD_MAX_TOOL_CALLS,
      }),
      undefined,
    );
    const toolLimited = evaluateFusionRuntimeToolLimit({
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      requestOrdinal: 12,
      toolCallCount: FUSION_CHILD_MAX_TOOL_CALLS + 1,
    });
    assert.equal(toolLimited?.code, 'tool_call_limit');
    assert.equal(toolLimited?.tool_call_count, 601);
    assert.match(toolLimited?.message ?? '', /exceeding the 600-call execution limit/);
  });

  void it('aborts and seals failed when the actual child hook sees tool call 601', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-limit-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    const originalWrite = process.stderr.write;
    const stderrChunks: Buffer[] = [];
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      process.stderr.write = ((
        chunk: Uint8Array | string,
        encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void,
      ): boolean => {
        stderrChunks.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
        );
        const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        done?.(null);
        return true;
      }) as typeof process.stderr.write;

      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: Record<string, unknown>,
      ) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const beforeProvider = handlers.get('before_provider_request')?.[0];
      const toolCall = handlers.get('tool_call')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(beforeProvider);
      assert.ok(toolCall);
      assert.ok(agentSettled);
      let aborts = 0;
      const context = {
        abort: () => {
          aborts += 1;
        },
        model: {
          provider: 'openai-codex',
          id: 'gpt-5.6-terra',
          contextWindow: 272_000,
          maxTokens: 128_000,
        },
      };
      assert.deepEqual(
        await Promise.resolve(beforeProvider({ payload: { input: 'initial' } }, context)),
        { input: 'initial' },
      );
      for (let ordinal = 1; ordinal <= FUSION_CHILD_MAX_TOOL_CALLS; ordinal += 1) {
        const result: unknown = await Promise.resolve(
          toolCall({ toolCallId: `call-${String(ordinal)}`, toolName: 'read', input: {} }, context),
        );
        assert.equal(result, undefined);
      }
      const refusal: unknown = await Promise.resolve(
        toolCall({ toolCallId: 'call-601', toolName: 'read', input: {} }, context),
      );
      assert.deepEqual(refusal, {
        block: true,
        reason: 'fusion child reached tool call 601, exceeding the 600-call execution limit',
      });
      assert.equal(aborts, 1);
      assert.equal(process.exitCode, 1);
      const guard = parseFusionRuntimeGuard(Buffer.concat(stderrChunks));
      assert.equal(guard?.code, 'tool_call_limit');
      assert.equal(guard?.tool_call_count, 601);
      assert.throws(
        () => agentSettled({}, { isIdle: () => true }),
        /finalized as failed.*600 unmatched tool start/,
      );
      const seal = JSON.parse(
        await readFile(`${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`, 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(seal['status'], 'failed');
      assert.equal(seal['record_count'], 0);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails the child audit when aggregate tool results cross 32 MiB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-bytes-limit-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: Record<string, unknown>,
      ) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const toolCall = handlers.get('tool_call')?.[0];
      const toolResult = handlers.get('tool_result')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(toolCall);
      assert.ok(toolResult);
      assert.ok(agentSettled);
      const context = {
        abort() {},
        model: { provider: 'openai-codex', id: 'gpt-5.6-terra' },
      };
      assert.equal(
        await Promise.resolve(
          toolCall({ toolCallId: 'aggregate-over', toolName: 'read', input: {} }, context),
        ),
        undefined,
      );
      assert.throws(
        () =>
          toolResult({
            toolCallId: 'aggregate-over',
            toolName: 'read',
            input: {},
            content: [{ type: 'text', text: 'x'.repeat(FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES) }],
            details: {},
            isError: false,
          }),
        /exceeded the aggregate tool-output budget/,
      );
      assert.equal(process.exitCode, 1);
      assert.throws(
        () => agentSettled({}, { isIdle: () => true }),
        /finalized as failed/,
      );
      const seal = JSON.parse(
        await readFile(`${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`, 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(seal['status'], 'failed');
      assert.equal(seal['record_count'], 1);
      assert.ok(Number(seal['total_result_bytes']) > FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES);
    } finally {
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('applies and records the default one-hour Claude cache policy before runtime governance', async () => {
    const priorRetention = process.env['PI_CACHE_RETENTION'];
    const oldExitCode = process.exitCode;
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks: Buffer[] = [];
    try {
      delete process.env['PI_CACHE_RETENTION'];
      process.stderr.write = ((
        chunk: Uint8Array | string,
        callback?: (error?: Error | null) => void,
      ): boolean => {
        stderrChunks.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
        );
        callback?.(null);
        return true;
      }) as typeof process.stderr.write;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (event: object, context?: object) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const beforeHeaders = handlers.get('before_provider_headers')?.[0];
      const beforeProvider = handlers.get('before_provider_request')?.[0];
      const messageEnd = handlers.get('message_end')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(beforeHeaders);
      assert.ok(beforeProvider);
      assert.ok(messageEnd);
      assert.ok(agentSettled);
      const headers = { 'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20' };
      await Promise.resolve(
        beforeHeaders({ headers }, { model: { provider: 'anthropic', id: 'claude-opus-4-8' } }),
      );
      assert.match(headers['anthropic-beta'], /prompt-caching-scope-2026-01-05/);
      const short = { type: 'ephemeral' };
      const payload = {
        model: 'claude-opus-4-8',
        system: [
          { type: 'text', text: 'identity', cache_control: short },
          { type: 'text', text: 'system', cache_control: short },
        ],
        tools: [{ name: 'read', input_schema: {}, cache_control: short }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'request', cache_control: short }] },
        ],
      };
      const context = {
        abort: () => assert.fail('valid Claude cache policy must not abort'),
        model: {
          provider: 'anthropic',
          id: 'claude-opus-4-8',
          contextWindow: 200_000,
          maxTokens: 64_000,
          compat: { supportsLongCacheRetention: true },
        },
      };
      const transformed: unknown = await Promise.resolve(beforeProvider({ payload }, context));
      assert.ok(isJsonObject(transformed));
      assert.equal(JSON.stringify(transformed).match(/"ttl":"1h"/gu)?.length, 4);
      assert.equal(JSON.stringify(payload).includes('"ttl"'), false);

      await Promise.resolve(
        messageEnd({
          message: {
            role: 'assistant',
            provider: 'anthropic',
            model: 'claude-opus-4-8',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'answer' }],
            usage: piUsage(2, 1, 3),
          },
        }),
      );
      await Promise.resolve(agentSettled({}, { isIdle: () => true }));
      const parsed = parseFusionChildStderr(Buffer.concat(stderrChunks));
      assert.equal(parsed.records.length, 1);
      assert.deepEqual(parsed.records[0]?.cache_observation, {
        schema_version: FUSION_CLAUDE_CACHE_OBSERVATION_SCHEMA_VERSION,
        applicability: 'anthropic',
        source: 'default',
        requested_retention: 'long',
        effective_retention: 'long',
        breakpoint_count: 4,
        request_ordinal: 1,
      });
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = oldExitCode;
      if (priorRetention === undefined) delete process.env['PI_CACHE_RETENTION'];
      else process.env['PI_CACHE_RETENTION'] = priorRetention;
    }
  });

  void it('preserves a pre-transport provider error instead of masking it as a cache-policy error', async () => {
    const oldExitCode = process.exitCode;
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks: Buffer[] = [];
    try {
      process.stderr.write = ((
        chunk: Uint8Array | string,
        callback?: (error?: Error | null) => void,
      ): boolean => {
        stderrChunks.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
        );
        callback?.(null);
        return true;
      }) as typeof process.stderr.write;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (event: object, context?: object) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const messageEnd = handlers.get('message_end')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(messageEnd);
      assert.ok(agentSettled);

      await Promise.resolve(
        messageEnd({
          message: {
            role: 'assistant',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            stopReason: 'error',
            errorMessage: 'OAuth refresh failed',
            content: [],
            usage: piUsage(0, 0, 0),
          },
        }),
      );
      await Promise.resolve(agentSettled({}, { isIdle: () => true }));

      const stderr = Buffer.concat(stderrChunks);
      assert.doesNotMatch(stderr.toString('utf8'), /no matching cache-policy observation/);
      const settlement = parseFusionChildSettlement(stderr);
      assert.ok(settlement);
      assert.equal(settlement.status, 'failed');
      assert.equal(settlement.failure_reason, 'no_records');
      assert.equal(process.exitCode, 1);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = oldExitCode;
    }
  });

  void it('queues exactly one same-session no-tool compression turn and seals both records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-output-recovery-hook-'));
    const priorPath = process.env[FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV];
    const oldExitCode = process.exitCode;
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks: Buffer[] = [];
    try {
      const recoveryPath = join(root, 'candidate.response.oversized.md');
      process.env[FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV] = recoveryPath;
      process.stderr.write = ((
        chunk: Uint8Array | string,
        callback?: (error?: Error | null) => void,
      ): boolean => {
        stderrChunks.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
        );
        callback?.(null);
        return true;
      }) as typeof process.stderr.write;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (event: object, context?: object) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const activeToolSets: string[][] = [];
      const followUps: Array<{ message: string; deliverAs: string | undefined }> = [];
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
        setActiveTools(names: string[]) {
          activeToolSets.push([...names]);
        },
        sendUserMessage(message: string, options?: { deliverAs?: string }) {
          followUps.push({ message, deliverAs: options?.deliverAs });
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const beforeProvider = handlers.get('before_provider_request')?.[0];
      const messageEnd = handlers.get('message_end')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(beforeProvider);
      assert.ok(messageEnd);
      assert.ok(agentSettled);
      const original = 'x'.repeat(FUSION_CANDIDATE_MAX_OUTPUT_BYTES);
      await Promise.resolve(
        beforeProvider({ payload: { input: 'first' } }, fusionExtensionEventContext),
      );
      await Promise.resolve(
        messageEnd({
          message: {
            role: 'assistant',
            provider: 'openai-codex',
            model: 'gpt-5.5',
            stopReason: 'stop',
            content: [{ type: 'text', text: original }],
            usage: piUsage(3, 4, 7),
          },
        }),
      );
      assert.deepEqual(activeToolSets, [[]]);
      assert.deepEqual(followUps, [
        { message: FUSION_CANDIDATE_OUTPUT_COMPRESSION_PROMPT, deliverAs: 'followUp' },
      ]);
      assert.equal(await readFile(recoveryPath, 'utf8'), original);

      await Promise.resolve(
        beforeProvider({ payload: { input: 'second' } }, fusionExtensionEventContext),
      );
      await Promise.resolve(
        messageEnd({
          message: {
            role: 'assistant',
            provider: 'openai-codex',
            model: 'gpt-5.5',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'compressed' }],
            usage: piUsage(5, 2, 7),
          },
        }),
      );
      await Promise.resolve(agentSettled({}, { isIdle: () => true }));

      const stderr = Buffer.concat(stderrChunks);
      const parsed = parseFusionChildStderr(stderr);
      assert.equal(parsed.records.length, 2);
      assert.equal(parsed.records[0]?.output_contract.recovery_role, 'oversized_original');
      assert.equal(
        parsed.records[0].output_contract.json_rendered_bytes,
        FUSION_CANDIDATE_MAX_OUTPUT_BYTES + 2,
      );
      assert.equal(parsed.records[1]?.output_contract.recovery_role, 'replacement');
      const settlement = parseFusionChildSettlement(stderr);
      assert.ok(settlement);
      assert.equal(settlement.status, 'complete');
      assert.deepEqual(settlement.recovered_output_cap_ordinals, [0]);
      assert.equal(process.exitCode, oldExitCode);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = oldExitCode;
      if (priorPath === undefined)
        Reflect.deleteProperty(process.env, FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV);
      else process.env[FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV] = priorPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('aborts an invalid Claude cache policy before provider transport', async () => {
    const priorRetention = process.env['PI_CACHE_RETENTION'];
    const oldExitCode = process.exitCode;
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks: Buffer[] = [];
    try {
      process.env['PI_CACHE_RETENTION'] = 'forever';
      process.stderr.write = ((
        chunk: Uint8Array | string,
        callback?: (error?: Error | null) => void,
      ): boolean => {
        stderrChunks.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
        );
        callback?.(null);
        return true;
      }) as typeof process.stderr.write;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (event: object, context?: object) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const beforeProvider = handlers.get('before_provider_request')?.[0];
      assert.ok(beforeProvider);
      let aborts = 0;
      const payload = {
        model: 'claude-opus-4-8',
        system: [{ type: 'text', text: 'system', cache_control: { type: 'ephemeral' } }],
      };
      const returned = await Promise.resolve(
        beforeProvider(
          { payload },
          {
            abort: () => {
              aborts += 1;
            },
            model: {
              provider: 'anthropic',
              id: 'claude-opus-4-8',
              contextWindow: 200_000,
              maxTokens: 64_000,
            },
          },
        ),
      );
      assert.equal(returned, payload);
      assert.equal(aborts, 1);
      assert.equal(process.exitCode, 1);
      const guard = parseFusionRuntimeGuard(Buffer.concat(stderrChunks));
      assert.ok(guard);
      assert.equal(guard.code, 'claude_cache_policy');
      assert.match(guard.message, /PI_CACHE_RETENTION.*none, short, or long/);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = oldExitCode;
      if (priorRetention === undefined) delete process.env['PI_CACHE_RETENTION'];
      else process.env['PI_CACHE_RETENTION'] = priorRetention;
    }
  });

  void it('BUG-182 preserves the complete Pi Usage cost contract in compact metadata', () => {
    const piUsage: Usage = {
      input: 11,
      output: 7,
      cacheRead: 2,
      cacheWrite: 3,
      cacheWrite1h: 3,
      reasoning: 5,
      totalTokens: 23,
      cost: {
        input: 0.001,
        output: 0.002,
        cacheRead: 0.003,
        cacheWrite: 0.004,
        total: 0.01,
      },
    };
    const record = buildFusionChildResultMetadata(
      {
        provider: 'anthropic',
        model: 'claude-opus-5',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'answer' }],
        usage: piUsage,
      },
      cacheObservation('anthropic'),
    );
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

    const contradictoryCache = {
      ...record,
      cache_observation: nonAnthropicFusionCacheObservation(1),
    };
    assert.throws(
      () =>
        parseFusionChildStderr(
          Buffer.from(`${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(contradictoryCache)}\n`),
        ),
      /cache observation is not applicable/,
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
    // Normalize separators: the resolved path is native, so Windows uses backslashes.
    assert.match(
      (argv[extensionIndex + 1] ?? '').replaceAll('\\', '/'),
      /extensions\/fusion-child\.ts$/,
    );
    const env = fusionPiChildEnv({
      PI_SESSION_ID: 'old',
      PI_MODEL: 'old-model',
      OPENAI_API_KEY: 'metered-key',
      ANTHROPIC_AUTH_TOKEN: 'direct-bearer',
      AZURE_OPENAI_API_KEY: 'azure-key',
      AZURE_OPENAI_BASE_URL: 'https://metered.invalid',
      Azure_OpenAI_Resource_Name: 'mixed-case-resource',
      Anthropic_Api_Key: 'mixed-case-key',
      ANTHROPIC_OAUTH_TOKEN: 'subscription-oauth',
      [FUSION_CLAUDE_CACHE_RETENTION_ENV]: 'long',
      [FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV]: '/tmp/inherited-recovery.md',
      UNRELATED_ENV: 'preserved',
    });
    assert.equal(env['PI_SESSION_ID'], undefined);
    assert.equal(env['PI_MODEL'], undefined);
    assert.equal(env['OPENAI_API_KEY'], undefined);
    assert.equal(env['ANTHROPIC_AUTH_TOKEN'], undefined);
    assert.equal(env['AZURE_OPENAI_API_KEY'], undefined);
    assert.equal(env['AZURE_OPENAI_BASE_URL'], undefined);
    assert.equal(env['Azure_OpenAI_Resource_Name'], undefined);
    assert.equal(env['Anthropic_Api_Key'], undefined);
    assert.equal(env['ANTHROPIC_OAUTH_TOKEN'], 'subscription-oauth');
    assert.equal(env[FUSION_CLAUDE_CACHE_RETENTION_ENV], 'long');
    assert.equal(env['UNRELATED_ENV'], 'preserved');
    assert.equal(env[FUSION_TOOL_CALL_LOG_PATH_ENV], undefined);
    assert.equal(env[FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV], undefined);
    assert.equal(env['PI_SKIP_VERSION_CHECK'], '1');
  });

  void it('sets native Anthropic cache retention to long before child provider serialization', () => {
    const defaultLong = fusionPiChildEnv({ UNRELATED_ENV: 'kept' }, 'anthropic');
    assert.equal(defaultLong[FUSION_CLAUDE_CACHE_RETENTION_ENV], 'long');
    assert.equal(defaultLong['UNRELATED_ENV'], 'kept');

    for (const retention of ['none', 'short', 'long', 'invalid-for-loud-child-refusal']) {
      const explicit = fusionPiChildEnv(
        { [FUSION_CLAUDE_CACHE_RETENTION_ENV]: retention },
        'anthropic',
      );
      assert.equal(explicit[FUSION_CLAUDE_CACHE_RETENTION_ENV], retention);
    }

    const nonAnthropic = fusionPiChildEnv({}, 'openai-codex');
    assert.equal(nonAnthropic[FUSION_CLAUDE_CACHE_RETENTION_ENV], undefined);
  });

  void it('scrubs inherited fusion tool-call log env var before launch-specific wiring', () => {
    const env = fusionPiChildEnv({
      PI_SESSION_ID: 'old',
      [FUSION_TOOL_CALL_LOG_PATH_ENV]: '/tmp/fusion-tools.jsonl',
    });
    assert.equal(env['PI_SESSION_ID'], undefined);
    assert.equal(env[FUSION_TOOL_CALL_LOG_PATH_ENV], undefined);
  });

  void it('builds byte-identical reasoning argv with no tools', () => {
    assert.deepEqual(buildFusionPiChildArgv(resolvedModel(), 'system', 'extension.js', 'reason'), [
      '--mode',
      'text',
      '--no-session',
      '--no-tools',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--extension',
      'extension.js',
      '--provider',
      'openai-codex',
      '--model',
      'gpt-5.5',
      '--thinking',
      'high',
      '--system-prompt',
      'system',
    ]);
  });

  void it('builds byte-identical inspect argv with exact read-only allowlist and denylist', () => {
    const argv = buildFusionPiChildArgv(resolvedModel(), 'system', 'extension.js', 'inspect');
    assert.equal(argv.includes('--no-tools'), false);
    assert.deepEqual(argv, [
      '--mode',
      'text',
      '--no-session',
      '--no-builtin-tools',
      '--tools',
      FUSION_INSPECT_TOOLS.join(','),
      '--exclude-tools',
      FUSION_FORBIDDEN_TOOLS.join(','),
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--extension',
      'extension.js',
      '--provider',
      'openai-codex',
      '--model',
      'gpt-5.5',
      '--thinking',
      'high',
      '--system-prompt',
      'system',
    ]);
  });

  void it('builds research argv with read-only tools plus fusion_web_fetch', () => {
    const argv = buildFusionPiChildArgv(resolvedModel(), 'system', 'extension.js', 'research');
    assert.equal(argv.includes('--no-tools'), false);
    assert.deepEqual(argv.slice(0, 11), [
      '--mode',
      'text',
      '--no-session',
      '--no-builtin-tools',
      '--tools',
      [...FUSION_INSPECT_TOOLS, FUSION_WEB_FETCH_TOOL_NAME].join(','),
      '--exclude-tools',
      FUSION_FORBIDDEN_TOOLS.join(','),
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
    ]);
  });

  void it('loads package-owned Anthropic attribution/sanitization before the runtime governor', () => {
    const attribution = () => '/pkg/extensions/anthropic-attribution.ts';
    const claude = buildFusionPiChildArgv(
      resolvedModel('anthropic', 'claude-opus-5'),
      'system',
      'extension.js',
      'reason',
      attribution,
    );
    const extensionArgs = claude.reduce<string[]>((acc, value, index) => {
      if (value === '--extension') acc.push(claude[index + 1] ?? '');
      return acc;
    }, []);
    assert.deepEqual(extensionArgs, ['/pkg/extensions/anthropic-attribution.ts', 'extension.js']);
    assert.equal(extensionArgs.at(-1), 'extension.js');
  });

  void it('keeps non-Anthropic child argv byte-identical and never resolves attribution', () => {
    const attribution = () => {
      throw new Error('attribution must not be resolved for non-Anthropic routes');
    };
    for (const provider of ['openai-codex', 'openai', 'google', 'unknown-provider']) {
      const argv = buildFusionPiChildArgv(
        resolvedModel(provider, 'm1'),
        'system',
        'extension.js',
        'reason',
        attribution,
      );
      assert.equal(argv.filter((value) => value === '--extension').length, 1);
      assert.equal(argv[argv.indexOf('--extension') + 1], 'extension.js');
    }
  });

  void it('resolves the package-owned global attribution extension and fails loudly if absent', () => {
    const attribution = resolveAnthropicAttributionExtensionPath();
    assert.match(attribution.replaceAll('\\', '/'), /extensions\/anthropic-attribution\.ts$/);
    assert.equal(existsSync(attribution), true);
    assert.throws(
      () => resolveAnthropicAttributionExtensionPath(import.meta.url, () => false),
      /Anthropic attribution extension is missing/,
    );
  });

  void it('rejects fusion tool policy intersections loudly', () => {
    assert.throws(
      () => assertFusionToolPolicyDisjoint(['read', 'bash'], ['bash']),
      /forbidden tool bash/,
    );
  });

  void it('round-trips and summarizes a complete 3-call tool log', () => {
    const trace = parseFusionToolCallLog(
      Buffer.from(
        toolLogLine(0, { result_bytes: 7 }) +
          toolLogLine(1, { result_bytes: 11, status: 'error' }) +
          toolLogLine(2, { result_bytes: 13 }),
        'utf8',
      ),
    );
    assert.equal(trace.records.length, 3);
    assert.deepEqual(trace.summary, {
      count: 3,
      total_result_bytes: 31,
      trace_complete: true,
    });
  });

  void it('round-trips fusion_web_fetch audit metadata without raw page content', () => {
    const pageContent = 'PAGE CONTENT MUST NOT BE STORED';
    const bytes = Buffer.from(
      toolLogLine(0, {
        tool_name: FUSION_WEB_FETCH_TOOL_NAME,
        result_bytes: 123,
        result_sha256: 'c'.repeat(64),
        url: 'https://example.com/start',
        final_url: 'https://example.com/final',
        http_status: 200,
        response_bytes: 456,
        content_sha256: 'd'.repeat(64),
      }),
      'utf8',
    );
    assert.doesNotMatch(bytes.toString('utf8'), new RegExp(pageContent));
    const trace = parseFusionToolCallLog(bytes);
    const record = trace.records[0];
    assert.equal(record?.tool_name, FUSION_WEB_FETCH_TOOL_NAME);
    assert.equal(record?.url, 'https://example.com/start');
    assert.equal(record?.final_url, 'https://example.com/final');
    assert.equal(record?.http_status, 200);
    assert.equal(record?.response_bytes, 456);
    assert.equal(record?.content_sha256, 'd'.repeat(64));
  });

  void it('rejects a trailing partial tool-log line loudly', () => {
    assert.throws(
      () => parseFusionToolCallLog(Buffer.from(`${toolLogLine(0)}{"schema_version"`, 'utf8')),
      /trailing partial line/,
    );
  });

  void it('rejects tool-log ordinal gaps loudly', () => {
    assert.throws(
      () => parseFusionToolCallLog(Buffer.from(toolLogLine(0) + toolLogLine(2), 'utf8')),
      /ordinal gap: expected 1, observed 2/,
    );
  });

  void it('rejects duplicate tool-log ordinals loudly', () => {
    assert.throws(
      () => parseFusionToolCallLog(Buffer.from(toolLogLine(0) + toolLogLine(0), 'utf8')),
      /duplicate ordinal 0/,
    );
  });

  void it('rejects wrong tool-log schema versions loudly', () => {
    assert.throws(
      () =>
        parseFusionToolCallLog(
          Buffer.from(toolLogLine(0, { schema_version: 'wrong.schema' }), 'utf8'),
        ),
      /schema_version mismatch/,
    );
  });

  void it('logs completed tool calls without raw arguments or results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-extension-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      // Minimal structurally-typed stub. `ExtensionAPI['on']` is a large overload set, so a
      // local recorder interface is declared instead of double-asserting the whole API: the
      // child extension only ever calls `pi.on(name, handler)`.
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: { isIdle(): boolean },
      ) => unknown;
      interface HandlerRecorder {
        on(event: string, handler: RecordedHandler): void;
      }
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder: HandlerRecorder = {
        on(event, handler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as HandlerRecorder & FusionChildPi);
      const toolCall = handlers.get('tool_call')?.[0];
      const toolResult = handlers.get('tool_result')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(toolCall);
      assert.ok(toolResult);
      assert.equal(handlers.get('agent_end'), undefined);
      assert.ok(agentSettled);
      const secret = 'SECRET_TOKEN_SHOULD_NOT_BE_IN_LOG';
      toolCall(
        { toolCallId: 'call-1', toolName: 'read', input: { path: secret } },
        fusionExtensionEventContext,
      );
      toolResult({
        toolCallId: 'call-1',
        toolName: 'read',
        input: { path: secret },
        content: [{ type: 'text', text: `file contents ${secret}` }],
        details: { echoed: secret },
        isError: true,
        usage: piUsage(0, 0),
      });
      agentSettled({}, { isIdle: () => true });
      const bytes = await readFile(logPath);
      assert.doesNotMatch(bytes.toString('utf8'), new RegExp(secret));
      const trace = parseFusionToolCallLog(bytes);
      assert.equal(trace.summary.count, 1);
      assert.equal(trace.records[0]?.tool_name, 'read');
      assert.equal(trace.records[0]?.status, 'error');
      const seal = JSON.parse(
        await readFile(`${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`, 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(seal['status'], 'complete');
      assert.equal(seal['record_count'], 1);
      assert.equal(seal['total_result_bytes'], trace.summary.total_result_bytes);
      assert.equal(seal['log_sha256'], createHash('sha256').update(bytes).digest('hex'));
    } finally {
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('waits through repeated low-level agent endings and seals the complete 46-call audit only at settlement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-agent-settled-audit-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      const sealPath = `${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`;
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: { isIdle(): boolean },
      ) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const toolCall = handlers.get('tool_call')?.[0];
      const toolResult = handlers.get('tool_result')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(toolCall);
      assert.ok(toolResult);
      assert.ok(agentSettled);
      assert.equal(handlers.get('agent_end'), undefined);

      const appendRange = (start: number, end: number): void => {
        for (let ordinal = start; ordinal < end; ordinal += 1) {
          const toolCallId = `call-${String(ordinal)}`;
          toolCall(
            { toolCallId, toolName: 'read', input: { path: `file-${String(ordinal)}` } },
            fusionExtensionEventContext,
          );
          toolResult({
            toolCallId,
            toolName: 'read',
            input: { path: `file-${String(ordinal)}` },
            content: [{ type: 'text', text: `result-${String(ordinal)}` }],
            details: {},
            isError: false,
            usage: piUsage(0, 0),
          });
        }
      };

      appendRange(0, 22);
      assert.equal(existsSync(sealPath), false, 'agent_end boundaries must not publish a seal');
      appendRange(22, 46);
      assert.equal(existsSync(sealPath), false, 'the journal must remain open until settlement');
      agentSettled({}, { isIdle: () => true });

      const bytes = await readFile(logPath);
      const trace = parseFusionToolCallLog(bytes);
      assert.equal(trace.summary.count, 46);
      assert.deepEqual(
        trace.records.map((record) => record.ordinal),
        Array.from({ length: 46 }, (_value, ordinal) => ordinal),
      );
      const seal = JSON.parse(await readFile(sealPath, 'utf8')) as Record<string, unknown>;
      assert.equal(seal['status'], 'complete');
      assert.equal(seal['record_count'], 46);
      assert.equal(seal['total_result_bytes'], trace.summary.total_result_bytes);
      assert.equal(seal['log_sha256'], createHash('sha256').update(bytes).digest('hex'));
      await assert.rejects(
        Promise.resolve(
          toolCall(
            {
              toolCallId: 'late-call',
              toolName: 'read',
              input: { path: 'late' },
            },
            fusionExtensionEventContext,
          ),
        ),
        /received tool_call while sealed-complete/,
      );
      assert.throws(
        () => agentSettled({}, { isIdle: () => true }),
        /duplicate finalization.*sealed-complete/,
      );
      assert.equal(process.exitCode, 1, 'duplicate settlement must latch process failure');
      assert.equal(
        (JSON.parse(await readFile(sealPath, 'utf8')) as Record<string, unknown>)['record_count'],
        46,
        'duplicate settlement must not replace the original seal',
      );
    } finally {
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('writes failed evidence and latches process failure when shutdown precedes settlement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-unsettled-audit-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (event: Record<string, unknown>) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      assert.throws(
        () => handlers.get('session_shutdown')?.[0]?.({}),
        /finalized as failed from session_shutdown before agent_settled/,
      );
      assert.equal(process.exitCode, 1);
      const seal = JSON.parse(
        await readFile(`${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`, 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(seal['status'], 'failed');
      assert.equal(seal['record_count'], 0);
    } finally {
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('seals unmatched tool starts as failed evidence at settlement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-unmatched-audit-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: { isIdle(): boolean },
      ) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      handlers.get('tool_call')?.[0]?.(
        {
          toolCallId: 'unfinished',
          toolName: 'read',
          input: { path: 'unfinished' },
        },
        fusionExtensionEventContext,
      );
      assert.throws(
        () => handlers.get('agent_settled')?.[0]?.({}, { isIdle: () => true }),
        /1 unmatched tool start/,
      );
      assert.equal(process.exitCode, 1);
      const seal = JSON.parse(
        await readFile(`${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`, 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(seal['status'], 'failed');
      assert.equal(seal['record_count'], 0);
    } finally {
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('refuses a pre-existing audit log before registering lifecycle handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-existing-audit-'));
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      await writeFile(logPath, 'untrusted history\n', 'utf8');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      const recorder = { on() {} };
      assert.throws(
        () => fusionChildExtension(recorder as typeof recorder & FusionChildPi),
        (error: unknown) => {
          assert.equal(
            typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined,
            'EEXIST',
          );
          return true;
        },
      );
      assert.equal(process.exitCode, 1);
      assert.equal(await readFile(logPath, 'utf8'), 'untrusted history\n');
    } finally {
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('rejects undeclared fusion_web_fetch before network and audits only the attempted URL hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-fetch-policy-'));
    const oldLogPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldResearchEnabled = process.env[FUSION_RESEARCH_ENABLED_ENV];
    const oldPolicyPath = process.env[FUSION_SOURCE_POLICY_PATH_ENV];
    const oldPolicyHash = process.env[FUSION_SOURCE_POLICY_SHA256_ENV];
    try {
      const logPath = join(root, 'tool-calls.jsonl');
      const policy = buildFusionSourcePolicy(root, [
        {
          url: 'https://example.com/allowed',
          canonical_url: 'https://example.com/allowed',
          purpose: 'declared',
          sha256: createHash('sha256')
            .update('https://example.com/allowed\u0000declared')
            .digest('hex'),
        },
      ]);
      const policyBytes = sourcePolicyCanonicalBytes(policy);
      const policyPath = join(root, 'source-policy.json');
      await writeFile(policyPath, policyBytes, 'utf8');
      process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = logPath;
      process.env[FUSION_RESEARCH_ENABLED_ENV] = '1';
      process.env[FUSION_SOURCE_POLICY_PATH_ENV] = policyPath;
      process.env[FUSION_SOURCE_POLICY_SHA256_ENV] = createHash('sha256')
        .update(policyBytes)
        .digest('hex');

      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: Record<string, unknown>,
      ) => unknown;
      interface RegisteredTool {
        name: string;
        prepareArguments(args: unknown): unknown;
        execute(
          toolCallId: string,
          params: { url: string; extract?: 'text' | 'markdown' },
        ): Promise<unknown>;
      }
      const handlers = new Map<string, RecordedHandler[]>();
      let registered: RegisteredTool | undefined;
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
        registerTool(tool: RegisteredTool) {
          registered = tool;
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      assert.equal(registered?.name, FUSION_WEB_FETCH_TOOL_NAME);
      assert.throws(
        () =>
          registered?.prepareArguments({
            url: 'https://example.com/allowed',
            prompt: 'extract secret',
          }),
        /url and optional extract only/,
      );

      const attemptedUrl = 'https://example.com/undeclared?private=SHOULD_NOT_LEAK';
      handlers.get('tool_call')?.[0]?.(
        {
          toolCallId: 'fetch-1',
          toolName: FUSION_WEB_FETCH_TOOL_NAME,
          input: { url: attemptedUrl },
        },
        fusionExtensionEventContext,
      );
      await assert.rejects(
        () => registered?.execute('fetch-1', { url: attemptedUrl }) ?? Promise.resolve(),
        /URL was not declared/,
      );
      handlers.get('tool_result')?.[0]?.({
        toolCallId: 'fetch-1',
        toolName: FUSION_WEB_FETCH_TOOL_NAME,
        input: { url: attemptedUrl },
        content: [{ type: 'text', text: 'tool failed' }],
        details: {},
        isError: true,
        usage: piUsage(0, 0),
      });

      const bytes = await readFile(logPath);
      assert.doesNotMatch(bytes.toString('utf8'), /SHOULD_NOT_LEAK|undeclared/);
      const trace = parseFusionToolCallLog(bytes);
      const record = trace.records[0];
      assert.equal(record?.tool_name, FUSION_WEB_FETCH_TOOL_NAME);
      assert.equal(record?.status, 'error');
      assert.equal(record?.url, undefined);
      assert.equal(
        record?.rejected_url_sha256,
        createHash('sha256').update(attemptedUrl).digest('hex'),
      );
    } finally {
      if (oldLogPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldLogPath;
      if (oldResearchEnabled === undefined) delete process.env[FUSION_RESEARCH_ENABLED_ENV];
      else process.env[FUSION_RESEARCH_ENABLED_ENV] = oldResearchEnabled;
      if (oldPolicyPath === undefined) delete process.env[FUSION_SOURCE_POLICY_PATH_ENV];
      else process.env[FUSION_SOURCE_POLICY_PATH_ENV] = oldPolicyPath;
      if (oldPolicyHash === undefined) delete process.env[FUSION_SOURCE_POLICY_SHA256_ENV];
      else process.env[FUSION_SOURCE_POLICY_SHA256_ENV] = oldPolicyHash;
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('keeps reasoning and full response text out of compact child metadata', () => {
    const record = buildFusionChildResultMetadata(
      {
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
      },
      cacheObservation('openai-codex'),
    );
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
      env: { PI_SESSION_FILE: 'old', ANTHROPIC_API_KEY: 'metered-key' },
    });
    await tick();
    const record = harness.records[0];
    assert.ok(record, 'spawn record exists');
    assert.equal(record.command, 'pi');
    assert.equal(record.options.shell, false);
    assert.deepEqual(record.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(record.options.env?.['PI_SESSION_FILE'], undefined);
    assert.equal(record.options.env?.['ANTHROPIC_API_KEY'], undefined);
    assert.equal(record.options.env?.[FUSION_TOOL_CALL_LOG_PATH_ENV], undefined);
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
    assert.equal(result.events.toString('utf8').split('\n').filter(Boolean).length, 3);
    assert.match(result.events.toString('utf8'), /fusion-child-settlement\.v3/);
    assert.doesNotMatch(result.events.toString('utf8'), /final héllo/);
  });

  void it('passes tool-call audit env vars only for tool-enabled children', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-env-'));
    try {
      const child = new FakeChild(778);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      const record = harness.records[0];
      assert.ok(record);
      assert.equal(record.options.env?.[FUSION_TOOL_CALL_LOG_PATH_ENV], logPath);
      assert.equal(record.options.env?.[FUSION_RESEARCH_ENABLED_ENV], undefined);
      // The real child extension creates this file at startup before tools can run. This
      // fake child never loads the extension, so the empty-but-present log is written here
      // to model a genuine zero-tool-call inspect run. An ABSENT file is a different case
      // and must fail loudly - covered by the missing-log test below.
      await writeFile(logPath, '');
      await writeToolCallSeal(logPath);
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      const result = await run;
      assert.deepEqual(result.toolCallTrace?.summary, {
        count: 0,
        total_result_bytes: 0,
        trace_complete: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('passes the research env var only for research children', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-research-env-'));
    try {
      const child = new FakeChild(782);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const policy = buildFusionSourcePolicy(root, []);
      const policyPath = join(root, 'source-policy.json');
      const policyBytes = sourcePolicyCanonicalBytes(policy);
      await writeFile(policyPath, policyBytes);
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'research',
        toolCallLogPath: logPath,
        sourcePolicy: {
          path: policyPath,
          sha256: createHash('sha256').update(policyBytes).digest('hex'),
        },
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      const record = harness.records[0];
      assert.ok(record);
      assert.equal(record.options.env?.[FUSION_TOOL_CALL_LOG_PATH_ENV], logPath);
      assert.equal(record.options.env?.[FUSION_RESEARCH_ENABLED_ENV], '1');
      assert.equal(record.options.env?.['PI_FUSION_SOURCE_POLICY_PATH'], policyPath);
      await writeFile(logPath, '');
      await writeToolCallSeal(logPath);
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      const result = await run;
      assert.equal(result.toolCallTrace?.summary.count, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails inspect children loudly when their tool-call log was never created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-missing-'));
    try {
      const child = new FakeChild(781);
      const harness = makeSpawn(child);
      // Deliberately never create the log: this models a child whose audit trail was never
      // established. It must be distinguishable from a child that legitimately made zero
      // tool calls, otherwise an unrecorded run could report success.
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_event_invalid');
        assert.match(error.message, /never initialized its audit trail/);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails a syntactically complete tool log without its terminal audit seal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-unsealed-'));
    try {
      const child = new FakeChild(785);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      await writeFile(logPath, '');
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, /audit completion seal is missing/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('independently enforces the tool-call count from the sealed log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-count-limit-'));
    try {
      const child = new FakeChild(785);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      const lines = Array.from(
        { length: FUSION_CHILD_MAX_TOOL_CALLS + 1 },
        (_unused, ordinal) => toolLogLine(ordinal, { result_bytes: 1 }),
      ).join('');
      await writeFile(logPath, lines, 'utf8');
      await writeToolCallSeal(logPath);
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, /exceeds tool-call limit 600/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('independently enforces the aggregate tool-result limit from the sealed log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-limit-'));
    try {
      const child = new FakeChild(786);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      await writeFile(
        logPath,
        toolLogLine(0, { result_bytes: FUSION_CHILD_MAX_TOTAL_TOOL_RESULT_BYTES + 1 }),
        'utf8',
      );
      await writeToolCallSeal(logPath);
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, /exceeds aggregate result-byte limit/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('rejects every completion-seal integrity mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-seal-mismatch-'));
    try {
      const cases = [
        { key: 'status', value: 'failed', expected: /reports a failed audit/ },
        { key: 'record_count', value: 1, expected: /record count mismatch/ },
        { key: 'total_result_bytes', value: 1, expected: /result-byte total mismatch/ },
        { key: 'log_sha256', value: '0'.repeat(64), expected: /log hash mismatch/ },
      ] as const;
      for (const [index, item] of cases.entries()) {
        const child = new FakeChild(790 + index);
        const harness = makeSpawn(child);
        const logPath = join(root, `candidate-${String(index)}.tool-calls.jsonl`);
        const run = runPiChild({
          stage: 'candidate',
          slot: 1,
          attempt: 1,
          cwd: root,
          model: resolvedModel(),
          capability: 'inspect',
          toolCallLogPath: logPath,
          systemPrompt: 'system prompt',
          userPrompt: 'prompt',
          spawn: harness.spawn,
          platform: 'linux',
        });
        await tick();
        await writeFile(logPath, '');
        await writeToolCallSeal(logPath);
        const sealPath = `${logPath}${FUSION_TOOL_CALL_SEAL_SUFFIX}`;
        const seal = JSON.parse(await readFile(sealPath, 'utf8')) as Record<string, unknown>;
        seal[item.key] = item.value;
        await writeFile(sealPath, `${JSON.stringify(seal)}\n`, 'utf8');
        child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
        child.stderr.emitData(compactMetadata());
        child.close(0, null);
        await assert.rejects(run, item.expected);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails tool-enabled children when the durable audit names a non-allowlisted tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-allowlist-'));
    try {
      const child = new FakeChild(783);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      await writeFile(logPath, toolLogLine(0, { tool_name: 'bash' }), 'utf8');
      await writeToolCallSeal(logPath);
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_event_invalid');
        assert.match(error.message, /non-allowlisted tool bash/);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails research children when a successful fetch audit URL was not declared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-source-policy-'));
    try {
      const child = new FakeChild(784);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const policy = buildFusionSourcePolicy(root, []);
      const policyPath = join(root, 'source-policy.json');
      const policyBytes = sourcePolicyCanonicalBytes(policy);
      await writeFile(policyPath, policyBytes, 'utf8');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'research',
        toolCallLogPath: logPath,
        sourcePolicy: {
          path: policyPath,
          sha256: createHash('sha256').update(policyBytes).digest('hex'),
        },
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      await writeFile(
        logPath,
        toolLogLine(0, {
          tool_name: FUSION_WEB_FETCH_TOOL_NAME,
          url: 'https://example.com/not-declared',
        }),
        'utf8',
      );
      await writeToolCallSeal(logPath);
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_event_invalid');
        assert.match(error.message, /URL was not declared/);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails inspect children loudly when their tool-call log is partial', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-tool-log-partial-'));
    try {
      const child = new FakeChild(779);
      const harness = makeSpawn(child);
      const logPath = join(root, 'candidate-1.attempt-1.tool-calls.jsonl');
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        capability: 'inspect',
        toolCallLogPath: logPath,
        systemPrompt: 'system prompt',
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'linux',
      });
      await tick();
      await writeFile(logPath, `${toolLogLine(0)}{"schema_version"`, 'utf8');
      child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
      child.stderr.emitData(compactMetadata());
      child.close(0, null);
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_event_invalid');
        assert.match(error.message, /tool-call log invalid: .*trailing partial line/);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('fails stalled children with child_timeout and terminates them', async () => {
    const child = new FakeChild(515);
    const harness = makeSpawn(child);
    const run = runPiChild({
      stage: 'candidate',
      slot: 1,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'win32',
      idleTimeoutMs: 20,
      timeoutMs: 1000,
      killGraceMs: 10,
      sigkillWaitMs: 10,
    });
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_timeout');
      assert.match(error.message, /Pi child produced no output for 20ms \(stalled\)/);
      assert.doesNotMatch(error.message, /timed out after 1000ms/);
      return true;
    });
    assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
  });

  void it('resets the stalled-child watchdog on stderr activity and completes successfully', async () => {
    const child = new FakeChild(516);
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
      platform: 'win32',
      idleTimeoutMs: 60,
      timeoutMs: 1000,
      killGraceMs: 10,
      sigkillWaitMs: 10,
    });
    await tick();
    await delay(30);
    child.stderr.emitData('diagnostic one\n');
    await delay(30);
    child.stderr.emitData('diagnostic two\n');
    await delay(30);
    child.stdout.emitData('final héllo\n');
    child.stderr.emitData(compactMetadata());
    child.close(0, null);

    const result = await run;
    assert.equal(result.text, 'final héllo');
    assert.equal(result.stderr.toString('utf8'), 'diagnostic one\ndiagnostic two\n');
    assert.deepEqual(child.killCalls, []);
  });

  void it('keeps the absolute timeout distinct from the stalled-child watchdog', async () => {
    const child = new FakeChild(517);
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
      idleTimeoutMs: 1000,
      timeoutMs: 20,
      killGraceMs: 10,
      sigkillWaitMs: 10,
    });
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_timeout');
      assert.match(error.message, /Pi child timed out after 20ms/);
      assert.doesNotMatch(error.message, /stalled/);
      return true;
    });
    assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL']);
  });

  void it('launches Windows Pi through Node and preserves adversarial argv without a shell', async () => {
    const child = new FakeChild(778);
    const harness = makeSpawn(child);
    const systemPrompt = 'system & echo pwned "%VAR%" C:\\tmp\\space path\\';
    const run = runPiChild({
      stage: 'candidate',
      slot: 1,
      attempt: 1,
      cwd: '/tmp/project',
      model: resolvedModel(),
      systemPrompt,
      userPrompt: 'user prompt',
      spawn: harness.spawn,
      platform: 'win32',
      childExtensionPath: '/tmp/fusion-child.js',
    });
    await tick();
    const record = harness.records[0];
    assert.ok(record, 'spawn record exists');
    assert.equal(record.command, process.execPath);
    assert.equal(record.options.shell, false);
    assert.equal(record.options.detached, false);
    assert.ok(record.args[0]?.endsWith('cli.js'));
    const systemPromptIndex = record.args.indexOf('--system-prompt');
    assert.ok(systemPromptIndex >= 0);
    assert.equal(record.args[systemPromptIndex + 1], systemPrompt);
    assert.equal(Buffer.concat(child.stdin.chunks).toString('utf8'), 'user prompt');

    child.stdout.emitData(Buffer.from('final héllo\n', 'utf8'));
    child.stderr.emitData(compactMetadata());
    child.close(0, null);
    const result = await run;
    assert.equal(result.text, 'final héllo');
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

  void it('fails before spawn when Windows Pi launch resolution fails', async () => {
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
        platform: 'win32',
        piLaunchDependencies: {
          resolvePackageJson: () => {
            throw new Error('missing package');
          },
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /pi_executable_resolution_failed/);
        assert.equal(Reflect.get(error, 'childCreated'), false);
        return true;
      },
    );
    assert.equal(harness.records.length, 0);
  });

  void it('fails before spawn when Windows Pi argv exceeds the command line limit', async () => {
    const harness = makeSpawn();
    await assert.rejects(
      runPiChild({
        stage: 'merge',
        attempt: 1,
        cwd: '/tmp/project',
        model: resolvedModel(),
        systemPrompt: 'x'.repeat(40000),
        userPrompt: 'prompt',
        spawn: harness.spawn,
        platform: 'win32',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /pi_command_line_too_long/);
        assert.equal(Reflect.get(error, 'childCreated'), false);
        return true;
      },
    );
    assert.equal(harness.records.length, 0);
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

  void it('accepts a multi-message tool loop and sums usage across all records', () => {
    const stderr = Buffer.from(
      withSettlement(
        compactFrame({
          provider: 'p',
          model: 'm',
          text: 'tool request 1',
          stopReason: 'toolUse',
          requestOrdinal: 1,
          usage: piUsage(1, 2, 3),
        }) +
          compactFrame({
            provider: 'p',
            model: 'm',
            text: 'tool request 2',
            stopReason: 'toolUse',
            requestOrdinal: 2,
            usage: piUsage(4, 5, 9),
          }) +
          compactFrame({
            provider: 'p',
            model: 'm',
            text: 'final answer',
            stopReason: 'stop',
            requestOrdinal: 3,
            usage: piUsage(6, 7, 13),
          }),
      ),
      'utf8',
    );

    const parsed = new FusionPiCompactResultParser('p', 'm').finish(
      Buffer.from('final answer\n', 'utf8'),
      stderr,
    );

    assert.equal(parsed.text, 'final answer');
    assert.equal(parsed.usage.input, 11);
    assert.equal(parsed.usage.output, 14);
    assert.equal(parsed.usage.totalTokens, 25);
    assert.equal(parsed.firstRequestUsage.input, 1);
    assert.equal(parsed.firstRequestUsage.output, 2);
    assert.equal(parsed.providerRequestCount, 3);
  });

  void it('accepts a settled zero-usage provider retry marker bound to the terminal metadata stream', () => {
    const retry = buildFusionChildResultMetadata(
      {
        provider: 'p',
        model: 'm',
        stopReason: 'error',
        content: [],
        usage: piUsage(0, 0, 0),
      },
      cacheObservation('p', 1),
    );
    const final = buildFusionChildResultMetadata(
      {
        provider: 'p',
        model: 'm',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'recovered answer' }],
        usage: piUsage(6, 7, 13),
      },
      cacheObservation('p', 2),
    );
    const frames =
      `${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(retry)}\n` +
      `${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(final)}\n`;
    const stderr = Buffer.from(withSettlement(frames), 'utf8');
    const settlement = parseFusionChildSettlement(stderr);
    assert.ok(settlement);
    assert.equal(settlement.status, 'complete');
    assert.deepEqual(settlement.recovered_error_ordinals, [0]);
    const parsed = new FusionPiCompactResultParser('p', 'm').finish(
      Buffer.from('recovered answer\n', 'utf8'),
      stderr,
    );
    assert.equal(parsed.text, 'recovered answer');
    assert.equal(parsed.usage.totalTokens, 13);

    const tamperedSettlement = { ...settlement, recovered_error_ordinals: [] };
    const tampered = Buffer.from(
      `${frames}${FUSION_CHILD_SETTLEMENT_PREFIX}${JSON.stringify(tamperedSettlement)}\n`,
      'utf8',
    );
    assert.throws(
      () =>
        new FusionPiCompactResultParser('p', 'm').finish(
          Buffer.from('recovered answer\n', 'utf8'),
          tampered,
        ),
      /settlement does not match the metadata stream/,
    );
    assert.throws(
      () =>
        parseFusionChildSettlement(
          Buffer.from(
            `${withSettlement(frames)}${FUSION_CHILD_SETTLEMENT_PREFIX}${JSON.stringify(settlement)}\n`,
            'utf8',
          ),
        ),
      /multiple settlement frames/,
    );
    assert.throws(
      () =>
        parseFusionChildStderr(
          Buffer.from(
            `${FUSION_CHILD_SETTLEMENT_PREFIX}${JSON.stringify(settlement)}\n${frames}`,
            'utf8',
          ),
        ),
      /result metadata after terminal settlement/,
    );
  });

  void it('publishes exactly one terminal settlement from the actual agent_settled hook', async () => {
    const oldPath = process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
    const oldExitCode = process.exitCode;
    const originalWrite = process.stderr.write;
    const stderrChunks: Buffer[] = [];
    try {
      delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      process.stderr.write = ((
        chunk: Uint8Array | string,
        encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void,
      ): boolean => {
        stderrChunks.push(
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
        );
        const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        done?.(null);
        return true;
      }) as typeof process.stderr.write;

      type FusionChildPi = Parameters<typeof fusionChildExtension>[0];
      type RecordedHandler = (
        event: Record<string, unknown>,
        context?: Record<string, unknown>,
      ) => unknown;
      const handlers = new Map<string, RecordedHandler[]>();
      const recorder = {
        on(event: string, handler: RecordedHandler) {
          const existing = handlers.get(event) ?? [];
          existing.push(handler);
          handlers.set(event, existing);
        },
      };
      fusionChildExtension(recorder as typeof recorder & FusionChildPi);
      const beforeProvider = handlers.get('before_provider_request')?.[0];
      const messageEnd = handlers.get('message_end')?.[0];
      const agentSettled = handlers.get('agent_settled')?.[0];
      assert.ok(beforeProvider);
      assert.ok(messageEnd);
      assert.ok(agentSettled);
      let aborts = 0;
      const providerContext = {
        abort: () => {
          aborts += 1;
        },
        model: {
          provider: 'p',
          id: 'm',
          contextWindow: 100_000,
          maxTokens: 32_768,
        },
      };
      await Promise.resolve(
        beforeProvider({ payload: { input: 'x '.repeat(300_000) } }, providerContext),
      );
      assert.equal(aborts, 0, 'BUG-185 large stable payload must continue to provider handling');
      await Promise.resolve(
        messageEnd({
          message: {
            role: 'assistant',
            provider: 'p',
            model: 'm',
            stopReason: 'error',
            content: [],
            usage: piUsage(0, 0, 0),
          },
        }),
      );
      await Promise.resolve(beforeProvider({ payload: { input: 'final' } }, providerContext));
      await Promise.resolve(
        messageEnd({
          message: {
            role: 'assistant',
            provider: 'p',
            model: 'm',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'recovered answer' }],
            usage: piUsage(6, 7, 13),
          },
        }),
      );
      await Promise.resolve(agentSettled({}, { isIdle: () => true }));

      const stderr = Buffer.concat(stderrChunks);
      const settlement = parseFusionChildSettlement(stderr);
      assert.ok(settlement);
      assert.equal(settlement.status, 'complete');
      assert.deepEqual(settlement.recovered_error_ordinals, [0]);
      const parsed = new FusionPiCompactResultParser('p', 'm').finish(
        Buffer.from('recovered answer\n', 'utf8'),
        stderr,
      );
      assert.equal(parsed.text, 'recovered answer');
      await assert.rejects(
        Promise.resolve(agentSettled({}, { isIdle: () => true })),
        /duplicate agent_settled/,
      );
      assert.equal(process.exitCode, 1);
      assert.equal(
        Buffer.concat(stderrChunks).toString('utf8').split(FUSION_CHILD_SETTLEMENT_PREFIX).length -
          1,
        1,
      );
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = oldExitCode;
      if (oldPath === undefined) delete process.env[FUSION_TOOL_CALL_LOG_PATH_ENV];
      else process.env[FUSION_TOOL_CALL_LOG_PATH_ENV] = oldPath;
    }
  });

  void it('rejects child extension diagnostics even when compact metadata and final text are valid', () => {
    const stderr = Buffer.from(
      withSettlement(
        `Extension error (/tmp/fusion-child.ts): audit failed\n${compactFrame({
          provider: 'p',
          model: 'm',
          text: 'final answer',
          stopReason: 'stop',
          usage: piUsage(1, 1, 2),
        })}`,
      ),
      'utf8',
    );
    assert.throws(
      () =>
        new FusionPiCompactResultParser('p', 'm').finish(
          Buffer.from('final answer\n', 'utf8'),
          stderr,
        ),
      /reported an extension error diagnostic/,
    );
  });

  void it('rejects invalid transcript stop reasons loudly', () => {
    const parser = new FusionPiCompactResultParser('p', 'm');
    let requestOrdinal = 0;
    const frame = (stopReason: string, text = stopReason): string =>
      compactFrame({
        provider: 'p',
        model: 'm',
        text,
        stopReason,
        requestOrdinal: (requestOrdinal += 1),
        usage: piUsage(1, 1, 2),
      });
    const finish = (frames: string): void => {
      parser.finish(Buffer.from('final\n', 'utf8'), Buffer.from(withSettlement(frames), 'utf8'));
    };

    assert.throws(
      () => finish(frame('stop', 'early') + frame('stop', 'final')),
      /non-final record 0 stop reason.*: stop/,
    );
    assert.throws(
      () => finish(frame('length', 'early') + frame('stop', 'final')),
      /non-final record 0 stop reason.*: length .*truncated/,
    );
    assert.throws(
      () => finish(frame('toolUse', 'early') + frame('toolUse', 'final')),
      /final stop reason is not stop: toolUse/,
    );
    assert.throws(
      () => finish(frame('error', 'early') + frame('stop', 'final')),
      /non-final record 0 stop reason.*: error .*error stop/,
    );
    assert.throws(
      () => finish(frame('toolUse', 'early') + frame('error', 'final')),
      /final stop reason is not stop: error \(Pi reported an error stop\)/,
    );
    assert.throws(
      () => finish(frame('aborted', 'early') + frame('stop', 'final')),
      /non-final record 0 stop reason.*: aborted .*aborted stop/,
    );
    assert.throws(
      () => finish(frame('toolUse', 'early') + frame('aborted', 'final')),
      /final stop reason is not stop: aborted \(Pi reported an aborted stop\)/,
    );
    assert.throws(
      () => finish(frame('pending', 'early') + frame('stop', 'final')),
      /non-final record 0 stop reason.*: pending .*pending stop/,
    );
  });

  void it('reconstructs multiple print-mode text blocks without compacting the final answer', () => {
    const record = buildFusionChildResultMetadata(
      {
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
      },
      cacheObservation('p'),
    );
    const stderr = Buffer.from(
      withSettlement(`${FUSION_CHILD_RESULT_PREFIX}${JSON.stringify(record)}\n`),
      'utf8',
    );
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
    assert.throws(
      () => parser.finish(Buffer.from('x\n'), Buffer.from(withSettlement(nonStop))),
      /not stop/,
    );

    const mismatch = compactFrame({
      provider: 'p',
      model: 'other',
      text: 'x',
      stopReason: 'stop',
      usage,
    });
    assert.throws(
      () => parser.finish(Buffer.from('x\n'), Buffer.from(withSettlement(mismatch))),
      /model mismatch/,
    );

    const valid = compactFrame({
      provider: 'p',
      model: 'm',
      text: 'expected',
      stopReason: 'stop',
      usage,
    });
    assert.throws(
      () => parser.finish(Buffer.from('tampered\n'), Buffer.from(withSettlement(valid))),
      /hash mismatch/,
    );
    assert.throws(
      () => parser.finish(Buffer.from('x\n'), Buffer.alloc(0)),
      /no terminal result settlement/,
    );
    assert.throws(
      () => parser.finish(Buffer.from('expected\n'), Buffer.from(valid)),
      /no terminal result settlement/,
    );
    assert.throws(
      () => parseFusionChildStderr(Buffer.from(`${FUSION_CHILD_RESULT_PREFIX}{}`)),
      /newline-terminated/,
    );
  });

  void it('verifies and returns a same-session compressed candidate plus its original artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-output-recovery-parent-'));
    try {
      const original = 'x'.repeat(FUSION_CANDIDATE_MAX_OUTPUT_BYTES);
      const replacement = 'compact final';
      const recoveryPath = join(root, 'candidate.response.oversized.md');
      await writeFile(recoveryPath, original, 'utf8');
      const frames =
        compactFrame({
          text: original,
          stopReason: 'stop',
          usage: piUsage(3, 4, 7),
          requestOrdinal: 1,
          candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
          recoveryRole: 'oversized_original',
        }) +
        compactFrame({
          text: replacement,
          stopReason: 'stop',
          usage: piUsage(5, 2, 7),
          requestOrdinal: 2,
          candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
          recoveryRole: 'replacement',
        });
      const child = new FakeChild(700);
      const harness = makeSpawn(child);
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        systemPrompt: 'system',
        userPrompt: 'prompt',
        candidateOutputRecoveryPath: recoveryPath,
        spawn: harness.spawn,
        platform: 'win32',
      });
      await tick();
      child.stdout.emitData(`${replacement}\n`);
      child.stderr.emitData(withSettlement(frames));
      child.close(0, null);
      const result = await run;
      assert.equal(result.text, replacement);
      assert.equal(result.providerRequestCount, 2);
      assert.equal(result.usage.totalTokens, 14);
      assert.deepEqual(result.outputRecovery, {
        kind: 'same_session_compression',
        limit_bytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
        original_record_index: 0,
        replacement_record_index: 1,
        original_json_rendered_bytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES + 2,
        replacement_json_rendered_bytes: Buffer.byteLength(JSON.stringify(replacement), 'utf8'),
        original_text_sha256: createHash('sha256').update(original).digest('hex'),
        original_text: original,
        status: 'completed',
      });
      assert.equal(
        Reflect.get(
          harness.records[0]?.options.env ?? {},
          FUSION_CANDIDATE_OUTPUT_RECOVERY_PATH_ENV,
        ),
        recoveryPath,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('rejects a tampered oversized-original artifact before accepting the replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-output-recovery-tamper-'));
    try {
      const original = 'x'.repeat(FUSION_CANDIDATE_MAX_OUTPUT_BYTES);
      const replacement = 'compact final';
      const recoveryPath = join(root, 'candidate.response.oversized.md');
      await writeFile(recoveryPath, `${original}tampered`, 'utf8');
      const frames =
        compactFrame({
          text: original,
          stopReason: 'stop',
          usage: piUsage(3, 4, 7),
          requestOrdinal: 1,
          candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
          recoveryRole: 'oversized_original',
        }) +
        compactFrame({
          text: replacement,
          stopReason: 'stop',
          usage: piUsage(5, 2, 7),
          requestOrdinal: 2,
          candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
          recoveryRole: 'replacement',
        });
      const child = new FakeChild(703);
      const harness = makeSpawn(child);
      const run = runPiChild({
        stage: 'candidate',
        slot: 1,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        systemPrompt: 'system',
        userPrompt: 'prompt',
        candidateOutputRecoveryPath: recoveryPath,
        spawn: harness.spawn,
        platform: 'win32',
      });
      await tick();
      child.stdout.emitData(`${replacement}\n`);
      child.stderr.emitData(withSettlement(frames));
      child.close(0, null);
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_event_invalid');
        assert.match(error.message, /artifact hash mismatch/);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('hard-fails after one still-oversized replacement and preserves both responses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-output-recovery-failed-'));
    try {
      const original = 'o'.repeat(FUSION_CANDIDATE_MAX_OUTPUT_BYTES);
      const replacement = 'r'.repeat(FUSION_CANDIDATE_MAX_OUTPUT_BYTES);
      const recoveryPath = join(root, 'candidate.response.oversized.md');
      await writeFile(recoveryPath, original, 'utf8');
      const frames =
        compactFrame({
          text: original,
          stopReason: 'stop',
          usage: piUsage(3, 4, 7),
          requestOrdinal: 1,
          candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
          recoveryRole: 'oversized_original',
        }) +
        compactFrame({
          text: replacement,
          stopReason: 'stop',
          usage: piUsage(5, 6, 11),
          requestOrdinal: 2,
          candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
          recoveryRole: 'replacement',
        });
      const child = new FakeChild(701);
      const harness = makeSpawn(child);
      const run = runPiChild({
        stage: 'candidate',
        slot: 2,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        systemPrompt: 'system',
        userPrompt: 'prompt',
        candidateOutputRecoveryPath: recoveryPath,
        spawn: harness.spawn,
        platform: 'win32',
      });
      await tick();
      child.stdout.emitData(`${replacement}\n`);
      child.stderr.emitData(withSettlement(frames));
      child.close(1, null);
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_output_cap');
        assert.match(error.message, /both responses are preserved and nothing was truncated/);
        assert.equal(error.response.toString('utf8'), `${replacement}\n`);
        assert.equal(error.usage.totalTokens, 18);
        const recovery = error.outputRecovery;
        assert.ok(recovery);
        assert.equal(recovery.status, 'failed');
        assert.equal(recovery.original_text, original);
        assert.equal(recovery.replacement_record_index, 1);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('retains a hash-verified oversized original when cancellation interrupts compression', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-output-recovery-cancel-'));
    try {
      const original = 'c'.repeat(FUSION_CANDIDATE_MAX_OUTPUT_BYTES);
      const recoveryPath = join(root, 'candidate.response.oversized.md');
      await writeFile(recoveryPath, original, 'utf8');
      const originalFrame = compactFrame({
        text: original,
        stopReason: 'stop',
        usage: piUsage(3, 4, 7),
        requestOrdinal: 1,
        candidateLimitBytes: FUSION_CANDIDATE_MAX_OUTPUT_BYTES,
        recoveryRole: 'oversized_original',
      });
      const child = new FakeChild(702);
      const harness = makeSpawn(child);
      const controller = new AbortController();
      const run = runPiChild({
        stage: 'candidate',
        slot: 3,
        attempt: 1,
        cwd: root,
        model: resolvedModel(),
        systemPrompt: 'system',
        userPrompt: 'prompt',
        candidateOutputRecoveryPath: recoveryPath,
        signal: controller.signal,
        spawn: harness.spawn,
        platform: 'win32',
        killGraceMs: 20,
        sigkillWaitMs: 20,
      });
      await tick();
      child.stderr.emitData(originalFrame);
      controller.abort();
      child.close(null, 'SIGTERM');
      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof FusionChildRunError);
        assert.equal(error.code, 'child_cancelled');
        const recovery = error.outputRecovery;
        assert.ok(recovery);
        assert.equal(recovery.status, 'failed');
        assert.equal(recovery.replacement_record_index, null);
        assert.equal(recovery.original_text, original);
        return true;
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  void it('surfaces a typed runtime request-limit refusal instead of a generic exit code', async () => {
    const child = new FakeChild(110);
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
      platform: 'win32',
      killGraceMs: 20,
      sigkillWaitMs: 20,
    });
    await tick();
    const guard = evaluateFusionRuntimeRequest({
      payload: { input: 'x '.repeat(300_000) },
      provider: 'openai-codex',
      model: 'gpt-5.5',
      requestOrdinal: FUSION_CHILD_MAX_PROVIDER_REQUESTS + 1,
      toolCallCount: 20,
    });
    assert.ok(guard);
    child.stderr.emitData(
      `${FUSION_RUNTIME_GUARD_PREFIX}${JSON.stringify(guard)}\n${compactMetadata()}`,
    );
    child.close(1, null);
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_runtime_limit_exceeded');
      assert.match(error.message, /provider request 551/);
      assert.equal(error.usage.totalTokens, 21);
      return true;
    });
  });

  void it('surfaces an invalid Claude cache policy distinctly from an execution-limit refusal', async () => {
    const child = new FakeChild(112);
    const harness = makeSpawn(child);
    const model = resolvedModel('anthropic', 'claude-opus-4-8');
    const run = runPiChild({
      stage: 'candidate',
      slot: 1,
      attempt: 1,
      cwd: '/tmp/project',
      model,
      systemPrompt: 'system',
      userPrompt: 'prompt',
      spawn: harness.spawn,
      platform: 'win32',
      killGraceMs: 20,
      sigkillWaitMs: 20,
    });
    await tick();
    const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
    const guard = {
      schema_version: FUSION_RUNTIME_GUARD_SCHEMA_VERSION,
      code: 'claude_cache_policy',
      provider: model.provider,
      model: model.model,
      request_ordinal: 1,
      tool_call_count: 0,
      payload_bytes: 0,
      payload_sha256: emptyHash,
      message: 'fusion child could not apply Claude cache policy',
    };
    child.stderr.emitData(
      `${FUSION_RUNTIME_GUARD_PREFIX}${JSON.stringify(guard)}\n${compactMetadata(model.provider, model.model)}`,
    );
    child.close(1, null);
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof FusionChildRunError);
      assert.equal(error.code, 'child_cache_policy_invalid');
      assert.match(error.message, /could not apply Claude cache policy/);
      return true;
    });
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
