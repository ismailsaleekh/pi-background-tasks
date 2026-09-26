import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { describe, it, type TestContext } from 'node:test';
import {
  streamAnthropicViaBetaMessages,
  type PiSimpleStreamOptions,
} from '../../src/core/anthropic-attribution.js';

const model = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  id: 'claude-fable-5-1',
  baseUrl: 'https://api.anthropic.com',
  maxTokens: 128_000,
  reasoning: true,
};
const context = { messages: [{ role: 'user' as const, content: 'connection fixture' }] };
const dependencies = {
  loadAccount: () => ({
    deviceId: 'd'.repeat(64),
    accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  }),
};
function send(options: PiSimpleStreamOptions = {}) {
  return streamAnthropicViaBetaMessages(
    model,
    context,
    {
      apiKey: 'sk-ant-oat-offline',
      reasoning: 'low',
      ...options,
    },
    dependencies,
  );
}
function socket(code = 'UND_ERR_SOCKET'): Error {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('PRIVATE_CAUSE_TEXT'), { code }),
  });
}
function wire(event: object): string {
  return `event: ${Reflect.get(event, 'type')}\ndata: ${JSON.stringify(event)}\n\n`;
}
function response(id = 'msg_success'): Response {
  return new Response(
    [
      { type: 'message_start', message: { id, usage: { input_tokens: 1 } } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
      .map(wire)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function clock(t: TestContext): void {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0); // exact 500ms, 1000ms ... capped at 8000ms
}

void describe('attribution connection-only retries (#32)', () => {
  void it('retries before response with one UUID, payload, middleware pass and terminal result', async (t) => {
    clock(t);
    const bodies: string[] = [];
    const headers: string[] = [];
    let payloadCalls = 0;
    let responseCalls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      assert.equal(String(url), 'https://api.anthropic.com/v1/messages?beta=true');
      assert.equal(init.redirect, 'error');
      bodies.push(String(init.body));
      headers.push(JSON.stringify([...new Headers(init.headers)]));
      if (bodies.length === 1) throw socket();
      return response();
    });
    const stream = send({
      onPayload: () => {
        payloadCalls += 1;
      },
      onResponse: () => {
        responseCalls += 1;
      },
    });
    const events: string[] = [];
    const consumed = (async () => {
      for await (const event of stream) events.push(event.type);
    })();
    await flush();
    assert.equal(bodies.length, 1);
    assert.deepEqual(events, [], 'no start/content exposed before headers');
    t.mock.timers.tick(500);
    const result = await stream.result();
    await consumed;
    assert.equal(result.stopReason, 'stop', result.errorMessage);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(headers[0], headers[1]);
    const payload = JSON.parse(bodies[0] ?? '') as { metadata: { user_id: string } };
    const id: unknown = Reflect.get(JSON.parse(payload.metadata.user_id) as object, 'session_id');
    assert.match(String(id), /^[a-f\d-]{36}$/u);
    assert.ok(headers[0]?.includes(String(id)));
    assert.equal(payloadCalls, 1);
    assert.equal(responseCalls, 1);
    assert.deepEqual(events, ['start', 'done']);
    assert.equal(result.diagnostics?.filter((d) => d.type === 'anthropic-cache-lineage').length, 1);
    assert.deepEqual(
      result.diagnostics?.find((d) => d.type === 'anthropic-connection-retry')?.details,
      {
        retries_scheduled: 1,
        retry_limit: 2,
        last_connection_code: 'UND_ERR_SOCKET',
        last_delay_ms: 500,
      },
    );
    assert.doesNotMatch(
      JSON.stringify(result.diagnostics),
      /PRIVATE_CAUSE_TEXT|sk-ant-oat|aaaaaaaa/u,
    );
  });

  void it('exhausts the default two retries, reports a safe cause code, then releases the lane', async (t) => {
    clock(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls <= 3) throw socket();
      return response();
    });
    const pending = send({ sessionId: 'exhaustion' }).result();
    await flush();
    t.mock.timers.tick(500);
    await flush();
    t.mock.timers.tick(1000);
    const failed = await pending;
    assert.equal(calls, 3);
    assert.equal(failed.stopReason, 'error');
    assert.match(
      failed.errorMessage ?? '',
      /connection error after 3 attempt\(s\): UND_ERR_SOCKET/u,
    );
    assert.doesNotMatch(failed.errorMessage ?? '', /PRIVATE_CAUSE_TEXT/u);
    assert.equal(
      failed.diagnostics?.some((d) => d.type === 'anthropic-cache-lineage'),
      false,
    );
    assert.equal(
      failed.diagnostics?.filter((d) => d.type === 'anthropic-connection-retry').length,
      1,
    );
    const recovered = await send({ sessionId: 'exhaustion' }).result();
    assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
  });

  void it('honors maxRetries:0 rather than overriding caller policy', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw socket();
    });
    const result = await send({ maxRetries: 0 }).result();
    assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage ?? '', /after 1 attempt/u);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(result.diagnostics, undefined);
  });

  void it('honors an explicit retry count and caps exponential backoff', async (t) => {
    clock(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls <= 6) throw socket();
      return response();
    });
    const pending = send({ maxRetries: 6 }).result();
    for (const delay of [500, 1000, 2000, 4000, 8000, 8000]) {
      await flush();
      const before = calls;
      t.mock.timers.tick(delay - 1);
      await flush();
      assert.equal(calls, before);
      t.mock.timers.tick(1);
    }
    assert.equal((await pending).stopReason, 'stop');
    assert.equal(calls, 7);
  });

  for (const error of [
    Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    socket('UND_ERR_HEADERS_TIMEOUT'),
    new TypeError('fetch failed', {
      cause: new AggregateError([
        Object.assign(new Error('v4'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('v6'), { code: 'ENETUNREACH' }),
      ]),
    }),
  ]) {
    void it(`accepts a known transient error chain: ${error.cause instanceof AggregateError ? 'aggregate' : error.message}`, async (t) => {
      clock(t);
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        calls += 1;
        if (calls === 1) throw error;
        return response();
      });
      const pending = send({ maxRetries: 1 }).result();
      await flush();
      t.mock.timers.tick(500);
      assert.equal((await pending).stopReason, 'stop');
      assert.equal(calls, 2);
    });
  }

  for (const error of [
    new Error('implementation bug'),
    new TypeError('fetch failed'),
    socket('CERT_HAS_EXPIRED'),
    socket('ENOTFOUND'),
    Object.assign(socket(), { name: 'AbortError' }),
    new AggregateError([socket(), socket('ERR_TLS_CERT_ALTNAME_INVALID')]),
    new AggregateError([]),
  ]) {
    void it(`does not retry unknown/permanent errors: ${error.name} ${error.message}`, async (t) => {
      const fetch = t.mock.method(globalThis, 'fetch', async () => {
        throw error;
      });
      assert.equal((await send().result()).stopReason, 'error');
      assert.equal(fetch.mock.callCount(), 1);
    });
  }

  void it('caps the total cause graph, not just its depth and individual array lengths', async (t) => {
    const error = new TypeError('fetch failed', {
      cause: new AggregateError(
        Array.from(
          { length: 16 },
          () => new AggregateError(Array.from({ length: 16 }, () => socket())),
        ),
      ),
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw error;
    });
    const result = await send().result();
    assert.equal(result.stopReason, 'error');
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(result.diagnostics, undefined);
  });

  void it('bounds cyclic cause traversal', async (t) => {
    const error = new Error('cycle');
    error.cause = error;
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw error;
    });
    assert.equal((await send().result()).stopReason, 'error');
    assert.equal(fetch.mock.callCount(), 1);
  });

  for (const status of [400, 401, 403, 429, 500, 503]) {
    void it(`leaves HTTP ${status} to the caller, not connection retry`, async (t) => {
      const fetch = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('provider rejection', { status }),
      );
      let responseCalls = 0;
      const result = await send({
        onResponse: () => {
          responseCalls += 1;
        },
      }).result();
      assert.equal(result.stopReason, 'error');
      assert.match(result.errorMessage ?? '', new RegExp(`HTTP ${status}`));
      assert.equal(fetch.mock.callCount(), 1);
      assert.equal(responseCalls, 1);
    });
  }

  for (const hook of ['onPayload', 'onResponse'] as const) {
    void it(`never retries a connection-shaped ${hook} exception`, async (t) => {
      const fetch = t.mock.method(globalThis, 'fetch', async () => response());
      let hooks = 0;
      const result = await send({
        [hook]: () => {
          hooks += 1;
          throw socket();
        },
      }).result();
      assert.equal(result.stopReason, 'error');
      assert.equal(hooks, 1);
      assert.equal(fetch.mock.callCount(), hook === 'onPayload' ? 0 : 1);
      assert.equal(
        result.diagnostics?.some((d) => d.type === 'anthropic-connection-retry'),
        undefined,
      );
    });
  }

  void it('does not replay a socket failure after response/content exposure', async (t) => {
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  [
                    { type: 'message_start', message: { id: 'partial', usage: {} } },
                    {
                      type: 'content_block_start',
                      index: 0,
                      content_block: { type: 'text', text: '' },
                    },
                    {
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'text_delta', text: 'partial' },
                    },
                  ]
                    .map(wire)
                    .join(''),
                ),
              );
              setImmediate(() => controller.error(socket()));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const result = await send().result();
    assert.equal(result.stopReason, 'error');
    assert.equal(result.content[0]?.['text'], 'partial');
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(
      result.diagnostics?.some((d) => d.type === 'anthropic-cache-lineage'),
      undefined,
    );
  });

  void it('retains the in-flight guard throughout backoff', async (t) => {
    clock(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) throw socket();
      return response();
    });
    const first = send({ sessionId: 'guarded' }).result();
    await flush();
    const competing = await send({ sessionId: 'guarded' }).result();
    assert.match(competing.errorMessage ?? '', /concurrent continuations must fork/u);
    assert.equal(calls, 1);
    t.mock.timers.tick(500);
    assert.equal((await first).stopReason, 'stop');
    assert.equal((await send({ sessionId: 'guarded' }).result()).stopReason, 'stop');
  });

  for (const phase of ['before', 'fetch', 'backoff'] as const) {
    void it(`aborts ${phase} without another attempt or leaked guard/listener`, async (t) => {
      clock(t);
      const controller = new AbortController();
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        calls += 1;
        if (phase === 'backoff') throw socket();
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      });
      if (phase === 'before') controller.abort(new Error('caller cancelled'));
      const pending = send({ sessionId: `abort-${phase}`, signal: controller.signal }).result();
      await flush();
      controller.abort(new Error('caller cancelled'));
      const result = await pending;
      assert.equal(result.stopReason, 'aborted');
      t.mock.timers.tick(100_000);
      await flush();
      assert.equal(calls, phase === 'before' ? 0 : 1);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      t.mock.method(globalThis, 'fetch', async () => response());
      assert.equal((await send({ sessionId: `abort-${phase}` }).result()).stopReason, 'stop');
    });
  }

  void it('aborts and settles each timed-out fetch before retrying with a fresh header deadline', async (t) => {
    clock(t);
    let active = 0;
    const signals: AbortSignal[] = [];
    const fetch = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      assert.equal(active, 0, 'never abandon a still-running fetch to overlap another');
      active += 1;
      assert.ok(init.signal);
      signals.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            active -= 1;
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    });
    const pending = send({ timeoutMs: 100, maxRetries: 1 }).result();
    await flush();
    t.mock.timers.tick(100);
    await flush();
    assert.equal(signals[0]?.aborted, true);
    assert.equal(active, 0);
    t.mock.timers.tick(500);
    await flush();
    assert.equal(fetch.mock.callCount(), 2);
    assert.equal(signals[1]?.aborted, false);
    t.mock.timers.tick(99);
    await flush();
    assert.equal(active, 1);
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage ?? '', /after 2 attempt\(s\): ETIMEDOUT/u);
    assert.equal(active, 0);
    t.mock.timers.tick(100_000);
    await flush();
    assert.equal(fetch.mock.callCount(), 2);
  });

  void it('clears the header timer on success but retains caller cancellation on the response signal', async (t) => {
    clock(t);
    const caller = new AbortController();
    let signal: AbortSignal | null | undefined;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      signal = init.signal;
      return response();
    });
    const result = await send({ timeoutMs: 600, signal: caller.signal }).result();
    assert.equal(result.stopReason, 'stop');
    assert.ok(signal);
    t.mock.timers.tick(100_000);
    assert.equal(signal.aborted, false, 'completed header timer must not fire later');
    caller.abort();
    assert.equal(signal.aborted, true);
  });

  void it('never retries a late response delivered after cancellation', async (t) => {
    const caller = new AbortController();
    let provide = (_response: Response): void => undefined;
    let cancelled = 0;
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Promise<Response>((resolve) => {
          provide = resolve;
        }),
    );
    const pending = send({ signal: caller.signal }).result();
    await flush();
    caller.abort();
    provide(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled += 1;
          },
        }),
      ),
    );
    const result = await pending;
    assert.equal(result.stopReason, 'aborted');
    assert.equal(cancelled, 1);
    assert.equal(fetch.mock.callCount(), 1);
  });

  void it('applies jitter without an immediate or unbounded retry', async (t) => {
    clock(t);
    t.mock.method(Math, 'random', () => 0.8); // 500 * (1 - .8 * .25) = 400
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) throw socket();
      return response();
    });
    const pending = send().result();
    await flush();
    t.mock.timers.tick(399);
    await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.equal((await pending).stopReason, 'stop');
    assert.equal(calls, 2);
  });

  for (const [field, values] of [
    ['maxRetries', [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, null, '2']],
    ['timeoutMs', [0, -1, 1.5, NaN, Infinity, 2_147_483_648, null, '500']],
  ] as const) {
    for (const value of values) {
      void it(`rejects malformed ${field}=${String(value)} before middleware/fetch`, async (t) => {
        const fetch = t.mock.method(globalThis, 'fetch', async () => response());
        let middleware = 0;
        const options: PiSimpleStreamOptions = {
          onPayload: () => {
            middleware += 1;
          },
        };
        Reflect.set(options, field, value);
        const result = await send(options).result();
        assert.equal(result.stopReason, 'error');
        assert.match(result.errorMessage ?? '', new RegExp(`options\\.${field}`));
        assert.equal(middleware, 0);
        assert.equal(fetch.mock.callCount(), 0);
      });
    }
  }
});
