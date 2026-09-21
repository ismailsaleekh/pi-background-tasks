import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import {
  RELOAD_SHELL_HANDOFF_TIMEOUT_MS,
  RELOAD_SHELL_OWNER_PROTOCOL,
  RELOAD_SHELL_OWNER_SYMBOL,
  ReloadSurvivalError,
  createReloadShellOwnerHubForTests,
  getProcessReloadShellOwnerV1,
  inspectReloadShellOwnerForTests,
  makeReloadShellIdentity,
} from '../../src/core/reload-shell-owner.js';
import type {
  BgTask,
  ReloadShellActivationLeaseV1,
  ReloadShellHostAdapterV1,
  ReloadShellOwnerEventSinkV1,
  ReloadableShellExecutionV1,
} from '../../src/core/common.js';

function fakeTask(id: string): BgTask {
  return {
    id,
    name: id,
    command: 'node fake.js',
    status: 'running',
    outputPath: `.pi/tasks/test/${id}.output`,
    outputAbsPath: `/tmp/${id}.output`,
    metadataAbsPath: `/tmp/${id}.json`,
    cwd: '/tmp',
    startTime: 1,
    bytesWritten: 0,
    isAgent: false,
    surviveReload: true,
    reloadSurvival: {
      schemaVersion: 'pi-background-tasks.reload-shell.v1',
      authority: 'same-process-live-owner',
      hostPid: process.pid,
      sessionId: 'owner-test',
      cwdRealpath: '/tmp',
      launchNonce: `${id.padEnd(32, '0').slice(0, 32)}`,
      completionId: `${id}:1`,
      spawnedAt: 1,
      childPid: 101,
      outputCapBytes: 1024,
      leaseGeneration: 1,
      handoffCount: 0,
    },
    notified: false,
    notifyOnCompletion: true,
    triggerOnCompletion: false,
    terminalPublished: false,
    terminalPublicationState: 'pending',
    terminalPublishAttempts: 0,
    waiters: [],
  };
}

function fakeExecution(
  id: string,
  onStop?: (kind: string) => void,
): ReloadableShellExecutionV1 {
  const task = fakeTask(id);
  let resolveTerminal: ((task: BgTask) => void) | undefined;
  const terminal = new Promise<BgTask>((resolve) => {
    resolveTerminal = resolve;
  });
  let sink: ReloadShellOwnerEventSinkV1 | undefined;
  const execution: ReloadableShellExecutionV1 = {
    protocol: RELOAD_SHELL_OWNER_PROTOCOL,
    launchNonce: task.reloadSurvival?.launchNonce ?? id,
    completionId: `${id}:1`,
    task,
    child: undefined,
    outputStream: undefined,
    spawnedAt: 1,
    outputCapBytes: 1024,
    terminal,
    phase: 'running',
    admissionCommitted: false,
    notificationState: 'pending',
    commitInitialMetadata: () => Promise.resolve(),
    failAdmission() {},
    requestStop: async (kind) => {
      onStop?.(kind);
      execution.phase = 'terminal';
      task.status = kind === 'handoff_expired' ? 'failed' : 'killed';
      task.error = kind === 'handoff_expired' ? 'pi_bg_reload_handoff_expired' : task.error;
      resolveTerminal?.(task);
      sink?.onTerminal(execution);
      return task;
    },
    setOwnerEventSink(next) {
      sink = next;
    },
    markAdmissionCommitted(generation, handoffCount) {
      execution.admissionCommitted = true;
      if (task.reloadSurvival) {
        task.reloadSurvival.leaseGeneration = generation;
        task.reloadSurvival.handoffCount = handoffCount;
      }
    },
    updateLeaseAudit(generation, handoffCount) {
      if (task.reloadSurvival) {
        task.reloadSurvival.leaseGeneration = generation;
        task.reloadSurvival.handoffCount = handoffCount;
      }
    },
    abandonReloadHandoff() {
      task.terminalPublicationState = 'abandoned';
      task.terminalPublicationAbandonReason = 'reload_handoff_expired';
    },
    beginNotification() {
      execution.notificationState = 'sending';
      return 'notification-token';
    },
    finishNotification(_token, delivered) {
      execution.notificationState = delivered ? 'delivered' : 'pending';
      task.notified = delivered;
    },
    releaseResources() {
      execution.phase = 'released';
      execution.child = undefined;
      execution.outputStream = undefined;
    },
  };
  return execution;
}

