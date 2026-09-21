import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it, type TestContext } from 'node:test';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/compat';
import {
  streamAnthropicViaBetaMessages,
  type AssistantMessageLike,
  type PiStreamContext,
} from '../../src/core/anthropic-attribution.js';
import { isJsonObject, type JsonObject } from '../../src/core/common.js';

const minimaxModel = {
  id: 'MiniMax-M3',
  name: 'MiniMax M3',
  api: 'anthropic-messages',
  provider: 'minimax',
  baseUrl: 'https://minimax.example',
  reasoning: false,
  input: ['text'],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
  contextWindow: 200_000,
  maxTokens: 8192,
} as const;

const minimaxContext: PiStreamContext = {
  systemPrompt: 'Non-target system prompt.',
  messages: [
    { role: 'user', content: 'Forward without Anthropic attribution.', timestamp: 1 },
  ],
};

const hostDependencies = Object.freeze({ hostAnthropicMessagesApi: anthropicMessagesApi });

function sseResponse(events: readonly JsonObject[], status = 200): Response {
  return new Response(
    events.map((event) => `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { status, headers: { 'content-type': 'text/event-stream' } },
  );
}

function textSuccessEvents(): JsonObject[] {
  return [
    {
      type: 'message_start',
      message: {
        id: 'minimax-response-1',
        type: 'message',
        role: 'assistant',
        model: 'MiniMax-M3',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'forwarded' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ];
}

function richSuccessEvents(): JsonObject[] {
  return [
    {
      type: 'message_start',
      message: {
        id: 'minimax-rich-response',
        type: 'message',
        role: 'assistant',
        model: 'MiniMax-M3',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'read', input: {} },
    },
    {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'input_json_delta', partial_json: '{"path":"notes.txt"}' },
    },
    { type: 'content_block_stop', index: 2 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 7, output_tokens_details: { thinking_tokens: 5 } },
    },
    { type: 'message_stop' },
  ];
}

void describe('non-target anthropic-messages forwarding (#19)', () => {
  void it('injects the direct host adapter at both gateways without a serialization bridge', async () => {
    const [core, ambientGateway, childGateway] = await Promise.all([
      readFile('src/core/anthropic-attribution.ts', 'utf8'),
      readFile('extensions/anthropic-attribution.ts', 'utf8'),
      readFile('extensions/anthropic-attribution-child.ts', 'utf8'),
    ]);
    const runtimeAdapterImport =
      /^import \{ anthropicMessagesApi \} from '@earendil-works\/pi-ai\/compat';$/mu;
    assert.doesNotMatch(core, runtimeAdapterImport);
    assert.match(core, /hostAnthropicMessagesApi\(\)\.streamSimple/u);
    assert.match(ambientGateway, runtimeAdapterImport);
    assert.match(childGateway, runtimeAdapterImport);
    assert.match(ambientGateway, /hostAnthropicMessagesApi: anthropicMessagesApi/u);
    assert.match(childGateway, /hostAnthropicMessagesApi: anthropicMessagesApi/u);
    assert.equal(/localForwarded(?:ContentBlock|Message|Event)/u.test(core), false);
    assert.equal(/new Function/u.test(core), false);
    assert.equal(/@earendil-works\/pi-ai\/anthropic/u.test(core), false);
  });

  void it('fails loudly if a non-target route bypasses its extension gateway', () => {
    assert.throws(
      () =>
        streamAnthropicViaBetaMessages(minimaxModel, minimaxContext, {
          apiKey: 'minimax-test-key',
          cacheRetention: 'none',
        }),
      /pi_anthropic_attribution_host_adapter_missing/u,
    );
  });

  void it('uses the supported host adapter once without target-only rewriting', async (t: TestContext) => {
    let calls = 0;
    let requestUrl = '';
    let requestHeaders = new Headers();
    let requestPayload: JsonObject | undefined;
    let middlewareCalls = 0;
    let responseCalls = 0;
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      requestUrl = input instanceof Request ? input.url : String(input);
      requestHeaders = new Headers(init?.headers);
      const body = init?.body;
      if (typeof body !== 'string') throw new TypeError('forwarded request body must be a string');
      const parsed: unknown = JSON.parse(body);
      assert.ok(isJsonObject(parsed));
      requestPayload = parsed;
      return sseResponse(textSuccessEvents());
    });

    const result = await streamAnthropicViaBetaMessages(
      minimaxModel,
      minimaxContext,
      {
        apiKey: 'minimax-test-key',
        sessionId: 'non-target-session',
        cacheRetention: 'none',
        headers: { 'x-minimax-route': 'route-a' },
        onPayload(payload, forwardedModel) {
          middlewareCalls += 1;
          assert.strictEqual(forwardedModel, minimaxModel);
          return payload;
        },
        onResponse(response, forwardedModel) {
          responseCalls += 1;
          assert.equal(response.status, 200);
          assert.strictEqual(forwardedModel, minimaxModel);
        },
      },
      hostDependencies,
    ).result();

    assert.equal(result.stopReason, 'stop', result.errorMessage);
    assert.equal(result.provider, 'minimax');
    assert.equal(result.api, 'anthropic-messages');
    assert.equal(result.model, 'MiniMax-M3');
    assert.deepEqual(result.content, [{ type: 'text', text: 'forwarded' }]);
    assert.equal(calls, 1);
    assert.equal(middlewareCalls, 1);
    assert.equal(responseCalls, 1);
    assert.match(requestUrl, /^https:\/\/minimax\.example\/v1\/messages/u);
    assert.equal(requestHeaders.get('x-api-key'), 'minimax-test-key');
    assert.equal(requestHeaders.get('x-minimax-route'), 'route-a');
    assert.ok(requestPayload);
    assert.equal(requestPayload['model'], 'MiniMax-M3');
    assert.equal(JSON.stringify(requestPayload).includes('x-anthropic-billing-header'), false);
    assert.equal(requestPayload['metadata'], undefined);
    assert.equal(requestHeaders.get('X-Claude-Code-Session-Id'), null);
  });

  void it('preserves provider-reported reasoning usage and tool output fields', async (t: TestContext) => {
    t.mock.method(globalThis, 'fetch', async () => sseResponse(richSuccessEvents()));
    const result = await streamAnthropicViaBetaMessages(
      { ...minimaxModel, reasoning: true },
      {
        ...minimaxContext,
        tools: [{ name: 'read', description: 'Read a file', parameters: { properties: {} } }],
      },
      {
        apiKey: 'minimax-test-key',
        reasoning: 'high',
        cacheRetention: 'none',
      },
      hostDependencies,
    ).result();

    assert.equal(result.stopReason, 'toolUse', result.errorMessage);
    assert.equal(result.usage.reasoning, 5);
    assert.equal(result.responseId, 'minimax-rich-response');
    assert.equal(result.rawStopReason, 'tool_use');
    assert.deepEqual(result.content, [
      {
        type: 'thinking',
        thinking: 'reasoning',
        thinkingSignature: 'opaque-signature',
      },
      { type: 'text', text: 'answer' },
      { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'notes.txt' } },
    ]);
  });

  void it('keeps one live partial and retains host-added optional fields and tool metadata', async (t: TestContext) => {
    t.mock.method(globalThis, 'fetch', async () => sseResponse(richSuccessEvents()));
    const stream = streamAnthropicViaBetaMessages(
      { ...minimaxModel, reasoning: true },
      {
        ...minimaxContext,
        tools: [{ name: 'read', description: 'Read a file', parameters: { properties: {} } }],
      },
      {
        apiKey: 'minimax-test-key',
        reasoning: 'high',
        cacheRetention: 'none',
      },
      hostDependencies,
    );

    const partials: object[] = [];
    let terminal: AssistantMessageLike | undefined;
    for await (const event of stream) {
      if ('partial' in event) {
        partials.push(event.partial);
        if (event.type === 'start') {
          event.partial.providerThinkingLevel = 'provider-native-high';
          event.partial.endTurn = true;
        }
        if (event.type === 'toolcall_start') {
          const block = event.partial.content[event.contentIndex];
          assert.ok(block);
          block['namespace'] = 'provider.tools';
        }
      }
      if (event.type === 'done') terminal = event.message;
    }
    const result = await stream.result();

    assert.ok(partials.length > 3);
    assert.ok(partials.every((partial) => partial === partials[0]));
    assert.strictEqual(result, terminal);
    assert.strictEqual(result, partials[0]);
    assert.equal(result.providerThinkingLevel, 'provider-native-high');
    assert.equal(result.endTurn, true);
    const toolCall = result.content.find((block) => block['type'] === 'toolCall');
    assert.ok(toolCall);
    assert.equal(toolCall['namespace'], 'provider.tools');
  });

  void it('settles an adapter error event and result with the same message', async (t: TestContext) => {
    let responseCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => new Response('offline failure', {
      status: 503,
      statusText: 'Service Unavailable',
    }));
    const stream = streamAnthropicViaBetaMessages(
      minimaxModel,
      minimaxContext,
      {
        apiKey: 'minimax-test-key',
        cacheRetention: 'none',
        onResponse(response, forwardedModel) {
          responseCalls += 1;
          assert.equal(response.status, 503);
          assert.strictEqual(forwardedModel, minimaxModel);
        },
      },
      hostDependencies,
    );

    let terminalError: AssistantMessageLike | undefined;
    let terminalEvents = 0;
    for await (const event of stream) {
      if (event.type === 'error') {
        terminalEvents += 1;
        terminalError = event.error;
      }
    }
    const result = await stream.result();
    assert.equal(terminalEvents, 1);
    assert.strictEqual(result, terminalError);
    assert.equal(result.stopReason, 'error');
    assert.match(result.errorMessage ?? '', /503|offline failure/u);
    assert.equal(responseCalls, 0);
  });
});
