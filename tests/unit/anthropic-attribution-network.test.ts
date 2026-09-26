import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { describe, it, type TestContext } from 'node:test';
import { streamAnthropicViaBetaMessages } from '../../src/core/anthropic-attribution.js';

// Real Undici sockets against an owned loopback fake API, never live inference.
const model = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  id: 'claude-opus-5-5',
  baseUrl: 'https://api.anthropic.com',
  maxTokens: 128_000,
  reasoning: true,
};
const context = { messages: [{ role: 'user' as const, content: 'local socket fixture' }] };
const dependencies = {
  loadAccount: () => ({
    deviceId: 'd'.repeat(64),
    accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  }),
};
function wire(event: object): string {
  return `event: ${Reflect.get(event, 'type')}\ndata: ${JSON.stringify(event)}\n\n`;
}
async function localApi(t: TestContext, handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/v1/messages?beta=true`;
}

void describe('attribution real socket controls (#32)', () => {
  void it(
    'recovers from an actual pre-header socket close without rewriting the POST',
    { timeout: 10_000 },
    async (t) => {
      const nativeFetch = globalThis.fetch;
      const bodies: string[] = [];
      const identities: unknown[] = [];
      const url = await localApi(t, (request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          bodies.push(Buffer.concat(chunks).toString('utf8'));
          identities.push(request.headers['x-claude-code-session-id']);
          if (bodies.length === 1) {
            response.destroy(); // Server received POST, but client receives no response headers.
            return;
          }
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.end(
            [
              { type: 'message_start', message: { id: 'msg_local_socket', usage: {} } },
              { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} },
              { type: 'message_stop' },
            ]
              .map(wire)
              .join(''),
          );
        });
      });
      const fetch = t.mock.method(
        globalThis,
        'fetch',
        async (input: unknown, init: RequestInit) => {
          assert.equal(String(input), 'https://api.anthropic.com/v1/messages?beta=true');
          return nativeFetch(url, init);
        },
      );
      const result = await streamAnthropicViaBetaMessages(
        model,
        context,
        {
          apiKey: 'sk-ant-oat-offline',
          reasoning: 'low',
          maxRetries: 1,
          signal: t.signal,
        },
        dependencies,
      ).result();
      assert.equal(result.stopReason, 'stop', result.errorMessage);
      assert.equal(fetch.mock.callCount(), 2);
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
      assert.equal(identities[0], identities[1]);
      assert.equal(
        result.diagnostics?.find((d) => d.type === 'anthropic-connection-retry')?.details?.[
          'last_connection_code'
        ],
        'UND_ERR_SOCKET',
      );
    },
  );

  void it(
    'still aborts the actual response socket after the header timer was cleared',
    { timeout: 10_000 },
    async (t) => {
      const nativeFetch = globalThis.fetch;
      let close = (): void => undefined;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const url = await localApi(t, (_request, response) => {
        response.on('close', close);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.flushHeaders();
        response.write(
          [
            { type: 'message_start', message: { id: 'msg_local_abort', usage: {} } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'partial' },
            },
          ]
            .map(wire)
            .join(''),
        );
        // Do not end: cancellation, not fixture teardown, must close this socket.
      });
      const fetch = t.mock.method(
        globalThis,
        'fetch',
        async (input: unknown, init: RequestInit) => {
          assert.equal(String(input), 'https://api.anthropic.com/v1/messages?beta=true');
          return nativeFetch(url, init);
        },
      );
      const caller = new AbortController();
      const stream = streamAnthropicViaBetaMessages(
        model,
        context,
        {
          apiKey: 'sk-ant-oat-offline',
          reasoning: 'low',
          timeoutMs: 5_000,
          signal: AbortSignal.any([caller.signal, t.signal]),
        },
        dependencies,
      );
      const events: string[] = [];
      for await (const event of stream) {
        events.push(event.type);
        if (event.type === 'text_delta') caller.abort(new Error('stop response body'));
      }
      const result = await stream.result();
      assert.equal(result.stopReason, 'aborted');
      assert.equal(fetch.mock.callCount(), 1);
      assert.equal(events.filter((type) => type === 'error').length, 1);
      assert.equal(events.includes('done'), false);
      assert.equal(
        result.diagnostics?.some((d) => d.type === 'anthropic-cache-lineage'),
        undefined,
      );
      await closed;
    },
  );
});