function adapter(
  activationNonce: string,
  events: string[],
  leaseSink?: (lease: ReloadShellActivationLeaseV1) => void,
): ReloadShellHostAdapterV1 {
  return {
    activationNonce,
    onBound(lease) {
      events.push(`bound:${String(lease.generation)}`);
      leaseSink?.(lease);
    },
    onChanged(execution) {
      events.push(`changed:${execution.task.id}`);
    },
    onTerminal(execution) {
      events.push(`terminal:${execution.task.id}`);
    },
  };
}

void describe('same-process reload shell owner', { concurrency: false }, () => {
  void it('uses the v1 global symbol structurally across accessor calls without instanceof', () => {
    assert.equal(RELOAD_SHELL_OWNER_PROTOCOL, 'pi-background-tasks.reload-shell-owner.v1');
    assert.equal(RELOAD_SHELL_OWNER_SYMBOL, Symbol.for(RELOAD_SHELL_OWNER_PROTOCOL));
    assert.equal(RELOAD_SHELL_HANDOFF_TIMEOUT_MS, 30_000);
    const first = getProcessReloadShellOwnerV1();
    const second = getProcessReloadShellOwnerV1();
    assert.equal(first, second);
    assert.equal(first.protocol, RELOAD_SHELL_OWNER_PROTOCOL);
    assert.equal(typeof first.beginActivation, 'function');
    assert.equal(Object.getPrototypeOf(first), null);
  });

  void it('keys exact pid/session/real-cwd identities and isolates independent sessions', () => {
    const hub = createReloadShellOwnerHubForTests({ randomNonce: (() => {
      let sequence = 0;
      return () => `${String(++sequence).padStart(32, '0')}`;
    })() });
    const cwd = realpathSync('/tmp');
    const one = makeReloadShellIdentity('session-one', cwd);
    const two = makeReloadShellIdentity('session-two', cwd);
    const oneClaim = hub.beginActivation(one, 'startup', 'a'.repeat(32));
    const oneEvents: string[] = [];
    const oneLease = hub.commitActivation(oneClaim, adapter('a'.repeat(32), oneEvents));
    const twoClaim = hub.beginActivation(two, 'startup', 'b'.repeat(32));
    const twoEvents: string[] = [];
    const twoLease = hub.commitActivation(twoClaim, adapter('b'.repeat(32), twoEvents));
    assert.notEqual(oneLease.identityKey, twoLease.identityKey);
    assert.equal(hub.isCurrentLease(oneLease), true);
    assert.equal(hub.isCurrentLease(twoLease), true);
    hub.releaseActivation(oneLease);
    hub.releaseActivation(twoLease);
  });

  void it('performs a two-phase claim, queues gap completion, and rejects stale mutation', () => {
    let nonce = 0;
    const hub = createReloadShellOwnerHubForTests({
      handoffTimeoutMs: 1000,
      randomNonce: () => `${String(++nonce).padStart(32, '0')}`,
    });
    const identity = makeReloadShellIdentity('owner-test', realpathSync('/tmp'));
    const oldEvents: string[] = [];
    const firstClaim = hub.beginActivation(identity, 'startup', '1'.repeat(32));
    const firstLease = hub.commitActivation(firstClaim, adapter('1'.repeat(32), oldEvents));
    const execution = fakeExecution('owner-gap');
    hub.registerExecution(firstLease, execution);
    hub.markAdmissionCommitted(firstLease, execution);

    const transferred = hub.beginReloadHandoff(firstLease);
    assert.deepEqual(transferred, [execution]);
    execution.setOwnerEventSink;
    const claim = hub.beginActivation(identity, 'reload', '2'.repeat(32));
    assert.equal(claim.generation, 2);
    assert.equal(claim.executions[0], execution);
    assert.equal(claim.expiresAt !== undefined, true);

    // No new adapter is visible during claiming; the event is retained for commit.
    const sink = Reflect.get(execution, '__ownerEventSinkForTests');
    void sink;
    execution.phase = 'terminal';
    execution.task.status = 'completed';
    const freshEvents: string[] = [];
    const nextLease = hub.commitActivation(claim, adapter('2'.repeat(32), freshEvents));
    assert.deepEqual(freshEvents, ['bound:2', 'changed:owner-gap', 'terminal:owner-gap']);
    assert.equal(execution.task.reloadSurvival?.leaseGeneration, 2);
    assert.equal(execution.task.reloadSurvival?.handoffCount, 1);
    assert.throws(
      () => hub.registerExecution(firstLease, fakeExecution('stale')),
      (error: unknown) =>
        error instanceof ReloadSurvivalError && error.code === 'pi_bg_reload_owner_stale_claim',
    );
    hub.releaseExecution(nextLease, execution);
    hub.releaseActivation(nextLease);
  });

  void it('does not extend the absolute handoff deadline when a claim aborts', async () => {
    let nonce = 0;
    const hub = createReloadShellOwnerHubForTests({
      handoffTimeoutMs: 45,
      randomNonce: () => `${String(++nonce).padStart(32, '0')}`,
      logger: { error() {} },
    });
    const identity = makeReloadShellIdentity('deadline-test', realpathSync('/tmp'));
    const initial = hub.beginActivation(identity, 'startup', '3'.repeat(32));
    const lease = hub.commitActivation(initial, adapter('3'.repeat(32), []));
    const stops: string[] = [];
    const execution = fakeExecution('owner-expiry', (kind) => stops.push(kind));
    hub.registerExecution(lease, execution);
    hub.markAdmissionCommitted(lease, execution);
    hub.beginReloadHandoff(lease);
    const claim = hub.beginActivation(identity, 'reload', '4'.repeat(32));
    const expiresAt = claim.expiresAt;
    hub.abortActivation(claim, new Error('synthetic import failure'));
    const retry = hub.beginActivation(identity, 'reload', '5'.repeat(32));
    assert.equal(retry.expiresAt, expiresAt);
    hub.abortActivation(retry, new Error('synthetic retry failure'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(stops, ['handoff_expired']);
    assert.equal(execution.task.status, 'failed');
    assert.equal(execution.task.terminalPublicationAbandonReason, 'reload_handoff_expired');
    assert.equal(inspectReloadShellOwnerForTests(hub, identity).executions.length, 0);
  });

  void it('releases an orphaned slot when terminal settlement follows a bounded stop failure', async () => {
    const logs: string[] = [];
    let nonce = 0;
    const hub = createReloadShellOwnerHubForTests({
      handoffTimeoutMs: 20,
      randomNonce: () => String(++nonce).padStart(32, '0'),
      logger: { error: (...args: unknown[]) => logs.push(args.map(String).join(' ')) },
    });
    const identity = makeReloadShellIdentity('late-terminal-release', realpathSync('/tmp'));
    const claim = hub.beginActivation(identity, 'startup', 'a'.repeat(32));
    const lease = hub.commitActivation(claim, adapter('a'.repeat(32), []));
    const task = fakeTask('owner-late-terminal');
    let sink: ReloadShellOwnerEventSinkV1 | undefined;
    let resolveTerminal: (settled: BgTask) => void = () => {};
    const terminal = new Promise<BgTask>((resolve) => {
      resolveTerminal = resolve;
    });
    let released = false;
    let stopCalls = 0;
    const execution: ReloadableShellExecutionV1 = {
      protocol: RELOAD_SHELL_OWNER_PROTOCOL,
      launchNonce: task.reloadSurvival?.launchNonce ?? 'owner-late-terminal',
      completionId: `${task.id}:1`,
      task,
      child: undefined,
      outputStream: undefined,
      spawnedAt: task.startTime,
      outputCapBytes: 1024,
      terminal,
      phase: 'running',
      admissionCommitted: false,
      notificationState: 'disabled',
      commitInitialMetadata: () => Promise.resolve(),
      failAdmission() {},
      setOwnerEventSink(next) {
        sink = next;
      },
      markAdmissionCommitted(generation, handoffCount) {
        execution.admissionCommitted = true;
        if (task.reloadSurvival !== undefined) {
          task.reloadSurvival.leaseGeneration = generation;
          task.reloadSurvival.handoffCount = handoffCount;
        }
      },
      updateLeaseAudit() {},
      abandonReloadHandoff() {
        task.terminalPublicationState = 'abandoned';
        task.terminalPublicationAbandonReason = 'reload_handoff_expired';
      },
      beginNotification() {
        return undefined;
      },
      finishNotification() {},
      releaseResources() {
        released = true;
        execution.phase = 'released';
      },
      async requestStop() {
        stopCalls += 1;
        execution.phase = 'stop_requested';
        setTimeout(() => {
          task.status = 'failed';
          execution.phase = 'terminal';
          resolveTerminal(task);
          sink?.onTerminal(execution);
        }, 70);
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('synthetic bounded stop wait expired before terminal close');
      },
    };
    task.reloadExecution = execution;
    hub.registerExecution(lease, execution);
    hub.markAdmissionCommitted(lease, execution);
    hub.beginReloadHandoff(lease);

    await new Promise((resolve) => setTimeout(resolve, 130));

    assert.equal(stopCalls, 1, 'deadline cleanup must request one stop');
    assert.equal(task.status, 'failed');
    assert.equal(execution.phase, 'released');
    assert.equal(released, true);
    assert.deepEqual(inspectReloadShellOwnerForTests(hub, identity).executions, []);
    assert.match(logs.join('\n'), /could not settle.*bounded stop wait expired/u);

    const replacement = hub.beginActivation(identity, 'startup', 'b'.repeat(32));
    const replacementLease = hub.commitActivation(
      replacement,
      adapter('b'.repeat(32), []),
    );
    hub.releaseActivation(replacementLease);
  });

  void it('rejects a competing same-identity activation and incompatible global protocol loudly', () => {
    const hub = createReloadShellOwnerHubForTests();
    const identity = makeReloadShellIdentity('conflict-test', realpathSync('/tmp'));
    const claim = hub.beginActivation(identity, 'startup', '6'.repeat(32));
    const lease = hub.commitActivation(claim, adapter('6'.repeat(32), []));
    assert.throws(
      () => hub.beginActivation(identity, 'startup', '7'.repeat(32)),
      (error: unknown) =>
        error instanceof ReloadSurvivalError &&
        error.code === 'pi_bg_reload_owner_activation_conflict',
    );
    hub.releaseActivation(lease);

    const previous = Reflect.get(globalThis, RELOAD_SHELL_OWNER_SYMBOL);
    try {
      Reflect.set(globalThis, RELOAD_SHELL_OWNER_SYMBOL, { protocol: 'future-owner.v2' });
      assert.throws(
        () => getProcessReloadShellOwnerV1(),
        (error: unknown) =>
          error instanceof ReloadSurvivalError &&
          error.code === 'pi_bg_reload_owner_protocol_incompatible',
      );
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, RELOAD_SHELL_OWNER_SYMBOL);
      else Reflect.set(globalThis, RELOAD_SHELL_OWNER_SYMBOL, previous);
    }
  });

  void it('never adopts copied metadata or an unrelated live pid into a fresh owner', () => {
    const hub = createReloadShellOwnerHubForTests();
    const identity = makeReloadShellIdentity('copy-test', realpathSync('/tmp'));
    const copied = JSON.parse(JSON.stringify(fakeTask('copied-json'))) as Record<string, unknown>;
    assert.equal(copied['pid'], undefined);
    const claim = hub.beginActivation(identity, 'startup', '8'.repeat(32));
    assert.deepEqual(claim.executions, []);
    const lease = hub.commitActivation(claim, adapter('8'.repeat(32), []));
    assert.deepEqual(inspectReloadShellOwnerForTests(hub, identity).executions, []);
    hub.releaseActivation(lease);
  });
});
