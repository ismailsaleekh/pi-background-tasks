import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  streamAnthropicViaBetaMessages,
  type PiSimpleStreamOptions,
} from '../../src/core/anthropic-attribution.js';

const model = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  id: 'claude-opus-5-5',
  baseUrl: 'https://api.anthropic.com',
  maxTokens: 128_000,
  reasoning: true,
};
const context = { messages: [{ role: 'user' as const, content: 'side question' }] };
const dependencies = {
  loadAccount: () => ({
    deviceId: 'd'.repeat(64),
    accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  }),
};
const options: PiSimpleStreamOptions = { apiKey: 'sk-ant-oat-offline', reasoning: 'low' };

function success(id: string): Response {
  return new Response(
    [
      { type: 'message_start', message: { id, usage: {} } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} },
      { type: 'message_stop' },
    ]
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

void describe('optional routing session id (#33 / PR #34)', () => {
  void it('isolates simultaneous one-off calls from each other and the active parent', async (t) => {
    // Adapted from LiangRui He's PR #34; also hold a supplied parent lane live.
    const seen: string[] = [];
    let release = (): void => undefined;
    let fail = (_error: Error): void => undefined;
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    const deadline = setTimeout(() => fail(new Error('requests did not enter together')), 2_000);
    t.after(() => {
      clearTimeout(deadline);
      release();
    });
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { metadata: { user_id: string } };
      const id = new Headers(init.headers).get('X-Claude-Code-Session-Id');
      assert.ok(id);
      assert.equal((JSON.parse(payload.metadata.user_id) as { session_id: string }).session_id, id);
      const ordinal = seen.push(id);
      if (seen.length === 3) release();
      await gate;
      return success(`msg_${ordinal}`);
    });
    const explicitUndefined = { ...options };
    Reflect.set(explicitUndefined, 'sessionId', undefined);
    const results = await Promise.all([
      streamAnthropicViaBetaMessages(
        model,
        context,
        { ...options, sessionId: 'parent-lane' },
        dependencies,
      ).result(),
      streamAnthropicViaBetaMessages(model, context, options, dependencies).result(),
      streamAnthropicViaBetaMessages(model, context, explicitUndefined, dependencies).result(),
    ]);
    for (const result of results) assert.equal(result.stopReason, 'stop', result.errorMessage);
    assert.equal(seen[0], 'parent-lane');
    assert.equal(new Set(seen).size, 3);
    for (const id of seen.slice(1))
      assert.match(id, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u);
    assert.equal(Object.hasOwn(options, 'sessionId'), false, 'never mutate caller options');
  });

  for (const sessionId of ['', '   ', null, 42]) {
    void it(`refuses an explicitly malformed id ${JSON.stringify(sessionId)}`, async (t) => {
      const fetch = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('must not fetch');
      });
      const malformed = { ...options };
      Reflect.set(malformed, 'sessionId', sessionId);
      const result = await streamAnthropicViaBetaMessages(
        model,
        context,
        malformed,
        dependencies,
      ).result();
      assert.equal(result.stopReason, 'error');
      assert.match(result.errorMessage ?? '', /requires a non-empty options\.sessionId/u);
      assert.equal(fetch.mock.callCount(), 0);
    });
  }
});
