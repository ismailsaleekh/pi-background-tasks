import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import {
  streamAnthropicViaBetaMessages,
  type AssistantMessageLike,
  type PiSimpleStreamOptions,
  type PiStreamContext,
} from '../../src/core/anthropic-attribution.js';
import { isJsonObject, type JsonObject } from '../../src/core/common.js';

const model = {
  provider: 'anthropic',
  api: 'anthropic-messages',
  id: 'claude-fable-5-1',
  baseUrl: 'https://api.anthropic.com',
  maxTokens: 128_000,
  reasoning: true,
  compat: { supportsLongCacheRetention: true, supportsCacheControlOnTools: true },
};
const initialContext: PiStreamContext = {
  systemPrompt: 'Help with the task.',
  tools: [{ name: 'read', description: 'Read a file', parameters: { properties: {} } }],
  messages: [{ role: 'user', content: 'Start' }],
};

function response(id: string, includeMessageStop = true): Response {
  const blocks = [
    { type: 'thinking', thinking: '', signature: '' },
    { type: 'redacted_thinking', data: `redacted-${id}` },
    { type: 'text', text: '' },
  ];
  const events: JsonObject[] = [
    { type: 'message_start', message: { id, usage: { input_tokens: 1 } } },
  ];
  for (const [index, block] of blocks.entries()) {
    events.push({ type: 'content_block_start', index, content_block: block });
    if (block.type === 'thinking') {
      events.push(
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'thinking_delta', thinking: `Reason 😀 ${id}` },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'signature_delta', signature: `sig-${id}` },
        },
      );
    } else if (block.type === 'text') {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: `Answer ${id}` },
      });
    }
    events.push({ type: 'content_block_stop', index });
  }
  events.push({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 1 },
  });
  if (includeMessageStop) events.push({ type: 'message_stop' });
  return new Response(
    events
      .map((event) => `event: ${event['type']}\ndata: ${JSON.stringify(event)}\n\n`)
      .join(''),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function harness(t: TestContext) {
  const payloads: JsonObject[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    assert.equal(typeof init.body, 'string');
    const payload: unknown = JSON.parse(init.body as string);
    assert.ok(isJsonObject(payload));
    payloads.push(payload);
    return response(`msg_${payloads.length}`);
  });
  const send = (context: PiStreamContext, options: PiSimpleStreamOptions = {}) =>
    streamAnthropicViaBetaMessages(
      model,
      context,
      {
        apiKey: 'sk-ant-oat-test',
        sessionId: '11111111-2222-4333-8444-555555555555',
        cacheRetention: 'long',
        reasoning: 'high',
        ...options,
      },
      {
        loadAccount: () => ({
          deviceId: 'd'.repeat(64),
          accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        }),
      },
    ).result();
  return { payloads, send };
}

function lineage(message: AssistantMessageLike): JsonObject {
  const details = message.diagnostics?.find(
    (diagnostic) => diagnostic.type === 'anthropic-cache-lineage',
  )?.details;
  assert.ok(details);
  return details;
}

function continuation(
  context: PiStreamContext,
  result: AssistantMessageLike,
): PiStreamContext {
  assert.equal(result.stopReason, 'stop', result.errorMessage);
  return {
    ...context,
    messages: [
      ...context.messages,
      { ...result, provider: model.provider, api: model.api, model: model.id },
      { role: 'user', content: 'Continue' },
    ],
  };
}

function blocks(payload: JsonObject | undefined): JsonObject[] {
  assert.ok(payload && Array.isArray(payload['messages']));
  return payload['messages'].flatMap((message: unknown) => {
    assert.ok(isJsonObject(message) && Array.isArray(message['content']));
    return message['content'].map((block: unknown) => {
      assert.ok(isJsonObject(block));
      return block;
    });
  });
}

