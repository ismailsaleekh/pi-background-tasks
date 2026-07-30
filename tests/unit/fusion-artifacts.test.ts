import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseJsonText } from '../../src/core/common.js';
import { FusionArtifactStore } from '../../src/core/fusion/artifacts.js';
import { defaultFusionModelConfig } from '../../src/core/fusion/config.js';
import type {
  FusionChildRunResult,
  ResolvedFusionModel,
  ResolvedFusionModels,
} from '../../src/core/fusion/types.js';

function resolved(qualifiedId: string): ResolvedFusionModel {
  const slash = qualifiedId.indexOf('/');
  const provider = qualifiedId.slice(0, slash);
  const model = qualifiedId.slice(slash + 1);
  return {
    selection: '$current',
    source: 'current',
    provider,
    model,
    qualifiedId,
    thinkingLevel: 'medium',
    contextWindow: 1000,
  };
}

function models(): ResolvedFusionModels {
  return {
    candidates: [resolved('p/a'), resolved('p/b'), resolved('p/c')],
    evaluator: resolved('p/e'),
    merger: resolved('p/m'),
  };
}

function childResult(
  stage: 'candidate' | 'evaluation' | 'merge',
  text: string,
): FusionChildRunResult {
  const result: FusionChildRunResult = {
    stage,
    attempt: 1,
    provider: 'p',
    model: 'a',
    qualifiedId: 'p/a',
    text,
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    },
    events: Buffer.from('{"schema_version":"pi-background-tasks.fusion-child-result.v2"}\n'),
    stderr: Buffer.from('stderr'),
    exitCode: 0,
    signal: null,
  };
  if (stage === 'candidate') result.slot = 1;
  return result;
}

function parseManifest(text: string): object {
  const parsed = parseJsonText(text);
  assert.ok(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed));
  return parsed;
}

function field(record: object, key: string): unknown {
  return Reflect.get(record, key);
}

