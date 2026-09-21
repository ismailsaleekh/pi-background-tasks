import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LazyModule,
  SynchronousActivationCloseFence,
} from '../../src/core/lazy-module.js';

interface FixtureModule {
  readonly value: number;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  assert.ok(resolvePromise);
  assert.ok(rejectPromise);
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected promise to reject');
}

void describe('synchronous activation close fence', () => {
  void it('closes every lane before returning and preserves repeated teardown', () => {
    const fence = new SynchronousActivationCloseFence();
    const closed: string[] = [];

    fence.add(() => {
      closed.push('core');
    });
    fence.add(() => {
      closed.push('fusion');
    });
    fence.add(() => {
      closed.push('delegate');
    });
    fence.add(() => {
      closed.push('result');
    });

    fence.close();
    assert.deepEqual(closed, ['core', 'fusion', 'delegate', 'result']);
    fence.close();
    assert.deepEqual(closed, [
      'core',
      'fusion',
      'delegate',
      'result',
      'core',
      'fusion',
      'delegate',
      'result',
    ]);

    fence.add(() => {
      closed.push('late');
    });
    assert.deepEqual(closed.slice(-1), ['late']);
  });

  void it('attempts every close callback before surfacing a barrier failure', () => {
    const fence = new SynchronousActivationCloseFence();
    let laterLaneClosed = false;
    fence.add(() => {
      throw new Error('close failure marker');
    });
    fence.add(() => {
      laterLaneClosed = true;
    });
    assert.throws(() => {
      fence.close();
    }, /synchronous activation close barrier failed/u);
    assert.equal(laterLaneClosed, true);
  });
});

void describe('LazyModule', () => {
  void it('stores one cold import while concurrent callers run independently', async () => {
    const barrier = deferred<FixtureModule>();
    let imports = 0;
    let runs = 0;
    const module = new LazyModule('unit-single-flight', () => {
      imports += 1;
      return barrier.promise;
    });

    const first = module.run((loaded) => {
      runs += 1;
      return loaded.value + 1;
    });
    const second = module.run((loaded) => {
      runs += 1;
      return loaded.value + 2;
    });

    assert.equal(module.state, 'loading');
    await Promise.resolve();
    assert.equal(imports, 1);
    assert.equal(runs, 0);
    barrier.resolve({ value: 40 });
    assert.deepEqual(await Promise.all([first, second]), [41, 42]);
    assert.equal(imports, 1);
    assert.equal(runs, 2);
    assert.equal(module.state, 'loaded');
  });

  void it('retains one bounded actionable import failure for the activation', async () => {
    const hugeCause = `missing deferred bytes ${'x'.repeat(20_000)}`;
    let imports = 0;
    const module = new LazyModule<FixtureModule>('delegate-producer', async () => {
      imports += 1;
      throw new Error(hugeCause);
    });

    const [first, second] = await Promise.all([
      rejection(module.load()),
      rejection(module.load()),
    ]);
    const third = await rejection(module.run((loaded) => loaded.value));
    assert.equal(imports, 1);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.ok(first instanceof Error);
    assert.match(first.message, /lazy_module_load_failed/);
    assert.match(first.message, /delegate-producer/);
    assert.match(first.message, /missing deferred bytes/);
    assert.ok(first.message.length <= 768, `failure was not bounded: ${String(first.message.length)}`);
    assert.equal(module.state, 'failed');
  });

  void it('closes synchronously and discards a module that arrives after shutdown', async () => {
    const barrier = deferred<FixtureModule>();
    let sideEffects = 0;
    const module = new LazyModule('fusion-execution', () => barrier.promise);
    const oldCall = module.run((loaded) => {
      sideEffects += loaded.value;
    });

    await Promise.resolve();
    module.close('session shutdown');
    assert.equal(module.state, 'closed');
    barrier.resolve({ value: 1 });

    const lateError = await rejection(oldCall);
    const postCloseError = await rejection(
      module.run(() => {
        sideEffects += 100;
      }),
    );
    assert.equal(lateError, postCloseError);
    assert.ok(lateError instanceof Error);
    assert.match(lateError.message, /lazy_module_closed/);
    assert.match(lateError.message, /fusion-execution/);
    assert.equal(sideEffects, 0);
  });

  void it('allows a fresh activation to retry after an old sticky failure', async () => {
    let attempts = 0;
    const failed = new LazyModule<FixtureModule>('reloadable', async () => {
      attempts += 1;
      throw new Error('first activation missing module');
    });
    await rejection(failed.load());
    failed.close('reload');

    const fresh = new LazyModule<FixtureModule>('reloadable', async () => {
      attempts += 1;
      return { value: 7 };
    });
    assert.equal(await fresh.run((loaded) => loaded.value), 7);
    assert.equal(attempts, 2);
    assert.equal(fresh.state, 'loaded');
  });
});