function signedBlocks(payload: JsonObject | undefined): JsonObject[] {
  return blocks(payload).filter(
    (block) => block['type'] === 'thinking' || block['type'] === 'redacted_thinking',
  );
}

function previousId(payload: JsonObject | undefined): unknown {
  assert.ok(payload && isJsonObject(payload['diagnostics']));
  return payload['diagnostics']['previous_message_id'];
}

type AssistantContextMessage = Extract<
  PiStreamContext['messages'][number],
  { readonly role: 'assistant' }
>;

function changeLatestAssistant(
  context: PiStreamContext,
  change: (message: AssistantContextMessage) => AssistantContextMessage,
): PiStreamContext {
  let changed = false;
  const messages = [...context.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    messages[index] = change(message);
    changed = true;
    break;
  }
  assert.equal(changed, true, 'fixture should contain a latest assistant');
  return { ...context, messages };
}

function changeReceiptField(
  message: AssistantContextMessage,
  field: string,
  value: unknown,
): AssistantContextMessage {
  return {
    ...message,
    diagnostics: (message.diagnostics ?? []).map((diagnostic) =>
      diagnostic.type === 'anthropic-cache-lineage'
        ? { ...diagnostic, details: { ...(diagnostic.details ?? {}), [field]: value } }
        : diagnostic,
    ),
  };
}