void describe('fusion artifacts', () => {
  void it('creates private run files and records child attempt artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-artifacts-'));
    try {
      const store = await FusionArtifactStore.create({
        cwd: root,
        sessionId: 'session/id',
        runId: 'f00000000000000000000000000000000',
        source: 'command',
        config: defaultFusionModelConfig(),
        models: models(),
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      });
      assert.match(store.artifactDir.replaceAll('\\', '/'), /^\.pi\/fusion\/session-id-/);
      const dirMode = (await stat(store.artifactDirAbs)).mode & 0o777;
      if (process.platform !== 'win32') assert.equal(dirMode, 0o700);
      await store.writeCanonicalInput('{"request":"x"}');
      await store.transition('candidates_running');
      await store.recordChildAttempt({
        result: childResult('candidate', 'answer'),
        prompt: 'prompt',
        responseKind: 'md',
      });
      const responsePath = join(store.artifactDirAbs, 'candidate-1.attempt-1.response.md');
      assert.equal(await readFile(responsePath, 'utf8'), 'answer');
      if (process.platform !== 'win32')
        assert.equal((await stat(responsePath)).mode & 0o777, 0o600);
      const manifest = parseManifest(
        await readFile(join(store.artifactDirAbs, 'manifest.json'), 'utf8'),
      );
      assert.equal(field(manifest, 'state'), 'candidates_running');
      const attempts = field(manifest, 'attempts');
      assert.ok(Array.isArray(attempts));
      assert.equal(attempts.length, 1);
      const firstAttempt = attempts[0];
      assert.ok(typeof firstAttempt === 'object' && firstAttempt !== null);
      assert.equal(field(firstAttempt, 'response_path'), 'candidate-1.attempt-1.response.md');
      assert.equal(field(firstAttempt, 'provider'), 'p');
      assert.equal(field(firstAttempt, 'qualifiedId'), 'p/a');
      const usageRecord = field(firstAttempt, 'usage');
      assert.ok(typeof usageRecord === 'object' && usageRecord !== null);
      assert.equal(field(usageRecord, 'totalTokens'), 3);
      assert.deepEqual(field(usageRecord, 'cost'), {
        input: 0.01,
        output: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.03,
      });
      assert.deepEqual(
        (await readdir(store.artifactDirAbs)).filter((entry) => entry.endsWith('.tmp')),
        [],
      );
      const artifacts = field(manifest, 'artifacts');
      assert.ok(typeof artifacts === 'object' && artifacts !== null);
      assert.ok(Reflect.has(artifacts, 'canonical-input.json'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('enforces lifecycle ordering and durable merge before completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-state-'));
    try {
      const store = await FusionArtifactStore.create({
        cwd: root,
        runId: 'f11111111111111111111111111111111',
        source: 'tool',
        config: defaultFusionModelConfig(),
        models: models(),
      });
      await assert.rejects(store.transition('evaluating'), /illegal fusion state transition/);
      await store.transition('candidates_running');
      await store.transition('candidates_complete');
      await store.transition('evaluating');
      await store.transition('evaluation_complete');
      await store.transition('merging');
      await assert.rejects(store.transition('completed'), /merged\.md/);
      await store.writeMerged('final');
      await store.transition('completed');
      const manifest = parseManifest(
        await readFile(join(store.artifactDirAbs, 'manifest.json'), 'utf8'),
      );
      assert.equal(field(manifest, 'state'), 'completed');
      assert.equal(await readFile(join(store.artifactDirAbs, 'merged.md'), 'utf8'), 'final');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void it('writes terminal failure evidence loudly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-fusion-failed-'));
    try {
      const store = await FusionArtifactStore.create({
        cwd: root,
        runId: 'f22222222222222222222222222222222',
        source: 'command',
        config: defaultFusionModelConfig(),
        models: models(),
      });
      await store.transition('candidates_running');
      await store.recordFailedAttempt({
        stage: 'candidate',
        slot: 2,
        attempt: 1,
        prompt: 'prompt',
        events: Buffer.from('compact-event'),
        partialResponse: Buffer.from('partial response'),
        stderr: Buffer.from('err'),
        error: 'boom',
        status: 'failed',
        responseKind: 'md',
        provider: 'p',
        model: 'b',
        qualifiedId: 'p/b',
        usage: {
          input: 2,
          output: 3,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
          cost: { input: 0.02, output: 0.03, cacheRead: 0, cacheWrite: 0, total: 0.05 },
        },
      });
      await store.writeError('failed', 'boom');
      assert.ok(existsSync(join(store.artifactDirAbs, 'error.json')));
      const manifest = parseManifest(
        await readFile(join(store.artifactDirAbs, 'manifest.json'), 'utf8'),
      );
      assert.equal(field(manifest, 'state'), 'failed');
      assert.equal(field(manifest, 'error'), 'boom');
      const attempts = field(manifest, 'attempts');
      assert.ok(Array.isArray(attempts));
      const firstAttempt = attempts[0];
      assert.ok(typeof firstAttempt === 'object' && firstAttempt !== null);
      assert.equal(field(firstAttempt, 'status'), 'failed');
      assert.equal(field(firstAttempt, 'response_path'), 'candidate-2.attempt-1.response.md');
      assert.equal(
        field(firstAttempt, 'partial_response_path'),
        'candidate-2.attempt-1.response.partial.md',
      );
      assert.equal(
        await readFile(join(store.artifactDirAbs, 'candidate-2.attempt-1.response.md'), 'utf8'),
        '',
      );
      assert.equal(
        await readFile(
          join(store.artifactDirAbs, 'candidate-2.attempt-1.response.partial.md'),
          'utf8',
        ),
        'partial response',
      );
      assert.equal(field(firstAttempt, 'qualifiedId'), 'p/b');
      const failedUsage = field(firstAttempt, 'usage');
      assert.ok(typeof failedUsage === 'object' && failedUsage !== null);
      assert.equal(field(failedUsage, 'totalTokens'), 5);
      assert.deepEqual(field(failedUsage, 'cost'), {
        input: 0.02,
        output: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.05,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
