import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  parseQualificationHostArgument,
  resolveQualificationHost,
} from './anthropic-forwarding-host-resolution.ts';

type JsonObject = Record<string, unknown>;

interface QualificationLoader {
  reload(): Promise<void>;
  getExtensions(): unknown;
}

interface QualificationLoaderConstructor {
  new(options: {
    readonly cwd: string;
    readonly agentDir: string;
    readonly settingsManager: unknown;
    readonly additionalExtensionPaths: readonly string[];
    readonly noExtensions: boolean;
    readonly noSkills: boolean;
    readonly noPromptTemplates: boolean;
    readonly noContextFiles: boolean;
    readonly noThemes: boolean;
  }): QualificationLoader;
}

interface QualificationHostApi {
  readonly DefaultResourceLoader: QualificationLoaderConstructor;
  readonly SettingsManager: {
    inMemory(): unknown;
  };
}

interface QualificationAiApi {
  readonly Type: {
    Object(properties: Readonly<Record<string, unknown>>): unknown;
    String(): unknown;
  };
  normalizeContext(input: unknown): unknown;
}

interface QualificationModel {
  readonly id: string;
  readonly name: string;
  readonly api: 'anthropic-messages';
  readonly provider: string;
  readonly baseUrl: string;
  readonly reasoning: boolean;
  readonly input: readonly ['text'];
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly compat?: {
    readonly forceAdaptiveThinking: boolean;
    readonly supportsMidConvoEffort: boolean;
  };
}

interface QualificationTransportOptions {
  readonly apiKey: string;
  readonly cacheRetention: 'none';
  readonly reasoning?: 'high';
  readonly headers: Readonly<Record<string, string>>;
  readonly onPayload: (payload: unknown, model: QualificationModel) => unknown;
  readonly onResponse: (response: unknown, model: QualificationModel) => void;
}

type QualificationTransport = (
  model: QualificationModel,
  context: unknown,
  options: QualificationTransportOptions,
) => unknown;

interface QualificationEventStream extends AsyncIterable<unknown> {
  result(): Promise<unknown>;
}

interface QualificationRuntime {
  readonly pendingProviderRegistrations: readonly unknown[];
  invalidate(reason: string): void;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isObjectLike(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isQualificationHostApi(value: unknown): value is QualificationHostApi {
  if (!isObjectLike(value)) return false;
  const loader = Reflect.get(value, 'DefaultResourceLoader');
  const settings = Reflect.get(value, 'SettingsManager');
  return typeof loader === 'function'
    && isObjectLike(settings)
    && typeof Reflect.get(settings, 'inMemory') === 'function';
}

function isQualificationAiApi(value: unknown): value is QualificationAiApi {
  if (!isObjectLike(value)) return false;
  const type = Reflect.get(value, 'Type');
  return typeof Reflect.get(value, 'normalizeContext') === 'function'
    && isObjectLike(type)
    && typeof Reflect.get(type, 'Object') === 'function'
    && typeof Reflect.get(type, 'String') === 'function';
}

function isQualificationRuntime(value: unknown): value is QualificationRuntime {
  if (!isObjectLike(value)) return false;
  return Array.isArray(Reflect.get(value, 'pendingProviderRegistrations'))
    && typeof Reflect.get(value, 'invalidate') === 'function';
}

function isQualificationTransport(value: unknown): value is QualificationTransport {
  return typeof value === 'function';
}

function isQualificationEventStream(value: unknown): value is QualificationEventStream {
  return isObjectLike(value)
    && typeof Reflect.get(value, 'result') === 'function'
    && typeof Reflect.get(value, Symbol.asyncIterator) === 'function';
}

function assertNormalizedContext(value: unknown, provider: string): asserts value is JsonObject {
  if (!isJsonObject(value) || !Array.isArray(value['messages'])) {
    throw new TypeError(`host pi-ai normalizeContext returned no messages for ${provider}`);
  }
  const leading = value['messages'][0];
  if (!isJsonObject(leading) || leading['role'] !== 'system') {
    throw new TypeError(`host pi-ai normalizeContext returned no leading system message for ${provider}`);
  }
  const toolsAdded = leading['toolsAdded'];
  if (!Array.isArray(toolsAdded) || !isJsonObject(toolsAdded[0]) || toolsAdded[0]['name'] !== 'inspect_state') {
    throw new TypeError(`host pi-ai normalizeContext dropped normalized tool state for ${provider}`);
  }
}

function response(id: string, model: string): Response {
  const events = [
    {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `forwarded-${model}` } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2, output_tokens_details: { thinking_tokens: 1 } },
    },
    { type: 'message_stop' },
  ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const suppliedHostPath = parseQualificationHostArgument(process.argv.slice(2));
const qualificationHost = await resolveQualificationHost(suppliedHostPath);
const hostModule: unknown = await import(qualificationHost.host.entryUrl);
if (!isQualificationHostApi(hostModule)) {
  throw new TypeError(
    `supplied ${qualificationHost.host.name}@${qualificationHost.host.version} lacks DefaultResourceLoader or SettingsManager.inMemory`,
  );
}
const piAiModule: unknown = await import(qualificationHost.piAi.entryUrl);
if (!isQualificationAiApi(piAiModule)) {
  throw new TypeError(
    `resolved ${qualificationHost.piAi.name}@${qualificationHost.piAi.version} lacks Type.Object, Type.String, or normalizeContext`,
  );
}

const agentDir = process.env['PI_CODING_AGENT_DIR'];
if (!agentDir) throw new Error('PI_CODING_AGENT_DIR is required for the isolated fixture');
const loader = new hostModule.DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir,
  settingsManager: hostModule.SettingsManager.inMemory(),
  additionalExtensionPaths: [resolve('extensions/anthropic-attribution.ts')],
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noContextFiles: true,
  noThemes: true,
});
await loader.reload();
const loaded = loader.getExtensions();
if (!isJsonObject(loaded)) throw new TypeError('supplied host loader returned malformed extension state');
const loadErrors = loaded['errors'];
if (!Array.isArray(loadErrors)) throw new TypeError('supplied host loader returned no extension error list');
assert.deepEqual(loadErrors, []);
const runtimeValue = loaded['runtime'];
if (!isQualificationRuntime(runtimeValue)) {
  throw new TypeError('supplied host loader lacks provider registrations or runtime invalidation');
}
const registration = runtimeValue.pendingProviderRegistrations.find(
  (candidate) => isJsonObject(candidate) && candidate['name'] === 'anthropic',
);
if (!isJsonObject(registration) || !isJsonObject(registration['config'])) {
  throw new TypeError('supplied host loader did not register the anthropic provider');
}
const transportValue = registration['config']['streamSimple'];
if (!isQualificationTransport(transportValue)) {
  throw new TypeError('supplied host anthropic provider registration lacks streamSimple');
}

