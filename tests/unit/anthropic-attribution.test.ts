import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import spawnAnthropicAttribution, {
  ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL,
  buildAnthropicRequestParams,
  rewriteAnthropicRequestPayload,
  streamAnthropicViaBetaMessages,
  type PiExtensionHost,
  type PiContextLike,
} from '../../src/core/anthropic-attribution.js';
import { isJsonObject } from '../../src/core/common.js';
import { buildAttestedPiArgv } from '../../src/core/attested-pi-run.js';

const BAD_SYSTEM_LINES = [
  '- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)',
  '- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)',
  '- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing',
] as const;

function context(provider = 'anthropic'): PiContextLike {
  return {
    model: {
      provider,
      id: provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-5.5',
      maxTokens: 64_000,
      reasoning: true,
    },
    sessionManager: {
      getSessionId: () => '11111111-2222-4333-8444-555555555555',
      getBranch: () => [],
    },
  };
}

class SynchronousTestBus {
  private readonly handlers = new Map<string, Array<(data: unknown) => void>>();

  emit(channel: string, data: unknown): void {
    for (const handler of this.handlers.get(channel) ?? []) handler(data);
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    const handlers = this.handlers.get(channel) ?? [];
    handlers.push(handler);
    this.handlers.set(channel, handlers);
    return () => {
      this.handlers.set(
        channel,
        (this.handlers.get(channel) ?? []).filter((candidate) => candidate !== handler),
      );
    };
  }

  listenerCount(channel: string): number {
    return this.handlers.get(channel)?.length ?? 0;
  }
}

function recordingHost(bus: SynchronousTestBus): {
  host: PiExtensionHost;
  registrations: { commands: number; handlers: number; providers: number; entries: number };
} {
  const registrations = { commands: 0, handlers: 0, providers: 0, entries: 0 };
  const on: PiExtensionHost['on'] = () => {
    registrations.handlers += 1;
  };
  return {
    host: {
      events: bus,
      on,
      registerCommand: () => {
        registrations.commands += 1;
      },
      registerProvider: () => {
        registrations.providers += 1;
      },
      appendEntry: () => {
        registrations.entries += 1;
      },
    },
    registrations,
  };
}