void describe('Anthropic attribution lineage recovery (#14)', () => {
  void it('chains unchanged append-only requests and replays exact signed thinking', async (t) => {
    const { send, payloads } = harness(t);
    const first = await send(initialContext);
    const second = await send(continuation(initialContext, first));
    assert.equal(second.stopReason, 'stop', second.errorMessage);
    assert.equal(previousId(payloads[1]), first.responseId);
    assert.equal(
      lineage(second)['signature_epoch_sha256'],
      lineage(first)['signature_epoch_sha256'],
    );
    assert.deepEqual(signedBlocks(payloads[1]), [
      { type: 'thinking', thinking: 'Reason 😀 msg_1', signature: 'sig-msg_1' },
      { type: 'redacted_thinking', data: 'redacted-msg_1' },
    ]);
  });

  const changes: Array<{
    name: string;
    context?: (context: PiStreamContext) => PiStreamContext;
    options?: PiSimpleStreamOptions;
  }> = [
    {
      name: 'system prompt',
      context: (context) => ({ ...context, systemPrompt: 'Updated instructions.' }),
    },
    {
      name: 'tool schema',
      context: (context) => ({
        ...context,
        tools: [{ name: 'read', parameters: { properties: { path: { type: 'string' } } } }],
      }),
    },
    { name: 'thinking effort', options: { reasoning: 'low' } },
    { name: 'tool choice', options: { toolChoice: { type: 'auto' } } },
    {
      name: 'rewritten user history',
      context: (context) => ({
        ...context,
        messages: [{ role: 'user', content: 'Edited start' }, ...context.messages.slice(1)],
      }),
    },
    {
      name: 'shortened history',
      context: (context) => ({ ...context, messages: context.messages.slice(2) }),
    },
    { name: 'cache retention', options: { cacheRetention: 'short' } },
    { name: 'disabled caching', options: { cacheRetention: 'none' } },
  ];
  for (const change of changes) {
    void it(`resets ${change.name}, reanchors, and never resurrects old signatures`, async (t) => {
      const { send, payloads } = harness(t);
      const first = await send(initialContext);
      const firstContext = continuation(initialContext, first);
      const second = await send(firstContext);
      const oldContext = continuation(firstContext, second);
      // Round-trip serialized diagnostics like a resumed session, rather than relying on identity.
      const serialized: PiStreamContext = JSON.parse(
        JSON.stringify(oldContext),
      ) as PiStreamContext;
      const changedContext = change.context?.(serialized) ?? serialized;
      const third = await send(changedContext, change.options);
      assert.equal(third.stopReason, 'stop', third.errorMessage);
      assert.equal(previousId(payloads[2]), null);
      assert.deepEqual(signedBlocks(payloads[2]), []);
      assert.notEqual(
        lineage(third)['signature_epoch_sha256'],
        lineage(second)['signature_epoch_sha256'],
      );
      assert.equal(lineage(third)['signature_epoch_inherits_prior'], false);
      assert.ok(blocks(payloads[2]).some((block) => block['text'] === 'Reason 😀 msg_2'));
      assert.ok(blocks(payloads[2]).some((block) => block['text'] === 'Answer msg_2'));
      const resumedContext = continuation(changedContext, third);
      const fourth = await send(resumedContext, change.options);
      assert.equal(fourth.stopReason, 'stop', fourth.errorMessage);
      assert.equal(previousId(payloads[3]), third.responseId);
      assert.equal(
        lineage(fourth)['signature_epoch_sha256'],
        lineage(third)['signature_epoch_sha256'],
      );
      assert.deepEqual(
        signedBlocks(payloads[3]).map((block) => block['signature'] ?? block['data']),
        ['sig-msg_3', 'redacted-msg_3'],
      );
      const restoredContext = continuation(
        {
          ...oldContext,
          messages: [
            ...oldContext.messages,
            ...resumedContext.messages.slice(changedContext.messages.length),
          ],
        },
        fourth,
      );
      const fifth = await send(restoredContext);
      assert.equal(fifth.stopReason, 'stop', fifth.errorMessage);
      assert.equal(previousId(payloads[4]), null);
      assert.deepEqual(signedBlocks(payloads[4]), []);
      assert.ok(
        signedBlocks(payloads[4]).every(
          (block) =>
            !['sig-msg_1', 'redacted-msg_1', 'sig-msg_2', 'redacted-msg_2'].includes(
              String(block['signature'] ?? block['data']),
            ),
        ),
      );
      const sixth = await send(continuation(restoredContext, fifth));
      assert.equal(sixth.stopReason, 'stop', sixth.errorMessage);
      assert.equal(previousId(payloads[5]), fifth.responseId);
      assert.deepEqual(
        signedBlocks(payloads[5]).map((block) => block['signature'] ?? block['data']),
        ['sig-msg_5', 'redacted-msg_5'],
      );
    });
  }

  void it('recovers a reload that drops earlier thinking while retaining stale lineage', async (t) => {
    const { send, payloads } = harness(t);
    const first = await send(initialContext);
    const firstContext = continuation(initialContext, first);
    const second = await send(firstContext);
    const reloaded = continuation(firstContext, second);
    const changed: PiStreamContext = {
      ...reloaded,
      messages: reloaded.messages.map((message) =>
        message.role === 'assistant' && message.responseId === first.responseId
          ? {
              ...message,
              content: message.content.filter((block) => block['type'] !== 'thinking'),
            }
          : message,
      ),
    };
    const third = await send(changed);
    assert.equal(third.stopReason, 'stop', third.errorMessage);
    assert.equal(previousId(payloads[2]), null);
    assert.deepEqual(signedBlocks(payloads[2]), []);
    const fourth = await send(continuation(changed, third));
    assert.equal(fourth.stopReason, 'stop', fourth.errorMessage);
    assert.equal(previousId(payloads[3]), third.responseId);
  });

  void it('treats a changed latest assistant with a valid-shaped stale receipt as a boundary', async (t) => {
    const { send, payloads } = harness(t);
    const first = await send(initialContext);
    const beforeSecond = continuation(initialContext, first);
    const second = await send(beforeSecond);
    const beforeThird = continuation(beforeSecond, second);
    const changed = changeLatestAssistant(beforeThird, (message) => ({
      ...message,
      content: message.content.map((block) =>
        block['type'] === 'text' ? { ...block, text: 'Reconstructed latest answer' } : block,
      ),
    }));

    const recovered = await send(changed);
    assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
    assert.equal(previousId(payloads[2]), null);
    assert.deepEqual(signedBlocks(payloads[2]), []);
    assert.ok(blocks(payloads[2]).some((block) => block['text'] === 'Reason 😀 msg_1'));

    const next = await send(continuation(changed, recovered));
    assert.equal(next.stopReason, 'stop', next.errorMessage);
    assert.equal(previousId(payloads[3]), recovered.responseId);
    assert.deepEqual(
      signedBlocks(payloads[3]).map((block) => block['signature'] ?? block['data']),
      ['sig-msg_3', 'redacted-msg_3'],
    );
  });

  const staleReceiptMutations: Array<{
    readonly name: string;
    readonly change: (message: AssistantContextMessage) => AssistantContextMessage;
  }> = [
    {
      name: 'assistant provider',
      change: (message) => ({ ...message, provider: 'not-anthropic' }),
    },
    {
      name: 'assistant API',
      change: (message) => ({ ...message, api: 'not-anthropic-messages' }),
    },
    {
      name: 'assistant model',
      change: (message) => ({ ...message, model: 'claude-other' }),
    },
    {
      name: 'assistant successful terminal state',
      change: (message) => ({ ...message, stopReason: 'deferred' }),
    },
    {
      name: 'assistant response ID',
      change: (message) => ({ ...message, responseId: 'changed-response' }),
    },
    {
      name: 'non-empty assistant response ID',
      change: (message) => ({ ...message, responseId: '' }),
    },
    {
      name: 'non-empty receipt response ID',
      change: (message) => changeReceiptField(message, 'response_id', ''),
    },
    {
      name: 'non-empty receipt previous response ID',
      change: (message) => changeReceiptField(message, 'previous_message_id', ''),
    },
  ];

  for (const mutation of staleReceiptMutations) {
    void it(`requires receipt binding to the containing ${mutation.name}`, async (t) => {
      const { send, payloads } = harness(t);
      const first = await send(initialContext);
      const beforeSecond = continuation(initialContext, first);
      const second = await send(beforeSecond);
      const beforeThird = continuation(beforeSecond, second);
      const changed = changeLatestAssistant(beforeThird, mutation.change);

      const recovered = await send(changed);
      assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
      assert.equal(previousId(payloads[2]), null);
      assert.deepEqual(signedBlocks(payloads[2]), []);

      const next = await send(continuation(changed, recovered));
      assert.equal(next.stopReason, 'stop', next.errorMessage);
      assert.equal(previousId(payloads[3]), recovered.responseId);
    });
  }

  void it('recovers again after a failed reset attempt without persisting a false anchor', async (t) => {
    const { send, payloads } = harness(t);
    const first = await send(initialContext);
    const changedContext = {
      ...continuation(initialContext, first),
      systemPrompt: 'Updated instructions.',
    };
    const fetch = globalThis.fetch;
    let fail = true;
    t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
      const result = await fetch(...args);
      return fail ? new Response('Unavailable', { status: 503 }) : result;
    });
    const failed = await send(changedContext);
    assert.equal(failed.stopReason, 'error');
    assert.equal(
      failed.diagnostics?.some((entry) => entry.type === 'anthropic-cache-lineage') ?? false,
      false,
    );
    fail = false;
    const retryContext: PiStreamContext = {
      ...changedContext,
      messages: [
        ...changedContext.messages,
        { ...failed, provider: model.provider, api: model.api, model: model.id },
      ],
    };
    const recovered = await send(retryContext);
    assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
    assert.deepEqual(payloads[2], payloads[1]);
    assert.equal(previousId(payloads[2]), null);
    const next = await send(continuation(retryContext, recovered));
    assert.equal(next.stopReason, 'stop', next.errorMessage);
    assert.equal(previousId(payloads[3]), recovered.responseId);
  });

  void it('opens another epoch for history drift under a retained compaction marker', async (t) => {
    const { send, payloads } = harness(t);
    const first = await send(initialContext);
    const compacted: PiStreamContext = {
      ...initialContext,
      messages: [
        {
          role: 'user',
          content:
            'The conversation history before this point was compacted into the following summary: summary',
        },
        { ...first, provider: model.provider, api: model.api, model: model.id },
        { role: 'user', content: 'Continue' },
      ],
    };
    const second = await send(compacted);
    assert.equal(second.stopReason, 'stop', second.errorMessage);
    assert.equal(previousId(payloads[1]), null);
    assert.deepEqual(signedBlocks(payloads[1]), []);
    const changed: PiStreamContext = {
      ...compacted,
      messages: continuation(compacted, second).messages.map((message, index) =>
        index === 2 ? { role: 'user', content: 'Changed after compaction' } : message,
      ),
    };
    const third = await send(changed);
    assert.equal(third.stopReason, 'stop', third.errorMessage);
    assert.equal(previousId(payloads[2]), null);
    assert.notEqual(
      lineage(third)['signature_epoch_sha256'],
      lineage(second)['signature_epoch_sha256'],
    );
    assert.equal(
      lineage(third)['compaction_boundary_sha256'],
      lineage(second)['compaction_boundary_sha256'],
    );
    assert.deepEqual(signedBlocks(payloads[2]), []);
    const fourth = await send(continuation(changed, third));
    assert.equal(fourth.stopReason, 'stop', fourth.errorMessage);
    assert.equal(previousId(payloads[3]), third.responseId);
  });

  for (const receiptState of ['missing', 'malformed'] as const) {
    void it(`does not resurrect an old epoch when the latest reset receipt is ${receiptState}`, async (t) => {
      const { send, payloads } = harness(t);
      const first = await send(initialContext);
      const changed = {
        ...continuation(initialContext, first),
        systemPrompt: 'Updated instructions.',
      };
      const reset = await send(changed);
      assert.equal(reset.stopReason, 'stop', reset.errorMessage);
      const resetContext = continuation(changed, reset);
      const withoutTrustedLatestReceipt: PiStreamContext = {
        ...resetContext,
        systemPrompt: 'Help with the task.',
        messages: resetContext.messages.map((message) => {
          if (message.role !== 'assistant' || message.responseId !== reset.responseId)
            return message;
          if (receiptState === 'missing') return { ...message, diagnostics: [] };
          return {
            ...message,
            diagnostics: (message.diagnostics ?? []).map((diagnostic) =>
              diagnostic.type === 'anthropic-cache-lineage'
                ? {
                    ...diagnostic,
                    details: { ...(diagnostic.details ?? {}), request_message_count: -1 },
                  }
                : diagnostic,
            ),
          };
        }),
      };

      const recovered = await send(withoutTrustedLatestReceipt);
      assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
      assert.equal(previousId(payloads[2]), null);
      assert.deepEqual(signedBlocks(payloads[2]), []);
      assert.ok(blocks(payloads[2]).some((block) => block['text'] === 'Reason 😀 msg_1'));
      assert.ok(blocks(payloads[2]).some((block) => block['text'] === 'Reason 😀 msg_2'));

      const next = await send(continuation(withoutTrustedLatestReceipt, recovered));
      assert.equal(next.stopReason, 'stop', next.errorMessage);
      assert.equal(previousId(payloads[3]), recovered.responseId);
      assert.deepEqual(
        signedBlocks(payloads[3]).map((block) => block['signature'] ?? block['data']),
        ['sig-msg_3', 'redacted-msg_3'],
      );
    });
  }

  void it('does not anchor a reset until strict SSE completion succeeds', async (t) => {
    const { send, payloads } = harness(t);
    const first = await send(initialContext);
    const changed = {
      ...continuation(initialContext, first),
      systemPrompt: 'Updated instructions.',
    };
    const fetch = globalThis.fetch;
    let incomplete = true;
    t.mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
      const complete = await fetch(...args);
      return incomplete ? response('msg_incomplete', false) : complete;
    });

    const failed = await send(changed);
    assert.equal(failed.stopReason, 'error');
    assert.match(failed.errorMessage ?? '', /without message_stop/u);
    assert.equal(
      failed.diagnostics?.some((entry) => entry.type === 'anthropic-cache-lineage') ?? false,
      false,
    );
    incomplete = false;
    const retryContext: PiStreamContext = {
      ...changed,
      messages: [
        ...changed.messages,
        { ...failed, provider: model.provider, api: model.api, model: model.id },
      ],
    };
    const recovered = await send(retryContext);
    assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
    assert.deepEqual(payloads[2], payloads[1]);
    assert.equal(previousId(payloads[2]), null);
    const next = await send(continuation(retryContext, recovered));
    assert.equal(next.stopReason, 'stop', next.errorMessage);
    assert.equal(previousId(payloads[3]), recovered.responseId);
  });

  for (const mutate of [
    'model',
    'stream',
    'metadata',
    'system',
    'messages',
    'thinking',
    'diagnostics',
    'cache_control',
  ] as const) {
    void it(`still rejects middleware ${mutate} mutations after a reset, before fetch`, async (t) => {
      const { send, payloads } = harness(t);
      const first = await send(initialContext);
      const changedContext = {
        ...continuation(initialContext, first),
        systemPrompt: 'Updated instructions.',
      };
      let calls = 0;
      const result = await send(changedContext, {
        onPayload: (payload) => {
          calls += 1;
          if (mutate === 'model') payload['model'] = 'claude-other';
          else if (mutate === 'stream') payload['stream'] = false;
          else if (mutate === 'metadata') payload['metadata'] = { user_id: 'other-account' };
          else if (mutate === 'system') payload['system'] = [];
          else if (mutate === 'messages')
            payload['messages'] = [
              { role: 'user', content: [{ type: 'text', text: 'Injected' }] },
            ];
          else if (mutate === 'thinking') payload['thinking'] = { type: 'disabled' };
          else if (mutate === 'diagnostics')
            payload['diagnostics'] = { previous_message_id: 'injected' };
          else {
            const content = blocks(payload);
            const marked = content.find((block) => block['cache_control'] !== undefined);
            assert.ok(marked);
            Reflect.deleteProperty(marked, 'cache_control');
          }
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.stopReason, 'error');
      assert.match(result.errorMessage ?? '', /changed|removed/);
      assert.equal(
        result.diagnostics?.some(
          (diagnostic) => diagnostic.type === 'anthropic-cache-lineage',
        ) ?? false,
        false,
      );
      assert.equal(payloads.length, 1);
      const recovered = await send(changedContext);
      assert.equal(recovered.stopReason, 'stop', recovered.errorMessage);
      assert.equal(previousId(payloads[1]), null);
    });
  }

  void it('retains the in-flight guard during a reset and releases it after completion', async (t) => {
    const { send } = harness(t);
    const initial = await send(initialContext);
    const changed = {
      ...continuation(initialContext, initial),
      systemPrompt: 'Updated instructions.',
    };
    let release: ((value: Response) => void) | undefined;
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.mock.method(globalThis, 'fetch', () => {
      started?.();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const first = send(changed);
    await entered;
    const concurrent = await send(changed);
    assert.equal(concurrent.stopReason, 'error');
    assert.match(concurrent.errorMessage ?? '', /in-flight request/);
    release?.(response('msg_first'));
    const completed = await first;
    assert.equal(completed.stopReason, 'stop', completed.errorMessage);
    const next = send(continuation(changed, completed));
    // The transport reaches fetch asynchronously after optional middleware.
    await Promise.resolve();
    release?.(response('msg_next'));
    const result = await next;
    assert.equal(result.stopReason, 'stop', result.errorMessage);
  });
});
