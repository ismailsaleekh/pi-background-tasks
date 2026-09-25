import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
export const CLAUDE_CODE_SESSION_HEADER = 'X-Claude-Code-Session-Id';
const CLAUDE_CODE_VERSION = '2.1.280';
const CLAUDE_CODE_ENTRYPOINT = 'sdk-cli';
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.280 (external, sdk-cli)';
export const ANTHROPIC_1M_CONTEXT_BETA = 'context-1m-2025-08-07';
export const CLAUDE_CODE_200K_SUBSCRIPTION_CONTEXT_WINDOW = 200_000;
const CLAUDE_CODE_LEGACY_BETA_VALUES = [
    'claude-code-20250219',
    'oauth-2025-04-20',
    'interleaved-thinking-2025-05-14',
    'thinking-token-count-2026-05-13',
    'context-management-2025-06-27',
    'prompt-caching-scope-2026-01-05',
    'advisor-tool-2026-03-01',
    'structured-outputs-2025-12-15',
];
const CLAUDE_CODE_ADAPTIVE_200K_BETA_VALUES = [
    'claude-code-20250219',
    'oauth-2025-04-20',
    'interleaved-thinking-2025-05-14',
    'thinking-token-count-2026-05-13',
    'context-management-2025-06-27',
    'prompt-caching-scope-2026-01-05',
    'mid-conversation-system-2026-04-07',
];
const CLAUDE_CODE_FABLE_5_1_200K_BETA_VALUES = [
    ...CLAUDE_CODE_ADAPTIVE_200K_BETA_VALUES,
    'thinking-binding-controls-2026-08-01',
    'cache-diagnosis-2026-04-07',
];
function build200KSubscriptionBetaHeader(values) {
    if (values.includes(ANTHROPIC_1M_CONTEXT_BETA)) {
        throw new Error(`Anthropic attribution 200K subscription policy must not emit ${ANTHROPIC_1M_CONTEXT_BETA}`);
    }
    return values.join(',');
}
export const CLAUDE_CODE_BETA = build200KSubscriptionBetaHeader(CLAUDE_CODE_LEGACY_BETA_VALUES);
const CLAUDE_CODE_ADAPTIVE_200K_BETA = build200KSubscriptionBetaHeader(CLAUDE_CODE_ADAPTIVE_200K_BETA_VALUES);
const CLAUDE_CODE_FABLE_5_1_200K_BETA = build200KSubscriptionBetaHeader(CLAUDE_CODE_FABLE_5_1_200K_BETA_VALUES);
const CLAUDE_AGENT_SDK_SYSTEM_TEXT = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const FINGERPRINT_SALT = '59cf53e54c78';
const AUDIT_ENV = 'PIPELINE_ANTHROPIC_ATTRIBUTION_AUDIT_PATH';
const CACHE_RETENTION_ENV = 'PI_CACHE_RETENTION';
export const ANTHROPIC_ACCOUNT_CONFIG_PATH_ENV = 'PI_ANTHROPIC_ACCOUNT_CONFIG_PATH';
export const ANTHROPIC_CACHE_RETENTION_ENTRY = 'pipeline-anthropic-cache-retention';
const ANTHROPIC_CACHE_RETENTION_SCHEMA = 'pipeline.anthropic_cache_retention.v1';
export const ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL = 'pi-anthropic-attribution:claim:v1';
const ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA = 'pi-anthropic-attribution.claim.v1';
const NATIVE_ATTESTATION_PLACEHOLDER = '00000';
const ANTHROPIC_CACHE_CONTROL_BREAKPOINT_LIMIT = 4;
const ANTHROPIC_LINEAGE_DIAGNOSTIC_TYPE = 'anthropic-cache-lineage';
const ANTHROPIC_LINEAGE_SCHEMA = 'pi-anthropic-attribution.lineage.v1';
// Bump whenever any system/tool/message wire projection changes. Old receipts then
// become legacy and cannot authorize signature replay under a rewritten prefix.
const ANTHROPIC_PROJECTION_VERSION = 3;
const ANTHROPIC_OFFICIAL_ORIGIN = 'https://api.anthropic.com';
const ANTHROPIC_BETA_MESSAGES_URL = `${ANTHROPIC_OFFICIAL_ORIGIN}/v1/messages?beta=true`;
const ANTHROPIC_CACHE_DIAGNOSTICS_BETA = 'cache-diagnosis-2026-04-07';
const ANTHROPIC_THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
const COMPACTION_SUMMARY_PREFIX = 'The conversation history before this point was compacted into the following summary:';
// Sanitization behavior derived from the MIT-licensed ravshansbox/pi-anthropic-sps
// extension at commit 17409b5615f0ec0625776bc5434f92f2c55e3fd0. Keep exact-match
// semantics and all known Pi prompt variants; unrelated system text is preserved.
const ANTHROPIC_SYSTEM_PROMPT_BAD_LINES = new Set([
    '- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)',
    '- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)',
    '- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing',
]);
const parseJsonSource = JSON.parse.bind(JSON);
function parseJsonValue(text, label) {
    try {
        return parseJsonSource(text);
    }
    catch (error) {
        throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function parseJsonObject(text, label) {
    const parsed = parseJsonValue(text, label);
    if (!isPlainObject(parsed))
        throw new Error(`${label} must be a JSON object`);
    return parsed;
}
function claudeCode200KSubscriptionPolicy(modelId, beta, thinkingPolicy, features = {}) {
    if (beta.split(',').includes(ANTHROPIC_1M_CONTEXT_BETA)) {
        throw new Error(`Anthropic attribution 200K subscription policy for ${modelId} must not emit ${ANTHROPIC_1M_CONTEXT_BETA}`);
    }
    return {
        modelId,
        beta,
        thinkingPolicy,
        contextWindow: CLAUDE_CODE_200K_SUBSCRIPTION_CONTEXT_WINDOW,
        enforcesThinkingPrefixBinding: features.enforcesThinkingPrefixBinding === true,
        supportsCacheDiagnostics: features.supportsCacheDiagnostics === true,
    };
}
const CLAUDE_CODE_MODEL_POLICIES = Object.freeze({
    'claude-3-5-haiku-20241022': claudeCode200KSubscriptionPolicy('claude-3-5-haiku-20241022', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-5-haiku-latest': claudeCode200KSubscriptionPolicy('claude-3-5-haiku-latest', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-5-sonnet-20240620': claudeCode200KSubscriptionPolicy('claude-3-5-sonnet-20240620', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-5-sonnet-20241022': claudeCode200KSubscriptionPolicy('claude-3-5-sonnet-20241022', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-7-sonnet-20250219': claudeCode200KSubscriptionPolicy('claude-3-7-sonnet-20250219', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-haiku-20240307': claudeCode200KSubscriptionPolicy('claude-3-haiku-20240307', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-opus-20240229': claudeCode200KSubscriptionPolicy('claude-3-opus-20240229', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-3-sonnet-20240229': claudeCode200KSubscriptionPolicy('claude-3-sonnet-20240229', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-fable-5': claudeCode200KSubscriptionPolicy('claude-fable-5', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-fable-5-1': claudeCode200KSubscriptionPolicy('claude-fable-5-1', CLAUDE_CODE_FABLE_5_1_200K_BETA, 'adaptive-effort', { enforcesThinkingPrefixBinding: true, supportsCacheDiagnostics: true }),
    'claude-haiku-4-5': claudeCode200KSubscriptionPolicy('claude-haiku-4-5', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-haiku-4-5-20251001': claudeCode200KSubscriptionPolicy('claude-haiku-4-5-20251001', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-0': claudeCode200KSubscriptionPolicy('claude-opus-4-0', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-1': claudeCode200KSubscriptionPolicy('claude-opus-4-1', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-1-20250805': claudeCode200KSubscriptionPolicy('claude-opus-4-1-20250805', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-20250514': claudeCode200KSubscriptionPolicy('claude-opus-4-20250514', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-5': claudeCode200KSubscriptionPolicy('claude-opus-4-5', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-5-20251101': claudeCode200KSubscriptionPolicy('claude-opus-4-5-20251101', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-opus-4-6': claudeCode200KSubscriptionPolicy('claude-opus-4-6', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-opus-4-7': claudeCode200KSubscriptionPolicy('claude-opus-4-7', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-opus-4-8': claudeCode200KSubscriptionPolicy('claude-opus-4-8', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-opus-5': claudeCode200KSubscriptionPolicy('claude-opus-5', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-opus-5-5': claudeCode200KSubscriptionPolicy('claude-opus-5-5', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-sonnet-4-0': claudeCode200KSubscriptionPolicy('claude-sonnet-4-0', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-sonnet-4-20250514': claudeCode200KSubscriptionPolicy('claude-sonnet-4-20250514', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-sonnet-4-5': claudeCode200KSubscriptionPolicy('claude-sonnet-4-5', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-sonnet-4-5-20250929': claudeCode200KSubscriptionPolicy('claude-sonnet-4-5-20250929', CLAUDE_CODE_BETA, 'fixed-budget'),
    'claude-sonnet-4-6': claudeCode200KSubscriptionPolicy('claude-sonnet-4-6', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
    'claude-sonnet-5': claudeCode200KSubscriptionPolicy('claude-sonnet-5', CLAUDE_CODE_ADAPTIVE_200K_BETA, 'adaptive-effort'),
});
function transcriptError(message) {
    return new Error(`pi_anthropic_attribution_transcript_unsupported: ${message}`);
}
function isPiTool(value) {
    return (isPlainObject(value) &&
        typeof value['name'] === 'string' &&
        value['name'].length > 0 &&
        (value['description'] === undefined || typeof value['description'] === 'string') &&
        (value['parameters'] === undefined || isPlainObject(value['parameters'])));
}
/** Resolve optional 0.86 APIs at the host gateway, never from the lazy core. */
export function resolveHostTranscriptHelpers(host) {
    const prompt = Reflect.get(host, 'getCurrentSystemPrompt');
    const tools = Reflect.get(host, 'getCurrentTools');
    // Older hosts legitimately have neither helper and still supply legacy Context.
    if (prompt === undefined && tools === undefined)
        return undefined;
    if (typeof prompt !== 'function' || typeof tools !== 'function') {
        throw transcriptError('Pi must supply both getCurrentSystemPrompt and getCurrentTools');
    }
    return {
        getCurrentSystemPrompt(messages) {
            const result = Reflect.apply(prompt, host, [messages]);
            if (typeof result !== 'string')
                throw transcriptError('Pi returned an invalid system prompt');
            return result;
        },
        getCurrentTools(messages) {
            const result = Reflect.apply(tools, host, [messages]);
            if (!Array.isArray(result) || !result.every(isPiTool)) {
                throw transcriptError('Pi returned invalid tool declarations');
            }
            return result;
        },
    };
}
function validateSystemMessage(message) {
    if (typeof message.timestamp !== 'number' || !Number.isFinite(message.timestamp)) {
        throw transcriptError('system message timestamp must be finite');
    }
    if (typeof message.content !== 'string' &&
        (!Array.isArray(message.content) ||
            !message.content.every((block) => isPlainObject(block) && block['type'] === 'text' && typeof block['text'] === 'string'))) {
        throw transcriptError('system message content must be text');
    }
    if (message.sections !== undefined &&
        (!isPlainObject(message.sections) ||
            !Object.values(message.sections).every((value) => value === null || typeof value === 'string'))) {
        throw transcriptError('system message sections must be strings or null');
    }
    if (message.toolsAdded !== undefined &&
        (!Array.isArray(message.toolsAdded) || !message.toolsAdded.every(isPiTool))) {
        throw transcriptError('system message toolsAdded must contain tool declarations');
    }
    if (message.toolsRemoved !== undefined &&
        (!Array.isArray(message.toolsRemoved) ||
            !message.toolsRemoved.every((tool) => isPlainObject(tool) && typeof tool['name'] === 'string' && tool['name'].length > 0))) {
        throw transcriptError('system message toolsRemoved must contain tool names');
    }
}
function resolveAnthropicTranscript(context, helpers) {
    if (!context.messages.some((message) => message.role === 'system'))
        return context;
    if (helpers === undefined) {
        throw transcriptError('system messages require gateway-injected Pi transcript helpers');
    }
    for (const message of context.messages) {
        if (message.role === 'system')
            validateSystemMessage(message);
    }
    // Match Pi's normalizeContext contract for legacy callers carrying both a base
    // prompt/tool set and later transcript deltas. Empty explicit values stay empty.
    const replay = context.systemPrompt !== undefined || context.tools !== undefined
        ? [
            {
                role: 'system',
                content: context.systemPrompt ?? '',
                ...(context.tools === undefined ? {} : { toolsAdded: context.tools }),
                timestamp: 0,
            },
            ...context.messages,
        ]
        : context.messages;
    return {
        systemPrompt: helpers.getCurrentSystemPrompt(replay),
        tools: helpers.getCurrentTools(replay),
        // Normalize before compaction detection, signature-epoch selection, and wire
        // conversion so every lineage proof sees the same conversation-only sequence.
        messages: context.messages.filter((message) => message.role !== 'system'),
    };
}
class LocalAssistantMessageEventStream {
    queue = [];
    waiting = [];
    done = false;
    finalResultPromise;
    resolveFinalResult;
    constructor() {
        this.finalResultPromise = new Promise((resolve) => {
            this.resolveFinalResult = resolve;
        });
    }
    push(event) {
        if (this.done)
            return;
        if (event.type === 'done') {
            this.done = true;
            this.resolveFinalResult(event.message);
        }
        else if (event.type === 'error') {
            this.done = true;
            this.resolveFinalResult(event.error);
        }
        const waiter = this.waiting.shift();
        if (waiter)
            waiter({ value: event, done: false });
        else
            this.queue.push(event);
    }
    end(result) {
        this.done = true;
        if (result !== undefined)
            this.resolveFinalResult(result);
        while (this.waiting.length > 0) {
            this.waiting.shift()?.({ value: undefined, done: true });
        }
    }
    async *[Symbol.asyncIterator]() {
        for (;;) {
            const queued = this.queue.shift();
            if (queued) {
                yield queued;
            }
            else if (this.done) {
                return;
            }
            else {
                const next = await new Promise((resolve) => this.waiting.push(resolve));
                if (next.done)
                    return;
                yield next.value;
            }
        }
    }
    result() {
        return this.finalResultPromise;
    }
}
function createAssistantMessageEventStream() {
    return new LocalAssistantMessageEventStream();
}
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function providerEnvValue(name, env) {
    return env?.[name] ?? process.env[name];
}
function parseCacheRetention(value, source) {
    if (value === 'none' || value === 'short' || value === 'long')
        return value;
    throw new Error(`Anthropic attribution ${source} must be one of none, short, or long; got ${JSON.stringify(value)}`);
}
/** Resolve an explicit request posture. Registered Pi sessions apply the stronger
 * one-hour policy through resolveRegisteredCacheRetention below. */
export function resolveCacheRetentionPreference(options, sessionOverride) {
    if (options?.cacheRetention !== undefined)
        return options.cacheRetention;
    if (sessionOverride !== undefined)
        return sessionOverride;
    const configured = providerEnvValue(CACHE_RETENTION_ENV, options?.env);
    if (configured !== undefined)
        return parseCacheRetention(configured, CACHE_RETENTION_ENV);
    return 'long';
}
function resolveRegisteredCacheRetention(options, sessionOverride) {
    if (options?.cacheRetention === 'none')
        return 'none';
    if (sessionOverride !== undefined)
        return sessionOverride;
    const configured = providerEnvValue(CACHE_RETENTION_ENV, options?.env);
    if (configured !== undefined)
        return parseCacheRetention(configured, CACHE_RETENTION_ENV);
    if (options?.cacheRetention === 'long')
        return 'long';
    // Pi's generic provider default is five minutes. Subscription coding sessions
    // routinely have turns longer than that, so the attributed route pins one hour.
    return 'long';
}
/** Restore the latest branch-local command decision; custom entries stay out of LLM context. */
export function restoreAnthropicSessionCacheRetention(entries) {
    let restored;
    for (const entry of entries) {
        if (!isPlainObject(entry) || entry['type'] !== 'custom')
            continue;
        if (entry['customType'] !== ANTHROPIC_CACHE_RETENTION_ENTRY)
            continue;
        const data = entry['data'];
        if (!isPlainObject(data) ||
            data['schema_version'] !== ANTHROPIC_CACHE_RETENTION_SCHEMA ||
            (data['retention'] !== 'default' &&
                data['retention'] !== 'short' &&
                data['retention'] !== 'long')) {
            throw new Error('Anthropic attribution found a malformed persisted cache retention entry');
        }
        restored = data['retention'] === 'default' ? undefined : data['retention'];
    }
    return restored;
}
function resolveAnthropicCacheControl(model, options) {
    const retention = resolveCacheRetentionPreference(options);
    if (retention === 'none')
        return undefined;
    const ttl = retention === 'long' && (model?.compat?.supportsLongCacheRetention ?? true) ? '1h' : undefined;
    return ttl === undefined ? { type: 'ephemeral' } : { type: 'ephemeral', ttl };
}
function cloneAnthropicCacheControl(value) {
    if (value === undefined)
        return undefined;
    if (!isPlainObject(value)) {
        throw new Error('Anthropic attribution cannot safely process malformed cache_control; expected an object');
    }
    if (value['type'] !== 'ephemeral') {
        throw new Error('Anthropic attribution cannot safely process malformed cache_control.type; expected "ephemeral"');
    }
    const ttl = value['ttl'];
    if (ttl !== undefined && ttl !== '1h' && ttl !== '5m') {
        throw new Error('Anthropic attribution cannot safely process malformed cache_control.ttl; expected "1h" or "5m"');
    }
    return {
        ...value,
        type: 'ephemeral',
        ...(ttl === undefined ? {} : { ttl }),
    };
}
function mergedCacheControl(existing, desired) {
    const existingControl = cloneAnthropicCacheControl(existing);
    if (existingControl === undefined)
        return desired === undefined ? undefined : { ...desired };
    if (desired?.ttl === '1h' && existingControl.ttl !== '1h')
        return { ...existingControl, ttl: '1h' };
    return existingControl;
}
function cloneBlockWithCacheControl(block, desired) {
    const next = { ...block };
    const cacheControl = mergedCacheControl(next['cache_control'], desired);
    if (cacheControl !== undefined)
        next['cache_control'] = cacheControl;
    return next;
}
function stripAnthropicSystemPromptBadLines(text) {
    return text
        .split('\n')
        .filter((line) => !ANTHROPIC_SYSTEM_PROMPT_BAD_LINES.has(line))
        .join('\n');
}
function inspectCacheControls(payload) {
    let count = 0;
    let hasLong = false;
    const inspectBlock = (block) => {
        if (!isPlainObject(block) || block['cache_control'] === undefined)
            return;
        const cacheControl = cloneAnthropicCacheControl(block['cache_control']);
        count += 1;
        if (cacheControl?.ttl === '1h')
            hasLong = true;
    };
    const system = payload['system'];
    if (Array.isArray(system)) {
        for (const block of system)
            inspectBlock(block);
    }
    const tools = payload['tools'];
    if (Array.isArray(tools)) {
        for (const tool of tools)
            inspectBlock(tool);
    }
    const messages = payload['messages'];
    if (Array.isArray(messages)) {
        for (const message of messages) {
            if (!isPlainObject(message))
                continue;
            const content = message['content'];
            if (Array.isArray(content)) {
                for (const block of content)
                    inspectBlock(block);
            }
        }
    }
    return { count, retention: count === 0 ? undefined : hasLong ? 'long' : 'short' };
}
function cacheControlOccurrences(payload) {
    const occurrences = [];
    const inspectBlocks = (value, path) => {
        if (!Array.isArray(value))
            return;
        value.forEach((block, index) => {
            if (!isPlainObject(block))
                return;
            const blockPath = `${path}[${String(index)}]`;
            if (block['cache_control'] !== undefined) {
                const control = cloneAnthropicCacheControl(block['cache_control']);
                if (control !== undefined)
                    occurrences.push({ path: blockPath, control });
            }
            if (block['type'] === 'tool_result')
                inspectBlocks(block['content'], `${blockPath}.content`);
        });
    };
    if (payload['cache_control'] !== undefined) {
        const control = cloneAnthropicCacheControl(payload['cache_control']);
        if (control !== undefined)
            occurrences.push({ path: '$', control });
    }
    inspectBlocks(payload['system'], '$.system');
    inspectBlocks(payload['tools'], '$.tools');
    const messages = payload['messages'];
    if (Array.isArray(messages)) {
        messages.forEach((message, index) => {
            if (isPlainObject(message))
                inspectBlocks(message['content'], `$.messages[${String(index)}].content`);
        });
    }
    return occurrences;
}
function countCacheControlBreakpoints(payload) {
    return cacheControlOccurrences(payload).length;
}
function cacheControlTopologySha256(payload) {
    return sha256Canonical(cacheControlOccurrences(payload));
}
function assertCacheControlBreakpointLimit(payload) {
    const count = countCacheControlBreakpoints(payload);
    if (count > ANTHROPIC_CACHE_CONTROL_BREAKPOINT_LIMIT) {
        throw new Error(`Anthropic attribution produced ${count} cache_control breakpoints; Anthropic supports at most ${ANTHROPIC_CACHE_CONTROL_BREAKPOINT_LIMIT}`);
    }
}
function assertNonEmptyString(value, fieldName, configPath) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Anthropic attribution config ${configPath} missing/malformed required field ${fieldName}`);
    }
    return value;
}
export function extractClaudeAttributionAccount(parsedConfig, configPath) {
    if (!isPlainObject(parsedConfig)) {
        throw new Error(`Anthropic attribution config ${configPath} is not a JSON object`);
    }
    const oauthAccount = parsedConfig['oauthAccount'];
    if (!isPlainObject(oauthAccount)) {
        throw new Error(`Anthropic attribution config ${configPath} missing/malformed required field oauthAccount.accountUuid`);
    }
    return {
        deviceId: assertNonEmptyString(parsedConfig['userID'], 'userID', configPath),
        accountUuid: assertNonEmptyString(oauthAccount['accountUuid'], 'oauthAccount.accountUuid', configPath),
    };
}
export function resolveClaudeAttributionConfigPath(explicitConfigPath, env, homeDirectory = homedir()) {
    const configuredPath = providerEnvValue(ANTHROPIC_ACCOUNT_CONFIG_PATH_ENV, env);
    const selectedPath = explicitConfigPath ?? configuredPath ?? join(homeDirectory, '.claude.json');
    const source = explicitConfigPath !== undefined
        ? 'explicit configPath'
        : configuredPath !== undefined
            ? ANTHROPIC_ACCOUNT_CONFIG_PATH_ENV
            : 'default ~/.claude.json path';
    if (selectedPath.trim().length === 0 || !isAbsolute(selectedPath)) {
        throw new Error(`Anthropic attribution ${source} must be a non-empty absolute file path; got ${JSON.stringify(selectedPath)}`);
    }
    return selectedPath;
}
export function loadClaudeAttributionAccount(configPath, env) {
    const selectedPath = resolveClaudeAttributionConfigPath(configPath, env);
    let configText;
    try {
        configText = readFileSync(selectedPath, 'utf8');
    }
    catch (error) {
        throw new Error(`Anthropic attribution config ${selectedPath} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    return extractClaudeAttributionAccount(parseJsonValue(configText, `Anthropic attribution config ${selectedPath}`), selectedPath);
}
export function isAnthropicContext(ctx) {
    return ctx.model?.provider === 'anthropic';
}
function requireSessionId(value, source) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Anthropic attribution requires a non-empty ${source}`);
    }
    return value;
}
function getSessionId(ctx) {
    return requireSessionId(ctx.sessionManager.getSessionId(), 'Pi session id');
}
function normalizedAnthropicModelId(model) {
    if (typeof model.id !== 'string' || model.id.trim().length === 0) {
        throw new Error('Anthropic attribution requires a non-empty model id');
    }
    const providerPrefix = 'anthropic/';
    return model.id.startsWith(providerPrefix) ? model.id.slice(providerPrefix.length) : model.id;
}
export function resolveClaudeCodeModelPolicy(model) {
    const modelId = normalizedAnthropicModelId(model);
    const policy = CLAUDE_CODE_MODEL_POLICIES[modelId];
    if (policy === undefined) {
        throw new Error(`Anthropic attribution has no Claude Code model policy for ${modelId}`);
    }
    return policy;
}
export function resolveAnthropicMaxTokens(model) {
    return assertPositiveInteger(model.maxTokens, `model.maxTokens for ${normalizedAnthropicModelId(model)}`);
}
export function computeClaudeCodeFingerprint(messageText, version = CLAUDE_CODE_VERSION) {
    const chars = [4, 7, 20].map((index) => messageText[index] || '0').join('');
    return createHash('sha256')
        .update(`${FINGERPRINT_SALT}${chars}${version}`)
        .digest('hex')
        .slice(0, 3);
}
function firstUserMessageTextFromPayload(payload) {
    const messages = payload['messages'];
    if (!Array.isArray(messages))
        return '';
    for (const message of messages) {
        if (!isPlainObject(message) || message['role'] !== 'user')
            continue;
        const content = message['content'];
        if (typeof content === 'string')
            return content;
        if (Array.isArray(content)) {
            const textBlock = content.find((block) => isPlainObject(block) && block['type'] === 'text' && typeof block['text'] === 'string');
            if (isPlainObject(textBlock) && typeof textBlock['text'] === 'string')
                return textBlock['text'];
        }
    }
    return '';
}
export function buildClaudeCodeBillingSystemText(firstUserMessageText) {
    const fingerprint = computeClaudeCodeFingerprint(firstUserMessageText);
    return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; cch=${NATIVE_ATTESTATION_PLACEHOLDER};`;
}
export function buildAnthropicAttributionHeaders(sessionId, model) {
    const beta = model === undefined ? CLAUDE_CODE_BETA : resolveClaudeCodeModelPolicy(model).beta;
    return {
        [CLAUDE_CODE_SESSION_HEADER]: sessionId,
        'anthropic-beta': beta,
        'anthropic-version': '2023-06-01',
        'User-Agent': CLAUDE_CODE_USER_AGENT,
        'x-app': 'cli',
        'anthropic-dangerous-direct-browser-access': 'true',
    };
}
export function registerAnthropicAttributionProvider(pi, ctx, getSessionOverride = () => undefined, dependencies = {}) {
    if (!isAnthropicContext(ctx))
        return;
    pi.registerProvider('anthropic', {
        api: 'anthropic-messages',
        headers: buildAnthropicAttributionHeaders(getSessionId(ctx), ctx.model),
        streamSimple: (model, context, options) => streamAnthropicViaBetaMessages(model, context, {
            ...(options ?? {}),
            cacheRetention: resolveRegisteredCacheRetention(options, getSessionOverride()),
        }, dependencies),
    });
}
function assertPositiveInteger(value, fieldName) {
    if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) {
        throw new Error(`Anthropic attribution cannot safely process malformed ${fieldName}; expected a positive integer`);
    }
    return value;
}
function rewriteThinking(payload, maxTokens) {
    if (payload['thinking'] === undefined)
        return { thinking: undefined, budgetTokens: undefined };
    if (!isPlainObject(payload['thinking'])) {
        throw new Error('Anthropic attribution cannot safely process malformed thinking; expected an object');
    }
    const thinking = { ...payload['thinking'] };
    if (thinking['type'] === 'disabled')
        return { thinking: { type: 'disabled' }, budgetTokens: undefined };
    if (thinking['budget_tokens'] === undefined)
        return { thinking, budgetTokens: undefined };
    const existingBudget = assertPositiveInteger(thinking['budget_tokens'], 'thinking.budget_tokens');
    if (maxTokens !== undefined && existingBudget >= maxTokens) {
        thinking['budget_tokens'] = maxTokens - 1;
    }
    if (typeof thinking['budget_tokens'] === 'number' && thinking['budget_tokens'] <= 0) {
        throw new Error('Anthropic attribution cannot satisfy thinking.budget_tokens < max_tokens when max_tokens <= 1');
    }
    return { thinking, budgetTokens: thinking['budget_tokens'] };
}
function isClaudeCodeIdentityText(text) {
    return (text.startsWith('x-anthropic-billing-header:') ||
        text === CLAUDE_AGENT_SDK_SYSTEM_TEXT ||
        text === "You are Claude Code, Anthropic's official CLI for Claude." ||
        text ===
            "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.");
}
function normalizeSystemBlock(block) {
    if (!isPlainObject(block))
        return block;
    const next = { ...block };
    if (typeof next['text'] === 'string')
        next['text'] = stripAnthropicSystemPromptBadLines(next['text']);
    if (next['cache_control'] !== undefined)
        next['cache_control'] = cloneAnthropicCacheControl(next['cache_control']);
    return next;
}
function hasCacheControl(block) {
    return isPlainObject(block) && block['cache_control'] !== undefined;
}
function isSystemCacheSurface(block) {
    return isPlainObject(block) && typeof block['text'] === 'string';
}
function markSystemCacheSurface(blocks, desired) {
    const output = blocks.map((block) => (isPlainObject(block) ? { ...block } : block));
    if (desired === undefined)
        return output;
    let lastTextBlockIndex = -1;
    for (let index = 0; index < output.length; index += 1) {
        if (isSystemCacheSurface(output[index]))
            lastTextBlockIndex = index;
    }
    if (lastTextBlockIndex === -1)
        return output;
    const withLongRetentionUpgrades = desired.ttl === '1h'
        ? output.map((block) => hasCacheControl(block) ? cloneBlockWithCacheControl(block, desired) : block)
        : output;
    withLongRetentionUpgrades[lastTextBlockIndex] = cloneBlockWithCacheControl(withLongRetentionUpgrades[lastTextBlockIndex], desired);
    return withLongRetentionUpgrades;
}
function withClaudeCodeSystemIdentity(system, billingSystemText, cacheControl) {
    const identityBlocks = [
        { type: 'text', text: billingSystemText },
        { type: 'text', text: CLAUDE_AGENT_SDK_SYSTEM_TEXT },
    ];
    if (system === undefined)
        return markSystemCacheSurface(identityBlocks, cacheControl);
    if (Array.isArray(system)) {
        const withoutPriorIdentity = system
            .filter((entry) => {
            if (!isPlainObject(entry) || typeof entry['text'] !== 'string')
                return true;
            return !isClaudeCodeIdentityText(entry['text']);
        })
            .map(normalizeSystemBlock);
        return markSystemCacheSurface([...identityBlocks, ...withoutPriorIdentity], cacheControl);
    }
    if (typeof system === 'string') {
        return markSystemCacheSurface([...identityBlocks, { type: 'text', text: stripAnthropicSystemPromptBadLines(system) }], cacheControl);
    }
    throw new Error('Anthropic attribution cannot safely apply Claude Code system identity to malformed system payload');
}
function appendAuditRecord(args) {
    const auditPath = process.env[AUDIT_ENV];
    if (auditPath === undefined || auditPath.length === 0)
        return;
    const record = {
        schema_version: 'pipeline.anthropic_attribution_audit.v1',
        provider: args.provider,
        header_name: CLAUDE_CODE_SESSION_HEADER,
        header_registered: args.headerRegistered,
        anthropic_beta: args.beta,
        anthropic_version: '2023-06-01',
        beta_resource_path: args.betaResourcePath,
        native_attestation: args.nativeAttestation,
        metadata_user_id_keys: ['account_uuid', 'device_id', 'session_id'],
        metadata_session_id_matches_header: args.metadataSessionMatchesHeader,
        account_uuid_present: true,
        device_id_present: true,
        max_tokens: args.maxTokens,
        thinking_budget_tokens: args.thinkingBudgetTokens,
    };
    appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}
function requireAttributionAccount(value) {
    if (!isPlainObject(value) ||
        typeof value['deviceId'] !== 'string' ||
        value['deviceId'].trim().length === 0 ||
        typeof value['accountUuid'] !== 'string' ||
        value['accountUuid'].trim().length === 0) {
        throw new Error('Anthropic attribution account loader returned malformed account identity');
    }
    return { deviceId: value['deviceId'], accountUuid: value['accountUuid'] };
}
function anthropicMetadataUserId(account, sessionId) {
    return JSON.stringify({
        account_uuid: account.accountUuid,
        device_id: account.deviceId,
        session_id: sessionId,
    });
}
function rewriteAnthropicRequestPayloadForSession(args) {
    if (!isPlainObject(args.payload)) {
        throw new Error('Anthropic attribution expected provider payload to be a JSON object');
    }
    const sessionId = requireSessionId(args.sessionId, 'provider options.sessionId');
    const metadata = args.payload['metadata'] === undefined ? {} : args.payload['metadata'];
    if (!isPlainObject(metadata)) {
        throw new Error('Anthropic attribution expected payload.metadata to be an object when present');
    }
    const policy = resolveClaudeCodeModelPolicy(args.model);
    const maxTokens = args.payload['max_tokens'] === undefined
        ? undefined
        : assertPositiveInteger(args.payload['max_tokens'], 'max_tokens');
    const { thinking, budgetTokens } = rewriteThinking(args.payload, maxTokens);
    const billingSystemText = buildClaudeCodeBillingSystemText(firstUserMessageTextFromPayload(args.payload));
    const incomingCache = inspectCacheControls(args.payload);
    // The provider builder has already resolved environment/session defaults and
    // selected the cache surfaces. No incoming marker can therefore be Pi's
    // explicit call-level `cacheRetention: "none"` (used for compaction). Reapplying
    // the process default here would silently defeat that opt-out.
    const configuredCacheRetention = args.cacheRetention ?? incomingCache.retention;
    const cacheControl = configuredCacheRetention === undefined
        ? undefined
        : resolveAnthropicCacheControl(args.model, {
            cacheRetention: configuredCacheRetention,
        });
    const rewritten = {
        ...args.payload,
        metadata: {
            ...metadata,
            user_id: anthropicMetadataUserId(args.account, sessionId),
        },
        system: withClaudeCodeSystemIdentity(args.payload['system'], billingSystemText, cacheControl),
    };
    if (thinking !== undefined)
        rewritten['thinking'] = thinking;
    assertCacheControlBreakpointLimit(rewritten);
    appendAuditRecord({
        provider: 'anthropic',
        headerRegistered: args.headerRegistered ?? true,
        metadataSessionMatchesHeader: true,
        maxTokens,
        thinkingBudgetTokens: budgetTokens,
        beta: policy.beta,
        betaResourcePath: '/v1/messages?beta=true',
        nativeAttestation: 'placeholder-pending-live',
    });
    return rewritten;
}
function assertProtectedAnthropicAttribution(args) {
    if (args.payload['model'] !== args.modelId || args.payload['stream'] !== true) {
        throw new Error('Anthropic protected attribution model/stream route changed during payload middleware');
    }
    const metadata = args.payload['metadata'];
    if (!isPlainObject(metadata) ||
        metadata['user_id'] !== anthropicMetadataUserId(args.account, args.sessionId)) {
        throw new Error('Anthropic protected attribution metadata.user_id/account/device/session_id changed during payload middleware');
    }
    const system = args.payload['system'];
    if (!Array.isArray(system)) {
        throw new Error('Anthropic protected attribution system identity was removed during payload middleware');
    }
    const billingBlocks = system.filter((block) => isPlainObject(block) &&
        typeof block['text'] === 'string' &&
        block['text'].startsWith('x-anthropic-billing-header:'));
    const sdkBlocks = system.filter((block) => isPlainObject(block) && block['text'] === CLAUDE_AGENT_SDK_SYSTEM_TEXT);
    if (billingBlocks.length !== 1 ||
        billingBlocks[0]?.['text'] !== args.billingSystemText ||
        sdkBlocks.length !== 1 ||
        system[0] !== billingBlocks[0] ||
        system[1] !== sdkBlocks[0]) {
        throw new Error('Anthropic protected attribution system identity changed during payload middleware');
    }
    assertCacheControlBreakpointLimit(args.payload);
    if (cacheControlTopologySha256(args.payload) !== args.cacheControlTopologySha256) {
        throw new Error('Anthropic protected cache-control topology changed during payload middleware');
    }
}
export function rewriteAnthropicRequestPayload(args) {
    if (!isAnthropicContext(args.ctx))
        return undefined;
    return rewriteAnthropicRequestPayloadForSession({
        payload: args.payload,
        model: args.ctx.model ?? {},
        sessionId: getSessionId(args.ctx),
        account: args.account,
        ...(args.headerRegistered === undefined ? {} : { headerRegistered: args.headerRegistered }),
        ...(args.cacheRetention === undefined ? {} : { cacheRetention: args.cacheRetention }),
    });
}
function sanitizeSurrogates(text) {
    let sanitized = '';
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = index + 1 < text.length ? text.charCodeAt(index + 1) : -1;
            if (next >= 0xdc00 && next <= 0xdfff) {
                sanitized += text[index] ?? '';
                sanitized += text[index + 1] ?? '';
                index += 1;
            }
            else {
                sanitized += '\uFFFD';
            }
        }
        else if (code >= 0xdc00 && code <= 0xdfff) {
            sanitized += '\uFFFD';
        }
        else {
            sanitized += text[index] ?? '';
        }
    }
    return sanitized;
}
function convertContentBlocks(content) {
    const blocks = content.map((block) => {
        if (block.type === 'text')
            return { type: 'text', text: sanitizeSurrogates(block.text) };
        return {
            type: 'image',
            source: { type: 'base64', media_type: block.mimeType, data: block.data },
        };
    });
    if (blocks.length === 0)
        blocks.push({ type: 'text', text: '' });
    if (!blocks.some((block) => block['type'] === 'text'))
        blocks.unshift({ type: 'text', text: '(see attached image)' });
    return blocks;
}
function cloneMessageForCacheControl(message) {
    const content = message['content'];
    return {
        ...message,
        ...(Array.isArray(content)
            ? { content: content.map((block) => (isPlainObject(block) ? { ...block } : block)) }
            : {}),
    };
}
function isCacheableConversationBlock(role, block) {
    if (role === 'assistant')
        return block['type'] === 'text';
    return block['type'] === 'text' || block['type'] === 'image' || block['type'] === 'tool_result';
}
function markMessageContentCacheSurface(message, cacheControl) {
    const role = message['role'];
    if (role !== 'user' && role !== 'assistant')
        return false;
    const content = message['content'];
    if (typeof content === 'string') {
        throw new Error('Anthropic attribution cache projection encountered non-canonical string message content');
    }
    if (!Array.isArray(content))
        return false;
    for (let index = content.length - 1; index >= 0; index -= 1) {
        const block = content[index];
        if (!isPlainObject(block) || !isCacheableConversationBlock(role, block))
            continue;
        content[index] = cloneBlockWithCacheControl(block, cacheControl);
        return true;
    }
    return false;
}
function markLastConversationCacheSurface(messages, cacheControl) {
    const output = messages.map(cloneMessageForCacheControl);
    if (cacheControl === undefined)
        return output;
    for (let index = output.length - 1; index >= 0; index -= 1) {
        const message = output[index];
        if (message !== undefined && markMessageContentCacheSurface(message, cacheControl))
            break;
    }
    return output;
}
function canonicalizeJson(value) {
    if (Array.isArray(value))
        return value.map(canonicalizeJson);
    if (!isPlainObject(value))
        return value;
    const output = {};
    for (const key of Object.keys(value).sort()) {
        const child = value[key];
        if (child !== undefined)
            output[key] = canonicalizeJson(child);
    }
    return output;
}
function canonicalJson(value) {
    return JSON.stringify(canonicalizeJson(value));
}
function sha256Canonical(value) {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function blockWithoutCacheControl(block) {
    if (!isPlainObject(block))
        return block;
    const output = { ...block };
    delete output['cache_control'];
    return output;
}
function promptMessagesWithoutCacheControls(messages) {
    return messages.map((message) => {
        const content = message['content'];
        return {
            ...message,
            ...(Array.isArray(content) ? { content: content.map(blockWithoutCacheControl) } : {}),
        };
    });
}
function promptMessagesHash(messages) {
    return sha256Canonical(promptMessagesWithoutCacheControls(messages));
}
function assistantContentHash(content) {
    return sha256Canonical(content);
}
function parseAnthropicLineageDetails(message) {
    const diagnostic = [...(message.diagnostics ?? [])]
        .reverse()
        .find((candidate) => candidate.type === ANTHROPIC_LINEAGE_DIAGNOSTIC_TYPE);
    const details = diagnostic?.details;
    if (!isPlainObject(details))
        return undefined;
    const sourceModel = details['source_model'];
    const responseId = details['response_id'];
    const assistantContentSha256 = details['assistant_content_sha256'];
    const conversationStaticSha256 = details['conversation_static_sha256'];
    const requestMessageCount = details['request_message_count'];
    const requestMessagesSha256 = details['request_messages_sha256'];
    const cacheProfileSha256 = details['cache_profile_sha256'];
    const cacheRetention = details['cache_retention'];
    const compactionBoundarySha256 = details['compaction_boundary_sha256'];
    const signatureEpochSha256 = details['signature_epoch_sha256'];
    const signatureEpochInheritsPrior = details['signature_epoch_inherits_prior'];
    const previousMessageId = details['previous_message_id'];
    if (details['schema_version'] !== ANTHROPIC_LINEAGE_SCHEMA ||
        details['projection_version'] !== ANTHROPIC_PROJECTION_VERSION ||
        details['source_provider'] !== 'anthropic' ||
        details['source_api'] !== 'anthropic-messages' ||
        !isNonEmptyString(sourceModel) ||
        !isNonEmptyString(responseId) ||
        !isSha256(assistantContentSha256) ||
        !isSha256(conversationStaticSha256) ||
        typeof requestMessageCount !== 'number' ||
        !Number.isSafeInteger(requestMessageCount) ||
        requestMessageCount < 0 ||
        !isSha256(requestMessagesSha256) ||
        !isSha256(cacheProfileSha256) ||
        (cacheRetention !== 'none' && cacheRetention !== 'short' && cacheRetention !== 'long') ||
        (compactionBoundarySha256 !== null && !isSha256(compactionBoundarySha256)) ||
        !isSha256(signatureEpochSha256) ||
        typeof signatureEpochInheritsPrior !== 'boolean' ||
        (previousMessageId !== null && !isNonEmptyString(previousMessageId))) {
        return undefined;
    }
    return {
        schema_version: ANTHROPIC_LINEAGE_SCHEMA,
        projection_version: ANTHROPIC_PROJECTION_VERSION,
        source_provider: 'anthropic',
        source_api: 'anthropic-messages',
        source_model: sourceModel,
        response_id: responseId,
        assistant_content_sha256: assistantContentSha256,
        conversation_static_sha256: conversationStaticSha256,
        request_message_count: requestMessageCount,
        request_messages_sha256: requestMessagesSha256,
        cache_profile_sha256: cacheProfileSha256,
        cache_retention: cacheRetention,
        compaction_boundary_sha256: compactionBoundarySha256,
        signature_epoch_sha256: signatureEpochSha256,
        signature_epoch_inherits_prior: signatureEpochInheritsPrior,
        previous_message_id: previousMessageId,
    };
}
function isSuccessfulLineageStopReason(stopReason) {
    return stopReason === 'stop' || stopReason === 'length' || stopReason === 'toolUse';
}
function lineageBindsContainingAssistant(message, lineage) {
    return (message.provider === lineage.source_provider &&
        message.api === lineage.source_api &&
        isNonEmptyString(message.model) &&
        message.model === lineage.source_model &&
        isSuccessfulLineageStopReason(message.stopReason) &&
        isNonEmptyString(message.responseId) &&
        message.responseId === lineage.response_id &&
        lineage.assistant_content_sha256 === assistantContentHash(message.content));
}
function canTargetReadAnthropicThinking(sourceModel, targetModel) {
    if (sourceModel === targetModel)
        return true;
    return (targetModel === 'claude-fable-5-1' && CLAUDE_CODE_MODEL_POLICIES[sourceModel] !== undefined);
}
function initialSignatureEpochPolicy(targetModelId, cacheRetention, compactionBoundarySha256) {
    return {
        sha256: sha256Canonical({
            projection_version: ANTHROPIC_PROJECTION_VERSION,
            kind: 'initial',
            target_model: targetModelId,
            cache_retention: cacheRetention,
            compaction_boundary_sha256: compactionBoundarySha256,
        }),
        inheritsPrior: compactionBoundarySha256 === null,
    };
}
function resolveSignatureEpochPolicy(model, messages, cacheRetention, compactionBoundarySha256) {
    const targetModelId = normalizedAnthropicModelId(model);
    const latestState = targetLineageState({ messages }, targetModelId);
    if (latestState.kind === 'none') {
        return initialSignatureEpochPolicy(targetModelId, cacheRetention, compactionBoundarySha256);
    }
    if (latestState.kind === 'untrusted') {
        return {
            sha256: sha256Canonical({
                projection_version: ANTHROPIC_PROJECTION_VERSION,
                kind: 'untrusted-lineage-reset',
                target_model: targetModelId,
                cache_retention: cacheRetention,
                compaction_boundary_sha256: compactionBoundarySha256,
                latest_assistant_sha256: latestState.assistantSha256,
            }),
            inheritsPrior: false,
        };
    }
    const latest = latestState.lineage;
    const retentionChanged = latest.cache_retention !== cacheRetention;
    const declaredNewCompaction = compactionBoundarySha256 !== null &&
        compactionBoundarySha256 !== latest.compaction_boundary_sha256;
    if (retentionChanged || declaredNewCompaction) {
        return {
            sha256: sha256Canonical({
                projection_version: ANTHROPIC_PROJECTION_VERSION,
                kind: 'transition',
                previous_signature_epoch_sha256: latest.signature_epoch_sha256,
                target_model: targetModelId,
                cache_retention: cacheRetention,
                compaction_boundary_sha256: compactionBoundarySha256,
                reason: retentionChanged ? 'cache-retention' : 'compaction',
            }),
            inheritsPrior: false,
        };
    }
    return {
        sha256: latest.signature_epoch_sha256,
        inheritsPrior: latest.signature_epoch_inherits_prior,
    };
}
function isTrustedReplayableAnthropicAssistant(message, targetModel, targetCacheRetention, conversationStaticSha256, wireMessagesBeforeAssistant) {
    if (typeof message.model !== 'string')
        return false;
    const lineage = parseAnthropicLineageDetails(message);
    if (lineage === undefined ||
        !lineageBindsContainingAssistant(message, lineage) ||
        !canTargetReadAnthropicThinking(message.model, normalizedAnthropicModelId(targetModel)) ||
        lineage.cache_retention !== targetCacheRetention ||
        lineage.conversation_static_sha256 !== conversationStaticSha256 ||
        lineage.request_message_count !== wireMessagesBeforeAssistant.length ||
        lineage.request_messages_sha256 !== promptMessagesHash(wireMessagesBeforeAssistant)) {
        return false;
    }
    return true;
}
function normalizeAnthropicToolCallId(id) {
    if (/^[a-zA-Z0-9_-]{1,64}$/u.test(id))
        return id;
    const safe = id.replace(/[^a-zA-Z0-9_-]/gu, '_');
    const digest = createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 12);
    const prefix = safe.slice(0, 64 - digest.length - 1) || 'tool';
    return `${prefix}_${digest}`.slice(0, 64);
}
function projectedUserContent(content) {
    if (typeof content === 'string') {
        return content.trim().length > 0 ? [{ type: 'text', text: sanitizeSurrogates(content) }] : [];
    }
    const blocks = [];
    for (const block of content) {
        if (block.type === 'text') {
            if (block.text.trim().length > 0)
                blocks.push({ type: 'text', text: sanitizeSurrogates(block.text) });
            continue;
        }
        if (block.type === 'image') {
            blocks.push({
                type: 'image',
                source: { type: 'base64', media_type: block.mimeType, data: block.data },
            });
            continue;
        }
        throw new Error('Anthropic attribution encountered an unsupported user content block');
    }
    return blocks;
}
function compactionBoundarySha256FromPiMessages(messages) {
    const first = messages[0];
    if (first?.role !== 'user')
        return null;
    const content = projectedUserContent(first.content);
    return declaredCompactionBoundarySha256([{ role: 'user', content }]);
}
function convertMessages(model, messages, conversationStaticSha256, cacheRetention, signatureEpoch, cacheControl) {
    const params = [];
    const toolCallIdMap = new Map();
    const normalizedToolCallOwners = new Map();
    let pendingToolCalls = [];
    let completedPendingToolCallIds = new Set();
    const normalizeToolCallId = (id) => {
        const existing = toolCallIdMap.get(id);
        if (existing !== undefined)
            return existing;
        const normalized = normalizeAnthropicToolCallId(id);
        const owner = normalizedToolCallOwners.get(normalized);
        if (owner !== undefined && owner !== id) {
            throw new Error('Anthropic attribution tool-call ID normalization collision');
        }
        normalizedToolCallOwners.set(normalized, id);
        toolCallIdMap.set(id, normalized);
        return normalized;
    };
    const flushMissingToolResults = () => {
        const missing = pendingToolCalls.filter((call) => !completedPendingToolCallIds.has(call.id));
        if (missing.length > 0) {
            params.push({
                role: 'user',
                content: missing.map((call) => ({
                    type: 'tool_result',
                    tool_use_id: call.id,
                    content: 'No result provided',
                    is_error: true,
                })),
            });
        }
        pendingToolCalls = [];
        completedPendingToolCallIds = new Set();
    };
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message === undefined)
            throw new TypeError(`Anthropic message ${index} is missing`);
        if (message.role === 'user') {
            flushMissingToolResults();
            const content = projectedUserContent(message.content);
            if (content.length > 0)
                params.push({ role: 'user', content });
            continue;
        }
        if (message.role === 'assistant') {
            flushMissingToolResults();
            if (message.stopReason === 'error' || message.stopReason === 'aborted')
                continue;
            const lineage = parseAnthropicLineageDetails(message);
            const epochAllowsReplay = signatureEpoch.inheritsPrior || lineage?.signature_epoch_sha256 === signatureEpoch.sha256;
            const preserveThinking = epochAllowsReplay &&
                isTrustedReplayableAnthropicAssistant(message, model, cacheRetention, conversationStaticSha256, params);
            const content = [];
            for (const block of message.content) {
                if (block['type'] === 'text') {
                    if (typeof block['text'] !== 'string')
                        throw new Error('Anthropic attribution encountered malformed assistant text');
                    if (block['text'].trim().length > 0)
                        content.push({ type: 'text', text: sanitizeSurrogates(block['text']) });
                    continue;
                }
                if (block['type'] === 'thinking') {
                    if (typeof block['thinking'] !== 'string')
                        throw new Error('Anthropic attribution encountered malformed assistant thinking');
                    const signature = typeof block['thinkingSignature'] === 'string' ? block['thinkingSignature'] : '';
                    if (preserveThinking && signature.trim().length > 0) {
                        content.push(block['redacted'] === true
                            ? { type: 'redacted_thinking', data: signature }
                            : {
                                type: 'thinking',
                                // A signature authenticates the exact provider-returned reasoning bytes.
                                // Provenance and lineage checks above make this raw replay safe; changing
                                // even valid non-BMP Unicode here would invalidate the opaque signature.
                                thinking: block['thinking'],
                                signature,
                            });
                    }
                    else if (block['redacted'] !== true && block['thinking'].trim().length > 0) {
                        content.push({ type: 'text', text: sanitizeSurrogates(block['thinking']) });
                    }
                    continue;
                }
                if (block['type'] === 'toolCall') {
                    if (typeof block['id'] !== 'string' || typeof block['name'] !== 'string')
                        throw new Error('Anthropic attribution encountered malformed assistant tool call');
                    const id = normalizeToolCallId(block['id']);
                    content.push({
                        type: 'tool_use',
                        id,
                        name: block['name'],
                        input: canonicalizeJson(block['arguments'] ?? {}),
                    });
                    continue;
                }
                throw new Error(`Anthropic attribution encountered unsupported assistant block type ${JSON.stringify(block['type'])}`);
            }
            if (content.length > 0) {
                params.push({ role: 'assistant', content });
                pendingToolCalls = content
                    .filter((block) => block['type'] === 'tool_use')
                    .map((block) => ({ id: String(block['id']), name: String(block['name']) }));
            }
            continue;
        }
        if (message.role !== 'toolResult') {
            throw new Error(`Anthropic attribution encountered unsupported message role ${JSON.stringify(Reflect.get(message, 'role'))}`);
        }
        const toolResults = [];
        let lookahead = index;
        while (lookahead < messages.length && messages[lookahead]?.role === 'toolResult') {
            const result = messages[lookahead];
            const toolUseId = normalizeToolCallId(result.toolCallId);
            completedPendingToolCallIds.add(toolUseId);
            toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: convertContentBlocks(result.content),
                is_error: result.isError === true,
            });
            lookahead += 1;
        }
        index = lookahead - 1;
        if (toolResults.length > 0)
            params.push({ role: 'user', content: toolResults });
    }
    flushMissingToolResults();
    return markLastConversationCacheSurface(params, cacheControl);
}
function convertTools(tools, cacheControl) {
    if (!tools || tools.length === 0)
        return [];
    return tools.map((tool, index) => {
        const parameters = isPlainObject(tool.parameters) ? tool.parameters : {};
        const converted = {
            name: tool.name,
            description: tool.description ?? '',
            input_schema: {
                type: 'object',
                properties: canonicalizeJson(isPlainObject(parameters['properties']) ? parameters['properties'] : {}),
                required: Array.isArray(parameters['required']) ? [...parameters['required']] : [],
            },
        };
        return cacheControl !== undefined && index === tools.length - 1
            ? cloneBlockWithCacheControl(converted, cacheControl)
            : converted;
    });
}
function thinkingBudgetFor(level, maxTokens, custom) {
    if (level === 'max') {
        throw new Error('Anthropic attribution reasoning=max requires an adaptive-effort model');
    }
    const defaults = {
        minimal: 1024,
        low: 4096,
        medium: 10240,
        high: 20480,
        xhigh: 32768,
        off: 0,
    };
    const requested = level === 'off' ? 0 : (custom?.[level] ?? defaults[level]);
    return Math.min(maxTokens - 1, requested);
}
function adaptiveEffortFor(level) {
    switch (level) {
        case 'low':
        case 'medium':
        case 'high':
        case 'xhigh':
        case 'max':
            return level;
        case 'minimal':
            throw new Error('Anthropic attribution cannot map Pi reasoning=minimal to Claude adaptive effort; use low, medium, high, xhigh, or max');
    }
}
function conversationStaticHash(system, tools) {
    const normalizedSystem = system
        .filter((block) => !isPlainObject(block) ||
        typeof block['text'] !== 'string' ||
        !isClaudeCodeIdentityText(block['text']))
        .map(blockWithoutCacheControl);
    return sha256Canonical({
        attribution_profile: {
            claude_code_version: CLAUDE_CODE_VERSION,
            entrypoint: CLAUDE_CODE_ENTRYPOINT,
        },
        system: normalizedSystem,
        tools: tools.map(blockWithoutCacheControl),
    });
}
export function buildAnthropicRequestParams(model, context, options, dependencies = {}) {
    return buildAnthropicRequest(model, resolveAnthropicTranscript(context, dependencies.hostTranscriptHelpers), options).params;
}
function buildAnthropicRequest(model, context, options) {
    const policy = resolveClaudeCodeModelPolicy(model);
    const maxTokens = resolveAnthropicMaxTokens(model);
    const cacheControl = resolveAnthropicCacheControl(model, options);
    const cacheRetention = cacheControl === undefined ? 'none' : cacheControl.ttl === '1h' ? 'long' : 'short';
    let signatureEpoch = resolveSignatureEpochPolicy(model, context.messages, cacheRetention, compactionBoundarySha256FromPiMessages(context.messages));
    const system = context.systemPrompt && context.systemPrompt.trim().length > 0
        ? markSystemCacheSurface([
            {
                type: 'text',
                text: sanitizeSurrogates(stripAnthropicSystemPromptBadLines(context.systemPrompt)),
            },
        ], cacheControl)
        : [];
    const tools = convertTools(context.tools, model.compat?.supportsCacheControlOnTools === false ? undefined : cacheControl);
    const staticSha256 = conversationStaticHash(system, tools);
    const params = {
        model: policy.modelId,
        messages: convertMessages(model, context.messages, staticSha256, cacheRetention, signatureEpoch, cacheControl),
        max_tokens: maxTokens,
        stream: true,
        tools,
    };
    if (system.length > 0)
        params['system'] = system;
    if (options?.toolChoice !== undefined)
        params['tool_choice'] = canonicalizeJson(options.toolChoice);
    const reasoning = options?.reasoning;
    if (model.reasoning && reasoning !== undefined) {
        if (reasoning === 'off') {
            if (policy.enforcesThinkingPrefixBinding) {
                throw new Error('Anthropic attribution cannot disable thinking for Claude Fable 5.1');
            }
            params['thinking'] = { type: 'disabled' };
            params['temperature'] = options?.temperature ?? 1;
        }
        else if (policy.thinkingPolicy === 'adaptive-effort') {
            params['thinking'] = {
                type: 'adaptive',
                ...(policy.enforcesThinkingPrefixBinding
                    ? { block_binding: { prefix_mismatch_behavior: 'error' } }
                    : {}),
            };
            params['output_config'] = { effort: adaptiveEffortFor(reasoning) };
        }
        else {
            params['thinking'] = {
                type: 'enabled',
                budget_tokens: thinkingBudgetFor(reasoning, maxTokens, options?.thinkingBudgets),
            };
        }
    }
    else if (policy.enforcesThinkingPrefixBinding) {
        params['thinking'] = {
            type: 'adaptive',
            block_binding: { prefix_mismatch_behavior: 'error' },
        };
    }
    else {
        params['thinking'] = { type: 'disabled' };
        params['temperature'] = options?.temperature ?? 1;
    }
    const previous = latestLineageForTarget(context, normalizedAnthropicModelId(model));
    if (previous !== undefined &&
        signatureEpoch.sha256 === previous.signature_epoch_sha256 &&
        (previous.cache_profile_sha256 !== cacheProfileHash(model, policy, params, staticSha256) ||
            !hasLineageRequestPrefix(requestMessagesFromPayload(params), previous))) {
        // Resume/reload and profile edits can invalidate a lane. Re-project before transport,
        // rather than just clearing the response ID while retaining prefix-bound signatures.
        signatureEpoch = {
            sha256: sha256Canonical({
                projection_version: ANTHROPIC_PROJECTION_VERSION,
                kind: 'lineage-reset',
                previous_signature_epoch_sha256: previous.signature_epoch_sha256,
                previous_response_id: previous.response_id,
                cache_profile_sha256: cacheProfileHash(model, policy, params, staticSha256),
                request_messages_sha256: promptMessagesHash(requestMessagesFromPayload(params)),
            }),
            inheritsPrior: false,
        };
        params['messages'] = convertMessages(model, context.messages, staticSha256, cacheRetention, signatureEpoch, cacheControl);
    }
    assertCacheControlBreakpointLimit(params);
    return { params, signatureEpoch };
}
function requestMessagesFromPayload(payload) {
    const messages = payload['messages'];
    if (!Array.isArray(messages) || messages.some((message) => !isPlainObject(message))) {
        throw new Error('Anthropic attribution final payload.messages must be an object array');
    }
    for (const message of messages) {
        if (message['role'] !== 'user' && message['role'] !== 'assistant') {
            throw new Error('Anthropic attribution final payload message has an unsupported role');
        }
        const content = message['content'];
        if (!Array.isArray(content) || content.some((block) => !isPlainObject(block))) {
            throw new Error('Anthropic attribution final payload message content must use canonical block arrays');
        }
    }
    return messages;
}
function systemBlocksFromPayload(payload) {
    const system = payload['system'];
    if (system === undefined)
        return [];
    if (typeof system === 'string')
        return [{ type: 'text', text: system }];
    if (!Array.isArray(system))
        throw new Error('Anthropic attribution final payload.system must be a string or block array');
    return system;
}
function toolsFromPayload(payload) {
    const tools = payload['tools'];
    if (tools === undefined)
        return [];
    if (!Array.isArray(tools) || tools.some((tool) => !isPlainObject(tool))) {
        throw new Error('Anthropic attribution final payload.tools must be an object array');
    }
    return tools;
}
function cacheProfileHash(model, policy, payload, staticSha256) {
    return sha256Canonical({
        projection_version: ANTHROPIC_PROJECTION_VERSION,
        model: normalizedAnthropicModelId(model),
        beta: policy.beta,
        conversation_static_sha256: staticSha256,
        thinking: payload['thinking'],
        output_config: payload['output_config'],
        tool_choice: payload['tool_choice'],
    });
}
function cacheRetentionFromPayload(payload) {
    return inspectCacheControls(payload).retention ?? 'none';
}
function untrustedAssistantSha256(message) {
    return sha256Canonical({
        provider: message.provider ?? null,
        api: message.api ?? null,
        model: message.model ?? null,
        response_id: message.responseId ?? null,
        stop_reason: message.stopReason ?? null,
        assistant_content_sha256: assistantContentHash(message.content),
        lineage_diagnostics: (message.diagnostics ?? []).filter((diagnostic) => diagnostic.type === ANTHROPIC_LINEAGE_DIAGNOSTIC_TYPE),
    });
}
function targetLineageState(context, targetModelId) {
    for (let index = context.messages.length - 1; index >= 0; index -= 1) {
        const message = context.messages[index];
        if (message?.role !== 'assistant')
            continue;
        const lineageDiagnostics = (message.diagnostics ?? []).filter((diagnostic) => diagnostic.type === ANTHROPIC_LINEAGE_DIAGNOSTIC_TYPE);
        const latestRawDetails = lineageDiagnostics.at(-1)?.details;
        const receiptClaimsTarget = latestRawDetails?.['source_model'] === targetModelId;
        const assistantClaimsTarget = message.model === targetModelId;
        if (!assistantClaimsTarget && !receiptClaimsTarget)
            continue;
        if ((message.stopReason === 'error' || message.stopReason === 'aborted') &&
            lineageDiagnostics.length === 0) {
            continue;
        }
        const lineage = parseAnthropicLineageDetails(message);
        if (lineage?.source_model === targetModelId &&
            lineageBindsContainingAssistant(message, lineage)) {
            return { kind: 'trusted', lineage };
        }
        return { kind: 'untrusted', assistantSha256: untrustedAssistantSha256(message) };
    }
    return { kind: 'none' };
}
function latestLineageForTarget(context, targetModelId) {
    const state = targetLineageState(context, targetModelId);
    return state.kind === 'trusted' ? state.lineage : undefined;
}
function declaredCompactionBoundarySha256(messages) {
    const firstMessage = messages[0];
    if (firstMessage?.['role'] !== 'user' || !Array.isArray(firstMessage['content']))
        return null;
    const declaresCompaction = firstMessage['content'].some((block) => isPlainObject(block) &&
        block['type'] === 'text' &&
        typeof block['text'] === 'string' &&
        block['text'].startsWith(COMPACTION_SUMMARY_PREFIX));
    if (!declaresCompaction)
        return null;
    return sha256Canonical(promptMessagesWithoutCacheControls([firstMessage])[0]);
}
function hasLineageRequestPrefix(messages, previous) {
    return (messages.length >= previous.request_message_count &&
        promptMessagesHash(messages.slice(0, previous.request_message_count)) ===
            previous.request_messages_sha256);
}
function prepareAnthropicLineageDetails(args) {
    const targetModelId = normalizedAnthropicModelId(args.model);
    const messages = requestMessagesFromPayload(args.payload);
    const staticSha256 = conversationStaticHash(systemBlocksFromPayload(args.payload), toolsFromPayload(args.payload));
    const profileSha256 = cacheProfileHash(args.model, args.policy, args.payload, staticSha256);
    const cacheRetention = cacheRetentionFromPayload(args.payload);
    const compactionBoundarySha256 = declaredCompactionBoundarySha256(messages);
    const signatureEpoch = args.signatureEpoch;
    let previous = latestLineageForTarget(args.context, targetModelId);
    if (previous !== undefined &&
        (signatureEpoch.sha256 !== previous.signature_epoch_sha256 ||
            !hasLineageRequestPrefix(messages, previous) ||
            previous.cache_profile_sha256 !== profileSha256 ||
            previous.cache_retention !== cacheRetention)) {
        previous = undefined;
    }
    return {
        schema_version: ANTHROPIC_LINEAGE_SCHEMA,
        projection_version: ANTHROPIC_PROJECTION_VERSION,
        source_provider: 'anthropic',
        source_api: 'anthropic-messages',
        source_model: targetModelId,
        conversation_static_sha256: staticSha256,
        request_message_count: messages.length,
        request_messages_sha256: promptMessagesHash(messages),
        cache_profile_sha256: profileSha256,
        cache_retention: cacheRetention,
        compaction_boundary_sha256: compactionBoundarySha256,
        signature_epoch_sha256: signatureEpoch.sha256,
        signature_epoch_inherits_prior: signatureEpoch.inheritsPrior,
        previous_message_id: previous?.response_id ?? null,
    };
}
class AnthropicLineageCoordinator {
    inFlight = new Set();
    prepare(args) {
        const targetModelId = normalizedAnthropicModelId(args.model);
        const key = `${args.sessionId}\u0000${targetModelId}`;
        if (this.inFlight.has(key)) {
            throw new Error(`Anthropic cache lineage already has an in-flight request for ${targetModelId}; concurrent continuations must fork`);
        }
        const details = prepareAnthropicLineageDetails(args);
        this.inFlight.add(key);
        return { key, details };
    }
    release(prepared) {
        this.inFlight.delete(prepared.key);
    }
}
const anthropicLineageCoordinator = new AnthropicLineageCoordinator();
export function createAnthropicLineageDiagnostic(args) {
    if (!isNonEmptyString(args.responseId)) {
        throw new Error('Anthropic lineage diagnostic requires a non-empty response ID');
    }
    if (args.previousMessageId !== undefined && args.previousMessageId !== null) {
        if (!isNonEmptyString(args.previousMessageId)) {
            throw new Error('Anthropic lineage diagnostic requires a non-empty previous response ID');
        }
    }
    const policy = resolveClaudeCodeModelPolicy(args.model);
    const messages = requestMessagesFromPayload(args.requestPayload);
    const staticSha256 = conversationStaticHash(systemBlocksFromPayload(args.requestPayload), toolsFromPayload(args.requestPayload));
    const cacheRetention = cacheRetentionFromPayload(args.requestPayload);
    const compactionBoundarySha256 = declaredCompactionBoundarySha256(messages);
    const signatureEpoch = initialSignatureEpochPolicy(normalizedAnthropicModelId(args.model), cacheRetention, compactionBoundarySha256);
    return {
        type: ANTHROPIC_LINEAGE_DIAGNOSTIC_TYPE,
        timestamp: Date.now(),
        details: {
            schema_version: ANTHROPIC_LINEAGE_SCHEMA,
            projection_version: ANTHROPIC_PROJECTION_VERSION,
            source_provider: 'anthropic',
            source_api: 'anthropic-messages',
            source_model: normalizedAnthropicModelId(args.model),
            response_id: args.responseId,
            assistant_content_sha256: assistantContentHash(args.assistantContent),
            conversation_static_sha256: staticSha256,
            request_message_count: messages.length,
            request_messages_sha256: promptMessagesHash(messages),
            cache_profile_sha256: cacheProfileHash(args.model, policy, args.requestPayload, staticSha256),
            cache_retention: cacheRetention,
            compaction_boundary_sha256: compactionBoundarySha256,
            signature_epoch_sha256: signatureEpoch.sha256,
            signature_epoch_inherits_prior: signatureEpoch.inheritsPrior,
            previous_message_id: args.previousMessageId ?? null,
        },
    };
}
function appendLineageDiagnostic(output, prepared) {
    if (!isNonEmptyString(output.responseId)) {
        throw new Error('Anthropic attribution successful response is missing responseId lineage proof');
    }
    output.diagnostics ??= [];
    output.diagnostics.push({
        type: ANTHROPIC_LINEAGE_DIAGNOSTIC_TYPE,
        timestamp: Date.now(),
        details: {
            ...prepared.details,
            response_id: output.responseId,
            assistant_content_sha256: assistantContentHash(output.content),
        },
    });
}
function appendProviderCacheDiagnostic(output, messageStart) {
    const diagnostics = messageStart['diagnostics'];
    const inputTransformations = messageStart['input_transformations'];
    if (diagnostics === undefined && inputTransformations === undefined)
        return;
    output.diagnostics ??= [];
    output.diagnostics.push({
        type: 'anthropic-provider-cache',
        timestamp: Date.now(),
        details: {
            cache_diagnostics: canonicalizeJson(diagnostics ?? null),
            input_transformations: canonicalizeJson(inputTransformations ?? []),
        },
    });
}
function headersToRecord(headers) {
    return Object.fromEntries([...headers.entries()]);
}
function lowerHeaderMap(headers) {
    const output = {};
    for (const [key, value] of Object.entries(headers ?? {}))
        output[key.toLowerCase()] = value;
    return output;
}
function resolveAnthropicBetaMessagesUrl(model) {
    const configured = typeof model.baseUrl === 'string' && model.baseUrl.trim().length > 0
        ? model.baseUrl.trim()
        : ANTHROPIC_OFFICIAL_ORIGIN;
    let parsed;
    try {
        parsed = new URL(configured);
    }
    catch (error) {
        throw new Error(`Anthropic attribution requires the official Anthropic HTTPS endpoint; invalid model.baseUrl: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (parsed.origin !== ANTHROPIC_OFFICIAL_ORIGIN ||
        parsed.protocol !== 'https:' ||
        parsed.username.length > 0 ||
        parsed.password.length > 0 ||
        (parsed.pathname !== '' && parsed.pathname !== '/') ||
        parsed.search.length > 0 ||
        parsed.hash.length > 0) {
        throw new Error(`Anthropic attribution requires the official Anthropic HTTPS endpoint ${ANTHROPIC_OFFICIAL_ORIGIN}; refusing model.baseUrl ${JSON.stringify(configured)}`);
    }
    return ANTHROPIC_BETA_MESSAGES_URL;
}
function buildFetchHeaders(options, apiKey, sessionHeader, beta) {
    const optionHeaders = lowerHeaderMap(options?.headers);
    return {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': optionHeaders['user-agent'] ?? CLAUDE_CODE_USER_AGENT,
        [CLAUDE_CODE_SESSION_HEADER]: sessionHeader ?? optionHeaders['x-claude-code-session-id'] ?? '',
        'anthropic-beta': beta,
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-version': '2023-06-01',
        'x-app': 'cli',
    };
}
function mapStopReason(reason) {
    switch (reason) {
        case 'end_turn':
        case 'pause_turn':
        case 'stop_sequence':
            return 'stop';
        case 'max_tokens':
            return 'length';
        case 'tool_use':
            return 'toolUse';
        default:
            return 'error';
    }
}
function parseStreamingJsonFragment(text) {
    try {
        return parseJsonSource(text);
    }
    catch {
        return {};
    }
}
function parseCompletedToolInput(text) {
    const parsed = parseJsonValue(text, 'Anthropic streamed tool input');
    if (!isPlainObject(parsed)) {
        throw new Error('Anthropic streamed tool input must complete as a JSON object');
    }
    return parsed;
}
function anthropicStreamErrorMessage(event) {
    const error = event['error'];
    if (isPlainObject(error) && typeof error['message'] === 'string') {
        const type = typeof error['type'] === 'string' ? `${error['type']}: ` : '';
        return `Anthropic beta messages stream error: ${type}${error['message']}`;
    }
    return 'Anthropic beta messages stream emitted an error event';
}
function validCostRate(value, fallback, field) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`Anthropic attribution model cost.${field} must be a finite non-negative number`);
    }
    return value;
}
function resolveModelCostRates(model, totalInputTokens) {
    let selected = model.cost;
    let matchedThreshold = -1;
    for (const tier of model.cost?.tiers ?? []) {
        const threshold = tier.inputTokensAbove;
        if (typeof threshold === 'number' &&
            Number.isFinite(threshold) &&
            threshold >= 0 &&
            totalInputTokens > threshold &&
            threshold > matchedThreshold) {
            selected = tier;
            matchedThreshold = threshold;
        }
    }
    return {
        input: validCostRate(selected?.input, 3, 'input'),
        output: validCostRate(selected?.output, 15, 'output'),
        cacheRead: validCostRate(selected?.cacheRead, 0.3, 'cacheRead'),
        cacheWrite: validCostRate(selected?.cacheWrite, 3.75, 'cacheWrite'),
    };
}
export function updateAnthropicUsage(output, usage, model) {
    if (!usage)
        return;
    if (typeof usage['input_tokens'] === 'number')
        output.usage.input = usage['input_tokens'];
    if (typeof usage['output_tokens'] === 'number')
        output.usage.output = usage['output_tokens'];
    if (typeof usage['cache_read_input_tokens'] === 'number')
        output.usage.cacheRead = usage['cache_read_input_tokens'];
    const cacheCreation = usage['cache_creation'];
    const reportedLongCacheWrite = isPlainObject(cacheCreation) && typeof cacheCreation['ephemeral_1h_input_tokens'] === 'number'
        ? cacheCreation['ephemeral_1h_input_tokens']
        : undefined;
    if (typeof usage['cache_creation_input_tokens'] === 'number') {
        output.usage.cacheWrite = usage['cache_creation_input_tokens'];
        output.usage.cacheWrite1h = reportedLongCacheWrite ?? 0;
    }
    else if (reportedLongCacheWrite !== undefined) {
        output.usage.cacheWrite1h = reportedLongCacheWrite;
    }
    const longCacheWrite = output.usage.cacheWrite1h ?? 0;
    if (!Number.isFinite(longCacheWrite) ||
        !Number.isInteger(longCacheWrite) ||
        longCacheWrite < 0 ||
        longCacheWrite > output.usage.cacheWrite) {
        throw new Error('Anthropic attribution received malformed 1h cache usage exceeding total cache writes');
    }
    output.usage.totalTokens =
        output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
    const rates = resolveModelCostRates(model, output.usage.input + output.usage.cacheRead + output.usage.cacheWrite);
    const shortCacheWrite = output.usage.cacheWrite - longCacheWrite;
    output.usage.cost.input = (output.usage.input * rates.input) / 1_000_000;
    output.usage.cost.output = (output.usage.output * rates.output) / 1_000_000;
    output.usage.cost.cacheRead = (output.usage.cacheRead * rates.cacheRead) / 1_000_000;
    output.usage.cost.cacheWrite =
        (shortCacheWrite * rates.cacheWrite + longCacheWrite * rates.input * 2) / 1_000_000;
    output.usage.cost.total =
        output.usage.cost.input +
            output.usage.cost.output +
            output.usage.cost.cacheRead +
            output.usage.cost.cacheWrite;
}
async function* iterateSseEvents(response, signal) {
    if (!response.body)
        throw new Error('Anthropic beta messages response had no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = '';
    let dataLines = [];
    function flush() {
        if (dataLines.length === 0) {
            eventName = '';
            return undefined;
        }
        const data = dataLines.join('\n');
        const declaredEventName = eventName;
        eventName = '';
        dataLines = [];
        if (data === '[DONE]')
            return undefined;
        const event = parseJsonObject(data, 'Anthropic beta messages SSE event');
        if (declaredEventName.length > 0 &&
            (typeof event['type'] !== 'string' || event['type'] !== declaredEventName)) {
            throw new Error(`Anthropic beta messages SSE event name ${JSON.stringify(declaredEventName)} did not match data.type`);
        }
        return event;
    }
    function consumeLine(line) {
        if (line.length === 0)
            return flush();
        if (line.startsWith(':'))
            return undefined;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' '))
            value = value.slice(1);
        if (field === 'event')
            eventName = value;
        if (field === 'data')
            dataLines.push(value);
        return undefined;
    }
    try {
        for (;;) {
            if (signal?.aborted)
                throw new Error('Request was aborted');
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            for (;;) {
                const match = /\r\n|\n|\r/.exec(buffer);
                if (match?.index === undefined)
                    break;
                const line = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                const event = consumeLine(line);
                if (event)
                    yield event;
            }
        }
        buffer += decoder.decode();
        if (buffer.length > 0) {
            const event = consumeLine(buffer);
            if (event)
                yield event;
        }
        const trailing = flush();
        if (trailing)
            yield trailing;
    }
    finally {
        reader.releaseLock();
    }
}
function createOutput(model) {
    return {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
    };
}
function forwardToBuiltInAnthropic(model, context, options, dependencies) {
    // The compiled gateway resolves this host-owned adapter through Pi's alias-aware
    // extension loader and injects it across the lazy native-import boundary. Keeping
    // the deferred core free of runtime Pi package imports prevents Node from trying to
    // resolve a private @earendil-works/pi-ai installation beside a managed package.
    const hostAnthropicMessagesApi = dependencies.hostAnthropicMessagesApi;
    if (hostAnthropicMessagesApi === undefined) {
        throw new Error("pi_anthropic_attribution_host_adapter_missing: the extension gateway did not inject Pi's anthropic-messages adapter");
    }
    // The host owns both its legacy Context or normalized TranscriptContext input and
    // the complete stream/event/result shape. These intersections only mark that
    // host-owned boundary; no request, callback, event, or result is reconstructed.
    const delegated = hostAnthropicMessagesApi().streamSimple(model, context, options);
    return delegated;
}
export function streamAnthropicViaBetaMessages(model, context, options, dependencies = {}) {
    if (model.provider !== 'anthropic') {
        return forwardToBuiltInAnthropic(model, context, options, dependencies);
    }
    const stream = createAssistantMessageEventStream();
    const output = createOutput(model);
    void (async () => {
        let preparedLineage;
        try {
            const apiKey = options?.apiKey;
            if (typeof apiKey !== 'string' || apiKey.length === 0) {
                throw new Error('Anthropic attribution requires Pi OAuth apiKey/token; no credential was supplied');
            }
            if (!apiKey.includes('sk-ant-oat')) {
                throw new Error('Anthropic attribution refuses non-OAuth Anthropic credential; subscription OAuth token is required');
            }
            // Pi documents StreamOptions.sessionId as optional; its own one-off requests mint a
            // fresh routing id. Do the same for callers that omit it, so they get a
            // request-local lineage lane. A supplied but malformed id is still refused.
            const sessionId = options?.sessionId === undefined
                ? randomUUID()
                : requireSessionId(options.sessionId, 'options.sessionId');
            const account = requireAttributionAccount(dependencies.loadAccount?.() ?? loadClaudeAttributionAccount(undefined, options?.env));
            const url = resolveAnthropicBetaMessagesUrl(model);
            const policy = resolveClaudeCodeModelPolicy(model);
            const requestContext = resolveAnthropicTranscript(context, dependencies.hostTranscriptHelpers);
            const request = buildAnthropicRequest(model, requestContext, options);
            let params = request.params;
            const billingSystemText = buildClaudeCodeBillingSystemText(firstUserMessageTextFromPayload(params));
            const provisionalLineage = prepareAnthropicLineageDetails({
                model,
                policy,
                context: requestContext,
                payload: params,
                signatureEpoch: request.signatureEpoch,
            });
            if (policy.supportsCacheDiagnostics) {
                if (!policy.beta.split(',').includes(ANTHROPIC_CACHE_DIAGNOSTICS_BETA)) {
                    throw new Error('Anthropic cache diagnostics policy is missing its required beta header');
                }
                params['diagnostics'] = {
                    previous_message_id: provisionalLineage.previous_message_id,
                };
            }
            if (policy.enforcesThinkingPrefixBinding &&
                !policy.beta.split(',').includes(ANTHROPIC_THINKING_BINDING_BETA)) {
                throw new Error('Anthropic thinking-binding policy is missing its required beta header');
            }
            params = rewriteAnthropicRequestPayloadForSession({
                payload: params,
                model,
                sessionId,
                account,
                headerRegistered: true,
                ...(options?.cacheRetention === undefined
                    ? {}
                    : { cacheRetention: options.cacheRetention }),
            });
            const protectedCacheControlTopologySha256 = cacheControlTopologySha256(params);
            const nextParams = await options?.onPayload?.(params, model);
            if (nextParams !== undefined) {
                if (!isPlainObject(nextParams))
                    throw new Error('Anthropic attribution onPayload returned a non-object payload');
                params = nextParams;
            }
            assertProtectedAnthropicAttribution({
                payload: params,
                account,
                sessionId,
                billingSystemText,
                modelId: policy.modelId,
                cacheControlTopologySha256: protectedCacheControlTopologySha256,
            });
            preparedLineage = anthropicLineageCoordinator.prepare({
                sessionId,
                model,
                policy,
                context: requestContext,
                payload: params,
                signatureEpoch: request.signatureEpoch,
            });
            if (preparedLineage.details.previous_message_id !== provisionalLineage.previous_message_id ||
                preparedLineage.details.conversation_static_sha256 !==
                    provisionalLineage.conversation_static_sha256 ||
                preparedLineage.details.request_message_count !==
                    provisionalLineage.request_message_count ||
                preparedLineage.details.request_messages_sha256 !==
                    provisionalLineage.request_messages_sha256 ||
                preparedLineage.details.cache_profile_sha256 !== provisionalLineage.cache_profile_sha256 ||
                preparedLineage.details.cache_retention !== provisionalLineage.cache_retention ||
                preparedLineage.details.compaction_boundary_sha256 !==
                    provisionalLineage.compaction_boundary_sha256 ||
                preparedLineage.details.signature_epoch_sha256 !==
                    provisionalLineage.signature_epoch_sha256 ||
                preparedLineage.details.signature_epoch_inherits_prior !==
                    provisionalLineage.signature_epoch_inherits_prior) {
                throw new Error('Anthropic request/cache lineage changed during before_provider_request transforms');
            }
            if (policy.supportsCacheDiagnostics) {
                const diagnostics = params['diagnostics'];
                if (!isPlainObject(diagnostics) ||
                    diagnostics['previous_message_id'] !== preparedLineage.details.previous_message_id) {
                    throw new Error('Anthropic cache diagnostics were removed or changed during before_provider_request transforms');
                }
            }
            const headers = buildFetchHeaders(options, apiKey, sessionId, policy.beta);
            const requestInit = {
                method: 'POST',
                headers,
                body: JSON.stringify(params),
                redirect: 'error',
            };
            if (options?.signal)
                requestInit.signal = options.signal;
            const response = await fetch(url, requestInit);
            await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
            if (!response.ok) {
                throw new Error(`Anthropic beta messages request failed: HTTP ${response.status} ${response.statusText}: ${await response.text()}`);
            }
            const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
            if (!contentType.includes('text/event-stream')) {
                throw new Error(`Anthropic beta messages response must be text/event-stream; got ${JSON.stringify(contentType || '(missing)')}`);
            }
            stream.push({ type: 'start', partial: output });
            const blocks = output.content;
            const activeContentIndexes = new Set();
            let sawMessageStart = false;
            let sawMessageStop = false;
            let sawTerminalStopReason = false;
            for await (const event of iterateSseEvents(response, options?.signal)) {
                const eventType = event['type'];
                if (typeof eventType !== 'string') {
                    throw new Error('Anthropic beta messages SSE event is missing string data.type');
                }
                if (eventType === 'error')
                    throw new Error(anthropicStreamErrorMessage(event));
                if (eventType === 'ping')
                    continue;
                if (sawMessageStop) {
                    throw new Error('Anthropic beta messages stream emitted data after message_stop');
                }
                if (eventType !== 'message_start' && !sawMessageStart) {
                    throw new Error('Anthropic beta messages stream emitted content before message_start');
                }
                if (eventType === 'message_start') {
                    if (sawMessageStart || !isPlainObject(event['message'])) {
                        throw new Error('Anthropic beta messages stream emitted malformed/duplicate message_start');
                    }
                    if (!isNonEmptyString(event['message']['id'])) {
                        throw new Error('Anthropic beta messages message_start is missing a response id');
                    }
                    sawMessageStart = true;
                    if (typeof event['message']['id'] === 'string')
                        output.responseId = event['message']['id'];
                    appendProviderCacheDiagnostic(output, event['message']);
                    updateAnthropicUsage(output, isPlainObject(event['message']['usage']) ? event['message']['usage'] : undefined, model);
                }
                else if (eventType === 'content_block_start') {
                    const contentIndex = event['index'];
                    const contentBlock = event['content_block'];
                    if (!Number.isSafeInteger(contentIndex) ||
                        contentIndex < 0 ||
                        !isPlainObject(contentBlock)) {
                        throw new Error('Anthropic beta messages stream emitted malformed content_block_start');
                    }
                    if (activeContentIndexes.has(contentIndex)) {
                        throw new Error('Anthropic beta messages stream duplicated an active content block');
                    }
                    activeContentIndexes.add(contentIndex);
                    if (contentBlock['type'] === 'text') {
                        output.content.push({ type: 'text', text: '', index: contentIndex });
                        stream.push({
                            type: 'text_start',
                            contentIndex: output.content.length - 1,
                            partial: output,
                        });
                    }
                    else if (contentBlock['type'] === 'thinking') {
                        output.content.push({
                            type: 'thinking',
                            thinking: '',
                            thinkingSignature: '',
                            index: contentIndex,
                        });
                        stream.push({
                            type: 'thinking_start',
                            contentIndex: output.content.length - 1,
                            partial: output,
                        });
                    }
                    else if (contentBlock['type'] === 'redacted_thinking') {
                        if (typeof contentBlock['data'] !== 'string') {
                            throw new Error('Anthropic redacted_thinking block is missing string data');
                        }
                        output.content.push({
                            type: 'thinking',
                            thinking: '[Reasoning redacted]',
                            thinkingSignature: contentBlock['data'],
                            redacted: true,
                            index: contentIndex,
                        });
                        stream.push({
                            type: 'thinking_start',
                            contentIndex: output.content.length - 1,
                            partial: output,
                        });
                    }
                    else if (contentBlock['type'] === 'tool_use') {
                        if (typeof contentBlock['id'] !== 'string' ||
                            typeof contentBlock['name'] !== 'string' ||
                            !isPlainObject(contentBlock['input'] ?? {})) {
                            throw new Error('Anthropic tool_use block is malformed');
                        }
                        output.content.push({
                            type: 'toolCall',
                            id: contentBlock['id'],
                            name: contentBlock['name'],
                            arguments: contentBlock['input'] ?? {},
                            partialJson: '',
                            index: contentIndex,
                        });
                        stream.push({
                            type: 'toolcall_start',
                            contentIndex: output.content.length - 1,
                            partial: output,
                        });
                    }
                    else {
                        throw new Error(`Anthropic beta messages stream emitted unsupported content block ${JSON.stringify(contentBlock['type'])}`);
                    }
                }
                else if (eventType === 'content_block_delta') {
                    const contentIndex = event['index'];
                    const delta = event['delta'];
                    if (!Number.isSafeInteger(contentIndex) ||
                        !activeContentIndexes.has(contentIndex) ||
                        !isPlainObject(delta)) {
                        throw new Error('Anthropic beta messages stream emitted malformed/orphan content_block_delta');
                    }
                    const blockIndex = blocks.findIndex((block) => block.index === contentIndex);
                    const block = blocks[blockIndex];
                    if (!block) {
                        throw new Error('Anthropic beta messages stream delta has no projected content block');
                    }
                    if (delta['type'] === 'text_delta' &&
                        block['type'] === 'text' &&
                        typeof delta['text'] === 'string') {
                        block['text'] = `${String(block['text'] ?? '')}${delta['text']}`;
                        stream.push({
                            type: 'text_delta',
                            contentIndex: blockIndex,
                            delta: delta['text'],
                            partial: output,
                        });
                    }
                    else if (delta['type'] === 'thinking_delta' &&
                        block['type'] === 'thinking' &&
                        typeof delta['thinking'] === 'string') {
                        block['thinking'] = `${String(block['thinking'] ?? '')}${delta['thinking']}`;
                        stream.push({
                            type: 'thinking_delta',
                            contentIndex: blockIndex,
                            delta: delta['thinking'],
                            partial: output,
                        });
                    }
                    else if (delta['type'] === 'input_json_delta' &&
                        block['type'] === 'toolCall' &&
                        typeof delta['partial_json'] === 'string') {
                        block.partialJson = `${block.partialJson ?? ''}${delta['partial_json']}`;
                        block['arguments'] = parseStreamingJsonFragment(block.partialJson);
                        stream.push({
                            type: 'toolcall_delta',
                            contentIndex: blockIndex,
                            delta: delta['partial_json'],
                            partial: output,
                        });
                    }
                    else if (delta['type'] === 'signature_delta' &&
                        block['type'] === 'thinking' &&
                        typeof delta['signature'] === 'string') {
                        block['thinkingSignature'] =
                            `${String(block['thinkingSignature'] ?? '')}${delta['signature']}`;
                    }
                    else {
                        throw new Error(`Anthropic beta messages stream emitted unsupported/mismatched delta ${JSON.stringify(delta['type'])}`);
                    }
                }
                else if (eventType === 'content_block_stop') {
                    const contentIndex = event['index'];
                    if (!Number.isSafeInteger(contentIndex) ||
                        !activeContentIndexes.delete(contentIndex)) {
                        throw new Error('Anthropic beta messages stream emitted malformed/orphan content_block_stop');
                    }
                    const blockIndex = blocks.findIndex((block) => block.index === contentIndex);
                    const block = blocks[blockIndex];
                    if (!block) {
                        throw new Error('Anthropic beta messages stream stop has no projected content block');
                    }
                    delete block.index;
                    if (block['type'] === 'text') {
                        stream.push({
                            type: 'text_end',
                            contentIndex: blockIndex,
                            content: String(block['text'] ?? ''),
                            partial: output,
                        });
                    }
                    else if (block['type'] === 'thinking') {
                        stream.push({
                            type: 'thinking_end',
                            contentIndex: blockIndex,
                            content: String(block['thinking'] ?? ''),
                            partial: output,
                        });
                    }
                    else if (block['type'] === 'toolCall') {
                        block['arguments'] =
                            block.partialJson && block.partialJson.length > 0
                                ? parseCompletedToolInput(block.partialJson)
                                : canonicalizeJson(block['arguments'] ?? {});
                        delete block.partialJson;
                        stream.push({
                            type: 'toolcall_end',
                            contentIndex: blockIndex,
                            toolCall: block,
                            partial: output,
                        });
                    }
                }
                else if (eventType === 'message_delta') {
                    if (!isPlainObject(event['delta'])) {
                        throw new Error('Anthropic beta messages stream emitted malformed message_delta');
                    }
                    const stopReason = event['delta']['stop_reason'];
                    if (typeof stopReason === 'string') {
                        const mapped = mapStopReason(stopReason);
                        if (mapped === 'error') {
                            throw new Error(`Anthropic beta messages stream emitted unsupported stop reason ${JSON.stringify(stopReason)}`);
                        }
                        output.stopReason = mapped;
                        sawTerminalStopReason = true;
                    }
                    updateAnthropicUsage(output, isPlainObject(event['usage']) ? event['usage'] : undefined, model);
                }
                else if (eventType === 'message_stop') {
                    if (activeContentIndexes.size > 0) {
                        throw new Error('Anthropic beta messages message_stop arrived with open content blocks');
                    }
                    sawMessageStop = true;
                }
                else {
                    throw new Error(`Anthropic beta messages stream emitted unsupported event ${JSON.stringify(eventType)}`);
                }
            }
            if (options?.signal?.aborted)
                throw new Error('Request was aborted');
            if (!sawMessageStart) {
                throw new Error('Anthropic beta messages stream ended without message_start');
            }
            if (!sawMessageStop) {
                throw new Error('Anthropic beta messages stream ended without message_stop');
            }
            if (!sawTerminalStopReason || output.stopReason === 'error') {
                throw new Error('Anthropic beta messages stream ended without a valid terminal stop reason');
            }
            if (preparedLineage === undefined)
                throw new Error('Anthropic attribution completed without prepared cache lineage');
            appendLineageDiagnostic(output, preparedLineage);
            stream.push({ type: 'done', reason: output.stopReason, message: output });
            stream.end();
        }
        catch (error) {
            for (const block of output.content) {
                delete block['index'];
                delete block['partialJson'];
            }
            output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
            output.errorMessage = error instanceof Error ? error.message : String(error);
            stream.push({ type: 'error', reason: output.stopReason, error: output });
            stream.end();
        }
        finally {
            if (preparedLineage !== undefined)
                anthropicLineageCoordinator.release(preparedLineage);
        }
    })();
    return stream;
}
function cacheRetentionLabel(retention) {
    switch (retention) {
        case 'long':
            return '1-hour';
        case 'short':
            return '5-minute';
        case 'none':
            return 'disabled';
    }
}
function isAnthropicAttributionClaimProbe(value) {
    return (isPlainObject(value) &&
        value['schema_version'] === ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA &&
        typeof value['acknowledge'] === 'function');
}
/**
 * Prevent two independently installed copies from registering duplicate provider
 * hooks and `/claude-cache` commands in one Pi runtime. Pi loads extension factories
 * sequentially and its EventBus dispatches listeners synchronously, so an existing
 * owner acknowledges this probe before emit() returns. The winning extension only
 * publishes ownership after every registration below succeeds; a factory that throws
 * cannot strand a false claim that suppresses a healthy later copy.
 */
export default function spawnAnthropicAttribution(pi, dependencies = {}) {
    const acknowledgements = [];
    const probe = {
        schema_version: ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA,
        acknowledge: () => {
            acknowledgements.push(true);
        },
    };
    pi.events.emit(ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL, probe);
    if (acknowledgements.length > 0)
        return;
    let sessionCacheRetention;
    const getSessionOverride = () => sessionCacheRetention;
    // Registration is global but route-scoped by provider name. Keeping it at
    // factory scope avoids lifecycle-dependent provider availability; every custom
    // transport request owns attribution from its request-scoped session options.
    pi.registerProvider('anthropic', {
        api: 'anthropic-messages',
        streamSimple: (model, context, options) => streamAnthropicViaBetaMessages(model, context, {
            ...(options ?? {}),
            cacheRetention: resolveRegisteredCacheRetention(options, getSessionOverride()),
        }, dependencies),
    });
    pi.registerCommand('claude-cache', {
        description: 'Show or set Claude cache retention for this session (short, long, default)',
        handler: (args, ctx) => {
            const action = args.trim().toLowerCase();
            if (action.length === 0 || action === 'status') {
                const effective = resolveCacheRetentionPreference(undefined, sessionCacheRetention);
                ctx.ui?.notify(`Claude cache retention: ${cacheRetentionLabel(effective)}${sessionCacheRetention === undefined ? ' (default)' : ' (session override)'}`, 'info');
                return;
            }
            if (action !== 'short' && action !== 'long' && action !== 'default') {
                throw new Error('Usage: /claude-cache [status|short|long|default]');
            }
            sessionCacheRetention = action === 'default' ? undefined : action;
            pi.appendEntry(ANTHROPIC_CACHE_RETENTION_ENTRY, {
                schema_version: ANTHROPIC_CACHE_RETENTION_SCHEMA,
                retention: action,
            });
            const effective = resolveCacheRetentionPreference(undefined, sessionCacheRetention);
            ctx.ui?.notify(`Claude cache retention set to ${cacheRetentionLabel(effective)} for this session${action === 'default' ? ' (default policy)' : ''}.`, 'info');
        },
    });
    pi.on('session_start', (_event, ctx) => {
        sessionCacheRetention = restoreAnthropicSessionCacheRetention(ctx.sessionManager.getBranch());
    });
    pi.on('session_shutdown', () => {
        sessionCacheRetention = undefined;
    });
    pi.on('session_tree', (_event, ctx) => {
        sessionCacheRetention = restoreAnthropicSessionCacheRetention(ctx.sessionManager.getBranch());
    });
    // Publish ownership last. Extension loading is sequential, so later independent
    // copies probe this responder and become inert instead of registering duplicates.
    pi.events.on(ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL, (value) => {
        if (isAnthropicAttributionClaimProbe(value))
            value.acknowledge();
    });
}
//# sourceMappingURL=anthropic-attribution.js.map