void describe('global Anthropic attribution extension', () => {
  void it('matches all SPS exact-line variants while preserving unrelated blocks and cache controls', () => {
    const original = {
      model: 'claude-sonnet-4-5',
      max_tokens: 64_000,
      system: [
        {
          type: 'text',
          text: ['keep before', ...BAD_SYSTEM_LINES, 'keep after'].join('\n'),
          cache_control: { type: 'ephemeral', ttl: '1h' },
          custom_field: 'preserved',
        },
        { type: 'custom', payload: 'unchanged' },
      ],
      messages: [{ role: 'user', content: 'hello' }],
    };

    const rewritten = rewriteAnthropicRequestPayload({
      payload: original,
      ctx: context(),
      account: {
        deviceId: 'd'.repeat(64),
        accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      },
    });
    assert.ok(isJsonObject(rewritten));
    const system: unknown = rewritten['system'];
    assert.ok(Array.isArray(system));
    const retained = system.find(
      (block) => isJsonObject(block) && block['custom_field'] === 'preserved',
    );
    assert.ok(isJsonObject(retained));
    assert.equal(retained['text'], 'keep before\nkeep after');
    assert.deepEqual(retained['cache_control'], { type: 'ephemeral', ttl: '1h' });
    assert.equal(retained['custom_field'], 'preserved');
    assert.deepEqual(system.at(-1), { type: 'custom', payload: 'unchanged' });
    assert.deepEqual(original.system[0]?.cache_control, { type: 'ephemeral', ttl: '1h' });
    for (const rejected of BAD_SYSTEM_LINES) {
      assert.equal(JSON.stringify(rewritten).includes(rejected), false);
    }
  });

  void it('BUG-192 strips Codex/ZAI opaque and redacted reasoning before Anthropic transport', () => {
    const params = buildAnthropicRequestParams(
      {
        provider: 'anthropic',
        id: 'claude-fable-5-1',
        maxTokens: 128_000,
        reasoning: true,
      },
      {
        messages: [
          { role: 'user', content: 'start' },
          {
            role: 'assistant',
            provider: 'openai-codex',
            api: 'openai-codex-responses',
            model: 'gpt-5.6-sol',
            stopReason: 'stop',
            content: [
              {
                type: 'thinking',
                thinking: 'foreign summary',
                thinkingSignature: '{"id":"foreign-signature"}',
              },
              {
                type: 'thinking',
                thinking: '[foreign redacted]',
                thinkingSignature: 'foreign-redacted-data',
                redacted: true,
              },
              { type: 'text', text: 'answer' },
            ],
          },
          { role: 'user', content: 'continue through ZAI' },
          {
            role: 'assistant',
            provider: 'zai',
            api: 'openai-completions',
            model: 'glm-5.2',
            stopReason: 'stop',
            content: [
              {
                type: 'thinking',
                thinking: 'ZAI summary 😀',
                thinkingSignature: 'reasoning_content',
              },
            ],
          },
          { role: 'user', content: 'continue' },
        ],
      },
      { reasoning: 'high' },
    );
    const serialized = JSON.stringify(params);
    assert.equal(serialized.includes('foreign-signature'), false);
    assert.equal(serialized.includes('foreign summary'), true);
    assert.equal(serialized.includes('foreign-redacted-data'), false);
    assert.equal(serialized.includes('[foreign redacted]'), false);
    assert.equal(serialized.includes('reasoning_content'), false);
    assert.equal(serialized.includes('ZAI summary 😀'), true);
    assert.deepEqual(params['thinking'], {
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'error' },
    });
  });

  void it('BUG-193 owns hookless compaction attribution from request-scoped sessionId', async () => {
    const originalFetch = globalThis.fetch;
    const sessionId = '018f0000-0000-7000-8000-000000000193';
    let captured: Record<string, unknown> | undefined;
    try {
      globalThis.fetch = async (_input, init) => {
        assert.ok(init);
        assert.equal(typeof init.body, 'string');
        captured = JSON.parse(init.body as string) as Record<string, unknown>;
        assert.equal(new Headers(init.headers).get('X-Claude-Code-Session-Id'), sessionId);
        const events = [
          {
            type: 'message_start',
            message: { id: 'msg_package_compaction', usage: { input_tokens: 1 } },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'summary' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ];
        return new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      };
      const result = await streamAnthropicViaBetaMessages(
        {
          provider: 'anthropic',
          api: 'anthropic-messages',
          id: 'claude-fable-5-1',
          baseUrl: 'https://api.anthropic.com',
          maxTokens: 128_000,
          reasoning: true,
          compat: { supportsLongCacheRetention: true, supportsCacheControlOnTools: true },
        },
        {
          systemPrompt: 'Summarize the conversation.',
          messages: [{ role: 'user', content: 'history' }],
        },
        {
          apiKey: 'sk-ant-oat-test',
          sessionId,
          cacheRetention: 'none',
          reasoning: 'high',
        },
        {
          loadAccount: () => ({
            deviceId: 'd'.repeat(64),
            accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          }),
        },
      ).result();
      assert.equal(result.stopReason, 'stop');
      assert.ok(captured);
      assert.equal(JSON.stringify(captured).includes('cache_control'), false);
      const metadata = captured['metadata'];
      assert.ok(isJsonObject(metadata) && typeof metadata['user_id'] === 'string');
      assert.equal(
        (JSON.parse(metadata['user_id']) as Record<string, unknown>)['session_id'],
        sessionId,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it('normalizes observed cross-provider tool-call IDs while preserving valid IDs and images', async () => {
    const originalFetch = globalThis.fetch;
    const invalidToolId = 'call_x|fc_y';
    const validToolId = 'tool_ok-1';
    let captured: Record<string, unknown> | undefined;
    try {
      globalThis.fetch = async (_input, init) => {
        assert.ok(init);
        assert.equal(typeof init.body, 'string');
        captured = JSON.parse(init.body as string) as Record<string, unknown>;
        const events = [
          {
            type: 'message_start',
            message: { id: 'msg_cross_provider_tools', usage: { input_tokens: 1 } },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'done' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ];
        return new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      };

      const result = await streamAnthropicViaBetaMessages(
        {
          provider: 'anthropic',
          api: 'anthropic-messages',
          id: 'claude-fable-5-1',
          baseUrl: 'https://api.anthropic.com',
          maxTokens: 128_000,
          reasoning: true,
          compat: { supportsLongCacheRetention: true, supportsCacheControlOnTools: true },
        },
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Inspect the screenshot and notes.' },
                { type: 'image', mimeType: 'image/png', data: 'Zm9v' },
              ],
            },
            {
              role: 'assistant',
              provider: 'cpa',
              api: 'openai-responses',
              model: 'gpt-5.5',
              stopReason: 'toolUse',
              content: [
                {
                  type: 'toolCall',
                  id: invalidToolId,
                  name: 'read_image',
                  arguments: { path: 'screenshot.png' },
                },
                {
                  type: 'toolCall',
                  id: validToolId,
                  name: 'read',
                  arguments: { path: 'notes.txt' },
                },
              ],
            },
            {
              role: 'toolResult',
              toolCallId: invalidToolId,
              toolName: 'read_image',
              content: [{ type: 'text', text: 'Screenshot parsed.' }],
            },
            {
              role: 'toolResult',
              toolCallId: validToolId,
              toolName: 'read',
              content: [{ type: 'text', text: 'Notes parsed.' }],
            },
          ],
          tools: [
            {
              name: 'read_image',
              description: 'Read an image file',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
            {
              name: 'read',
              description: 'Read a text file',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
          ],
        },
        {
          apiKey: 'sk-ant-oat-test',
          sessionId: '018f0000-0000-7000-8000-0000000001d1',
          cacheRetention: 'none',
          reasoning: 'high',
        },
        {
          loadAccount: () => ({
            deviceId: 'd'.repeat(64),
            accountUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          }),
        },
      ).result();

      assert.ok(captured);
      const outgoingMessages = captured['messages'];
      assert.ok(Array.isArray(outgoingMessages));
      const blocks = (role: string, type: string): Record<string, unknown>[] =>
        outgoingMessages.flatMap((message) => {
          if (!isJsonObject(message) || message['role'] !== role) return [];
          const content = message['content'];
          if (!Array.isArray(content)) return [];
          return content.filter(
            (block): block is Record<string, unknown> =>
              isJsonObject(block) && block['type'] === type,
          );
        });

      assert.deepEqual(blocks('user', 'image'), [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'Zm9v' },
        },
      ]);

      const toolUses = blocks('assistant', 'tool_use');
      assert.equal(toolUses.length, 2);
      const normalizedToolUse = toolUses.find((block) => block['name'] === 'read_image');
      assert.ok(normalizedToolUse);
      assert.deepEqual(normalizedToolUse['input'], { path: 'screenshot.png' });
      const normalizedToolUseId = normalizedToolUse['id'];
      if (typeof normalizedToolUseId !== 'string') {
        throw new TypeError('normalized tool_use.id must be a string');
      }
      assert.match(normalizedToolUseId, /^[a-zA-Z0-9_-]{1,64}$/u);
      assert.notEqual(normalizedToolUseId, invalidToolId);
      assert.equal(toolUses.some((block) => block['id'] === invalidToolId), false);

      const preservedToolUse = toolUses.find((block) => block['name'] === 'read');
      assert.ok(preservedToolUse);
      assert.equal(preservedToolUse['id'], validToolId);
      assert.deepEqual(preservedToolUse['input'], { path: 'notes.txt' });

      const toolResults = blocks('user', 'tool_result');
      const normalizedToolResult = toolResults.find(
        (block) => block['tool_use_id'] === normalizedToolUseId,
      );
      assert.ok(normalizedToolResult);
      assert.deepEqual(normalizedToolResult['content'], [
        { type: 'text', text: 'Screenshot parsed.' },
      ]);
      assert.equal(
        toolResults.some((block) => block['tool_use_id'] === invalidToolId),
        false,
      );

      const preservedToolResult = toolResults.find(
        (block) => block['tool_use_id'] === validToolId,
      );
      assert.ok(preservedToolResult);
      assert.deepEqual(preservedToolResult['content'], [
        { type: 'text', text: 'Notes parsed.' },
      ]);
      assert.equal(result.stopReason, 'stop');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it('leaves non-Anthropic payloads untouched', () => {
    const payload = { model: 'gpt-5.5', metadata: { untouched: true } };
    assert.equal(
      rewriteAnthropicRequestPayload({
        payload,
        ctx: context('openai-codex'),
        account: { deviceId: 'd', accountUuid: 'a' },
      }),
      undefined,
    );
    assert.deepEqual(payload, { model: 'gpt-5.5', metadata: { untouched: true } });
  });

  void it('adds package attribution to attested Anthropic argv only', () => {
    const base = {
      name: 'Attested child',
      model: 'model',
      prompt: 'write report.md',
      reportPath: 'report.md',
    };
    assert.deepEqual(
      buildAttestedPiArgv(
        { ...base, provider: 'anthropic' },
        '/pkg/extensions/anthropic-attribution.ts',
      ),
      [
        'pi',
        '--mode',
        'json',
        '--provider',
        'anthropic',
        '--model',
        'model',
        '--extension',
        '/pkg/extensions/anthropic-attribution.ts',
        'write report.md',
      ],
    );
    assert.deepEqual(buildAttestedPiArgv({ ...base, provider: 'openai-codex' }), [
      'pi',
      '--mode',
      'json',
      '--provider',
      'openai-codex',
      '--model',
      'model',
      'write report.md',
    ]);
    assert.throws(
      () => buildAttestedPiArgv({ ...base, provider: 'anthropic' }),
      /require the package attribution extension/,
    );
  });

  void it('allows exactly one independently loaded copy to own global registration', () => {
    const bus = new SynchronousTestBus();
    const first = recordingHost(bus);
    const second = recordingHost(bus);

    spawnAnthropicAttribution(first.host);
    spawnAnthropicAttribution(second.host);

    assert.equal(first.registrations.commands, 1);
    assert.equal(first.registrations.handlers, 3);
    assert.equal(first.registrations.providers, 1);
    assert.equal(second.registrations.commands, 0);
    assert.equal(second.registrations.handlers, 0);
    assert.equal(second.registrations.providers, 0);
    assert.equal(bus.listenerCount(ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL), 1);
  });
});
