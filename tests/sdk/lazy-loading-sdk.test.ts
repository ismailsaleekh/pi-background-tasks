import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
  type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import type { BgTask, DelegateTaskFacts } from '../../src/core/common.js';
import type { DelegateHookContractEvidence } from '../../src/core/delegate/hook-contract.js';
import { prepareDelegateLaunch } from '../../src/core/delegate/runner.js';
import { SynchronousActivationCloseFence } from '../../src/core/lazy-module.js';
import {
  FUSION_RESULT_SCHEMA_VERSION,
  type FusionResultDetails,
  type FusionRunResult,
} from '../../src/core/fusion/types.js';
import {
  registerBackgroundResultExtension,
  registerDelegateExtension,
  type DelegateExtensionRuntime,
} from '../../src/delegate-extension.js';
import {
  registerFusionExtension,
  type FusionExecutionRuntime,
  type FusionModelSelectorRuntime,
} from '../../src/fusion-extension.js';

const roots: string[] = [];

const HOOK_EVIDENCE: DelegateHookContractEvidence = {
  schema_version: 'pi-background-tasks.delegate-hook-contract.v1',
  contract_id: 'context-measure-abort-v1+tool-result-spill-v1',
  guarantees: {
    context_fires_before_every_model_call: true,
    context_result_messages_reach_provider: true,
    context_abort_blocks_provider_call: true,
    context_abort_skips_stream_invocation: false,
    context_abort_terminates_run: true,
    context_throw_blocks_provider_call: false,
    context_throw_isolated_to_throwing_handler: true,
    tool_result_fires_before_transcript_entry: true,
    tool_result_replacement_reaches_provider: true,
    tool_result_replacement_preserves_identity: true,
    tool_result_chains_in_load_order: true,
    handlers_run_in_extension_load_order: true,
  },
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  assert.ok(resolvePromise);
  return { promise, resolve: resolvePromise };
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected rejection');
}

async function settlement(
  promise: Promise<unknown>,
): Promise<{ value: unknown; error?: undefined } | { value?: undefined; error: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

interface Harness {
  readonly session: AgentSession;
  readonly root: string;
  shutdown: boolean;
}

async function harness(factory: ExtensionFactory, mode: 'json' | 'tui' = 'json'): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pi-bg-lazy-sdk-'));
  roots.push(root);
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus: createEventBus(),
    extensionFactories: [factory],
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
  await session.bindExtensions({ mode });
  return { session, root, shutdown: false };
}

function installActivationCloseFence(pi: ExtensionAPI): SynchronousActivationCloseFence {
  const fence = new SynchronousActivationCloseFence();
  pi.on('session_shutdown', () => {
    fence.close();
  });
  return fence;
}

async function close(h: Harness): Promise<void> {
  if (!h.shutdown) {
    h.shutdown = true;
    await h.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  }
  h.session.dispose();
}