const models: readonly QualificationModel[] = [
  {
    id: 'MiniMax-M3',
    name: 'MiniMax M3',
    api: 'anthropic-messages',
    provider: 'minimax',
    baseUrl: 'https://minimax.pi086.example',
    reasoning: false,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 200_000,
    maxTokens: 8192,
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    api: 'anthropic-messages',
    provider: 'kimi-coding',
    baseUrl: 'https://kimi.pi086.example',
    reasoning: true,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    contextWindow: 262_144,
    maxTokens: 32_768,
    compat: {
      forceAdaptiveThinking: true,
      supportsMidConvoEffort: true,
    },
  },
];

interface CapturedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly payload: JsonObject;
}

const requests: CapturedRequest[] = [];
const callbackProviders: string[] = [];
const results: JsonObject[] = [];
const observedEventTypes: string[][] = [];
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input, init) => {
    const body = init?.body;
    if (typeof body !== 'string') throw new TypeError('forwarded request body must be a string');
    const parsed: unknown = JSON.parse(body);
    if (!isJsonObject(parsed)) throw new TypeError('forwarded request payload must be an object');
    const model = String(Reflect.get(parsed, 'model'));
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      payload: parsed,
    });
    return response(`pi086-${String(requests.length)}`, model);
  };

  for (const model of models) {
    const context = piAiModule.normalizeContext({
      systemPrompt: `Pi 0.86 normalized system for ${model.provider}`,
      tools: [
        {
          name: 'inspect_state',
          description: 'Inspect normalized tool state',
          parameters: piAiModule.Type.Object({ path: piAiModule.Type.String() }),
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Forward ${model.provider} through the matching host adapter.`,
          timestamp: 2,
        },
      ],
    });
    assertNormalizedContext(context, model.provider);

    const streamValue: unknown = transportValue(model, context, {
      apiKey: `${model.provider}-offline-key`,
      cacheRetention: 'none',
      ...(model.reasoning ? { reasoning: 'high' as const } : {}),
      headers: { 'x-route-owner': model.provider },
      onPayload(payload, callbackModel) {
        assert.strictEqual(callbackModel, model);
        callbackProviders.push(`payload:${callbackModel.provider}`);
        return payload;
      },
      onResponse(responseValue, callbackModel) {
        if (!isObjectLike(responseValue)) {
          throw new TypeError('host response callback did not receive a response object');
        }
        assert.equal(Reflect.get(responseValue, 'status'), 200);
        assert.strictEqual(callbackModel, model);
        callbackProviders.push(`response:${callbackModel.provider}`);
      },
    });
    if (!isQualificationEventStream(streamValue)) {
      throw new TypeError(`host streamSimple returned no event stream for ${model.provider}`);
    }

    const eventTypes: string[] = [];
    const partials: object[] = [];
    let terminalMessage: object | undefined;
    for await (const eventValue of streamValue) {
      if (!isJsonObject(eventValue) || typeof eventValue['type'] !== 'string') {
        throw new TypeError(`host stream emitted a malformed event for ${model.provider}`);
      }
      eventTypes.push(eventValue['type']);
      const partial = eventValue['partial'];
      if (partial !== undefined) {
        if (!isObjectLike(partial)) throw new TypeError('host stream partial must be an object');
        partials.push(partial);
      }
      if (eventValue['type'] === 'done') {
        const message = eventValue['message'];
        if (!isObjectLike(message)) throw new TypeError('host done event has no message object');
        terminalMessage = message;
      }
    }
    const resultValue: unknown = await streamValue.result();
    if (!isJsonObject(resultValue)) {
      throw new TypeError(`host stream returned a malformed result for ${model.provider}`);
    }
    const errorMessage = resultValue['errorMessage'];
    assert.equal(resultValue['stopReason'], 'stop', typeof errorMessage === 'string' ? errorMessage : undefined);
    assert.deepEqual(eventTypes, ['start', 'text_start', 'text_delta', 'text_end', 'done']);
    assert.ok(partials.length >= 4);
    assert.ok(partials.every((partial) => partial === partials[0]));
    assert.strictEqual(resultValue, partials[0]);
    assert.strictEqual(resultValue, terminalMessage);
    assert.equal(resultValue['provider'], model.provider);
    assert.equal(resultValue['model'], model.id);
    const usage = resultValue['usage'];
    if (!isJsonObject(usage)) throw new TypeError('host result has no usage object');
    assert.equal(usage['reasoning'], 1);
    assert.equal(JSON.stringify(resultValue['content']).includes(`forwarded-${model.id}`), true);
    observedEventTypes.push(eventTypes);
    results.push(resultValue);
  }

  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    const model = models[index];
    assert.ok(model);
    assert.match(request.url, new RegExp(`^https://${model.provider === 'minimax' ? 'minimax' : 'kimi'}\\.pi086\\.example/`, 'u'));
    assert.equal(request.headers.get('x-api-key'), `${model.provider}-offline-key`);
    assert.equal(request.headers.get('x-route-owner'), model.provider);
    assert.equal(request.headers.get('X-Claude-Code-Session-Id'), null);
    assert.equal(JSON.stringify(request.payload).includes('x-anthropic-billing-header'), false);
    assert.equal(Reflect.get(request.payload, 'metadata'), undefined);
    assert.equal(JSON.stringify(Reflect.get(request.payload, 'system')).includes(`Pi 0.86 normalized system for ${model.provider}`), true);
    assert.equal(JSON.stringify(Reflect.get(request.payload, 'tools')).includes('inspect_state'), true);
  }
  assert.deepEqual(callbackProviders, [
    'payload:minimax',
    'response:minimax',
    'payload:kimi-coding',
    'response:kimi-coding',
  ]);
  const kimiResult = results[1];
  assert.ok(kimiResult);
  assert.equal(kimiResult['providerThinkingLevel'], 'high');
} finally {
  globalThis.fetch = originalFetch;
  runtimeValue.invalidate('explicit host forwarding qualification fixture complete');
}

const kimiResult = results[1];
assert.ok(kimiResult);
process.stdout.write(`${JSON.stringify({
  ok: true,
  hostPackage: qualificationHost.host.name,
  hostPiVersion: qualificationHost.host.version,
  piAiPackage: qualificationHost.piAi.name,
  piAiVersion: qualificationHost.piAi.version,
  loader: 'DefaultResourceLoader',
  providers: results.map((result) => result['provider']),
  fetchCalls: requests.length,
  normalizedSystemAndTools: true,
  eventTypes: observedEventTypes,
  sharedPartialAndResultIdentity: true,
  reasoningUsage: results.map((result) => isJsonObject(result['usage']) ? result['usage']['reasoning'] : undefined),
  kimiProviderThinkingLevel: kimiResult['providerThinkingLevel'],
})}\n`);