function tool(h: Harness, name: string) {
  const found = h.session.getToolDefinition(name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

function command(h: Harness, name: string) {
  const found = h.session.extensionRunner
    .getRegisteredCommands()
    .find((candidate) => candidate.invocationName === name);
  assert.ok(found, `missing command ${name}`);
  return found;
}

function execute(h: Harness, name: string, params: unknown): Promise<unknown> {
  return tool(h, name).execute(
    `lazy-${name}-${Math.random().toString(16).slice(2)}`,
    params,
    undefined,
    undefined,
    h.session.extensionRunner.createContext(),
  );
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${key} parent must be an object`);
  }
  return Reflect.get(value, key);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('condition did not become true');
}

function delegateRuntime(onRun: () => never): DelegateExtensionRuntime {
  return {
    loadDelegateHookContractEvidence: () => HOOK_EVIDENCE,
    resolveDelegateRoute: onRun,
    prepareDelegateLaunch: onRun,
  };
}

function successfulDelegateRuntime(): DelegateExtensionRuntime {
  const budget = {
    family: 'unknown',
    rate_source: {},
  } as DelegateTaskFacts['budget'];
  return {
    loadDelegateHookContractEvidence: () => HOOK_EVIDENCE,
    resolveDelegateRoute: () => ({
      provider: 'fixture',
      model: 'fixture',
      qualified_id: 'fixture/fixture',
      context_window_tokens: 200_000,
      thinking_level: 'off',
      origin: 'parent_current',
    }),
    prepareDelegateLaunch: async () =>
      ({
        preflight: {
          childSessionId: `delegate-${'2'.repeat(32)}`,
          seed: { serialized: '{}' },
          limits: { max_turns: 24, max_tool_calls: 120, timeout_seconds: 1200 },
          plan: {
            child_prompt_utf8_bytes: 2,
            launch_input_tokens_upper_bound: 2,
            route: { allowed_input_tokens: 100_000 },
            retained_growth_budget_tokens: 50_000,
          },
        },
        argv: ['pi'],
        stdinBytes: Buffer.from('{}'),
        env: {},
        facts: {
          taskId: 'fresh-success',
          launchNonce: '0'.repeat(32),
          artifactDir: '.pi/delegate/fresh-success',
          artifactDirAbs: join(tmpdir(), 'fresh-success'),
          seedSha256: '1'.repeat(64),
          childSessionId: `delegate-${'2'.repeat(32)}`,
          route: { provider: 'fixture', model: 'fixture', qualifiedId: 'fixture/fixture' },
          budget,
          extensionMode: 'isolated',
          autoDeliver: 'never',
        },
        rollback: async () => undefined,
      }),
  };
}

function fusionRuntime(onRun: () => never): FusionExecutionRuntime {
  return {
    buildFusionCanonicalInput: onRun,
    buildCleanFusionCanonicalInput: onRun,
    loadFusionModelConfig: onRun,
    resolveFusionModels: onRun,
    orchestrator: { run: onRun },
  };
}

function baseTask(id: string): BgTask {
  return {
    id,
    name: id,
    command: id,
    status: 'completed',
    outputPath: `.pi/tasks/${id}.output`,
    outputAbsPath: join(tmpdir(), `${id}.output`),
    metadataAbsPath: join(tmpdir(), `${id}.json`),
    cwd: tmpdir(),
    startTime: 1,
    endTime: 2,
    bytesWritten: 0,
    isAgent: true,
    surviveReload: false,
    notified: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true,
    terminalPublished: false,
    terminalPublicationState: 'pending',
    terminalPublishAttempts: 0,
    waiters: [],
  };
}

function delegateTask(id: string): BgTask {
  return {
    ...baseTask(id),
    delegate: {
      taskId: id,
      launchNonce: '0'.repeat(32),
      artifactDir: `.pi/delegate/${id}`,
      artifactDirAbs: join(tmpdir(), id),
      seedSha256: '1'.repeat(64),
      childSessionId: `delegate-${'2'.repeat(32)}`,
      route: { provider: 'fixture', model: 'fixture', qualifiedId: 'fixture/fixture' },
      budget: {
        family: 'unknown',
        rate_source: {},
      } as DelegateTaskFacts['budget'],
      extensionMode: 'isolated',
      autoDeliver: 'never',
    },
  };
}

function fusionTask(id: string): BgTask {
  return {
    ...baseTask(id),
    fusion: {
      runId: id,
      workflow: 'reason',
      artifactDir: `.pi/fusion/${id}`,
      artifactDirAbs: join(tmpdir(), id),
      state: 'completed',
      usageDelivered: false,
      outcome: { status: 'committed' },
    },
  };
}

function verifiedFusionRun(runId: string): FusionRunResult {
  const details: FusionResultDetails = {
    schema_version: FUSION_RESULT_SCHEMA_VERSION,
    run_id: runId,
    workflow: 'reason',
    source: 'tool',
    status: 'completed',
    context: { kind: 'session_projection', policy_id: 'lazy-lifecycle-test' },
    tool_policy: { candidate_tools: [], evaluation_tools: [], merge_tools: [] },
    artifact_dir: `.pi/fusion/${runId}`,
    models: {
      candidates: ['fixture/a', 'fixture/b', 'fixture/c'],
      evaluator: 'fixture/evaluator',
      merger: 'fixture/merger',
      thinking_level: 'off',
    },
    evaluator_attempts: 1,
    usage: {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    budget: {
      policy_id: 'lazy-lifecycle-test',
      calibration_version: 'test',
      route_table: [],
      rate_sources: [],
      unknown_provider_warnings: [],
      calibration_warnings: [],
    },
  };
  return { mergedText: 'verified answer', details };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

void describe('lazy delegate/Fusion facades through the real SDK runner', { concurrency: false }, () => {
  void it('registers immediately and single-flights two delegate cold calls without sharing runs', async () => {
    const barrier = deferred<DelegateExtensionRuntime>();
    let imports = 0;
    let runs = 0;
    let starters = 0;
    const h = await harness((pi: ExtensionAPI) => {
      registerDelegateExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startDelegateTask: async () => {
          starters += 1;
          throw new Error('starter must not run in this fixture');
        },
        snapshot: () => {
          throw new Error('snapshot must not run in this fixture');
        },
        isDelegateTaskRegistered: () => false,
        loadHookEvidence: async () => HOOK_EVIDENCE,
        loadRuntime: () => {
          imports += 1;
          return barrier.promise;
        },
      });
    });
    try {
      assert.ok(h.session.getToolDefinition('bg_delegate'), 'schema must register before first use');
      assert.equal(imports, 0);
      const first = execute(h, 'bg_delegate', { name: 'first', prompt: 'first' });
      const second = execute(h, 'bg_delegate', { name: 'second', prompt: 'second' });
      await waitUntil(() => imports === 1);
      assert.equal(runs, 0);
      barrier.resolve(
        delegateRuntime(() => {
          runs += 1;
          throw new Error(`independent-delegate-run-${String(runs)}`);
        }),
      );
      const failures = await Promise.all([rejected(first), rejected(second)]);
      assert.equal(imports, 1);
      assert.equal(runs, 2);
      assert.equal(starters, 0);
      assert.match(String(failures[0]), /independent-delegate-run-/);
      assert.match(String(failures[1]), /independent-delegate-run-/);
    } finally {
      await close(h);
    }
  });

  void it('single-flights two Fusion cold calls while preserving independent run setup', async () => {
    const barrier = deferred<FusionExecutionRuntime>();
    let imports = 0;
    let runs = 0;
    let starters = 0;
    const h = await harness((pi: ExtensionAPI) => {
      registerFusionExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startManagedTask: async () => {
          starters += 1;
          throw new Error('managed starter must not run in this fixture');
        },
        snapshot: () => {
          throw new Error('snapshot must not run in this fixture');
        },
        updateManagedTask: async () => undefined,
        loadExecutionRuntime: () => {
          imports += 1;
          return barrier.promise;
        },
      });
    });
    try {
      for (const name of ['fusion_reason', 'fusion_investigate', 'fusion_research', 'fusion_validate']) {
        assert.ok(h.session.getToolDefinition(name), `${name} schema must register immediately`);
      }
      assert.equal(imports, 0);
      const first = execute(h, 'fusion_reason', { prompt: 'first' });
      const second = execute(h, 'fusion_reason', { prompt: 'second' });
      await waitUntil(() => imports === 1);
      barrier.resolve(
        fusionRuntime(() => {
          runs += 1;
          throw new Error(`independent-fusion-run-${String(runs)}`);
        }),
      );
      const failures = await Promise.all([rejected(first), rejected(second)]);
      assert.equal(imports, 1);
      assert.equal(runs, 2);
      assert.equal(starters, 0);
      assert.match(String(failures[0]), /independent-fusion-run-/);
      assert.match(String(failures[1]), /independent-fusion-run-/);
    } finally {
      await close(h);
    }
  });

  void it('keeps a missing deferred delegate module sticky, then retries in a fresh reload activation', async () => {
    let activations = 0;
    let imports = 0;
    let freshRuns = 0;
    let starters = 0;
    let allowSuccess = false;
    const h = await harness((pi: ExtensionAPI) => {
      activations += 1;
      registerDelegateExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startDelegateTask: async () => {
          starters += 1;
          return baseTask('fresh-success');
        },
        snapshot: (task) => task,
        isDelegateTaskRegistered: () => false,
        loadHookEvidence: async () => HOOK_EVIDENCE,
        loadRuntime: async () => {
          imports += 1;
          if (!allowSuccess) throw new Error(`ERR_MODULE_NOT_FOUND: ${'missing/'.repeat(500)}`);
          freshRuns += 1;
          return successfulDelegateRuntime();
        },
      });
    });
    try {
      const oldTool = tool(h, 'bg_delegate');
      const callOld = () => oldTool.execute(
        'old-call',
        { name: 'missing', prompt: 'missing' },
        undefined,
        undefined,
        h.session.extensionRunner.createContext(),
      );
      const first = await rejected(callOld());
      const second = await rejected(callOld());
      assert.equal(first, second, 'one activation must retain the exact wrapped failure');
      assert.ok(first instanceof Error);
      assert.match(first.message, /lazy_module_load_failed/);
      assert.match(first.message, /delegate-producer/);
      assert.match(first.message, /ERR_MODULE_NOT_FOUND/);
      assert.ok(first.message.length <= 768);
      assert.equal(imports, 1);
      assert.equal(starters, 0);

      allowSuccess = true;
      await h.session.reload();
      assert.equal(activations, 2);
      const stale = await rejected(callOld());
      assert.match(String(stale), /lazy_module_closed/);
      const fresh = await execute(h, 'bg_delegate', { name: 'fresh', prompt: 'fresh' });
      assert.equal(
        field(field(fresh, 'details'), 'schema_version'),
        'pi-background-tasks.delegate-launch.v1',
      );
      assert.equal(imports, 2);
      assert.equal(freshRuns, 1);
      assert.equal(starters, 1);
    } finally {
      await close(h);
    }
  });

  void it('closes before awaiting a blocked import and permits no late delegate side effect', async () => {
    const barrier = deferred<DelegateExtensionRuntime>();
    let imports = 0;
    let runtimeCalls = 0;
    let starters = 0;
    const h = await harness((pi: ExtensionAPI) => {
      registerDelegateExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startDelegateTask: async () => {
          starters += 1;
          throw new Error('late starter');
        },
        snapshot: () => {
          throw new Error('late snapshot');
        },
        isDelegateTaskRegistered: () => false,
        loadHookEvidence: async () => HOOK_EVIDENCE,
        loadRuntime: () => {
          imports += 1;
          return barrier.promise;
        },
      });
    });
    try {
      const pending = execute(h, 'bg_delegate', { name: 'blocked', prompt: 'blocked' });
      await waitUntil(() => imports === 1);
      h.shutdown = true;
      await h.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      barrier.resolve(
        delegateRuntime(() => {
          runtimeCalls += 1;
          throw new Error('late runtime call');
        }),
      );
      const error = await rejected(pending);
      assert.match(String(error), /lazy_module_closed/);
      assert.equal(runtimeCalls, 0);
      assert.equal(starters, 0);
      const postShutdown = await rejected(
        execute(h, 'bg_delegate', { name: 'stale', prompt: 'stale' }),
      );
      assert.equal(error, postShutdown);
    } finally {
      await close(h);
    }
  });

  void it('closes Fusion synchronously before awaiting a blocked import', async () => {
    const barrier = deferred<FusionExecutionRuntime>();
    let imports = 0;
    let runtimeCalls = 0;
    let starters = 0;
    const h = await harness((pi: ExtensionAPI) => {
      registerFusionExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startManagedTask: async () => {
          starters += 1;
          throw new Error('late managed starter');
        },
        snapshot: () => {
          throw new Error('late snapshot');
        },
        updateManagedTask: async () => undefined,
        loadExecutionRuntime: () => {
          imports += 1;
          return barrier.promise;
        },
      });
    });
    try {
      const pending = execute(h, 'fusion_reason', { prompt: 'blocked' });
      await waitUntil(() => imports === 1);
      h.shutdown = true;
      const shutdown = h.session.extensionRunner.emit({
        type: 'session_shutdown',
        reason: 'reload',
      });
      barrier.resolve(
        fusionRuntime(() => {
          runtimeCalls += 1;
          throw new Error('late Fusion runtime call');
        }),
      );
      const [error] = await Promise.all([rejected(pending), shutdown]);
      assert.match(String(error), /lazy_module_closed.*fusion-execution/);
      assert.equal(runtimeCalls, 0);
      assert.equal(starters, 0);
    } finally {
      await close(h);
    }
  });

  void it('dispatches bg_result to only the verifier named by task facts', async () => {
    const tasks = new Map<string, BgTask>([
      ['running-fusion', { ...fusionTask('running-fusion'), status: 'running' }],
      ['terminal-fusion', fusionTask('terminal-fusion')],
      ['terminal-delegate', delegateTask('terminal-delegate')],
    ]);
    let delegateImports = 0;
    let fusionImports = 0;
    let claims = 0;
    const h = await harness((pi: ExtensionAPI) => {
      registerBackgroundResultExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        resolveTask: (id) => {
          const task = tasks.get(id);
          if (!task) throw new Error('unknown fixture task');
          return task;
        },
        claimFusionUsage: async () => {
          claims += 1;
          return true;
        },
        loadDelegateResultRuntime: async () => {
          delegateImports += 1;
          throw new Error('delegate verifier marker');
        },
        loadFusionResultRuntime: async () => {
          fusionImports += 1;
          throw new Error('fusion verifier marker');
        },
      });
    });
    try {
      const running = await execute(h, 'bg_result', { taskId: 'running-fusion' });
      assert.equal(field(field(running, 'details'), 'state'), 'running');
      assert.equal(delegateImports, 0);
      assert.equal(fusionImports, 0);

      const fusionError = await rejected(execute(h, 'bg_result', { taskId: 'terminal-fusion' }));
      assert.match(String(fusionError), /fusion verifier marker/);
      assert.equal(fusionImports, 1);
      assert.equal(delegateImports, 0);

      const delegateError = await rejected(
        execute(h, 'bg_result', { taskId: 'terminal-delegate' }),
      );
      assert.match(String(delegateError), /delegate verifier marker/);
      assert.equal(delegateImports, 1);
      assert.equal(fusionImports, 1);
      assert.equal(claims, 0);
    } finally {
      await close(h);
    }
  });

  void it('closes every composed facade before blocked Fusion cleanup can pause shutdown', async () => {
    const fusionBarrier = deferred<FusionExecutionRuntime>();
    let fusionImports = 0;
    let delegateRuntimeCalls = 0;
    let delegateStarters = 0;
    let resultResolutions = 0;
    const h = await harness((pi: ExtensionAPI) => {
      const activationCloseFence = new SynchronousActivationCloseFence();
      pi.on('session_shutdown', () => {
        activationCloseFence.close();
      });
      registerFusionExtension(pi, {
        startManagedTask: async () => {
          throw new Error('managed starter must remain fenced');
        },
        snapshot: () => {
          throw new Error('snapshot must remain fenced');
        },
        updateManagedTask: async () => undefined,
        activationCloseFence,
        loadExecutionRuntime: () => {
          fusionImports += 1;
          return fusionBarrier.promise;
        },
      });
      registerDelegateExtension(pi, {
        startDelegateTask: async () => {
          delegateStarters += 1;
          throw new Error('delegate starter must remain fenced');
        },
        snapshot: () => {
          throw new Error('delegate snapshot must remain fenced');
        },
        isDelegateTaskRegistered: () => false,
        activationCloseFence,
        loadHookEvidence: async () => HOOK_EVIDENCE,
        loadRuntime: async () =>
          delegateRuntime(() => {
            delegateRuntimeCalls += 1;
            throw new Error('delegate runtime ran after shutdown began');
          }),
      });
      registerBackgroundResultExtension(pi, {
        resolveTask: () => {
          resultResolutions += 1;
          throw new Error('result registry ran after shutdown began');
        },
        claimFusionUsage: async () => false,
        activationCloseFence,
      });
    });
    let releaseFusion = false;
    try {
      const pendingFusion = settlement(execute(h, 'fusion_reason', { prompt: 'blocked' }));
      await waitUntil(() => fusionImports === 1);
      const hostCalls: string[] = [];
      const staleUi: ExtensionUIContext = {
        ...h.session.extensionRunner.getUIContext(),
        editor: async () => {
          hostCalls.push('ui.editor');
          return 'late prompt';
        },
        notify: () => {
          hostCalls.push('ui.notify');
        },
      };
      const staleCommandContext = new Proxy(
        h.session.extensionRunner.createCommandContext(),
        {
          get(target, property, receiver) {
            if (property === 'mode') return 'rpc';
            if (property === 'waitForIdle') {
              return async () => {
                hostCalls.push('waitForIdle');
              };
            }
            if (property === 'ui') return staleUi;
            return Reflect.get(target, property, receiver);
          },
        },
      );
      h.shutdown = true;
      let shutdownFinished = false;
      const shutdown = h.session.extensionRunner
        .emit({ type: 'session_shutdown', reason: 'reload' })
        .then(() => {
          shutdownFinished = true;
        });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(shutdownFinished, false, 'Fusion settlement should still be blocking cleanup');

      const staleContext = h.session.extensionRunner.createContext();
      const staleDelegate = settlement(
        tool(h, 'bg_delegate').execute(
          'stale-delegate',
          { name: 'stale', prompt: 'stale' },
          undefined,
          undefined,
          staleContext,
        ),
      );
      const staleResult = settlement(
        tool(h, 'bg_result').execute(
          'stale-result',
          { taskId: 'stale' },
          undefined,
          undefined,
          staleContext,
        ),
      );
      const staleFusionDirect = settlement(
        Promise.resolve(command(h, 'fusion').handler('late', staleCommandContext)),
      );
      const staleFusionEditor = settlement(
        Promise.resolve(command(h, 'fusion').handler('', staleCommandContext)),
      );
      const staleSelector = settlement(
        Promise.resolve(command(h, 'fusion-models').handler('', staleCommandContext)),
      );
      const staleSettlements = await Promise.all([
        staleDelegate,
        staleResult,
        staleFusionDirect,
        staleFusionEditor,
        staleSelector,
      ]);

      releaseFusion = true;
      fusionBarrier.resolve(
        fusionRuntime(() => {
          throw new Error('release blocked Fusion import');
        }),
      );
      await Promise.all([pendingFusion, shutdown]);

      for (const observed of staleSettlements) {
        assert.ok(observed.error instanceof Error, 'every retained facade must reject');
        assert.match(observed.error.message, /lazy_module_closed|closed activation|shutting down/u);
      }
      assert.deepEqual(hostCalls, [], 'stale commands must not touch their old host context');
      assert.equal(delegateRuntimeCalls, 0);
      assert.equal(delegateStarters, 0);
      assert.equal(resultResolutions, 0);
    } finally {
      if (!releaseFusion) {
        fusionBarrier.resolve(
          fusionRuntime(() => {
            throw new Error('test cleanup release');
          }),
        );
      }
      await close(h);
    }
  });

  void it('rolls back a complete real delegate preparation closed by AgentSession.reload()', async () => {
    const preparedReady = deferred<string>();
    const releasePrepared = deferred<void>();
    let starters = 0;
    const runtime: DelegateExtensionRuntime = {
      loadDelegateHookContractEvidence: () => HOOK_EVIDENCE,
      resolveDelegateRoute: () => ({
        provider: 'fixture',
        model: 'fixture',
        qualified_id: 'fixture/fixture',
        context_window_tokens: 100_000_000,
        thinking_level: 'off',
        origin: 'explicit',
      }),
      prepareDelegateLaunch: async (input) => {
        const prepared = await prepareDelegateLaunch(input);
        preparedReady.resolve(prepared.store.artifactDirAbs);
        await releasePrepared.promise;
        return prepared;
      },
    };
    const h = await harness((pi: ExtensionAPI) => {
      registerDelegateExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startDelegateTask: async () => {
          starters += 1;
          throw new Error('starter must remain fenced');
        },
        snapshot: (task) => task,
        isDelegateTaskRegistered: () => false,
        loadHookEvidence: async () => HOOK_EVIDENCE,
        loadRuntime: async () => runtime,
      });
    });
    try {
      const oldTool = tool(h, 'bg_delegate');
      const pending = settlement(
        oldTool.execute(
          'prepare-real-reload',
          {
            name: 'rollback real preparation',
            prompt: 'write the complete launch transaction before returning',
            route: { provider: 'fixture', model: 'fixture' },
          },
          undefined,
          undefined,
          h.session.extensionRunner.createContext(),
        ),
      );
      const artifactDir = await preparedReady.promise;
      assert.equal(existsSync(join(artifactDir, 'seed.json')), true);
      assert.equal(existsSync(join(artifactDir, 'context-omission-ledger.json')), true);
      assert.equal(existsSync(join(artifactDir, 'child-prompt.txt')), true);

      const oldRunner = h.session.extensionRunner;
      const reload = h.session.reload();
      await new Promise((resolve) => setImmediate(resolve));
      releasePrepared.resolve(undefined);
      const [observed] = await Promise.all([pending, reload]);

      assert.notEqual(h.session.extensionRunner, oldRunner);
      assert.ok(observed.error instanceof Error);
      assert.match(observed.error.message, /lazy_module_closed/u);
      assert.equal(starters, 0);
      assert.equal(existsSync(artifactDir), false, 'the unregistered run root must be removed');
      assert.equal(
        existsSync(join(h.root, 'project', '.pi', 'delegate')),
        false,
        'empty preparation parents must not retain delegate bytes or run directories',
      );
    } finally {
      releasePrepared.resolve(undefined);
      await close(h);
    }
  });

  void it('does not roll back artifacts after delegate task ownership transfers', async () => {
    const starterEntered = deferred<void>();
    const releaseStarter = deferred<void>();
    const baseRuntime = successfulDelegateRuntime();
    let rollbacks = 0;
    let registered = false;
    const runtime: DelegateExtensionRuntime = {
      ...baseRuntime,
      prepareDelegateLaunch: async (input) => {
        const prepared = await baseRuntime.prepareDelegateLaunch(input);
        return {
          ...prepared,
          rollback: async () => {
            rollbacks += 1;
          },
        };
      },
    };
    const h = await harness((pi: ExtensionAPI) => {
      registerDelegateExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startDelegateTask: async () => {
          registered = true;
          starterEntered.resolve(undefined);
          await releaseStarter.promise;
          return baseTask('fresh-success');
        },
        snapshot: (task) => task,
        isDelegateTaskRegistered: () => registered,
        loadHookEvidence: async () => HOOK_EVIDENCE,
        loadRuntime: async () => runtime,
      });
    });
    try {
      const pending = settlement(execute(h, 'bg_delegate', { name: 'owned', prompt: 'owned' }));
      await starterEntered.promise;
      h.shutdown = true;
      const shutdown = h.session.extensionRunner.emit({
        type: 'session_shutdown',
        reason: 'reload',
      });
      await new Promise((resolve) => setImmediate(resolve));
      releaseStarter.resolve(undefined);
      const [observed] = await Promise.all([pending, shutdown]);
      assert.ok(observed.error instanceof Error);
      assert.match(observed.error.message, /lazy_module_closed/u);
      assert.equal(rollbacks, 0, 'registered task artifacts belong to the registry lifecycle');
    } finally {
      releaseStarter.resolve(undefined);
      await close(h);
    }
  });

  void it('settles a started Fusion usage claim as the one successful retrieval across reload', async () => {
    const task = fusionTask('usage-race');
    const claimStarted = deferred<void>();
    const releaseClaim = deferred<void>();
    let activations = 0;
    const claim = async (candidate: BgTask): Promise<boolean> => {
      if (candidate.fusion === undefined || candidate.fusion.usageDelivered) return false;
      candidate.fusion.usageDelivered = true;
      claimStarted.resolve(undefined);
      await releaseClaim.promise;
      return true;
    };
    const h = await harness((pi: ExtensionAPI) => {
      activations += 1;
      registerBackgroundResultExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        resolveTask: () => task,
        claimFusionUsage: claim,
        loadFusionResultRuntime: async () => ({
          readFusionCommittedResult: async () => verifiedFusionRun(task.id),
          readFusionFailureResult: async () => {
            throw new Error('failure verifier must stay unused');
          },
        }),
        loadDelegateResultRuntime: async () => {
          throw new Error('delegate verifier must stay unused');
        },
      });
    });
    try {
      const oldTool = tool(h, 'bg_result');
      const oldPending = settlement(
        oldTool.execute(
          'usage-old',
          { taskId: task.id, delivery: 'inline' },
          undefined,
          undefined,
          h.session.extensionRunner.createContext(),
        ),
      );
      await claimStarted.promise;
      await h.session.reload();
      releaseClaim.resolve(undefined);
      const old = await oldPending;

      assert.equal(activations, 2);
      assert.equal(old.error, undefined);
      assert.equal(field(field(old.value, 'details'), 'usage_delivered'), true);
      assert.ok(field(old.value, 'usage') !== undefined, 'the settled old call must carry usage');
      assert.equal(task.fusion?.usageDelivered, true);

      const fresh = await execute(h, 'bg_result', { taskId: task.id, delivery: 'inline' });
      assert.equal(field(field(fresh, 'details'), 'usage_delivered'), false);
      assert.equal(field(fresh, 'usage'), undefined, 'fresh retrieval must not duplicate usage');
    } finally {
      releaseClaim.resolve(undefined);
      await close(h);
    }
  });

  void it('loads only the model-selector lane and leaves editor cancellation cold', async () => {
    let executionImports = 0;
    let selectorImports = 0;
    let customCalls = 0;
    const selectorRuntime: FusionModelSelectorRuntime = {
      fusionModelConfigPath: () => join(tmpdir(), 'lazy-fusion-models.json'),
      loadFusionModelConfig: async (path) => {
        const configPath = path ?? join(tmpdir(), 'lazy-fusion-models.json');
        return {
          config: {
            schema_version: 'pi-background-tasks.fusion-models.v1',
            candidates: ['$current', '$current', '$current'],
            evaluator: '$current',
            merger: '$current',
          },
          revision: { path: configPath, exists: false, sha256: null },
        };
      },
      saveFusionModelConfig: async (path) => ({ path, exists: false, sha256: null }),
      createSelector: () => {
        throw new Error('mocked UI must not instantiate selector');
      },
    };
    const h = await harness((pi: ExtensionAPI) => {
      registerFusionExtension(pi, {
        activationCloseFence: installActivationCloseFence(pi),
        startManagedTask: async () => {
          throw new Error('managed starter must stay cold');
        },
        snapshot: () => {
          throw new Error('snapshot must stay cold');
        },
        updateManagedTask: async () => undefined,
        loadExecutionRuntime: async () => {
          executionImports += 1;
          return fusionRuntime(() => {
            throw new Error('execution runtime must stay cold');
          });
        },
        loadModelSelectorRuntime: async () => {
          selectorImports += 1;
          return selectorRuntime;
        },
      });
    }, 'tui');
    const base = h.session.extensionRunner.getUIContext();
    const ui: ExtensionUIContext = {
      ...base,
      editor: async () => undefined,
      custom: (async () => {
        customCalls += 1;
        return { type: 'cancelled' };
      }) as ExtensionUIContext['custom'],
      notify: () => undefined,
    };
    h.session.extensionRunner.setUIContext(ui);
    try {
      const fusion = h.session.extensionRunner
        .getRegisteredCommands()
        .find((command) => command.invocationName === 'fusion');
      const selector = h.session.extensionRunner
        .getRegisteredCommands()
        .find((command) => command.invocationName === 'fusion-models');
      assert.ok(fusion);
      assert.ok(selector);
      const commandContext = h.session.extensionRunner.createCommandContext();
      Object.defineProperty(commandContext, 'mode', { value: 'tui', configurable: true });
      await fusion.handler('', commandContext);
      assert.equal(executionImports, 0, 'cancelled editor must not preload execution');
      assert.equal(selectorImports, 0);
      await selector.handler('', commandContext);
      await selector.handler('', commandContext);
      assert.equal(selectorImports, 1);
      assert.equal(executionImports, 0);
      assert.equal(customCalls, 2);
    } finally {
      await close(h);
    }
  });
});
